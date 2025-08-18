const fs = require('fs/promises');
const path = require('path');
let folderPath;
async function readFilesRecursively(folder) {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(folder, entry.name);
        if (entry.isDirectory()) {
            const nestedFiles = await readFilesRecursively(fullPath);
            files.push(...nestedFiles);
        } else if (entry.name.endsWith('.md') || entry.name.endsWith('.txt')) {
            const isTopLevelHelper = fullPath === path.join(folder, 'helper.md');
            if (!isTopLevelHelper || folder !== folderPath) {
                files.push(fullPath); // include subfolder helper.md
            }
        }
    }

    return files;
}

module.exports = async function loadArtifactSource(projectRoot, sourceConfig) {
    folderPath = path.join(projectRoot, sourceConfig.location); // set it here
    const files = await fs.readdir(folderPath);

    let promptText = sourceConfig.prompt?.base || '';
    if (files.includes('helper.md')) {
        promptText = await fs.readFile(path.join(folderPath, 'helper.md'), 'utf-8');
    }

    let filePaths;

    if (sourceConfig.recurse) {
        filePaths = await readFilesRecursively(folderPath);
    } else {
        const entries = await fs.readdir(folderPath);
        filePaths = entries
            .filter(file => (file.endsWith('.md') || file.endsWith('.txt')) && file !== 'helper.md')
            .map(file => path.join(folderPath, file));
    }

    const documents = [];

    for (const filePath of filePaths) {
        const content = await fs.readFile(filePath, 'utf-8');
        documents.push({
            filename: path.relative(folderPath, filePath),
            content
        });
    }

    return {
        name: sourceConfig.name || path.basename(sourceConfig.location),
        type: sourceConfig.type || 'artifact',
        prompt: promptText,
        documents
    };
};