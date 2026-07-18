const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HOME = process.env.HOME ? path.resolve(process.env.HOME) : null;

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'outputs',
  'history',
  'artifacts',
  'debug',
  'dist'
]);

function expandHome(value) {
  const text = String(value || '');
  if (text === '~') return HOME || text;
  if (text.startsWith('~/')) return path.join(HOME || '', text.slice(2));
  return text;
}

function isInside(base, full) {
  if (!base) return false;
  const relative = path.relative(base, full);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safePath(value) {
  const expanded = expandHome(value);
  const full = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(ROOT, expanded);

  if (!isInside(ROOT, full) && !isInside(HOME, full)) {
    throw new Error(`Path is outside the workspace or home folder: ${value}`);
  }
  return full;
}

function relativePath(full) {
  const resolved = path.resolve(full);
  return isInside(ROOT, resolved) ? path.relative(ROOT, resolved) : resolved;
}

function walkJsonFiles(dir = ROOT, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.env') continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkJsonFiles(path.join(dir, entry.name), out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function classifyJsonFile(fullPath) {
  const rel = relativePath(fullPath);
  if (rel.includes('package-lock.json') || rel.endsWith('.state.json')) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    if (Array.isArray(parsed)) {
      const looksWatch = rel.endsWith('watch-map.json') ||
        parsed.some(item => item && typeof item === 'object' && (item.config || item.path || item.type === 'schedule'));
      return looksWatch ? 'watch' : null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    if (rel.endsWith('watch-map.json')) return 'watch';
    if (parsed.params || parsed.persona || parsed.implementation || parsed.sources || parsed.engines || parsed.queries) {
      return 'config';
    }
  } catch {
    return null;
  }
  return null;
}

function listFiles(kind) {
  return walkJsonFiles()
    .map(fullPath => ({ fullPath, kind: classifyJsonFile(fullPath) }))
    .filter(file => file.kind && (!kind || file.kind === kind))
    .map(file => ({
      path: relativePath(file.fullPath),
      name: path.basename(file.fullPath),
      kind: file.kind
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function readJsonFile(filePath) {
  const full = safePath(filePath);
  const text = fs.readFileSync(full, 'utf-8');
  return { path: relativePath(full), data: JSON.parse(text), text };
}

function readLanguageFile(filePath) {
  const full = safePath(filePath);
  const text = fs.readFileSync(full, 'utf-8');
  const data = JSON.parse(text);
  return { path: relativePath(full), data, text };
}

function writeJsonFile(filePath, data) {
  const full = safePath(filePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  return { ok: true, path: relativePath(full) };
}

function listEngines() {
  const roots = [
    { dir: path.join(ROOT, 'lib', 'impl', 'builtin'), mode: 'builtin' },
    { dir: path.join(ROOT, 'core', 'engines'), mode: 'core' },
    { dir: path.join(ROOT, 'implementations', 'deacon', 'engines'), mode: 'path' },
    { dir: path.join(ROOT, 'implementations', 'common', 'engines'), mode: 'path' }
  ];

  const engines = [];
  for (const root of roots) {
    if (!fs.existsSync(root.dir)) continue;
    for (const file of fs.readdirSync(root.dir)) {
      if (!file.endsWith('.js') || file.endsWith('.test.js')) continue;
      const base = file.replace(/\.js$/, '');
      const rel = relativePath(path.join(root.dir, file));
      engines.push({
        label: `${base} (${root.mode})`,
        value: root.mode === 'path' ? `./${rel}` : base,
        path: rel,
        source: root.mode,
        codeType: 'js'
      });
    }
  }

  const seen = new Set();
  return engines
    .filter(engine => {
      const key = `${engine.value}:${engine.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function runConfig(configPath) {
  return new Promise((resolve) => {
    safePath(configPath);
    const child = spawn(process.execPath, ['runner.js', configPath], {
      cwd: ROOT,
      env: process.env
    });
    let output = '';
    const append = chunk => {
      output += chunk.toString();
      if (output.length > 120000) output = output.slice(-120000);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      output += '\n[UI] Run timed out after 5 minutes.\n';
    }, 5 * 60 * 1000);
    child.on('close', code => {
      clearTimeout(timeout);
      resolve({ code, output });
    });
  });
}

module.exports = {
  ROOT,
  classifyJsonFile,
  listEngines,
  listFiles,
  readLanguageFile,
  readJsonFile,
  relativePath,
  runConfig,
  safePath,
  writeJsonFile
};
