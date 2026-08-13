'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { resolveTransactionChecklist } = require('../src/transactions/checklist');
const { resolveChecklist } = require('../src/transactions/resolver');
const { markItemComplete } = require('../src/transactions/items');
const { setFact } = require('../src/transactions/facts');
const { createTransaction, writeTransaction } = require('../src/transactions/store');

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');
const LATER = new Date('2026-07-16T09:30:00.000Z');
const EVEN_LATER = new Date('2026-07-17T08:00:00.000Z');
const AT = '2026-07-16T09:30:00.000Z';
const COMPLETED_AT = '2026-07-11T00:00:00.000Z';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transactions-checklist-test-'));
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

describe('resolveTransactionChecklist', () => {
  it('reattaches the map key as id: a completed item comes back completed, not dropped', () => {
    const created = create();
    markItemComplete(AGENT_ID, created.transactionId, 'reco_information_guide', {
      at: AT, actor: 'agent', completedAt: COMPLETED_AT, baseDir, now: LATER,
    });

    const result = resolveTransactionChecklist(AGENT_ID, created.transactionId, { baseDir });
    const item = result.find((entry) => entry.id === 'reco_information_guide');

    expect(item).toBeDefined();
    expect(item.completed).toBe(true);
    expect(item.completedAt).toBe(COMPLETED_AT);
  });

  it('carries all four STATE_FIELDS through the round trip, including an empty-string note', () => {
    const created = create();
    markItemComplete(AGENT_ID, created.transactionId, 'reco_information_guide', {
      at: AT,
      actor: 'agent',
      completedAt: COMPLETED_AT,
      documents: ['guide.pdf'],
      note: '',
      baseDir,
      now: LATER,
    });

    const result = resolveTransactionChecklist(AGENT_ID, created.transactionId, { baseDir });
    const item = result.find((entry) => entry.id === 'reco_information_guide');

    expect(item.completed).toBe(true);
    expect(item.completedAt).toBe(COMPLETED_AT);
    expect(item.documents).toEqual(['guide.pdf']);
    expect(item.note).toBe('');
  });

  it('a transaction with no facts and no items resolves without throwing and matches the full catalog', () => {
    const created = create();

    const result = resolveTransactionChecklist(AGENT_ID, created.transactionId, { baseDir });

    expect(result).toEqual(resolveChecklist('buyer_purchase', 'conditional', {}));
  });

  it('a fact written via setFact changes applicability', () => {
    const created = create();

    const before = resolveTransactionChecklist(AGENT_ID, created.transactionId, { baseDir });
    const beforeItem = before.find((entry) => entry.id === 'fintrac_corporation_identification_record');
    expect(beforeItem.applicability).toBe('indeterminate');

    setFact(AGENT_ID, created.transactionId, 'entityType', 'corporation', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    });

    const after = resolveTransactionChecklist(AGENT_ID, created.transactionId, { baseDir });
    const afterItem = after.find((entry) => entry.id === 'fintrac_corporation_identification_record');
    expect(afterItem.applicability).toBe('required');
  });

  it('a stored id not in the catalog for that type comes back as no_longer_applicable, not dropped', () => {
    const created = create();

    // tenant_representation_agreement exists on tenant_lease's catalog, not
    // buyer_purchase's. items.js would refuse to write it (assertKnownItemId),
    // so it is written directly to disk to simulate a catalog rename/removal
    // after the id was recorded.
    writeTransaction(AGENT_ID, {
      ...created,
      items: {
        tenant_representation_agreement: { completed: true, completedAt: COMPLETED_AT },
      },
    }, { baseDir, now: EVEN_LATER });

    const result = resolveTransactionChecklist(AGENT_ID, created.transactionId, { baseDir });
    const item = result.find((entry) => entry.id === 'tenant_representation_agreement');

    expect(item).toBeDefined();
    expect(item.applicability).toBe('no_longer_applicable');
    expect(item.completed).toBe(true);
    expect(item.reason).toMatch(/buyer_purchase/);
  });

  it('a missing transaction throws', () => {
    expect(() => resolveTransactionChecklist(AGENT_ID, 'txn-20260715-deadbeef', { baseDir })).toThrow(
      /resolveTransactionChecklist: no transaction txn-20260715-deadbeef for agent test-agent/
    );
  });
});
