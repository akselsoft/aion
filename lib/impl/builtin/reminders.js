const fs = require('fs');
const path = require('path');
const { resolveConfigPath } = require('../../utils/paths');
const crypto = require('crypto');

module.exports = {
  async run(ctx, engineCfg, personaCfg) {
    const projectRoot = personaCfg.__projectRoot || process.cwd();
    const outputType = engineCfg.outputType || 'reminders';
    const sources = collectSources(ctx, projectRoot, engineCfg);
    const reminders = [];

    for (const source of sources) {
      reminders.push(...extractReminders(source, engineCfg));
    }

    const payload = {
      version: 1,
      generatedAt: new Date().toISOString(),
      sourceCount: sources.length,
      reminderCount: reminders.length,
      reminders
    };

    ctx.passedFiles.push({
      name: engineCfg.name || outputType,
      type: outputType,
      prompt: engineCfg.prompt || '',
      documents: [{
        filename: engineCfg.filename || `${outputType}.json`,
        filetype: 'json',
        content: JSON.stringify(payload, null, 2),
        json: payload
      }]
    });
  }
};

function collectSources(ctx, projectRoot, engineCfg) {
  const explicit = engineCfg.file || engineCfg.inputFile || engineCfg.reminderFile || engineCfg.baseDir;
  if (explicit) {
    const filePath = resolveProjectPath(projectRoot, explicit);
    if (!existsFile(filePath)) {
      if (engineCfg.required === true) throw new Error(`reminders: file not found: ${filePath}`);
      return [];
    }
    return [{
      filename: path.basename(filePath),
      filePath,
      content: readText(filePath)
    }];
  }

  const inputType = engineCfg.inputType;
  const items = Array.isArray(ctx.passedFiles) ? ctx.passedFiles : [];
  const selected = inputType ? items.filter(item => item.type === inputType) : items;
  const out = [];

  for (const item of selected) {
    for (const doc of item.documents || []) {
      if (!looksLikeReminderSource(item, doc, engineCfg)) continue;
      out.push({
        filename: doc.filename || item.name || 'reminders',
        filePath: doc.filePath || null,
        content: String(doc.content || ''),
        json: doc.json
      });
    }
  }

  return out;
}

function extractReminders(source, engineCfg) {
  const parsed = source.json !== undefined ? source.json : parseJson(source.content);
  if (parsed !== null) return normalizeJsonReminders(parsed, source, engineCfg);
  return parseTextReminders(source, engineCfg);
}

function normalizeJsonReminders(parsed, source, engineCfg) {
  const rows = selectReminderRows(parsed);
  return rows
    .map((row, index) => normalizeReminder(row, source, index, engineCfg))
    .filter(reminder => reminder.text);
}

function selectReminderRows(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return [];
  for (const key of ['reminders', 'items', 'tasks', 'actionItems', 'action_items']) {
    if (Array.isArray(parsed[key])) return parsed[key];
  }
  return [parsed];
}

function normalizeReminder(row, source, index, engineCfg) {
  const text = firstString(row, ['text', 'task', 'title', 'summary', 'description', 'content']);
  const reminderDate = firstString(row, ['reminderDate', 'reminder_date', 'remindAt', 'remind_at', 'date']);
  const dueDate = firstString(row, ['dueDate', 'due_date', 'deadline']);
  const status = firstString(row, ['status', 'state']) || engineCfg.defaultStatus || 'open';
  const priority = firstString(row, ['priority', 'importance']) || null;

  return {
    id: firstString(row, ['id']) || stableId(source, index, text, reminderDate, dueDate),
    text,
    status,
    reminderDate: normalizeDateValue(reminderDate),
    dueDate: normalizeDateValue(dueDate),
    priority,
    source: source.filePath || source.filename || null,
    sourceLine: numberOrNull(row.sourceLine || row.line),
    sourceExcerpt: firstString(row, ['sourceExcerpt', 'excerpt']) || null,
    tags: Array.isArray(row.tags) ? row.tags.map(String) : []
  };
}

function parseTextReminders(source, engineCfg) {
  const lines = String(source.content || '').split(/\r?\n/);
  const reminders = [];

  lines.forEach((line, index) => {
    const parsed = parseReminderLine(line, engineCfg);
    if (!parsed) return;
    reminders.push({
      id: stableId(source, index, parsed.text, parsed.reminderDate, parsed.dueDate),
      text: parsed.text,
      status: parsed.status || engineCfg.defaultStatus || 'open',
      reminderDate: normalizeDateValue(parsed.reminderDate),
      dueDate: normalizeDateValue(parsed.dueDate),
      priority: parsed.priority || null,
      source: source.filePath || source.filename || null,
      sourceLine: index + 1,
      sourceExcerpt: line.trim(),
      tags: parsed.tags || []
    });
  });

  return reminders;
}

function parseReminderLine(line, engineCfg) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;

  const includeAll = engineCfg.includeAllLines === true;
  const checklist = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
  const bullet = trimmed.match(/^[-*]\s+(.+)$/);
  const reminderPrefix = trimmed.match(/^(?:reminder|remind me|todo|task|follow up|follow-up)\s*:?\s+(.+)$/i);
  const tagged = /#reminder\b|#todo\b|#task\b/i.test(trimmed);

  if (!includeAll && !checklist && !reminderPrefix && !tagged) return null;

  let text = checklist ? checklist[2] : (reminderPrefix ? reminderPrefix[1] : (bullet ? bullet[1] : trimmed));
  const status = checklist && checklist[1].toLowerCase() === 'x' ? 'done' : 'open';
  const dateInfo = extractDates(text);
  const priority = extractPriority(text);
  text = removePriorityAnnotations(removeDateAnnotations(text))
    .replace(/\s+#[A-Za-z0-9_-]+\b/g, '')
    .trim();

  return {
    text,
    status,
    reminderDate: dateInfo.reminderDate,
    dueDate: dateInfo.dueDate,
    priority,
    tags: extractTags(trimmed)
  };
}

function extractDates(text) {
  const reminderMatch = text.match(/\b(?:reminderDate|remind(?:er)?|remindAt|date)\s*[:=]\s*([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2})?(?:Z|[+-][0-9]{2}:?[0-9]{2})?)?)/i);
  const dueMatch = text.match(/\b(?:dueDate|due|deadline)\s*[:=]\s*([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2})?(?:Z|[+-][0-9]{2}:?[0-9]{2})?)?)/i);
  const bracketDate = text.match(/\[([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2})?(?:Z|[+-][0-9]{2}:?[0-9]{2})?)?)\]/);

  return {
    reminderDate: reminderMatch?.[1] || bracketDate?.[1] || null,
    dueDate: dueMatch?.[1] || null
  };
}

function removeDateAnnotations(text) {
  return text
    .replace(/\b(?:reminderDate|remind(?:er)?|remindAt|date)\s*[:=]\s*[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2})?(?:Z|[+-][0-9]{2}:?[0-9]{2})?)?/ig, '')
    .replace(/\b(?:dueDate|due|deadline)\s*[:=]\s*[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2})?(?:Z|[+-][0-9]{2}:?[0-9]{2})?)?/ig, '')
    .replace(/\[[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2})?(?:Z|[+-][0-9]{2}:?[0-9]{2})?)?\]/g, '')
    .replace(/\s{2,}/g, ' ');
}

function looksLikeReminderSource(item, doc, engineCfg) {
  const names = [
    item.name,
    item.sourceName,
    item.type,
    doc.filename,
    doc.filePath
  ].filter(Boolean).map(v => String(v).toLowerCase());
  const patterns = normalizeList(engineCfg.match || engineCfg.matches || ['reminder', 'reminders']);
  return names.some(name => patterns.some(pattern => name.includes(pattern.toLowerCase())));
}

function firstString(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const key of keys) {
    const value = obj[key];
    if (value === undefined || value === null) continue;
    const str = String(value).trim();
    if (str) return str;
  }
  return '';
}

function extractPriority(text) {
  const match = String(text || '').match(/\b(priority|p)\s*[:=]\s*(high|medium|low|[1-5])\b/i);
  return match ? match[2].toLowerCase() : null;
}

function removePriorityAnnotations(text) {
  return String(text || '')
    .replace(/\b(?:priority|p)\s*[:=]\s*(?:high|medium|low|[1-5])\b/ig, '')
    .replace(/\s{2,}/g, ' ');
}

function extractTags(text) {
  const tags = [];
  for (const match of String(text || '').matchAll(/#([A-Za-z0-9_-]+)/g)) {
    tags.push(match[1]);
  }
  return tags;
}

function normalizeDateValue(value) {
  if (!value) return null;
  const str = String(value).trim();
  const ms = Date.parse(str);
  if (!Number.isFinite(ms)) return str;
  return new Date(ms).toISOString();
}

function stableId(source, index, text, reminderDate, dueDate) {
  const seed = [
    source.filePath || source.filename || 'source',
    index,
    text || '',
    reminderDate || '',
    dueDate || ''
  ].join('|');
  return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16);
}

function parseJson(content) {
  const trimmed = String(content || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function resolveProjectPath(projectRoot, value) {
  return resolveConfigPath(projectRoot, value);
}

function existsFile(filePath) {
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}

function readText(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return ''; }
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeList(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}
