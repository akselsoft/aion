const fs = require('fs');
// core/utils/logger.js
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
    logInfo,
    logWarn,
    logError,
    logStep,
    logFile
};