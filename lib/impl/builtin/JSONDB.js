const fs = require('fs');
const path = require('path');
const { resolveConfigPath } = require('../../utils/paths');

module.exports = {
  async run(ctx, engineCfg, personaCfg) {
    const projectRoot = personaCfg.__projectRoot || process.cwd();
    const inputType = engineCfg.inputType || 'db-input';
    const items = Array.isArray(ctx.passedFiles) ? ctx.passedFiles : [];
    const selected = items.filter(item => item.type === inputType);

    if (!selected.length) {
      console.warn(`⚠️ JSONDB responder skipped: no passedFiles with type="${inputType}".`);
      return;
    }

    const records = selected
      .flatMap(extractContent)
      .flatMap(parseJsonRecords)
      .map(normalizeRecord)
      .filter(record => record.topic);

    if (!records.length) {
      console.warn(`⚠️ JSONDB responder skipped: no valid topic records found in type="${inputType}".`);
      return;
    }

    const currentPath = resolveOutputPath(projectRoot, engineCfg.currentFile || engineCfg.currentFilename || 'Current.json');
    const longTermPath = resolveOutputPath(projectRoot, engineCfg.longTermFile || engineCfg.longTermFilename || 'LongTerm.json');
    const peopleSummaryPath = engineCfg.peopleSummaryFile || engineCfg.peopleSummaryFilename
      ? resolveOutputPath(projectRoot, engineCfg.peopleSummaryFile || engineCfg.peopleSummaryFilename)
      : null;

    const current = mergeCurrent(readJsonFile(currentPath, []), records);
    const longTerm = mergeLongTerm(readJsonFile(longTermPath, []), records);

    writeJsonFile(currentPath, current);
    writeJsonFile(longTermPath, longTerm);
    if (peopleSummaryPath) {
      writeTextFile(peopleSummaryPath, buildPeopleSummary(longTerm));
      console.log(`🗃️ JSONDB wrote ${path.relative(projectRoot, peopleSummaryPath)}`);
    }

    console.log(`🗃️ JSONDB wrote ${path.relative(projectRoot, currentPath)}`);
    console.log(`🗃️ JSONDB wrote ${path.relative(projectRoot, longTermPath)}`);
  }
};

function extractContent(item) {
  const parts = [];
  if (typeof item.content === 'string') parts.push(item.content);
  if (typeof item.text === 'string') parts.push(item.text);
  for (const doc of item.documents || []) {
    if (typeof doc.content === 'string') parts.push(doc.content);
    if (typeof doc.text === 'string') parts.push(doc.text);
  }
  return parts.filter(part => String(part || '').trim());
}

function parseJsonRecords(content) {
  const parsed = parseJsonLoose(content);
  const values = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.records)
      ? parsed.records
      : Array.isArray(parsed?.topics)
        ? parsed.topics
        : Array.isArray(parsed?.items)
          ? parsed.items
          : parsed && typeof parsed === 'object'
            ? [parsed]
            : [];

  return values.filter(value => value && typeof value === 'object');
}

function parseJsonLoose(content) {
  const text = String(content || '').trim();
  const candidates = [
    extractFencedJson(text),
    text,
    extractJsonRange(text, '[', ']'),
    extractJsonRange(text, '{', '}')
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function extractFencedJson(text) {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match ? match[1].trim() : '';
}

function extractJsonRange(text, openChar, closeChar) {
  const start = text.indexOf(openChar);
  const end = text.lastIndexOf(closeChar);
  if (start < 0 || end <= start) return '';
  return text.slice(start, end + 1).trim();
}

function normalizeRecord(record) {
  const topic = asString(pick(record, ['topic', 'Topic']));
  const date = asString(pick(record, ['date', 'Date'])) || todayStamp();
  const summary = asString(pick(record, ['summary', 'Summary', 'highlight', 'Highlight']));
  const detail = asString(pick(record, [
    'detailSummary',
    'detail summary',
    'detail_summary',
    'detail',
    'Detail',
    'Detailed Summary',
    'detailedSummary'
  ]));

  return {
    topic,
    date,
    people: asStringArray(pick(record, ['people', 'People'])),
    summary,
    detail,
    actionItems: normalizeActionItems(pick(record, [
      'actionItems',
      'action items',
      'Action Items',
      'actions',
      'Actions'
    ])),
    priority: pick(record, ['priority', 'Priority']) ?? null,
    tier: pick(record, ['tier', 'Tier']) ?? null
  };
}

function pick(record, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  }
  return undefined;
}

function asString(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(asString).filter(Boolean).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).trim();
}

function asStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  const values = Array.isArray(value) ? value : String(value).split(/[,;]/);
  return values.map(asString).filter(Boolean);
}

function normalizeActionItems(value) {
  if (value === undefined || value === null || value === '') return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .map(item => {
      if (typeof item === 'string') return { action: item.trim() };
      if (item && typeof item === 'object') {
        return { action: asString(item.action || item.task || item.text || item.description) };
      }
      return { action: asString(item) };
    })
    .filter(item => item.action);
}

function mergeCurrent(existing, records) {
  const byTopic = new Map(normalizeCurrent(existing).map(entry => [entry.Topic, entry]));
  for (const record of records) {
    byTopic.set(record.topic, {
      Topic: record.topic,
      Date: record.date,
      Summary: record.summary,
      People: record.people,
      'Action Items': record.actionItems
    });
  }
  return [...byTopic.values()].sort((a, b) => a.Topic.localeCompare(b.Topic));
}

function normalizeCurrent(existing) {
  const values = Array.isArray(existing)
    ? existing
    : Array.isArray(existing?.topics)
      ? existing.topics
      : existing && typeof existing === 'object'
        ? Object.entries(existing).map(([topic, value]) => ({ Topic: topic, ...value }))
        : [];

  return values
    .map(entry => ({
      Topic: asString(entry.Topic || entry.topic),
      Date: asString(entry.Date || entry.date),
      Summary: asString(entry.Summary || entry.summary),
      People: asStringArray(entry.People || entry.people),
      'Action Items': normalizeActionItems(entry['Action Items'] || entry.actionItems || entry.actions)
    }))
    .filter(entry => entry.Topic);
}

function mergeLongTerm(existing, records) {
  const byTopic = new Map(normalizeLongTerm(existing).map(entry => [entry.Topic, entry]));
  for (const record of records) {
    const entry = byTopic.get(record.topic) || {
      Topic: record.topic,
      Priority: record.priority,
      Tier: record.tier,
      History: []
    };

    if (entry.Priority === null || entry.Priority === undefined) entry.Priority = record.priority;
    if (entry.Tier === null || entry.Tier === undefined) entry.Tier = record.tier;

    entry.History.push({
      Date: record.date,
      Highlight: record.summary,
      Detail: record.detail,
      People: record.people,
      'Action Items': record.actionItems
    });
    byTopic.set(record.topic, entry);
  }

  return [...byTopic.values()]
    .map(entry => ({
      ...entry,
      History: dedupeHistory(entry.History || [])
    }))
    .sort((a, b) => a.Topic.localeCompare(b.Topic));
}

function normalizeLongTerm(existing) {
  const values = Array.isArray(existing)
    ? existing
    : Array.isArray(existing?.topics)
      ? existing.topics
      : existing && typeof existing === 'object'
        ? Object.entries(existing).map(([topic, value]) => ({ Topic: topic, ...value }))
        : [];

  return values
    .map(entry => ({
      Topic: asString(entry.Topic || entry.topic),
      Priority: entry.Priority ?? entry.priority ?? null,
      Tier: entry.Tier ?? entry.tier ?? null,
      History: Array.isArray(entry.History)
        ? entry.History
        : Array.isArray(entry.history)
          ? entry.history
          : []
    }))
    .filter(entry => entry.Topic);
}

function dedupeHistory(history) {
  const seen = new Set();
  const out = [];
  for (const item of history) {
    const normalized = {
      Date: asString(item.Date || item.date),
      Highlight: asString(item.Highlight || item.highlight || item.Summary || item.summary),
      Detail: asString(item.Detail || item.detail),
      People: asStringArray(item.People || item.people),
      'Action Items': normalizeActionItems(item['Action Items'] || item.actionItems || item.actions)
    };
    const key = JSON.stringify([normalized.Date, normalized.Highlight, normalized.Detail]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function resolveOutputPath(projectRoot, configuredPath) {
  const value = configuredPath || '';
  if (value.startsWith('~') || path.isAbsolute(value)) return resolveConfigPath(projectRoot, value);
  return path.join(projectRoot, 'outputs', value);
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeTextFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
}

function buildPeopleSummary(longTerm, date = new Date()) {
  const people = collectPeopleMentions(longTerm);
  const lines = [
    '# People Contact Summary',
    '',
    `Updated: ${formatDate(date)}`,
    '',
    'This file is generated from Daily database records. It does not update PeopleRankings.md; it summarizes the latest dates each person appeared in daily inputs.',
    '',
    '| Person | Last Mentioned | Latest Context | Topic |',
    '|---|---|---|---|'
  ];

  for (const entry of people) {
    lines.push(`| ${escapeTable(entry.person)} | ${escapeTable(entry.date)} | ${escapeTable(entry.context)} | ${escapeTable(entry.topic)} |`);
  }

  if (!people.length) {
    lines.push('| _No people found_ |  |  |  |');
  }

  return `${lines.join('\n')}\n`;
}

function collectPeopleMentions(longTerm) {
  const mentions = new Map();
  for (const topicEntry of normalizeLongTerm(longTerm)) {
    for (const history of topicEntry.History || []) {
      const date = asString(history.Date || history.date);
      const people = asStringArray(history.People || history.people);
      for (const person of people) {
        const key = normalizePersonKey(person);
        if (!key) continue;
        const current = mentions.get(key);
        if (current && compareDateStrings(current.date, date) >= 0) continue;
        mentions.set(key, {
          person,
          date,
          context: asString(history.Highlight || history.highlight || history.Summary || history.summary),
          topic: topicEntry.Topic
        });
      }
    }
  }

  return [...mentions.values()].sort((a, b) => a.person.localeCompare(b.person));
}

function normalizePersonKey(person) {
  return asString(person).toLowerCase();
}

function compareDateStrings(a, b) {
  const aTime = Date.parse(a || '');
  const bTime = Date.parse(b || '');
  if (Number.isFinite(aTime) && Number.isFinite(bTime)) return aTime - bTime;
  return String(a || '').localeCompare(String(b || ''));
}

function escapeTable(value) {
  return asString(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

module.exports._private = {
  normalizeRecord,
  parseJsonRecords,
  mergeCurrent,
  mergeLongTerm,
  buildPeopleSummary,
  collectPeopleMentions
};
