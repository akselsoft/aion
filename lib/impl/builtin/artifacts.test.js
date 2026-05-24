const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const artifacts = require('./artifacts');

test('fileIsFreshForPeriod treats yesterday as stale for daily state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-artifacts-'));
  const filePath = path.join(dir, 'Daily.md');
  fs.writeFileSync(filePath, 'yesterday', 'utf8');

  const now = new Date('2026-06-02T10:00:00');
  const yesterday = new Date('2026-06-01T20:00:00');
  fs.utimesSync(filePath, yesterday, yesterday);

  assert.equal(
    artifacts._private.fileIsFreshForPeriod(filePath, { freshPeriod: 'day' }, now.getTime()),
    false
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('fileIsFreshForPeriod accepts same-day Daily.md state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-artifacts-'));
  const filePath = path.join(dir, 'Daily.md');
  fs.writeFileSync(filePath, 'today', 'utf8');

  const now = new Date('2026-06-02T10:00:00');
  const today = new Date('2026-06-02T08:00:00');
  fs.utimesSync(filePath, today, today);

  assert.equal(
    artifacts._private.fileIsFreshForPeriod(filePath, { freshPeriod: 'day' }, now.getTime()),
    true
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('computeCutoff supports sinceDays', () => {
  const now = new Date('2026-06-08T10:00:00Z').getTime();

  assert.equal(
    artifacts._private.computeCutoff(now, '/tmp', { sinceDays: 7 }),
    now - 7 * 24 * 60 * 60 * 1000
  );
});

test('wildcardMatcher supports prefix globs', () => {
  const matches = artifacts._private.wildcardMatcher('Daily*.md');

  assert.equal(matches('Daily.md'), true);
  assert.equal(matches('Daily-20260608.md'), true);
  assert.equal(matches('Weekly.md'), false);
});

test('listGlobDocs returns matching files inside cutoff window', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-artifacts-'));
  const recent = path.join(dir, 'Daily-20260608.md');
  const old = path.join(dir, 'Daily-20260501.md');
  const other = path.join(dir, 'Weekly.md');
  fs.writeFileSync(recent, 'recent', 'utf8');
  fs.writeFileSync(old, 'old', 'utf8');
  fs.writeFileSync(other, 'other', 'utf8');

  const recentTime = new Date('2026-06-08T08:00:00Z');
  const oldTime = new Date('2026-05-01T08:00:00Z');
  fs.utimesSync(recent, recentTime, recentTime);
  fs.utimesSync(old, oldTime, oldTime);
  fs.utimesSync(other, recentTime, recentTime);

  const cutoff = new Date('2026-06-01T10:00:00Z').getTime();
  const docs = artifacts._private.listGlobDocs(path.join(dir, 'Daily*.md'), cutoff, {});

  assert.deepEqual(docs.map(d => d.filename), ['Daily-20260608.md']);

  fs.rmSync(dir, { recursive: true, force: true });
});
