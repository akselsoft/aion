const path = require('path');

module.exports = {
  async run(ctx, engineCfg, personaCfg) {
    const outputType = engineCfg.outputType || 'sql';
    const query = resolveQuery(engineCfg, personaCfg);
    if (!query) throw new Error('sql.collector: query or queryFile is required');

    const clientName = String(engineCfg.client || engineCfg.dialect || '').trim().toLowerCase();
    if (!clientName) throw new Error('sql.collector: client is required (postgres|mssql|mysql|sqlite)');

    const rows = await queryDatabase(clientName, engineCfg.connection || {}, query);
    const result = {
      rows,
      rowCount: rows.length
    };

    ctx.passedFiles.push({
      name: engineCfg.name || outputType,
      type: outputType,
      prompt: engineCfg.prompt || '',
      documents: [{
        filename: `${outputType}.json`,
        filetype: 'json',
        content: JSON.stringify(result, null, 2),
        json: result
      }]
    });
  }
};

function resolveQuery(engineCfg, personaCfg) {
  if (typeof engineCfg.query === 'string' && engineCfg.query.trim()) return engineCfg.query.trim();
  if (!engineCfg.queryFile) return '';

  const projectRoot = personaCfg.__projectRoot || process.cwd();
  const full = path.isAbsolute(engineCfg.queryFile)
    ? engineCfg.queryFile
    : path.join(projectRoot, engineCfg.queryFile);
  return require('fs').readFileSync(full, 'utf8').trim();
}

async function queryDatabase(clientName, connection, query) {
  switch (clientName) {
    case 'postgres':
    case 'postgresql':
    case 'pg':
      return await runPostgres(connection, query);
    case 'mssql':
    case 'sqlserver':
      return await runMssql(connection, query);
    case 'mysql':
    case 'mysql2':
      return await runMysql(connection, query);
    case 'sqlite':
    case 'sqlite3':
      return await runSqlite(connection, query);
    default:
      throw new Error(`sql.collector: unsupported client "${clientName}"`);
  }
}

async function runPostgres(connection, query) {
  const { Client } = optionalRequire('pg', 'Install "pg" to use the postgres SQL collector.');
  const client = new Client(connection);
  await client.connect();
  try {
    const res = await client.query(query);
    return res.rows || [];
  } finally {
    await client.end().catch(() => {});
  }
}

async function runMssql(connection, query) {
  const sql = optionalRequire('mssql', 'Install "mssql" to use the SQL Server collector.');
  const pool = await sql.connect(connection);
  try {
    const res = await pool.request().query(query);
    return res.recordset || [];
  } finally {
    await pool.close().catch(() => {});
  }
}

async function runMysql(connection, query) {
  const mysql = optionalRequire('mysql2/promise', 'Install "mysql2" to use the MySQL collector.');
  const conn = await mysql.createConnection(connection);
  try {
    const [rows] = await conn.execute(query);
    return Array.isArray(rows) ? rows : [];
  } finally {
    await conn.end().catch(() => {});
  }
}

async function runSqlite(connection, query) {
  const file = connection.file || connection.filename || connection.path;
  if (!file) throw new Error('sql.collector: sqlite connection requires connection.file');

  try {
    const Database = require('better-sqlite3');
    const db = new Database(file, connection.options || {});
    try {
      return db.prepare(query).all();
    } finally {
      db.close();
    }
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') throw err;
  }

  const sqlite3 = optionalRequire('sqlite3', 'Install "better-sqlite3" or "sqlite3" to use the sqlite collector.');
  return await new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, sqlite3.OPEN_READONLY, (openErr) => {
      if (openErr) return reject(openErr);
      db.all(query, [], (err, rows) => {
        db.close(() => {});
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  });
}

function optionalRequire(name, installHint) {
  try {
    return require(name);
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND') {
      throw new Error(`${installHint} Missing module: ${name}`);
    }
    throw err;
  }
}
