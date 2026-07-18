// Deterministic interpreter for selecting task and cadence-driven area candidates.
// Reads priority state for ranking only; it never mutates or persists that state.

module.exports = {
  async run(ctx, engineCfg = {}) {
    const now = parseNow(engineCfg.now);
    const inputs = readInputs(ctx, engineCfg);
    const built = buildCandidates(inputs, { ...engineCfg, now });
    const itemLimit = normalizeItemLimit(engineCfg.itemLimit ?? engineCfg.itemsPerDay ?? engineCfg.limit);
    const eligibleCandidates = built.allCandidates.filter(candidate => candidate.eligible);
    const rankedCandidates = rankCandidates(eligibleCandidates);
    const selectedItems = selectCandidates(rankedCandidates, itemLimit);
    const outputType = engineCfg.outputType || 'area-priorities';
    const excludedOutputType = engineCfg.excludedOutputType || `${outputType}-excluded`;
    const priorityPayload = {
      generatedAt: now.toISOString(),
      sourceRecordCount: built.sourceRecordCount,
      candidateCount: built.allCandidates.length,
      eligibleCandidateCount: rankedCandidates.length,
      selectedCount: selectedItems.length,
      excludedCount: built.excludedItems.length,
      allCandidates: built.allCandidates.map(stripInternal),
      rankedCandidates: rankedCandidates.map(stripInternal),
      selectedItems
    };
    const excludedPayload = {
      generatedAt: now.toISOString(),
      sourceRecordCount: built.sourceRecordCount,
      excludedCount: built.excludedItems.length,
      excludedItems: built.excludedItems
    };

    ctx.passedFiles.push(
      outputEntry({
        name: engineCfg.name || outputType,
        type: outputType,
        prompt: engineCfg.prompt || '',
        filename: engineCfg.filename || `${outputType}.json`,
        payload: priorityPayload
      }),
      outputEntry({
        name: engineCfg.excludedName || `${engineCfg.name || outputType}-excluded`,
        type: excludedOutputType,
        prompt: engineCfg.excludedPrompt || 'Source records excluded during candidate generation.',
        filename: engineCfg.excludedFilename || `${excludedOutputType}.json`,
        payload: excludedPayload
      })
    );
  }
};

function outputEntry({ name, type, prompt, filename, payload }) {
  return {
    name,
    type,
    prompt,
    documents: [{
      filename,
      filetype: 'json',
      content: JSON.stringify(payload, null, 2),
      json: payload
    }]
  };
}

function readInputs(ctx, engineCfg = {}) {
  const types = {
    tasks: engineCfg.tasksInputType || 'tasks',
    areas: engineCfg.priorityAreasInputType || engineCfg.areasInputType || 'priority-areas',
    state: engineCfg.priorityStateInputType || engineCfg.stateInputType || 'priority-state'
  };
  const items = Array.isArray(ctx?.passedFiles) ? ctx.passedFiles : [];
  return {
    tasks: collectRows(items, types.tasks, ['tasks', 'items']),
    areas: collectRows(items, types.areas, ['areas', 'priorityAreas', 'items']),
    state: collectObject(items, types.state) || {}
  };
}

function collectRows(items, inputType, arrayKeys) {
  const rows = [];
  for (const item of items.filter(entry => entry.type === inputType)) {
    for (const doc of item.documents || []) {
      const parsed = parseDocument(doc);
      if (Array.isArray(parsed)) {
        rows.push(...parsed.filter(isObject));
        continue;
      }
      if (!isObject(parsed)) continue;
      const key = arrayKeys.find(name => Array.isArray(parsed[name]));
      if (key) rows.push(...parsed[key].filter(isObject));
    }
  }
  return rows;
}

function collectObject(items, inputType) {
  for (const item of items.filter(entry => entry.type === inputType)) {
    for (const doc of item.documents || []) {
      const parsed = parseDocument(doc);
      if (isObject(parsed)) return parsed;
    }
  }
  return null;
}

function parseDocument(doc) {
  if (doc?.json !== undefined) return doc.json;
  const content = String(doc?.content || '').trim();
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function buildCandidates(inputs, engineCfg = {}) {
  const now = parseNow(engineCfg.now);
  const dueSoonDays = normalizeNonNegative(engineCfg.dueSoonDays, 7);
  const includeOverdue = engineCfg.includeOverdue !== false;
  const duplicateAreaIds = duplicateIds(inputs.areas);
  const areas = new Map(inputs.areas
    .filter(area => area.id && !duplicateAreaIds.has(cleanString(area.id)))
    .map(area => [String(area.id), area]));
  const options = { now, dueSoonDays, includeOverdue };
  const taskResult = normalizeTaskCandidates(inputs.tasks, areas, inputs.state, options);
  const areaResult = normalizeAreaCandidates(inputs.areas, inputs.state, options);

  return {
    sourceRecordCount: inputs.tasks.length + inputs.areas.length,
    allCandidates: [...taskResult.candidates, ...areaResult.candidates],
    excludedItems: [...taskResult.excludedItems, ...areaResult.excludedItems]
  };
}

function normalizeTaskCandidates(tasks, areas, state, { now, dueSoonDays, includeOverdue }) {
  const candidates = [];
  const excludedItems = [];
  const duplicates = duplicateIds(tasks);

  tasks.forEach((task, sourceIndex) => {
    const sourceId = cleanString(task.id);
    if (!sourceId) {
      excludedItems.push(excluded('tasks', null, sourceIndex, 'MISSING_SOURCE_ID', 'Task record has no usable id.', task));
      return;
    }
    if (duplicates.has(sourceId)) {
      excludedItems.push(excluded('tasks', sourceId, sourceIndex, 'DUPLICATE_SOURCE_ID', `Task id "${sourceId}" occurs more than once; every conflicting record was excluded.`, task));
      return;
    }
    if (isTerminalStatus(task.status)) {
      excludedItems.push(excluded('tasks', sourceId, sourceIndex, 'TERMINAL_STATUS', `Task status "${task.status}" is not eligible for candidate generation.`, task));
      return;
    }
    const areaId = cleanString(task.areaId);
    const area = areas.get(areaId);
    if (!area) {
      excludedItems.push(excluded('tasks', sourceId, sourceIndex, 'UNKNOWN_AREA', `Task areaId "${areaId || '(missing)'}" does not resolve to one unique priority area.`, task));
      return;
    }
    if (!cleanString(task.title)) {
      excludedItems.push(excluded('tasks', sourceId, sourceIndex, 'MISSING_TITLE', 'Task record has no usable title.', task));
      return;
    }
    const dueDate = normalizeDate(task.dueDate);
    const urgency = dueUrgency(dueDate, now, dueSoonDays);
    const eligible = includeOverdue || urgency !== 0;
    const history = historyFor(state, 'tasks', sourceId, `task:${sourceId}`);
    candidates.push(candidate({
      candidateId: `task:${sourceId}`,
      candidateType: 'task',
      title: task.title,
      area,
      areaId,
      dueDate,
      history,
      sourceType: 'tasks',
      sourceId,
      urgency,
      eligible,
      eligibilityReason: eligible ? 'ELIGIBLE' : 'OVERDUE_EXCLUDED',
      createdAt: normalizeTimestamp(task.createdAt),
      metadata: sourceMetadata(task, ['id', 'title', 'areaId', 'dueDate', 'createdAt'])
    }));
  });

  return { candidates, excludedItems };
}

function normalizeAreaCandidates(areas, state, { now }) {
  const candidates = [];
  const excludedItems = [];
  const duplicates = duplicateIds(areas);

  areas.forEach((area, sourceIndex) => {
    const sourceId = cleanString(area.id);
    if (!sourceId) {
      excludedItems.push(excluded('priority-area', null, sourceIndex, 'MISSING_SOURCE_ID', 'Priority-area record has no usable id.', area));
      return;
    }
    if (duplicates.has(sourceId)) {
      excludedItems.push(excluded('priority-area', sourceId, sourceIndex, 'DUPLICATE_SOURCE_ID', `Priority-area id "${sourceId}" occurs more than once; every conflicting record was excluded.`, area));
      return;
    }
    if (area.active === false) {
      excludedItems.push(excluded('priority-area', sourceId, sourceIndex, 'INACTIVE_AREA', 'Priority area is inactive.', area));
      return;
    }
    if (!isSupportedCadence(area.cadence)) {
      excludedItems.push(excluded('priority-area', sourceId, sourceIndex, 'INVALID_CADENCE', `Priority area cadence "${area.cadence ?? ''}" is not supported.`, area));
      return;
    }
    const history = historyFor(state, 'areas', sourceId, `area:${sourceId}`);
    const eligible = isCadenceEligible(area.cadence, history.lastSelectedAt, now);
    candidates.push(candidate({
      candidateId: `area:${sourceId}`,
      candidateType: 'area',
      title: cleanString(area.defaultAction) || cleanString(area.name) || sourceId,
      area,
      areaId: sourceId,
      dueDate: null,
      history,
      sourceType: 'priority-area',
      sourceId,
      urgency: 4,
      eligible,
      eligibilityReason: eligible ? 'ELIGIBLE' : 'CADENCE_NOT_DUE',
      createdAt: normalizeTimestamp(area.createdAt),
      metadata: sourceMetadata(area, ['id', 'name', 'tier', 'rank', 'cadence', 'createdAt'])
    }));
  });

  return { candidates, excludedItems };
}

function candidate({ candidateId, candidateType, title, area, areaId, dueDate, history, sourceType, sourceId, urgency, eligible, eligibilityReason, createdAt, metadata }) {
  return {
    candidateId,
    candidateType,
    title: cleanString(title),
    areaId,
    areaName: cleanString(area.name) || areaId,
    tier: finiteNumberOrNull(area.tier),
    rank: finiteNumberOrNull(area.rank),
    cadence: cleanString(area.cadence) || null,
    dueDate,
    lastSelectedAt: history.lastSelectedAt,
    selectionCount: history.selectionCount,
    createdAt,
    sourceType,
    sourceId,
    eligible,
    eligibilityReason,
    metadata,
    _urgency: urgency
  };
}

function rankCandidates(candidates) {
  return [...candidates].sort(compareCandidates);
}

function selectCandidates(rankedCandidates, itemLimit) {
  return rankedCandidates.slice(0, normalizeItemLimit(itemLimit)).map(stripInternal);
}

function compareCandidates(a, b) {
  // 1. Surface overdue and immediately due attention before less urgent work.
  return compareNumber(a._urgency, b._urgency)
    // 2. Resolve equal due states by the earliest concrete deadline.
    || compareDate(a.dueDate, b.dueDate)
    // 3. Preserve the primary importance grouping defined by the area tier.
    || compareNullableNumber(a.tier, b.tier)
    // 4. Preserve the configured order within an importance tier.
    || compareNullableNumber(a.rank, b.rank)
    // 5a. Give candidates that have never received attention the first opportunity.
    || compareNumber(a.lastSelectedAt ? 1 : 0, b.lastSelectedAt ? 1 : 0)
    // 5b. For selected candidates, prefer the one waiting longest for attention.
    || compareHistoryDate(a.lastSelectedAt, b.lastSelectedAt)
    // 5c. Prefer the candidate selected fewer times when selection dates tie.
    || compareNumber(a.selectionCount, b.selectionCount)
    // 6. Prefer older candidates after urgency, priority, and history are equal.
    || compareHistoryDate(a.createdAt, b.createdAt)
    // 7. Guarantee a stable total order for otherwise identical candidates.
    || a.candidateId.localeCompare(b.candidateId);
}

function duplicateIds(records) {
  const counts = new Map();
  for (const record of records || []) {
    const id = cleanString(record?.id);
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id));
}

function excluded(sourceType, sourceId, sourceIndex, reasonCode, explanation, record) {
  return {
    sourceType,
    sourceId,
    sourceIndex,
    reasonCode,
    explanation,
    record
  };
}

function isSupportedCadence(cadence) {
  return ['d', '2d', 'w', '2w', 'm', 'q', 's', 'y'].includes(cleanString(cadence));
}

function isCadenceEligible(cadence, lastSelectedAt, now = new Date()) {
  const code = cleanString(cadence);
  if (!isSupportedCadence(code)) return false;
  const last = parseDate(lastSelectedAt);
  if (!last) return true;
  const eligibleAt = nextEligibleAt(last, code);
  return now.getTime() >= eligibleAt.getTime();
}

function nextEligibleAt(last, cadence) {
  const date = startOfUtcDay(last);
  if (cadence === 'd') date.setUTCDate(date.getUTCDate() + 1);
  if (cadence === '2d') date.setUTCDate(date.getUTCDate() + 2);
  if (cadence === 'w') date.setUTCDate(date.getUTCDate() + 7);
  if (cadence === '2w') date.setUTCDate(date.getUTCDate() + 14);
  if (cadence === 'm') return addUtcCalendarMonths(date, 1);
  if (cadence === 'q') return addUtcCalendarMonths(date, 3);
  if (cadence === 's') return addUtcCalendarMonths(date, 6);
  if (cadence === 'y') return addUtcCalendarMonths(date, 12);
  return date;
}

function addUtcCalendarMonths(date, months) {
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

function dueUrgency(dueDate, now, dueSoonDays) {
  const due = parseDueDate(dueDate);
  if (!due) return 4;
  const today = startOfUtcDay(now);
  const deltaDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (deltaDays < 0) return 0;
  if (deltaDays === 0) return 1;
  if (deltaDays <= dueSoonDays) return 2;
  return 3;
}

function historyFor(state, collection, sourceId, candidateId) {
  const group = isObject(state?.[collection]) ? state[collection] : {};
  const raw = group[sourceId] || group[candidateId] || {};
  return {
    lastSelectedAt: normalizeTimestamp(raw.lastSelectedAt),
    selectionCount: normalizeNonNegative(raw.selectionCount, 0)
  };
}

function parseDueDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])));
  return parseDate(text);
}

function normalizeDate(value) {
  const parsed = parseDueDate(value);
  if (!parsed) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim())
    ? String(value).trim()
    : parsed.toISOString();
}

function normalizeTimestamp(value) {
  const parsed = parseDate(value);
  return parsed ? parsed.toISOString() : null;
}

function parseDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return new Date(value.getTime());
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function parseNow(value) {
  const parsed = parseDate(value);
  return parsed || new Date();
}

function startOfUtcDay(value) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function isTerminalStatus(value) {
  return ['closed', 'cancelled', 'canceled'].includes(String(value || 'open').trim().toLowerCase());
}

function compareDate(a, b) {
  const av = parseDueDate(a)?.getTime() ?? Number.POSITIVE_INFINITY;
  const bv = parseDueDate(b)?.getTime() ?? Number.POSITIVE_INFINITY;
  return compareNumber(av, bv);
}

function compareHistoryDate(a, b) {
  const av = parseDate(a)?.getTime() ?? Number.POSITIVE_INFINITY;
  const bv = parseDate(b)?.getTime() ?? Number.POSITIVE_INFINITY;
  return compareNumber(av, bv);
}

function compareNullableNumber(a, b) {
  return compareNumber(a ?? Number.POSITIVE_INFINITY, b ?? Number.POSITIVE_INFINITY);
}

function compareNumber(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeNonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeItemLimit(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 3;
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sourceMetadata(source, commonKeys) {
  const metadata = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (!commonKeys.includes(key)) metadata[key] = value;
  }
  return metadata;
}

function stripInternal(candidate) {
  const { _urgency, ...publicCandidate } = candidate;
  return publicCandidate;
}

module.exports._private = {
  buildCandidates,
  compareCandidates,
  dueUrgency,
  isCadenceEligible,
  nextEligibleAt,
  normalizeAreaCandidates,
  normalizeTaskCandidates,
  rankCandidates,
  readInputs,
  selectCandidates,
  stripInternal
};
