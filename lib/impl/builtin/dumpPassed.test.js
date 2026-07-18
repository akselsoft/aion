const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dumpPassed = require('./dumpPassed');

test('jsonToMarkdown writes a readable markdown snapshot alongside JSON', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-dump-'));
  const ctx = {
    passedFiles: [{
      name: 'area-prioritizer',
      type: 'area-priorities',
      documents: [{
        filename: 'area-priorities.json',
        filetype: 'json',
        content: JSON.stringify({
          candidateCount: 1,
          selectedItems: [{ title: 'Review finances', candidateId: 'area:finance' }]
        })
      }]
    }]
  };

  await dumpPassed.run(ctx, {
    outputType: 'passedFiles-after-prioritizer',
    jsonToMarkdown: true
  }, { __projectRoot: projectRoot });

  const jsonPath = path.join(projectRoot, 'outputs', 'passedFiles-after-prioritizer.json');
  const markdownPath = path.join(projectRoot, 'outputs', 'passedFiles-after-prioritizer.md');
  assert.equal(JSON.parse(fs.readFileSync(jsonPath, 'utf8')).length, 1);

  const markdown = fs.readFileSync(markdownPath, 'utf8');
  assert.match(markdown, /# passedFiles-after-prioritizer/);
  assert.match(markdown, /## 1\. area-prioritizer/);
  assert.match(markdown, /### 1\. area-priorities\.json/);
  assert.match(markdown, /\*\*Review finances\*\*/);
  assert.match(markdown, /candidateId:\*\* area:finance/);
});

test('renderPassedFilesToMarkdown includes every item and document', () => {
  const markdown = dumpPassed._private.renderPassedFilesToMarkdown([
    { name: 'first', documents: [{ filename: 'one.txt', content: 'One' }] },
    { name: 'second', documents: [{ filename: 'two.txt', content: 'Two' }] }
  ], 'all-content');

  assert.match(markdown, /## 1\. first/);
  assert.match(markdown, /One/);
  assert.match(markdown, /## 2\. second/);
  assert.match(markdown, /Two/);
});

test('multiline prompt metadata renders as Markdown instead of HTML break tags', () => {
  const markdown = dumpPassed._private.renderPassedFilesToMarkdown([{
    name: 'task-proposal-context:finance',
    type: 'task-proposal-context',
    prompt: '# Finance Context\n\n## Current state\n\nMaintain reserves.',
    documents: [{ filename: 'finance.json', content: '{}' }]
  }]);

  assert.match(markdown, /# Finance Context\n\n## Current state\n\nMaintain reserves\./);
  assert.doesNotMatch(markdown, /<br>/);
});

test('skipEmpty recursively omits empty JSON fields and containers', () => {
  const markdown = dumpPassed._private.renderPassedFilesToMarkdown([{
    name: 'task-proposal-context:home',
    type: 'task-proposal-context',
    documents: [{
      filename: 'home.json',
      json: {
        selectionHistory: {},
        context: { passedFiles: [], files: [] },
        active: false,
        selectionCount: 0,
        title: 'Review Home'
      }
    }]
  }], 'passedFiles', { skipEmpty: true });

  assert.doesNotMatch(markdown, /selectionHistory/);
  assert.doesNotMatch(markdown, /passedFiles:/);
  assert.doesNotMatch(markdown, /files:/);
  assert.match(markdown, /active:\*\* false/);
  assert.match(markdown, /selectionCount:\*\* 0/);
});
