const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sms = require('./sms');

test('extractMessage selects documents by inputType', () => {
  const passedFiles = [
    {
      name: 'review',
      type: 'reviewContent',
      documents: [{ filename: 'review.md', content: '# Not this' }]
    },
    {
      name: 'daily-ollama',
      type: 'SMSOutput',
      documents: [{ filename: 'ollama.md', content: '**Grade: A-**\n\nStrong draft.' }]
    }
  ];

  assert.equal(
    sms._private.extractMessage(passedFiles, { inputType: 'SMSOutput' }),
    'Grade: A-\n\nStrong draft.'
  );
});

test('extractMessage returns null when inputType is absent', () => {
  const passedFiles = [
    {
      name: 'daily-ollama',
      type: 'ContentReview',
      documents: [{ filename: 'ollama.md', content: 'Grade: A-' }]
    }
  ];

  assert.equal(
    sms._private.extractMessage(passedFiles, { inputType: 'SMSOutput' }),
    null
  );
});

test('resolveRecipient supports phoneNumber before env fallback', () => {
  assert.equal(
    sms._private.resolveRecipient({ phoneNumber: '+15555555555', to: '+16666666666' }),
    '+15555555555'
  );
});

test('resolveMaxDailySends supports configured aliases', () => {
  assert.equal(sms._private.resolveMaxDailySends({ maxDailySends: 2 }), 2);
  assert.equal(sms._private.resolveMaxDailySends({ maxDailySend: '1' }), 1);
  assert.equal(sms._private.resolveMaxDailySends({ dailySendLimit: 0 }), 0);
  assert.equal(sms._private.resolveMaxDailySends({}), null);
});

test('daily send state counts only the current day', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-sms-test-'));
  const statePath = path.join(dir, 'sms-state.json');
  const key = sms._private.sendLimitKey('twilio', '+1 (555) 555-5555', { inputType: 'DailyFocusSMS' });

  const first = sms._private.recordDailySend(statePath, key, new Date('2026-05-17T12:00:00'));
  const second = sms._private.recordDailySend(statePath, key, new Date('2026-05-17T13:00:00'));
  const nextDay = sms._private.getDailySendStatus(statePath, key, new Date('2026-05-18T08:00:00'));

  assert.equal(first.count, 1);
  assert.equal(second.count, 2);
  assert.equal(nextDay.count, 0);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('run skips before provider call when daily send limit is reached', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-sms-test-'));
  const statePath = path.join(dir, 'sms-state.json');
  const key = sms._private.sendLimitKey('twilio', '+15555555555', { inputType: 'SMSOutput' });
  sms._private.recordDailySend(statePath, key);

  const result = await sms.run(
    {
      passedFiles: [
        {
          name: 'daily-ollama',
          type: 'SMSOutput',
          documents: [{ filename: 'ollama.md', content: 'Grade: A-. Strong draft.' }]
        }
      ]
    },
    {
      provider: 'twilio',
      phoneNumber: '+15555555555',
      inputType: 'SMSOutput',
      maxDailySends: 1,
      sendStateFile: statePath
    },
    {}
  );

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'daily-send-limit');
  assert.equal(result.count, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('run dryRun returns selected and truncated body without provider calls', async () => {
  const result = await sms.run(
    {
      passedFiles: [
        {
          name: 'daily-ollama',
          type: 'SMSOutput',
          documents: [{ filename: 'ollama.md', content: 'Grade: A-. Strong draft.' }]
        }
      ]
    },
    {
      provider: 'twilio',
      phoneNumber: '+15555555555',
      inputType: 'SMSOutput',
      maxLength: 10,
      dryRun: true
    },
    {}
  );

  assert.deepEqual(result, {
    provider: 'twilio',
    to: '+15555555555',
    from: null,
    body: 'Grade: A-.',
    dryRun: true
  });
});
