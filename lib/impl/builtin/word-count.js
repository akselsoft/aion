const fs = require('fs');
const path = require('path');
const { resolveConfigPath } = require('../../utils/paths');

module.exports = {
  async run(ctx, engineCfg, personaCfg = {}) {
    const inputType = engineCfg.inputType;
    const outputType = engineCfg.outputType || 'word-count';
    if (!inputType) throw new Error('word-count: inputType is required');

    const wordsPerPage = positiveNumber(engineCfg.wordsPerPage || engineCfg.pageWords, 250);
    const includeEmpty = engineCfg.includeEmpty === true;
    const itemNames = normalizeList(engineCfg.itemNames || engineCfg.items || engineCfg.names);
    const sourceNames = normalizeList(engineCfg.sourceNames || engineCfg.sources);
    const ignorePatterns = normalizePatterns(
      engineCfg.ignore ||
      engineCfg.ignoreFiles ||
      engineCfg.ignoreFilenames ||
      engineCfg.ignorePatterns
    );

    const items = Array.isArray(ctx.passedFiles) ? ctx.passedFiles : [];
    const selected = items.filter(item => item.type === inputType && matchesItemFilters(item, itemNames, sourceNames));
    if (!selected.length) {
      console.warn(`⚠️ word-count skipped: no passedFiles with type="${inputType}".`);
      return;
    }

    let rows = [];
    for (const item of selected) {
      for (const doc of item.documents || []) {
        if (matchesIgnorePatterns(documentMatchValues(doc, item), ignorePatterns)) continue;
        const content = String(doc?.content || '');
        const wordcount = countWords(content);
        if (!includeEmpty && wordcount === 0) continue;
        rows.push({
          name: doc?.title || doc?.filename || doc?.name || item.name || item.type || 'document',
          wordcount,
          pagecount: estimatePages(wordcount, wordsPerPage),
          filename: doc?.filename || doc?.name || null,
          itemName: item.name || null,
          sourceName: item.sourceName || null
        });
      }
    }

    const persistPath = resolvePersistPath(engineCfg, personaCfg);
    if (persistPath && engineCfg.mergeExisting !== false) {
      rows = mergeRows(loadExistingRows(persistPath, wordsPerPage), rows, engineCfg);
    }
    rows = rows.filter(row => !matchesIgnorePatterns(rowMatchValues(row), ignorePatterns));

    if (persistPath) {
      fs.mkdirSync(path.dirname(persistPath), { recursive: true });
      fs.writeFileSync(persistPath, JSON.stringify(rows, null, 2) + '\n', 'utf-8');
      console.log(`[word-count] wrote ${persistPath}`);
    }

    ctx.passedFiles.push({
      name: engineCfg.name || outputType,
      type: outputType,
      prompt: engineCfg.prompt || '',
      documents: [{
        filename: `${outputType}.${engineCfg.format === 'json' ? 'json' : 'md'}`,
        filetype: engineCfg.format === 'json' ? 'json' : 'md',
        content: engineCfg.format === 'json' ? JSON.stringify(rows, null, 2) : rowsToMarkdown(rows, outputType),
        json: rows
      }]
    });
  }
};

function resolvePersistPath(engineCfg = {}, personaCfg = {}) {
  const value = engineCfg.persistJsonFile ||
    engineCfg.mergeFile ||
    engineCfg.stateFile ||
    engineCfg.outputFile ||
    (engineCfg.format === 'json' ? engineCfg.filename : null);
  if (!value) return null;

  const projectRoot = personaCfg.__projectRoot || process.cwd();
  return resolveConfigPath(projectRoot, value);
}

function loadExistingRows(filePath, wordsPerPage) {
  if (!filePath || !fs.existsSync(filePath)) return [];

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const rows = extractRows(parsed);
    return rows.map(row => normalizeExistingRow(row, wordsPerPage)).filter(Boolean);
  } catch (err) {
    console.warn(`[word-count] could not read existing counts from ${filePath}: ${err.message}`);
    return [];
  }
}

function extractRows(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.rows)) return parsed.rows;
  if (Array.isArray(parsed?.data)) return parsed.data;
  if (Array.isArray(parsed?.items)) return parsed.items;
  return [];
}

function normalizeExistingRow(row, wordsPerPage) {
  if (!row || typeof row !== 'object') return null;
  const wordcount = Number(row.wordcount ?? row.wordCount ?? row.words ?? 0);
  const name = row.name || row.filename || row.title;
  if (!name && !row.filename) return null;
  return {
    ...row,
    name: String(name),
    wordcount: Number.isFinite(wordcount) ? wordcount : 0,
    pagecount: Number.isFinite(Number(row.pagecount ?? row.pageCount))
      ? Number(row.pagecount ?? row.pageCount)
      : estimatePages(Number.isFinite(wordcount) ? wordcount : 0, wordsPerPage),
    filename: row.filename || row.name || null
  };
}

function mergeRows(existingRows, newRows, engineCfg = {}) {
  const keyField = engineCfg.mergeKey || engineCfg.keyField || 'filename';
  const map = new Map();
  const order = [];

  for (const row of existingRows || []) {
    const key = rowKey(row, keyField);
    if (!key) continue;
    if (!map.has(key)) order.push(key);
    map.set(key, row);
  }

  for (const row of newRows || []) {
    const key = rowKey(row, keyField);
    if (!key) continue;
    if (!map.has(key)) order.push(key);
    map.set(key, {
      ...map.get(key),
      ...row,
      updatedAt: new Date().toISOString()
    });
  }

  return sortRows(order.map(key => map.get(key)), engineCfg);
}

function sortRows(rows, engineCfg = {}) {
  if (engineCfg.sort === false || engineCfg.sortRows === false) return rows;
  const sortBy = engineCfg.sortBy || 'filename';
  return [...rows].sort((a, b) => {
    const left = String(a?.[sortBy] || a?.filename || a?.name || '').toLowerCase();
    const right = String(b?.[sortBy] || b?.filename || b?.name || '').toLowerCase();
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function normalizePatterns(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value])
    .map(pattern => String(pattern || '').trim())
    .filter(Boolean)
    .map(pattern => ({
      raw: pattern,
      regex: globToRegex(pattern.toLowerCase()),
      hasPathSeparator: /[\\/]/.test(pattern)
    }));
}

function globToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function matchesIgnorePatterns(values, patterns = []) {
  if (!patterns.length) return false;
  const normalized = values
    .map(value => String(value || '').replace(/\\/g, '/').toLowerCase())
    .filter(Boolean);

  for (const pattern of patterns) {
    for (const value of normalized) {
      const basename = path.basename(value);
      if (pattern.regex.test(value) || (!pattern.hasPathSeparator && pattern.regex.test(basename))) {
        return true;
      }
    }
  }
  return false;
}

function documentMatchValues(doc = {}, item = {}) {
  return [
    doc.path,
    doc.filename,
    doc.name,
    doc.title,
    item.name,
    item.sourceName
  ];
}

function rowMatchValues(row = {}) {
  return [
    row.path,
    row.filename,
    row.name,
    row.title,
    row.itemName,
    row.sourceName
  ];
}

function rowKey(row, keyField) {
  const primary = row?.[keyField];
  const fallback = row?.filename || row?.name;
  return String(primary || fallback || '').trim().toLowerCase();
}

function countWords(content) {
  const words = String(content || '').match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu);
  return words ? words.length : 0;
}

function estimatePages(wordcount, wordsPerPage) {
  if (wordcount <= 0) return 0;
  return Math.ceil(wordcount / wordsPerPage);
}

function positiveNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function matchesItemFilters(item, itemNames, sourceNames) {
  const hasItemFilter = itemNames.length > 0;
  const hasSourceFilter = sourceNames.length > 0;
  if (!hasItemFilter && !hasSourceFilter) return true;

  const itemName = String(item?.name || '').toLowerCase();
  const sourceName = String(item?.sourceName || '').toLowerCase();

  return (
    (hasItemFilter && itemNames.includes(itemName)) ||
    (hasSourceFilter && sourceNames.includes(sourceName))
  );
}

function normalizeList(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value])
    .map(v => String(v).trim().toLowerCase())
    .filter(Boolean);
}

function rowsToMarkdown(rows, title = 'word-count') {
  const totalWords = rows.reduce((sum, row) => sum + row.wordcount, 0);
  const totalPages = rows.reduce((sum, row) => sum + row.pagecount, 0);
  const lines = [
    `# ${title}`,
    '',
    '| Name | Words | Estimated Pages |',
    '|---|---:|---:|',
    ...rows.map(row => `| ${escapeTable(row.name)} | ${row.wordcount} | ${row.pagecount} |`),
    `| **Total** | **${totalWords}** | **${totalPages}** |`
  ];
  return `${lines.join('\n')}\n`;
}

function escapeTable(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

module.exports._private = {
  countWords,
  estimatePages,
  positiveNumber,
  matchesItemFilters,
  normalizePatterns,
  matchesIgnorePatterns,
  documentMatchValues,
  rowMatchValues,
  normalizeList,
  mergeRows,
  loadExistingRows,
  sortRows,
  rowsToMarkdown
};
