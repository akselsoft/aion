const path = require('path');

async function loadImplementation(config) {
  if (!config) throw new Error('config is required');
  const name = config.persona;

  const responders = (config.params && config.params.responders) || [];
  const naOnly = responders.length === 1 && responders[0] === 'notAuthorized';

  const implPath = naOnly
    ? path.resolve(__dirname, '../impl/builtin/notAuthorized.js')
    : path.resolve(process.cwd(), `implementations/${name}/index.js`);

  const impl = require(implPath);
  if (typeof impl.init === 'function') {
    await impl.init(config);
  } else {
    impl.__activeConfig = config;
    impl.getConfig = () => impl.__activeConfig;
  }
  if (typeof impl.run !== 'function') {
    throw new Error(`implementation for "${name || 'unknown'}" missing run()`);
  }
  return impl;
}

module.exports = { loadImplementation };

