const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { logInfo } = require('../utils/logger');

module.exports = async function htmlLoader(projectRoot, sourceConfig) {
    const url = sourceConfig.config?.url;
    const copyToArtifacts = sourceConfig.config?.copyToArtifacts;

    if (!url) {
        throw new Error('No URL provided in wiki source config.');
    }

    const response = await axios.get(url);
    const html = response.data;

    // 🧹 Use cheerio to parse and extract text content
    const $ = cheerio.load(html);
    const text = $('body').text().replace(/\s+/g, ' ').trim(); // flatten whitespace

    // 🔽 Save full HTML if requested
    if (copyToArtifacts) {
        const htmlPath = path.join(projectRoot, 'shared', 'artifacts', 'projectNotes', 'wiki.html');
        fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
        fs.writeFileSync(htmlPath, html, 'utf-8');
        logInfo(`🌐 Copied full wiki HTML from ${url} into artifacts/projectNotes/wiki.html`);
    }

    // 📝 Log full text for review
    const textLogPath = path.join(projectRoot, 'outputs', 'html-cleaned.txt');
    fs.mkdirSync(path.dirname(textLogPath), { recursive: true });
    fs.writeFileSync(textLogPath, text, 'utf-8');

    return {
        name: sourceConfig.name,
        type: sourceConfig.type,
        prompt: `This content was extracted from the following URL:\n${url}`,
        documents: [
            {
                filename: 'wiki.txt',
                content: text,
            },
        ],
    };
};