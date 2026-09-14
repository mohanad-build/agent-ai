'use strict';

const { normalizeEmailAddress } = require('../src/transactions/emailAddress');

describe('normalizeEmailAddress', () => {
  it('lowercases', () => {
    expect(normalizeEmailAddress('Jane@Example.com')).toBe('jane@example.com');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeEmailAddress('  jane@example.com  ')).toBe('jane@example.com');
  });

  it('trims and lowercases together', () => {
    expect(normalizeEmailAddress('  Jane@Example.com  ')).toBe('jane@example.com');
  });

  it('leaves an already-normalized value unchanged', () => {
    expect(normalizeEmailAddress('jane@example.com')).toBe('jane@example.com');
  });

  it('treats null as an empty string', () => {
    expect(normalizeEmailAddress(null)).toBe('');
  });

  it('treats undefined as an empty string', () => {
    expect(normalizeEmailAddress(undefined)).toBe('');
  });

  it('treats a non-string value as its stringified, normalized form rather than throwing', () => {
    expect(normalizeEmailAddress(42)).toBe('42');
  });
});
