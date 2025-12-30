const artifactLoader = require('./artifact');
const wikiLoader = require('./wiki'); // optional, example of a web loader
const summaryHistoryLoader = require('./summaryHistory'); // ✅ new line
const sharedFilesLoader = require('./sharedFiles'); // ✅ new
const documentsLoader = require('./documents');
const coreLoaders = {
    artifact: artifactLoader,
    prompts: artifactLoader,  // alias: treated same as 'artifact'
    wiki: wikiLoader,
    summaryHistory: summaryHistoryLoader,
    sharedFiles: sharedFilesLoader,
    documents: documentsLoader,
    office: documentsLoader // alias
};

/**
 * Retrieves a core loader function by type.
 * @param {string} type - The type of source loader (e.g., 'artifact', 'wiki').
 * @returns {function|null} The loader function, or null if not found.
 */
function getCoreLoader(type) {
    return coreLoaders[type] || null;
}

function listAvailableLoaders() {
    return Object.keys(coreLoaders);
}

module.exports = {
    getCoreLoader,
    listAvailableLoaders
};
