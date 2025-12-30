const fs = require('fs/promises');
const path = require('path');
let folderPath;
async function readFilesRecursively(folder) {
    console.log('reading files in ' + folder);
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
    console.log('Loading artifact source from ' + folderPath);

    // Normalize prompt inputs
    const promptMode = (sourceConfig.prompt?.mode || sourceConfig.promptMode || 'replace').toLowerCase();
    const basePrompt = typeof sourceConfig.prompt === 'string'
        ? sourceConfig.prompt
        : (sourceConfig.prompt?.base || '');

    let helperPrompt = '';
    if (files.includes('helper.md')) {
        helperPrompt = await fs.readFile(path.join(folderPath, 'helper.md'), 'utf-8');
    }

    let promptText = '';
    if (promptMode === 'additive') {
        promptText = [basePrompt, helperPrompt].filter(Boolean).join('\n\n');
    } else if (promptMode === 'base') {
        promptText = basePrompt;
    } else if (promptMode === 'helper') {
        promptText = helperPrompt || basePrompt;
    } else { // default 'replace': helper takes precedence when present
        promptText = helperPrompt || basePrompt;
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

    const logFilePath = path.join(folderPath, 'artifact.log');
    const logData = await fs.readFile(logFilePath, 'utf-8').catch(() => '');
    const logEntries = logData.split('\n').filter(Boolean).map(line => {
        const [file, date] = line.split('|');
        return { file, date: new Date(date) };
    });

    console.log(`Log is ${JSON.stringify(logEntries, null, 2)}`);

    for (const filePath of filePaths) {
// log the file name and date of the file and put it into a file named artifact.log
// this file should be used to confirm that we are only reading NEW files
// so if a filepath is in the artifact.log file, it should only be "pushed" if it is newer than the date in the log
        const fileStat = await fs.stat(filePath);
        const fileModifiedDate = fileStat.mtime;

        console.log(`Checking ${filePath} against log entries with date time of ${fileModifiedDate.toISOString()}`);

        const isNewFile = !logEntries.some(entry => entry.file === filePath && entry.date >= fileModifiedDate);
        if (isNewFile) {
            console.log(`New file detected: ${filePath}`);
            await fs.appendFile(logFilePath, `${filePath}|${fileModifiedDate.toISOString()}\n`);
        
            const content = await fs.readFile(filePath, 'utf-8');
            documents.push({
                filename: path.relative(folderPath, filePath),
                content
            });
        }
    }

    return {
        name: sourceConfig.name || path.basename(sourceConfig.location),
        type: sourceConfig.type || 'artifact',
        prompt: promptText,
        documents
    };
};
