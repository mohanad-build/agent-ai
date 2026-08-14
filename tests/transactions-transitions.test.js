'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { transitionTransaction } = require('../src/transactions/transitions');
const { createTransaction, readTransaction, writeTransaction } = require('../src/transactions/store');
const { markItemComplete } = require('../src/transactions/items');
const { setFact } = require('../src/transactions/facts');

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');
const LATER = new Date('2026-07-16T09:30:00.000Z');
const AT = '2026-07-16T09:30:00.000Z';
const COMPLETED_AT = '2026-07-11T00:00:00.000Z';

// The six buyer_purchase catalog items with reads: [] — annotateItem
// (resolver.js) marks these 'required' unconditionally, regardless of
// facts. Completing all six, plus resolving every reads-based item away
// from 'indeterminate', is what makes a fresh buyer_purchase transaction
// closable with nothing outstanding.
const UNCONDITIONAL_REQUIRED_IDS = [
  'reco_information_guide',
  'deal_sheet',
  'buyer_representation_agreement',
  'fintrac_individual_identification_record',
  'fintrac_third_party_determination',
  'fintrac_receipt_of_funds_record',
];

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transactions-transitions-test-'));
}

let baseDir;

beforeEach(() => { baseDir = makeTmpDir(); });
afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

function createInState(state, type = 'buyer_purchase') {
  return createTransaction(AGENT_ID, { type, state, address: '12 Main St' }, { baseDir, now: CLOCK });
}

// Resolves every reads-based buyer_purchase item to not_applicable, so only
// the six UNCONDITIONAL_REQUIRED_IDS remain 'required' and nothing is
// 'indeterminate'.
function clearIndeterminates(transactionId) {
  setFact(AGENT_ID, transactionId, 'hasSelfRepresentedParty', false, { at: AT, actor: 'agent', baseDir, now: CLOCK });
  setFact(AGENT_ID, transactionId, 'entityType', 'individual', { at: AT, actor: 'agent', baseDir, now: CLOCK });
  setFact(AGENT_ID, transactionId, 'conditions', [], { at: AT, actor: 'agent', baseDir, now: CLOCK });
}

function completeUnconditionalRequired(transactionId, exceptId) {
  UNCONDITIONAL_REQUIRED_IDS.filter((id) => id !== exceptId).forEach((id) => {
    markItemComplete(AGENT_ID, transactionId, id, { at: AT, actor: 'agent', completedAt: COMPLETED_AT, baseDir, now: CLOCK });
  });
}

function closeEvents(transaction) {
  return (transaction.events || []).filter((event) => event.kind === 'closed_with_items_outstanding');
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

  test('closing with one required item incomplete writes the event with outstandingCount 1', () => {
    const created = createInState('firm');
    clearIndeterminates(created.transactionId);
    completeUnconditionalRequired(created.transactionId, 'fintrac_receipt_of_funds_record');

    const result = transitionTransaction(AGENT_ID, created.transactionId, 'closed', {
      at: AT,
      actor: 'agent',
      baseDir,
      now: LATER,
    });

    expect(result.valid).toBe(true);
    expect(result.transaction.state).toBe('closed');
    const events = closeEvents(result.transaction);
    expect(events).toHaveLength(1);
    expect(events[0].payload.outstandingCount).toBe(1);
    expect(events[0].payload.indeterminateCount).toBe(0);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(closeEvents(onDisk)).toHaveLength(1);
  });

  test('closing with only indeterminate items writes the event with outstandingCount 0 and indeterminateCount > 0', () => {
    const created = createInState('firm');
    completeUnconditionalRequired(created.transactionId);
    // No facts set at all: every reads-based item (srp_disclosure,
    // fintrac_corporation_identification_record,
    // fintrac_articles_of_incorporation, fintrac_unrepresented_party_record,
    // and the eight condition items) stays 'indeterminate'. This is the case
    // that wrote nothing before this commit.

    const result = transitionTransaction(AGENT_ID, created.transactionId, 'closed', {
      at: AT,
      actor: 'agent',
      baseDir,
      now: LATER,
    });

    expect(result.valid).toBe(true);
    const events = closeEvents(result.transaction);
    expect(events).toHaveLength(1);
    expect(events[0].payload.outstandingCount).toBe(0);
    expect(events[0].payload.indeterminateCount).toBeGreaterThan(0);
  });

  test('closing with nothing outstanding and nothing indeterminate writes no event', () => {
    const created = createInState('firm');
    clearIndeterminates(created.transactionId);
    completeUnconditionalRequired(created.transactionId);

    const result = transitionTransaction(AGENT_ID, created.transactionId, 'closed', {
      at: AT,
      actor: 'agent',
      baseDir,
      now: LATER,
    });

    expect(result.valid).toBe(true);
    expect(result.transaction.state).toBe('closed');
    expect(closeEvents(result.transaction)).toHaveLength(0);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(closeEvents(onDisk)).toHaveLength(0);
  });

  test('a transaction carrying a stale item id closes successfully (the unclosable bug)', () => {
    const created = createInState('firm');
    // tenant_representation_agreement exists on tenant_lease's catalog, not
    // buyer_purchase's. items.js would refuse to write it (assertKnownItemId),
    // so it is written directly to simulate a catalog rename/removal after
    // the id was recorded. reResolve carries it forward as
    // 'no_longer_applicable' with no label, since the stored entry never had
    // one — before the label-validation fix, that made every close throw.
    writeTransaction(AGENT_ID, {
      ...created,
      items: { tenant_representation_agreement: { completed: true, completedAt: COMPLETED_AT } },
    }, { baseDir, now: CLOCK });

    const result = transitionTransaction(AGENT_ID, created.transactionId, 'closed', {
      at: AT,
      actor: 'agent',
      baseDir,
      now: LATER,
    });

    expect(result.valid).toBe(true);
    expect(result.transaction.state).toBe('closed');
  });

  test('transitioning to collapsed with items outstanding writes no closed_with_items_outstanding event', () => {
    const created = createInState('firm');

    const result = transitionTransaction(AGENT_ID, created.transactionId, 'collapsed', {
      at: AT,
      actor: 'system',
      baseDir,
      now: LATER,
    });

    expect(result.valid).toBe(true);
    expect(result.transaction.state).toBe('collapsed');
    expect(result.transaction.events).toBeUndefined();
  });

  test('the caller cannot supply items: passing an items option has no effect on the payload', () => {
    const created = createInState('firm');

    const result = transitionTransaction(AGENT_ID, created.transactionId, 'closed', {
      at: AT,
      actor: 'system',
      items: [], // if honored, this would fabricate a clean close with no event
      baseDir,
      now: LATER,
    });

    expect(result.valid).toBe(true);
    expect(result.transaction.state).toBe('closed');
    expect(closeEvents(result.transaction)).toHaveLength(1);
  });

  test('closing with items outstanding records them even without an items option (the silent-close bug)', () => {
    const created = createInState('firm');

    const result = transitionTransaction(AGENT_ID, created.transactionId, 'closed', {
      at: AT,
      actor: 'system',
      baseDir,
      now: CLOCK,
    });

    expect(result.valid).toBe(true);
    expect(result.transaction.state).toBe('closed');
    expect(closeEvents(result.transaction)).toHaveLength(1);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(closeEvents(onDisk)).toHaveLength(1);
  });

  test('a non-close transition never writes an event', () => {
    const created = createInState('conditional');

    const result = transitionTransaction(AGENT_ID, created.transactionId, 'firm', {
      at: AT,
      actor: 'system',
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
