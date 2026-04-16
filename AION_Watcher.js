#!/usr/bin/env node
// Polling-based watcher that runs runner.js when files change inside a folder.
// Accepts (legacy): watchDir, configPath
// Map mode: watchDir, mapPath (JSON array of { folder, config, ignore?, include?, requireFiles? })
// Optional flags: {intervalMs, debounceMs, ignore}

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DEFAULT_INTERVAL_MS = 1500; // how often to scan for changes
const DEFAULT_DEBOUNCE_MS = 750; // delay to coalesce rapid edits
const DEFAULT_IGNORE = ['node_modules', '.git', '.DS_Store', 'tmp', 'dist'];

function shouldIgnore(name, ignoreList) {
    return ignoreList.some((pat) => name === pat || name.startsWith(`${pat}/`));
}

function shouldInclude(rel, includeList) {
    if (!includeList || includeList.length === 0) return true;
    return includeList.some((pat) => rel === pat || rel.startsWith(`${pat}/`));
}

async function hashTree(root, ignoreList, includeList = []) {
    const entries = [];
    if (!fs.existsSync(root)) {
        return crypto.createHash('sha1').update('missing').digest('hex');
    }

    async function walk(current, relBase = '') {
        const dirEntries = await fs.promises.readdir(current, { withFileTypes: true });
        for (const entry of dirEntries) {
            if (shouldIgnore(entry.name, ignoreList)) continue;
            const abs = path.join(current, entry.name);
            const rel = path.join(relBase, entry.name);

            // Skip symlinks to avoid cycles
            if (entry.isSymbolicLink()) continue;

            if (entry.isDirectory()) {
                await walk(abs, rel);
            } else if (entry.isFile()) {
                const relNormalized = rel.split(path.sep).join('/');
                if (!shouldInclude(relNormalized, includeList)) continue;
                const stat = await fs.promises.stat(abs);
                entries.push(`${rel}|${stat.size}|${stat.mtimeMs}`);
            }
        }
    }

    await walk(root);
    const hash = crypto.createHash('sha1');
    for (const part of entries.sort()) {
        hash.update(part);
    }
    return hash.digest('hex');
}

async function countTreeFiles(root, ignoreList, includeList = []) {
    let count = 0;
    if (!fs.existsSync(root)) return count;

    async function walk(current, relBase = '') {
        const dirEntries = await fs.promises.readdir(current, { withFileTypes: true });
        for (const entry of dirEntries) {
            if (shouldIgnore(entry.name, ignoreList)) continue;
            const abs = path.join(current, entry.name);
            const rel = path.join(relBase, entry.name);
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory()) {
                await walk(abs, rel);
            } else if (entry.isFile()) {
                const relNormalized = rel.split(path.sep).join('/');
                if (shouldInclude(relNormalized, includeList)) count += 1;
            }
        }
    }

    await walk(root);
    return count;
}

function startWatcher(watchDir, configPath, options = {}) {
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    const ignore = options.ignore ?? DEFAULT_IGNORE;

    // Map mode detection: if configPath JSON parses into an array of objects with folder+config keys
    const mapMode = isMapFile(configPath);

    // State for sequential job processing
    const runnerPath = path.resolve(__dirname, 'runner.js');
    const queue = [];
    let running = false;

    function enqueueRun(absConfig) {
        // de-dupe queued configs
        if (queue.includes(absConfig)) return;
        queue.push(absConfig);
        processQueue();
    }

    function processQueue() {
        if (running) return;
        const next = queue.shift();
        if (!next) return;
        running = true;
        const child = spawn(process.execPath, [runnerPath, next], {
            stdio: 'inherit',
            env: { ...process.env }
        });
        child.on('exit', (code, signal) => {
            running = false;
            if (code !== 0) {
                console.error(`runner.js exited with code ${code}${signal ? ` (signal ${signal})` : ''}`);
            }
            processQueue();
        });
    }

    if (!mapMode) {
        // Legacy single-config mode
        let baselineHash = null;
        let timer = null;
        let debounceTimer = null;
        const resolvedConfig = path.resolve(configPath);

        async function triggerRun() {
            enqueueRun(resolvedConfig);
        }

        function scheduleRun() {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(triggerRun, debounceMs);
        }

        async function tick() {
            try {
                const currentHash = await hashTree(watchDir, ignore);
                if (baselineHash && currentHash !== baselineHash) {
                    scheduleRun();
                }
                baselineHash = currentHash;
            } catch (err) {
                console.error(`Watcher error: ${err.message}`);
            }
        }

        async function start() {
            baselineHash = await hashTree(watchDir, ignore);
            timer = setInterval(tick, intervalMs);
        }

        start();

        return {
            stop() {
                if (timer) clearInterval(timer);
                if (debounceTimer) clearTimeout(debounceTimer);
            },
            isRunning: () => running
        };
    }

    // Map mode: watch multiple folders and trigger only their mapped configs
    const mapEntries = loadMap(configPath, watchDir);
    const timers = [];

    async function tickEntry(entry) {
        try {
            const currentHash = await hashTree(entry.folderAbs, entry.ignore, entry.include);
            if (entry.baselineHash && currentHash !== entry.baselineHash) {
                const shouldRun = !entry.requireFiles ||
                    (await countTreeFiles(entry.folderAbs, entry.ignore, entry.include)) > 0;
                if (shouldRun) {
                    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
                    entry.debounceTimer = setTimeout(() => enqueueRun(entry.configAbs), debounceMs);
                }
            }
            entry.baselineHash = currentHash;
        } catch (err) {
            console.error(`Watcher error (${entry.folderAbs}): ${err.message}`);
        }
    }

    async function startMap() {
        // initialize baselines
        await Promise.all(mapEntries.map(async (entry) => {
            entry.baselineHash = await hashTree(entry.folderAbs, entry.ignore, entry.include);
        }));
        for (const entry of mapEntries) {
            const t = setInterval(() => tickEntry(entry), intervalMs);
            timers.push(t);
        }
    }

    startMap();

    return {
        stop() {
            timers.forEach(clearInterval);
            mapEntries.forEach(e => clearTimeout(e.debounceTimer));
        },
        isRunning: () => running
    };
}

function isMapFile(p) {
    try {
        const full = path.resolve(p);
        const raw = fs.readFileSync(full, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) && parsed.every(item => item.folder && item.config);
    } catch {
        return false;
    }
}

function loadMap(mapPath, watchDir) {
    const full = path.resolve(mapPath);
    const baseDir = path.dirname(full);
    const raw = fs.readFileSync(full, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('watch-map must be an array');
    return parsed.map((entry) => {
        const folderAbs = path.isAbsolute(entry.folder)
            ? entry.folder
            : path.resolve(watchDir, entry.folder);
        const configAbs = path.isAbsolute(entry.config)
            ? entry.config
            : path.resolve(baseDir, entry.config);
        const entryIgnore = Array.isArray(entry.ignore)
            ? [...DEFAULT_IGNORE, ...entry.ignore]
            : DEFAULT_IGNORE;
        const include = Array.isArray(entry.include)
            ? entry.include.map(p => String(p).split(path.sep).join('/'))
            : [];
        return { folderAbs, configAbs, ignore: entryIgnore, include, requireFiles: entry.requireFiles === true, baselineHash: null, debounceTimer: null };
    });
}

if (require.main === module) {
    const [watchDirArg, configArg] = process.argv.slice(2);
    if (!watchDirArg || !configArg) {
        console.error('Usage: node AION_Watcher.js <watchDir> <configPath|mapPath> [--interval=ms] [--debounce=ms]');
        process.exit(1);
    }

    const opts = {};
    for (const arg of process.argv.slice(4)) {
        if (arg.startsWith('--interval=')) opts.intervalMs = Number(arg.split('=')[1]);
        if (arg.startsWith('--debounce=')) opts.debounceMs = Number(arg.split('=')[1]);
    }

    const watchDir = path.resolve(watchDirArg);
    const configPath = path.resolve(configArg);

    if (isMapFile(configPath)) {
        console.log(`Watching ${watchDir} with map ${configPath}`);
    } else {
        console.log(`Watching ${watchDir} for changes...`);
        console.log(`Will run runner.js with config ${configPath} on change.`);
    }

    const watcher = startWatcher(watchDir, configPath, opts);

    const shutdown = () => {
        console.log('\nStopping watcher');
        watcher.stop();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

module.exports = { startWatcher };
