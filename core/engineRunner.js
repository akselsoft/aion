const fs = require('fs');
const { logInfo, logFile, logWarn, logError, logStep } = require('./utils/logger');

function stripDataForDebug(items = []) {
    return (items || []).map(i => ({
        name: i.name,
        type: i.type,
        prompt: i.prompt,
        documents: (i.documents || []).map(d => ({
            filename: d.filename || d.name,
            filetype: d.filetype,
            content: d.content
        }))
    }));
}

function writeDebugSnapshot(config, projectRoot, stage, items) {
    if (!config?.debug) return;
    try {
        const path = require('path');
        const fs = require('fs');
        const outPath = path.join(projectRoot, 'outputs', 'passedFiles.json');
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        let log = [];
        if (fs.existsSync(outPath)) {
            log = JSON.parse(fs.readFileSync(outPath, 'utf-8') || '[]');
            if (!Array.isArray(log)) log = [];
        }
        log.push({
            stage,
            timestamp: new Date().toISOString(),
            items: stripDataForDebug(items)
        });
        fs.writeFileSync(outPath, JSON.stringify(log, null, 2), 'utf-8');
    } catch (err) {
        console.warn(`⚠️ Failed to write debug snapshot (${stage}): ${err.message}`);
    }
}

async function runEngines(engineList, data, config, projectRoot) {    // show me the entire config object
    console.log("Running engines with config:", config.engines);
    console.log("Engine project root:", projectRoot);
    console.log("Engine Data:", data.length);
    writeDebugSnapshot(config, projectRoot, 'start', data);
    const userTier = config.tier || 'free'; // e.g., 'free' or 'premium'

    for (const engine of engineList) {
        const path = require('path');
        const tryPaths = [
            path.resolve(__dirname, 'engines', `${engine}.js`),
            path.resolve(__dirname, '../implementations', config.implementation || 'default', 'engines', `${engine}.js`)
        ];
        // console.log(`Trying paths for engine "${engine}":`, tryPaths);
        let enginePath = tryPaths.find(p => fs.existsSync(p));
        if (!enginePath) {
            logWarn(`⚠️ Engine "${engine}" not found in any path. Skipping.`);
            continue;
        }

        // Dynamically require and execute each engine
        console.log(`Running engine: ${engine}`);
        // const engineFunc = require(path.resolve(__dirname, 'engines', engine));
        // const enginePath = path.resolve(__dirname, 'engines', engine);
        logInfo(`Loading engine from ${enginePath}`);
        const engineModule = require(enginePath);
        const engineFunc = engineModule.runEngine || engineModule; // Ensure we call runEngine if it exists

        // Check for meta (tier, character, etc.)
        const engineTier = engineModule.meta?.tier || 'free';
        const engineCharacter = engineModule.meta?.character || null;

        if (engineTier === 'premium' && userTier !== 'premium') {
            logWarn(`🔒 Engine "${engine}" requires premium access. Skipping.`);
            continue;
        }

        if (engineCharacter && userTier !== 'premium') {
            logWarn(`🔒 Engine "${engine}" includes character "${engineCharacter}" and requires premium access. Skipping.`);
            continue;
        }

        try {
            // data = await engineFunc(data, config, projectRoot);
            logInfo(`Running ${engine}`)

            let output = await engineFunc(data, config, projectRoot);

            // Normalize: convert single object to array if needed
            if (output && !Array.isArray(output)) {
                output = [output];
            }

            // Accumulate results across engines but only take unique entries
            if (!Array.isArray(data)) {
                data = [data];
            }
            // Merge new output into data, ensuring no duplicates
            const existingNames = new Set(data.map(d => d.name));
            if (!output) {
                logWarn(`⚠️ Engine "${engine}" returned no data.`);
                continue;
            }
            output = output.filter(o => !existingNames.has(o.name));
            if (output.length === 0) {
                logWarn(`⚠️ Engine "${engine}" returned no new data.`);
                continue;
            }
            // Append new output to data
            console.log(`✅ Engine "${engine}" returned ${output.length} new items.`);
            logInfo(`✅ Engine "${engine}" returned: ${output.map(o => o.name).join(', ')}`);
            data.push(...output);

            logFile(`✅ Engine returned: ${JSON.stringify(data, null, 2)}`);
            writeDebugSnapshot(config, projectRoot, `after:${engine}`, data);
        } catch (err) {
            logError(`❌ Engine "${engine}" failed: ${err.message} ${err.stack}`);
        }
        //data = await engineFunc(data, config);
    }
    return data;
}

// expose the runEngines function
module.exports = {
    runEngines
};
