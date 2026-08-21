'use strict';

const { _internal } = require('../src/gmail');
const { parseGmailMessage, parseRecipientList } = _internal;

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

describe('parseGmailMessage recipients', () => {
  function makeMessage(headerOverrides = {}) {
    const headers = [
      { name: 'From', value: 'Sender Name <sender@example.com>' },
      { name: 'Subject', value: 'Hello' },
      ...Object.entries(headerOverrides).map(([name, value]) => ({ name, value })),
    ];
    return {
      id: 'msg-1',
      threadId: 'thread-1',
      snippet: 'a snippet',
      internalDate: '1700000000000',
      payload: { headers, parts: [] },
    };
  }

  it('returns parsed to and cc arrays when both headers are present', () => {
    const message = makeMessage({
      To: 'Jane Smith <jane@firm.com>, bob@firm.com',
      Cc: '"Smith, Carl" <carl@firm.com>',
    });

    const result = parseGmailMessage(message);

    expect(result.to).toEqual([
      { address: 'jane@firm.com', name: 'Jane Smith' },
      { address: 'bob@firm.com' },
    ]);
    expect(result.cc).toEqual([
      { address: 'carl@firm.com', name: 'Smith, Carl' },
    ]);
  });

  it('returns to: [] and cc: [] when neither header is present', () => {
    const message = makeMessage();

    const result = parseGmailMessage(message);

    expect(result.to).toEqual([]);
    expect(result.cc).toEqual([]);
    expect(result).toHaveProperty('to');
    expect(result).toHaveProperty('cc');
  });

  it('leaves every pre-existing key unchanged in value', () => {
    const message = makeMessage({ To: 'jane@firm.com' });

    const result = parseGmailMessage(message);

    expect(result.messageId).toBe('msg-1');
    expect(result.threadId).toBe('thread-1');
    expect(result.from).toBe('Sender Name <sender@example.com>');
    expect(result.subject).toBe('Hello');
    expect(result.snippet).toBe('a snippet');
    expect(result.receivedAt).toBe(new Date(1700000000000).toISOString());
    expect(result.hasAttachments).toBe(false);
    expect(result.attachmentInfo).toEqual([]);
  });
});
