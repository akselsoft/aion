const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

test('word-count ignores documents matching configured glob patterns', async () => {
  const ctx = {
    passedFiles: [
      {
        name: 'Chapter',
        sourceName: 'content-recent',
        type: 'artifact',
        documents: [
          { filename: 'chapter-1.md', content: 'Count these words.' },
          { filename: 'chapter-1.questions.md', content: 'Ignore these words.' },
          { filename: 'notes.md', path: 'Part 1/chapter.notes.md', content: 'Ignore notes too.' },
          { filename: 'questions.md', content: 'Ignore direct question file.' }
        ]
      }
    ]
  };

  await wordCount.run(ctx, {
    inputType: 'artifact',
    outputType: 'content-review-count',
    ignore: ['*.notes.md', '*questions.md']
  });

  assert.deepEqual(ctx.passedFiles.at(-1).documents[0].json.map(row => row.filename), ['chapter-1.md']);
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

test('word-count merges persisted rows instead of replacing the existing file', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-word-count-'));
  const persistJsonFile = path.join(projectRoot, 'wordcontent.json');
  fs.writeFileSync(persistJsonFile, JSON.stringify([
    { name: 'chapter-10.md', filename: 'chapter-10.md', wordcount: 100, pagecount: 1 },
    { name: 'chapter-2.md', filename: 'chapter-2.md', wordcount: 200, pagecount: 1 }
  ], null, 2));

  const ctx = {
    passedFiles: [
      {
        name: 'Updated',
        sourceName: 'content-recent',
        type: 'artifact',
        documents: [
          { filename: 'chapter-2.md', content: 'one two three four five' },
          { filename: 'chapter-1.md', content: 'one two three' }
        ]
      }
    ]
  };

  await wordCount.run(ctx, {
    inputType: 'artifact',
    outputType: 'content-review-count',
    sourceNames: ['content-recent'],
    wordsPerPage: 4,
    persistJsonFile,
    mergeExisting: true
  }, { __projectRoot: projectRoot });

  const persisted = JSON.parse(fs.readFileSync(persistJsonFile, 'utf-8'));
  assert.deepEqual(persisted.map(row => ({
    filename: row.filename,
    wordcount: row.wordcount,
    pagecount: row.pagecount
  })), [
    { filename: 'chapter-1.md', wordcount: 3, pagecount: 1 },
    { filename: 'chapter-2.md', wordcount: 5, pagecount: 2 },
    { filename: 'chapter-10.md', wordcount: 100, pagecount: 1 }
  ]);

  const markdown = ctx.passedFiles.at(-1).documents[0].content;
  assert.ok(markdown.indexOf('chapter-1.md') < markdown.indexOf('chapter-2.md'));
  assert.ok(markdown.indexOf('chapter-2.md') < markdown.indexOf('chapter-10.md'));
});

test('word-count removes ignored rows when merging persisted counts', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-word-count-'));
  const persistJsonFile = path.join(projectRoot, 'wordcontent.json');
  fs.writeFileSync(persistJsonFile, JSON.stringify([
    { name: 'chapter-1.md', filename: 'chapter-1.md', wordcount: 100, pagecount: 1 },
    { name: 'chapter-1.questions.md', filename: 'chapter-1.questions.md', wordcount: 50, pagecount: 1 }
  ], null, 2));

  const ctx = {
    passedFiles: [
      {
        name: 'Updated',
        sourceName: 'content-recent',
        type: 'artifact',
        documents: [
          { filename: 'chapter-2.md', content: 'one two three' },
          { filename: 'chapter-2.questions.md', content: 'ignored questions' }
        ]
      }
    ]
  };

  await wordCount.run(ctx, {
    inputType: 'artifact',
    outputType: 'content-review-count',
    persistJsonFile,
    ignore: ['*questions.md']
  }, { __projectRoot: projectRoot });

  const persisted = JSON.parse(fs.readFileSync(persistJsonFile, 'utf-8'));
  assert.deepEqual(persisted.map(row => row.filename), ['chapter-1.md', 'chapter-2.md']);
});
