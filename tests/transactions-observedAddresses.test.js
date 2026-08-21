'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { recordObservedAddresses } = require('../src/transactions/observedAddresses');
const { createTransaction, readTransaction } = require('../src/transactions/store');

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');
const LATER = new Date('2026-07-16T09:30:00.000Z');
const EVEN_LATER = new Date('2026-07-17T08:00:00.000Z');
const AT = '2026-07-16T09:30:00.000Z';
const AT2 = '2026-07-17T08:00:00.000Z';

const THREAD_ID = 'thread-xyz789';
const THREAD_ID_2 = 'thread-later999';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transactions-observedAddresses-test-'));
}

let baseDir;

beforeEach(() => { baseDir = makeTmpDir(); });
afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

function create(type = 'buyer_purchase', state = 'conditional') {
  return createTransaction(
    AGENT_ID,
    { type, state, address: '12 Main St' },
    { baseDir, now: CLOCK }
  );
}

function observe(transactionId, entries, opts = {}) {
  return recordObservedAddresses(AGENT_ID, transactionId, entries, {
    threadId: THREAD_ID,
    at: AT,
    actor: 'system',
    baseDir,
    now: LATER,
    ...opts,
  });
}

describe('recordObservedAddresses', () => {
  it('creates entries keyed by address, each with firstSeenAt and threadId', () => {
    const created = create();
    const result = observe(created.transactionId, [
      { address: 'jane@firm.com', name: 'Jane' },
      { address: 'bob@firm.com' },
    ]);

    expect(result.observedAddresses['jane@firm.com']).toEqual({
      firstSeenAt: AT,
      threadId: THREAD_ID,
      name: 'Jane',
    });
    expect(result.observedAddresses['bob@firm.com']).toEqual({
      firstSeenAt: AT,
      threadId: THREAD_ID,
    });
  });

  it('omits the name key entirely for an entry with no name', () => {
    const created = create();
    const result = observe(created.transactionId, [{ address: 'bob@firm.com' }]);

    expect(result.observedAddresses['bob@firm.com']).not.toHaveProperty('name');
  });

  it('does not change firstSeenAt or threadId when the same address is re-observed on a later thread', () => {
    const created = create();
    observe(created.transactionId, [{ address: 'jane@firm.com', name: 'Jane' }]);
    const result = observe(created.transactionId, [{ address: 'jane@firm.com', name: 'Jane' }], {
      threadId: THREAD_ID_2,
      at: AT2,
      now: EVEN_LATER,
    });

    expect(result.observedAddresses['jane@firm.com']).toEqual({
      firstSeenAt: AT,
      threadId: THREAD_ID,
      name: 'Jane',
    });
  });

  it('fills in the name when re-observing an address that had none', () => {
    const created = create();
    observe(created.transactionId, [{ address: 'jane@firm.com' }]);
    const result = observe(created.transactionId, [{ address: 'jane@firm.com', name: 'Jane Smith' }], {
      threadId: THREAD_ID_2,
      at: AT2,
      now: EVEN_LATER,
    });

    expect(result.observedAddresses['jane@firm.com']).toEqual({
      firstSeenAt: AT,
      threadId: THREAD_ID,
      name: 'Jane Smith',
    });
  });

  it('keeps the first name when re-observing an address that already has a different name', () => {
    const created = create();
    observe(created.transactionId, [{ address: 'jane@firm.com', name: 'Jane Smith' }]);
    const result = observe(created.transactionId, [{ address: 'jane@firm.com', name: 'J. Smith' }], {
      threadId: THREAD_ID_2,
      at: AT2,
      now: EVEN_LATER,
    });

    expect(result.observedAddresses['jane@firm.com'].name).toBe('Jane Smith');
  });

  it('writes nothing and emits no event for an empty entries array', () => {
    const created = create();
    const result = observe(created.transactionId, []);

    expect(result.observedAddresses).toBeUndefined();
    expect(result.events).toBeUndefined();
    expect(result).toEqual(created);
  });

  it('lists only newly-added addresses in the event payload, not ones already present', () => {
    const created = create();
    observe(created.transactionId, [{ address: 'jane@firm.com' }]);
    const result = observe(created.transactionId, [
      { address: 'jane@firm.com' },
      { address: 'bob@firm.com' },
    ], { threadId: THREAD_ID_2, at: AT2, now: EVEN_LATER });

    const event = result.events[result.events.length - 1];
    expect(event.kind).toBe('addresses_observed');
    expect(event.payload).toEqual({
      threadId: THREAD_ID_2,
      addresses: ['bob@firm.com'],
    });
  });

  it('emits exactly one event for a call with three addresses', () => {
    const created = create();
    const result = observe(created.transactionId, [
      { address: 'jane@firm.com' },
      { address: 'bob@firm.com' },
      { address: 'carl@firm.com' },
    ]);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].kind).toBe('addresses_observed');
    expect(result.events[0].payload).toEqual({
      threadId: THREAD_ID,
      addresses: ['jane@firm.com', 'bob@firm.com', 'carl@firm.com'],
    });
  });

  it('round-trips the map through the store', () => {
    const created = create();
    observe(created.transactionId, [
      { address: 'jane@firm.com', name: 'Jane' },
      { address: 'bob@firm.com' },
    ]);

    const reread = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(reread.observedAddresses).toEqual({
      'jane@firm.com': { firstSeenAt: AT, threadId: THREAD_ID, name: 'Jane' },
      'bob@firm.com': { firstSeenAt: AT, threadId: THREAD_ID },
    });
  });

  it('lowercases and trims addresses even when the caller passes them raw', () => {
    const created = create();
    const result = observe(created.transactionId, [
      { address: '  Jane@Firm.COM  ' },
    ]);

    expect(result.observedAddresses).toEqual({
      'jane@firm.com': { firstSeenAt: AT, threadId: THREAD_ID },
    });
  });
});
