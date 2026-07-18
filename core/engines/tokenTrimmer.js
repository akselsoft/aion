// File: core/engines/tokenTrimmer.js
let enc;
try {
    const { encoding_for_model } = require('@dqbd/tiktoken');
    enc = encoding_for_model('gpt-4');
} catch (err) {
    console.warn('⚠️ tokenTrimmer: @dqbd/tiktoken not available, falling back to rough char-based counts');
}

function countTokens(text) {
    if (enc) {
        try { return enc.encode(text || '').length; } catch (_) { /* continue to fallback */ }
    }
    // Fallback: assume ~4 chars per token (rough)
    return Math.ceil((text || '').length / 4);
}

function sliceTokens(text, maxTokens) {
    if (enc) {
        try {
            const tokens = enc.encode(text || '');
            const decoded = enc.decode(tokens.slice(0, maxTokens));
            if (typeof decoded === 'string') return decoded;
            if (decoded && typeof decoded === 'object') {
                return Buffer.from(decoded).toString('utf8');
            }
            return String(decoded || '');
        } catch (_) { /* fallback */ }
    }
    const chars = Math.max(0, Math.floor(maxTokens * 4));
    return (text || '').slice(0, chars);
}

function decodeHtmlEntities(text) {
    return String(text || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&#x27;/gi, "'")
        .replace(/&#x2F;/gi, '/')
        .replace(/&#(\d+);/g, (_, code) => {
            const value = Number(code);
            return Number.isFinite(value) ? String.fromCharCode(value) : '';
        });
}

function stripHtml(text) {
    return String(text || '')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
        .replace(/<li[^>]*>/gi, '- ')
        .replace(/<[^>]+>/g, ' ');
}

function sanitizeText(text, options = {}) {
    if (text === null || text === undefined) return '';

    const {
        stripHtml: shouldStripHtml = false,
        collapseWhitespace = true,
        decodeEntities = true,
        maxStringLength
    } = options;

    let value = String(text);
    if (shouldStripHtml) value = stripHtml(value);
    if (decodeEntities) value = decodeHtmlEntities(value);
    if (collapseWhitespace) {
        value = value
            .replace(/\r/g, '')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]{2,}/g, ' ')
            .trim();
    }

    if (Number.isFinite(maxStringLength) && maxStringLength > 0 && value.length > maxStringLength) {
        value = value.slice(0, maxStringLength).trimEnd() + '...';
    }

    return value;
}

function trimStructuredData(value, options = {}) {
    if (Array.isArray(value)) {
        return value.map(item => trimStructuredData(item, options));
    }

    if (value && typeof value === 'object') {
        const trimmed = {};
        const pruneKeys = new Set((options.pruneKeys || []).map(key => String(key)));
        for (const [key, entry] of Object.entries(value)) {
            if (pruneKeys.has(key)) continue;
            trimmed[key] = trimStructuredData(entry, options);
        }
        return trimmed;
    }

    if (typeof value === 'string') {
        return sanitizeText(value, options);
    }

    return value;
}

async function tokenTrimmerEngine(sections, config, projectRoot) {
    const maxTotalTokens = config.tokenReducer?.maxTokens || 7500;
    const trimOptions = config.tokenReducer || {};

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
                d => `${d.filename}\n\n${sanitizeText(d.content || '', trimOptions)}`
            ).join('\n\n');
        } else {
            section.content = sanitizeText(section.content || '', trimOptions);
        }

        const tokenCount = countTokens(section.content || '');

        if (totalTokens + tokenCount <= maxTotalTokens) {
            trimmed.push(section);
            totalTokens += tokenCount;
        } else {
            // Trim to remaining budget (if any)
            const remaining = maxTotalTokens - totalTokens;
            if (remaining > 50) {
                const slicedContent = sliceTokens(section.content || '', remaining);
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
module.exports.countTokens = countTokens;
module.exports.sliceTokens = sliceTokens;
module.exports.sanitizeText = sanitizeText;
module.exports.trimStructuredData = trimStructuredData;
