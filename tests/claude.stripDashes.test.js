'use strict';

const { stripDashes } = require('../src/claude');

describe('stripDashes whitespace handling', () => {
  test('consumes spaces around em-dash', () => {
    expect(stripDashes('foo — bar')).toBe('foo, bar');
  });

  test('consumes spaces around en-dash', () => {
    expect(stripDashes('foo – bar')).toBe('foo, bar');
  });

  test('handles em-dash with no surrounding spaces', () => {
    expect(stripDashes('foo—bar')).toBe('foo, bar');
  });

  test('handles multiple em-dashes in same string', () => {
    expect(stripDashes('a — b — c')).toBe('a, b, c');
  });

  test('does not affect text without dashes', () => {
    expect(stripDashes('plain text')).toBe('plain text');
  });
});
