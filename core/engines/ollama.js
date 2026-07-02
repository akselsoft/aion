const fs = require('fs');
const path = require('path');
const { getHistoryDir, getOutputDir } = require('../utils/outputPaths');

// Ollama - local open-source inference server
// Default endpoint: http://localhost:11434
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

function generateSystemPrompt(config, prompts) {
    let systemPrompt = config.ollama?.systemPrompt || ``.trim();

    if (prompts.length > 0) {
        systemPrompt += `
${prompts.join('\n\n')}
`;
    }

    return systemPrompt;
}

function flattenSections(nodes, pathPrefix = []) {
    const out = [];
    for (const n of nodes || []) {
        const lineage = [...pathPrefix, n.name].filter(Boolean).join(' › ');
        out.push({
            ...n,
            name: lineage,
            documents: n.documents || [],
        });
        if (Array.isArray(n.children) && n.children.length) {
            out.push(...flattenSections(n.children, [...pathPrefix, n.name]));
        }
    }
    return out;
}

function generateFullInputAndPrompts(data, config) {
    const prompts = [];
    const seenPrompts = new Set();

    const allSections = flattenSections(data).map(section => {
        let prompt = section.prompt?.trim() || '';
        const inlinePrompt = prompt;
        prompt = '';

        const docs = section.documents
            ?.filter(d => d.content)
            .map(d => renderDocumentContent(d, config))
            .join('\n\n') || '';

        console.log(`📄 Section: ${section.name} - ${section.documents.length} documents - Prompt: ${prompt ? prompt : 'No prompt provided'}`);
        section.documents.forEach(doc => {
            console.log(`  - ${doc.filename || 'Unnamed document'} (${doc.content ? doc.content.length : 0} chars)`);
        });

        if (!prompt && !docs) return null;

        let sectionBlock = "### " + section.name + "\n\n";

        if (inlinePrompt) {
            sectionBlock += `**Prompt:** ${inlinePrompt}\n\n`;
        }

        sectionBlock += `\n${docs}\n\r`.trim();
        return sectionBlock + '\n\r';

    }).filter(Boolean);

    const postPrompt = config?.ollama?.prompts?.postPrompt?.trim() || '';

    const fullInput = [
        allSections.join('\n\n---\n\n').trim(),
        postPrompt ? `## Note to Interpreter: Rule of Thumb\n${postPrompt}\r` : ''
    ].filter(Boolean).join('\n\n');
    return { fullInput, prompts };
}

function renderDocumentContent(doc, config) {
    const content = renderDocumentBody(doc, config);
    if (doc?.showFileName !== true) return content;
    return [`---- File: ${doc.filename || doc.name || 'document'}`, content].filter(Boolean).join('\n\n');
}

function renderDocumentBody(doc, config) {
    const content = doc?.content || '';
    if (config?.ollama?.plaintext !== true) return content;

    const parsed = doc?.json !== undefined ? doc.json : parseJsonContent(content);
    if (parsed === null) return content;

    return jsonToPlaintext(parsed);
}

function parseJsonContent(content) {
    try {
        return JSON.parse(content);
    } catch {
        return null;
    }
}

function jsonToPlaintext(value, depth = 0) {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'object') return String(value);

    if (Array.isArray(value)) {
        return value.map(item => jsonToPlaintext(item, depth)).filter(Boolean).join('\n\n');
    }

    if (value.file && Array.isArray(value.blocks)) {
        const blocks = value.blocks.map(block => {
            const label = block.index ? `Block ${block.index}:` : 'Block:';
            return [label, jsonToPlaintext(block.content ?? block, depth + 1)].filter(Boolean).join('\n');
        });
        return [`### ${value.file}`, ...blocks].filter(Boolean).join('\n\n');
    }

    return Object.entries(value)
        .map(([key, child]) => {
            const rendered = jsonToPlaintext(child, depth + 1);
            if (!rendered) return `${key}:`;
            if (typeof child === 'object') return `${key}:\n${indent(rendered)}`;
            return `${key}: ${rendered}`;
        })
        .join('\n');
}

function indent(text) {
    return String(text).split('\n').map(line => line ? `  ${line}` : line).join('\n');
}

async function ollamaEngine(data, config, projectRoot) {
    const model = config.ollama?.model || 'mistral';
    const temperature = config.ollama?.temperature ?? 0.3;
    const numCtx = normalizePositiveInteger(config.ollama?.contextSize ?? config.ollama?.numCtx ?? config.ollama?.num_ctx);
    const writeInput = config.ollama?.writeInput !== true;
    const writeOutputs = config.ollama?.writeOutputs !== true;
    const inputFilename = config.ollama?.inputFilename || 'ollama-input.md';
    const summaryFilename = config.ollama?.summaryFilename || 'summary.md';
    const outputDir = getOutputDir(projectRoot, config);
    console.log(`project root is: ${projectRoot}`);
    console.log(`output dir is: ${outputDir}`);
    console.log(`will I write input? ${writeInput}` )

    const { fullInput, prompts } = generateFullInputAndPrompts(data, config);

    if (!fullInput) {
        console.warn('⚠️ No input provided to Ollama. Skipping summarization.');
        const debugPath = path.join(outputDir, 'logging.log');
        fs.mkdirSync(path.dirname(debugPath), { recursive: true });
        fs.writeFileSync(debugPath, '⚠️ No input provided to Ollama.\n\nData:\n' + JSON.stringify(data, null, 2), 'utf-8');
        return data;
    }

    const systemPrompt = generateSystemPrompt(config, prompts);
    const inputPath = path.join(outputDir, inputFilename);
    const estimatedTokens = normalizePositiveInteger(config.ollama?.estimatedTokens);
    const tokenSuffix = estimatedTokens ? ` (${estimatedTokens} estimated tokens)` : '';
    if (writeInput) {
        fs.mkdirSync(path.dirname(inputPath), { recursive: true });
        fs.writeFileSync(inputPath, systemPrompt + "\n\n" + fullInput, 'utf-8');
        console.log(`📝 Ollama input written to ${path.relative(projectRoot, inputPath)}${tokenSuffix}`);
    }

    try {
        console.log(`🚀 Sending to Ollama (model=${model}, temp=${temperature}, endpoint=${OLLAMA_BASE_URL})...`);
        const options = {
            temperature,
            ...(numCtx ? { num_ctx: numCtx } : {})
        };
        const requestBody = {
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: fullInput },
            ],
            options,
            stream: false
        };
        
fs.writeFileSync(inputPath + '.system.md', systemPrompt || '', 'utf-8');
fs.writeFileSync(inputPath + '.user.md', fullInput || '', 'utf-8');
fs.writeFileSync(inputPath + '.request.json', JSON.stringify(requestBody, null, 2), 'utf-8');        
        const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
        }

        const responseData = await response.json();
        console.log('✅ Received response from Ollama.');

        const result = responseData.message?.content?.trim() || null;

        if (result) {
            data.push({
                name: 'ollamaResult',
                type: 'synthesis',
                content: result,
                generatedBy: 'ollama',
            });

            if (writeOutputs) {
                const summaryPath = path.join(outputDir, summaryFilename);
                fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
                fs.writeFileSync(summaryPath, result, 'utf-8');
                console.log(`✅ Summary written to: ${summaryPath}`);

                const historyDir = getHistoryDir(projectRoot, config);
                fs.mkdirSync(historyDir, { recursive: true });

                const dateStr = new Date().toISOString().split('T')[0];
                const datedPath = path.join(historyDir, `${dateStr}.md`);
                const latestPath = path.join(historyDir, 'summary.md');

                fs.writeFileSync(datedPath, result, 'utf-8');
                fs.writeFileSync(latestPath, result, 'utf-8');

                console.log(`📚 Dated summary written to: ${datedPath}`);
                console.log(`📄 Latest summary copied to: ${latestPath}`);
            }
        }

        return data;
    } catch (err) {
        console.error(`❌ Ollama engine failed: ${err.message}`);
        if (err.cause) {
            const cause = err.cause;
            const details = [
                cause.code ? `code=${cause.code}` : null,
                cause.errno ? `errno=${cause.errno}` : null,
                cause.syscall ? `syscall=${cause.syscall}` : null,
                cause.address ? `address=${cause.address}` : null,
                cause.port ? `port=${cause.port}` : null,
                cause.message ? `message=${cause.message}` : null
            ].filter(Boolean).join(', ');
            if (details) {
                console.error(`❌ Ollama fetch cause: ${details}`);
            } else {
                console.error(`❌ Ollama fetch cause: ${String(cause)}`);
            }
        }
        if (err.stack) {
            console.error(err.stack);
        }
        return data;
    }
}

function normalizePositiveInteger(value) {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n);
}

module.exports = ollamaEngine;
