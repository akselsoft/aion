const fs = require('fs/promises');
const fssync = require('fs');
const path = require('path');

// External deps (installed via package.json):
// - mammoth: DOCX -> HTML
// - turndown: HTML -> Markdown
// - pdf-parse: PDF -> text
// - xlsx: XLSX -> CSV/JSON (sheets)
// NOTE: Some environments abort when requiring optional native modules.
// To avoid startup crashes we lazy-load inside converters.
let mammoth, TurndownService, pdfParse, XLSX;

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
}

async function readFilesRecursively(folder, extensions) {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      const nested = await readFilesRecursively(fullPath, extensions);
      files.push(...nested);
    } else if (extensions.some(ext => entry.name.toLowerCase().endsWith(ext))) {
      files.push(fullPath);
    }
  }
  return files;
}

function resolvePrompt(folderPath, sourceConfig, files) {
  const promptMode = (sourceConfig.prompt?.mode || sourceConfig.promptMode || 'replace').toLowerCase();
  const basePrompt = typeof sourceConfig.prompt === 'string'
    ? sourceConfig.prompt
    : (sourceConfig.prompt?.base || '');

  let helperPrompt = '';
  if (files.includes('helper.md')) {
    helperPrompt = fssync.readFileSync(path.join(folderPath, 'helper.md'), 'utf-8');
  }

  if (promptMode === 'additive') return [basePrompt, helperPrompt].filter(Boolean).join('\n\n');
  if (promptMode === 'base') return basePrompt;
  if (promptMode === 'helper') return helperPrompt || basePrompt;
  return helperPrompt || basePrompt; // default 'replace'
}

async function convertDocxToMarkdown(filePath) {
  if (!mammoth) { try { mammoth = require('mammoth'); } catch {} }
  if (!TurndownService) { try { TurndownService = require('turndown'); } catch {} }
  if (mammoth && TurndownService) {
    const { value: html } = await mammoth.convertToHtml({ path: filePath });
    const turndown = new TurndownService({ headingStyle: 'atx', emDelimiter: '*', bulletListMarker: '-' });
    const md = turndown.turndown(html);
    return md;
  }
  // Fallback path using system `unzip` + naive XML -> text
  const { execFile } = require('child_process');
  const execFileAsync = (cmd, args) => new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
  const xml = await execFileAsync('unzip', ['-p', filePath, 'word/document.xml']);
  // Basic cleanup: replace block tags with newlines, strip other tags, decode common entities
  let text = xml
    .replace(/<w:p[^>]*>/g, '\n')
    .replace(/<br[^>]*\/>/g, '\n')
    .replace(/<w:tab[^>]*\/>/g, '    ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
  text = text.split('\n').map(l => l.trimEnd()).join('\n');
  // Minimal Markdown: collapse multiple blank lines
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

async function convertPdfToMarkdown(filePath) {
  if (!pdfParse) { try { pdfParse = require('pdf-parse'); } catch {} }
  if (!pdfParse) throw new Error('Missing dependency: pdf-parse');
  const dataBuffer = await fs.readFile(filePath);
  const data = await pdfParse(dataBuffer);
  const lines = [`# ${path.basename(filePath)}`, '', data.text.trim()];
  return lines.join('\n');
}

function sanitizeSheetName(name) {
  return (name || 'Sheet')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function csvToMarkdownTable(csvText) {
  const rows = csvText.split(/\r?\n/).filter(r => r.length > 0);
  if (rows.length === 0) return '';
  // Split CSV respecting simple quoted fields
  const parseRow = (row) => {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '"') {
        if (inQuotes && row[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map(v => v.trim());
  };
  const cells = rows.map(parseRow);
  const colCount = Math.max(...cells.map(r => r.length));
  const pad = (row) => Array.from({ length: colCount }, (_, i) => (row[i] ?? '')); 
  const padded = cells.map(pad);
  const header = padded[0];
  const sep = header.map(() => '---');
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...padded.slice(1).map(r => `| ${r.join(' | ')} |`)
  ];
  return lines.join('\n');
}

async function convertXlsxToOutputs(filePath, excelFormat = 'md') {
  if (!XLSX) { try { XLSX = require('xlsx'); } catch {} }
  if (!XLSX) throw new Error('Missing dependency: xlsx');
  const wb = XLSX.read(await fs.readFile(filePath));
  const outputs = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    // Use SheetJS to get CSV; then convert to MD table when requested
    const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ',', RS: '\n' });
    const safeName = sanitizeSheetName(sheetName);
    if (excelFormat === 'csv') {
      outputs.push({ sheetName: safeName, ext: '.csv', content: csv });
    } else {
      const md = csvToMarkdownTable(csv);
      // Prepend a header with sheet name and file name for context
      const header = `# ${path.basename(filePath)} — ${sheetName}`;
      const body = md ? `${header}\n\n${md}\n` : `${header}\n\n_(empty sheet)_\n`;
      outputs.push({ sheetName: safeName, ext: '.md', content: body });
    }
  }
  return outputs;
}

module.exports = async function loadDocumentsSource(projectRoot, sourceConfig) {
  const folderPath = path.join(projectRoot, sourceConfig.location);
  const copyToArtifacts = !!sourceConfig.config?.copyToArtifacts;
  const recurse = !!sourceConfig.recurse;
  const targetFormat = (sourceConfig.format || sourceConfig.target || 'md').toLowerCase(); // 'md' or 'json'

  const files = await fs.readdir(folderPath).catch(() => []);
  const promptText = resolvePrompt(folderPath, sourceConfig, files);

  // Identify candidate files
  // Include Markdown/text so existing .md/.txt artifacts are ingested alongside converted binaries
  const allowed = ['.docx', '.pdf', '.xlsx', '.md', '.txt'];
  let filePaths;
  if (recurse) {
    filePaths = await readFilesRecursively(folderPath, allowed);
  } else {
    filePaths = (await fs.readdir(folderPath))
      .filter(name => allowed.some(ext => name.toLowerCase().endsWith(ext)))
      .map(name => path.join(folderPath, name));
  }

  const documents = [];
  const logFilePath = path.join(folderPath, 'collector.log');
  const logData = await fs.readFile(logFilePath, 'utf-8').catch(() => '');
  const logEntries = logData.split('\n').filter(Boolean).map(line => {
    const [file, date] = line.split('|');
    return { file, date: new Date(date) };
  });

  const artifactsDir = path.join(projectRoot, 'shared', 'artifacts', sourceConfig.name || 'documents');
  if (copyToArtifacts) await ensureDir(artifactsDir);

  for (const filePath of filePaths) {
    const stat = await fs.stat(filePath);
    const mtime = stat.mtime;
    const isNew = !logEntries.some(e => e.file === filePath && e.date >= mtime);
    if (!isNew) continue;

    // Process conversion
    const ext = path.extname(filePath).toLowerCase();
    let contentMd = '';
    try {
      if (ext === '.docx') {
        contentMd = await convertDocxToMarkdown(filePath);
        // Prepare output shape (DOCX honors targetFormat md/json)
        let content;
        let outExt;
        if (targetFormat === 'json') {
          content = JSON.stringify({ filename: path.basename(filePath), path: path.relative(folderPath, filePath), markdown: contentMd }, null, 2);
          outExt = '.json';
        } else {
          content = contentMd;
          outExt = '.md';
        }
        const rel = path.relative(folderPath, filePath);
        const base = rel.replace(/\.(docx)$/i, '');
        const outName = base + outExt;
        if (copyToArtifacts) {
          const outPath = path.join(artifactsDir, outName);
          await ensureDir(path.dirname(outPath));
          await fs.writeFile(outPath, content, 'utf-8');
        }
        documents.push({ filename: outName, content });
      } else if (ext === '.pdf') {
        try {
          contentMd = await convertPdfToMarkdown(filePath);
        } catch (pdfErr) {
          console.warn(`PDF conversion unavailable for ${filePath}: ${pdfErr.message}`);
          continue; // skip PDFs if dependency missing
        }
        // Prepare output shape (PDF honors targetFormat md/json)
        let content;
        let outExt;
        if (targetFormat === 'json') {
          content = JSON.stringify({ filename: path.basename(filePath), path: path.relative(folderPath, filePath), markdown: contentMd }, null, 2);
          outExt = '.json';
        } else {
          content = contentMd;
          outExt = '.md';
        }
        const rel = path.relative(folderPath, filePath);
        const base = rel.replace(/\.(pdf)$/i, '');
        const outName = base + outExt;
        if (copyToArtifacts) {
          const outPath = path.join(artifactsDir, outName);
          await ensureDir(path.dirname(outPath));
          await fs.writeFile(outPath, content, 'utf-8');
        }
        documents.push({ filename: outName, content });
      } else if (ext === '.xlsx') {
        // Excel: split into per-sheet outputs as MD tables or CSV files
        const excelFormat = (sourceConfig.config?.excelFormat || 'md').toLowerCase(); // 'md' or 'csv'
        if (!XLSX) {
          console.warn(`XLSX conversion unavailable for ${filePath}: missing 'xlsx' dependency`);
          continue;
        }
        const rel = path.relative(folderPath, filePath);
        const base = rel.replace(/\.(xlsx)$/i, '');
        const outputs = await convertXlsxToOutputs(filePath, excelFormat);
        for (const out of outputs) {
          const outName = `${base}__${out.sheetName}${out.ext}`;
          if (copyToArtifacts) {
            const outPath = path.join(artifactsDir, outName);
            await ensureDir(path.dirname(outPath));
            await fs.writeFile(outPath, out.content, 'utf-8');
          }
          documents.push({ filename: outName, content: out.content });
        }
      } else {
        continue;
      }
    } catch (err) {
      console.warn(`Failed converting ${filePath}: ${err.message}`);
      continue;
    }

    await fs.appendFile(logFilePath, `${filePath}|${mtime.toISOString()}\n`);
  }

  return {
    name: sourceConfig.name || path.basename(sourceConfig.location),
    type: sourceConfig.type || 'documents',
    prompt: promptText,
    documents
  };
};
