// Wrapper persona-style implementation that delegates to existing deacon pipeline
const impl = require('./run');

let config = {};

module.exports = {
  async init(finalConfig) { config = finalConfig || {}; },
  async run() {
    const projectRoot = config.__projectRoot || process.cwd();
    // Allow overrides passed via persona config (e.g., { iteration: '85' })
    const overrides = config.overrides || {};
    await impl.runEngine(projectRoot, overrides);
  }
};

