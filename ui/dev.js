const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const children = [
  spawn(process.execPath, ['ui/api-server.js'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env
  }),
  spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--host', '127.0.0.1'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env
  })
];

function shutdown(signal) {
  for (const child of children) child.kill(signal);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

for (const child of children) {
  child.on('exit', code => {
    if (code && code !== 0) {
      for (const other of children) {
        if (other !== child) other.kill('SIGTERM');
      }
      process.exit(code);
    }
  });
}
