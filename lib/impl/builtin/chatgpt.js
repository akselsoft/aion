// Wrapper around core ChatGPT engine to work in persona pipeline
const fs = require('fs');
const path = require('path');
const chatgptEngine = require('../../../core/engines/chatgpt');
const { resolveConfigPath } = require('../../utils/paths');
let OpenAIClient = null;
try {
  ({ OpenAI: OpenAIClient } = require('openai'));
} catch {}

function loadPromptFromFile(engineCfg, projectRoot) {
  const explicit = engineCfg.promptFile;
  const byName = engineCfg.name ? path.join(projectRoot, 'prompts', `${engineCfg.name}.md`) : null;
  const candidate = explicit || byName;
  if (!candidate) return '';
  const full = resolveConfigPath(projectRoot, candidate);
  try {
    return fs.readFileSync(full, 'utf-8');
  } catch {
    return '';
  }
}

module.exports = {
  async run(ctx, engineCfg, personaCfg) {
    const projectRoot = personaCfg.__projectRoot || process.cwd();
    const inputType = engineCfg.inputType; // optional filter on ctx.passedFiles[].type
    const replace = engineCfg.replace === true;
    const outputType = engineCfg.outputType || 'ChatGPT';
    const enginePromptFileText = loadPromptFromFile(engineCfg, projectRoot);
    const promptPlacement = engineCfg.promptPlacement || 'section';
    const inputFileTypes = normalizeFileTypes(engineCfg.inputFileTypes);

    // Convert passedFiles into sections expected by the core chatgpt engine
    const items = Array.isArray(ctx.passedFiles) ? ctx.passedFiles : [];
    const selected = inputType ? items.filter(i => i.type === inputType) : items;
    if (inputType && selected.length === 0) {
      console.error(`❌ ChatGPT engine skipped: no passedFiles with type="${inputType}".`);
      return;
    }

    const sections = selected.map(item => {
      const mergedPrompt = [
        item.prompt,
        promptPlacement === 'section' ? (enginePromptFileText || engineCfg.prompt) : null
      ]
        .filter(Boolean)
        .join('\n\n');
      return {
        name: item.name || item.type || 'section',
        type: item.type || 'section',
        prompt: mergedPrompt,
        documents: (item.documents || [])
          .filter(d => matchesFileType(d, inputFileTypes))
          .map(d => ({
          filename: d.filename || d.name || 'document',
          content: d.content || ''
          }))
      };
    });

    // Determine if this is the last chatgpt interpreter in the persona config
    const interpreters = personaCfg?.params?.interpreters || [];
    const chatgptNames = interpreters.filter(i => i.engine === 'chatgpt').map(i => i.name);
    const lastChatgptName = chatgptNames.length ? chatgptNames[chatgptNames.length - 1] : null;
    const isLastChatgpt = engineCfg.name === lastChatgptName;

    // Clone personaCfg shallowly and tweak chatgpt IO settings per engine
    const cfg = { ...personaCfg, chatgpt: { ...(personaCfg.chatgpt || {}) } };
    if (engineCfg.model) cfg.chatgpt.model = engineCfg.model;
    if (engineCfg.temperature !== undefined) cfg.chatgpt.temperature = engineCfg.temperature;
    if (promptPlacement === 'top') {
      cfg.chatgpt.systemPrompt = [
        cfg.chatgpt.systemPrompt,
        enginePromptFileText || engineCfg.prompt
      ].filter(Boolean).join('\n\n');
    }
    cfg.chatgpt.writeOutputs = isLastChatgpt; // only last chatgpt writes summary/history
    cfg.chatgpt.summaryFilename = `${outputType}.md`;
    if (inputType) {
      cfg.chatgpt.inputFilename = `${inputType}.md`;
    } else {
      cfg.chatgpt.inputFilename = `${outputType}-input.md`;
    }

    // Run the core engine; it will respect writeOutputs and file naming overrides
    const resultSections = await chatgptEngine(sections, cfg, projectRoot);

    // Find the chatgpt result inside resultSections (it appends an object with name 'chatgptResult')
    const last = Array.isArray(resultSections) ? resultSections[resultSections.length - 1] : null;

    // Only use content produced in this run to avoid reusing stale summary files.
    const content = String((last && last.content) || '').trim();
    if (!content) {
      console.warn('⚠️ ChatGPT returned no content; skipping artifact emission and downstream responders for this step.');
      return;
    }

    const newItem = {
      name: engineCfg.name || outputType || 'ChatGPT Output',
      type: outputType,
      documents: [{ filename: 'chatgpt.md', filetype: 'md', content }]
    };

    // Persist output using outputType-based filename
    const outPath = path.join(projectRoot, 'outputs', `${outputType}.md`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content, 'utf-8');

    // If inputType was specified, also persist the input that was sent to ChatGPT
    if (inputType) {
      const inputPath = path.join(projectRoot, 'outputs', `${inputType}.md`);
      if (fs.existsSync(inputPath)) {
        // Already written by core with the same name; nothing else needed
      } else {
        // If not present (writeInput disabled), build a minimal input snapshot
        const joined = sections.map(s =>
          `### ${s.name}\n\n${(s.documents || []).map(d => d.content).join('\n\n')}`
        ).join('\n\n---\n\n');
        fs.writeFileSync(inputPath, joined, 'utf-8');
      }
    }

    if (replace) {
      ctx.passedFiles.length = 0;
      ctx.passedFiles.push(newItem);
    } else {
      ctx.passedFiles.push(newItem);
    }

    // Optional Prompt Suggestions feature
    if (engineCfg.emitSuggestions) {
      const suggestionScope = engineCfg.suggestionScope || 'both'; // 'inputs' | 'summary' | 'both'
      const suggestionCount = Number(engineCfg.suggestionCount || 10);
      const seedText = buildSuggestionSeed(ctx.passedFiles, inputType, suggestionScope, content || '');
      const promptText = buildSuggestionPrompt(engineCfg, suggestionCount);

      const suggestions = await generateSuggestions(seedText, promptText, personaCfg, engineCfg);
      if (suggestions.length) {
        const md = suggestionsToMarkdown(suggestions);
        // Emit as bundle
        ctx.passedFiles.push({
          name: 'Prompt Suggestions',
          type: 'PromptSuggestions',
          documents: [{ filename: 'SUGGESTED_PROMPTS.md', filetype: 'md', content: md }]
        });

        // Optional persistence
        await maybePersistSuggestions(suggestions, engineCfg, personaCfg, md);
      }
    }
  }
};

function buildSuggestionSeed(passedFiles, typeFilter, scope, summaryText) {
  const items = typeFilter ? passedFiles.filter(i => i.type === typeFilter) : passedFiles;
  const inputsText = items
    .flatMap(i => i.documents || [])
    .map(d => `# ${d.filename || d.name || 'Document'}\n${d.content || ''}`)
    .join('\n\n');
  if (scope === 'inputs') return inputsText;
  if (scope === 'summary') return summaryText || '';
  return `${inputsText}\n\n----\n\n${summaryText || ''}`;
}

function buildSuggestionPrompt(intr, maxN) {
  const domains = intr.domains || ['project mgmt','risk','timelines','quality','people'];
  return `From the material provided, propose reusable prompts for future runs.\nReturn JSON array with objects: {\n  "title": string,\n  "prompt": string,\n  "where": "Vision|Timelines|Stakeholders|Risks|Backlog|Measures|General",\n  "cadence": "once|weekly|daily|run-time",\n  "tags": string[]\n}.\nRules:\n- Each prompt must be self-contained and actionable.\n- Prefer checks that surface gaps, risks, time-sensitive issues, or data quality/consistency.\n- Include at least 1 prompt about data quality/consistency, and 1 about upcoming deadlines.\n- Max ${maxN} prompts.\nDomains to consider: ${domains.join(', ')}.`;
}

async function generateSuggestions(seedText, suggestionPrompt, personaCfg, engineCfg) {
  try {
    if (!OpenAIClient) return [];
    const client = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY });
    const model = engineCfg.suggestionModel || (personaCfg.chatgpt && personaCfg.chatgpt.model) || 'gpt-4o-mini';
    const temperature = engineCfg.suggestionTemperature ?? (personaCfg.chatgpt && personaCfg.chatgpt.temperature) ?? 0.2;
    const res = await client.chat.completions.create({
      model,
      temperature,
      messages: [
        { role: 'system', content: 'You generate actionable, reusable prompts as strict JSON.' },
        { role: 'user', content: suggestionPrompt + '\n\n' + seedText }
      ]
    });
    const raw = res.choices?.[0]?.message?.content || '';
    return safeParseSuggestions(raw, Number(engineCfg.suggestionCount || 10));
  } catch {
    return [];
  }
}

function safeParseSuggestions(raw, maxN) {
  try {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    const json = start >= 0 ? raw.slice(start, end + 1) : raw;
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.slice(0, maxN) : [];
  } catch {
    return [];
  }
}

function suggestionsToMarkdown(items) {
  const rows = items.map(p => `### ${escapeMd(p.title || 'Suggested Prompt')}\n- Where: ${p.where || 'General'}\n- Cadence: ${p.cadence || 'run-time'}\n- Tags: ${(p.tags || []).join(', ')}\n\n\`\`\`\n${p.prompt || ''}\n\`\`\`\n`);
  return `# Suggested Prompts\n\n${rows.join('\n')}`;
}

async function maybePersistSuggestions(items, intr, personaCfg, mdText) {
  const strategy = intr.applySuggestions || 'none'; // 'none' | 'append-to-helper' | 'write-file'
  if (strategy === 'none') return;
  const seedDir = path.resolve(personaCfg.__projectRoot || process.cwd(), intr.seedDir || personaCfg.params?.rootDir || './');

  if (strategy === 'write-file') {
    const outDir = path.join(seedDir, '.becca');
    try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
    const outPath = path.join(outDir, 'SUGGESTED_PROMPTS.md');
    fs.writeFileSync(outPath, mdText || suggestionsToMarkdown(items), 'utf8');
    return;
  }

  if (strategy === 'append-to-helper') {
    const dirs = safeReaddir(seedDir)
      .map(n => path.join(seedDir, n))
      .filter(p => existsDir(p));
    const block = '\n\n## Suggested Prompts (auto)\n' + items.map(i => `- ${inlineOneLine(i.title || 'Prompt')}: ${inlineOneLine(i.prompt || '')}`).join('\n') + '\n';
    for (const d of dirs) {
      const helper = resolveHelper(d);
      if (!helper) continue;
      try { fs.appendFileSync(helper, block, 'utf8'); } catch {}
    }
  }
}

function existsDir(p){ try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function safeReaddir(d){ try { return fs.readdirSync(d); } catch { return []; } }
function resolveHelper(dir){
  for (const n of ['HELPER.md','helper.md','_helper.md']) {
    const p = path.join(dir, n);
    try { if (fs.statSync(p).isFile()) return p; } catch {}
  }
  return null;
}
function escapeMd(s){ return String(s).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
function inlineOneLine(s){ return String(s).replace(/\s+/g,' ').trim(); }

function normalizeFileTypes(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value])
    .map(v => String(v).trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean);
}

function matchesFileType(doc, allowedTypes) {
  if (!allowedTypes.length) return true;
  const filetype = String(doc?.filetype || extensionFromFilename(doc?.filename) || '')
    .trim()
    .toLowerCase()
    .replace(/^\./, '');
  return !!filetype && allowedTypes.includes(filetype);
}

function extensionFromFilename(filename) {
  const name = String(filename || '');
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1) : '';
}
