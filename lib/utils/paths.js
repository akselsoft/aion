const os = require('os');
const path = require('path');

function expandHome(value) {
  if (typeof value !== 'string') return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function resolveConfigPath(projectRoot, value) {
  const expanded = expandHome(value);
  return path.isAbsolute(expanded) ? expanded : path.resolve(projectRoot, expanded);
}

module.exports = {
  expandHome,
  resolveConfigPath
};
