const fs = require('fs');
const path = require('path');

function loadPrompt(implementation) {
    const helperPath = path.resolve(__dirname, `../implementations/${implementation}/helper.md`);
    if (fs.existsSync(helperPath)) {
        return fs.readFileSync(helperPath, 'utf8');
    } else {
        return `You are an assistant named ${implementation}. Help the user with their tasks.`;
    }
}

module.exports = { loadPrompt };