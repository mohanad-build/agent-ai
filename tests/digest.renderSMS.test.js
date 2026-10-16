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
    'Leads: handled 6 overnight (3 new, 2 follow-ups, 1 filtered).',
    '🔥 Sarah K (45 Maple) flagged hot.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, urgent)).toBe(expected);
});

test('active morning, multiple urgent items, appends correct "+ N more leads" suffix', () => {
  const stats = makeStats(4, 5, 3, 3);
  const urgent = makeHotUrgent('Sarah', 'K', '45 Maple');
  const expected = [
    'Leads: handled 12 overnight (4 new, 5 follow-ups, 3 filtered).',
    '🔥 Sarah K (45 Maple) flagged hot + 2 more leads.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, urgent)).toBe(expected);
});

test('quiet morning, no urgent, two-line output ending with None need you', () => {
  const stats = makeStats(0, 5, 7, 0);
  const expected = [
    'Leads: handled 12 overnight (5 follow-ups, 7 filtered). None need you.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, null)).toBe(expected);
});

test('Path 1B urgent with 26 hours elapsed — correct context and verb phrase', () => {
  const stats = makeStats(2, 1, 3, 1);
  const urgent = { firstName: 'Mike', lastInitial: 'T', category: 'path1b', propertyReference: null, hoursAwaiting: 26 };
  const expected = [
    'Leads: handled 6 overnight (2 new, 1 follow-up, 3 filtered).',
    '🔥 Mike T (Path 1B 26h) is waiting on you.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, urgent)).toBe(expected);
});

test('total of exactly 1 handled overnight, singular "lead"', () => {
  const stats = makeStats(1, 0, 0, 0);
  const expected = [
    'Leads: handled 1 overnight (1 new). None need you.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, null)).toBe(expected);
});

test('exactly 1 follow-up fired, total other than 1, singular "follow-up", plural "leads"', () => {
  const stats = makeStats(2, 1, 3, 0);
  const expected = [
    'Leads: handled 6 overnight (2 new, 1 follow-up, 3 filtered). None need you.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, null)).toBe(expected);
});

test('needs_review urgent with no property reference — context and verb phrase match the maps', () => {
  const stats = makeStats(1, 0, 2, 1);
  const urgent = { firstName: 'John', lastInitial: 'D', category: 'needs_review', propertyReference: null, hoursAwaiting: null };
  const expected = [
    'Leads: handled 3 overnight (1 new, 2 filtered).',
    '🔥 John D (needs review) needs review.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, urgent)).toBe(expected);
});

test('HOT urgent with no property reference — falls back to (HOT signal) context', () => {
  const stats = makeStats(1, 0, 1, 1);
  const urgent = makeHotUrgent('Sarah', 'K', null);
  const expected = [
    'Leads: handled 2 overnight (1 new, 1 filtered).',
    '🔥 Sarah K (HOT signal) flagged hot.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, urgent)).toBe(expected);
});

test('quiet automation but urgent leads present — SMS opener counts urgent leads, not automation', () => {
  const stats = makeStats(0, 0, 0, 2);
  const urgent = makeHotUrgent('Sarah', 'K', '45 Maple');
  const expected = [
    'Leads: 2 leads need you this morning.',
    '🔥 Sarah K (45 Maple) flagged hot + 1 more lead.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, urgent)).toBe(expected);
});

test('all stats zero and no urgent — totals to 0, two-line output', () => {
  const stats = makeStats(0, 0, 0, 0);
  const expected = [
    'Leads: quiet overnight. None need you.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, null)).toBe(expected);
});

// The parenthetical omits any zero-count part. Four shapes, by how many
// of the three counts (new, follow-ups, filtered) are non-zero.

test('opener parenthetical: zero non-zero parts reads "quiet overnight"', () => {
  const stats = makeStats(0, 0, 0, 0);
  const expected = [
    'Leads: quiet overnight. None need you.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, null)).toBe(expected);
});

test('opener parenthetical: one non-zero part', () => {
  const stats = makeStats(2, 0, 0, 0);
  const expected = [
    'Leads: handled 2 overnight (2 new). None need you.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, null)).toBe(expected);
});

test('opener parenthetical: two non-zero parts', () => {
  const stats = makeStats(2, 1, 0, 0);
  const expected = [
    'Leads: handled 3 overnight (2 new, 1 follow-up). None need you.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, null)).toBe(expected);
});

test('opener parenthetical: all three non-zero parts, nothing omitted', () => {
  const stats = makeStats(2, 1, 3, 0);
  const expected = [
    'Leads: handled 6 overnight (2 new, 1 follow-up, 3 filtered). None need you.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, null)).toBe(expected);
});

test('leads unavailable (permission): couldnt_check, actionable line, errorKind does not change the wording', () => {
  const stats = { ...makeStats(0, 0, 0, 0), leads: { status: 'unavailable', errorKind: 'permission' } };
  const expected = [
    "Couldn't read your lead sheet this morning. Check your inbox for new leads yourself today. Mo has been told.",
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, null)).toBe(expected);
});

test('leads unavailable (not_found): same couldnt_check line as permission -- the SMS does not distinguish', () => {
  const stats = { ...makeStats(0, 0, 0, 0), leads: { status: 'unavailable', errorKind: 'not_found' } };
  const expected = [
    "Couldn't read your lead sheet this morning. Check your inbox for new leads yourself today. Mo has been told.",
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, null)).toBe(expected);
});

test('SMS output includes the CALLED affordance for a HOT urgent row with a leadId', () => {
  const stats = makeStats(1, 0, 0, 1);
  const urgent = { ...makeHotUrgent('Sarah', 'K', '45 Maple'), leadId: 'sarah@example.com' };
  expect(renderSMS(stats, urgent)).toContain('Reply CALLED sarah@example.com');
});

test('dealsLine renders before the leads opener on a quiet morning', () => {
  const stats = makeStats(0, 0, 0, 0);
  const dealsLine = '📋 12 Main St: deposit not confirmed, 2 days after acceptance.';
  const expected = [
    dealsLine,
    'Leads: quiet overnight. None need you.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, null, dealsLine)).toBe(expected);
});

test('dealsLine renders before the leads opener and the urgent line', () => {
  const stats = makeStats(1, 0, 0, 1);
  const urgent = makeHotUrgent('Sarah', 'K', '45 Maple');
  const dealsLine = '📋 12 Main St: deposit not confirmed, 2 days after acceptance.';
  const expected = [
    dealsLine,
    'Leads: handled 1 overnight (1 new).',
    '🔥 Sarah K (45 Maple) flagged hot.',
    'Full brief in your inbox.',
  ].join('\n');
  expect(renderSMS(stats, urgent, dealsLine)).toBe(expected);
});
