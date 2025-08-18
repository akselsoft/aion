const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { logInfo } = require('../utils/logger');

module.exports = async function wikipediaLoader(projectRoot, sourceConfig) {
    const url = sourceConfig.config?.url;
    const copyToArtifacts = sourceConfig.config?.copyToArtifacts;

    if (!url) throw new Error('No URL provided in wikipedia source config.');

    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    // 🎯 Target only Wikipedia's article content
    const contentDiv = $('#mw-content-text');
    const text = contentDiv.text().replace(/\s+/g, ' ').trim();

    if (copyToArtifacts) {
        const artifactFolder = path.join(projectRoot, 'shared', 'artifacts', sourceConfig.name || 'wiki');
        const rawPath = path.join(artifactFolder, 'wiki-raw.html');

        fs.mkdirSync(artifactFolder, { recursive: true });
        fs.writeFileSync(rawPath, contentDiv.html(), 'utf-8');
        logInfo(`📘 Saved Wikipedia HTML from ${url} to ${path.relative(projectRoot, rawPath)}`);
    }
    const textPath = path.join(projectRoot, 'outputs', 'wikipedia-cleaned.txt');
    fs.mkdirSync(path.dirname(textPath), { recursive: true });
    fs.writeFileSync(textPath, text, 'utf-8');

    return {
        name: sourceConfig.name,
        type: sourceConfig.type,
        prompt: `This content was extracted from the Wikipedia article at:\n${url}`,
        documents: [
            {
                filename: 'wikipedia.txt',
                content: text,
            },
        ],
    };
};