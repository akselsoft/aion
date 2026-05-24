const fs = require('fs');
const path = require('path');
const { resolveConfigPath } = require('../../utils/paths');

module.exports = {
  async run(ctx, engineCfg, personaCfg) {
    const projectRoot = personaCfg.__projectRoot || process.cwd();
    const outputFile = resolvePath(projectRoot, engineCfg.outputFile || engineCfg.filename || 'Action-Items.md');
    const inputType = engineCfg.inputType;
    const includeExisting = engineCfg.includeExisting !== false;
    const now = new Date();

    const existing = includeExisting ? parseExisting(outputFile) : [];
    const discovered = discoverItems(ctx.passedFiles || [], inputType, now);
    const merged = mergeItems(existing, discovered);
    const content = renderActionItems(merged, now, engineCfg.title || 'Action Items');

    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, content, 'utf8');

    ctx.passedFiles.push({
      name: engineCfg.name || 'action-items',
      type: engineCfg.outputType || 'action-items',
      documents: [{
        filename: path.basename(outputFile),
        filetype: 'md',
        content,
        filePath: outputFile
      }]
    });
  }
};

function discoverItems(items, inputType, now) {
  const selected = inputType ? items.filter(item => item.type === inputType) : items;
  const out = [];

  for (const item of selected) {
    for (const doc of item.documents || []) {
      const content = String(doc.content || '');
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const cleaned = cleanLine(line);
        if (!looksActionable(cleaned)) continue;
        out.push({
          status: 'Open',
          item: cleaned,
          requiredBy: extractRequiredBy(cleaned, now),
          recurrence: extractRecurrence(cleaned),
          source: doc.filename || item.name || item.type || '',
          notes: ''
        });
      }
    }
  }

  return out;
}

function cleanLine(line) {
  return String(line || '')
    .replace(/^\s{0,3}[-*+]\s+/, '')
    .replace(/^\s{0,3}\d+[.)]\s+/, '')
    .replace(/^\s{0,3}\[[ xX]\]\s+/, '')
    .replace(/^\s{0,3}(todo|action item|action|follow up|follow-up)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksActionable(line) {
  if (!line || line.length < 8) return false;
  if (/^(done|completed|cancelled|canceled)\b/i.test(line)) return false;
  return /\b(todo|action item|action|follow[- ]?up|follow up|need to|needs to|must|should|by \w+ \d{1,2}|due|deadline|required by|waiting for|remind)\b/i.test(line);
}

function extractRequiredBy(text, now) {
  const patterns = [
    /\b(?:required by|due by|due|deadline|by)\s*:?\s*(\d{4}-\d{2}-\d{2})\b/i,
    /\b(?:required by|due by|due|deadline|by)\s*:?\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?)\b/i,
    /\b(?:required by|due by|due|deadline|by)\s*:?\s*(tomorrow|today)\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    return normalizeDate(match[1], now);
  }

  return '';
}

function normalizeDate(value, now) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const lower = raw.toLowerCase();
  if (lower === 'today') return formatDate(now);
  if (lower === 'tomorrow') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return formatDate(d);
  }

  const withYear = /\d{4}/.test(raw) ? raw : `${raw}, ${now.getFullYear()}`;
  const parsed = new Date(withYear);
  if (!Number.isFinite(parsed.getTime())) return raw;
  if (parsed < startOfDay(now) && !/\d{4}/.test(raw)) {
    parsed.setFullYear(parsed.getFullYear() + 1);
  }
  return formatDate(parsed);
}

function extractRecurrence(text) {
  const match = text.match(/\b(daily|weekly|biweekly|monthly|quarterly|yearly|annually|every\s+\d+\s+(?:day|days|week|weeks|month|months|year|years))\b/i);
  return match ? titleCase(match[1]) : '';
}

function parseExisting(outputFile) {
  try {
    const raw = fs.readFileSync(outputFile, 'utf8');
    return parseMarkdownTable(raw);
  } catch {
    return [];
  }
}

function parseMarkdownTable(raw) {
  const rows = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    if (/^\|\s*-+/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (cells.length < 6 || /^status$/i.test(cells[0])) continue;
    rows.push({
      status: cells[0] || 'Open',
      item: unescapeCell(cells[1]),
      requiredBy: cells[2],
      recurrence: cells[3],
      source: unescapeCell(cells[4]),
      notes: unescapeCell(cells[5])
    });
  }
  return rows.filter(row => row.item);
}

function mergeItems(existing, discovered) {
  const byKey = new Map();
  for (const item of [...existing, ...discovered]) {
    const key = normalizeKey(item.item);
    if (!key) continue;
    const previous = byKey.get(key);
    byKey.set(key, {
      status: previous?.status || item.status || 'Open',
      item: previous?.item || item.item,
      requiredBy: previous?.requiredBy || item.requiredBy || '',
      recurrence: previous?.recurrence || item.recurrence || '',
      source: previous?.source || item.source || '',
      notes: previous?.notes || item.notes || ''
    });
  }
  return [...byKey.values()].sort(compareItems);
}

function compareItems(a, b) {
  const ad = Date.parse(a.requiredBy || '');
  const bd = Date.parse(b.requiredBy || '');
  const av = Number.isFinite(ad) ? ad : Number.MAX_SAFE_INTEGER;
  const bv = Number.isFinite(bd) ? bd : Number.MAX_SAFE_INTEGER;
  return av - bv || a.item.localeCompare(b.item);
}

function renderActionItems(items, now, title) {
  const lines = [
    `# ${title}`,
    '',
    `Last Updated: ${now.toISOString()}`,
    '',
    '| Status | Item | Required By | Recurrence | Source | Notes |',
    '| --- | --- | --- | --- | --- | --- |'
  ];

  for (const item of items) {
    lines.push([
      item.status || 'Open',
      escapeCell(item.item),
      item.requiredBy || '',
      item.recurrence || '',
      escapeCell(item.source || ''),
      escapeCell(item.notes || '')
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  lines.push('');
  return lines.join('\n');
}

function resolvePath(projectRoot, value) {
  return resolveConfigPath(projectRoot, value);
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function escapeCell(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function unescapeCell(value) {
  return String(value || '').replace(/\\\|/g, '|');
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function startOfDay(d) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function titleCase(value) {
  return String(value || '').replace(/\b\w/g, c => c.toUpperCase());
}
