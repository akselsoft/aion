// Updates to: core/engines/summarizer.js
const { Configuration, OpenAIApi } = require('openai');
const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);

async function summarizerEngine(data, config) {
    const defaultPrompt = 'Summarize the following content as clearly and concisely as possible.';

    for (const key of Object.keys(data)) {
        const section = data[key];
        const input = section.content;
        let systemPrompt = config.promptTemplates?.summarizer || defaultPrompt;

        if (section.mode === 'replace') {
            systemPrompt = config.promptTemplates?.summarizer || defaultPrompt;
        } else if (section.prompt) {
            systemPrompt = section.prompt + '\n' + systemPrompt;
        }

        const response = await openai.createChatCompletion({
            model: config.tokenReducer?.model || 'gpt-4',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: input }
            ]
        });

        // Replace original content with summarized version
        data[key].content = response.data.choices[0].message.content.trim();
    }

    return data;
}

module.exports = summarizerEngine;
