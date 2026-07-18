const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ollama = require('./ollama');
const coreOllama = require('../../../core/engines/ollama');

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

test('core ollama maps contextSize to num_ctx request option', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-ollama-core-'));
  const originalFetch = global.fetch;
  const originalLog = console.log;
  const requests = [];
  const logs = [];
  global.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return {
      ok: true,
      async json() {
        return { message: { content: 'Done.' } };
      }
    };
  };

  try {
    console.log = (...args) => {
      logs.push(args.join(' '));
      originalLog(...args);
    };
    await coreOllama([
      {
        name: 'input',
        documents: [{ filename: 'input.md', content: 'Small input.' }]
      }
    ], {
      ollama: {
        model: 'llama3.1:8b',
        temperature: 0.2,
        contextSize: 8192,
        keepAlive: '30s',
        estimatedTokens: 1234,
        inputFilename: 'ollama-input.md'
      }
    }, dir);
    assert.equal(requests[0].options.temperature, 0.2);
    assert.equal(requests[0].options.num_ctx, 8192);
    assert.equal(requests[0].keep_alive, '30s');
    assert.equal(logs.some(line => line.includes('ollama-input.md (1234 estimated tokens)')), true);

    const debugRequest = JSON.parse(fs.readFileSync(path.join(dir, 'outputs', 'ollama-input.md.request.json'), 'utf8'));
    assert.equal(debugRequest.options.num_ctx, 8192);
    const debugResponse = fs.readFileSync(path.join(dir, 'outputs', 'ollama-input.md.response.md'), 'utf8');
    assert.equal(debugResponse, 'Done.');
  } finally {
    global.fetch = originalFetch;
    console.log = originalLog;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('core ollama sends filename markers when showFileName is enabled', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-ollama-core-'));
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return {
      ok: true,
      async json() {
        return { message: { content: 'Done.' } };
      }
    };
  };

  try {
    await coreOllama([
      {
        name: 'chapter',
        documents: [
          { filename: 'chapter-1.md', showFileName: true, content: 'Chapter one.' },
          { filename: 'chapter-2.md', showFileName: true, content: 'Chapter two.' }
        ]
      }
    ], { ollama: { model: 'llama3.1:8b', inputFilename: 'ollama-input.md' } }, dir);

    const userInput = requests[0].messages.find(message => message.role === 'user').content;
    assert.match(userInput, /---- File: chapter-1\.md\n\nChapter one\./);
    assert.match(userInput, /---- File: chapter-2\.md\n\nChapter two\./);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('core ollama supports streamed chat responses with timeout and num_predict options', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-ollama-stream-'));
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (_url, init) => {
    requests.push({
      body: JSON.parse(init.body),
      hasDispatcher: !!init.dispatcher,
      hasSignal: !!init.signal
    });
    const encoder = new TextEncoder();
    return {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('{"message":{"content":"Hel"}}\n'));
          controller.enqueue(encoder.encode('{"message":{"content":"lo"},"done":true}\n'));
          controller.close();
        }
      }),
      async json() {
        throw new Error('streaming response should not use json()');
      }
    };
  };

  try {
    await coreOllama([
      {
        name: 'input',
        documents: [{ filename: 'input.md', content: 'Small input.' }]
      }
    ], {
      ollama: {
        model: 'qwen2.5:14b',
        stream: true,
        numPredict: 4096,
        headersTimeoutMs: 120000,
        bodyTimeoutMs: 120000,
        requestTimeoutMs: 120000,
        inputFilename: 'stream-input.md'
      }
    }, dir);

    assert.equal(requests[0].body.stream, true);
    assert.equal(requests[0].body.options.num_predict, 4096);
    assert.equal(requests[0].hasDispatcher, true);
    assert.equal(requests[0].hasSignal, true);
    assert.equal(fs.readFileSync(path.join(dir, 'outputs', 'stream-input.md.response.md'), 'utf8'), 'Hello');
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ollama splitInputType fans out one detail document per request with shared headers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-ollama-split-'));
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    if (body.keep_alive === 0 && body.messages.length === 0) {
      return {
        ok: true,
        async json() { return { done: true, done_reason: 'unload' }; }
      };
    }
    const userInput = body.messages.find(message => message.role === 'user').content;
    const filename = userInput.includes('Chapter one.') ? 'chapter-1.md' : 'chapter-2.md';
    return {
      ok: true,
      async json() {
        return { message: { content: `Result for ${filename}.` } };
      }
    };
  };

  try {
    const ctx = {
      passedFiles: [
        {
          name: 'constraints',
          type: 'artifact',
          prompt: 'Use these constraints.',
          documents: [{ filename: 'constraints.md', filetype: 'md', content: 'Shared constraints.' }]
        },
        {
          name: 'story',
          type: 'story',
          prompt: 'Review this story file.',
          documents: [
            { filename: 'chapter-1.md', filetype: 'md', content: 'Chapter one.' },
            { filename: 'chapter-2.md', filetype: 'md', content: 'Chapter two.' }
          ]
        }
      ]
    };

    await ollama.run(ctx, {
      splitInputType: 'story',
      outputType: 'Suggestions',
      model: 'llama3.1:8b',
      tokenLimit: 12000,
      inputFilename: 'Suggestions-ollama-input.md'
    }, { __projectRoot: dir, ollama: {} });

    assert.equal(requests.length, 3);
    const firstUserInput = requests[0].messages.find(message => message.role === 'user').content;
    const secondUserInput = requests[1].messages.find(message => message.role === 'user').content;

    assert.match(firstUserInput, /Shared constraints\./);
    assert.match(firstUserInput, /Chapter one\./);
    assert.doesNotMatch(firstUserInput, /Chapter two\./);
    assert.match(secondUserInput, /Shared constraints\./);
    assert.match(secondUserInput, /Chapter two\./);
    assert.doesNotMatch(secondUserInput, /Chapter one\./);
    assert.deepEqual(requests[2], {
      model: 'llama3.1:8b',
      messages: [],
      keep_alive: 0
    });
    assert.equal(requests[0].messages.find(message => message.role === 'user').content.includes('Chapter one.'), true);
    assert.match(ctx.passedFiles.at(-1).documents[0].content, /## chapter-1\.md\n\nResult for chapter-1\.md\./);
    assert.match(ctx.passedFiles.at(-1).documents[0].content, /## chapter-2\.md\n\nResult for chapter-2\.md\./);
    assert.equal(
      fs.readFileSync(path.join(dir, 'outputs', 'Suggestions-ollama-input-story-001-chapter-1.md.response.md'), 'utf8'),
      'Result for chapter-1.md.'
    );
    assert.equal(
      fs.readFileSync(path.join(dir, 'outputs', 'Suggestions-ollama-input-story-002-chapter-2.md.response.md'), 'utf8'),
      'Result for chapter-2.md.'
    );
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('explicit chunk prompts suppress regular system prompt for compression calls', () => {
  assert.equal(ollama._private.hasExplicitChunkPrompt({ chunkPromptFile: 'prompts/chunk.md' }), true);
  assert.equal(ollama._private.hasExplicitChunkPrompt({}), false);

  const cfg = { ollama: { systemPrompt: 'Main prompt', model: 'llama3.1:8b' } };
  const compressionCfg = ollama._private.compressionCallConfig(cfg, '');

  assert.equal(compressionCfg.ollama.systemPrompt, '');
  assert.equal(compressionCfg.ollama.model, 'llama3.1:8b');
  assert.equal(cfg.ollama.systemPrompt, 'Main prompt');
  assert.equal(ollama._private.compressionCallConfig(cfg, 'Main prompt'), cfg);
});

test('mergeJsonResponses combines JSON chunk outputs structurally', () => {
  const merged = ollama._private.mergeJsonResponses([
    '```json\n{"clusters":[{"clusterTitle":"A","sourceWorkItemIds":[1]}],"unclusteredWorkItemIds":[9]}\n```',
    '{"clusters":[{"clusterTitle":"B","sourceWorkItemIds":[2]},{"clusterTitle":"A","sourceWorkItemIds":[1]}],"unclusteredWorkItemIds":[9,10]}'
  ]);

  assert.deepEqual(merged.value, {
    clusters: [
      { clusterTitle: 'A', sourceWorkItemIds: [1] },
      { clusterTitle: 'B', sourceWorkItemIds: [2] }
    ],
    unclusteredWorkItemIds: [9, 10]
  });
  assert.match(merged.content, /"clusters"/);
});

test('shouldMergeCompressionJson accepts config aliases', () => {
  assert.equal(ollama._private.shouldMergeCompressionJson({ compressionOutputFormat: 'json-merge' }), true);
  assert.equal(ollama._private.shouldMergeCompressionJson({ mergeChunkJson: true }), true);
  assert.equal(ollama._private.shouldMergeCompressionJson({}), false);
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

test('renderOllamaUserInput can prefix each document with its file name', () => {
  const userInput = ollama._private.renderOllamaUserInput([
    {
      name: 'chapter',
      type: 'artifact',
      prompt: '',
      documents: [
        { filename: 'chapter-1.md', showFileName: true, content: 'Chapter one.' },
        { filename: 'chapter-2.md', showFileName: true, content: 'Chapter two.' }
      ]
    }
  ], { ollama: {} });

  assert.match(userInput, /---- File: chapter-1\.md\n\nChapter one\./);
  assert.match(userInput, /---- File: chapter-2\.md\n\nChapter two\./);
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

test('splitJsonDocumentContent chunks top-level JSON arrays without splitting objects', () => {
  const rows = Array.from({ length: 8 }, (_, idx) => ({
    id: idx + 1,
    title: `Feature ${idx + 1}`,
    keywords: ['audit', 'logging', 'database', 'compliance']
  }));

  const chunks = ollama._private.splitJsonDocumentContent(JSON.stringify(rows, null, 2), 260);

  assert.ok(chunks.length > 1);
  const parsed = chunks.map(chunk => JSON.parse(chunk));
  assert.ok(parsed.every(Array.isArray));
  assert.deepEqual(parsed.flat().map(item => item.id), rows.map(item => item.id));
});

test('splitJsonDocumentContent preserves object wrappers around compactItems chunks', () => {
  const compact = {
    compactItems: Array.from({ length: 10 }, (_, idx) => ({
      id: 65000 + idx,
      type: idx % 2 ? 'Bug' : 'Feature',
      title: `Backlog item ${idx}`,
      keywords: ['audit', 'logging', 'database', 'storage', 'compliance'],
      signals: ['architecture', 'security']
    })),
    metadata: {
      sourceCount: 10,
      compactCount: 10,
      truncatedFields: 0,
      emptyDescriptionCount: 0
    }
  };

  const chunks = ollama._private.splitJsonDocumentContent(JSON.stringify(compact, null, 2), 700);

  assert.ok(chunks.length > 1);
  const parsed = chunks.map(chunk => JSON.parse(chunk));
  assert.ok(parsed.every(chunk => Array.isArray(chunk.compactItems)));
  assert.ok(parsed.every(chunk => chunk.metadata.sourceCount === 10));
  assert.deepEqual(
    parsed.flatMap(chunk => chunk.compactItems.map(item => item.id)),
    compact.compactItems.map(item => item.id)
  );
  assert.deepEqual(
    parsed.map(chunk => chunk.metadata.chunkCount),
    Array(chunks.length).fill(chunks.length)
  );
});

test('writeCompressionChunkResponseSnapshot writes chunk response debug file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-ollama-response-'));

  ollama._private.writeCompressionChunkResponseSnapshot(
    dir,
    'backlog-consolidated-ollama-input.md',
    2,
    { name: 'BacklogCompact.json chunk 3/11', type: 'compression-chunk' },
    '{"clusters":[]}'
  );

  const outPath = path.join(dir, 'outputs', 'backlog-consolidated-ollama-input-compression-003-response.md');
  const content = fs.readFileSync(outPath, 'utf8');

  assert.match(content, /# Ollama Compression Chunk 3 Response/);
  assert.match(content, /Chunk: BacklogCompact\.json chunk 3\/11/);
  assert.match(content, /\{"clusters":\[]}/);

  fs.rmSync(dir, { recursive: true, force: true });
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
