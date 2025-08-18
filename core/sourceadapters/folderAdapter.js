const fs = require('fs');
const path = require('path');

async function folderAdapter(configEntry) {
    const folderPath = path.resolve(process.cwd(), configEntry.location);
    if (!fs.existsSync(folderPath)) {
        throw new Error(`Folder not found: ${folderPath}`);
    }

    // Use helper.md if it exists
    const helperPath = path.join(folderPath, 'helper.md');
    let prompt = configEntry.prompt?.base || '';
    if (fs.existsSync(helperPath)) {
        prompt = fs.readFileSync(helperPath, 'utf8');
    }

    // Read all .txt and .md files in the folder (excluding helper.md)
    const files = fs.readdirSync(folderPath).filter(f =>
        (f.endsWith('.txt') || f.endsWith('.md')) && f !== 'helper.md'
    );

    const content = files.map(filename => {
        const fullPath = path.join(folderPath, filename);
        return fs.readFileSync(fullPath, 'utf8');
    }).join('\n\n');

    return {
        name: configEntry.name,
        content,
        prompt,
        mode: configEntry.prompt?.mode || 'replace'
    };
}

module.exports = folderAdapter;
