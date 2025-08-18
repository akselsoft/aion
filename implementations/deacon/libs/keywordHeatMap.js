function extractKeywordsWithPhrases(title, config) {
    const stopwords = new Set(config.stopwords || []);
    const phrases = config.keywordPhrases || [];

    const normalized = title.toLowerCase().replace(/[^\w\s]/g, '');
    const matchedPhrases = [];

    // Match full phrases
    for (const phrase of phrases) {
        if (normalized.includes(phrase)) {
            matchedPhrases.push(phrase);
        }
    }

    // Remove matched phrases from title string
    let cleaned = normalized;
    for (const phrase of matchedPhrases) {
        cleaned = cleaned.replace(new RegExp(phrase, 'g'), '');
    }

    const soloWords = cleaned
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopwords.has(w));

    return [...matchedPhrases, ...soloWords];
}

function generateTitleKeywordMap(workItems, config) {
    const titleHeatMap = {};
    const excludedTypes = new Set(config.excludeWorkItemTypes || []);
    const minThreshold = config.minCountThreshold || 1;

    for (const item of workItems) {
        const type = item.fields?.['System.WorkItemType'] || '';
        if (excludedTypes.has(type)) continue;

        const title = item.fields?.['System.Title'] || '';
        const keywords = extractKeywordsWithPhrases(title, config);

        for (const word of keywords) {
            titleHeatMap[word] = (titleHeatMap[word] || 0) + 1;
        }
    }

    return Object.entries(titleHeatMap)
        .filter(([_, count]) => count >= minThreshold)
        .map(([word, count]) => ({ word, count }))
        .sort((a, b) => b.count - a.count);
}

module.exports = {
    generateTitleKeywordMap
};