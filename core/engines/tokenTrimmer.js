// File: core/engines/tokenTrimmer.js
const { encoding_for_model } = require('@dqbd/tiktoken');

const enc = encoding_for_model('gpt-4');

async function tokenTrimmerEngine(sections, config, projectRoot) {
    const maxTotalTokens = config.tokenReducer?.maxTokens || 7500;

    // Sort sections if needed (optional enhancement)
    const sorted = [...sections].sort((a, b) => {
        const aScore = a.priority || 0;
        const bScore = b.priority || 0;
        return bScore - aScore; // higher priority first
    });

    const trimmed = [];
    let totalTokens = 0;

    for (const section of sorted) {

        if (!section.content && Array.isArray(section.documents)) {
            section.content = section.documents.map(
                d => `${d.filename}\n\n${d.content || ''}`
            ).join('\n\n');
        }

        const tokens = enc.encode(section.content || '');
        const tokenCount = tokens.length;

        if (totalTokens + tokenCount <= maxTotalTokens) {
            trimmed.push(section);
            totalTokens += tokenCount;
        } else {
            // Trim to remaining budget (if any)
            const remaining = maxTotalTokens - totalTokens;
            if (remaining > 50) {
                const slicedContent = enc.decode(tokens.slice(0, remaining));
                trimmed.push({
                    ...section,
                    content: slicedContent + '\n\n[✂️ Truncated]'
                });
                totalTokens = maxTotalTokens;
            } else {
                console.warn(`⛔ Skipped section "${section.name || 'Unnamed'}" — no room left`);
            }
            break; // stop processing once limit is hit
        }
    }

    return trimmed;
}

module.exports = tokenTrimmerEngine;