'use strict';

const { _internal } = require('../src/gmail');
const { formatFromHeader } = _internal;

describe('formatFromHeader', () => {
  test('config with displayName produces "Display Name" <address>', () => {
    const config = { gmailAddress: 'mohanad@getklosed.ca', displayName: 'GetKlosed' };
    expect(formatFromHeader(config)).toBe('"GetKlosed" <mohanad@getklosed.ca>');
  });

  test('config with no displayName produces the bare address, unchanged', () => {
    const config = { gmailAddress: 'mohanad@getklosed.ca' };
    expect(formatFromHeader(config)).toBe('mohanad@getklosed.ca');
  });

  test('config with an empty-string displayName produces the bare address', () => {
    const config = { gmailAddress: 'mohanad@getklosed.ca', displayName: '' };
    expect(formatFromHeader(config)).toBe('mohanad@getklosed.ca');
  });

  test('displayName containing a double quote falls back to the bare address', () => {
    const config = { gmailAddress: 'mohanad@getklosed.ca', displayName: 'Get"Klosed' };
    expect(formatFromHeader(config)).toBe('mohanad@getklosed.ca');
  });

  test('displayName containing a newline falls back to the bare address', () => {
    const config = { gmailAddress: 'mohanad@getklosed.ca', displayName: 'Get\nKlosed' };
    expect(formatFromHeader(config)).toBe('mohanad@getklosed.ca');
  });
});
