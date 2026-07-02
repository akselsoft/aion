const path = require('path');

function resolveConfiguredPath(projectRoot, value, fallback) {
    const raw = value || fallback;
    if (!raw) return projectRoot;

    const text = String(raw);
    if (text === '~') return process.env.HOME || projectRoot;
    if (text.startsWith('~/')) {
        return path.join(process.env.HOME || projectRoot, text.slice(2));
    }
    if (path.isAbsolute(text)) return text;
    return path.join(projectRoot, text);
}

function getOutputDir(projectRoot, config = {}) {
    return resolveConfiguredPath(projectRoot, config.output, 'outputs');
}

function getHistoryDir(projectRoot, config = {}) {
    if (config.historyOutput || config.historyDir) {
        return resolveConfiguredPath(projectRoot, config.historyOutput || config.historyDir);
    }
    if (config.output) {
        return path.join(getOutputDir(projectRoot, config), 'history');
    }
    return path.join(projectRoot, 'history');
}

module.exports = {
    getHistoryDir,
    getOutputDir,
    resolveConfiguredPath
};
