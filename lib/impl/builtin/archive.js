const fs = require('fs');
const path = require('path');

module.exports = {
  async run(ctx, cfg = {}, personaCfg = {}) {
    const projectRoot = personaCfg.__projectRoot || process.cwd();
    const baseOut = cfg.outDir ? toAbs(projectRoot, cfg.outDir) : path.join(projectRoot, 'outputs', 'archive');
    const runId = cfg.runId || new Date().toISOString().replace(/[-:]/g, '').slice(0,15);
    const label = cfg.label ? `-${slug(cfg.label)}` : '';
    const outDir = path.join(baseOut, `run-${runId}${label}`);
    const includeTypes = Array.isArray(cfg.includeTypes) ? new Set(cfg.includeTypes) : null;
    const redact = cfg.redact === 'content';
    const writeDocs = cfg.writeDocs !== false; // default true

    ensureDir(outDir);

    // Snapshot JSON of passed files
    const snapshot = (ctx.passedFiles || []).filter(it => !includeTypes || includeTypes.has(it.type));
    const jsonSafe = snapshot.map(item => ({
      ...item,
      documents: (item.documents || []).map(d => ({
        ...d,
        content: redact ? undefined : (d.content || '')
      }))
    }));

    fs.writeFileSync(path.join(outDir, 'passedFiles.json'), JSON.stringify(jsonSafe, null, 2), 'utf8');

    if (writeDocs) {
      let idx = 0;
      for (const item of snapshot) {
        const itemDir = path.join(outDir, `${pad(++idx)}-${slug(item.name || item.type || 'bundle')}`);
        ensureDir(itemDir);
        for (const d of (item.documents || [])) {
          if (redact) continue;
          if (!d.content) continue;
          const filename = d.filename || d.name || `doc-${Math.random().toString(36).slice(2)}.${d.filetype || 'txt'}`;
          const target = path.join(itemDir, filename);
          ensureDir(path.dirname(target));
          fs.writeFileSync(target, String(d.content), 'utf8');
        }
      }
    }
  }
};

function ensureDir(d){ try { fs.mkdirSync(d, { recursive: true }); } catch {} }
function toAbs(root, p){ return path.isAbsolute(p) ? p : path.join(root, p); }
function pad(n){ return String(n).padStart(3,'0'); }
function slug(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
