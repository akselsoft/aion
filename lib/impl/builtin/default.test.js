const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const responder = require('./default');

test('jsonToMarkdown renders JSON object arrays as readable markdown', () => {
  const markdown = responder._private.renderDocument({
    json: {
      candidateCount: 1,
      selectedItems: [{
        candidateId: 'task:1',
        title: 'Fix validation issue',
        dueDate: null,
        metadata: { status: 'open' }
      }]
    }
  }, true);

  assert.match(markdown, /- \*\*candidateCount:\*\* 1/);
  assert.match(markdown, /1\. \*\*Fix validation issue\*\*/);
  assert.match(markdown, /- \*\*candidateId:\*\* task:1/);
  assert.match(markdown, /- \*\*status:\*\* open/);
  assert.doesNotMatch(markdown, /^\{/);
});

test('jsonToMarkdown parses JSON content when document.json is absent', () => {
  const markdown = responder._private.renderDocument({
    content: JSON.stringify({ selectedItems: ['Review finances'] })
  }, true);

  assert.match(markdown, /- \*\*selectedItems:\*\*/);
  assert.match(markdown, /- Review finances/);
});

test('default responder can replace a stable readable markdown output', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-default-'));
  const outputDir = path.join(projectRoot, 'outputs');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, 'priorities.md');
  fs.writeFileSync(outputFile, 'old content', 'utf8');

  await responder.run({
    passedFiles: [{
      name: 'area-prioritizer',
      type: 'area-priorities',
      documents: [{ json: { selectedItems: [{ title: 'Reach out to Cheryl' }] } }]
    }]
  }, {
    inputType: 'area-priorities',
    outputType: 'file',
    filename: 'priorities.md',
    replace: true,
    jsonToMarkdown: true
  }, { __projectRoot: projectRoot });

  const written = fs.readFileSync(outputFile, 'utf8');
  assert.match(written, /Reach out to Cheryl/);
  assert.doesNotMatch(written, /old content/);
});
