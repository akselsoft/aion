const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ollama = require('./ollama');

test('buildExecutionChunks splits oversized single documents', () => {
  const longContent = Array.from({ length: 200 }, (_, idx) => `Paragraph ${idx}. ${'x'.repeat(80)}`).join('\n\n');
  const sections = [{
    name: 'large-section',
    type: 'artifact',
    prompt: 'Review this content.',
    documents: [{ filename: 'large.md', content: longContent }]
  }];

  const chunks = ollama._private.buildExecutionChunks(sections, { ollama: {} }, 900);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.documents.length === 1));
  assert.ok(chunks.every(chunk => chunk.documents[0].filename.includes('#part-')));
});

test('token check does not require splitting just because multiple sections exist', () => {
  const sections = [
    {
      name: 'one',
      type: 'artifact',
      prompt: 'Summarize.',
      documents: [{ filename: 'one.md', content: 'Short content.' }]
    },
    {
      name: 'two',
      type: 'artifact',
      prompt: 'Summarize.',
      documents: [{ filename: 'two.md', content: 'More short content.' }]
    }
  ];
  const estimatedTokens = ollama._private.estimateSectionsTokens(sections, '', '');

  assert.equal(estimatedTokens < 12000, true);
});

test('extractFinalPrompt collects unique prompts for one final call', () => {
  const prompt = ollama._private.extractFinalPrompt([
    { prompt: 'Summarize this.' },
    { prompt: 'Summarize this.' },
    { prompt: 'Use strict output.' }
  ]);

  assert.equal(prompt, 'Summarize this.\n\nUse strict output.');
});

test('loadChunkPrompt supports inline and file prompts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-ollama-test-'));
  const promptFile = path.join(dir, 'chunk.md');
  fs.writeFileSync(promptFile, 'Pick the top 10 rows.', 'utf8');

  assert.equal(
    ollama._private.loadChunkPrompt({ chunkPrompt: 'Summarize smaller.' }, dir),
    'Summarize smaller.'
  );
  assert.equal(
    ollama._private.loadChunkPrompt({ chunkPromptFile: promptFile }, dir),
    'Pick the top 10 rows.'
  );
  assert.equal(
    ollama._private.loadChunkPrompt({ compressionPrompt: 'Legacy prompt.' }, dir),
    'Legacy prompt.'
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('labelledFileSection labels compressed summaries clearly', () => {
  const section = ollama._private.labelledFileSection('Daily-Input.md', 'Compressed facts.', true);

  assert.equal(section.type, 'compressed-summary');
  assert.equal(section.name, 'Daily-Input.md — Compressed Summary');
  assert.match(section.documents[0].content, /^### Daily-Input\.md — Compressed Summary\n\nCompressed facts\./);
});

test('renderOllamaUserInput includes final prompt and post prompt', () => {
  const userInput = ollama._private.renderOllamaUserInput([
    {
      name: 'Daily-Input.md',
      type: 'pass-through',
      prompt: '',
      documents: [{ filename: 'Daily-Input.md', content: 'Daily facts.' }]
    },
    {
      name: 'Final prompt',
      type: 'final-prompt',
      prompt: 'Return only the daily summary.',
      documents: []
    }
  ], { ollama: { prompts: { postPrompt: 'Custom post prompt.' } } });

  assert.match(userInput, /### Daily-Input\.md\n\nDaily facts\./);
  assert.match(userInput, /### Final prompt\n\n\*\*Prompt:\*\* Return only the daily summary\./);
  assert.match(userInput, /## Note to Interpreter: Rule of Thumb\nCustom post prompt\./);
});

test('renderOllamaUserInput omits post prompt when not configured', () => {
  const userInput = ollama._private.renderOllamaUserInput([
    {
      name: 'Daily-Input.md',
      type: 'pass-through',
      prompt: '',
      documents: [{ filename: 'Daily-Input.md', content: 'Daily facts.' }]
    }
  ], { ollama: {} });

  assert.match(userInput, /### Daily-Input\.md\n\nDaily facts\./);
  assert.doesNotMatch(userInput, /Rule of Thumb/);
  assert.doesNotMatch(userInput, /concise and actionable/);
});

test('renderOllamaUserInput converts JSON documents to plaintext when configured', () => {
  const userInput = ollama._private.renderOllamaUserInput([
    {
      name: 'artifact-json',
      type: 'artifact-json',
      prompt: '',
      documents: [{
        filename: 'artifact-blocks.json',
        filetype: 'json',
        content: JSON.stringify([
          {
            file: 'Chapter.md',
            blocks: [
              { index: 1, content: 'Scene text.' }
            ]
          }
        ], null, 2)
      }]
    }
  ], { ollama: { plaintext: true } });

  assert.match(userInput, /### artifact-json\n\n### Chapter\.md\n\nBlock 1:\nScene text\./);
  assert.doesNotMatch(userInput, /"blocks"/);
});

test('renderOllamaUserInput leaves JSON documents unchanged by default', () => {
  const userInput = ollama._private.renderOllamaUserInput([
    {
      name: 'artifact-json',
      type: 'artifact-json',
      prompt: '',
      documents: [{
        filename: 'artifact-blocks.json',
        filetype: 'json',
        content: '{ "file": "Chapter.md" }'
      }]
    }
  ], { ollama: {} });

  assert.match(userInput, /\{ "file": "Chapter\.md" \}/);
});

test('normalizeSectionsForOllamaInput converts JSON before token and compression handling', () => {
  const sections = ollama._private.normalizeSectionsForOllamaInput([
    {
      name: 'artifact-json',
      type: 'artifact-json',
      prompt: '',
      documents: [{
        filename: 'artifact-blocks.json',
        filetype: 'json',
        content: JSON.stringify([{ file: 'Chapter.md', blocks: [{ index: 1, content: 'Scene text.' }] }])
      }]
    }
  ], { ollama: { plaintext: true } });

  assert.equal(sections[0].documents[0].filetype, 'md');
  assert.match(sections[0].documents[0].content, /### Chapter\.md\n\nBlock 1:\nScene text\./);
});

test('splitTextByChars prefers paragraph boundaries', () => {
  const text = [
    'First paragraph sentence one. First paragraph sentence two.',
    'Second paragraph sentence one. Second paragraph sentence two.',
    'Third paragraph sentence one. Third paragraph sentence two.'
  ].join('\n\n');

  const chunks = ollama._private.splitTextByChars(text, 90);

  assert.deepEqual(chunks, [
    'First paragraph sentence one. First paragraph sentence two.',
    'Second paragraph sentence one. Second paragraph sentence two.',
    'Third paragraph sentence one. Third paragraph sentence two.'
  ]);
});

test('splitTextByChars falls back to sentence boundaries for long paragraphs', () => {
  const text = 'Sentence one has enough detail. Sentence two has enough detail. Sentence three has enough detail.';

  const chunks = ollama._private.splitTextByChars(text, 70);

  assert.deepEqual(chunks, [
    'Sentence one has enough detail. Sentence two has enough detail.',
    'Sentence three has enough detail.'
  ]);
});

test('datedOutputPath writes stable daily companion filename', () => {
  const outPath = ollama._private.datedOutputPath(
    '/tmp/Daily.md',
    {
      datedOutputPattern: '{name}-{date}{ext}',
      datedOutputFormat: 'YYYYMMDD'
    },
    new Date('2026-06-01T14:30:00Z')
  );

  assert.equal(outPath, '/tmp/Daily-20260601.md');
});

test('applyOutputHeader prepends evaluated date when configured', () => {
  const content = ollama._private.applyOutputHeader(
    'Top 3 Accomplishments:\n1. Something happened.',
    {
      prependRunDate: true,
      dateHeaderLabel: 'Date Evaluated'
    },
    new Date('2026-06-01T14:30:00')
  );

  assert.match(content, /^Date Evaluated: 2026-06-01 14:30\n\nTop 3 Accomplishments:/);
});
