// deacon/run.js

const path = require('path');
const { loadProjectConfig } = require('../../core/utils/loadProjectConfig');
const { runEngines } = require('../../core/engineRunner');
const { loadSourceAdapters } = require('../../core/utils/loadSourceAdapters');

// Azure-specific helpers
const {
    getCurrentIteration,
    getCapacityForIteration,
    saveAllIterationsToFile
} = require('./libs/azureIteration');

const fs = require('fs');
const { getCoreLoader } = require('../../core/sourceAdapters');

function getDeaconLoader(type) {
    try {
        const deaconPath = path.join(__dirname, 'sourceAdapters', `${type}.js`);
        if (fs.existsSync(deaconPath)) {
            return require(deaconPath);
        }
    } catch (err) {
        console.warn(`❌ [deacon] Error loading Deacon loader for "${type}":`, err.message);
    }
    return null;
}

async function loadDeaconSourceAdapters(projectRoot, sources = [], fullConfig = {}) {
    const adapters = [];
    console.log(`🔍 [deacon] Loading source adapters...`);

    for (const src of sources) {
        if (src.enabled === false) {
            console.log(`⚙️  Skipping disabled source: ${src.name || src.type}`);
            continue;
        }
        console.log(`🔌 Loading source adapter: ${src.name || src.type}`);

        const loader =
            getCoreLoader(src.type) ||
            getDeaconLoader(src.type);

        if (!loader) {
            console.warn(`⚠️ No loader found for source type "${src.type}"`);
            continue;
        }

        const adapter = await loader(projectRoot, src, fullConfig);

        if (Array.isArray(adapter)) {
            adapters.push(...adapter);
        } else if (adapter) {
            adapters.push(adapter);
        }
        // adapters.push(adapter);
    }

    return adapters;
}

async function runEngine(projectRoot, overrides = {}) {
    try {
        // Step 1: Load config
        const config = await loadProjectConfig(projectRoot);
        // Apply overrides like { iteration: 'Iteration 85' }
        for (const [key, value] of Object.entries(overrides)) {
            const jsonString = JSON.stringify(config);
            const replaced = jsonString.replaceAll(`\${${key}}`, value);
            Object.assign(config, JSON.parse(replaced));
        }
        console.log(`🔧 [deacon] Loaded project config from ${projectRoot}/config.json`);

        // Step 2: Optional Azure setup
        const deaconOutDir = path.join(projectRoot, 'outputs', 'deacon');
        fs.mkdirSync(deaconOutDir, { recursive: true });

        console.log(`🌐 [deacon] Fetching Azure Iteration metadata...`);
        await saveAllIterationsToFile(path.join(deaconOutDir, 'allIterations.json'));

        const currentIteration = await getCurrentIteration();
        const capacity = await getCapacityForIteration(currentIteration.id);
        fs.writeFileSync(
            path.join(deaconOutDir, 'capacity.json'),
            JSON.stringify(capacity, null, 2),
            'utf-8'
        );
        console.log(`📊 [deacon] Saved capacity data for current iteration.`);

        // Step 3: Load sources
        const sources = await loadDeaconSourceAdapters(projectRoot, config.sources || [], config);
        console.log(`📚 [deacon] Loaded ${sources.length} source(s)`);
        sources.forEach(source => {
            const docCount = Array.isArray(source.documents) ? source.documents.length : 0;
            console.log(`- ${source.name || 'Unnamed Source'}: ${docCount} document${docCount === 1 ? '' : 's'}`);

        });

        // Step 4: Run engines
        const engineList = config.engines || [];
        const results = await runEngines(engineList, sources, config, projectRoot);
        console.log(`✅ [deacon] Engine pipeline completed`);

        return results;

    } catch (err) {
        console.error(`❌ [deacon] Error running pipeline:`, err.message);
        throw err;
    }
}

module.exports = {
    runEngine,
    meta: {
        tier: 'premium',
        character: 'deacon',
        capabilities: [
            'devops.summary',
            'devops.capacity',
            'slack.pull',
            'copy.to.artifacts'
        ]
    }
};