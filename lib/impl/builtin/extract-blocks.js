// extract-blocks.js
// Interpreter that trims artifacts to content between start/end delimiters.
// - Mutates matching passedFiles entries in place.
// - Can target specific passedFiles entries with itemNames/sourceNames.
// - Adds a JSON summary entry named "<inputType>-json".

function findBlocks(content, start, end, mode) {
  const blocks = [];
  let idx = 0;
  while (true) {
    const s = content.indexOf(start, idx);
    if (s === -1) break;
    const e = content.indexOf(end, s + start.length);
    if (e === -1) break;
    const block = content.slice(s + start.length, e);
    blocks.push(block.trim());
    idx = e + end.length;
    if (mode === 'first') break;
  }
  return blocks;
}

module.exports = {
  async run(ctx, engineCfg, personaCfg) {
    const inputType = engineCfg.inputType;
    if (!inputType) throw new Error('extract-blocks: inputType is required');
    const start = engineCfg.start;
    const end = engineCfg.end;
    if (!start || !end) throw new Error('extract-blocks: start and end delimiters are required');
    const mode = (engineCfg.mode || 'first').toLowerCase() === 'all' ? 'all' : 'first';
    const includeFilename = engineCfg.includeFilename !== false;
    const warnMissing = engineCfg.warnMissing === true;
    // When true, files that lack the delimiters are still passed through (with optional warning)
    const includeOnMissing = engineCfg.includeOnMissing === true;
    const itemNames = normalizeList(engineCfg.itemNames || engineCfg.items || engineCfg.names);
    const sourceNames = normalizeList(engineCfg.sourceNames || engineCfg.sources);

    const items = Array.isArray(ctx.passedFiles) ? ctx.passedFiles : [];
    const selected = items.filter(i => i.type === inputType && matchesItemFilters(i, itemNames, sourceNames));

    const jsonSummary = [];

    for (const item of selected) {
      const newDocs = [];
      for (const d of item.documents || []) {
        const content = d.content || '';
        const blocks = findBlocks(content, start, end, mode);
        if (!blocks.length) {
          if (warnMissing) {
            jsonSummary.push({
              file: d.filename || d.name || 'document',
              status: includeOnMissing ? 'missing delimiters (included full content)' : 'missing delimiters',
              blocks: []
            });
          }
          if (!includeOnMissing) continue; // legacy behavior: skip when missing

          const lines = [];
          if (includeFilename) lines.push(`### ${d.filename || d.name || 'document'}`, '');
          lines.push(content.trim());

          newDocs.push({
            filename: d.filename || d.name || 'document',
            content: lines.join('\n').trim()
          });
          continue;
        }

        jsonSummary.push({
          file: d.filename || d.name || 'document',
          blocks: blocks.map((b, idx) => ({ index: idx + 1, content: b }))
        });

        const lines = [];
        if (includeFilename) lines.push(`### ${d.filename || d.name || 'document'}`, '');
        blocks.forEach((b, idx) => {
          if (mode === 'all') lines.push(`**Block ${idx + 1}:**`, '');
          lines.push(b, '');
        });

        newDocs.push({
          filename: d.filename || d.name || 'document',
          content: lines.join('\n').trim()
        });
      }
      // Replace documents on the item (replace: true semantics)
      item.documents = newDocs;
    }

    if (jsonSummary.length) {
      ctx.passedFiles.push({
        name: `${inputType}-json`,
        type: `${inputType}-json`,
        documents: [{
          filename: `${inputType}-blocks.json`,
          filetype: 'json',
          content: JSON.stringify(jsonSummary, null, 2),
          json: jsonSummary
        }]
      });
    }
  }
};

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

module.exports._private = {
  findBlocks,
  matchesItemFilters,
  normalizeList
};
