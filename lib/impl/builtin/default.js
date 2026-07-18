const fs = require('fs');
const path = require('path');
const { resolveConfigPath } = require('../../utils/paths');
const { parseJson, renderDocument, renderJsonToMarkdown } = require('../../utils/jsonToMarkdown');

function formatTimestampForFilename(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate())
  ].join('') + '-' + [
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds())
  ].join('');
}

function withTimestampSuffix(filePath, timestamp) {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}-${timestamp}${parsed.ext}`);
}

function resolveOutputPath(filePath) {
  if (!fs.existsSync(filePath)) return filePath;
  const timestamp = formatTimestampForFilename();
  let candidate = withTimestampSuffix(filePath, timestamp);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = withTimestampSuffix(filePath, `${timestamp}-${index}`);
    index += 1;
  }
  return candidate;
}

module.exports = {
  async run(ctx, engineCfg, personaCfg) {
    const inputType = engineCfg.inputType; // optional
    const outputType = engineCfg.outputType || 'console';
    const filename = engineCfg.filename; // when outputType === 'file'
    const header = engineCfg.header || '';
    const footer = engineCfg.footer || '';
    const jsonToMarkdown = engineCfg.jsonToMarkdown === true;

    const items = Array.isArray(ctx.passedFiles) ? ctx.passedFiles : [];
    const selected = inputType ? items.filter(i => i.type === inputType) : items;

    if (outputType === 'file') {
      if (!filename) throw new Error('default responder: filename is required for outputType=file');
      const projectRoot = personaCfg.__projectRoot || process.cwd();
      const requestedPath = filename.startsWith('~')
        ? resolveConfigPath(projectRoot, filename)
        : path.isAbsolute(filename)
          ? filename
          : path.join(projectRoot, 'outputs', filename);

      const hasDocumentContent = selected.some(item =>
        (item.documents || []).some(d =>
          d?.json !== undefined || String(d?.content || '').trim().length > 0
        )
      );
      if (!hasDocumentContent) {
        return;
      }

      const lines = [];
      if (header) lines.push(header.trim(), '');
      for (const item of selected) {
        lines.push(`## ${item.name || item.type}`);
        for (const d of item.documents || []) {
          const label = d.filename ? ` (${d.filename})` : '';
          lines.push(`\n---\n`);
          lines.push(renderDocument(d, jsonToMarkdown));
          lines.push('');
        }
      }
      if (footer) lines.push('', footer.trim());
      const outPath = engineCfg.replace === true ? requestedPath : resolveOutputPath(requestedPath);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
      return;
    }

    // console output fallback
    console.log('=== AION default responder output ===');
    if (header) console.log(header);
    for (const item of selected) {
      console.log(`\n## ${item.name || item.type}`);
      for (const d of item.documents || []) {
        console.log(`\n--- ${d.filename || d.filetype || 'document'} ---`);
        console.log(d.content || '');
      }
    }
    if (footer) console.log('\n' + footer);
  }
};

module.exports._private = {
  parseJson,
  renderDocument,
  renderJsonToMarkdown
};
