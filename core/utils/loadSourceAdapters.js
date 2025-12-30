const path = require('path');
// Fix case-sensitive import to match actual folder name
const { getCoreLoader } = require('../sourceadapters');

// Custom loader resolution — implementation-specific
function getCustomLoader(projectRoot, type) {
    try {
        const implPath = path.join(projectRoot, 'sourceAdapters', `${type}.js`);
        return require(implPath);
    } catch (err) {
        return null;
    }
}

async function loadSourceAdapters(projectRoot, sources = []) {
    const adapters = [];

    for (const src of sources) {
        const loader = getCoreLoader(src.type) || getCustomLoader(projectRoot, src.type);

        if (!loader) {
            console.warn(`⚠️ No loader found for source type "${src.type}"`);
            continue;
        }
        if (src.enabled === false) {
            console.log(`⚙️  Skipping disabled source: ${src.name || src.type}`);
            continue;
        }

        const adapter = await loader(projectRoot, src);

        if (Array.isArray(adapter)) {
            adapters.push(...adapter);
        } else if (adapter) {
            adapters.push(adapter);
        }

    }

    return adapters;
}

module.exports = { loadSourceAdapters };
