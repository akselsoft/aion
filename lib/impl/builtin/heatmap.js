const path = require('path');
const heatmapEngine = require('../../../core/engines/heatmap');

module.exports = {
  async run(ctx, engineCfg, personaCfg) {
    const projectRoot = personaCfg.__projectRoot || process.cwd();

    // Convert passedFiles into sections the core heatmap engine expects
    const sections = (ctx.passedFiles || []).map(item => ({
      name: item.name || item.type || 'section',
      type: item.type || 'section',
      documents: (item.documents || []).map(d => ({
        filename: d.filename || 'doc',
        content: d.content || ''
      }))
    }));

    const outSections = await heatmapEngine(sections, personaCfg, projectRoot);
    const first = Array.isArray(outSections) ? outSections[0] : null;
    if (!first) return;

    const newItem = {
      name: engineCfg.name || 'Keyword Heatmap',
      type: 'Heatmap',
      content: md,
      documents: (first.documents || []).map(d => ({
        filename: d.filename,
        filetype: (d.filename || '').toLowerCase().endsWith('.json') ? 'json' : 'md',
        content: d.content
      }))
    };

    if (engineCfg.replace === true) {
      ctx.passedFiles.length = 0;
      ctx.passedFiles.push(newItem);
    } else {
      ctx.passedFiles.push(newItem);
    }
  }
};
