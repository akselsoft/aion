#!/usr/bin/env node
// Polling-based watcher that runs runner.js when files change inside a folder.
// Accepts (legacy): watchDir, configPath
// Map mode: watchDir, mapPath (JSON array of folder entries and idle-time entries)
// All map entries may set benchmark: true and watchConfigChanges: true.
// Folder entry: { folder, config, interval?, intervalType?, ignore?, include?, runOnEmpty?, requireFiles?, maxRunsPerPeriod?, period?, benchmark? }
// Idle-time entry: { type: "idle-time", config, idleHours?|idleMinutes?|idleMs?, interval?, intervalType?, benchmark? }
// Schedule entry: { type: "schedule", config, daysOfWeek?, daysOfMonth?, startTime?, endTime?, timezone?, interval?, intervalType?, benchmark? }
// Optional flags: --interval=minutes, --debounce=ms

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { expandHome } = require('./lib/utils/paths');
const { installConsoleTimestamps } = require('./core/utils/logger');

const DEFAULT_INTERVAL_MS = 60000; // scan once per minute
const DEFAULT_DEBOUNCE_MS = 750; // delay to coalesce rapid edits
const DEFAULT_IGNORE = ['node_modules', '.git', '.DS_Store', 'tmp', 'dist'];
const MAX_TIMER_MS = 2147483647; // Max signed 32-bit timeout delay in Node.

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

function collectPromptFiles(value, found = []) {
    if (Array.isArray(value)) {
        value.forEach(item => collectPromptFiles(item, found));
        return found;
    }
    if (!value || typeof value !== 'object') return found;
    for (const [key, child] of Object.entries(value)) {
        if (/promptFile$/i.test(key) && typeof child === 'string' && child.trim()) {
            found.push(child.trim());
        } else {
            collectPromptFiles(child, found);
        }
    }
    return found;
}

async function hashConfigDependencies(configAbs) {
    const hash = crypto.createHash('sha1');
    let raw;
    try {
        raw = await fs.promises.readFile(configAbs);
    } catch {
        return hash.update(`missing:${configAbs}`).digest('hex');
    }
    hash.update(`config:${configAbs}:`).update(raw);

    let config;
    try {
        config = JSON.parse(raw.toString('utf8'));
    } catch {
        return hash.digest('hex');
    }

    const promptPaths = [...new Set(collectPromptFiles(config))]
        .map(promptFile => {
            const expanded = expandHome(promptFile);
            return path.isAbsolute(expanded) ? expanded : path.resolve(path.dirname(configAbs), expanded);
        })
        .sort();
    for (const promptPath of promptPaths) {
        try {
            const prompt = await fs.promises.readFile(promptPath);
            hash.update(`prompt:${promptPath}:`).update(prompt);
        } catch {
            hash.update(`missing-prompt:${promptPath}`);
        }
    }
    return hash.digest('hex');
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

    let markRunComplete = () => {};
    let markRunFailed = () => {};

    function enqueueRun(absConfig, reason = 'change', entry = null) {
        // de-dupe queued configs
        if (queue.some(item => item.absConfig === absConfig)) return;
        queue.push({
            absConfig,
            reason,
            queuedAt: new Date().toISOString(),
            entryId: entry?.id || null,
            entryName: entry?.name || path.basename(absConfig),
            limitPeriod: entry?.limitPeriod || null,
            benchmark: entry?.benchmark === true
        });
        processQueue();
    }

    function processQueue() {
        if (running) return;
        const next = queue.shift();
        if (!next) return;
        running = true;
        const startedAt = new Date().toISOString();
        const startedNs = process.hrtime.bigint();
        if (next.benchmark) {
            console.log(`[benchmark] Starting ${next.entryName} (${next.absConfig})`);
        }
        const child = spawn(process.execPath, [runnerPath, next.absConfig], {
            stdio: 'inherit',
            env: { ...process.env }
        });
        child.on('exit', (code, signal) => {
            running = false;
            const durationMs = Number(process.hrtime.bigint() - startedNs) / 1e6;
            const completedAt = new Date().toISOString();
            const benchmark = {
                entryId: next.entryId,
                entryName: next.entryName,
                config: next.absConfig,
                reason: next.reason,
                queuedAt: next.queuedAt,
                startedAt,
                completedAt,
                durationMs: Math.round(durationMs),
                status: code === 0 ? 'success' : 'failed',
                exitCode: code,
                signal: signal || null
            };
            if (next.benchmark) {
                console.log(`[benchmark] ${next.entryName} ${benchmark.status} in ${formatBenchmarkDuration(durationMs)}`);
            }
            if (code !== 0) {
                console.error(`runner.js exited with code ${code}${signal ? ` (signal ${signal})` : ''}`);
                markRunFailed(next, benchmark);
            } else {
                markRunComplete(next.absConfig, next.reason, next.queuedAt, next, benchmark);
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
            enqueueRun(resolvedConfig, 'change');
        }

        function scheduleRun() {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(triggerRun, debounceMs);
        }

        async function tick() {
            try {
                const currentHash = await hashTree(expandHome(watchDir), ignore);
                if (baselineHash && currentHash !== baselineHash) {
                    scheduleRun();
                }
                baselineHash = currentHash;
            } catch (err) {
                console.error(`Watcher error: ${err.message}`);
            }
        }

        async function start() {
            baselineHash = await hashTree(expandHome(watchDir), ignore);
            console.log(`Checking for changes every ${formatDuration(intervalMs)}.`);
            timer = scheduleRecurring(tick, intervalMs);
        }

        start();

        return {
            stop() {
                if (timer) cancelTimer(timer);
                if (debounceTimer) clearTimeout(debounceTimer);
            },
            isRunning: () => running
        };
    }

    // Map mode: watch multiple folders and trigger only their mapped configs
    const statePath = options.statePath
        ? path.resolve(options.statePath)
        : `${path.resolve(configPath)}.state.json`;
    const state = loadWatcherState(statePath);
    const mapEntries = loadMap(configPath, watchDir, intervalMs, state);
    markRunComplete = (absConfig, reason, queuedAt, runMeta = {}, benchmark = null) => {
        const nowIso = new Date().toISOString();
        state.lastRunAt = nowIso;
        state.lastRun = {
            config: absConfig,
            reason,
            queuedAt,
            completedAt: nowIso,
            ...(runMeta.benchmark && benchmark ? { durationMs: benchmark.durationMs } : {})
        };
        state.configRuns = state.configRuns || {};
        state.configRuns[absConfig] = nowIso;
        if (runMeta.benchmark && benchmark) recordBenchmark(state, benchmark);
        if (runMeta.entryId && runMeta.limitPeriod) {
            recordLimitedRun(state, runMeta.entryId, runMeta.limitPeriod, nowIso);
        }
        writeWatcherState(statePath, state);
    };
    markRunFailed = (runMeta, benchmark) => {
        if (!runMeta.benchmark) return;
        recordBenchmark(state, benchmark);
        writeWatcherState(statePath, state);
    };
    const timers = [];
    const idleTimers = [];
    const scheduleTimers = [];
    const configWatchTimers = [];

    async function tickConfigEntry(entry) {
        try {
            const currentHash = await hashConfigDependencies(entry.configAbs);
            if (entry.configWatchHash && currentHash !== entry.configWatchHash) {
                if (entry.configDebounceTimer) clearTimeout(entry.configDebounceTimer);
                entry.configDebounceTimer = setTimeout(
                    () => enqueueRun(entry.configAbs, `config-change:${entry.name}`, entry),
                    debounceMs
                );
            }
            entry.configWatchHash = currentHash;
            updateConfigWatchState(state, entry, currentHash);
            writeWatcherState(statePath, state);
        } catch (err) {
            console.error(`Config watcher error (${entry.configAbs}): ${err.message}`);
        }
    }

    async function tickEntry(entry) {
        try {
            const currentHash = await hashTree(entry.folderAbs, entry.ignore, entry.include);
            if (entry.baselineHash && currentHash !== entry.baselineHash) {
                const shouldRun = entry.runOnEmpty ||
                    (await countTreeFiles(entry.folderAbs, entry.ignore, entry.include)) > 0;
                const allowedByLimit = !shouldRun || canRunLimitedEntry(state, entry, new Date());
                if (shouldRun && allowedByLimit) {
                    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
                    entry.debounceTimer = setTimeout(() => enqueueRun(entry.configAbs, `change:${entry.name}`, entry), debounceMs);
                    entry.baselineHash = currentHash;
                    updateEntryState(state, entry, currentHash);
                    writeWatcherState(statePath, state);
                    return;
                }
                if (shouldRun && !allowedByLimit) return;
            }
            entry.baselineHash = currentHash;
            updateEntryState(state, entry, currentHash);
            writeWatcherState(statePath, state);
        } catch (err) {
            console.error(`Watcher error (${entry.folderAbs}): ${err.message}`);
        }
    }

    function tickIdleEntry(entry) {
        const lastRunMs = Date.parse(state.lastRunAt || state.createdAt || 0);
        const nowMs = Date.now();
        if (!Number.isFinite(lastRunMs) || nowMs - lastRunMs < entry.idleMs) return;

        const lastIdleRun = state.idleRuns?.[entry.id] || null;
        const lastIdleMs = Date.parse(lastIdleRun || 0);
        if (Number.isFinite(lastIdleMs) && nowMs - lastIdleMs < entry.idleMs) return;

        state.idleRuns = state.idleRuns || {};
        state.idleRuns[entry.id] = new Date(nowMs).toISOString();
        writeWatcherState(statePath, state);
        enqueueRun(entry.configAbs, `idle-time:${entry.name}`, entry);
    }

    function tickScheduledEntry(entry) {
        const now = new Date();
        if (!matchesSchedule(entry, now)) return;
        if (hasScheduledRunToday(state, entry, now)) return;
        if (!canRunLimitedEntry(state, entry, now)) return;

        recordScheduledRun(state, entry, now.toISOString());
        writeWatcherState(statePath, state);
        enqueueRun(entry.configAbs, `schedule:${entry.name}`, entry);
    }

    async function startMap() {
        // initialize baselines
        await Promise.all(mapEntries.folderEntries.map(async (entry) => {
            const currentHash = await hashTree(entry.folderAbs, entry.ignore, entry.include);
            if (entry.baselineHash && currentHash !== entry.baselineHash) {
                const shouldRun = entry.runOnEmpty ||
                    (await countTreeFiles(entry.folderAbs, entry.ignore, entry.include)) > 0;
                if (shouldRun && canRunLimitedEntry(state, entry, new Date())) {
                    enqueueRun(entry.configAbs, `startup-change:${entry.name}`, entry);
                    entry.baselineHash = currentHash;
                    updateEntryState(state, entry, currentHash);
                    return;
                }
                if (shouldRun) return;
            }
            entry.baselineHash = currentHash;
            updateEntryState(state, entry, currentHash);
        }));
        const configWatchEntries = [
            ...mapEntries.folderEntries,
            ...mapEntries.idleEntries,
            ...mapEntries.scheduledEntries
        ].filter(entry => entry.watchConfigChanges);
        await Promise.all(configWatchEntries.map(async entry => {
            const currentHash = await hashConfigDependencies(entry.configAbs);
            if (entry.configWatchHash && currentHash !== entry.configWatchHash) {
                enqueueRun(entry.configAbs, `startup-config-change:${entry.name}`, entry);
            }
            entry.configWatchHash = currentHash;
            updateConfigWatchState(state, entry, currentHash);
        }));
        if (!state.lastRunAt) state.lastRunAt = new Date().toISOString();
        writeWatcherState(statePath, state);

        for (const entry of mapEntries.folderEntries) {
            console.log(`Checking ${path.basename(entry.configAbs)} every ${formatDuration(entry.intervalMs)}.`);
            const t = scheduleRecurring(() => tickEntry(entry), entry.intervalMs);
            timers.push(t);
        }
        for (const entry of mapEntries.idleEntries) {
            console.log(`Checking idle-time ${path.basename(entry.configAbs)} after ${formatDuration(entry.idleMs)} idle.`);
            const t = scheduleRecurring(() => tickIdleEntry(entry), entry.intervalMs);
            idleTimers.push(t);
            tickIdleEntry(entry);
        }
        for (const entry of mapEntries.scheduledEntries) {
            console.log(`Checking scheduled ${path.basename(entry.configAbs)} every ${formatDuration(entry.intervalMs)}.`);
            const t = scheduleRecurring(() => tickScheduledEntry(entry), entry.intervalMs);
            scheduleTimers.push(t);
            tickScheduledEntry(entry);
        }
        for (const entry of configWatchEntries) {
            console.log(`Watching config and prompts for ${path.basename(entry.configAbs)}.`);
            // Config/prompt edits should not wait for a weekly or monthly source scan.
            const t = scheduleRecurring(() => tickConfigEntry(entry), Math.min(entry.intervalMs, intervalMs));
            configWatchTimers.push(t);
        }
    }

    startMap();

    return {
        stop() {
            timers.forEach(cancelTimer);
            idleTimers.forEach(cancelTimer);
            scheduleTimers.forEach(cancelTimer);
            configWatchTimers.forEach(cancelTimer);
            mapEntries.folderEntries.forEach(e => clearTimeout(e.debounceTimer));
            [...mapEntries.folderEntries, ...mapEntries.idleEntries, ...mapEntries.scheduledEntries]
                .forEach(e => clearTimeout(e.configDebounceTimer));
        },
        isRunning: () => running
    };
}

function isMapFile(p) {
    try {
        const full = path.resolve(p);
        const raw = fs.readFileSync(full, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) && parsed.every(isMapEntry);
    } catch {
        return false;
    }
}

function isMapEntry(item) {
    return item && item.config && (item.folder || isIdleEntry(item) || isScheduleEntry(item));
}

function isIdleEntry(item) {
    return item && (
        item.type === 'idle-time' ||
        item.kind === 'idle-time' ||
        item.name === 'idle-time' ||
        item['idle-time'] === true
    );
}

function isScheduleEntry(item) {
    return item && (
        item.type === 'schedule' ||
        item.kind === 'schedule' ||
        item.schedule === true
    );
}

function loadMap(mapPath, watchDir, defaultIntervalMs = DEFAULT_INTERVAL_MS, state = {}) {
    const full = path.resolve(mapPath);
    const baseDir = path.dirname(full);
    const raw = fs.readFileSync(full, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('watch-map must be an array');
    const folderEntries = [];
    const idleEntries = [];
    const scheduledEntries = [];

    parsed.forEach((entry, index) => {
        if (!isMapEntry(entry)) {
            throw new Error(`watch-map entry ${index} must include config plus folder or type="idle-time"`);
        }
        const expandedConfig = expandHome(entry.config);
        const configAbs = path.isAbsolute(expandedConfig)
            ? expandedConfig
            : path.resolve(baseDir, expandedConfig);
        const name = entry.name || (isIdleEntry(entry) ? 'idle-time' : entry.folder);

        if (isIdleEntry(entry)) {
            const idleMs = parseIdleMs(entry);
            if (!idleMs) throw new Error(`watch-map idle-time entry ${index} requires idleMs, idleMinutes, or idleHours`);
            const persistedConfigWatch = state.configWatches?.[entry.id || entry.name || `idle-time:${configAbs}`] || {};
            idleEntries.push({
                id: entry.id || entry.name || `idle-time:${configAbs}`,
                name,
                configAbs,
                idleMs,
                intervalMs: parseMapIntervalMs(entry, defaultIntervalMs),
                benchmark: entry.benchmark === true,
                watchConfigChanges: entry.watchConfigChanges === true,
                configWatchHash: persistedConfigWatch.lastHash || null,
                configDebounceTimer: null
            });
            return;
        }

        if (isScheduleEntry(entry)) {
            const runLimit = parseRunLimit(entry);
            const id = entry.id || entry.name || `schedule:${configAbs}`;
            const persistedConfigWatch = state.configWatches?.[id] || {};
            scheduledEntries.push({
                id,
                name,
                configAbs,
                intervalMs: parseMapIntervalMs(entry, defaultIntervalMs),
                daysOfWeek: parseScheduleList(entry.daysOfWeek ?? entry.runDaysOfWeek ?? entry.dow),
                daysOfMonth: parseScheduleList(entry.daysOfMonth ?? entry.runDaysOfMonth ?? entry.dom),
                startTime: parseScheduleTime(entry.startTime, 'startTime'),
                endTime: parseScheduleTime(entry.endTime, 'endTime'),
                timezone: entry.timezone ? String(entry.timezone) : null,
                maxRunsPerPeriod: runLimit.maxRunsPerPeriod,
                limitPeriod: runLimit.period,
                benchmark: entry.benchmark === true,
                watchConfigChanges: entry.watchConfigChanges === true,
                configWatchHash: persistedConfigWatch.lastHash || null,
                configDebounceTimer: null
            });
            return;
        }

        const expandedFolder = expandHome(entry.folder);
        const folderAbs = path.isAbsolute(expandedFolder)
            ? expandedFolder
            : path.resolve(watchDir, expandedFolder);
        const entryIgnore = Array.isArray(entry.ignore)
            ? [...DEFAULT_IGNORE, ...entry.ignore]
            : DEFAULT_IGNORE;
        const include = Array.isArray(entry.include)
            ? entry.include.map(p => String(p).split(path.sep).join('/'))
            : [];
        const runOnEmpty = entry.runOnEmpty ?? entry.RunOnEmpty ?? (entry.requireFiles === true ? false : true);
        const intervalMs = parseMapIntervalMs(entry, defaultIntervalMs);
        const runLimit = parseRunLimit(entry);
        const id = entry.id || entry.name || `${folderAbs}:${configAbs}:${include.join(',')}`;
        const persisted = state.entries?.[id] || state.entries?.[folderAbs] || {};
        const persistedConfigWatch = state.configWatches?.[id] || {};
        folderEntries.push({
            id,
            name,
            folderAbs,
            configAbs,
            ignore: entryIgnore,
            include,
            runOnEmpty,
            intervalMs,
            maxRunsPerPeriod: runLimit.maxRunsPerPeriod,
            limitPeriod: runLimit.period,
            benchmark: entry.benchmark === true,
            watchConfigChanges: entry.watchConfigChanges === true,
            configWatchHash: persistedConfigWatch.lastHash || null,
            configDebounceTimer: null,
            baselineHash: persisted.lastHash || null,
            debounceTimer: null
        });
    });

    return { folderEntries, idleEntries, scheduledEntries };
}

function parseMapIntervalMs(entry, defaultIntervalMs) {
    const explicitMs = Number(entry.intervalMs);
    if (Number.isFinite(explicitMs) && explicitMs > 0) return explicitMs;

    const value = entry.interval ?? entry.intervalMinutes ?? entry.intervalMins;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return defaultIntervalMs;
    return intervalToMs(parsed, entry.intervalType ?? entry.intervalUnit ?? entry.intervalUnits ?? 'minutes');
}

function intervalToMs(value, intervalType = 'minutes') {
    const type = normalizeIntervalType(intervalType);
    const multipliers = {
        millisecond: 1,
        second: 1000,
        minute: 60 * 1000,
        hour: 60 * 60 * 1000,
        day: 24 * 60 * 60 * 1000,
        week: 7 * 24 * 60 * 60 * 1000,
        month: 30 * 24 * 60 * 60 * 1000
    };
    return value * multipliers[type];
}

function normalizeIntervalType(value) {
    const type = String(value || 'minutes').trim().toLowerCase();
    const aliases = {
        ms: 'millisecond',
        millisecond: 'millisecond',
        milliseconds: 'millisecond',
        second: 'second',
        seconds: 'second',
        sec: 'second',
        secs: 'second',
        minute: 'minute',
        minutes: 'minute',
        min: 'minute',
        mins: 'minute',
        hour: 'hour',
        hours: 'hour',
        hr: 'hour',
        hrs: 'hour',
        day: 'day',
        days: 'day',
        week: 'week',
        weeks: 'week',
        month: 'month',
        months: 'month'
    };
    if (!aliases[type]) {
        throw new Error(`Unsupported intervalType "${value}". Use minutes, hours, days, weeks, or months.`);
    }
    return aliases[type];
}

function scheduleRecurring(fn, intervalMs) {
    let stopped = false;
    let timer = null;

    const schedule = (remainingMs) => {
        if (stopped) return;
        const delay = Math.min(remainingMs, MAX_TIMER_MS);
        timer = setTimeout(async () => {
            if (stopped) return;
            const nextRemaining = remainingMs - delay;
            if (nextRemaining > 0) {
                schedule(nextRemaining);
                return;
            }
            try {
                await fn();
            } catch (err) {
                console.error(`Watcher scheduled task failed: ${err.message}`);
            }
            schedule(intervalMs);
        }, delay);
    };

    schedule(intervalMs);
    return {
        cancel() {
            stopped = true;
            if (timer) clearTimeout(timer);
        }
    };
}

function cancelTimer(timer) {
    if (!timer) return;
    if (typeof timer.cancel === 'function') timer.cancel();
    else clearInterval(timer);
}

function parseIdleMs(entry) {
    const explicitMs = Number(entry.idleMs);
    if (Number.isFinite(explicitMs) && explicitMs > 0) return explicitMs;

    const minutes = Number(entry.idleMinutes ?? entry.idleMins);
    if (Number.isFinite(minutes) && minutes > 0) return minutes * 60 * 1000;

    const hours = Number(entry.idleHours);
    if (Number.isFinite(hours) && hours > 0) return hours * 60 * 60 * 1000;

    return null;
}

function parseRunLimit(entry) {
    const maxRuns = Number(entry.maxRunsPerPeriod ?? entry.maxRuns ?? entry.runLimit);
    const rawPeriod = entry.period ?? entry.runPeriod ?? entry.limitPeriod;
    const period = rawPeriod ? String(rawPeriod).toLowerCase() : null;

    if (!Number.isFinite(maxRuns) || maxRuns <= 0 || !period) {
        return { maxRunsPerPeriod: null, period: null };
    }
    if (!['day', 'week', 'month', 'quarter', 'year'].includes(period)) {
        throw new Error(`Unsupported watch-map period "${period}". Use day, week, month, quarter, or year.`);
    }
    return { maxRunsPerPeriod: Math.floor(maxRuns), period };
}

function parseScheduleList(value) {
    if (value === undefined || value === null || value === '') return [];
    const raw = Array.isArray(value) ? value : String(value).split(',');
    return raw
        .map(v => typeof v === 'string' ? v.trim().toLowerCase() : v)
        .filter(v => v !== '')
        .map(v => {
            if (v === 'last' || v === 'last-day' || v === 'lastday') return 'last';
            const n = Number(v);
            return Number.isFinite(n) ? Math.floor(n) : null;
        })
        .filter(v => v !== null);
}

function matchesSchedule(entry, now = new Date()) {
    const daysOfWeek = entry.daysOfWeek || [];
    const daysOfMonth = entry.daysOfMonth || [];
    const parts = scheduleDateParts(now, entry.timezone);

    if (daysOfWeek.length > 0 && !daysOfWeek.includes(parts.dayOfWeek)) return false;
    if (daysOfMonth.length > 0 && !matchesScheduleDayOfMonth(daysOfMonth, parts)) return false;
    if (!matchesScheduleTimeWindow(entry, parts)) return false;
    return daysOfWeek.length > 0 || daysOfMonth.length > 0 || entry.always === true;
}

function parseScheduleTime(value, fieldName) {
    if (value === undefined || value === null || value === '') return null;
    const match = String(value).match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) throw new Error(`Invalid ${fieldName} "${value}". Use 24-hour HH:mm.`);
    return Number(match[1]) * 60 + Number(match[2]);
}

function scheduleDateParts(date, timezone = null) {
    if (!timezone) {
        return {
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            day: date.getDate(),
            dayOfWeek: dayOfWeekNumber(date),
            minuteOfDay: date.getHours() * 60 + date.getMinutes()
        };
    }
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    const values = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
    const weekdays = { Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6, Sat: 7 };
    return {
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day),
        dayOfWeek: weekdays[values.weekday],
        minuteOfDay: Number(values.hour) * 60 + Number(values.minute)
    };
}

function matchesScheduleTimeWindow(entry, parts) {
    if (entry.startTime === null || entry.startTime === undefined) return true;
    if (entry.endTime === null || entry.endTime === undefined) return parts.minuteOfDay >= entry.startTime;
    if (entry.startTime <= entry.endTime) {
        return parts.minuteOfDay >= entry.startTime && parts.minuteOfDay <= entry.endTime;
    }
    return parts.minuteOfDay >= entry.startTime || parts.minuteOfDay <= entry.endTime;
}

function matchesScheduleDayOfMonth(daysOfMonth, parts) {
    if (daysOfMonth.includes(parts.day)) return true;
    const last = new Date(parts.year, parts.month, 0).getDate();
    return daysOfMonth.includes('last') && parts.day === last;
}

function matchesDayOfMonth(daysOfMonth, now = new Date()) {
    const day = now.getDate();
    if (daysOfMonth.includes(day)) return true;
    return daysOfMonth.includes('last') && day === lastDayOfMonth(now);
}

function lastDayOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function dayOfWeekNumber(date) {
    return date.getDay() + 1;
}

function hasScheduledRunToday(state, entry, now = new Date()) {
    const key = scheduleDayKey(now, entry.timezone);
    return !!state.scheduledRuns?.[entry.id]?.[key];
}

function recordScheduledRun(state, entry, timestamp) {
    const key = scheduleDayKey(new Date(timestamp), entry.timezone);
    state.scheduledRuns = state.scheduledRuns || {};
    state.scheduledRuns[entry.id] = state.scheduledRuns[entry.id] || {};
    state.scheduledRuns[entry.id][key] = timestamp;
}

function scheduleDayKey(date, timezone = null) {
    const parts = scheduleDateParts(date, timezone);
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function canRunLimitedEntry(state, entry, now = new Date()) {
    if (!entry.maxRunsPerPeriod || !entry.limitPeriod) return true;
    const key = periodKey(now, entry.limitPeriod);
    const runs = state.runHistory?.[entry.id]?.[key] || [];
    return runs.length < entry.maxRunsPerPeriod;
}

function recordLimitedRun(state, entryId, period, timestamp) {
    const key = periodKey(new Date(timestamp), period);
    state.runHistory = state.runHistory || {};
    state.runHistory[entryId] = state.runHistory[entryId] || {};
    state.runHistory[entryId][key] = state.runHistory[entryId][key] || [];
    state.runHistory[entryId][key].push(timestamp);
    pruneRunHistory(state.runHistory[entryId], period);
}

function periodKey(date, period) {
    const d = new Date(date);
    const year = d.getFullYear();
    if (period === 'year') return `${year}`;
    if (period === 'quarter') return `${year}-Q${Math.floor(d.getMonth() / 3) + 1}`;
    if (period === 'month') return `${year}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (period === 'week') return `${year}-W${String(weekNumberMonday(d)).padStart(2, '0')}`;
    return `${year}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function weekNumberMonday(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function pruneRunHistory(history, period) {
    const keys = Object.keys(history).sort();
    const keep = period === 'day' ? 14 : period === 'week' ? 12 : period === 'month' ? 18 : period === 'quarter' ? 12 : 5;
    for (const key of keys.slice(0, Math.max(0, keys.length - keep))) {
        delete history[key];
    }
}

function loadWatcherState(statePath) {
    try {
        const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        return {
            version: 1,
            createdAt: new Date().toISOString(),
            entries: {},
            idleRuns: {},
            configRuns: {},
            runHistory: {},
            ...parsed
        };
    } catch {
        return {
            version: 1,
            createdAt: new Date().toISOString(),
            entries: {},
            idleRuns: {},
            configRuns: {},
            runHistory: {}
        };
    }
}

function updateEntryState(state, entry, hash) {
    state.entries = state.entries || {};
    state.entries[entry.id] = {
        folder: entry.folderAbs,
        config: entry.configAbs,
        lastHash: hash,
        lastScannedAt: new Date().toISOString(),
        maxRunsPerPeriod: entry.maxRunsPerPeriod || undefined,
        period: entry.limitPeriod || undefined
    };
}

function updateConfigWatchState(state, entry, hash) {
    state.configWatches = state.configWatches || {};
    state.configWatches[entry.id] = {
        config: entry.configAbs,
        lastHash: hash,
        lastScannedAt: new Date().toISOString()
    };
}

function writeWatcherState(statePath, state) {
    try {
        fs.mkdirSync(path.dirname(statePath), { recursive: true });
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
        console.warn(`Unable to write watcher state ${statePath}: ${err.message}`);
    }
}

function recordBenchmark(state, benchmark, historyLimit = 100) {
    state.configBenchmarks = state.configBenchmarks || {};
    const key = benchmark.entryId || benchmark.config;
    state.configBenchmarks[key] = benchmark;
    state.benchmarkRuns = state.benchmarkRuns || [];
    state.benchmarkRuns.push(benchmark);
    if (state.benchmarkRuns.length > historyLimit) {
        state.benchmarkRuns.splice(0, state.benchmarkRuns.length - historyLimit);
    }
}

function formatBenchmarkDuration(ms) {
    if (ms < 1000) return `${Math.round(ms)} ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(2)} s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${(seconds % 60).toFixed(1)}s`;
}

function formatDuration(ms) {
    const months = ms / (30 * 24 * 60 * 60 * 1000);
    if (Number.isInteger(months) && months >= 1) return `${months} month${months === 1 ? '' : 's'}`;
    const days = ms / (24 * 60 * 60 * 1000);
    if (Number.isInteger(days) && days >= 1) return `${days} day${days === 1 ? '' : 's'}`;
    const minutes = ms / (60 * 1000);
    if (Number.isInteger(minutes)) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    const seconds = ms / 1000;
    if (Number.isInteger(seconds)) return `${seconds} second${seconds === 1 ? '' : 's'}`;
    return `${ms} ms`;
}

function usage() {
    return 'Usage: node AION_Watcher.js <watchDir> <configPath|mapPath> [--interval=minutes] [--debounce=ms]';
}

function printCliError(message, example) {
    console.error(message);
    console.error(usage());
    if (example) {
        console.error(`Example: ${example}`);
    }
}

function parseCliArgs(argv) {
    const positional = [];
    const opts = {};

    for (const arg of argv) {
        if (arg.startsWith('--interval=') || arg.startsWith('--internval=')) {
            opts.intervalMs = Number(arg.split('=')[1]) * 60 * 1000;
            continue;
        }
        if (arg.startsWith('--debounce=')) {
            opts.debounceMs = Number(arg.split('=')[1]);
            continue;
        }
        positional.push(arg);
    }

    return { positional, opts };
}

if (require.main === module) {
    installConsoleTimestamps();
    const { positional, opts } = parseCliArgs(process.argv.slice(2));
    const [watchDirArg, configArg] = positional;
    if (!watchDirArg || !configArg) {
        console.error(usage());
        process.exit(1);
    }

    const watchDir = path.resolve(watchDirArg);
    const configPath = path.resolve(configArg);
    const watchDirExists = fs.existsSync(watchDir);
    const watchDirIsDirectory = watchDirExists && fs.statSync(watchDir).isDirectory();
    const configLooksLikeLegacyFlag = /^(--)?(interval|internval|debounce)=\d+$/i.test(configArg);

    if (configLooksLikeLegacyFlag) {
        printCliError(
            `Invalid config path: "${configArg}" was parsed as the second positional argument, not as an option.`,
            `node AION_Watcher.js . ${watchDirArg} --${configArg.replace(/^--/, '')}`
        );
        process.exit(1);
    }

    if (!watchDirExists) {
        printCliError(`Watch path does not exist: ${watchDir}`, `node AION_Watcher.js . ${configArg} --interval=1`);
        process.exit(1);
    }

    if (!watchDirIsDirectory) {
        const looksLikeMapFile = isMapFile(watchDir);
        const example = looksLikeMapFile
            ? `node AION_Watcher.js . ${watchDirArg} --interval=1`
            : null;
        printCliError(`Watch path must be a directory, but got a file: ${watchDir}`, example);
        process.exit(1);
    }

    if (!fs.existsSync(configPath)) {
        printCliError(`Config path does not exist: ${configPath}`);
        process.exit(1);
    }

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

module.exports = {
    startWatcher,
    _private: {
        canRunLimitedEntry,
        intervalToMs,
        normalizeIntervalType,
        parseRunLimit,
        parseMapIntervalMs,
        parseScheduleList,
        parseScheduleTime,
        matchesSchedule,
        scheduleDateParts,
        scheduleDayKey,
        dayOfWeekNumber,
        hasScheduledRunToday,
        recordScheduledRun,
        periodKey,
        recordLimitedRun,
        recordBenchmark,
        formatBenchmarkDuration,
        collectPromptFiles,
        hashConfigDependencies
    }
};
