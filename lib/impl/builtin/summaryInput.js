const fs = require('fs');
const path = require('path');
const { resolveConfigPath } = require('../../utils/paths');

module.exports = {
  async run(ctx, engineCfg, personaCfg) {
    const projectRoot = personaCfg.__projectRoot || process.cwd();
    const configName = engineCfg.configName || path.basename(personaCfg.__configPath || 'summary-input');
    const targetFile = required(engineCfg.targetFile, 'targetFile');
    const outputFile = required(engineCfg.outputFile, 'outputFile');
    const includePrompt = engineCfg.includePrompt !== false;
    const prompt = includePrompt ? loadPrompt(projectRoot, engineCfg) : '';
    const sections = Array.isArray(engineCfg.sections) ? engineCfg.sections : [];

    const timestamp = new Date();
    const timestampIso = timestamp.toISOString();
    const lines = [
      `# ${path.basename(outputFile)}`,
      '',
      '## Header',
      '',
      `- Timestamp: ${timestampIso}`,
      `- Config: ${configName}`,
      `- Target file: ${targetFile}`,
      ''
    ];

    for (const section of sections) {
      lines.push(`## ${section.title || section.name || 'Section'}`, '');
      const content = renderSection(ctx, projectRoot, section);
      lines.push(content || section.emptyText || '_Not present._', '');
    }

    if (includePrompt) {
      lines.push('## PROMPT', '', prompt.trim(), '');
    }

    const outPath = resolveProjectPath(projectRoot, outputFile);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const content = lines.join('\n');
    fs.writeFileSync(outPath, content, 'utf8');

    const historyDir = resolveProjectPath(projectRoot, engineCfg.historyDir || './history/inputs');
    const historyPath = path.join(historyDir, historyFilename(outputFile, timestamp));
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(historyPath, content, 'utf8');

    const archivedSources = archiveSources(ctx, projectRoot, engineCfg, timestamp);

    ctx.passedFiles.push({
      name: configName,
      type: engineCfg.outputType || 'summary-input',
      prompt: engineCfg.artifactPrompt || '',
      documents: [{ filename: path.basename(outputFile), filetype: 'md', content, filePath: outPath, historyPath, archivedSources }]
    });
  }
};

function historyFilename(outputFile, timestamp) {
  const parsed = path.parse(outputFile);
  const stamp = timestamp.toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
    .replace('T', '-');
  return `${parsed.name}-${stamp}${parsed.ext || '.md'}`;
}

function archiveSources(ctx, projectRoot, engineCfg, timestamp) {
  const sourceNames = Array.isArray(engineCfg.archiveSources) ? engineCfg.archiveSources : [];
  if (!sourceNames.length) return [];

  const archiveRoot = resolveProjectPath(projectRoot, engineCfg.sourceArchiveDir || './history/raw');
  const runDir = path.join(archiveRoot, runStamp(timestamp));
  const archived = [];
  const items = Array.isArray(ctx.passedFiles) ? ctx.passedFiles : [];

  for (const item of items) {
    if (!sourceNames.includes(item.sourceName) && !sourceNames.includes(item.name)) continue;
    for (const doc of item.documents || []) {
      if (!doc.filePath || !fs.existsSync(doc.filePath)) continue;
      const relName = doc.filename || path.basename(doc.filePath);
      const dest = uniquePath(path.join(runDir, relName));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(doc.filePath, dest);
      archived.push({ source: item.sourceName || item.name, from: doc.filePath, to: dest });
    }
  }

  for (const sourceName of sourceNames) {
    const source = items.find(item => item.sourceName === sourceName || item.name === sourceName);
    if (!source) continue;
    const dirs = (source.documents || [])
      .map(doc => doc.filePath ? path.dirname(doc.filePath) : null)
      .filter(Boolean);
    for (const dir of new Set(dirs)) {
      if (fs.existsSync(dir)) fs.writeFileSync(path.join(dir, '.gitkeep'), '\n', 'utf8');
    }
  }

  return archived;
}

function runStamp(timestamp) {
  return timestamp.toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
    .replace('T', '-');
}

function uniquePath(filePath) {
  if (!fs.existsSync(filePath)) return filePath;
  const parsed = path.parse(filePath);
  let index = 1;
  let candidate;
  do {
    candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  } while (fs.existsSync(candidate));
  return candidate;
}

function loadPrompt(projectRoot, engineCfg) {
  if (engineCfg.promptFile) {
    const promptPath = resolveProjectPath(projectRoot, engineCfg.promptFile);
    if (!fs.existsSync(promptPath)) throw new Error(`summaryInput promptFile not found: ${promptPath}`);
    return fs.readFileSync(promptPath, 'utf8');
  }
  return required(engineCfg.prompt, 'prompt');
}

function renderSection(ctx, projectRoot, section) {
  if (section.source) return renderPassedFiles(ctx, section);
  if (section.kind === 'folder') return renderFolder(projectRoot, section);
  return renderFile(projectRoot, section);
}

function renderPassedFiles(ctx, section) {
  const items = Array.isArray(ctx.passedFiles) ? ctx.passedFiles : [];
  const selected = items.filter(item =>
    item.name === section.source ||
    item.sourceName === section.source ||
    item.type === section.source ||
    (Array.isArray(section.sources) && section.sources.includes(item.name))
  );

  const parts = [];
  for (const item of selected) {
    const docs = Array.isArray(item.documents) ? item.documents : [];
    for (const doc of docs) {
      const content = String(doc.content || '').trim();
      if (!content) continue;
      const title = doc.filename || item.name || 'document';
      parts.push(`### ${title}`, '', '```markdown', content, '```');
    }
  }
  return parts.join('\n\n');
}

function renderFile(projectRoot, section) {
  const filePath = resolveProjectPath(projectRoot, required(section.path, 'section.path'));
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return '';
  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) return '';
  return ['```markdown', content, '```'].join('\n');
}

function renderFolder(projectRoot, section) {
  const folderPath = resolveProjectPath(projectRoot, required(section.path, 'section.path'));
  if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) return '';

  const extensions = (section.extensions || ['.md', '.txt', '.csv', '.log', '.eml'])
    .map(ext => ext.toLowerCase().startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`);
  const files = listFiles(folderPath, section.recurse !== false, extensions)
    .sort((a, b) => {
      const aStat = fs.statSync(a);
      const bStat = fs.statSync(b);
      const byModified = aStat.mtimeMs - bStat.mtimeMs;
      return byModified || a.localeCompare(b);
    });

  if (!files.length) return '';

  const parts = [];
  for (const filePath of files) {
    const rel = path.relative(folderPath, filePath);
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content) continue;
    parts.push(`### ${rel}`, '', '```markdown', content, '```');
  }
  return parts.join('\n\n');
}

function listFiles(dir, recurse, extensions) {
  const out = [];
  for (const name of safeReaddir(dir)) {
    const full = path.join(dir, name);
    const stat = safeStat(full);
    if (!stat) continue;
    if (stat.isDirectory() && recurse) {
      out.push(...listFiles(full, true, extensions));
    } else if (stat.isFile() && extensions.includes(path.extname(name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

function resolveProjectPath(projectRoot, value) {
  return resolveConfigPath(projectRoot, value);
}

function required(value, name) {
  if (!value) throw new Error(`summaryInput requires ${name}`);
  return value;
}

function safeReaddir(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

function safeStat(filePath) {
  try { return fs.statSync(filePath); } catch { return null; }
}
