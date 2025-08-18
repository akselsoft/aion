const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Generates the system prompt from config and section-level prompts
function generateSystemPrompt(config, prompts) {
    let systemPrompt = config.chatgpt?.systemPrompt || `
You are reviewing a collection of content files. Your tasks are to:

1. Summarize the main purpose and content.
2. Answer any questions or fulfill any specific requests found in the prompts.
3. Suggest relevant follow-up actions or questions if helpful.

Be clear, concise, and context-aware. Avoid repeating known information unnecessarily.
`.trim();

    if (prompts.length > 0) {
        systemPrompt += `

The following are section-specific instructions to guide interpretation:
${prompts.join('\n\n')}
`;
    }

    return systemPrompt;
}

// Combines section content and extracts section-specific prompts
function generateFullInputAndPrompts(data, config) {
    const prompts = [];

    const allSections = data.map(section => {
        const prompt = section.prompt?.trim() || '';

        /*const docs = section.documents
            ?.filter(d => d.content)
            .map(d => (d.filename ? `${d.filename}\n\n${d.content}` : d.content))
            .join('\n\n') || '';
*/

        const docs = section.documents
            ?.filter(d => d.content)
            .map(d => (d.filename ? `${d.content}` : d.content))
            .join('\n\n') || '';

        console.log(`📄 Section: ${section.name} - ${section.documents.length} documents - Prompt: ${prompt ? prompt : 'No prompt provided'}`);
        section.documents.forEach(doc => {
            console.log(`  - ${doc.filename || 'Unnamed document'} (${doc.content ? doc.content.length : 0} chars)`);
        });
        // console.log(`${docs}`);

        /*const docs = section.documents
        ?.filter(d => d.content && d.content.trim() !== 'undefined')
        .map(d => d.filename + '\n\n' + d.content)
        .join('\n\n') || '';
*/
        if (!prompt && !docs) return null; // Skip entirely empty sections

        let sectionBlock = "### " + section.name + "\n\n";

        if (prompt) {
            sectionBlock += `Context: ${prompt}\n\n`;
        }
        sectionBlock += `\n${docs}\n\r`.trim();
        return sectionBlock + '\n\r';


    }).filter(Boolean); // Filter out skipped sections
    const postPrompt = config?.chatgpt?.prompts?.postPrompt?.trim() ||
        'Ensure the summary is concise and actionable. It is critical that recommendations will result in success.';

    const fullInput = allSections.join('\n\n---\n\n').trim() + `\n\nRule of Thumb\n${postPrompt}\r`;
    return { fullInput, prompts };

}

async function chatgptEngine(data, config, projectRoot) {
    const model = config.chatgpt?.model || 'gpt-4';
    const temperature = config.chatgpt?.temperature ?? 0.3;
    console.log(`project root is: ${projectRoot}`);

    const { fullInput, prompts } = generateFullInputAndPrompts(data, config);

    if (!fullInput) {
        console.warn('⚠️ No input provided to ChatGPT. Skipping summarization.');
        const debugPath = path.join(projectRoot, 'outputs', 'logging.log');
        fs.mkdirSync(path.dirname(debugPath), { recursive: true });
        fs.writeFileSync(debugPath, '⚠️ No input provided to ChatGPT.\n\nData:\n' + JSON.stringify(data, null, 2), 'utf-8');
        return data;
    }

    const systemPrompt = generateSystemPrompt(config, prompts);
    const inputPath = path.join(projectRoot, 'outputs', 'chatgpt-input.md');
    fs.mkdirSync(path.dirname(inputPath), { recursive: true });
    fs.writeFileSync(inputPath, systemPrompt + "\n\n" + fullInput, 'utf-8');
    console.log(`📝 ChatGPT input written to ${path.relative(projectRoot, inputPath)}`);

    try {
        const response = await openai.chat.completions.create({
            model,
            temperature,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: fullInput },
            ],
        });

        // Save raw input for debugging
        const result = response.choices?.[0]?.message?.content?.trim() || null;

        if (result) {
            data.push({
                name: 'chatgptResult',
                type: 'synthesis',
                content: result,
                generatedBy: 'chatgpt',
            });

            // Original summary path
            const summaryPath = path.join(projectRoot, 'outputs', 'summary.md');
            fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
            fs.writeFileSync(summaryPath, result, 'utf-8');
            console.log(`✅ Summary written to: ${summaryPath}`);

            // New history paths
            const historyDir = path.join(projectRoot, 'history');
            fs.mkdirSync(historyDir, { recursive: true });

            // Now generate a brief summary of the full summary
            // Use custom brief prompt if provided
            const briefPrompt = config.chatgpt?.prompts?.summaryBrief?.trim() ||
                'Summarize the following report into 3-4 sentences. You don\'t need to include the charter. This will be used as brief context in future runs.';

            try {
                const briefResponse = await openai.chat.completions.create({
                    model,
                    temperature,
                    messages: [
                        {
                            role: 'system',
                            content: briefPrompt
                        },
                        {
                            role: 'user',
                            content: result
                        }
                    ]
                });

                const brief = briefResponse.choices?.[0]?.message?.content?.trim() || '';

                if (brief) {
                    const briefPath = path.join(historyDir, 'summary-brief.md');
                    fs.writeFileSync(briefPath, brief, 'utf-8');
                    console.log(`🧠 Brief summary written to: ${briefPath}`);
                }
            } catch (briefErr) {
                console.warn(`⚠️ Failed to generate summary-brief.md: ${briefErr.message}`);
            }


            const dateStr = new Date().toISOString().split('T')[0]; // e.g., "2024-07-22"
            const datedPath = path.join(historyDir, `${dateStr}.md`);
            const latestPath = path.join(historyDir, 'summary.md');

            fs.writeFileSync(datedPath, result, 'utf-8');
            fs.writeFileSync(latestPath, result, 'utf-8');

            console.log(`📚 Dated summary written to: ${datedPath}`);
            console.log(`📄 Latest summary copied to: ${latestPath}`);
        }

        return data;
    } catch (err) {
        console.error(`❌ ChatGPT engine failed: ${err.message}`);

        return data;
    }
}

// export the engine function
module.exports = chatgptEngine;