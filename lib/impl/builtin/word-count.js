module.exports = {
  async run(ctx, engineCfg) {
    const inputType = engineCfg.inputType;
    const outputType = engineCfg.outputType || 'word-count';
    if (!inputType) throw new Error('word-count: inputType is required');

    const wordsPerPage = positiveNumber(engineCfg.wordsPerPage || engineCfg.pageWords, 250);
    const includeEmpty = engineCfg.includeEmpty === true;
    const itemNames = normalizeList(engineCfg.itemNames || engineCfg.items || engineCfg.names);
    const sourceNames = normalizeList(engineCfg.sourceNames || engineCfg.sources);

    const items = Array.isArray(ctx.passedFiles) ? ctx.passedFiles : [];
    const selected = items.filter(item => item.type === inputType && matchesItemFilters(item, itemNames, sourceNames));
    if (!selected.length) {
      console.warn(`⚠️ word-count skipped: no passedFiles with type="${inputType}".`);
      return;
    }

    const rows = [];
    for (const item of selected) {
      for (const doc of item.documents || []) {
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
  normalizeList,
  rowsToMarkdown
};
