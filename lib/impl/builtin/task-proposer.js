const fs = require('fs');
const { resolveConfigPath } = require('../../utils/paths');

// Builds one LLM-ready passedFiles entry per eligible area. It never calls an
// LLM and never changes authoritative tasks or priority state.
module.exports = {
  async run(ctx, engineCfg = {}, personaCfg = {}) {
    const now = parseNow(engineCfg.now);
    const projectRoot = personaCfg.__projectRoot || process.cwd();
    const inputs = readInputs(ctx, engineCfg);
    const selectedIds = selectedAreaIds(ctx, engineCfg);
    const outputType = engineCfg.outputType || 'task-proposal-context';
    const skipped = [];
    const allocateTaskIds = taskIdAllocator(inputs.tasks, now);

    for (const area of inputs.areas) {
      const review = reviewArea(area, inputs.state, selectedIds, now, projectRoot, engineCfg);
      if (!review.ok) {
        skipped.push(skipRecord(area, review));
        continue;
      }

      const tasks = inputs.tasks.filter(task => clean(task.areaId) === clean(area.id));
      const context = collectAreaContext(ctx, area, engineCfg, projectRoot);
      const maximum = positiveInteger(engineCfg.maxProposalsPerArea, 5);
      const proposalTaskIds = Array.from({ length: maximum }, () => allocateTaskIds());
      const payload = {
        area,
        tasks,
        selectionHistory: areaHistory(inputs.state, area.id),
        context,
        proposalTaskIds,
        proposalTimestamp: now.toISOString()
      };

      ctx.passedFiles.push({
        name: `task-proposal-context:${area.id}`,
        type: outputType,
        areaId: area.id,
        prompt: buildProposalPrompt(area, review.areaPrompt, engineCfg, {
          proposalTaskIds,
          proposalTimestamp: now.toISOString()
        }),
        documents: [{
          filename: `task-proposal-context-${slug(area.id)}.json`,
          filetype: 'json',
          content: JSON.stringify(payload, null, 2),
          json: payload
        }]
      });
    }

    ctx.passedFiles.push({
      name: engineCfg.skippedName || 'task-proposal-context-skipped',
      type: engineCfg.skippedOutputType || `${outputType}-skipped`,
      documents: [{
        filename: 'task-proposal-context-skipped.json',
        filetype: 'json',
        content: JSON.stringify({
          generatedAt: now.toISOString(),
          areaCount: inputs.areas.length,
          contextCount: inputs.areas.length - skipped.length,
          skippedCount: skipped.length,
          areasSkipped: skipped
        }, null, 2),
        json: {
          generatedAt: now.toISOString(),
          areaCount: inputs.areas.length,
          contextCount: inputs.areas.length - skipped.length,
          skippedCount: skipped.length,
          areasSkipped: skipped
        }
      }]
    });
  }
};

function readInputs(ctx, cfg) {
  const items = Array.isArray(ctx?.passedFiles) ? ctx.passedFiles : [];
  return {
    areas: collectRows(items, cfg.priorityAreasInputType || 'priority-areas', ['areas', 'priorityAreas', 'items']),
    tasks: collectRows(items, cfg.tasksInputType || 'morning-tasks', ['tasks', 'items']),
    state: collectObject(items, cfg.priorityStateInputType || 'task-priority-state') || {}
  };
}

function reviewArea(area, state, selectedIds, now, projectRoot, cfg) {
  if (area.active === false) return rejected('INACTIVE_AREA', 'Priority area is inactive.');
  if (!clean(area.promptFile)) return rejected('MISSING_PROMPT_FILE', 'Priority area has no promptFile.');
  const promptPath = resolveConfigPath(resolveConfigPath(projectRoot, cfg.promptsDir || 'prompts'), area.promptFile);
  if (!fs.existsSync(promptPath) || !fs.statSync(promptPath).isFile()) {
    return rejected('PROMPT_FILE_NOT_FOUND', `Area prompt file was not found: ${area.promptFile}`);
  }
  if (!selectedIds.has(clean(area.id)) && !isCadenceEligible(area.cadence, areaHistory(state, area.id).lastSelectedAt, now)) {
    return rejected('NOT_ELIGIBLE', 'Area is neither cadence-eligible nor selected for proposal review.');
  }
  return { ok: true, areaPrompt: fs.readFileSync(promptPath, 'utf8') };
}

function buildProposalPrompt(area, areaPrompt, cfg, proposalDefaults = {}) {
  const maximum = positiveInteger(cfg.maxProposalsPerArea, 5);
  const ids = proposalDefaults.proposalTaskIds || [];
  const timestamp = proposalDefaults.proposalTimestamp || new Date().toISOString();
  return [
    '# Area-specific context and review instructions',
    areaPrompt.trim(),
    '# Task proposal instructions',
    `Review the attached area definition, all matching task statuses, selection history, and configured context. Identify up to ${maximum} useful missing, upcoming, or clarifying tasks. Do not restate existing open or in-progress tasks. Do not modify task state. It is valid to propose no tasks.`,
    `Every proposedTasks item must be directly pasteable into tasks.json. Use the supplied proposalTaskIds in order without changing them. Set status to "open", createdAt and updatedAt to "${timestamp}", and closedAt to null. Put the proposal rationale and useful implementation detail in notes.`,
    'Return only valid JSON using this shape:',
    JSON.stringify({
      areaId: area.id,
      assessment: { summary: 'Brief assessment', currentStage: null, gaps: [] },
      proposedTasks: [{
        id: ids[0] || 'task-YYYYMMDD-XXX',
        title: 'Task title',
        areaId: area.id,
        dueDate: null,
        status: 'open',
        notes: 'Why this task is useful and any important implementation context.',
        createdAt: timestamp,
        updatedAt: timestamp,
        closedAt: null
      }]
    }, null, 2),
    'Do not add proposal-only fields such as description, estimatedDueDate, reason, priority, confidence, proposalType, or proposalId to task objects.'
  ].join('\n\n');
}

function taskIdAllocator(tasks, now) {
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const pattern = new RegExp(`^task-${date}-(\\d+)$`);
  let sequence = tasks.reduce((highest, task) => {
    const match = clean(task.id).match(pattern);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return () => `task-${date}-${String(++sequence).padStart(3, '0')}`;
}

function selectedAreaIds(ctx, cfg) {
  const types = new Set(asArray(cfg.selectedAreaInputTypes || ['area-priorities']));
  const ids = new Set(asArray(cfg.reviewAreaIds).map(clean).filter(Boolean));
  for (const item of ctx.passedFiles || []) {
    if (!types.has(item.type)) continue;
    for (const doc of item.documents || []) {
      const parsed = parseDocument(doc);
      for (const selected of parsed?.selectedItems || []) if (clean(selected.areaId)) ids.add(clean(selected.areaId));
    }
  }
  return ids;
}

function collectAreaContext(ctx, area, cfg, projectRoot) {
  const types = new Set([...asArray(cfg.contextInputTypes), ...asArray(area.contextInputTypes)]);
  const passedFiles = (ctx.passedFiles || []).filter(item => types.has(item.type)).map(item => ({
    type: item.type,
    name: item.name || item.type,
    documents: (item.documents || []).map(doc => ({ filename: doc.filename, content: doc.content || JSON.stringify(doc.json ?? null) }))
  }));
  const files = asArray(area.contextFiles).map(filename => {
    const full = resolveConfigPath(projectRoot, filename);
    return fs.existsSync(full) ? { filename, content: fs.readFileSync(full, 'utf8') } : { filename, missing: true };
  });
  return { passedFiles, files };
}

function isCadenceEligible(cadence, lastSelectedAt, now) {
  if (!['d', '2d', 'w', '2w', 'm', 'q', 's', 'y'].includes(cadence)) return false;
  if (!lastSelectedAt) return true;
  const previous = new Date(lastSelectedAt);
  if (Number.isNaN(previous.getTime())) return true;
  const days = { d: 1, '2d': 2, w: 7, '2w': 14 }[cadence];
  if (days) return now.getTime() >= previous.getTime() + days * 86400000;
  const next = new Date(previous);
  next.setUTCMonth(next.getUTCMonth() + { m: 1, q: 3, s: 6, y: 12 }[cadence]);
  return now >= next;
}

function collectRows(items, type, keys) {
  const rows = [];
  for (const item of items.filter(entry => entry.type === type)) for (const doc of item.documents || []) {
    const value = parseDocument(doc);
    if (Array.isArray(value)) rows.push(...value.filter(isObject));
    else if (isObject(value)) { const key = keys.find(name => Array.isArray(value[name])); if (key) rows.push(...value[key].filter(isObject)); }
  }
  return rows;
}
function collectObject(items, type) {
  for (const item of items.filter(entry => entry.type === type)) for (const doc of item.documents || []) { const value = parseDocument(doc); if (isObject(value)) return value; }
  return null;
}
function parseDocument(doc) { if (doc?.json !== undefined) return doc.json; try { return JSON.parse(doc?.content || ''); } catch { return null; } }
function areaHistory(state, id) { return state?.areas?.[id] || {}; }
function skipRecord(area, reason) { return { areaId: area.id ?? null, areaName: area.name || area.id || null, promptFile: area.promptFile || null, reasonCode: reason.code, explanation: reason.explanation }; }
function rejected(code, explanation) { return { ok: false, code, explanation }; }
function parseNow(value) { const date = value ? new Date(value) : new Date(); if (Number.isNaN(date.getTime())) throw new Error(`Invalid task-proposer now value: ${value}`); return date; }
function positiveInteger(value, fallback) { const number = Number(value); return Number.isInteger(number) && number >= 0 ? number : fallback; }
function asArray(value) { return value == null ? [] : Array.isArray(value) ? value : [value]; }
function clean(value) { return String(value ?? '').trim(); }
function slug(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }

module.exports._private = { buildProposalPrompt, reviewArea, collectAreaContext, isCadenceEligible, taskIdAllocator };
