'use strict';

// Note: name parsing (firstName/lastInitial from raw name string) is done by
// gatherWindowData (step 5a). Tests 26-29 from the original spec belong in
// step 5a's test file. Rows here arrive already annotated with firstName/lastInitial.

const { categorizeRowsForDigest } = require('../src/digest');

const NOW = new Date('2026-05-12T12:00:00Z');

// Base annotated row — override fields per test.
function makeRow(overrides) {
  return {
    leadId: 'lead@example.com',
    name: 'Sarah Khan',
    firstName: 'Sarah',
    lastInitial: 'K',
    phone: '',
    status: 'awaiting_response',
    followUpCount: '0',
    lastFollowUpDate: '',
    originalMessage: 'Inquiry about 45 Maple',
    conversationHistory: '',
    gmailThreadId: 'thread-1',
    aiEnabled: 'TRUE',
    lastActionTimestamp: '',
    operatorEscalated: '',
    leadCategory: '',
    dateAdded: '2026-05-12',
    rowIndex: 2,
    propertyReference: '45 Maple',
    createdInWindow: true,
    nextTouchEligibleAt: null,
    nextTouchDay: null,
    lastFollowUpFire: null,
    ...overrides,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hoursAgo(h) {
  return new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();
}

function daysAgo(d) {
  return new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000).toISOString();
}

function hoursFromNow(h) {
  return new Date(NOW.getTime() + h * 60 * 60 * 1000).toISOString();
}

// ── urgent: HOT ───────────────────────────────────────────────────────────────

test('HOT row → in urgent with category HOT, AND in hotLeads', () => {
  const row = makeRow({ status: 'HOT', lastActionTimestamp: hoursAgo(3) });
  const { urgent, hotLeads } = categorizeRowsForDigest([row], NOW);
  expect(urgent).toHaveLength(1);
  expect(urgent[0].category).toBe('HOT');
  expect(hotLeads).toHaveLength(1);
});

test('needs_review row → in urgent with category needs_review', () => {
  const row = makeRow({ status: 'needs_review', lastActionTimestamp: hoursAgo(5) });
  const { urgent } = categorizeRowsForDigest([row], NOW);
  expect(urgent).toHaveLength(1);
  expect(urgent[0].category).toBe('needs_review');
});

test('awaiting_agent 26h ago → urgent with category path1b, hoursAwaiting === 26', () => {
  const row = makeRow({ status: 'awaiting_agent', lastActionTimestamp: hoursAgo(26) });
  const { urgent } = categorizeRowsForDigest([row], NOW);
  expect(urgent).toHaveLength(1);
  expect(urgent[0].category).toBe('path1b');
  expect(urgent[0].hoursAwaiting).toBe(26);
});

test('awaiting_agent 12h ago → does NOT appear in urgent (under 24h threshold)', () => {
  const row = makeRow({ status: 'awaiting_agent', lastActionTimestamp: hoursAgo(12) });
  const { urgent } = categorizeRowsForDigest([row], NOW);
  expect(urgent).toHaveLength(0);
});

test('operatorEscalated set 2 days ago → urgent with category operatorEscalated', () => {
  const row = makeRow({ operatorEscalated: daysAgo(2) });
  const { urgent } = categorizeRowsForDigest([row], NOW);
  expect(urgent).toHaveLength(1);
  expect(urgent[0].category).toBe('operatorEscalated');
});

test('operatorEscalated set 10 days ago → does NOT appear in urgent (outside 7d bound)', () => {
  const row = makeRow({ operatorEscalated: daysAgo(10) });
  const { urgent } = categorizeRowsForDigest([row], NOW);
  expect(urgent).toHaveLength(0);
});

test('HOT + awaiting_agent 26h → appears once in urgent with category HOT (priority wins)', () => {
  const row = makeRow({ status: 'HOT', lastActionTimestamp: hoursAgo(26) });
  const { urgent } = categorizeRowsForDigest([row], NOW);
  expect(urgent).toHaveLength(1);
  expect(urgent[0].category).toBe('HOT');
});

test('three urgent rows sorted descending by triggerTimestamp', () => {
  const rows = [
    makeRow({ status: 'HOT', lastActionTimestamp: hoursAgo(10), rowIndex: 2 }),
    makeRow({ status: 'HOT', lastActionTimestamp: hoursAgo(2),  rowIndex: 3 }),
    makeRow({ status: 'HOT', lastActionTimestamp: hoursAgo(5),  rowIndex: 4 }),
  ];
  const { urgent } = categorizeRowsForDigest(rows, NOW);
  expect(urgent).toHaveLength(3);
  expect(urgent[0].rowIndex).toBe(3); // most recent (2h ago)
  expect(urgent[1].rowIndex).toBe(4); // 5h ago
  expect(urgent[2].rowIndex).toBe(2); // oldest (10h ago)
});

test('path1b hoursAwaiting computed correctly (26h elapsed → 26)', () => {
  const row = makeRow({ status: 'awaiting_agent', lastActionTimestamp: hoursAgo(26) });
  const { urgent } = categorizeRowsForDigest([row], NOW);
  expect(urgent[0].hoursAwaiting).toBe(26);
});

// ── hotLeads ──────────────────────────────────────────────────────────────────

test('two HOT rows → both in hotLeads, sorted descending by lastActionTimestamp', () => {
  const rows = [
    makeRow({ status: 'HOT', lastActionTimestamp: hoursAgo(10), rowIndex: 2 }),
    makeRow({ status: 'HOT', lastActionTimestamp: hoursAgo(3),  rowIndex: 3 }),
  ];
  const { hotLeads } = categorizeRowsForDigest(rows, NOW);
  expect(hotLeads).toHaveLength(2);
  expect(hotLeads[0].rowIndex).toBe(3); // most recent first
  expect(hotLeads[1].rowIndex).toBe(2);
});

test('non-HOT rows not in hotLeads', () => {
  const rows = [
    makeRow({ status: 'awaiting_response' }),
    makeRow({ status: 'needs_review' }),
  ];
  const { hotLeads } = categorizeRowsForDigest(rows, NOW);
  expect(hotLeads).toHaveLength(0);
});

// ── newToReview ───────────────────────────────────────────────────────────────

test('status=new, aiEnabled=FALSE → in newToReview', () => {
  const row = makeRow({ status: 'new', aiEnabled: 'FALSE' });
  const { newToReview } = categorizeRowsForDigest([row], NOW);
  expect(newToReview).toHaveLength(1);
});

test('status=new, aiEnabled=TRUE → NOT in newToReview', () => {
  const row = makeRow({ status: 'new', aiEnabled: 'TRUE' });
  const { newToReview } = categorizeRowsForDigest([row], NOW);
  expect(newToReview).toHaveLength(0);
});

test('status=HOT, aiEnabled=FALSE → NOT in newToReview (wrong status)', () => {
  const row = makeRow({ status: 'HOT', aiEnabled: 'FALSE', lastActionTimestamp: hoursAgo(1) });
  const { newToReview } = categorizeRowsForDigest([row], NOW);
  expect(newToReview).toHaveLength(0);
});

test('status=new, aiEnabled=false lowercase → IS in newToReview (case-insensitive)', () => {
  const row = makeRow({ status: 'new', aiEnabled: 'false' });
  const { newToReview } = categorizeRowsForDigest([row], NOW);
  expect(newToReview).toHaveLength(1);
});

test('status=new, aiEnabled=FALSE, createdInWindow=false → NOT in newToReview', () => {
  const row = makeRow({ status: 'new', aiEnabled: 'FALSE', createdInWindow: false });
  const { newToReview } = categorizeRowsForDigest([row], NOW);
  expect(newToReview).toHaveLength(0);
});

test('status=new, aiEnabled=FALSE, createdInWindow=true → IS in newToReview', () => {
  const row = makeRow({ status: 'new', aiEnabled: 'FALSE', createdInWindow: true });
  const { newToReview } = categorizeRowsForDigest([row], NOW);
  expect(newToReview).toHaveLength(1);
});

test('status=new, aiEnabled=FALSE, createdInWindow undefined → NOT in newToReview (strict === true)', () => {
  const row = makeRow({ status: 'new', aiEnabled: 'FALSE', createdInWindow: undefined });
  const { newToReview } = categorizeRowsForDigest([row], NOW);
  expect(newToReview).toHaveLength(0);
});

// ── followUpsDue ──────────────────────────────────────────────────────────────

test('awaiting_response, nextTouchEligibleAt 12h in future → in followUpsDue', () => {
  const row = makeRow({
    status: 'awaiting_response',
    nextTouchEligibleAt: hoursFromNow(12),
    nextTouchDay: 3,
    lastFollowUpDate: daysAgo(3),
  });
  const { followUpsDue } = categorizeRowsForDigest([row], NOW);
  expect(followUpsDue).toHaveLength(1);
  expect(followUpsDue[0].touchDay).toBe(3);
});

test('awaiting_response, nextTouchEligibleAt 36h in future → NOT in followUpsDue', () => {
  const row = makeRow({ status: 'awaiting_response', nextTouchEligibleAt: hoursFromNow(36) });
  const { followUpsDue } = categorizeRowsForDigest([row], NOW);
  expect(followUpsDue).toHaveLength(0);
});

test('awaiting_response, nextTouchEligibleAt 1h in past → NOT in followUpsDue', () => {
  const row = makeRow({ status: 'awaiting_response', nextTouchEligibleAt: hoursAgo(1) });
  const { followUpsDue } = categorizeRowsForDigest([row], NOW);
  expect(followUpsDue).toHaveLength(0);
});

test('awaiting_response, nextTouchEligibleAt null → NOT in followUpsDue', () => {
  const row = makeRow({ status: 'awaiting_response', nextTouchEligibleAt: null });
  const { followUpsDue } = categorizeRowsForDigest([row], NOW);
  expect(followUpsDue).toHaveLength(0);
});

test('awaiting_response, aiEnabled=FALSE → NOT in followUpsDue', () => {
  const row = makeRow({
    status: 'awaiting_response',
    aiEnabled: 'FALSE',
    nextTouchEligibleAt: hoursFromNow(12),
  });
  const { followUpsDue } = categorizeRowsForDigest([row], NOW);
  expect(followUpsDue).toHaveLength(0);
});

test('followUpsDue sorted ascending by nextTouchEligibleAt (soonest first)', () => {
  const rows = [
    makeRow({ status: 'awaiting_response', nextTouchEligibleAt: hoursFromNow(20), rowIndex: 2 }),
    makeRow({ status: 'awaiting_response', nextTouchEligibleAt: hoursFromNow(6),  rowIndex: 3 }),
  ];
  const { followUpsDue } = categorizeRowsForDigest(rows, NOW);
  expect(followUpsDue).toHaveLength(2);
  expect(followUpsDue[0].rowIndex).toBe(3); // soonest first
  expect(followUpsDue[1].rowIndex).toBe(2);
});

// ── followUpsFiredOvernight ───────────────────────────────────────────────────

test('row with lastFollowUpFire annotation → appears in followUpsFiredOvernight', () => {
  const row = makeRow({
    lastFollowUpFire: { touchDay: 3, timestamp: hoursAgo(5), mode: 'shadow' },
  });
  const { followUpsFiredOvernight } = categorizeRowsForDigest([row], NOW);
  expect(followUpsFiredOvernight).toHaveLength(1);
  expect(followUpsFiredOvernight[0].touchDay).toBe(3);
  expect(followUpsFiredOvernight[0].mode).toBe('shadow');
});

test('row with lastFollowUpFire null → NOT in followUpsFiredOvernight', () => {
  const row = makeRow({ lastFollowUpFire: null });
  const { followUpsFiredOvernight } = categorizeRowsForDigest([row], NOW);
  expect(followUpsFiredOvernight).toHaveLength(0);
});

test('two fired rows sorted descending by fire timestamp', () => {
  const rows = [
    makeRow({ lastFollowUpFire: { touchDay: 7, timestamp: hoursAgo(10), mode: 'live' }, rowIndex: 2 }),
    makeRow({ lastFollowUpFire: { touchDay: 3, timestamp: hoursAgo(3),  mode: 'live' }, rowIndex: 3 }),
  ];
  const { followUpsFiredOvernight } = categorizeRowsForDigest(rows, NOW);
  expect(followUpsFiredOvernight).toHaveLength(2);
  expect(followUpsFiredOvernight[0].rowIndex).toBe(3); // most recent fire first
  expect(followUpsFiredOvernight[1].rowIndex).toBe(2);
});

test('mode and touchDay copied from lastFollowUpFire annotation', () => {
  const row = makeRow({
    lastFollowUpFire: { touchDay: 14, timestamp: hoursAgo(2), mode: 'live' },
  });
  const { followUpsFiredOvernight } = categorizeRowsForDigest([row], NOW);
  expect(followUpsFiredOvernight[0].mode).toBe('live');
  expect(followUpsFiredOvernight[0].touchDay).toBe(14);
});
