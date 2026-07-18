const fs = require('fs');
// core/utils/logger.js

const TIMESTAMPED_CONSOLE = Symbol.for('aion.timestampedConsole');

function timestampPrefix(d = new Date()) {
    const pad = (n, width = 2) => String(n).padStart(width, '0');
    const timestamp = [
        d.getFullYear(),
        pad(d.getMonth() + 1),
        pad(d.getDate())
    ].join('-') + ' ' + [
        pad(d.getHours()),
        pad(d.getMinutes()),
        pad(d.getSeconds())
    ].join(':') + `.${pad(d.getMilliseconds(), 3)}`;

    const uptime = formatDuration(process.uptime() * 1000);
    return `[${timestamp} +${uptime}]`;
}

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m${String(seconds).padStart(2, '0')}s`;
    if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, '0')}s`;
    return `${seconds}s`;
}

function installConsoleTimestamps() {
    if (console[TIMESTAMPED_CONSOLE]) return;
    for (const method of ['log', 'warn', 'error']) {
        const original = console[method].bind(console);
        console[method] = (...args) => original(timestampPrefix(), ...args);
    }
    Object.defineProperty(console, TIMESTAMPED_CONSOLE, {
        value: true,
        enumerable: false
    });
}

function logInfo(msg) {
    console.log(`[INFO] ${msg}`);
}

function logWarn(msg) {
    console.warn(`[WARN] ${msg}`);
}

function logError(msg) {
    console.error(`[ERROR] ${msg}`);
}
function logFile(step, detail = '') {
    console.log('logging to file')
    fs.writeFileSync("logging.log", detail, 'utf-8');

    // console.log(`\n== ${step} ==${detail ? `\n${detail}` : ''}`);
}

function logStep(step, detail = '') {
    console.log(`\n== ${step} ==${detail ? `\n${detail}` : ''}`);
    // fs.writeFileSync("logging.log", detail, 'utf-8');
}
module.exports = {
    installConsoleTimestamps,
    logInfo,
    logWarn,
    logError,
    logStep,
    logFile
};
