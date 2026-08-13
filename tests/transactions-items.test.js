'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { markItemComplete, markItemIncomplete } = require('../src/transactions/items');
const { createTransaction, readTransaction } = require('../src/transactions/store');

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');
const LATER = new Date('2026-07-16T09:30:00.000Z');
const EVEN_LATER = new Date('2026-07-17T08:00:00.000Z');
const AT = '2026-07-16T09:30:00.000Z';
const AT2 = '2026-07-17T08:00:00.000Z';
const COMPLETED_AT = '2026-07-11T00:00:00.000Z';
const COMPLETED_AT2 = '2026-07-12T00:00:00.000Z';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transactions-items-test-'));
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

describe('markItemComplete', () => {
  it('a first completion writes an item_completed event and an items entry with only the four fields', () => {
    const created = create();
    const result = markItemComplete(AGENT_ID, created.transactionId, 'reco_information_guide', {
      at: AT, actor: 'agent', completedAt: COMPLETED_AT, baseDir, now: LATER,
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ at: AT, actor: 'agent', kind: 'item_completed' });
    expect(result.events[0].payload).toEqual({ itemId: 'reco_information_guide', completedAt: COMPLETED_AT });
    expect(result.items).toEqual({
      reco_information_guide: { completed: true, completedAt: COMPLETED_AT },
    });
    expect(Object.keys(result.items.reco_information_guide).sort()).toEqual(['completed', 'completedAt']);
  });

  it('documents and note are absent from both the entry and the payload when not passed', () => {
    const created = create();
    const result = markItemComplete(AGENT_ID, created.transactionId, 'reco_information_guide', {
      at: AT, actor: 'agent', completedAt: COMPLETED_AT, baseDir, now: LATER,
    });

    expect(result.items.reco_information_guide).not.toHaveProperty('documents');
    expect(result.items.reco_information_guide).not.toHaveProperty('note');
    expect(result.events[0].payload).not.toHaveProperty('documents');
    expect(result.events[0].payload).not.toHaveProperty('note');
  });

  it('documents and note land in both the entry and the payload when passed', () => {
    const created = create();
    const result = markItemComplete(AGENT_ID, created.transactionId, 'reco_information_guide', {
      at: AT, actor: 'agent', completedAt: COMPLETED_AT, documents: ['guide.pdf'], note: 'confirmed verbally', baseDir, now: LATER,
    });

    expect(result.items.reco_information_guide).toEqual({
      completed: true, completedAt: COMPLETED_AT, documents: ['guide.pdf'], note: 'confirmed verbally',
    });
    expect(result.events[0].payload).toEqual({
      itemId: 'reco_information_guide', completedAt: COMPLETED_AT, documents: ['guide.pdf'], note: 'confirmed verbally',
    });
  });

  it('an explicit empty-string note IS stored', () => {
    const created = create();
    const result = markItemComplete(AGENT_ID, created.transactionId, 'reco_information_guide', {
      at: AT, actor: 'agent', completedAt: COMPLETED_AT, note: '', baseDir, now: LATER,
    });

    expect(result.items.reco_information_guide.note).toBe('');
    expect(result.events[0].payload.note).toBe('');
  });

  // NOTE what this test does and does not prove: it passes a truthy
  // completedAt distinct from at, so it catches completedAt being hardcoded
  // to (or swapped with) at's value. It passes under a
  // `completedAt: opts.completedAt || opts.at` default too, since the ||
  // only ever kicks in when completedAt is falsy — a truthy COMPLETED_AT
  // short-circuits it. Do not read this test as coverage for the
  // required-not-defaulted rule; that is the pair of tests below.
  it('completedAt lands on disk as the exact value passed, not swapped for at', () => {
    const created = create();
    const result = markItemComplete(AGENT_ID, created.transactionId, 'reco_information_guide', {
      at: AT, actor: 'agent', completedAt: COMPLETED_AT, baseDir, now: LATER,
    });

    expect(COMPLETED_AT).not.toBe(AT);
    expect(result.items.reco_information_guide.completedAt).toBe(COMPLETED_AT);
    expect(result.events[0].at).toBe(AT);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.items.reco_information_guide.completedAt).toBe(COMPLETED_AT);
  });

  // completedAt is falsy in both of these (undefined, ''), which is exactly
  // the condition under which `completedAt: opts.completedAt || opts.at`
  // would silently substitute at and skip the throw. These are the tests
  // that actually distinguish "required" from "defaulted to at" — a
  // required-non-empty-string check must throw here regardless of what at
  // is set to.
  it('throws when completedAt is missing, rather than silently defaulting to at, and writes nothing to disk', () => {
    const created = create();
    expect(() => markItemComplete(AGENT_ID, created.transactionId, 'reco_information_guide', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^markItemComplete: completedAt must be a non-empty string/);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk).toEqual(created);
  });

  it('throws when completedAt is an empty string, rather than silently defaulting to at', () => {
    const created = create();
    expect(() => markItemComplete(AGENT_ID, created.transactionId, 'reco_information_guide', {
      at: AT, actor: 'agent', completedAt: '', baseDir, now: LATER,
    })).toThrow(/^markItemComplete: completedAt must be a non-empty string/);
  });

  it('throws on an unknown item id for the type, naming the type, and writes nothing to disk', () => {
    const created = create('buyer_purchase');
    expect(() => markItemComplete(AGENT_ID, created.transactionId, 'not_a_real_item', {
      at: AT, actor: 'agent', completedAt: COMPLETED_AT, baseDir, now: LATER,
    })).toThrow(/^markItemComplete: unknown item id 'not_a_real_item' for type 'buyer_purchase'/);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk).toEqual(created);
  });

  it('the same item id is valid on one type and invalid on another (type-scoped, not global)', () => {
    const listing = create('seller_listing', 'preparing');
    const purchase = create('buyer_purchase');

    const result = markItemComplete(AGENT_ID, listing.transactionId, 'listing_agreement', {
      at: AT, actor: 'agent', completedAt: COMPLETED_AT, baseDir, now: LATER,
    });
    expect(result.items.listing_agreement.completed).toBe(true);

    expect(() => markItemComplete(AGENT_ID, purchase.transactionId, 'listing_agreement', {
      at: AT, actor: 'agent', completedAt: COMPLETED_AT, baseDir, now: LATER,
    })).toThrow(/^markItemComplete: unknown item id 'listing_agreement' for type 'buyer_purchase'/);
  });

  it('re-completing an already-complete item writes a second event and replaces the entry details', () => {
    const created = create();
    markItemComplete(AGENT_ID, created.transactionId, 'reco_information_guide', {
      at: AT, actor: 'agent', completedAt: COMPLETED_AT, documents: ['guide.pdf'], baseDir, now: LATER,
    });
    const result = markItemComplete(AGENT_ID, created.transactionId, 'reco_information_guide', {
      at: AT2, actor: 'agent', completedAt: COMPLETED_AT2, note: 'corrected date', baseDir, now: EVEN_LATER,
    });

    expect(result.events).toHaveLength(2);
    expect(result.events.map((e) => e.kind)).toEqual(['item_completed', 'item_completed']);
    expect(result.items.reco_information_guide).toEqual({
      completed: true, completedAt: COMPLETED_AT2, note: 'corrected date',
    });
  });

  it('throws when the transaction does not exist', () => {
    expect(() => markItemComplete(AGENT_ID, 'txn-20260715-00000000', 'reco_information_guide', {
      at: AT, actor: 'agent', completedAt: COMPLETED_AT, baseDir, now: LATER,
    })).toThrow(/^markItemComplete: no transaction txn-20260715-00000000 for agent test-agent/);
  });
});

describe('markItemIncomplete', () => {
  it('writes an item_uncompleted event with a payload of only itemId', () => {
    const created = create();
    markItemComplete(AGENT_ID, created.transactionId, 'reco_information_guide', {
      at: AT, actor: 'agent', completedAt: COMPLETED_AT, baseDir, now: LATER,
    });
    const result = markItemIncomplete(AGENT_ID, created.transactionId, 'reco_information_guide', {
      at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
    });

    expect(result.events).toHaveLength(2);
    expect(result.events[1]).toMatchObject({ at: AT2, actor: 'agent', kind: 'item_uncompleted' });
    expect(result.events[1].payload).toEqual({ itemId: 'reco_information_guide' });
  });

  it('sets completed to false but leaves completedAt, documents and note in place', () => {
    const created = create();
    markItemComplete(AGENT_ID, created.transactionId, 'reco_information_guide', {
      at: AT, actor: 'agent', completedAt: COMPLETED_AT, documents: ['guide.pdf'], note: 'confirmed', baseDir, now: LATER,
    });
    const result = markItemIncomplete(AGENT_ID, created.transactionId, 'reco_information_guide', {
      at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
    });

    expect(result.items.reco_information_guide).toEqual({
      completed: false, completedAt: COMPLETED_AT, documents: ['guide.pdf'], note: 'confirmed',
    });
  });

  it('throws when uncompleting an item that was never completed, and writes nothing to disk', () => {
    const created = create();
    expect(() => markItemIncomplete(AGENT_ID, created.transactionId, 'reco_information_guide', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^markItemIncomplete: item 'reco_information_guide' is not complete/);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk).toEqual(created);
  });

  it('throws when uncompleting an item that is already incomplete, and writes nothing to disk', () => {
    const created = create();
    markItemComplete(AGENT_ID, created.transactionId, 'reco_information_guide', {
      at: AT, actor: 'agent', completedAt: COMPLETED_AT, baseDir, now: LATER,
    });
    markItemIncomplete(AGENT_ID, created.transactionId, 'reco_information_guide', {
      at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
    });
    const beforeSecondAttempt = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    expect(() => markItemIncomplete(AGENT_ID, created.transactionId, 'reco_information_guide', {
      at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
    })).toThrow(/^markItemIncomplete: item 'reco_information_guide' is not complete/);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk).toEqual(beforeSecondAttempt);
  });

  it('throws on an unknown item id for the type, naming the type', () => {
    const created = create('buyer_purchase');
    expect(() => markItemIncomplete(AGENT_ID, created.transactionId, 'not_a_real_item', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^markItemIncomplete: unknown item id 'not_a_real_item' for type 'buyer_purchase'/);
  });

  it('throws when the transaction does not exist', () => {
    expect(() => markItemIncomplete(AGENT_ID, 'txn-20260715-00000000', 'reco_information_guide', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^markItemIncomplete: no transaction txn-20260715-00000000 for agent test-agent/);
  });
});

describe('items key absence', () => {
  it('a transaction with no item writes has no items key at all', () => {
    const created = create();
    expect(created.items).toBeUndefined();

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.items).toBeUndefined();
  });
});
