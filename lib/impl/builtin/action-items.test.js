const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const actionItems = require('./action-items');

test('action-items uses configured keywords instead of hardcoded defaults', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-action-items-'));
  const outputFile = path.join(projectRoot, 'Action-Items.md');
  const ctx = {
    passedFiles: [
      {
        name: 'daily-state',
        type: 'artifact',
        documents: [
          {
            filename: 'Daily.md',
            content: [
              'This PR should never have been accepted since it was waiting for client input.',
              'I will discuss with Alex about resetting it back to the original.'
            ].join('\n')
          }
        ]
      }
    ]
  };

  await actionItems.run(ctx, {
    outputFile,
    includeExisting: false,
    keywords: ['discuss with']
  }, { __projectRoot: projectRoot });

  const content = fs.readFileSync(outputFile, 'utf-8');
  assert.doesNotMatch(content, /should never have been accepted/i);
  assert.match(content, /discuss with Alex/i);
});

test('action-items default keywords still include should', () => {
  assert.equal(
    actionItems._private.looksActionable('This PR should never have been accepted.'),
    true
  );
});
