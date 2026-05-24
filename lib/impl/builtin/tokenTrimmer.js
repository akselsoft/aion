const tokenTrimmer = require('../../core/../../core/engines/tokenTrimmer');

module.exports = {
  async run(ctx, cfg, personaCfg) {
    const items = Array.isArray(ctx.passedFiles) ? ctx.passedFiles.slice() : [];
    // Convert passedFiles to sections with consolidated content
    const sections = items.map(item => ({
      name: item.name || item.type || 'section',
      type: item.type || 'section',
      content: (item.documents || [])
        .map(d => `${d.filename || d.name || ''}\n\n${d.content || ''}`)
        .join('\n\n')
    }));

    const trimmed = await tokenTrimmer(sections, personaCfg || {}, personaCfg?.__projectRoot || process.cwd());

    // Rehydrate ctx with trimmed content, preserving original item names/types where possible
    const out = trimmed.map((sec, i) => ({
      name: items[i]?.name || sec.name,
      type: items[i]?.type || sec.type || 'artifact',
      prompt: items[i]?.prompt || sec.prompt || '',
      documents: [{ filename: 'content.txt', filetype: 'txt', content: sec.content || '' }]
    }));

    if (cfg && cfg.replace === false) {
      ctx.passedFiles.push(...out);
    } else {
      ctx.passedFiles.length = 0;
      ctx.passedFiles.push(...out);
    }
  }
};
