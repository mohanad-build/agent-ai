'use strict';

const { renderSMS } = require('../src/digest');

// Shared fixture builders
function makeStats(intaken, followUpsFired, noiseFiltered, urgentCount) {
  return { intaken, followUpsFired, noiseFiltered, urgentCount };
}

function makeHotUrgent(firstName, lastInitial, propertyReference) {
  return { firstName, lastInitial, category: 'HOT', propertyReference, hoursAwaiting: null };
}

test('active morning, one HOT urgent with property reference — correct three-line output', () => {
  const stats = makeStats(3, 2, 1, 1);
  const urgent = makeHotUrgent('Sarah', 'K', '45 Maple');
  const expected = [
    'Handled 6 leads overnight: 3 new, 2 follow-ups, 1 filtered.',
    '🔥 Sarah K (45 Maple) wants to call you today.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, urgent)).toBe(expected);
});

test('active morning, multiple urgent items — appends correct "+ N more" suffix', () => {
  const stats = makeStats(4, 5, 3, 3);
  const urgent = makeHotUrgent('Sarah', 'K', '45 Maple');
  const expected = [
    'Handled 12 leads overnight: 4 new, 5 follow-ups, 3 filtered.',
    '🔥 Sarah K (45 Maple) wants to call you today + 2 more.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, urgent)).toBe(expected);
});

test('quiet morning, no urgent — two-line output ending with 0 need you today', () => {
  const stats = makeStats(0, 5, 7, 0);
  const expected = [
    'Handled 12 leads overnight: 0 new, 5 follow-ups, 7 filtered. 0 need you today.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, null)).toBe(expected);
});

test('Path 1B urgent with 26 hours elapsed — correct context and verb phrase', () => {
  const stats = makeStats(2, 1, 3, 1);
  const urgent = { firstName: 'Mike', lastInitial: 'T', category: 'path1b', propertyReference: null, hoursAwaiting: 26 };
  const expected = [
    'Handled 6 leads overnight: 2 new, 1 follow-ups, 3 filtered.',
    '🔥 Mike T (Path 1B 26h) is waiting on you.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, urgent)).toBe(expected);
});

test('needs_review urgent with no property reference — context and verb phrase match the maps', () => {
  const stats = makeStats(1, 0, 2, 1);
  const urgent = { firstName: 'John', lastInitial: 'D', category: 'needs_review', propertyReference: null, hoursAwaiting: null };
  const expected = [
    'Handled 3 leads overnight: 1 new, 0 follow-ups, 2 filtered.',
    '🔥 John D (needs review) needs review.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, urgent)).toBe(expected);
});

test('HOT urgent with no property reference — falls back to (HOT signal) context', () => {
  const stats = makeStats(1, 0, 1, 1);
  const urgent = makeHotUrgent('Sarah', 'K', null);
  const expected = [
    'Handled 2 leads overnight: 1 new, 0 follow-ups, 1 filtered.',
    '🔥 Sarah K (HOT signal) wants to call you today.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, urgent)).toBe(expected);
});

test('quiet automation but urgent leads present — SMS opener counts urgent leads, not automation', () => {
  const stats = makeStats(0, 0, 0, 2);
  const urgent = makeHotUrgent('Sarah', 'K', '45 Maple');
  const expected = [
    '2 leads need you this morning.',
    '🔥 Sarah K (45 Maple) wants to call you today + 1 more.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, urgent)).toBe(expected);
});

test('all stats zero and no urgent — totals to 0, two-line output', () => {
  const stats = makeStats(0, 0, 0, 0);
  const expected = [
    'Handled 0 leads overnight: 0 new, 0 follow-ups, 0 filtered. 0 need you today.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, null)).toBe(expected);
});
