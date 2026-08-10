'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { transitionTransaction } = require('../src/transactions/transitions');
const { createTransaction, readTransaction } = require('../src/transactions/store');

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');
const LATER = new Date('2026-07-16T09:30:00.000Z');
const AT = '2026-07-16T09:30:00.000Z';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transactions-transitions-test-'));
}

let baseDir;

beforeEach(() => { baseDir = makeTmpDir(); });
afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

function createInState(state, type = 'buyer_purchase') {
  return createTransaction(AGENT_ID, { type, state }, { baseDir, now: CLOCK });
}

describe('transitionTransaction', () => {
  test('a refused edge writes NOTHING to disk', () => {
    const created = createInState('conditional');

    const result = transitionTransaction(AGENT_ID, created.transactionId, 'closed', {
      at: AT,
      actor: 'system',
      baseDir,
      now: LATER,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Cannot move from conditional to closed');
    expect(result.transaction).toBeUndefined();

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.state).toBe('conditional');
    expect(onDisk).toEqual(created);
  });

  test('a close with outstanding items writes exactly one event', () => {
    const created = createInState('firm');
    const items = [
      { id: 'inspection', label: 'Inspection', applicability: 'required', completed: false },
      { id: 'financing', label: 'Financing', applicability: 'required', completed: true },
    ];

    const result = transitionTransaction(AGENT_ID, created.transactionId, 'closed', {
      at: AT,
      actor: 'agent',
      items,
      baseDir,
      now: CLOCK,
    });

    expect(result.valid).toBe(true);
    expect(result.transaction.state).toBe('closed');
    expect(result.transaction.events).toHaveLength(1);
    expect(result.transaction.events[0]).toMatchObject({
      at: AT,
      actor: 'agent',
      kind: 'closed_with_items_outstanding',
    });
    expect(result.transaction.events[0].payload.outstandingCount).toBe(1);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.events).toHaveLength(1);
  });

  test('a close with zero outstanding writes no events key change', () => {
    const created = createInState('firm');
    const items = [
      { id: 'inspection', label: 'Inspection', applicability: 'required', completed: true },
    ];

    const result = transitionTransaction(AGENT_ID, created.transactionId, 'closed', {
      at: AT,
      actor: 'system',
      items,
      baseDir,
      now: CLOCK,
    });

    expect(result.valid).toBe(true);
    expect(result.transaction.state).toBe('closed');
    expect(result.transaction.events).toBeUndefined();

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.events).toBeUndefined();
  });

  test('a close with no items supplied writes no event', () => {
    const created = createInState('firm');

    const result = transitionTransaction(AGENT_ID, created.transactionId, 'closed', {
      at: AT,
      actor: 'system',
      baseDir,
      now: CLOCK,
    });

    expect(result.valid).toBe(true);
    expect(result.transaction.state).toBe('closed');
    expect(result.transaction.events).toBeUndefined();

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.events).toBeUndefined();
  });

  test('a non-close transition never writes an event', () => {
    const created = createInState('conditional');
    const items = [
      { id: 'inspection', label: 'Inspection', applicability: 'required', completed: false },
    ];

    const result = transitionTransaction(AGENT_ID, created.transactionId, 'firm', {
      at: AT,
      actor: 'system',
      items,
      baseDir,
      now: CLOCK,
    });

    expect(result.valid).toBe(true);
    expect(result.transaction.state).toBe('firm');
    expect(result.transaction.events).toBeUndefined();

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.events).toBeUndefined();
  });

  test('a missing transaction throws', () => {
    expect(() => transitionTransaction(AGENT_ID, 'txn-20260715-00000000', 'firm', {
      at: AT,
      actor: 'system',
      baseDir,
      now: CLOCK,
    })).toThrow(/no transaction txn-20260715-00000000 for agent test-agent/);
  });
});
