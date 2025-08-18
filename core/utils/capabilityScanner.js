const fs = require('fs');
const path = require('path');

function getImplementationFolders() {
    const implPath = path.resolve(__dirname, '../../implementations');
    return fs.readdirSync(implPath).filter(f => {
        const fullPath = path.join(implPath, f, 'run.js');
        return fs.existsSync(fullPath);
    });
}

function scanCapabilities() {
    const implementations = getImplementationFolders();
    const summary = [];

    for (const impl of implementations) {
        const implPath = path.resolve(__dirname, '../../implementations', impl, 'run.js');
        try {
            const { meta } = require(implPath);
            summary.push({
                implementation: impl,
                tier: meta?.tier || 'free',
                character: meta?.character || null,
                capabilities: meta?.capabilities || [],
            });
        } catch (err) {
            summary.push({
                implementation: impl,
                error: `Failed to load: ${err.message}`
            });
        }
    }

    return summary;
}

module.exports = {
    scanCapabilities
};