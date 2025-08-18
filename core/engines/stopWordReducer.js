const defaultStopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'if', 'in', 'on', 'with', 'as', 'of', 'at',
    'by', 'for', 'to', 'from', 'up', 'down', 'out', 'over', 'under', 'again', 'further',
    'then', 'once', 'here', 'there', 'all', 'any', 'both', 'each', 'few', 'more', 'most',
    'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very'
]);

async function stopWordReducerEngine(data, config) {
    const customStopWords = new Set(config.stopWords || []);
    const stopWords = new Set([...defaultStopWords, ...customStopWords]);

    for (const section of data) {
        if (section.documents && Array.isArray(section.documents)) {
            section.documents = section.documents.map(doc => {
                const words = doc.content.split(/\s+/);
                const filtered = words.filter(word => !stopWords.has(word.toLowerCase()));
                return {
                    ...doc,
                    content: filtered.join(' ')
                };
            });
        }
    }

    return data;
}

module.exports = stopWordReducerEngine;