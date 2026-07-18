const assert = require('node:assert/strict');
const test = require('node:test');

const extractBlocks = require('./extract-blocks');

test('extract-blocks only mutates matching sourceNames', async () => {
  const ctx = {
    passedFiles: [
      {
        name: 'prompt',
        sourceName: 'prompt',
        type: 'artifact',
        documents: [{ filename: 'EditorReview.md', content: 'Keep this whole prompt.' }]
      },
      {
        name: 'chapter',
        sourceName: 'content-recent',
        type: 'artifact',
        documents: [{ filename: 'chapter.md', content: 'Before <BEGIN_CONTENT>Scene text.<END_CONTENT> After' }]
      }
    ]
  };

  await extractBlocks.run(ctx, {
    inputType: 'artifact',
    sourceNames: ['content-recent'],
    start: '<BEGIN_CONTENT>',
    end: '<END_CONTENT>',
    includeFilename: true
  }, {});

  assert.equal(ctx.passedFiles[0].documents[0].content, 'Keep this whole prompt.');
  assert.equal(ctx.passedFiles[1].documents[0].content, '### chapter.md\n\nScene text.');
});

test('extract-blocks matches itemNames when configured', async () => {
  const ctx = {
    passedFiles: [
      {
        name: 'target-item',
        sourceName: 'other-source',
        type: 'artifact',
        documents: [{ filename: 'target.md', content: '<a>Target<a-end>' }]
      }
    ]
  };

  await extractBlocks.run(ctx, {
    inputType: 'artifact',
    itemNames: ['target-item'],
    start: '<a>',
    end: '<a-end>',
    includeFilename: false
  }, {});

  assert.equal(ctx.passedFiles[0].documents[0].content, 'Target');
});
