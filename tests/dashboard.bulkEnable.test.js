'use strict';

const {
  isEnableEligible,
  parseSelectedEmails,
  renderEnableResult,
} = require('../src/routes/dashboard');

describe('isEnableEligible', () => {
  it('is true for an eligible import row with aiEnabled FALSE', () => {
    expect(isEnableEligible({ source: 'import', aiEnabled: 'FALSE' })).toBe(true);
  });

  it('is false when source is not import', () => {
    expect(isEnableEligible({ source: 'manual', aiEnabled: 'FALSE' })).toBe(false);
  });

  it('is false when aiEnabled is TRUE', () => {
    expect(isEnableEligible({ source: 'import', aiEnabled: 'TRUE' })).toBe(false);
  });

  it('is false when aiEnabled is empty', () => {
    expect(isEnableEligible({ source: 'import', aiEnabled: '' })).toBe(false);
  });

  it('tolerates case and whitespace variants on both fields', () => {
    expect(isEnableEligible({ source: '  Import  ', aiEnabled: '  false  ' })).toBe(true);
    expect(isEnableEligible({ source: 'IMPORT', aiEnabled: 'False' })).toBe(true);
  });

  it('is false when fields are missing entirely', () => {
    expect(isEnableEligible({})).toBe(false);
  });
});

describe('parseSelectedEmails', () => {
  it('normalizes a single string to a one-element array', () => {
    expect(parseSelectedEmails({ emails: 'a@example.com' })).toEqual(['a@example.com']);
  });

  it('passes through an array', () => {
    expect(parseSelectedEmails({ emails: ['a@example.com', 'b@example.com'] }))
      .toEqual(['a@example.com', 'b@example.com']);
  });

  it('returns [] when emails is missing', () => {
    expect(parseSelectedEmails({})).toEqual([]);
  });

  it('drops a blank string', () => {
    expect(parseSelectedEmails({ emails: '' })).toEqual([]);
    expect(parseSelectedEmails({ emails: ['a@example.com', '  '] })).toEqual(['a@example.com']);
  });

  it('trims whitespace padding', () => {
    expect(parseSelectedEmails({ emails: '  a@example.com  ' })).toEqual(['a@example.com']);
  });

  it('dedupes repeated emails', () => {
    expect(parseSelectedEmails({ emails: ['a@example.com', 'a@example.com', ' a@example.com '] }))
      .toEqual(['a@example.com']);
  });

  it('returns [] for a non-string, non-array value', () => {
    expect(parseSelectedEmails({ emails: 42 })).toEqual([]);
    expect(parseSelectedEmails({ emails: { a: 1 } })).toEqual([]);
  });
});

describe('renderEnableResult', () => {
  it('surfaces blocked rows with their reasons', () => {
    const result = {
      enabled: 1,
      rows: [
        { email: 'blocked@example.com', action: 'blocked', reason: 'leadCategory is SOI; never auto-enabled' },
        { email: 'ok@example.com', action: 'enabled', reason: '' },
      ],
    };
    const html = renderEnableResult('agent-1', result);
    expect(html).toContain('blocked@example.com');
    expect(html).toContain('leadCategory is SOI; never auto-enabled');
  });

  it('surfaces not-found rows with their reasons', () => {
    const result = {
      enabled: 0,
      rows: [
        { email: 'missing@example.com', action: 'not-found', reason: 'not in the Sheet at all' },
      ],
    };
    const html = renderEnableResult('agent-1', result);
    expect(html).toContain('missing@example.com');
    expect(html).toContain('not in the Sheet at all');
  });

  it('states the all-clean case explicitly when nothing is blocked or not-found', () => {
    const result = {
      enabled: 3,
      rows: [
        { email: 'a@example.com', action: 'enabled', reason: '' },
        { email: 'b@example.com', action: 'enabled', reason: '' },
        { email: 'c@example.com', action: 'enabled', reason: '' },
      ],
    };
    const html = renderEnableResult('agent-1', result);
    expect(html).toContain('None blocked.');
    expect(html).toContain('None.');
  });

  it('escapes < and & in interpolated values', () => {
    const result = {
      enabled: 0,
      rows: [
        { email: '<script>&x', action: 'blocked', reason: 'reason with < and &' },
      ],
    };
    const html = renderEnableResult('agent-1', result);
    expect(html).not.toContain('<script>&x');
    expect(html).toContain('&lt;script&gt;&amp;x');
    expect(html).toContain('reason with &lt; and &amp;');
  });

  it('surfaces the headline enabled count', () => {
    const result = { enabled: 7, rows: [] };
    const html = renderEnableResult('agent-1', result);
    expect(html).toContain('7');
  });
});
