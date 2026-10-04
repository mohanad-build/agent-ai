'use strict';

const { normalizeAgentPhone, formatAgentPhone } = require('../src/agentPhone');

// ── accepted ──────────────────────────────────────────────────────────────

describe('normalizeAgentPhone: accepted', () => {
  test('already E.164', () => {
    expect(normalizeAgentPhone('+14165550123')).toEqual({ ok: true, phone: '+14165550123' });
  });

  test('10 digits, no country code', () => {
    expect(normalizeAgentPhone('4165550123')).toEqual({ ok: true, phone: '+14165550123' });
  });

  test('11 digits, leading 1, no plus', () => {
    expect(normalizeAgentPhone('14165550123')).toEqual({ ok: true, phone: '+14165550123' });
  });

  test('hyphenated', () => {
    expect(normalizeAgentPhone('416-555-0123')).toEqual({ ok: true, phone: '+14165550123' });
  });

  test('parenthesized area code', () => {
    expect(normalizeAgentPhone('(416) 555-0123')).toEqual({ ok: true, phone: '+14165550123' });
  });

  test('dot separated', () => {
    expect(normalizeAgentPhone('416.555.0123')).toEqual({ ok: true, phone: '+14165550123' });
  });

  test('plus, spaces, and surrounding whitespace', () => {
    expect(normalizeAgentPhone('  +1 416 555 0123  ')).toEqual({ ok: true, phone: '+14165550123' });
  });
});

// ── refused ───────────────────────────────────────────────────────────────

describe('normalizeAgentPhone: refused', () => {
  test('empty string', () => {
    expect(normalizeAgentPhone('')).toEqual({ ok: false, reason: 'empty' });
  });

  test('whitespace only', () => {
    expect(normalizeAgentPhone('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  test('null', () => {
    expect(normalizeAgentPhone(null)).toEqual({ ok: false, reason: 'empty' });
  });

  test('undefined', () => {
    expect(normalizeAgentPhone(undefined)).toEqual({ ok: false, reason: 'empty' });
  });

  test('a number, not a string', () => {
    expect(normalizeAgentPhone(12345)).toEqual({ ok: false, reason: 'invalid_input' });
  });

  test('an array, not a string', () => {
    expect(normalizeAgentPhone(['4165550123'])).toEqual({ ok: false, reason: 'invalid_input' });
  });

  test('Google reviewer shape: 10 digits, leading 1, no plus', () => {
    expect(normalizeAgentPhone('1416555012')).toEqual({ ok: false, reason: 'invalid_area_code' });
  });

  test('area code starting with 0', () => {
    expect(normalizeAgentPhone('0165550123')).toEqual({ ok: false, reason: 'invalid_area_code' });
  });

  test('plus with only 10 digits', () => {
    expect(normalizeAgentPhone('+1416555012')).toEqual({ ok: false, reason: 'wrong_length' });
  });

  test('plus without the 1: another country', () => {
    expect(normalizeAgentPhone('+4165550123')).toEqual({ ok: false, reason: 'wrong_length' });
  });

  test('9 digits', () => {
    expect(normalizeAgentPhone('416555012')).toEqual({ ok: false, reason: 'wrong_length' });
  });

  test('11 digits not starting with 1', () => {
    expect(normalizeAgentPhone('24165550123')).toEqual({ ok: false, reason: 'wrong_length' });
  });

  test('exchange starting with 1', () => {
    expect(normalizeAgentPhone('4161550123')).toEqual({ ok: false, reason: 'invalid_exchange' });
  });

  test('exchange starting with 0', () => {
    expect(normalizeAgentPhone('4160550123')).toEqual({ ok: false, reason: 'invalid_exchange' });
  });

  test('trailing extension', () => {
    expect(normalizeAgentPhone('416-555-0123 x12')).toEqual({ ok: false, reason: 'invalid_characters' });
  });

  test('plus signs mid-string', () => {
    expect(normalizeAgentPhone('416+555+0123')).toEqual({ ok: false, reason: 'invalid_characters' });
  });

  test('letter O in place of a digit', () => {
    expect(normalizeAgentPhone('416-555-O123')).toEqual({ ok: false, reason: 'invalid_characters' });
  });
});

// ── formatAgentPhone ──────────────────────────────────────────────────────

describe('formatAgentPhone', () => {
  test('E.164 becomes hyphenated', () => {
    expect(formatAgentPhone('+14165550188')).toBe('416-555-0188');
  });

  test('already hyphenated is returned unchanged', () => {
    expect(formatAgentPhone('416-555-0188')).toBe('416-555-0188');
  });

  test('10 digits with no plus is returned unchanged', () => {
    expect(formatAgentPhone('4165550188')).toBe('4165550188');
  });

  test('wrong length with a plus is returned unchanged', () => {
    expect(formatAgentPhone('+1416555018')).toBe('+1416555018');
  });

  test('empty string is returned unchanged', () => {
    expect(formatAgentPhone('')).toBe('');
  });

  test('null is returned unchanged', () => {
    expect(formatAgentPhone(null)).toBe(null);
  });

  test('undefined is returned unchanged', () => {
    expect(formatAgentPhone(undefined)).toBe(undefined);
  });
});
