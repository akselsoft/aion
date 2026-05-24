// dumpPassed.js
// Engine that writes the current ctx.passedFiles array to a JSON file.
// Usable in collectors, interpreters, or responders.

const fs = require('fs');
const path = require('path');

module.exports = {
  async run(ctx, engineCfg, personaCfg) {
    const projectRoot = personaCfg.__projectRoot || process.cwd();
    const outputType = engineCfg.outputType || 'passedFiles';
    const filename = `${outputType}.json`;
    const outPath = path.join(projectRoot, 'outputs', filename);
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
