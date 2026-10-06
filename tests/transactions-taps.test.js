'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { completeOne, completeChain, uncompleteRows } = require('../src/transactions/taps');
const store = require('../src/transactions/store');
const { createTransaction, readTransaction } = store;
const { markItemComplete } = require('../src/transactions/items');
const { setFact } = require('../src/transactions/facts');
const { transitionTransaction } = require('../src/transactions/transitions');

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');
const LATER = new Date('2026-07-16T09:30:00.000Z');
const EVEN_LATER = new Date('2026-07-17T08:00:00.000Z');
const AT = '2026-07-16T09:30:00.000Z';
const COMPLETED_AT = '2026-07-11T00:00:00.000Z';
const COMPLETED_AT2 = '2026-07-12T00:00:00.000Z';
const COMPLETED_AT3 = '2026-07-13T00:00:00.000Z';
const TAP_NOTE = "Confirmed by the agent's tap on assistant@";

// scope 'transaction', reads [] -- required unconditionally on a fresh
// buyer_purchase (src/transactions/rules/buyerPurchase.js), the main item
// used wherever a test just needs some transaction-scoped row a tap can
// reach.
const MAIN_ITEM = 'deal_sheet';

const PAYING_CHAIN = [
  'deposit_obtained_from_client',
  'deposit_delivered_to_listing_agent',
  'brokerage_deposit_receipt_received',
];

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transactions-taps-test-'));
}

let baseDir;

beforeEach(() => { baseDir = makeTmpDir(); });
afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });
afterEach(() => jest.restoreAllMocks());

function create(type = 'buyer_purchase', state = 'conditional') {
  return createTransaction(AGENT_ID, { type, state, address: '12 Main St' }, { baseDir, now: CLOCK });
}

function collapse(transactionId) {
  const result = transitionTransaction(AGENT_ID, transactionId, 'collapsed', { at: AT, actor: 'agent', baseDir, now: LATER });
  if (!result.valid) throw new Error(`test setup: could not collapse ${transactionId}: ${result.reason}`);
}

function completeItem(transactionId, itemId, completedAt) {
  return markItemComplete(AGENT_ID, transactionId, itemId, { at: AT, actor: 'agent', completedAt, baseDir, now: LATER });
}

// seller_sale with no additional deposit in the agreement: the one-step
// additional-deposit chain is genuinely in the catalog but resolves
// not_applicable, the stale-tap scenario decision 2c's not_required test
// is built on (docs/designs/done-verb.md).
function createNoAdditionalDeposit() {
  const created = create('seller_sale');
  setFact(AGENT_ID, created.transactionId, 'additionalDepositDueDates', [], { at: AT, actor: 'agent', baseDir, now: LATER });
  return created;
}

describe('completeOne', () => {
  it('transaction_not_found', () => {
    const result = completeOne(AGENT_ID, 'txn-20260101-deadbeef', MAIN_ITEM, { at: AT, completedAt: COMPLETED_AT, baseDir, now: LATER });
    expect(result).toEqual({ outcome: 'transaction_not_found' });
  });

  it('deal_closed, with state', () => {
    const created = create();
    collapse(created.transactionId);

    const result = completeOne(AGENT_ID, created.transactionId, MAIN_ITEM, { at: AT, completedAt: COMPLETED_AT, baseDir, now: EVEN_LATER });

    expect(result).toEqual({ outcome: 'deal_closed', state: 'collapsed' });
  });

  it('unknown_item: not on this type\'s catalog at all', () => {
    const created = create();
    const result = completeOne(AGENT_ID, created.transactionId, 'not_a_real_item', { at: AT, completedAt: COMPLETED_AT, baseDir, now: LATER });
    expect(result).toEqual({ outcome: 'unknown_item' });
  });

  it('unknown_item: a client-scoped item (reco_information_guide) is not an item a tap can reach', () => {
    const created = create();
    const result = completeOne(AGENT_ID, created.transactionId, 'reco_information_guide', { at: AT, completedAt: COMPLETED_AT, baseDir, now: LATER });
    expect(result).toEqual({ outcome: 'unknown_item' });
  });

  it('not_required: a stale tap on an additional deposit that is not in the agreement', () => {
    const created = createNoAdditionalDeposit();
    const result = completeOne(AGENT_ID, created.transactionId, 'additional_deposit_receipt_issued', { at: AT, completedAt: COMPLETED_AT, baseDir, now: EVEN_LATER });
    expect(result).toEqual({ outcome: 'not_required' });
  });

  it('already_complete, with completedAt', () => {
    const created = create();
    completeItem(created.transactionId, MAIN_ITEM, COMPLETED_AT);

    const result = completeOne(AGENT_ID, created.transactionId, MAIN_ITEM, { at: AT, completedAt: COMPLETED_AT2, baseDir, now: EVEN_LATER });

    expect(result).toEqual({ outcome: 'already_complete', completedAt: COMPLETED_AT });
  });

  it('completed: writes the item with the fixed actor and note, event carries at', () => {
    const created = create();

    const result = completeOne(AGENT_ID, created.transactionId, MAIN_ITEM, { at: AT, completedAt: COMPLETED_AT, baseDir, now: LATER });

    expect(result).toEqual({ outcome: 'completed', itemIds: [MAIN_ITEM] });

    const stored = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(stored.items[MAIN_ITEM]).toEqual({ completed: true, completedAt: COMPLETED_AT, note: TAP_NOTE });
    expect(stored.events).toHaveLength(1);
    expect(stored.events[0]).toMatchObject({ at: AT, actor: 'agent', kind: 'item_completed' });
  });
});

describe('completeChain', () => {
  it('transaction_not_found', () => {
    const result = completeChain(AGENT_ID, 'txn-20260101-deadbeef', 'brokerage_deposit_receipt_received', { at: AT, completedAt: COMPLETED_AT, baseDir, now: LATER });
    expect(result).toEqual({ outcome: 'transaction_not_found' });
  });

  it('deal_closed, with state', () => {
    const created = create();
    collapse(created.transactionId);

    const result = completeChain(AGENT_ID, created.transactionId, 'brokerage_deposit_receipt_received', { at: AT, completedAt: COMPLETED_AT, baseDir, now: EVEN_LATER });

    expect(result).toEqual({ outcome: 'deal_closed', state: 'collapsed' });
  });

  it('unknown_item: an id that ends no known chain', () => {
    const created = create();
    const result = completeChain(AGENT_ID, created.transactionId, 'not_a_real_item', { at: AT, completedAt: COMPLETED_AT, baseDir, now: LATER });
    expect(result).toEqual({ outcome: 'unknown_item' });
  });

  it('unknown_item: a holding-side receipt tapped on a buyer_purchase deal', () => {
    const created = create('buyer_purchase');
    const result = completeChain(AGENT_ID, created.transactionId, 'brokerage_deposit_receipt_issued', { at: AT, completedAt: COMPLETED_AT, baseDir, now: LATER });
    expect(result).toEqual({ outcome: 'unknown_item' });
  });

  it('not_required: a stale tap on an additional deposit that is not in the agreement', () => {
    const created = createNoAdditionalDeposit();
    const result = completeChain(AGENT_ID, created.transactionId, 'additional_deposit_receipt_issued', { at: AT, completedAt: COMPLETED_AT, baseDir, now: EVEN_LATER });
    expect(result).toEqual({ outcome: 'not_required' });
  });

  it('already_complete: every step already done, completedAt is the receipt\'s own', () => {
    const created = create('buyer_purchase');
    completeItem(created.transactionId, PAYING_CHAIN[0], COMPLETED_AT);
    completeItem(created.transactionId, PAYING_CHAIN[1], COMPLETED_AT2);
    completeItem(created.transactionId, PAYING_CHAIN[2], COMPLETED_AT3);

    const result = completeChain(AGENT_ID, created.transactionId, PAYING_CHAIN[2], { at: AT, completedAt: '2026-07-14T00:00:00.000Z', baseDir, now: EVEN_LATER });

    expect(result).toEqual({ outcome: 'already_complete', completedAt: COMPLETED_AT3 });
  });

  it('completed, fresh chain: all three steps, in chain order, one event each', () => {
    const created = create('buyer_purchase');

    const result = completeChain(AGENT_ID, created.transactionId, PAYING_CHAIN[2], { at: AT, completedAt: COMPLETED_AT, baseDir, now: LATER });

    expect(result).toEqual({ outcome: 'completed', itemIds: PAYING_CHAIN });

    const stored = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    PAYING_CHAIN.forEach((itemId) => {
      expect(stored.items[itemId]).toEqual({ completed: true, completedAt: COMPLETED_AT, note: TAP_NOTE });
    });
    expect(stored.events.map((e) => ({ kind: e.kind, itemId: e.payload.itemId }))).toEqual(
      PAYING_CHAIN.map((itemId) => ({ kind: 'item_completed', itemId }))
    );
  });

  it('completed, partial chain: itemIds is only the fresh steps, the pre-completed step is untouched', () => {
    const created = create('buyer_purchase');
    completeItem(created.transactionId, PAYING_CHAIN[0], COMPLETED_AT);

    const result = completeChain(AGENT_ID, created.transactionId, PAYING_CHAIN[2], { at: AT, completedAt: COMPLETED_AT2, baseDir, now: EVEN_LATER });

    expect(result).toEqual({ outcome: 'completed', itemIds: [PAYING_CHAIN[1], PAYING_CHAIN[2]] });

    const stored = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(stored.items[PAYING_CHAIN[0]]).toEqual({ completed: true, completedAt: COMPLETED_AT });
    expect(stored.items[PAYING_CHAIN[1]]).toEqual({ completed: true, completedAt: COMPLETED_AT2, note: TAP_NOTE });
    expect(stored.items[PAYING_CHAIN[2]]).toEqual({ completed: true, completedAt: COMPLETED_AT2, note: TAP_NOTE });
  });
});

describe('uncompleteRows', () => {
  it('transaction_not_found', () => {
    const result = uncompleteRows(AGENT_ID, 'txn-20260101-deadbeef', [MAIN_ITEM], { at: AT, baseDir, now: LATER });
    expect(result).toEqual({ outcome: 'transaction_not_found' });
  });

  it('deal_closed, with state', () => {
    const created = create();
    completeItem(created.transactionId, MAIN_ITEM, COMPLETED_AT);
    collapse(created.transactionId);

    const result = uncompleteRows(AGENT_ID, created.transactionId, [MAIN_ITEM], { at: AT, baseDir, now: EVEN_LATER });

    expect(result).toEqual({ outcome: 'deal_closed', state: 'collapsed' });
  });

  it('unknown_item: not on this type\'s catalog at all', () => {
    const created = create();
    const result = uncompleteRows(AGENT_ID, created.transactionId, ['not_a_real_item'], { at: AT, baseDir, now: LATER });
    expect(result).toEqual({ outcome: 'unknown_item' });
  });

  it('duplicates are removed: one undo, one event', () => {
    const created = create();
    completeItem(created.transactionId, MAIN_ITEM, COMPLETED_AT);

    const result = uncompleteRows(AGENT_ID, created.transactionId, [MAIN_ITEM, MAIN_ITEM], { at: AT, baseDir, now: EVEN_LATER });

    expect(result).toEqual({ outcome: 'uncompleted', itemIds: [MAIN_ITEM], skipped: [] });
    const stored = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(stored.events.filter((e) => e.kind === 'item_uncompleted')).toHaveLength(1);
  });

  it('nothing_to_undo: the row is not complete', () => {
    const created = create();
    const result = uncompleteRows(AGENT_ID, created.transactionId, [MAIN_ITEM], { at: AT, baseDir, now: LATER });
    expect(result).toEqual({ outcome: 'nothing_to_undo', skipped: [MAIN_ITEM] });
  });

  it('a mixed list: the complete row is reversed, the incomplete row is skipped, one save', () => {
    const created = create();
    completeItem(created.transactionId, MAIN_ITEM, COMPLETED_AT);

    const result = uncompleteRows(AGENT_ID, created.transactionId, [MAIN_ITEM, 'srp_disclosure'], { at: AT, baseDir, now: EVEN_LATER });

    expect(result).toEqual({ outcome: 'uncompleted', itemIds: [MAIN_ITEM], skipped: ['srp_disclosure'] });
    const stored = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(stored.items[MAIN_ITEM].completed).toBe(false);
  });

  it('unknown_item: a client-scoped item (reco_information_guide), even after it was completed through markItemComplete, the CLI path', () => {
    const created = create();
    completeItem(created.transactionId, 'reco_information_guide', COMPLETED_AT);

    const result = uncompleteRows(AGENT_ID, created.transactionId, ['reco_information_guide'], { at: AT, baseDir, now: EVEN_LATER });

    expect(result).toEqual({ outcome: 'unknown_item' });
    const stored = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(stored.items.reco_information_guide.completed).toBe(true);
  });
});

describe('write counts: exactly 1 on every success path, 0 on every refusal', () => {
  function writeSpy() {
    return jest.spyOn(store, 'writeTransaction');
  }

  it('completeOne: transaction_not_found writes 0', () => {
    const spy = writeSpy();
    completeOne(AGENT_ID, 'txn-20260101-deadbeef', MAIN_ITEM, { at: AT, completedAt: COMPLETED_AT, baseDir, now: LATER });
    expect(spy).not.toHaveBeenCalled();
  });

  it('completeOne: deal_closed writes 0', () => {
    const created = create();
    collapse(created.transactionId);
    const spy = writeSpy();
    completeOne(AGENT_ID, created.transactionId, MAIN_ITEM, { at: AT, completedAt: COMPLETED_AT, baseDir, now: EVEN_LATER });
    expect(spy).not.toHaveBeenCalled();
  });

  it('completeOne: unknown_item (not on catalog) writes 0', () => {
    const created = create();
    const spy = writeSpy();
    completeOne(AGENT_ID, created.transactionId, 'not_a_real_item', { at: AT, completedAt: COMPLETED_AT, baseDir, now: LATER });
    expect(spy).not.toHaveBeenCalled();
  });

  it('completeOne: unknown_item (client-scoped) writes 0', () => {
    const created = create();
    const spy = writeSpy();
    completeOne(AGENT_ID, created.transactionId, 'reco_information_guide', { at: AT, completedAt: COMPLETED_AT, baseDir, now: LATER });
    expect(spy).not.toHaveBeenCalled();
  });

  it('completeOne: not_required writes 0', () => {
    const created = createNoAdditionalDeposit();
    const spy = writeSpy();
    completeOne(AGENT_ID, created.transactionId, 'additional_deposit_receipt_issued', { at: AT, completedAt: COMPLETED_AT, baseDir, now: EVEN_LATER });
    expect(spy).not.toHaveBeenCalled();
  });

  it('completeOne: already_complete writes 0', () => {
    const created = create();
    completeItem(created.transactionId, MAIN_ITEM, COMPLETED_AT);
    const spy = writeSpy();
    completeOne(AGENT_ID, created.transactionId, MAIN_ITEM, { at: AT, completedAt: COMPLETED_AT2, baseDir, now: EVEN_LATER });
    expect(spy).not.toHaveBeenCalled();
  });

  it('completeOne: completed writes 1', () => {
    const created = create();
    const spy = writeSpy();
    completeOne(AGENT_ID, created.transactionId, MAIN_ITEM, { at: AT, completedAt: COMPLETED_AT, baseDir, now: LATER });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('completeChain: transaction_not_found writes 0', () => {
    const spy = writeSpy();
    completeChain(AGENT_ID, 'txn-20260101-deadbeef', 'brokerage_deposit_receipt_received', { at: AT, completedAt: COMPLETED_AT, baseDir, now: LATER });
    expect(spy).not.toHaveBeenCalled();
  });

  it('completeChain: deal_closed writes 0', () => {
    const created = create();
    collapse(created.transactionId);
    const spy = writeSpy();
    completeChain(AGENT_ID, created.transactionId, 'brokerage_deposit_receipt_received', { at: AT, completedAt: COMPLETED_AT, baseDir, now: EVEN_LATER });
    expect(spy).not.toHaveBeenCalled();
  });

  it('completeChain: unknown_item (no known chain) writes 0', () => {
    const created = create();
    const spy = writeSpy();
    completeChain(AGENT_ID, created.transactionId, 'not_a_real_item', { at: AT, completedAt: COMPLETED_AT, baseDir, now: LATER });
    expect(spy).not.toHaveBeenCalled();
  });

  it('completeChain: unknown_item (holding receipt on buyer_purchase) writes 0', () => {
    const created = create('buyer_purchase');
    const spy = writeSpy();
    completeChain(AGENT_ID, created.transactionId, 'brokerage_deposit_receipt_issued', { at: AT, completedAt: COMPLETED_AT, baseDir, now: LATER });
    expect(spy).not.toHaveBeenCalled();
  });

  it('completeChain: not_required writes 0', () => {
    const created = createNoAdditionalDeposit();
    const spy = writeSpy();
    completeChain(AGENT_ID, created.transactionId, 'additional_deposit_receipt_issued', { at: AT, completedAt: COMPLETED_AT, baseDir, now: EVEN_LATER });
    expect(spy).not.toHaveBeenCalled();
  });

  it('completeChain: already_complete writes 0', () => {
    const created = create('buyer_purchase');
    completeItem(created.transactionId, PAYING_CHAIN[0], COMPLETED_AT);
    completeItem(created.transactionId, PAYING_CHAIN[1], COMPLETED_AT2);
    completeItem(created.transactionId, PAYING_CHAIN[2], COMPLETED_AT3);
    const spy = writeSpy();
    completeChain(AGENT_ID, created.transactionId, PAYING_CHAIN[2], { at: AT, completedAt: '2026-07-14T00:00:00.000Z', baseDir, now: EVEN_LATER });
    expect(spy).not.toHaveBeenCalled();
  });

  it('completeChain: completed, fresh chain writes 1', () => {
    const created = create('buyer_purchase');
    const spy = writeSpy();
    completeChain(AGENT_ID, created.transactionId, PAYING_CHAIN[2], { at: AT, completedAt: COMPLETED_AT, baseDir, now: LATER });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('completeChain: completed, partial chain writes 1', () => {
    const created = create('buyer_purchase');
    completeItem(created.transactionId, PAYING_CHAIN[0], COMPLETED_AT);
    const spy = writeSpy();
    completeChain(AGENT_ID, created.transactionId, PAYING_CHAIN[2], { at: AT, completedAt: COMPLETED_AT2, baseDir, now: EVEN_LATER });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('uncompleteRows: transaction_not_found writes 0', () => {
    const spy = writeSpy();
    uncompleteRows(AGENT_ID, 'txn-20260101-deadbeef', [MAIN_ITEM], { at: AT, baseDir, now: LATER });
    expect(spy).not.toHaveBeenCalled();
  });

  it('uncompleteRows: deal_closed writes 0', () => {
    const created = create();
    completeItem(created.transactionId, MAIN_ITEM, COMPLETED_AT);
    collapse(created.transactionId);
    const spy = writeSpy();
    uncompleteRows(AGENT_ID, created.transactionId, [MAIN_ITEM], { at: AT, baseDir, now: EVEN_LATER });
    expect(spy).not.toHaveBeenCalled();
  });

  it('uncompleteRows: unknown_item (not on catalog) writes 0', () => {
    const created = create();
    const spy = writeSpy();
    uncompleteRows(AGENT_ID, created.transactionId, ['not_a_real_item'], { at: AT, baseDir, now: LATER });
    expect(spy).not.toHaveBeenCalled();
  });

  it('uncompleteRows: unknown_item (client-scoped, already complete via the CLI path) writes 0', () => {
    const created = create();
    completeItem(created.transactionId, 'reco_information_guide', COMPLETED_AT);
    const spy = writeSpy();
    uncompleteRows(AGENT_ID, created.transactionId, ['reco_information_guide'], { at: AT, baseDir, now: EVEN_LATER });
    expect(spy).not.toHaveBeenCalled();
  });

  it('uncompleteRows: nothing_to_undo writes 0', () => {
    const created = create();
    const spy = writeSpy();
    uncompleteRows(AGENT_ID, created.transactionId, [MAIN_ITEM], { at: AT, baseDir, now: LATER });
    expect(spy).not.toHaveBeenCalled();
  });

  it('uncompleteRows: uncompleted writes 1', () => {
    const created = create();
    completeItem(created.transactionId, MAIN_ITEM, COMPLETED_AT);
    const spy = writeSpy();
    uncompleteRows(AGENT_ID, created.transactionId, [MAIN_ITEM], { at: AT, baseDir, now: EVEN_LATER });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
