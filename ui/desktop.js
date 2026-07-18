const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function bin(name) {
  return path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: options.stdio || 'inherit',
      env: { ...process.env, ...(options.env || {}) }
    });
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  await run(bin('vite'), ['build']);
  await run(bin('electron'), ['ui/electron/main.cjs']);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
