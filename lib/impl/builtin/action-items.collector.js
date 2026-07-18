const fs = require('fs');
const path = require('path');
const { resolveConfigPath } = require('../../utils/paths');

module.exports = {
  async run(ctx, engineCfg, personaCfg) {
    const projectRoot = personaCfg.__projectRoot || process.cwd();
    const filePath = resolvePath(projectRoot, engineCfg.file || engineCfg.filename || engineCfg.baseDir || 'Action-Items.md');
    const daysAhead = Number(engineCfg.daysAhead ?? engineCfg.withinDays ?? 7);
    const includeUnscheduled = engineCfg.includeUnscheduled === true;
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() + (Number.isFinite(daysAhead) ? daysAhead : 7));

    let raw = '';
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch {
      raw = '';
    }

    const items = parseItems(raw);
    const important = items
      .map(item => ({ ...item, importance: classifyImportance(item, now, cutoff, includeUnscheduled) }))
      .filter(item => item.importance)
      .sort(compareImportant);

    const content = renderImportant(important, now, daysAhead);
    ctx.passedFiles.push({
      name: engineCfg.name || 'important-action-items',
      type: engineCfg.outputType || 'action-items-important',
      documents: [{
        filename: path.basename(filePath),
        filetype: 'md',
        content,
        filePath
      }]
    });
  }
};

function parseItems(raw) {
  const tableItems = parseMarkdownTable(raw);
  if (tableItems.length) return tableItems;
  return parseTaskList(raw);
}

function parseMarkdownTable(raw) {
  const rows = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    if (/^\|\s*-+/.test(line)) continue;
    const cells = splitMarkdownRow(line);
    if (cells.length < 2 || /^status$/i.test(cells[0])) continue;
    rows.push({
      status: cells[0] || 'Open',
      item: cells[1] || '',
      requiredBy: cells[2] || '',
      recurrence: cells[3] || '',
      source: cells[4] || '',
      notes: cells[5] || ''
    });
  }
  return rows.filter(row => row.item);
}

function parseTaskList(raw) {
  const rows = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const match = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (!match) continue;
    const item = match[2].trim();
    rows.push({
      status: match[1].toLowerCase() === 'x' ? 'Done' : 'Open',
      item,
      requiredBy: extractInlineDate(item),
      recurrence: '',
      source: '',
      notes: ''
    });
  }
  return rows;
}

function classifyImportance(item, now, cutoff, includeUnscheduled) {
  if (isDone(item.status)) return '';
  const due = Date.parse(item.requiredBy || '');
  if (Number.isFinite(due)) {
    if (due < startOfDay(now).getTime()) return 'Overdue';
    if (due <= cutoff.getTime()) return 'Upcoming';
  }
  if (item.recurrence) return 'Recurring';
  if (includeUnscheduled) return 'Open';
  return '';
}

function renderImportant(items, now, daysAhead) {
  if (!items.length) {
    return `No important action items found as of ${now.toISOString()}.`;
  }

  const lines = [
    `Important action items as of ${now.toISOString()} (within ${daysAhead} days):`,
    ''
  ];

  for (const item of items) {
    const due = item.requiredBy ? ` due ${item.requiredBy}` : '';
    const recurrence = item.recurrence ? ` (${item.recurrence})` : '';
    lines.push(`- ${item.importance}: ${item.item}${due}${recurrence}`);
  }

  return lines.join('\n');
}

function compareImportant(a, b) {
  const rank = { Overdue: 0, Upcoming: 1, Recurring: 2, Open: 3 };
  const ar = rank[a.importance] ?? 9;
  const br = rank[b.importance] ?? 9;
  if (ar !== br) return ar - br;
  const ad = Date.parse(a.requiredBy || '');
  const bd = Date.parse(b.requiredBy || '');
  const av = Number.isFinite(ad) ? ad : Number.MAX_SAFE_INTEGER;
  const bv = Number.isFinite(bd) ? bd : Number.MAX_SAFE_INTEGER;
  return av - bv || a.item.localeCompare(b.item);
}

function splitMarkdownRow(line) {
  const cells = [];
  let current = '';
  let escaped = false;
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (const char of trimmed) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function extractInlineDate(text) {
  const match = String(text || '').match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return match ? match[1] : '';
}

function isDone(status) {
  return /^(done|complete|completed|cancelled|canceled)$/i.test(String(status || '').trim());
}

function startOfDay(d) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function resolvePath(projectRoot, value) {
  return resolveConfigPath(projectRoot, value);
}
