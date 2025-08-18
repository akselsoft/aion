const fs = require('fs');
const path = require('path');

function loadImplementationConfig(implementation) {
    const basePath = path.resolve(__dirname, '../implementations/', implementation);
    const configPath = path.join(basePath, 'config.json');
    if (!fs.existsSync(configPath)) throw new Error(`Missing config for ${implementation}`);
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

module.exports = { loadImplementationConfig };