'use strict';

const { _internal } = require('../src/digest');
const { urgentVerbWithAge } = _internal;

function urgent(category, ageHours) {
  return { category, ageHours };
}

test('HOT at 5 hours, hour suffix', () => {
  expect(urgentVerbWithAge(urgent('HOT', 5))).toBe('flagged hot 5h ago');
});

test('HOT at 74 days, day suffix', () => {
  expect(urgentVerbWithAge(urgent('HOT', 74 * 24))).toBe('flagged hot 74d ago');
});

test('needs_review at 30 days, day suffix', () => {
  expect(urgentVerbWithAge(urgent('needs_review', 30 * 24))).toBe('needs review 30d ago');
});

test('path1b at 26 hours, no suffix (context already carries hours)', () => {
  expect(urgentVerbWithAge(urgent('path1b', 26))).toBe('is waiting on you');
});

test('operatorEscalated at 2 days, no suffix (bounded to 7 days)', () => {
  expect(urgentVerbWithAge(urgent('operatorEscalated', 48))).toBe('escalated to you');
});

test('HOT with ageHours null, no suffix', () => {
  expect(urgentVerbWithAge(urgent('HOT', null))).toBe('flagged hot');
});

test('HOT with ageHours undefined, no suffix', () => {
  expect(urgentVerbWithAge(urgent('HOT', undefined))).toBe('flagged hot');
});

// ── 24-hour boundary ─────────────────────────────────────────────────────────

test('23 hours, renders hours, not days', () => {
  expect(urgentVerbWithAge(urgent('HOT', 23))).toBe('flagged hot 23h ago');
});

test('24 hours, renders 1 day, not hours', () => {
  expect(urgentVerbWithAge(urgent('HOT', 24))).toBe('flagged hot 1d ago');
});
