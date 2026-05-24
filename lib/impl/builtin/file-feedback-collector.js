// file-feedback-collector.js
// Collector that reads user feedback from local files
// Useful for testing feedback loops before integrating email
// Reads .txt, .md, or .json files from a folder and converts to feedback sections

const fs = require('fs');
const path = require('path');

module.exports = {
  async run(ctx, engineCfg, personaCfg) {
    const projectRoot = personaCfg.__projectRoot || process.cwd();
    const feedbackDir = engineCfg.feedbackDir || path.join(projectRoot, 'feedback');
    const archiveDir = engineCfg.archiveDir || path.join(projectRoot, 'feedback', 'processed');
    const autoArchive = engineCfg.autoArchive !== false; // default true

    if (!fs.existsSync(feedbackDir)) {
      console.log(`ℹ️  Feedback directory does not exist: ${feedbackDir}`);
      return;
    }

    try {
      const files = fs.readdirSync(feedbackDir).filter(f => {
        const ext = path.extname(f).toLowerCase();
        return ['.txt', '.md', '.json'].includes(ext) && !f.startsWith('.');
      });

      if (files.length === 0) {
        console.log(`ℹ️  No feedback files found in ${feedbackDir}`);
        return;
      }

      console.log(`📝 Found ${files.length} feedback file(s).`);

      files.forEach((filename, idx) => {
        const filePath = path.join(feedbackDir, filename);
        const ext = path.extname(filename).toLowerCase();
        let content = '';
        let metadata = {};

        try {
          if (ext === '.json') {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            metadata = data.metadata || {};
            content = data.feedback || data.content || JSON.stringify(data, null, 2);
          } else {
            content = fs.readFileSync(filePath, 'utf-8');
          }

          ctx.passedFiles.push({
            name: `File Feedback #${idx + 1}`,
            type: 'user-feedback',
            prompt: metadata.prompt || `Feedback from file: ${filename}`,
            documents: [
              {
                filename,
                content,
              }
            ],
          });

          console.log(`✅ Added feedback from ${filename}`);

          // Archive processed file if configured
          if (autoArchive) {
            if (!fs.existsSync(archiveDir)) {
              fs.mkdirSync(archiveDir, { recursive: true });
            }
            const archivePath = path.join(archiveDir, filename);
            fs.renameSync(filePath, archivePath);
            console.log(`📦 Archived ${filename} to processed/`);
          }
        } catch (err) {
          console.error(`❌ Error processing feedback file ${filename}: ${err.message}`);
        }
      });
    } catch (err) {
      console.error(`❌ File feedback collector failed: ${err.message}`);
    }
  }
};
