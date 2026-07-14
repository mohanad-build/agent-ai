'use strict';

const { findRowByEmail } = require('../src/gmail');

describe('findRowByEmail', () => {
  test('exact match returns the row', () => {
    const rows = [
      { rowIndex: 2, leadId: 'a@x.com' },
      { rowIndex: 3, leadId: 'b@x.com' },
    ];
    expect(findRowByEmail(rows, 'b@x.com')).toBe(rows[1]);
  });

  test('case-insensitive: uppercase query matches lowercase leadId', () => {
    const rows = [{ rowIndex: 2, leadId: 'a@x.com' }];
    expect(findRowByEmail(rows, 'A@X.COM')).toBe(rows[0]);
  });

  test('case-insensitive: lowercase query matches uppercase leadId', () => {
    const rows = [{ rowIndex: 2, leadId: 'A@X.COM' }];
    expect(findRowByEmail(rows, 'a@x.com')).toBe(rows[0]);
  });

  test('whitespace-padded leadId still matches', () => {
    const rows = [{ rowIndex: 2, leadId: '  a@x.com  ' }];
    expect(findRowByEmail(rows, 'a@x.com')).toBe(rows[0]);
  });

  test('rows with empty leadId never match', () => {
    const rows = [{ rowIndex: 2, leadId: '' }];
    expect(findRowByEmail(rows, '')).toBeUndefined();
  });

  test('rows with missing leadId never match', () => {
    const rows = [{ rowIndex: 2 }];
    expect(findRowByEmail(rows, 'a@x.com')).toBeUndefined();
  });

  test('empty query returns undefined', () => {
    const rows = [{ rowIndex: 2, leadId: 'a@x.com' }];
    expect(findRowByEmail(rows, '')).toBeUndefined();
  });

  test('whitespace-only query returns undefined', () => {
    const rows = [{ rowIndex: 2, leadId: 'a@x.com' }];
    expect(findRowByEmail(rows, '   ')).toBeUndefined();
  });

  test('no-match returns undefined', () => {
    const rows = [{ rowIndex: 2, leadId: 'a@x.com' }];
    expect(findRowByEmail(rows, 'z@x.com')).toBeUndefined();
  });
});
