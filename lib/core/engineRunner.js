const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

let tsRegistered = false;
function ensureTs() {
  if (tsRegistered) return;
  try {
    require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs' } });
    tsRegistered = true;
  } catch {
    try {
      require('esbuild-register/dist/node').register();
      tsRegistered = true;
    } catch {
      // TS not available; TS plugins will fail to load.
    }
  }
}

function loadModule(modPath) {
  const full = path.isAbsolute(modPath) ? modPath : path.resolve(process.cwd(), modPath);
  const ext = path.extname(full).toLowerCase();
  if (ext === '.ts') ensureTs();
  return require(full);
}

async function runEngine(ctx, engineCfg, personaCfg) {
  const codeType = String(engineCfg.codeType || 'js').toLowerCase();
  if (codeType === 'file') {
    return await runFileEngine(ctx, engineCfg, personaCfg);
  }

  // Resolve built-in short names to lib/impl/builtin/<name>
  let modPath = engineCfg.engine;
  if (!modPath) throw new Error('engine is required');

  const looksBare = !modPath.includes('/') && !modPath.endsWith('.js') && !modPath.endsWith('.ts');
  if (looksBare) {
    modPath = path.resolve(__dirname, `../impl/builtin/${modPath}`);
  } else if (!path.isAbsolute(modPath)) {
    modPath = path.resolve(process.cwd(), modPath);
  }

  const mod = loadModule(modPath);
  if (typeof mod.run !== 'function') {
    throw new Error(`Engine at ${modPath} missing run(ctx, cfg, personaCfg)`);
  }
  await mod.run(ctx, engineCfg, personaCfg);
}

async function runFileEngine(ctx, engineCfg, personaCfg) {
  const exe = engineCfg.engine; // absolute or relative to CWD
  const exePath = path.isAbsolute(exe) ? exe : path.resolve(process.cwd(), exe);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-'));
  const pfPath = path.join(tmpDir, 'passedFiles.json');
  fs.writeFileSync(pfPath, JSON.stringify(ctx.passedFiles, null, 2), 'utf8');

  const args = Array.isArray(engineCfg.args) ? engineCfg.args.slice() : [];
  const timeoutMs = Number(engineCfg.timeoutMs || 120000);

  await spawnWithJson(pfPath, exePath, args, timeoutMs, engineCfg.env || {});

  // Reload and replace array contents to preserve reference where shared
  const updated = JSON.parse(fs.readFileSync(pfPath, 'utf8'));
  if (!Array.isArray(updated)) {
    throw new Error('External engine did not write a valid passedFiles array');
  }
  ctx.passedFiles.length = 0;
  for (const item of updated) ctx.passedFiles.push(item);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

function spawnWithJson(pfPath, cmd, args, timeoutMs, extraEnv) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...extraEnv, PASSED_FILES_JSON: pfPath };
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'inherit', 'inherit'],
      env,
      shell: process.platform === 'win32'
    });

    let killed = false;
    const to = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, timeoutMs);

    child.on('exit', (code) => {
      clearTimeout(to);
      if (killed) return reject(new Error(`Engine timed out after ${timeoutMs}ms`));
      if (code === 0) resolve();
      else reject(new Error(`Engine exited with code ${code}`));
    });
    child.on('error', (err) => { clearTimeout(to); reject(err); });
  });
}

module.exports = { runEngine, loadModule };

