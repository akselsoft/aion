const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEV_URL = process.env.AION_UI_DEV_URL || 'http://127.0.0.1:5173/';

function bin(name) {
  return path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
}

function spawnInherit(command, args, env = {}) {
  return spawn(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env }
  });
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const vite = spawnInherit(bin('vite'), ['--host', '127.0.0.1']);
  await wait(900);
  const electron = spawnInherit(bin('electron'), ['ui/electron/main.cjs'], {
    AION_UI_DEV_URL: DEV_URL
  });

  const children = [vite, electron];
  function shutdown(signal = 'SIGTERM') {
    for (const child of children) child.kill(signal);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  electron.on('exit', code => {
    shutdown();
    process.exit(code || 0);
  });
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
