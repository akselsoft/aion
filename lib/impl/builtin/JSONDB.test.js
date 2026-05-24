const assert = require('node:assert/strict');
const test = require('node:test');

const jsondb = require('./JSONDB');

test('parseJsonRecords accepts fenced JSON arrays', () => {
  const records = jsondb._private.parseJsonRecords([
    '```json',
    '[',
    '  { "topic": "AION", "people": ["Andrew"], "date": "2026-05-17", "summary": "Reviewed prompts.", "detail summary": "AION prompt structure was reviewed." }',
    ']',
    '```'
  ].join('\n'));

  assert.equal(records.length, 1);
  assert.equal(records[0].topic, 'AION');
});

test('mergeCurrent keeps latest summary by topic', () => {
  const current = jsondb._private.mergeCurrent([
    { Topic: 'AION', Date: '2026-05-16', Summary: 'Old summary.' }
  ], [
    jsondb._private.normalizeRecord({
      topic: 'AION',
      date: '2026-05-17',
      summary: 'New summary.',
      'detail summary': 'New detail.'
    })
  ]);

  assert.deepEqual(current, [{
    Topic: 'AION',
    Date: '2026-05-17',
    Summary: 'New summary.',
    People: [],
    'Action Items': []
  }]);
});

test('mergeLongTerm appends history for existing topics and creates new topics', () => {
  const longTerm = jsondb._private.mergeLongTerm([
    {
      Topic: 'AION',
      Priority: null,
      Tier: null,
      History: [{ Date: '2026-05-16', Highlight: 'Older work.', Detail: 'Older detail.' }]
    }
  ], [
    jsondb._private.normalizeRecord({
      topic: 'AION',
      date: '2026-05-17',
      summary: 'Prompt work.',
      'detail summary': 'The prompt workflow was refined.',
      actionItems: [{ action: 'Review output.' }]
    }),
    jsondb._private.normalizeRecord({
      topic: 'Pattern Witness',
      date: '2026-05-17',
      summary: 'Draft focus.',
      'detail summary': 'Pattern Witness drafting remained important.'
    })
  ]);

  const aion = longTerm.find(entry => entry.Topic === 'AION');
  const witness = longTerm.find(entry => entry.Topic === 'Pattern Witness');

  assert.equal(aion.History.length, 2);
  assert.equal(aion.History[1].Highlight, 'Prompt work.');
  assert.deepEqual(aion.History[1]['Action Items'], [{ action: 'Review output.' }]);
  assert.equal(witness.History.length, 1);
});

test('buildPeopleSummary reports latest mention per person', () => {
  const summary = jsondb._private.buildPeopleSummary([
    {
      Topic: 'Work',
      History: [
        { Date: '2026-05-20', Highlight: 'Talked with Paul.', People: ['Paul'] },
        { Date: '2026-05-22', Highlight: 'Followed up with Paul.', People: ['Paul'] }
      ]
    },
    {
      Topic: 'Home',
      History: [
        { Date: '2026-05-23', Highlight: 'Noted Trish context.', People: ['Trish'] }
      ]
    }
  ], new Date('2026-05-23T12:00:00Z'));

  assert.match(summary, /\| Paul \| 2026-05-22 \| Followed up with Paul\. \| Work \|/);
  assert.match(summary, /\| Trish \| 2026-05-23 \| Noted Trish context\. \| Home \|/);
});
