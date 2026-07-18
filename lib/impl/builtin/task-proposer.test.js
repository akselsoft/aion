const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const proposer = require('./task-proposer');

const NOW = '2026-07-18T12:00:00Z';
function passed(type, json) { return { type, documents: [{ filename: `${type}.json`, content: JSON.stringify(json), json }] }; }
function area(id, overrides = {}) { return { id, name: id.toUpperCase(), cadence: 'd', active: true, promptFile: `${id}.md`, ...overrides }; }

async function run(t, { areas = [], tasks = [], state = {}, extra = [], cfg = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-proposer-'));
  fs.mkdirSync(path.join(root, 'prompts'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const item of areas) if (item.promptFile && item.createPrompt !== false) fs.writeFileSync(path.join(root, 'prompts', item.promptFile), `Context for ${item.id}`);
  const inputAreas = areas.map(({ createPrompt, ...item }) => item);
  const beforeTasks = JSON.stringify(tasks), beforeState = JSON.stringify(state);
  const ctx = { passedFiles: [passed('priority-areas', { areas: inputAreas }), passed('morning-tasks', { tasks }), passed('task-priority-state', state), ...extra] };
  await proposer.run(ctx, { now: NOW, ...cfg }, { __projectRoot: root });
  return {
    contexts: ctx.passedFiles.filter(item => item.type === 'task-proposal-context'),
    skipped: ctx.passedFiles.find(item => item.type === 'task-proposal-context-skipped').documents[0].json,
    tasksUnchanged: beforeTasks === JSON.stringify(tasks),
    stateUnchanged: beforeState === JSON.stringify(state)
  };
}

test('builds one passedFiles context entry for an eligible area without calling an LLM', async t => {
  const result = await run(t, { areas: [area('pattern-witness')] });
  assert.equal(result.contexts.length, 1);
  assert.equal(result.contexts[0].areaId, 'pattern-witness');
  assert.match(result.contexts[0].prompt, /Context for pattern-witness/);
  assert.match(result.contexts[0].prompt, /Return only valid JSON/);
});

test('areas without promptFile are reported as skipped', async t => {
  const result = await run(t, { areas: [area('finance', { promptFile: null })] });
  assert.equal(result.contexts.length, 0);
  assert.equal(result.skipped.areasSkipped[0].reasonCode, 'MISSING_PROMPT_FILE');
});

test('missing prompt files are reported as skipped', async t => {
  const result = await run(t, { areas: [area('foxfire', { createPrompt: false })] });
  assert.equal(result.skipped.areasSkipped[0].reasonCode, 'PROMPT_FILE_NOT_FOUND');
});

test('each context contains only matching tasks including completed history', async t => {
  const tasks = [
    { id: '1', areaId: 'a', title: 'Open A', status: 'open' },
    { id: '2', areaId: 'a', title: 'Completed A', status: 'closed' },
    { id: '3', areaId: 'b', title: 'Other B', status: 'cancelled' }
  ];
  const result = await run(t, { areas: [area('a')], tasks });
  const payload = result.contexts[0].documents[0].json;
  assert.deepEqual(payload.tasks.map(task => task.title), ['Open A', 'Completed A']);
});

test('multiple areas become separate passedFiles entries with different prompts', async t => {
  const result = await run(t, { areas: [area('a'), area('b')] });
  assert.equal(result.contexts.length, 2);
  assert.match(result.contexts[0].prompt, /Context for a/);
  assert.doesNotMatch(result.contexts[0].prompt, /Context for b/);
  assert.match(result.contexts[1].prompt, /Context for b/);
});

test('selection makes an area eligible before its cadence is due', async t => {
  const extra = [passed('area-priorities', { selectedItems: [{ areaId: 'a' }] })];
  const result = await run(t, { areas: [area('a')], state: { areas: { a: { lastSelectedAt: NOW } } }, extra });
  assert.equal(result.contexts.length, 1);
});

test('configured passedFiles and context files are included', async t => {
  const extra = [passed('area-notes', { note: 'Shared note' })];
  const result = await run(t, { areas: [area('a')], extra, cfg: { contextInputTypes: ['area-notes'] } });
  assert.equal(result.contexts[0].documents[0].json.context.passedFiles[0].type, 'area-notes');
});

test('builder never mutates tasks or priority state', async t => {
  const result = await run(t, { areas: [area('a')], tasks: [{ id: '1', areaId: 'a', status: 'closed' }], state: { areas: { a: { selectionCount: 2 } } } });
  assert.equal(result.tasksUnchanged, true);
  assert.equal(result.stateUnchanged, true);
});

test('proposal instructions require the exact tasks.json task shape', async t => {
  const result = await run(t, {
    areas: [area('a')],
    tasks: [{ id: 'task-20260718-004', areaId: 'a', title: 'Existing', status: 'open' }]
  });
  const context = result.contexts[0];
  const payload = context.documents[0].json;

  assert.deepEqual(payload.proposalTaskIds, [
    'task-20260718-005',
    'task-20260718-006',
    'task-20260718-007',
    'task-20260718-008',
    'task-20260718-009'
  ]);
  for (const field of ['id', 'title', 'areaId', 'dueDate', 'status', 'notes', 'createdAt', 'updatedAt', 'closedAt']) {
    assert.match(context.prompt, new RegExp(`"${field}"`));
  }
  for (const removed of ['"description"', '"estimatedDueDate"', '"confidence"', '"proposalType"']) {
    assert.doesNotMatch(context.prompt.split('Return only valid JSON using this shape:')[1].split('Do not add proposal-only fields')[0], new RegExp(removed));
  }
});

test('reserved proposal task IDs remain unique across area contexts', async t => {
  const result = await run(t, { areas: [area('a'), area('b')], cfg: { maxProposalsPerArea: 2 } });
  const ids = result.contexts.flatMap(context => context.documents[0].json.proposalTaskIds);
  assert.equal(new Set(ids).size, 4);
  assert.deepEqual(ids, ['task-20260718-001', 'task-20260718-002', 'task-20260718-003', 'task-20260718-004']);
});
