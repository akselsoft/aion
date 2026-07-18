const fs = require('fs');
const path = require('path');

function appendJsonl(filePath, obj) {
  const dir = path.dirname(filePath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const line = JSON.stringify(obj) + '\n';
  fs.appendFileSync(filePath, line, 'utf8');
}

module.exports = { appendJsonl };

