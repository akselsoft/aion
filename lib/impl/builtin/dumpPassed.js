// dumpPassed.js
// Engine that writes the current ctx.passedFiles array to a JSON file.
// Usable in collectors, interpreters, or responders.

const fs = require('fs');
const path = require('path');
const { resolveConfigPath } = require('../../utils/paths');
const { renderDocument, renderJsonToMarkdown } = require('../../utils/jsonToMarkdown');

function resolveOutputDir(projectRoot, personaCfg = {}, engineCfg = {}) {
  const configured = engineCfg.output || personaCfg.output || 'outputs';
  return resolveConfigPath(projectRoot, configured);
}

module.exports = {
  async run(ctx, engineCfg, personaCfg) {
    const projectRoot = personaCfg.__projectRoot || process.cwd();
    const outputType = engineCfg.outputType || 'passedFiles';
    const filename = `${outputType}.json`;
    const outPath = path.join(resolveOutputDir(projectRoot, personaCfg, engineCfg), filename);
    const debug = !!engineCfg.debug;
    
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const snapshot = ctx && Array.isArray(ctx.passedFiles) ? ctx.passedFiles : [];
    
    if (debug) {
      if (!ctx) {
        console.log(`🔍 [dumpPassed] No passed entries`);
      
      }
      console.log(`🔍 [dumpPassed] passedFiles is array: ${Array.isArray(ctx?.passedFiles)}`);
      console.log(`🔍 [dumpPassed] passedFiles length: ${snapshot.length}`);
      if (snapshot.length > 0) {
        snapshot.forEach((item, idx) => {
          const docCount = item.documents ? item.documents.length : 0;
      //     console.log(`  [${idx + 1}] ${item.name || 'unnamed'} (type: ${item.type}, docs: ${docCount})`);
        });
      }
    }
    
    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    console.log(`[dumpPassed] wrote ${snapshot.length} items to ${path.relative(projectRoot, outPath)}`);

    if (engineCfg.jsonToMarkdown === true) {
      const markdownFilename = engineCfg.markdownFilename || `${outputType}.md`;
      const markdownPath = path.join(resolveOutputDir(projectRoot, personaCfg, engineCfg), markdownFilename);
      fs.writeFileSync(markdownPath, renderPassedFilesToMarkdown(snapshot, outputType, {
        skipEmpty: engineCfg.skipEmpty === true
      }), 'utf-8');
      console.log(`[dumpPassed] wrote readable Markdown to ${path.relative(projectRoot, markdownPath)}`);
    }

    // Optionally keep a trace in passedFiles (non-destructive)
    if (engineCfg.emitArtifact) {
      ctx.passedFiles.push({
        name: engineCfg.name || outputType,
        type: outputType,
        prompt: engineCfg.prompt || 'Snapshot of passedFiles.',
        documents: [{ filename, content: JSON.stringify(snapshot, null, 2) }]
      });
    }
  }
};

function renderPassedFilesToMarkdown(snapshot, title = 'passedFiles', options = {}) {
  const lines = [`# ${title}`, ''];
  if (!snapshot.length) return `${lines.join('\n')}_No passed files._\n`;

  snapshot.forEach((item, itemIndex) => {
    lines.push(`## ${itemIndex + 1}. ${item.name || item.type || 'Unnamed item'}`, '');
    const itemMetadata = { ...item };
    delete itemMetadata.documents;
    if (Object.keys(itemMetadata).length) {
      lines.push(renderJsonToMarkdown(itemMetadata, 0, options), '');
    }

    const documents = Array.isArray(item.documents) ? item.documents : [];
    if (!documents.length) {
      lines.push('_No documents._', '');
      return;
    }

    documents.forEach((document, documentIndex) => {
      lines.push(`### ${documentIndex + 1}. ${document.filename || document.filetype || 'Document'}`, '');
      const documentMetadata = { ...document };
      delete documentMetadata.content;
      delete documentMetadata.json;
      if (Object.keys(documentMetadata).length) {
        lines.push(renderJsonToMarkdown(documentMetadata, 0, options), '');
      }
      lines.push(renderDocument(document, true, options), '');
    });
  });

  return `${lines.join('\n').trim()}\n`;
}

module.exports._private = {
  renderPassedFilesToMarkdown,
  resolveOutputDir
};
