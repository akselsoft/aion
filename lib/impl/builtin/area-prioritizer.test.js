const assert = require('node:assert/strict');
const test = require('node:test');

const prioritizer = require('./area-prioritizer');

const NOW = '2026-07-18T12:00:00.000Z';

function input(type, payload) {
  return {
    type,
    documents: [{ filename: `${type}.json`, content: JSON.stringify(payload), json: payload }]
  };
}

function area(id, overrides = {}) {
  return {
    id,
    name: id.toUpperCase(),
    tier: 2,
    rank: 1,
    cadence: 'd',
    active: true,
    ...overrides
  };
}

async function select({ tasks = [], areas = [], state = {}, config = {} } = {}) {
  const ctx = {
    passedFiles: [
      input('tasks', { tasks }),
      input('priority-areas', { areas }),
      input('priority-state', state)
    ]
  };
  await prioritizer.run(ctx, { now: NOW, itemLimit: 20, ...config });
  const priorities = ctx.passedFiles.find(item => item.type === (config.outputType || 'area-priorities')).documents[0].json;
  const exclusions = ctx.passedFiles.find(item => item.type === (config.excludedOutputType || `${config.outputType || 'area-priorities'}-excluded`)).documents[0].json;
  return { ...priorities, exclusions };
}

test('area with no task produces a cadence candidate using the area name', async () => {
  const result = await select({ areas: [area('cheryl')] });

  assert.equal(result.selectedItems.length, 1);
  assert.deepEqual(result.selectedItems[0], {
    candidateId: 'area:cheryl',
    candidateType: 'area',
    title: 'CHERYL',
    areaId: 'cheryl',
    areaName: 'CHERYL',
    tier: 2,
    rank: 1,
    cadence: 'd',
    dueDate: null,
    lastSelectedAt: null,
    selectionCount: 0,
    createdAt: null,
    sourceType: 'priority-area',
    sourceId: 'cheryl',
    eligible: true,
    eligibilityReason: 'ELIGIBLE',
    metadata: {
      active: true
    }
  });
});

test('valid open task produces a task candidate with area metadata', async () => {
  const result = await select({
    areas: [area('aion', { tier: 3, rank: 1, cadence: 'w' })],
    tasks: [{ id: 'task-1', title: 'Build morning planner', areaId: 'aion', status: 'open', dueDate: '2026-07-20' }]
  });

  const task = result.selectedItems.find(item => item.candidateType === 'task');
  assert.equal(task.candidateId, 'task:task-1');
  assert.equal(task.sourceType, 'tasks');
  assert.equal(task.sourceId, 'task-1');
  assert.equal(task.tier, 3);
  assert.equal(task.rank, 1);
  assert.deepEqual(task.metadata, { status: 'open' });
});

test('task and area candidates share one authoritative ordered selectedItems collection', async () => {
  const result = await select({
    areas: [
      area('aion', { tier: 3, rank: 1 }),
      area('cheryl', { tier: 2, rank: 1 })
    ],
    tasks: [{
      id: 'fix-validation',
      title: 'Fix validation issue',
      areaId: 'aion',
      status: 'open',
      dueDate: '2026-07-18',
      externalReference: 'DEV-42'
    }]
  });

  assert.deepEqual(result.selectedItems.map(item => [item.candidateType, item.candidateId]), [
    ['task', 'task:fix-validation'],
    ['area', 'area:cheryl'],
    ['area', 'area:aion']
  ]);
  assert.equal(result.selectedItems[0].metadata.externalReference, 'DEV-42');
  assert.equal(result.selectedTasks, undefined);
  assert.equal(result.selectedAreas, undefined);
  assert.equal(result.taskQueue, undefined);
  assert.equal(result.areaQueue, undefined);
});

test('cadence eligibility includes never-selected and due areas but excludes not-yet-due areas', async () => {
  const result = await select({
    areas: [area('never'), area('due'), area('waiting')],
    state: {
      areas: {
        due: { lastSelectedAt: '2026-07-17T01:00:00Z', selectionCount: 1 },
        waiting: { lastSelectedAt: '2026-07-18T01:00:00Z', selectionCount: 1 }
      }
    }
  });

  assert.deepEqual(result.selectedItems.map(item => item.areaId).sort(), ['due', 'never']);
});

test('tier and rank deterministically order otherwise equal candidates', async () => {
  const result = await select({
    areas: [
      area('tier-two', { tier: 2, rank: 1 }),
      area('tier-one-rank-two', { tier: 1, rank: 2 }),
      area('tier-one-rank-one', { tier: 1, rank: 1 })
    ]
  });

  assert.deepEqual(result.selectedItems.map(item => item.areaId), [
    'tier-one-rank-one',
    'tier-one-rank-two',
    'tier-two'
  ]);
});

test('due-date urgency and earlier due date outrank tier', async () => {
  const areas = [area('tier-one', { tier: 1 }), area('tier-three', { tier: 3 })];
  const tasks = [
    { id: 'future', title: 'Future T1', areaId: 'tier-one', status: 'open', dueDate: '2026-08-01' },
    { id: 'soon-later', title: 'Soon T1', areaId: 'tier-one', status: 'open', dueDate: '2026-07-20' },
    { id: 'soon-earlier', title: 'Soon T3', areaId: 'tier-three', status: 'open', dueDate: '2026-07-19' },
    { id: 'overdue', title: 'Overdue T3', areaId: 'tier-three', status: 'open', dueDate: '2026-07-17' }
  ];
  const result = await select({ tasks, areas });

  assert.deepEqual(
    result.selectedItems.filter(item => item.candidateType === 'task').map(item => item.sourceId),
    ['overdue', 'soon-earlier', 'soon-later', 'future']
  );
});

test('selection history prefers never selected, then older selection, then lower count', async () => {
  const areas = ['never', 'older', 'lower-count', 'higher-count'].map(id => area(id));
  const state = {
    areas: {
      older: { lastSelectedAt: '2026-07-15T12:00:00Z', selectionCount: 8 },
      'lower-count': { lastSelectedAt: '2026-07-17T12:00:00Z', selectionCount: 1 },
      'higher-count': { lastSelectedAt: '2026-07-17T12:00:00Z', selectionCount: 3 }
    }
  };
  const result = await select({ areas, state });

  assert.deepEqual(result.selectedItems.map(item => item.areaId), [
    'never',
    'older',
    'lower-count',
    'higher-count'
  ]);
});

test('configured item limit bounds selectedItems', async () => {
  const result = await select({
    areas: [area('a'), area('b'), area('c')],
    config: { itemLimit: 2 }
  });

  assert.equal(result.candidateCount, 3);
  assert.equal(result.eligibleCandidateCount, 3);
  assert.equal(result.selectedCount, 2);
  assert.equal(result.selectedItems.length, 2);
});

test('empty state is accepted without mutation and produces zeroed history', async () => {
  const state = {};
  const before = JSON.stringify(state);
  const result = await select({ areas: [area('a')], state });

  assert.equal(result.selectedItems[0].lastSelectedAt, null);
  assert.equal(result.selectedItems[0].selectionCount, 0);
  assert.equal(JSON.stringify(state), before);
});

test('inactive and cadence-less areas do not produce area candidates', async () => {
  const result = await select({
    areas: [
      area('inactive', { active: false }),
      area('no-cadence', { cadence: null })
    ]
  });

  assert.equal(result.selectedItems.length, 0);
  assert.equal(result.excludedCount, 2);
});

test('output exposes candidate and selection stages separately from exclusions', async () => {
  const result = await select({
    tasks: [{ id: 'task-1', title: 'Do work', areaId: 'active', status: 'open' }],
    areas: [
      area('active'),
      area('waiting')
    ],
    state: { areas: { waiting: { lastSelectedAt: NOW, selectionCount: 1 } } },
    config: { itemLimit: 1 }
  });

  assert.equal(result.sourceRecordCount, 3);
  assert.equal(result.candidateCount, 3);
  assert.equal(result.eligibleCandidateCount, 2);
  assert.equal(result.selectedCount, 1);
  assert.equal(result.excludedCount, 0);
  assert.equal(result.allCandidates.length, 3);
  assert.equal(result.rankedCandidates.length, 2);
  assert.equal(result.selectedItems.length, 1);
  assert.equal(result.excludedItems, undefined);
  assert.deepEqual(result.exclusions.excludedItems, []);
  assert.equal(result.allCandidates.find(item => item.candidateId === 'area:waiting').eligibilityReason, 'CADENCE_NOT_DUE');
});

test('every task record sharing a duplicate source id is reported and not collapsed', async () => {
  const duplicateTasks = [
    { id: 'duplicate', title: 'First conflicting task', areaId: 'aion', status: 'open', notes: 'first record' },
    { id: 'duplicate', title: 'Second conflicting task', areaId: 'aion', status: 'open', notes: 'second record' }
  ];
  const result = await select({ tasks: duplicateTasks, areas: [area('aion')] });
  const conflicts = result.exclusions.excludedItems.filter(item => item.reasonCode === 'DUPLICATE_SOURCE_ID');

  assert.equal(result.sourceRecordCount, 3);
  assert.equal(conflicts.length, 2);
  assert.deepEqual(conflicts.map(item => item.sourceIndex), [0, 1]);
  assert.deepEqual(conflicts.map(item => item.record.title), ['First conflicting task', 'Second conflicting task']);
  assert.equal(result.allCandidates.some(item => item.candidateId === 'task:duplicate'), false);
});

test('area candidates do not require defaultAction', async () => {
  const result = await select({ areas: [area('cheryl')] });

  assert.equal(result.allCandidates.length, 1);
  assert.equal(result.allCandidates[0].title, 'CHERYL');
  assert.equal(result.exclusions.excludedItems.length, 0);
});

test('optional defaultAction overrides the area-name candidate title', async () => {
  const result = await select({ areas: [area('llm-lab', { defaultAction: 'Review LLM Lab experiments' })] });

  assert.equal(result.allCandidates.length, 1);
  assert.equal(result.allCandidates[0].title, 'Review LLM Lab experiments');
});

function normalizedCandidate(candidateId, overrides = {}) {
  return {
    candidateId,
    candidateType: 'candidate',
    title: candidateId,
    areaId: 'area',
    areaName: 'Area',
    tier: 2,
    rank: 2,
    cadence: null,
    dueDate: null,
    lastSelectedAt: null,
    selectionCount: 0,
    createdAt: '2026-07-10T00:00:00.000Z',
    sourceType: 'test-source',
    sourceId: candidateId,
    metadata: {},
    _urgency: 4,
    ...overrides
  };
}

function rankedIds(candidates) {
  return prioritizer._private.rankCandidates(candidates).map(candidate => candidate.candidateId);
}

test('ranking orders normalized candidates by due state', () => {
  const candidates = [
    normalizedCandidate('none', { _urgency: 4 }),
    normalizedCandidate('future', { _urgency: 3, dueDate: '2026-08-01' }),
    normalizedCandidate('soon', { _urgency: 2, dueDate: '2026-07-20' }),
    normalizedCandidate('today', { _urgency: 1, dueDate: '2026-07-18' }),
    normalizedCandidate('overdue', { _urgency: 0, dueDate: '2026-07-17' })
  ];

  assert.deepEqual(rankedIds(candidates), ['overdue', 'today', 'soon', 'future', 'none']);
});

test('ranking prefers earlier due dates within the same due state', () => {
  assert.deepEqual(rankedIds([
    normalizedCandidate('later', { _urgency: 2, dueDate: '2026-07-22' }),
    normalizedCandidate('earlier', { _urgency: 2, dueDate: '2026-07-20' })
  ]), ['earlier', 'later']);
});

test('ranking prefers lower tiers', () => {
  assert.deepEqual(rankedIds([
    normalizedCandidate('tier-three', { tier: 3 }),
    normalizedCandidate('tier-one', { tier: 1 })
  ]), ['tier-one', 'tier-three']);
});

test('ranking prefers lower ranks within a tier', () => {
  assert.deepEqual(rankedIds([
    normalizedCandidate('rank-three', { rank: 3 }),
    normalizedCandidate('rank-one', { rank: 1 })
  ]), ['rank-one', 'rank-three']);
});

test('ranking prefers candidates never selected before', () => {
  assert.deepEqual(rankedIds([
    normalizedCandidate('selected', { lastSelectedAt: '2026-07-01T00:00:00Z' }),
    normalizedCandidate('never', { lastSelectedAt: null })
  ]), ['never', 'selected']);
});

test('ranking prefers older lastSelectedAt among selected candidates', () => {
  assert.deepEqual(rankedIds([
    normalizedCandidate('newer-selection', { lastSelectedAt: '2026-07-15T00:00:00Z' }),
    normalizedCandidate('older-selection', { lastSelectedAt: '2026-07-01T00:00:00Z' })
  ]), ['older-selection', 'newer-selection']);
});

test('ranking prefers lower selectionCount when selection dates tie', () => {
  const lastSelectedAt = '2026-07-01T00:00:00Z';
  assert.deepEqual(rankedIds([
    normalizedCandidate('higher-count', { lastSelectedAt, selectionCount: 4 }),
    normalizedCandidate('lower-count', { lastSelectedAt, selectionCount: 1 })
  ]), ['lower-count', 'higher-count']);
});

test('ranking prefers older createdAt after selection history ties', () => {
  assert.deepEqual(rankedIds([
    normalizedCandidate('newer-created', { createdAt: '2026-07-15T00:00:00Z' }),
    normalizedCandidate('older-created', { createdAt: '2026-07-01T00:00:00Z' })
  ]), ['older-created', 'newer-created']);
});

test('ranking uses lexical candidateId as its stable final tie break', () => {
  assert.deepEqual(rankedIds([
    normalizedCandidate('candidate:z', { candidateType: 'task', sourceType: 'tasks' }),
    normalizedCandidate('candidate:a', { candidateType: 'area', sourceType: 'priority-area' })
  ]), ['candidate:a', 'candidate:z']);
});

test('ranking produces identical complete ordering for identical input data', () => {
  const candidates = [
    normalizedCandidate('candidate:d', { tier: 3 }),
    normalizedCandidate('candidate:b', { _urgency: 1, dueDate: '2026-07-18' }),
    normalizedCandidate('candidate:e', { lastSelectedAt: '2026-07-01T00:00:00Z' }),
    normalizedCandidate('candidate:c', { rank: 1 }),
    normalizedCandidate('candidate:a')
  ];
  const before = JSON.stringify(candidates);

  const first = rankedIds(candidates);
  const second = rankedIds(candidates);

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(candidates), before);
});
