const crypto = require('crypto');

function sha256String(str) {
  return crypto.createHash('sha256').update(str || '', 'utf8').digest('hex');
}

module.exports = { sha256String };

