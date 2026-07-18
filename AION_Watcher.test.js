const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const watcher = require('./AION_Watcher');

test('periodKey groups dates by week, month, and quarter', () => {
  assert.equal(watcher._private.periodKey(new Date('2026-05-16T12:00:00Z'), 'week'), '2026-W20');
  assert.equal(watcher._private.periodKey(new Date('2026-05-16T12:00:00Z'), 'month'), '2026-05');
  assert.equal(watcher._private.periodKey(new Date('2026-05-16T12:00:00Z'), 'quarter'), '2026-Q2');
});

test('canRunLimitedEntry allows only configured runs per period', () => {
  const state = { runHistory: {} };
  const entry = {
    id: 'weekly-input',
    maxRunsPerPeriod: 2,
    limitPeriod: 'week'
  };
  const first = '2026-05-12T10:00:00.000Z';
  const second = '2026-05-14T10:00:00.000Z';
  const sameWeek = new Date('2026-05-16T10:00:00.000Z');
  const nextWeek = new Date('2026-05-19T10:00:00.000Z');

  assert.equal(watcher._private.canRunLimitedEntry(state, entry, sameWeek), true);
  watcher._private.recordLimitedRun(state, entry.id, entry.limitPeriod, first);
  assert.equal(watcher._private.canRunLimitedEntry(state, entry, sameWeek), true);
  watcher._private.recordLimitedRun(state, entry.id, entry.limitPeriod, second);
  assert.equal(watcher._private.canRunLimitedEntry(state, entry, sameWeek), false);
  assert.equal(watcher._private.canRunLimitedEntry(state, entry, nextWeek), true);
});

test('parseMapIntervalMs supports intervalType units', () => {
  assert.equal(
    watcher._private.parseMapIntervalMs({ interval: 3, intervalType: 'months' }, 60000),
    3 * 30 * 24 * 60 * 60 * 1000
  );
  assert.equal(
    watcher._private.parseMapIntervalMs({ interval: 7, intervalType: 'days' }, 60000),
    7 * 24 * 60 * 60 * 1000
  );
  assert.equal(
    watcher._private.parseMapIntervalMs({ interval: 5 }, 60000),
    5 * 60 * 1000
  );
});

test('normalizeIntervalType accepts common aliases', () => {
  assert.equal(watcher._private.normalizeIntervalType('mins'), 'minute');
  assert.equal(watcher._private.normalizeIntervalType('days'), 'day');
  assert.equal(watcher._private.normalizeIntervalType('weeks'), 'week');
  assert.equal(watcher._private.normalizeIntervalType('months'), 'month');
});

test('matchesSchedule supports daysOfWeek and daysOfMonth', () => {
  assert.equal(
    watcher._private.matchesSchedule({ daysOfWeek: [2] }, new Date('2026-06-01T10:00:00')),
    true
  );
  assert.equal(
    watcher._private.matchesSchedule({ daysOfWeek: [3] }, new Date('2026-06-01T10:00:00')),
    false
  );
  assert.equal(
    watcher._private.matchesSchedule({ daysOfMonth: [1, 15, 30] }, new Date('2026-06-15T10:00:00')),
    true
  );
  assert.equal(
    watcher._private.matchesSchedule({ daysOfMonth: ['last'] }, new Date('2026-02-28T10:00:00')),
    true
  );
});

test('matchesSchedule honors a timezone-aware time window', () => {
  const entry = {
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    startTime: watcher._private.parseScheduleTime('04:00', 'startTime'),
    endTime: watcher._private.parseScheduleTime('09:00', 'endTime'),
    timezone: 'America/Toronto'
  };

  assert.equal(watcher._private.matchesSchedule(entry, new Date('2026-07-18T10:00:00Z')), true);
  assert.equal(watcher._private.matchesSchedule(entry, new Date('2026-07-18T15:00:00Z')), false);
});

test('scheduled daily state uses the configured timezone date', () => {
  assert.equal(
    watcher._private.scheduleDayKey(new Date('2026-07-18T02:00:00Z'), 'America/Toronto'),
    '2026-07-17'
  );
});

test('scheduled runs are recorded once per day', () => {
  const state = {};
  const entry = { id: 'gcbo-daily' };
  const now = new Date('2026-06-01T10:00:00');

  assert.equal(watcher._private.hasScheduledRunToday(state, entry, now), false);
  watcher._private.recordScheduledRun(state, entry, now.toISOString());
  assert.equal(watcher._private.hasScheduledRunToday(state, entry, now), true);
});

test('recordBenchmark preserves the latest result and bounded history', () => {
  const state = {};
  const first = { entryId: 'daily-input', durationMs: 1200, status: 'success' };
  const second = { entryId: 'daily-input', durationMs: 900, status: 'failed' };

  watcher._private.recordBenchmark(state, first, 1);
  watcher._private.recordBenchmark(state, second, 1);

  assert.deepEqual(state.configBenchmarks['daily-input'], second);
  assert.deepEqual(state.benchmarkRuns, [second]);
});

test('formatBenchmarkDuration keeps benchmark logs readable', () => {
  assert.equal(watcher._private.formatBenchmarkDuration(450), '450 ms');
  assert.equal(watcher._private.formatBenchmarkDuration(1250), '1.25 s');
  assert.equal(watcher._private.formatBenchmarkDuration(65432), '1m 5.4s');
});

test('hashConfigDependencies changes when a referenced prompt changes', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-watcher-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'prompts'));
  const configPath = path.join(dir, 'config.json');
  const promptPath = path.join(dir, 'prompts', 'instructions.md');
  fs.writeFileSync(configPath, JSON.stringify({ params: { interpreters: [{ promptFile: './prompts/instructions.md' }] } }));
  fs.writeFileSync(promptPath, 'first instructions');

  const first = await watcher._private.hashConfigDependencies(configPath);
  fs.writeFileSync(promptPath, 'revised instructions');
  const second = await watcher._private.hashConfigDependencies(configPath);

  assert.notEqual(first, second);
});

test('collectPromptFiles finds prompt references throughout a config', () => {
  assert.deepEqual(
    watcher._private.collectPromptFiles({ params: { collectors: [{ promptFile: 'one.md' }], interpreters: [{ systemPromptFile: 'two.md' }] } }),
    ['one.md', 'two.md']
  );
});
