let cfg = {};

module.exports = {
  async init(config) { cfg = config || {}; },
  async run() {
    const msg = cfg?.__license?.reason || 'Not authorized';
    const code = cfg?.__license?.code || 'LICENSE_DENIED';
    console.error(`[${code}] ${msg}`);
  }
};

