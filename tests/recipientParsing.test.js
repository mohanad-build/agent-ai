'use strict';

const { parseRecipientList } = require('../src/recipientParsing');

describe('parseRecipientList', () => {
  it('returns [] for an empty header value', () => {
    expect(parseRecipientList('')).toEqual([]);
  });

  it('parses a bare address with no display name', () => {
    expect(parseRecipientList('jane@firm.com')).toEqual([
      { address: 'jane@firm.com' },
    ]);
  });

  it('parses an unquoted display name with an address', () => {
    expect(parseRecipientList('Jane Smith <jane@firm.com>')).toEqual([
      { address: 'jane@firm.com', name: 'Jane Smith' },
    ]);
  });

  it('parses a quoted display name with an address', () => {
    expect(parseRecipientList('"Jane Smith" <jane@firm.com>')).toEqual([
      { address: 'jane@firm.com', name: 'Jane Smith' },
    ]);
  });

  it('does not split on a comma inside a quoted display name', () => {
    expect(parseRecipientList('"Smith, Jane" <jane@firm.com>, bob@firm.com')).toEqual([
      { address: 'jane@firm.com', name: 'Smith, Jane' },
      { address: 'bob@firm.com' },
    ]);
  });

  it('lowercases the address but not the name', () => {
    expect(parseRecipientList('JANE@FIRM.COM')).toEqual([
      { address: 'jane@firm.com' },
    ]);
  });

  it('parses three recipients, mixing named and bare forms', () => {
    expect(parseRecipientList('Jane Smith <jane@firm.com>, Bob Jones <bob@firm.com>, admin@firm.com')).toEqual([
      { address: 'jane@firm.com', name: 'Jane Smith' },
      { address: 'bob@firm.com', name: 'Bob Jones' },
      { address: 'admin@firm.com' },
    ]);
  });

  it('trims surrounding whitespace around bare addresses', () => {
    expect(parseRecipientList('  jane@firm.com  ,  bob@firm.com  ')).toEqual([
      { address: 'jane@firm.com' },
      { address: 'bob@firm.com' },
    ]);
  });

  it('drops a group-syntax fragment with no recoverable address', () => {
    expect(parseRecipientList('undisclosed-recipients:;')).toEqual([]);
  });

  it('unescapes a backslash-escaped quote inside a display name', () => {
    expect(parseRecipientList('"Jane \\" Smith" <jane@firm.com>')).toEqual([
      { address: 'jane@firm.com', name: 'Jane " Smith' },
    ]);
  });

  it('keeps the address and drops the name when the quoted name is unterminated', () => {
    expect(parseRecipientList('"unclosed <jane@firm.com>')).toEqual([
      { address: 'jane@firm.com' },
    ]);
  });

  it('drops everything when an unterminated quote swallows the rest of the header, rather than fabricating an address from the raw tail', () => {
    expect(parseRecipientList('"unclosed <jane@firm.com>, bob@firm.com')).toEqual([]);
  });

  it('drops a fragment with no address at all', () => {
    expect(parseRecipientList('Jane Smith')).toEqual([]);
  });

  it('drops an empty fragment between two valid addresses', () => {
    expect(parseRecipientList('jane@firm.com, , bob@firm.com')).toEqual([
      { address: 'jane@firm.com' },
      { address: 'bob@firm.com' },
    ]);
  });
});
