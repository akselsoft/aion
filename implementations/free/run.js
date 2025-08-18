// deacon/run.js

const path = require('path');
const { loadProjectConfig } = require('../../core/utils/loadProjectConfig');
const { runEngines } = require('../../core/engineRunner');
const { loadSourceAdapters } = require('../../core/utils/loadSourceAdapters');

async function runEngine(projectRoot) {
    try {
        // Step 1: Load config
        const config = await loadProjectConfig(projectRoot);
        console.log(`🔧 [deacon] Loaded project config from ${projectRoot}/config.json`);

        // Step 2: Load sources
        console.log(`📂 [deacon] Loading sources from ${projectRoot}`);
        const sources = await loadSourceAdapters(projectRoot, config.sources || []);
        console.log(`📚 [deacon] Loaded ${sources.length} source(s)`);
        // show me all my sources
        sources.forEach(source => {
            console.log(`- ${source.name}: ${source.documents.length} documents`);
        });

        // Step 3: Run engines
        console.log("deacon project root is:", projectRoot);
        // const results = await runEngines(config.engines || [], sources, config, projectRoot);
        const engineList = config.engines || [];
        const results = await runEngines(engineList, sources, config, projectRoot);
        console.log(`✅ [deacon] Engine pipeline completed`);

        // Step 4: Output
        // console.dir(results, { depth: null });
        return results;

    } catch (err) {
        console.error(`❌ [deacon] Error running pipeline:`, err.message);
        throw err;
    }
}

module.exports = {
    runEngine,
    meta: {
        tier: 'free',
        capabilities: ['artifact.reader']
    }
};