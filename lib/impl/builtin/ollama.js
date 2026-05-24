// Wrapper around core Ollama engine to work in persona pipelines.
const fs = require('fs');
const path = require('path');
const ollamaEngine = require('../../../core/engines/ollama');
const { resolveConfigPath } = require('../../utils/paths');

function loadPromptFromFile(engineCfg, projectRoot) {
  const explicit = engineCfg.promptFile;
  const byName = engineCfg.name ? path.join(projectRoot, 'prompts', `${engineCfg.name}.md`) : null;
  const candidate = explicit || byName;
  return loadTextFile(candidate, projectRoot);
}

function loadChunkPrompt(engineCfg, projectRoot) {
  const fileText = loadTextFile(engineCfg.chunkPromptFile || engineCfg.compressionPromptFile, projectRoot);
  return fileText || engineCfg.chunkPrompt || engineCfg.compressionPrompt || DEFAULT_COMPRESSION_PROMPT;
}

function loadTextFile(candidate, projectRoot) {
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
    const inputType = engineCfg.inputType;
    const replace = engineCfg.replace === true;
    const outputType = engineCfg.outputType || 'Ollama';
    const enginePromptFileText = loadPromptFromFile(engineCfg, projectRoot);
    const promptPlacement = engineCfg.promptPlacement || 'section';
    const inputFileTypes = normalizeFileTypes(engineCfg.inputFileTypes);
    const tokenLimit = Number(engineCfg.tokenLimit ?? engineCfg.tokenlimit);

    const items = Array.isArray(ctx.passedFiles) ? ctx.passedFiles : [];
    const selected = inputType ? items.filter(i => i.type === inputType) : items;
    if (inputType && selected.length === 0) {
      console.error(`❌ Ollama engine skipped: no passedFiles with type="${inputType}".`);
      return;
    }

    let sections = selected.map(item => {
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
    }).filter(section => hasSectionContent(section));

    const cfg = {
      ...personaCfg,
      ollama: {
        ...(personaCfg.ollama || {}),
        ...(engineCfg.ollama || {})
      }
    };

    if (engineCfg.model) cfg.ollama.model = engineCfg.model;
    if (engineCfg.temperature !== undefined) cfg.ollama.temperature = engineCfg.temperature;
    if (engineCfg.plaintext !== undefined) cfg.ollama.plaintext = engineCfg.plaintext === true;
    cfg.ollama.writeOutputs = false;
    cfg.ollama.writeInput = engineCfg.writeInput ?? cfg.ollama.writeInput;
    cfg.ollama.inputFilename = engineCfg.inputFilename || (inputType ? `${inputType}-ollama.md` : `${outputType}-ollama-input.md`);

    if (promptPlacement === 'top') {
      cfg.ollama.systemPrompt = [
        cfg.ollama.systemPrompt,
        enginePromptFileText || engineCfg.prompt
      ].filter(Boolean).join('\n\n');
    }

    sections = normalizeSectionsForOllamaInput(sections, cfg);

    if (!sections.length) {
      console.warn('⚠️ Ollama skipped: no matching documents remained after filtering.');
      return;
    }

    const systemPrompt = cfg.ollama?.systemPrompt || '';
    const postPrompt = cfg.ollama?.prompts?.postPrompt;
    const estimatedTokens = estimateSectionsTokens(sections, systemPrompt, postPrompt);
    const hasTokenLimit = Number.isFinite(tokenLimit) && tokenLimit > 0;
    const shouldCompress = hasTokenLimit && estimatedTokens > tokenLimit;
    let content = '';

    if (shouldCompress) {
      console.log(`🪓 Ollama input estimated at ${estimatedTokens} tokens, exceeding tokenLimit ${tokenLimit}. Compressing oversized files before final prompt.`);
      cfg.ollama.writeInput = false;
      const assembledSections = await buildCompressedFinalSections(sections, cfg, projectRoot, engineCfg, tokenLimit, systemPrompt, postPrompt);
      const assembledTokens = estimateSectionsTokens(assembledSections, systemPrompt, postPrompt);
      console.log(`🧮 Ollama compressed assembly estimated at ${assembledTokens} tokens; tokenLimit is ${tokenLimit}.`);
      writeFinalInputSnapshot(projectRoot, cfg.ollama.inputFilename, assembledSections, cfg, systemPrompt, tokenLimit, assembledTokens);

      const resultSections = await ollamaEngine(assembledSections, cfg, projectRoot);
      const last = Array.isArray(resultSections) ? resultSections[resultSections.length - 1] : null;
      content = String((last && last.content) || '').trim();
    } else {
      if (hasTokenLimit) {
        console.log(`🧮 Ollama input estimated at ${estimatedTokens} tokens; tokenLimit is ${tokenLimit}. Sending as one request.`);
      }
      const resultSections = await ollamaEngine(sections, cfg, projectRoot);
      const last = Array.isArray(resultSections) ? resultSections[resultSections.length - 1] : null;
      content = String((last && last.content) || '').trim();
    }

    if (!content) {
      console.warn('⚠️ Ollama returned no content; skipping artifact emission and file write.');
      return;
    }

    content = applyOutputHeader(content, engineCfg, new Date());

    if (engineCfg.filename || engineCfg.outputFile) {
      const outPath = resolvePath(projectRoot, engineCfg.filename || engineCfg.outputFile);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, content + '\n', 'utf-8');
      console.log(`[ollama] wrote ${outPath}`);
      if (engineCfg.datedOutput === true || engineCfg.dailyOutput === true) {
        const datedPath = datedOutputPath(outPath, engineCfg, new Date());
        fs.mkdirSync(path.dirname(datedPath), { recursive: true });
        fs.writeFileSync(datedPath, content + '\n', 'utf-8');
        console.log(`[ollama] wrote dated output ${datedPath}`);
      }
    }

    if (engineCfg.historyDir) {
      const historyDir = resolvePath(projectRoot, engineCfg.historyDir);
      fs.mkdirSync(historyDir, { recursive: true });
      const historyPath = path.join(historyDir, historyFilename(engineCfg.historyPrefix || outputType));
      fs.writeFileSync(historyPath, content + '\n', 'utf-8');
      console.log(`[ollama] wrote history ${historyPath}`);
    }

    const newItem = {
      name: engineCfg.name || outputType || 'Ollama Output',
      type: outputType,
      documents: [{ filename: 'ollama.md', filetype: 'md', content }]
    };

    if (replace) {
      ctx.passedFiles.length = 0;
      ctx.passedFiles.push(newItem);
    } else {
      ctx.passedFiles.push(newItem);
    }
  }
};

function resolvePath(projectRoot, value) {
  return resolveConfigPath(projectRoot, value);
}

function historyFilename(prefix) {
  const stamp = new Date().toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
    .replace('T', '-');
  return `${prefix}-${stamp}.md`;
}

function datedOutputPath(filePath, engineCfg = {}, date = new Date()) {
  const parsed = path.parse(filePath);
  const ext = parsed.ext || '.md';
  const stamp = formatDateStamp(date, engineCfg.datedOutputFormat || engineCfg.dateFormat || 'YYYYMMDD');
  const pattern = engineCfg.datedOutputPattern || '{name}-{date}{ext}';
  const filename = pattern
    .replace(/\{name\}/g, parsed.name)
    .replace(/\{date\}/g, stamp)
    .replace(/\{ext\}/g, ext);
  const dir = engineCfg.datedOutputDir
    ? resolvePath(parsed.dir, engineCfg.datedOutputDir)
    : parsed.dir;
  return path.join(dir, filename);
}

function formatDateStamp(date, format) {
  const d = date instanceof Date ? date : new Date(date);
  const values = {
    YYYY: String(d.getFullYear()),
    MM: String(d.getMonth() + 1).padStart(2, '0'),
    DD: String(d.getDate()).padStart(2, '0')
  };
  return String(format || 'YYYYMMDD')
    .replace(/YYYY/g, values.YYYY)
    .replace(/MM/g, values.MM)
    .replace(/DD/g, values.DD);
}

function applyOutputHeader(content, engineCfg = {}, date = new Date()) {
  if (engineCfg.prependRunDate !== true && engineCfg.prependDateHeader !== true) return content;
  const label = engineCfg.dateHeaderLabel || 'Date Evaluated';
  const timestamp = formatDateTimeStamp(date);
  const header = `${label}: ${timestamp}`;
  const value = String(content || '').trimStart();
  if (value.startsWith(`${label}:`)) {
    return value.replace(new RegExp(`^${escapeRegExp(label)}:[^\n]*(\n|$)`), `${header}\n`);
  }
  return `${header}\n\n${value}`;
}

function formatDateTimeStamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

function hasSectionContent(section) {
  return !!(section.prompt || (section.documents || []).some(d => String(d.content || '').trim()));
}

function buildExecutionChunks(sections, cfg, tokenLimit) {
  if (!Number.isFinite(tokenLimit) || tokenLimit <= 0) return sections;

  const systemPrompt = cfg.ollama?.systemPrompt || '';
  const postPrompt = cfg.ollama?.prompts?.postPrompt;
  const totalTokens = estimateSectionsTokens(sections, systemPrompt, postPrompt);
  if (totalTokens <= tokenLimit) return sections;

  const chunks = [];
  for (const section of sections) {
    const sectionTokens = estimateSectionsTokens([section], systemPrompt, postPrompt);
    if (sectionTokens <= tokenLimit) {
      chunks.push(section);
      continue;
    }

    const splitDocs = splitSectionDocuments(section, tokenLimit, systemPrompt, postPrompt);
    chunks.push(...splitDocs);
  }

  return chunks.length ? chunks : sections;
}

function estimateSectionsTokens(sections, systemPrompt, postPrompt) {
  return Math.ceil(serializeEstimatedInput(sections, systemPrompt, postPrompt).length / 4);
}

function serializeEstimatedInput(sections, systemPrompt, postPrompt) {
  return [
    systemPrompt || '',
    ...sections.map(serializeSection),
    postPrompt || ''
  ].filter(Boolean).join('\n\n');
}

function serializeSection(section) {
  const docs = (section.documents || [])
    .map(d => renderDocumentContent(d, section._ollamaCfg))
    .filter(Boolean)
    .join('\n\n');

  return [
    `### ${section.name || section.type || 'section'}`,
    section.prompt ? `**Prompt:** ${section.prompt}` : '',
    docs
  ].filter(Boolean).join('\n\n');
}

function renderOllamaUserInput(sections, cfg) {
  const sectionBlocks = sections.map(section => serializeSection({ ...section, _ollamaCfg: cfg })).filter(Boolean);
  const postPrompt = cfg?.ollama?.prompts?.postPrompt?.trim() || '';
  return [
    sectionBlocks.join('\n\n---\n\n').trim(),
    postPrompt ? `## Note to Interpreter: Rule of Thumb\n${postPrompt}\r` : ''
  ].filter(Boolean).join('\n\n');
}

function renderDocumentContent(doc, cfg) {
  const content = doc?.content || '';
  if (cfg?.ollama?.plaintext !== true) return content;

  const parsed = doc?.json !== undefined ? doc.json : parseJsonContent(content);
  if (parsed === null) return content;

  return jsonToPlaintext(parsed);
}

function normalizeSectionsForOllamaInput(sections, cfg) {
  if (cfg?.ollama?.plaintext !== true) return sections;
  return sections.map(section => ({
    ...section,
    documents: (section.documents || []).map(doc => ({
      ...doc,
      filetype: doc.filetype === 'json' ? 'md' : doc.filetype,
      content: renderDocumentContent(doc, cfg)
    }))
  }));
}

function parseJsonContent(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function jsonToPlaintext(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);

  if (Array.isArray(value)) {
    return value.map(item => jsonToPlaintext(item)).filter(Boolean).join('\n\n');
  }

  if (value.file && Array.isArray(value.blocks)) {
    const blocks = value.blocks.map(block => {
      const label = block.index ? `Block ${block.index}:` : 'Block:';
      return [label, jsonToPlaintext(block.content ?? block)].filter(Boolean).join('\n');
    });
    return [`### ${value.file}`, ...blocks].filter(Boolean).join('\n\n');
  }

  return Object.entries(value)
    .map(([key, child]) => {
      const rendered = jsonToPlaintext(child);
      if (!rendered) return `${key}:`;
      if (typeof child === 'object') return `${key}:\n${indent(rendered)}`;
      return `${key}: ${rendered}`;
    })
    .join('\n');
}

function indent(text) {
  return String(text).split('\n').map(line => line ? `  ${line}` : line).join('\n');
}

const DEFAULT_COMPRESSION_PROMPT = [
  'Summarize the following text. Preserve all named people,',
  'specific decisions, action items, dates, and concerns.',
  'Be concise but do not omit facts. Output plain text only.'
].join(' ');

async function buildCompressedFinalSections(sections, cfg, projectRoot, engineCfg, tokenLimit, systemPrompt, postPrompt) {
  const finalPrompt = extractFinalPrompt(sections);
  const compressionPrompt = loadChunkPrompt(engineCfg, projectRoot);
  const assembled = [];
  const compressedSections = [];

  let compressionIndex = 0;
  for (const section of sections) {
    for (const doc of section.documents || []) {
      const filename = doc.filename || section.name || 'document';
      const fileSection = {
        name: filename,
        type: section.type || 'document',
        prompt: '',
        documents: [{ filename, content: doc.content || '' }]
      };
      const fileTokens = estimateSectionsTokens([fileSection], systemPrompt, postPrompt);
      if (fileTokens <= tokenLimit) {
        console.log(`📄 ${filename}: ${fileTokens} estimated tokens; pass-through.`);
        assembled.push(labelledFileSection(filename, doc.content || '', false));
        continue;
      }

      console.log(`📄 ${filename}: ${fileTokens} estimated tokens; needs compression.`);
      const compressed = await compressOversizedDocument({
        doc,
        filename,
        compressionPrompt,
        cfg,
        projectRoot,
        inputFilename: cfg.ollama.inputFilename,
        tokenLimit,
        systemPrompt,
        postPrompt,
        startIndex: compressionIndex
      });
      compressionIndex += compressed.chunkCount;
      const compressedSection = labelledFileSection(filename, compressed.content, true);
      assembled.push(compressedSection);
      compressedSections.push(compressedSection);
    }
  }

  let finalSections = appendFinalPrompt(assembled, finalPrompt);
  const assembledTokens = estimateSectionsTokens(finalSections, systemPrompt, postPrompt);
  if (assembledTokens <= tokenLimit) return finalSections;
  if (compressedSections.length === 0) {
    console.warn(`⚠️ Ollama input remains estimated above tokenLimit (${assembledTokens}/${tokenLimit}), but no individual file exceeded the limit. Sending assembled input as-is.`);
    return finalSections;
  }

  console.warn(`⚠️ Compressed Ollama input still estimated at ${assembledTokens}/${tokenLimit} tokens. Running one additional compression pass on compressed summaries only.`);
  const combinedCompressed = compressedSections.map(serializeSection).join('\n\n---\n\n');
  const recompressed = await compressTextOnce({
    name: 'Combined compressed summaries',
    filename: 'combined-compressed-summaries.md',
    content: combinedCompressed,
    compressionPrompt,
    cfg,
    projectRoot,
    inputFilename: cfg.ollama.inputFilename,
    tokenLimit,
    systemPrompt,
    index: compressionIndex
  });

  const recompressedByName = new Set(compressedSections.map(section => section.name));
  const passThrough = assembled.filter(section => !recompressedByName.has(section.name));
  return appendFinalPrompt([
    ...passThrough,
    labelledFileSection('Combined compressed summaries', recompressed, true)
  ], finalPrompt);
}

function extractFinalPrompt(sections) {
  const prompts = [];
  const seen = new Set();
  for (const section of sections) {
    const prompt = String(section.prompt || '').trim();
    if (!prompt || seen.has(prompt)) continue;
    seen.add(prompt);
    prompts.push(prompt);
  }
  return prompts.join('\n\n');
}

function labelledFileSection(filename, content, compressed) {
  return {
    name: compressed ? `${filename} — Compressed Summary` : filename,
    type: compressed ? 'compressed-summary' : 'pass-through',
    prompt: '',
    documents: [{
      filename: compressed ? `${filename}-compressed.md` : filename,
      filetype: extensionFromFilename(filename) || 'md',
      content: compressed
        ? `### ${filename} — Compressed Summary\n\n${String(content || '').trim()}`
        : `### ${filename}\n\n${String(content || '').trim()}`
    }]
  };
}

function appendFinalPrompt(sections, finalPrompt) {
  if (!finalPrompt) return sections;
  return [
    ...sections,
    {
      name: 'Final prompt',
      type: 'final-prompt',
      prompt: finalPrompt,
      documents: []
    }
  ];
}

async function compressOversizedDocument(options) {
  const {
    doc,
    filename,
    compressionPrompt,
    cfg,
    projectRoot,
    inputFilename,
    tokenLimit,
    systemPrompt,
    postPrompt,
    startIndex
  } = options;
  const maxChars = compressionChunkMaxChars(tokenLimit, compressionPrompt, systemPrompt, postPrompt);
  const chunks = splitTextByChars(doc.content || '', maxChars);
  const outputs = [];

  for (const [idx, chunk] of chunks.entries()) {
    const globalIndex = startIndex + idx;
    const section = {
      name: `${filename} chunk ${idx + 1}/${chunks.length}`,
      type: 'compression-chunk',
      prompt: compressionPrompt,
      documents: [{
        filename: `${filename}#chunk-${idx + 1}`,
        content: chunk
      }]
    };
    const chunkTokens = estimateSectionsTokens([section], systemPrompt, postPrompt);
    writeCompressionChunkSnapshot(projectRoot, inputFilename, globalIndex, section, systemPrompt, tokenLimit, chunkTokens);
    console.log(`🧩 Compressing ${filename} chunk ${idx + 1}/${chunks.length} (${chunkTokens} estimated tokens)`);
    const resultSections = await ollamaEngine([section], cfg, projectRoot);
    const last = Array.isArray(resultSections) ? resultSections[resultSections.length - 1] : null;
    const part = String((last && last.content) || '').trim();
    if (part) outputs.push(part);
  }

  return {
    content: outputs.join('\n\n').trim(),
    chunkCount: chunks.length
  };
}

async function compressTextOnce(options) {
  const { name, filename, content, compressionPrompt, cfg, projectRoot, inputFilename, tokenLimit, systemPrompt, index } = options;
  const section = {
    name,
    type: 'compression-fallback',
    prompt: compressionPrompt,
    documents: [{ filename, content }]
  };
  const tokens = estimateSectionsTokens([section], systemPrompt, '');
  writeCompressionChunkSnapshot(projectRoot, inputFilename, index, section, systemPrompt, tokenLimit, tokens);
  const resultSections = await ollamaEngine([section], cfg, projectRoot);
  const last = Array.isArray(resultSections) ? resultSections[resultSections.length - 1] : null;
  return String((last && last.content) || '').trim();
}

function compressionChunkMaxChars(tokenLimit, compressionPrompt, systemPrompt, postPrompt) {
  const overheadTokens = estimateSectionsTokens([{
    name: 'compression-overhead',
    prompt: compressionPrompt,
    documents: [{ filename: 'chunk.md', content: '' }]
  }], systemPrompt, postPrompt);
  return Math.max(800, Math.floor((tokenLimit - overheadTokens - 200) * 4));
}

function splitSectionDocuments(section, tokenLimit, systemPrompt, postPrompt) {
  const docs = Array.isArray(section.documents) ? section.documents : [];
  if (docs.length <= 1) return splitOversizedDocuments(section, tokenLimit, systemPrompt, postPrompt);

  const chunks = [];
  let currentDocs = [];

  for (const doc of docs) {
    const singleDocSection = withSectionDocuments(section, [doc], chunks.length + 1);
    const singleDocTokens = estimateSectionsTokens([singleDocSection], systemPrompt, postPrompt);
    if (singleDocTokens > tokenLimit) {
      if (currentDocs.length > 0) {
        chunks.push(withSectionDocuments(section, currentDocs, chunks.length + 1));
        currentDocs = [];
      }
      chunks.push(...splitOversizedDocuments(singleDocSection, tokenLimit, systemPrompt, postPrompt));
      continue;
    }

    const candidateDocs = [...currentDocs, doc];
    const candidate = withSectionDocuments(section, candidateDocs, chunks.length + 1);
    const candidateTokens = estimateSectionsTokens([candidate], systemPrompt, postPrompt);

    if (currentDocs.length > 0 && candidateTokens > tokenLimit) {
      chunks.push(withSectionDocuments(section, currentDocs, chunks.length + 1));
      currentDocs = [doc];
      continue;
    }

    currentDocs = candidateDocs;
  }

  if (currentDocs.length > 0) {
    chunks.push(withSectionDocuments(section, currentDocs, chunks.length + 1));
  }

  return chunks.length ? chunks : [section];
}

function splitOversizedDocuments(section, tokenLimit, systemPrompt, postPrompt) {
  const docs = Array.isArray(section.documents) ? section.documents : [];
  if (docs.length !== 1) return [section];

  const doc = docs[0];
  const content = String(doc.content || '');
  const sectionWithoutContent = withSectionDocuments(section, [{ ...doc, content: '' }], 1);
  const overheadTokens = estimateSectionsTokens([sectionWithoutContent], systemPrompt, postPrompt);
  const availableTokens = Math.max(200, tokenLimit - overheadTokens);
  const maxChars = Math.max(800, availableTokens * 4);

  if (content.length <= maxChars) return [section];

  const pieces = splitTextByChars(content, maxChars);
  return pieces.map((piece, index) => withSectionDocuments(section, [{
    ...doc,
    filename: `${doc.filename || 'document'}#part-${index + 1}`,
    content: piece
  }], index + 1));
}

function splitTextByChars(content, maxChars) {
  const units = splitIntoTextUnits(content, maxChars);
  const pieces = [];
  let current = '';

  for (const unit of units) {
    const candidate = current ? `${current}\n\n${unit}` : unit;
    if (current && candidate.length > maxChars) {
      pieces.push(current.trim());
      current = unit;
      continue;
    }
    current = candidate;
  }

  if (current.trim()) pieces.push(current.trim());
  return pieces;
}

function splitIntoTextUnits(content, maxChars) {
  const paragraphs = String(content || '')
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(Boolean);

  const units = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      units.push(paragraph);
      continue;
    }

    const sentences = splitParagraphIntoSentences(paragraph);
    let current = '';
    for (const sentence of sentences) {
      if (sentence.length > maxChars) {
        if (current.trim()) {
          units.push(current.trim());
          current = '';
        }
        units.push(...splitLongTextHard(sentence, maxChars));
        continue;
      }

      const candidate = current ? `${current} ${sentence}` : sentence;
      if (current && candidate.length > maxChars) {
        units.push(current.trim());
        current = sentence;
      } else {
        current = candidate;
      }
    }

    if (current.trim()) units.push(current.trim());
  }

  return units;
}

function splitParagraphIntoSentences(paragraph) {
  const normalized = String(paragraph || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const matches = normalized.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g);
  return (matches && matches.length ? matches : [normalized])
    .map(sentence => sentence.trim())
    .filter(Boolean);
}

function splitLongTextHard(text, maxChars) {
  const pieces = [];
  let remaining = String(text || '').trim();

  while (remaining.length > maxChars) {
    const slice = remaining.slice(0, maxChars);
    const breakAt = findHardBreakPoint(slice);
    pieces.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }

  if (remaining) pieces.push(remaining);
  return pieces;
}

function findHardBreakPoint(text) {
  const candidates = [
    text.lastIndexOf(' '),
    text.lastIndexOf(',')
  ].filter(i => i > text.length * 0.6);

  return candidates.length ? Math.max(...candidates) : text.length;
}

function withSectionDocuments(section, documents, chunkIndex) {
  const name = documents.length === (section.documents || []).length
    ? section.name
    : `${section.name || section.type || 'section'} (part ${chunkIndex})`;
  return {
    ...section,
    name,
    documents
  };
}

function writeFinalInputSnapshot(projectRoot, inputFilename, sections, cfg, systemPrompt, tokenLimit, estimatedTokens) {
  const inputPath = path.join(projectRoot, 'outputs', inputFilename || 'ollama-input.md');
  const body = [
    '# Ollama Final Input',
    '',
    `Token limit: ${tokenLimit}`,
    `Estimated tokens: ${estimatedTokens}`,
    '',
    '## System Message',
    '',
    systemPrompt || '_No system message._',
    '',
    '## User Message',
    '',
    renderOllamaUserInput(sections, cfg)
  ].filter(Boolean).join('\n\n');

  fs.mkdirSync(path.dirname(inputPath), { recursive: true });
  fs.writeFileSync(inputPath, body, 'utf-8');
  console.log(`📝 Ollama final input written to ${path.relative(projectRoot, inputPath)}`);
}

function writeCompressionChunkSnapshot(projectRoot, inputFilename, index, section, systemPrompt, tokenLimit, estimatedTokens) {
  const parsed = path.parse(inputFilename || 'ollama-input.md');
  const filename = `${parsed.name}-compression-${String(index + 1).padStart(3, '0')}${parsed.ext || '.md'}`;
  const inputPath = path.join(projectRoot, 'outputs', filename);
  const body = [
    systemPrompt || '',
    `# Ollama Compression Chunk ${index + 1}`,
    `Token limit: ${tokenLimit}`,
    `Estimated tokens for this request: ${estimatedTokens}`,
    '',
    serializeSection(section)
  ].filter(Boolean).join('\n\n');

  fs.mkdirSync(path.dirname(inputPath), { recursive: true });
  fs.writeFileSync(inputPath, body, 'utf-8');
  console.log(`📝 Ollama compression chunk written to ${path.relative(projectRoot, inputPath)}`);
}

module.exports._private = {
  buildExecutionChunks,
  datedOutputPath,
  estimateSectionsTokens,
  applyOutputHeader,
  extractFinalPrompt,
  labelledFileSection,
  splitTextByChars,
  renderOllamaUserInput,
  renderDocumentContent,
  normalizeSectionsForOllamaInput,
  jsonToPlaintext,
  loadChunkPrompt
};
