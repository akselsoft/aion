const fs = require('fs');
const path = require('path');
const artifactLoader = require('./artifact');

module.exports = async function sharedFilesLoader(projectRoot, src) {
    const sharedPath = path.join(projectRoot, 'shared');

    if (!fs.existsSync(sharedPath)) {
        console.warn(`⚠️ Shared folder not found: ${sharedPath}`);
        return [];
    }

    const subdirs = fs.readdirSync(sharedPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

    const result = [];

    for (const folderName of subdirs) {
        const location = path.join('shared', folderName); // relative to project root

        const virtualSrc = {
            type: 'artifact',
            name: folderName,
            location
        };
        console.log(folderName, location)
        try {
            const sourceBlock = await artifactLoader(projectRoot, virtualSrc);

            // Validate structure
            if (sourceBlock && Array.isArray(sourceBlock.documents)) {
                result.push(sourceBlock);
            } else {
                console.warn(`⚠️ Shared source "${folderName}" returned invalid structure.`);
            }
        } catch (err) {
            console.warn(`❌ Failed to load shared artifact "${folderName}": ${err.message}`);
        }
    }

    return result;
};