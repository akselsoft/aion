const http = require('http');
const {
  listEngines,
  listFiles,
  readLanguageFile,
  readJsonFile,
  runConfig,
  safePath,
  writeJsonFile
} = require('./aion-service');

const PORT = Number(process.env.AION_UI_API_PORT || 5174);
const HOST = process.env.AION_UI_API_HOST || '127.0.0.1';

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'access-control-allow-origin': 'http://localhost:5173',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    ...headers
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 8 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body ? JSON.parse(body) : {}));
    req.on('error', reject);
  });
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === 'GET' && url.pathname === '/api/files') {
      return send(res, 200, { files: listFiles(url.searchParams.get('kind')) });
    }

    if (req.method === 'GET' && url.pathname === '/api/file') {
      return send(res, 200, readJsonFile(url.searchParams.get('path')));
    }

    if (req.method === 'GET' && url.pathname === '/api/language') {
      return send(res, 200, readLanguageFile(url.searchParams.get('path')));
    }

    if (req.method === 'POST' && url.pathname === '/api/file') {
      const body = await readBody(req);
      return send(res, 200, writeJsonFile(body.path, body.data));
    }

    if (req.method === 'GET' && url.pathname === '/api/engines') {
      return send(res, 200, { engines: listEngines() });
    }

    if (req.method === 'POST' && url.pathname === '/api/run') {
      const body = await readBody(req);
      safePath(body.path);
      const result = await runConfig(body.path);
      return send(res, 200, result);
    }

    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    return send(res, 500, { error: err.message });
  }
}

http.createServer(handle).listen(PORT, HOST, () => {
  console.log(`AION UI API listening on http://${HOST}:${PORT}`);
});
