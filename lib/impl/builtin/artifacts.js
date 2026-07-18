const fs = require('fs');
const path = require('path');
const { resolveConfigPath } = require('../../utils/paths');

module.exports = {
  async run(ctx, engineCfg, personaCfg) {
    const projectRoot = personaCfg.__projectRoot || process.cwd();
    const outputType = engineCfg.outputType || 'artifact';
    const baseDir = resolveConfigPath(projectRoot, engineCfg.baseDir || engineCfg.location || './');
    const recurse = engineCfg.recurse === true;
    const basePrompt = resolveBasePrompt(projectRoot, engineCfg);
    const promptMode = (engineCfg.promptMode || engineCfg.prompt?.mode || 'replace').toLowerCase();
    const nowMs = Date.now();
    const lastRunKey = buildLastRunKey(projectRoot, baseDir, engineCfg, personaCfg);
    const cutoffMs = computeCutoff(nowMs, projectRoot, engineCfg, lastRunKey);
    console.log('reading',baseDir,basePrompt)
    if (hasWildcard(baseDir)) {
      const docs = listGlobDocs(baseDir, cutoffMs, engineCfg);
      if (docs.length) {
        ctx.passedFiles.push({
          name: engineCfg.name || path.basename(baseDir),
          sourceName: engineCfg.name,
          type: outputType,
          prompt: basePrompt,
          showFileName: engineCfg.showFileName === true,
          documents: docs
        });
      }
      if (engineCfg.sinceLastRun) writeLastRun(projectRoot, nowMs, lastRunKey);
      return;
    }

    if (existsFile(baseDir)) {
      if (!fileIsFreshForPeriod(baseDir, engineCfg, nowMs)) {
        console.log(`[artifacts] skipping ${baseDir}; not fresh for ${engineCfg.freshPeriod || engineCfg.onlyCurrentPeriod}`);
        if (engineCfg.sinceLastRun) writeLastRun(projectRoot, nowMs, lastRunKey);
        return;
      }
      const stats = safeStat(baseDir);
      const lastModified = stats ? Math.max(stats.mtimeMs, stats.birthtimeMs || 0) : 0;
      if (cutoffMs && lastModified < cutoffMs) {
        console.log(`[artifacts] skipping ${baseDir}; not updated since ${new Date(cutoffMs).toISOString()}`);
        if (engineCfg.sinceLastRun) writeLastRun(projectRoot, nowMs, lastRunKey);
        return;
      }
      const content = readText(baseDir);
      if (content.trim()) {
        ctx.passedFiles.push({
          name: engineCfg.name || path.basename(baseDir),
          sourceName: engineCfg.name,
          type: outputType,
          prompt: basePrompt,
          showFileName: engineCfg.showFileName === true,
          documents: [{
            filename: path.basename(baseDir),
            filetype: ext(baseDir),
            content,
            filePath: baseDir
          }]
        });
      }
      if (engineCfg.sinceLastRun) writeLastRun(projectRoot, nowMs, lastRunKey);
      return;
    }

    const dirs = collectDirs(baseDir, recurse);
    console.log('dirs:',JSON.stringify(dirs))
    for (const dir of dirs) {
      const helper = readHelper(dir);
      const prompt = mergePrompt(basePrompt, helper, promptMode);
      const docs = listDocs(dir, cutoffMs, engineCfg, baseDir);
      if (!docs.length && !helper) continue; // skip totally empty dirs
      ctx.passedFiles.push({
        name: path.relative(baseDir, dir) || path.basename(dir),
        sourceName: engineCfg.name,
        type: outputType,
        prompt,
        showFileName: engineCfg.showFileName === true,
        documents: docs
      });
    }

    // Record last run timestamp so sinceLastRun can pick it up next time
    if (engineCfg.sinceLastRun) writeLastRun(projectRoot, nowMs, lastRunKey);
  }
};

function computeCutoff(nowMs, projectRoot, engineCfg, lastRunKey) {
  let cutoff = null;

  const ms = Number(engineCfg.sinceMs);
  if (Number.isFinite(ms) && ms > 0) {
    cutoff = nowMs - ms;
  }

  // sinceHours: include files modified within the last N hours
  const hours = Number(engineCfg.sinceHours);
  if (Number.isFinite(hours) && hours > 0) {
    const value = nowMs - hours * 60 * 60 * 1000;
    cutoff = cutoff ? Math.max(cutoff, value) : value;
  }

  // sinceDays: include files modified within the last N days
  const days = Number(engineCfg.sinceDays);
  if (Number.isFinite(days) && days > 0) {
    const value = nowMs - days * 24 * 60 * 60 * 1000;
    cutoff = cutoff ? Math.max(cutoff, value) : value;
  }

  // sinceLastRun: include files modified since the previous run
  if (engineCfg.sinceLastRun) {
    const lastRun = readLastRun(projectRoot, lastRunKey);
    if (lastRun) cutoff = cutoff ? Math.max(cutoff, lastRun) : lastRun;
  }

  return cutoff;
}

function resolveBasePrompt(projectRoot, engineCfg = {}) {
  const inlinePrompt = typeof engineCfg.prompt === 'string'
    ? engineCfg.prompt
    : (engineCfg.prompt?.base || '');
  if (String(inlinePrompt || '').trim()) return inlinePrompt;
  if (!engineCfg.promptFile) return inlinePrompt || '';

  const promptPath = resolveConfigPath(projectRoot, engineCfg.promptFile);
  if (!fs.existsSync(promptPath)) throw new Error(`artifacts promptFile not found: ${promptPath}`);
  return fs.readFileSync(promptPath, 'utf8');
}

function listGlobDocs(globPath, cutoffMs, engineCfg = {}) {
  const dir = path.dirname(globPath);
  const pattern = path.basename(globPath);
  const matcher = wildcardMatcher(pattern);
  const allowedExts = normalizeExtensions(engineCfg.extensions || ['.md', '.txt', '.csv']);
  const sortMode = normalizeSortMode(engineCfg);
  const limit = Number(engineCfg.limit || engineCfg.maxFiles || 0);
  const candidates = [];

  for (const name of safeReaddir(dir)) {
    if (!matcher(name)) continue;
    const p = path.join(dir, name);
    const stats = safeStat(p);
    if (!stats || stats.isDirectory()) continue;
    if (!allowedExts.includes(path.extname(name).toLowerCase())) continue;
    if (!fileIsFreshForPeriod(p, engineCfg)) continue;
    candidates.push({ name, p, stats, lastModified: Math.max(stats.mtimeMs, stats.birthtimeMs || 0) });
  }

  const sorted = candidates.sort((a, b) => compareCandidates(a, b, sortMode));
  let selected = cutoffMs ? sorted.filter(item => item.lastModified >= cutoffMs) : sorted;
  if (!selected.length && cutoffMs && engineCfg.fallbackToLatest) selected = sorted.slice(0, 1);
  if (Number.isFinite(limit) && limit > 0) selected = selected.slice(0, limit);

  return selected.map(item => {
    const content = readText(item.p);
    console.log(`[artifacts] reading ${item.p}`);
    return {
      filename: item.name,
      filetype: ext(item.name),
      content,
      filePath: item.p,
      mtime: new Date(item.lastModified).toISOString()
    };
  }).filter(doc => String(doc.content || '').trim());
}

function hasWildcard(value) {
  return /[*?]/.test(String(value || ''));
}

function wildcardMatcher(pattern) {
  const regex = new RegExp(`^${wildcardToRegExp(pattern)}$`);
  return value => regex.test(value);
}

function wildcardToRegExp(pattern) {
  return String(pattern).split('').map(char => {
    if (char === '*') return '.*';
    if (char === '?') return '.';
    return char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }).join('');
}

function collectDirs(root, recurse) {
  const out = [root];
  if (!recurse) return out;
  for (const name of safeReaddir(root)) {
    const p = path.join(root, name);
    if (existsDir(p)) out.push(...collectDirs(p, true));
  }
  return out;
}

function listDocs(dir, cutoffMs, engineCfg = {}, baseDir = dir) {
  const allowedExts = normalizeExtensions(engineCfg.extensions || ['.md', '.txt', '.csv']);
  const sortMode = normalizeSortMode(engineCfg);
  const limit = Number(engineCfg.limit || engineCfg.maxFiles || 0);
  const candidates = [];

  for (const name of safeReaddir(dir)) {
    const p = path.join(dir, name);
    const stats = safeStat(p);
    if (!stats || stats.isDirectory()) continue;
    if (/^helper\.md$/i.test(name)) continue; // helper used as prompt
    if (!allowedExts.includes(path.extname(name).toLowerCase())) continue;
    if (!fileIsFreshForPeriod(p, engineCfg)) continue;
    const rel = path.relative(baseDir, p);
    if (!matchesConfiguredFiles(name, rel, engineCfg)) continue;
    candidates.push({ name, p, stats, lastModified: Math.max(stats.mtimeMs, stats.birthtimeMs || 0) });
  }

  const sorted = candidates.sort((a, b) => compareCandidates(a, b, sortMode));
  let selected = cutoffMs ? sorted.filter(item => item.lastModified >= cutoffMs) : sorted;
  if (!selected.length && cutoffMs && engineCfg.fallbackToLatest) selected = sorted.slice(0, 1);
  if (Number.isFinite(limit) && limit > 0) selected = selected.slice(0, limit);

  const docs = [];
  for (const item of selected) {
    const { name, p } = item;
    const content = readText(p);
    console.log(`[artifacts] reading ${p}`);
    docs.push({ filename: name, filetype: ext(name), content, filePath: p, mtime: new Date(item.lastModified).toISOString() });
  }
  return docs;
}

function compareCandidates(a, b, sortMode) {
  if (sortMode === 'modified-desc') {
    return b.lastModified - a.lastModified || compareNames(a.name, b.name);
  }
  if (sortMode === 'name-desc') return compareNames(b.name, a.name);
  if (sortMode === 'name-asc') return compareNames(a.name, b.name);
  return a.lastModified - b.lastModified || compareNames(a.name, b.name);
}

function normalizeSortMode(engineCfg = {}) {
  const raw = String(engineCfg.sortBy || engineCfg.sort || 'modified-asc').trim().toLowerCase();
  if (raw === 'filename' || raw === 'file' || raw === 'name' || raw === 'name-asc') return 'name-asc';
  if (raw === 'filename-desc' || raw === 'file-desc' || raw === 'name-desc') return 'name-desc';
  if (raw === 'date' || raw === 'modified' || raw === 'mtime' || raw === 'modified-asc' || raw === 'mtime-asc' || raw === 'oldest') return 'modified-asc';
  if (raw === 'date-desc' || raw === 'modified-desc' || raw === 'mtime-desc' || raw === 'newest') return 'modified-desc';
  return 'modified-asc';
}

function compareNames(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
}

function readHelper(dir) {
  for (const n of ['HELPER.md','helper.md','_helper.md']) {
    const p = path.join(dir, n);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return readText(p);
  }
  return '';
}

function mergePrompt(basePrompt, helperPrompt, mode) {
  if (mode === 'additive') return [basePrompt, helperPrompt].filter(Boolean).join('\n\n');
  if (mode === 'base') return basePrompt || '';
  if (mode === 'helper') return helperPrompt || basePrompt || '';
  // replace (default): helper overrides when present
  return helperPrompt || basePrompt || '';
}

function readText(p){ try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function safeReaddir(d){ try { return fs.readdirSync(d); } catch { return []; } }
function safeStat(p){ try { return fs.statSync(p); } catch { return null; } }
function existsDir(p){ try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function existsFile(p){ try { return fs.statSync(p).isFile(); } catch { return false; } }
function ext(n){ const i=n.lastIndexOf('.'); return i>-1?n.slice(i+1).toLowerCase():'txt'; }

function fileIsFreshForPeriod(filePath, engineCfg = {}, nowMs = Date.now()) {
  const period = String(engineCfg.freshPeriod || engineCfg.onlyCurrentPeriod || '').toLowerCase();
  if (!period) return true;
  const stat = safeStat(filePath);
  if (!stat) return false;
  const modifiedMs = Math.max(stat.mtimeMs || 0, stat.birthtimeMs || 0);
  return modifiedMs >= startOfPeriodMs(period, nowMs);
}

function startOfPeriodMs(period, nowMs) {
  const d = new Date(nowMs);
  if (period === 'day' || period === 'daily') {
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (period === 'week' || period === 'weekly') {
    d.setHours(0, 0, 0, 0);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d.getTime();
  }
  if (period === 'month' || period === 'monthly') {
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (period === 'quarter' || period === 'quarterly') {
    d.setMonth(Math.floor(d.getMonth() / 3) * 3, 1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  return 0;
}

function matchesConfiguredFiles(name, rel, engineCfg) {
  const include = normalizeList(engineCfg.include || engineCfg.files);
  const exclude = normalizeList(engineCfg.exclude);
  const normalizedRel = rel.split(path.sep).join('/');
  if (include.length && !include.some(p => p === name || p === normalizedRel)) return false;
  if (exclude.some(p => p === name || p === normalizedRel)) return false;
  return true;
}

function normalizeList(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).map(v => String(v).split(path.sep).join('/'));
}

function normalizeExtensions(value) {
  return normalizeList(value).map(ext => {
    const lower = ext.toLowerCase();
    return lower.startsWith('.') ? lower : `.${lower}`;
  });
}

function lastRunStatePath(projectRoot) {
  return path.join(projectRoot, '.artifacts-last-run.json');
}

function buildLastRunKey(projectRoot, baseDir, engineCfg = {}, personaCfg = {}) {
  if (engineCfg.lastRunKey || engineCfg.sinceLastRunKey) {
    return String(engineCfg.lastRunKey || engineCfg.sinceLastRunKey);
  }
  const configPath = personaCfg.__configPath || '';
  const engineName = engineCfg.name || engineCfg.outputType || engineCfg.engine || 'artifacts';
  const location = baseDir || resolveConfigPath(projectRoot, engineCfg.baseDir || engineCfg.location || './');
  return [
    configPath ? path.resolve(configPath) : path.resolve(projectRoot),
    engineName,
    path.resolve(location)
  ].join('::');
}

function readLastRunState(projectRoot) {
  const p = lastRunStatePath(projectRoot);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function readLastRun(projectRoot, lastRunKey) {
  const p = path.join(projectRoot, '.artifacts-last-run.json');
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const value = lastRunKey ? data.scopes?.[lastRunKey] : data.lastRun;
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
}

function writeLastRun(projectRoot, nowMs, lastRunKey) {
  const p = lastRunStatePath(projectRoot);
  try {
    const state = readLastRunState(projectRoot);
    const iso = new Date(nowMs).toISOString();
    state.lastRun = iso;
    state.scopes = state.scopes && typeof state.scopes === 'object' ? state.scopes : {};
    if (lastRunKey) state.scopes[lastRunKey] = iso;
    fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.warn('Unable to write .artifacts-last-run.json', err?.message || err);
  }
}

module.exports._private = {
  resolveBasePrompt,
  fileIsFreshForPeriod,
  startOfPeriodMs,
  computeCutoff,
  buildLastRunKey,
  readLastRun,
  writeLastRun,
  hasWildcard,
  wildcardMatcher,
  wildcardToRegExp,
  normalizeSortMode,
  compareCandidates,
  listGlobDocs
};
