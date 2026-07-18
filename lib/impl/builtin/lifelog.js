// Lifelog collector: scans directory roots and collects lightweight docs
const fs = require('fs');
const path = require('path');

const TEXT_EXT = new Set(['.md', '.txt', '.log', '.json', '.csv']);
const BINARY_EXT = new Set(['.docx', '.pptx', '.xlsx']);

function walk(dir) {
  const out = [];
  const entries = safeReadDir(dir);
  for (const name of entries) {
    const p = path.join(dir, name);
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) out.push(...walk(p));
    else out.push({ path: p, mtime: st.mtime });
  }
  return out;
}

function safeReadDir(d) { try { return fs.readdirSync(d); } catch { return []; } }

module.exports = {
  async run(ctx, cfg) {
    const roots = cfg.roots || (cfg.root ? [cfg.root] : []);
    const name = cfg.name || 'lifelog';
    const bundles = [];

    for (const r of roots) {
      const abs = path.resolve(process.cwd(), r);
      const files = walk(abs);
      const docs = [];
      for (const f of files) {
        const ext = path.extname(f.path).toLowerCase();
        if (TEXT_EXT.has(ext)) {
          let content = '';
          try { content = fs.readFileSync(f.path, 'utf8'); } catch {}
          docs.push({ filename: path.basename(f.path), filetype: ext.replace(/^\./,''), content, filePath: f.path, mtime: f.mtime.toISOString() });
        } else if (BINARY_EXT.has(ext)) {
          docs.push({ filename: path.basename(f.path), filetype: ext.replace(/^\./,''), content: '', filePath: f.path, mtime: f.mtime.toISOString() });
        }
      }
      bundles.push({ name: `${name}:${path.basename(abs)}`, type: 'lifelog', prompt: cfg.prompt || '', documents: docs });
    }

    if (bundles.length) ctx.passedFiles.push(...bundles);
  }
};

