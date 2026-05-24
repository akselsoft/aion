module.exports = {
  async run(ctx, engineCfg) {
    const inputType = engineCfg.inputType;
    const outputType = engineCfg.outputType || 'json-eval';
    if (!inputType) throw new Error('json-evaluator: inputType is required');

    const action = String(engineCfg.action || 'count').trim().toLowerCase();
    const field = engineCfg.field || engineCfg.attribute || null;
    const filters = normalizeRules(engineCfg.filters);
    const groups = normalizeGroup(engineCfg.group);
    const groupFilters = normalizeRules(engineCfg.groupFilter);

    const items = Array.isArray(ctx.passedFiles) ? ctx.passedFiles : [];
    const selected = items.filter(i => i.type === inputType);
    if (!selected.length) {
      console.warn(`⚠️ json-evaluator skipped: no passedFiles with type="${inputType}".`);
      return;
    }

    const rows = selected.flatMap(readRowsFromItem);
    const filteredRows = rows.filter(row => matchesRules(row, filters));
    const result = evaluateRows(filteredRows, action, field, groups, groupFilters);
    const value = unwrapResult(result);

    const payload = {
      action,
      field: field || null,
      filters,
      group: groups,
      groupFilter: groupFilters,
      sourceCount: rows.length,
      filteredCount: filteredRows.length,
      result: value
    };

    ctx.passedFiles.push({
      name: engineCfg.name || outputType,
      type: outputType,
      prompt: engineCfg.prompt || '',
      documents: [{
        filename: `${outputType}.json`,
        filetype: 'json',
        content: JSON.stringify(payload, null, 2),
        json: payload
      }]
    });
  }
};

function readRowsFromItem(item) {
  return (item.documents || []).flatMap((doc) => {
    const parsed = parseJsonDoc(doc);
    if (parsed == null) return [];
    if (Array.isArray(parsed)) return parsed.filter(isObjectLike);
    if (Array.isArray(parsed.rows)) return parsed.rows.filter(isObjectLike);
    if (Array.isArray(parsed.result)) return parsed.result.filter(isObjectLike);
    return isObjectLike(parsed) ? [parsed] : [];
  });
}

function parseJsonDoc(doc) {
  if (doc && doc.json !== undefined) return doc.json;
  const content = String(doc?.content || '').trim();
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function evaluateRows(rows, action, field, groups, groupFilters) {
  if (!groups.length) {
    return computeAggregate(rows, action, field);
  }

  const grouped = new Map();
  for (const row of rows) {
    const keyObj = Object.fromEntries(groups.map((name) => [name, getValue(row, name)]));
    const key = JSON.stringify(keyObj);
    if (!grouped.has(key)) grouped.set(key, { keyObj, rows: [] });
    grouped.get(key).rows.push(row);
  }

  const out = [];
  for (const entry of grouped.values()) {
    const aggregate = computeAggregate(entry.rows, action, field);
    const record = { ...entry.keyObj, result: aggregate };
    if (matchesRules(record, groupFilters)) out.push(record);
  }
  return out;
}

function computeAggregate(rows, action, field) {
  switch (action) {
    case 'count':
      return rows.length;
    case 'sum':
      requireField(action, field);
      return values(rows, field).reduce((sum, v) => sum + toNumber(v), 0);
    case 'avg':
    case 'average': {
      requireField(action, field);
      const nums = values(rows, field).map(toNumber).filter(Number.isFinite);
      return nums.length ? nums.reduce((sum, v) => sum + v, 0) / nums.length : 0;
    }
    case 'min':
      requireField(action, field);
      return minMax(values(rows, field), 'min');
    case 'max':
      requireField(action, field);
      return minMax(values(rows, field), 'max');
    case 'distinct':
      requireField(action, field);
      return [...new Set(values(rows, field))];
    case 'pluck':
    case 'select':
      requireField(action, field);
      return values(rows, field);
    default:
      throw new Error(`json-evaluator: unsupported action "${action}"`);
  }
}

function unwrapResult(result) {
  if (Array.isArray(result)) {
    if (result.length === 1) return result[0];
    return result;
  }
  return result;
}

function matchesRules(row, rules) {
  return rules.every((rule) => matchRule(row, rule));
}

function matchRule(row, rule) {
  const actual = getValue(row, rule.attribute);
  const expected = rule.value;
  switch (rule.operator) {
    case '=':
    case '==':
      return actual == expected; // intentional loose compare for JSON/config values
    case '!=':
    case '<>':
      return actual != expected;
    case '>':
      return toNumber(actual) > toNumber(expected);
    case '>=':
      return toNumber(actual) >= toNumber(expected);
    case '<':
      return toNumber(actual) < toNumber(expected);
    case '<=':
      return toNumber(actual) <= toNumber(expected);
    case 'contains':
      return String(actual ?? '').includes(String(expected ?? ''));
    case 'in':
      return normalizeArray(expected).includes(actual);
    case 'not in':
      return !normalizeArray(expected).includes(actual);
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'not exists':
      return actual === undefined || actual === null;
    default:
      throw new Error(`json-evaluator: unsupported operator "${rule.operator}"`);
  }
}

function getValue(obj, attribute) {
  return String(attribute || '')
    .split('.')
    .filter(Boolean)
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function values(rows, field) {
  return rows.map((row) => getValue(row, field));
}

function minMax(arr, mode) {
  const filtered = arr.filter(v => v !== undefined && v !== null);
  if (!filtered.length) return null;
  return filtered.reduce((best, current) => {
    if (best === undefined) return current;
    return mode === 'min' ? (current < best ? current : best) : (current > best ? current : best);
  }, undefined);
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRules(rules) {
  if (!rules) return [];
  return (Array.isArray(rules) ? rules : [rules]).map((rule) => ({
    attribute: rule.attribute || rule.field,
    operator: String(rule.operator || '=').trim().toLowerCase(),
    value: rule.value
  }));
}

function normalizeGroup(group) {
  if (!group) return [];
  return (Array.isArray(group) ? group : [group]).map(String).filter(Boolean);
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [value];
}

function isObjectLike(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function requireField(action, field) {
  if (!field) throw new Error(`json-evaluator: field is required for action "${action}"`);
}
