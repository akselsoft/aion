const assert = require('node:assert/strict');
const test = require('node:test');

const email = require('./email');

test('dayOfWeekNumber uses 1 Sunday through 7 Saturday', () => {
  assert.equal(email._private.dayOfWeekNumber(new Date('2026-05-24T12:00:00Z')), 1);
  assert.equal(email._private.dayOfWeekNumber(new Date('2026-05-25T12:00:00Z')), 2);
  assert.equal(email._private.dayOfWeekNumber(new Date('2026-05-30T12:00:00Z')), 7);
});

test('shouldSendToday honors numeric sendOnDOW', () => {
  const monday = new Date('2026-05-25T12:00:00Z');

  assert.equal(email._private.shouldSendToday({ sendOnDOW: 2 }, monday), true);
  assert.equal(email._private.shouldSendToday({ sendOnDow: 2 }, monday), true);
  assert.equal(email._private.shouldSendToday({ sendOnDOW: 1 }, monday), false);
  assert.equal(email._private.shouldSendToday({}, monday), true);
});

test('normalizeSendDays accepts arrays and day names', () => {
  assert.deepEqual(email._private.normalizeSendDays(['Monday', 'fri', 7]), [2, 6, 7]);
  assert.deepEqual(email._private.normalizeSendDays('2, 6'), [2, 6]);
});
