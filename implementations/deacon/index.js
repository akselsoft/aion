// Persona-aware Deacon implementation.
// If persona params include collectors/interpreters/responders, run the new pipeline style.
// Otherwise, fall back to the legacy Deacon runner.
const impl = require('./run');
const { runEngine } = require('../../lib/core/engineRunner');

let config = {};

module.exports = {
  async init(finalConfig) { config = finalConfig || {}; },
  async run() {
    const p = config.params;
    if (p && (p.collectors || p.interpreters || p.responders)) {
      const ctx = { passedFiles: [] };
      for (const c of p.collectors || []) {
        if (c.enabled === false) continue;
        await runEngine(ctx, c, config);
      }
      for (const i of p.interpreters || []) {
        if (i.enabled === false) continue;
        await runEngine(ctx, i, config);
      }
      for (const r of p.responders || []) {
        if (r.enabled === false) continue;
        await runEngine(ctx, r, config);
      }
      return;
    }

    // Legacy execution path
    const projectRoot = config.__projectRoot || process.cwd();
    const overrides = config.overrides || {};
    await impl.runEngine(projectRoot, overrides);
  }
};
