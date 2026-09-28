'use strict';

const { safeCompare } = require('../src/safeCompare');

test('equal strings return true', () => {
  expect(safeCompare('hunter2', 'hunter2')).toBe(true);
});

test('different strings of equal length return false', () => {
  expect(safeCompare('hunter2', 'hunter3')).toBe(false);
});

test('different lengths return false without throwing', () => {
  expect(() => safeCompare('short', 'a-much-longer-string')).not.toThrow();
  expect(safeCompare('short', 'a-much-longer-string')).toBe(false);
});

test('an empty string versus a non-empty string returns false', () => {
  expect(safeCompare('', 'nonempty')).toBe(false);
});

// Both sides hash to sha256('') and timingSafeEqual compares two identical
// digests, so this returns true - not a special case, just what the
// digest-then-compare implementation does for equal inputs.
test('two empty strings return true', () => {
  expect(safeCompare('', '')).toBe(true);
});
