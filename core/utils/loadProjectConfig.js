// core/utils/loadProjectConfig.js
const fs = require('fs').promises;
const path = require('path');

async function loadProjectConfig(projectRoot, configPathOverride) {
    if (typeof projectRoot !== 'string') {
        throw new Error(`Invalid projectRoot: expected string, got ${typeof projectRoot}`);
    }
    const configPath = configPathOverride
        ? path.resolve(configPathOverride)
        : path.join(projectRoot, 'config.json');
    const raw = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(raw);
}

module.exports = { loadProjectConfig };
