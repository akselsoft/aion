const path = require('path');
const fs = require('fs');

// Wraps the core/sourceadapters/documents loader so it can be used
// as a collector in persona pipelines, pushing results into ctx.passedFiles.
module.exports = {
  async run(ctx, engineCfg, personaCfg) {
    const projectRoot = personaCfg?.__projectRoot || process.cwd();
    const debug = !!engineCfg.debug;
    
    // Support both 'location' and 'baseDir' for consistency with artifacts.js
    // Keep as relative path - the loader will join with projectRoot
    const location = engineCfg.location || engineCfg.baseDir || './';
    
    // Verify path exists relative to projectRoot
    const checkPath = path.resolve(projectRoot, location);
    
    if (debug) {
      console.log(`📂 [documents.collector] Project root: ${projectRoot}`);
      console.log(`📂 [documents.collector] Input location: ${location}`);
      console.log(`📂 [documents.collector] Resolved path: ${checkPath}`);
      console.log(`📂 [documents.collector] Exists: ${fs.existsSync(checkPath)}`);
    }

    const loader = require('../../../core/sourceadapters/documents');

    // Pass RELATIVE path to loader - it will join with projectRoot
    const sourceConfig = {
      type: 'documents',
      name: engineCfg.name || 'documents',
      location: location,  // Keep relative!
      recurse: !!engineCfg.recurse,
      format: engineCfg.format || 'md',
      config: engineCfg.config || {},
      prompt: engineCfg.prompt || '',
      debug: debug
    };

    if (debug) {
      console.log(`📂 [documents.collector] Recurse: ${sourceConfig.recurse}`);
      console.log(`📂 [documents.collector] Format: ${sourceConfig.format}`);
    }

    try {
      if (debug) console.log(`📂 [documents.collector] Calling loader with location="${location}"...`);
      
      const result = await loader(projectRoot, sourceConfig);

      if (debug) {
        if (!result) {
          console.error(`❌ [documents.collector] Loader returned null/undefined`);
        } else {
          console.log(`📂 [documents.collector] Loader returned:`, {
            hasDocuments: !!result.documents,
            docCount: result.documents ? result.documents.length : 0,
            name: result.name
          });
          
          if (result.documents && result.documents.length > 0) {
            console.log(`📂 [documents.collector] Loaded ${result.documents.length} document(s):`);
            result.documents.forEach((doc, idx) => {
              console.log(`  [${idx + 1}] ${doc.filename} (${doc.content ? doc.content.length : 0} chars)`);
            });
          }
        }
      }

      // Push as a single artifact bundle for downstream engines
      if (result && result.documents && result.documents.length > 0) {
        ctx.passedFiles.push({
          name: result.name,
          type: 'artifact',
          prompt: result.prompt,
          documents: result.documents
        });
        if (debug) {
          console.log(`✅ [documents.collector] Pushed ${result.documents.length} document(s) to ctx.passedFiles`);
        }
      } else {
        if (debug) {
          console.warn(`⚠️  [documents.collector] No documents to push. Result: ${result ? 'exists' : 'null'}`);
        }
      }
    } catch (err) {
      console.error(`❌ [documents.collector] Error: ${err.message}`);
      if (debug) {
        console.error(err.stack);
      }
    }
  }
};

