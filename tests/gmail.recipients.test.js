'use strict';

const { _internal } = require('../src/gmail');
const { parseGmailMessage } = _internal;

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
