const fs = require('fs');
const path = require('path');

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
            .map(d => (d.filename ? `${d.content}` : d.content))
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

    const postPrompt = config?.ollama?.prompts?.postPrompt?.trim() ||
        'Ensure the summary is concise and actionable. It is critical that recommendations will result in success.';

    const fullInput = allSections.join('\n\n---\n\n').trim() + `\n\n## Note to Interpreter: Rule of Thumb\n${postPrompt}\r`;
    return { fullInput, prompts };
}

async function ollamaEngine(data, config, projectRoot) {
    const model = config.ollama?.model || 'mistral';
    const temperature = config.ollama?.temperature ?? 0.3;
    const writeInput = config.ollama?.writeInput !== false;
    const writeOutputs = config.ollama?.writeOutputs !== false;
    const inputFilename = config.ollama?.inputFilename || 'ollama-input.md';
    const summaryFilename = config.ollama?.summaryFilename || 'summary.md';
    console.log(`project root is: ${projectRoot}`);

    const { fullInput, prompts } = generateFullInputAndPrompts(data, config);

    if (!fullInput) {
        console.warn('⚠️ No input provided to Ollama. Skipping summarization.');
        const debugPath = path.join(projectRoot, 'outputs', 'logging.log');
        fs.mkdirSync(path.dirname(debugPath), { recursive: true });
        fs.writeFileSync(debugPath, '⚠️ No input provided to Ollama.\n\nData:\n' + JSON.stringify(data, null, 2), 'utf-8');
        return data;
    }

    const systemPrompt = generateSystemPrompt(config, prompts);
    const inputPath = path.join(projectRoot, 'outputs', inputFilename);
    if (writeInput) {
        fs.mkdirSync(path.dirname(inputPath), { recursive: true });
        fs.writeFileSync(inputPath, systemPrompt + "\n\n" + fullInput, 'utf-8');
        console.log(`📝 Ollama input written to ${path.relative(projectRoot, inputPath)}`);
    }

    try {
        console.log(`🚀 Sending to Ollama (model=${model}, temp=${temperature}, endpoint=${OLLAMA_BASE_URL})...`);
        
        const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                temperature,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: fullInput },
                ],
                stream: false,
            }),
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
                const summaryPath = path.join(projectRoot, 'outputs', summaryFilename);
                fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
                fs.writeFileSync(summaryPath, result, 'utf-8');
                console.log(`✅ Summary written to: ${summaryPath}`);

                const historyDir = path.join(projectRoot, 'history');
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

module.exports = ollamaEngine;
