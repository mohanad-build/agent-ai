'use strict';

const { validateCategory } = require('../src/claude');

describe('validateCategory allowlist', () => {
  test('returns answer_general unchanged', () => {
    expect(validateCategory('answer_general')).toBe('answer_general');
  });

  test('returns answer_property_specific unchanged', () => {
    expect(validateCategory('answer_property_specific')).toBe('answer_property_specific');
  });

  test('returns hot_signal unchanged', () => {
    expect(validateCategory('hot_signal')).toBe('hot_signal');
  });

  test('returns stop_signal unchanged', () => {
    expect(validateCategory('stop_signal')).toBe('stop_signal');
  });

  test('returns needs_review unchanged', () => {
    expect(validateCategory('needs_review')).toBe('needs_review');
  });

  test('returns conversation_continue unchanged', () => {
    expect(validateCategory('conversation_continue')).toBe('conversation_continue');
  });

  test('throws on an unknown category', () => {
    expect(() => validateCategory('garbage_value')).toThrow('Invalid category in response');
  });
});
