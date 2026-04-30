const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');

// Grok (xAI) uses OpenAI-compatible API
const grok = new OpenAI({
    apiKey: process.env.GROK_API_KEY,
    baseURL: 'https://api.x.ai/v1',
});

function generateSystemPrompt(config, prompts) {
    let systemPrompt = config.grok?.systemPrompt || ``.trim();

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

    const postPrompt = config?.grok?.prompts?.postPrompt?.trim() ||
        'Ensure the summary is concise and actionable. It is critical that recommendations will result in success.';

    const fullInput = allSections.join('\n\n---\n\n').trim() + `\n\n## Note to Interpreter: Rule of Thumb\n${postPrompt}\r`;
    return { fullInput, prompts };
}

async function grokEngine(data, config, projectRoot) {
    const model = config.grok?.model || 'grok-beta';
    const temperature = config.grok?.temperature ?? 0.3;
    const writeInput = config.grok?.writeInput !== false;
    const writeOutputs = config.grok?.writeOutputs !== false;
    const inputFilename = config.grok?.inputFilename || 'grok-input.md';
    const summaryFilename = config.grok?.summaryFilename || 'summary.md';
    console.log(`project root is: ${projectRoot}`);

    const { fullInput, prompts } = generateFullInputAndPrompts(data, config);

    if (!fullInput) {
        console.warn('⚠️ No input provided to Grok. Skipping summarization.');
        const debugPath = path.join(projectRoot, 'outputs', 'logging.log');
        fs.mkdirSync(path.dirname(debugPath), { recursive: true });
        fs.writeFileSync(debugPath, '⚠️ No input provided to Grok.\n\nData:\n' + JSON.stringify(data, null, 2), 'utf-8');
        return data;
    }

    const systemPrompt = generateSystemPrompt(config, prompts);
    const inputPath = path.join(projectRoot, 'outputs', inputFilename);
    if (writeInput) {
        fs.mkdirSync(path.dirname(inputPath), { recursive: true });
        fs.writeFileSync(inputPath, systemPrompt + "\n\n" + fullInput, 'utf-8');
        console.log(`📝 Grok input written to ${path.relative(projectRoot, inputPath)}`);
    }

    try {
        console.log(`🚀 Sending to Grok (model=${model}, temp=${temperature})...`);
        const response = await grok.chat.completions.create({
            model,
            temperature,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: fullInput },
            ],
        });
        console.log('✅ Received response from Grok.');

        const result = response.choices?.[0]?.message?.content?.trim() || null;

        if (result) {
            data.push({
                name: 'grokResult',
                type: 'synthesis',
                content: result,
                generatedBy: 'grok',
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
        console.error(`❌ Grok engine failed: ${err.message}`);
        return data;
    }
}

module.exports = grokEngine;
