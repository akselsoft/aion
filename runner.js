// deacon/runner.js
const fs = require('fs');
const { loadProjectConfig } = require('./core/utils/loadProjectConfig');
const { loadSourceAdapters } = require('./core/utils/loadSourceAdapters');
const { logInfo, logWarn, logError, logStep, logFile } = require('./core/utils/logger');
require('dotenv').config();

const path = require('path');

async function run(projectPath, overrides = {}) {
    try {
        logStep('Loading project configuration');
        const config = await loadProjectConfig(projectPath);
        logInfo(`Loaded config for project: ${config.name || 'Unnamed project'}`);

        logStep('Loading source adapters');
        const sources = await loadSourceAdapters(projectPath, config.sources || []);
        logInfo(`Loaded ${sources.length} source(s)`);

        for (const source of sources) {
            logStep(`Source: ${source.name}`);
            const promptStr = JSON.stringify(source.prompt || '');
            logInfo(`Prompt: ${promptStr.substring(0, 100)}...`);
            if (!Array.isArray(source.documents)) {
                console.error(`❌ Source "${source.name || 'unknown'}" is missing 'documents' array!`);
                console.dir(source, { depth: 2 });
                continue;
            }
            logInfo(`Documents: ${source.documents.length}`);
        }

        logStep('Preparing to invoke engine');
        const engineName = config.implementation;

        if (!engineName) {
            logWarn('No engine specified in config. Skipping processing.');
            return;
        }

        logInfo(`Using engine: ${engineName}`);

        const engineModulePath = path.resolve(__dirname, `./implementations/${engineName}/run.js`);
        if (!fs.existsSync(engineModulePath)) {
            logWarn(`❌ Implementation "${engineName}" not found. Skipping execution.`);
            return;
        }

        const implementationModule = require(engineModulePath);
        const implementationTier = implementationModule.meta?.tier || 'free';
        if (implementationTier === 'premium' && config.tier !== 'premium') {
            logWarn(`🔒 Implementation "${engineName}" requires premium access. Skipping.`);
            return;
        }

        const { runEngine } = implementationModule;
        const result = await runEngine(projectPath, overrides);
        logStep('Engine execution completed');
        return result;

    } catch (err) {
        logError(`Runner failed: ${err.message}`);
        throw err;
    }
}

// 🧠 Parse CLI args like: node runner.js ./project --iteration=85 --env=prod
const args = process.argv.slice(2);
const projectPath = args.find(arg => !arg.startsWith('--')) || './project';
const overrides = Object.fromEntries(
    args.filter(arg => arg.startsWith('--')).map(arg => {
        const [key, val] = arg.replace(/^--/, '').split('=');
        return [key, val];
    })
);

run(projectPath, overrides);