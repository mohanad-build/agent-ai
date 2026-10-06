'use strict';

// Covers what tests/transactions-items.test.js (unedited) cannot show,
// since it only ever exercises the wrappers: the pure builders'
// no-mutation and no-disk-write contracts, and the already-complete
// guard working purely off an in-memory envelope, with no disk round
// trip, inside one chain.

const store = require('../src/transactions/store');
const { buildItemComplete, buildItemIncomplete } = require('../src/transactions/items');

const AT = '2026-07-16T09:30:00.000Z';
const AT2 = '2026-07-17T08:00:00.000Z';
const COMPLETED_AT = '2026-07-11T00:00:00.000Z';
const COMPLETED_AT2 = '2026-07-12T00:00:00.000Z';

// At least one existing item entry and one existing event, so the
// "never mutates" tests have something on the fixture that a sloppy
// in-place write could actually disturb.
function makeTransaction(overrides = {}) {
  return {
    transactionId: 'txn-1',
    agentId: 'test-agent',
    type: 'buyer_purchase',
    state: 'conditional',
    address: '12 Main St',
    facts: {},
    items: {
      deal_sheet: { completed: true, completedAt: COMPLETED_AT },
    },
    filings: {},
    events: [
      { at: COMPLETED_AT, actor: 'agent', kind: 'item_completed', payload: { itemId: 'deal_sheet', completedAt: COMPLETED_AT } },
    ],
    ...overrides,
  };
}

describe('buildItemComplete: no mutation, no disk', () => {
  it('never mutates the envelope it is given', () => {
    const fixture = makeTransaction();
    const clone = structuredClone(fixture);

    const result = buildItemComplete(fixture, {
      itemId: 'reco_information_guide', completedAt: AT, at: AT, actor: 'agent',
    });

    expect(fixture).toEqual(clone);
    expect(result.transaction).not.toBe(fixture);
    expect(result.transaction.items).not.toBe(fixture.items);
    expect(result.transaction.events).not.toBe(fixture.events);
  });

  it('never writes to disk', () => {
    const writeSpy = jest.spyOn(store, 'writeTransaction').mockImplementation(() => {
      throw new Error('writeTransaction should not be called by a builder');
    });
    try {
      buildItemComplete(makeTransaction(), {
        itemId: 'reco_information_guide', completedAt: AT, at: AT, actor: 'agent',
      });
      expect(writeSpy).not.toHaveBeenCalled();
    } finally {
      writeSpy.mockRestore();
    }
  });
});

describe('buildItemIncomplete: no mutation, no disk', () => {
  it('never mutates the envelope it is given', () => {
    const fixture = makeTransaction();
    const clone = structuredClone(fixture);

    const result = buildItemIncomplete(fixture, {
      itemId: 'deal_sheet', at: AT2, actor: 'agent',
    });

    expect(fixture).toEqual(clone);
    expect(result.transaction).not.toBe(fixture);
    expect(result.transaction.items).not.toBe(fixture.items);
    expect(result.transaction.events).not.toBe(fixture.events);
  });

  it('never writes to disk', () => {
    const writeSpy = jest.spyOn(store, 'writeTransaction').mockImplementation(() => {
      throw new Error('writeTransaction should not be called by a builder');
    });
    try {
      buildItemIncomplete(makeTransaction(), { itemId: 'deal_sheet', at: AT2, actor: 'agent' });
      expect(writeSpy).not.toHaveBeenCalled();
    } finally {
      writeSpy.mockRestore();
    }
  });
});

describe('chaining builders on one envelope, no disk in between', () => {
  it('two builders chained (complete A, then complete B) produce both entries and both events in order', () => {
    const fixture = makeTransaction({ items: {}, events: [] });

    const afterA = buildItemComplete(fixture, {
      itemId: 'deal_sheet', completedAt: COMPLETED_AT, at: AT, actor: 'agent',
    });
    const afterB = buildItemComplete(afterA.transaction, {
      itemId: 'reco_information_guide', completedAt: COMPLETED_AT2, at: AT2, actor: 'agent',
    });

    expect(afterB.transaction.items).toEqual({
      deal_sheet: { completed: true, completedAt: COMPLETED_AT },
      reco_information_guide: { completed: true, completedAt: COMPLETED_AT2 },
    });
    expect(afterB.transaction.events.map((e) => ({ kind: e.kind, itemId: e.payload.itemId }))).toEqual([
      { kind: 'item_completed', itemId: 'deal_sheet' },
      { kind: 'item_completed', itemId: 'reco_information_guide' },
    ]);
  });

  it('the already-complete refusal fires on an envelope where the item was completed by an earlier builder in the same chain', () => {
    const fixture = makeTransaction({ items: {}, events: [] });

    const afterFirst = buildItemComplete(fixture, {
      itemId: 'deal_sheet', completedAt: COMPLETED_AT, at: AT, actor: 'agent',
    });

    expect(() => buildItemComplete(afterFirst.transaction, {
      itemId: 'deal_sheet', completedAt: COMPLETED_AT2, at: AT2, actor: 'agent',
    })).toThrow(`markItemComplete: item 'deal_sheet' is already complete (completedAt ${COMPLETED_AT})`);
  });
});
