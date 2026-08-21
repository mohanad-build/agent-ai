'use strict';

const { collectMessageAddresses } = require('../src/transactions/messageAddresses');

describe('collectMessageAddresses', () => {
  it('drops the from address when it is the own address', () => {
    const message = { from: 'Agent <me@rlp.ca>', to: [], cc: [] };
    expect(collectMessageAddresses(message, 'me@rlp.ca')).toEqual([]);
  });

  it('keeps a from address that is not the own address, with its name', () => {
    const message = { from: 'Jane <jane@firm.com>', to: [], cc: [] };
    expect(collectMessageAddresses(message, 'me@rlp.ca')).toEqual([
      { address: 'jane@firm.com', name: 'Jane' },
    ]);
  });

  it('concatenates from, to, cc in that order, dropping the own address wherever it appears', () => {
    const message = {
      from: 'Jane <jane@firm.com>',
      to: [{ address: 'me@rlp.ca' }, { address: 'bob@firm.com' }],
      cc: [{ address: 'carl@firm.com', name: 'Carl' }],
    };
    expect(collectMessageAddresses(message, 'me@rlp.ca')).toEqual([
      { address: 'jane@firm.com', name: 'Jane' },
      { address: 'bob@firm.com' },
      { address: 'carl@firm.com', name: 'Carl' },
    ]);
  });

  it('normalises the own address before comparing: mixed case and surrounding whitespace still exclude it', () => {
    const message = {
      from: 'Agent <me@rlp.ca>',
      to: [{ address: 'jane@firm.com' }],
      cc: [],
    };
    expect(collectMessageAddresses(message, '  ME@RLP.CA  ')).toEqual([
      { address: 'jane@firm.com' },
    ]);
  });

  it('keeps the later name when the first occurrence of a duplicate address has none', () => {
    const message = {
      from: '',
      to: [{ address: 'jane@firm.com' }],
      cc: [{ address: 'jane@firm.com', name: 'Jane Smith' }],
    };
    expect(collectMessageAddresses(message, 'me@rlp.ca')).toEqual([
      { address: 'jane@firm.com', name: 'Jane Smith' },
    ]);
  });

  it('treats entirely absent to/cc keys as empty and does not throw', () => {
    const message = { from: 'Jane <jane@firm.com>' };
    expect(() => collectMessageAddresses(message, 'me@rlp.ca')).not.toThrow();
    expect(collectMessageAddresses(message, 'me@rlp.ca')).toEqual([
      { address: 'jane@firm.com', name: 'Jane' },
    ]);
  });

  it('returns [] for an empty from and empty to/cc', () => {
    const message = { from: '', to: [], cc: [] };
    expect(collectMessageAddresses(message, 'me@rlp.ca')).toEqual([]);
  });
});
