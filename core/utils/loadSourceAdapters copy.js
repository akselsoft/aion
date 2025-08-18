const fs = require('fs/promises');
const path = require('path');

// Loaders
const artifactLoader = require('./sourceAdapters/artifact');
const wikiLoader = require('./sourceAdapters/wiki');
// const slackLoader = require('./sourceAdapters/slack'); (future)

async function loadSourceAdapters(projectRoot, sources = []) {
    const adapters = [];

    for (const src of sources) {
        if (src.type === 'artifact' || src.type === 'prompts') {
            const artifactSource = await artifactLoader(projectRoot, src);
            adapters.push(artifactSource);

        } else if (src.type === 'wiki') {
            const wikiSource = await wikiLoader(projectRoot, src);
            adapters.push(wikiSource);

        } else {
            console.warn(`⚠️ Unknown or unsupported source type: ${src.type}`);
        }
    }

    return adapters;
}

module.exports = { loadSourceAdapters };