const assert = require('node:assert/strict');
const test = require('node:test');

const wordCount = require('./word-count');

test('word-count emits one row per document for matching inputType', async () => {
  const ctx = {
    passedFiles: [
      {
        name: 'Ideas',
        sourceName: 'post-ideas',
        type: 'post-idea',
        documents: [
          { filename: 'A.md', content: 'One two three four.' },
          { filename: 'B.md', content: 'One two three four five six.' }
        ]
      },
      {
        name: 'Other',
        type: 'ignore-me',
        documents: [{ filename: 'C.md', content: 'Should not count.' }]
      }
    ]
  };

  await wordCount.run(ctx, {
    inputType: 'post-idea',
    outputType: 'post-idea-count',
    wordsPerPage: 5
  });

  const out = ctx.passedFiles.at(-1);
  assert.equal(out.type, 'post-idea-count');
  assert.deepEqual(out.documents[0].json.map(row => ({
    name: row.name,
    wordcount: row.wordcount,
    pagecount: row.pagecount
  })), [
    { name: 'A.md', wordcount: 4, pagecount: 1 },
    { name: 'B.md', wordcount: 6, pagecount: 2 }
  ]);
});

test('countWords handles punctuation and apostrophes', () => {
  assert.equal(
    wordCount._private.countWords("Aidan's practical LLM-integration: phase 2."),
    5
  );
});

test('word-count filters matching sourceNames', async () => {
  const ctx = {
    passedFiles: [
      {
        name: 'Prompt',
        sourceName: 'prompt',
        type: 'artifact',
        documents: [{ filename: 'EditorReview.md', content: 'Do not count me.' }]
      },
      {
        name: 'Chapter',
        sourceName: 'content-recent',
        type: 'artifact',
        documents: [{ filename: 'chapter.md', content: 'Count these words.' }]
      }
    ]
  };

  await wordCount.run(ctx, {
    inputType: 'artifact',
    outputType: 'content-review-count',
    sourceNames: ['content-recent']
  });

  assert.deepEqual(ctx.passedFiles.at(-1).documents[0].json.map(row => row.name), ['chapter.md']);
});

test('word-count emits markdown by default', async () => {
  const ctx = {
    passedFiles: [
      {
        name: 'Ideas',
        type: 'post-idea',
        documents: [{ filename: 'A.md', content: 'one two three' }]
      }
    ]
  };

  await wordCount.run(ctx, {
    inputType: 'post-idea',
    outputType: 'post-idea-count',
    wordsPerPage: 2
  });

  const doc = ctx.passedFiles.at(-1).documents[0];
  assert.equal(doc.filetype, 'md');
  assert.match(doc.content, /\| A\.md \| 3 \| 2 \|/);
  assert.match(doc.content, /\| \*\*Total\*\* \| \*\*3\*\* \| \*\*2\*\* \|/);
});
