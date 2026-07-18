const fs = require('fs');
const path = require('path');
const { HfInference } = require('@huggingface/inference');

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

function generateSystemPrompt(config, prompts) {
    let systemPrompt = config.huggingface?.systemPrompt || ``.trim();

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

    const postPrompt = config?.huggingface?.prompts?.postPrompt?.trim() ||
        'Ensure the summary is concise and actionable. It is critical that recommendations will result in success.';

    const fullInput = allSections.join('\n\n---\n\n').trim() + `\n\n## Note to Interpreter: Rule of Thumb\n${postPrompt}\r`;
    return { fullInput, prompts };
}

async function huggingfaceEngine(data, config, projectRoot) {
    const model = config.huggingface?.model || 'mistralai/Mistral-7B-Instruct-v0.1';
    const temperature = config.huggingface?.temperature ?? 0.3;
    const maxTokens = config.huggingface?.maxTokens || 2048;
    const writeInput = config.huggingface?.writeInput !== false;
    const writeOutputs = config.huggingface?.writeOutputs !== false;
    const inputFilename = config.huggingface?.inputFilename || 'huggingface-input.md';
    const summaryFilename = config.huggingface?.summaryFilename || 'summary.md';
    console.log(`project root is: ${projectRoot}`);

    const { fullInput, prompts } = generateFullInputAndPrompts(data, config);

    if (!fullInput) {
        console.warn('⚠️ No input provided to Hugging Face. Skipping summarization.');
        const debugPath = path.join(projectRoot, 'outputs', 'logging.log');
        fs.mkdirSync(path.dirname(debugPath), { recursive: true });
        fs.writeFileSync(debugPath, '⚠️ No input provided to Hugging Face.\n\nData:\n' + JSON.stringify(data, null, 2), 'utf-8');
        return data;
    }

    const systemPrompt = generateSystemPrompt(config, prompts);
    const inputPath = path.join(projectRoot, 'outputs', inputFilename);
    if (writeInput) {
        fs.mkdirSync(path.dirname(inputPath), { recursive: true });
        fs.writeFileSync(inputPath, systemPrompt + "\n\n" + fullInput, 'utf-8');
        console.log(`📝 Hugging Face input written to ${path.relative(projectRoot, inputPath)}`);
    }

    try {
        console.log(`🚀 Sending to Hugging Face (model=${model}, temp=${temperature})...`);
        
        const response = await hf.textGeneration({
            model,
            inputs: `${systemPrompt}\n\nUser: ${fullInput}\n\nAssistant:`,
            parameters: {
                temperature,
                max_new_tokens: maxTokens,
                return_full_text: false,
            },
        });
        console.log('✅ Received response from Hugging Face.');

        const result = response.generated_text?.trim() || null;

        if (result) {
            data.push({
                name: 'huggingfaceResult',
                type: 'synthesis',
                content: result,
                generatedBy: 'huggingface',
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
        console.error(`❌ Hugging Face engine failed: ${err.message}`);
        return data;
    }
}

module.exports = huggingfaceEngine;
