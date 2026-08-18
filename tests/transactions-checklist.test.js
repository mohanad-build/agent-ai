'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { resolveTransactionChecklist, resolveChecklistForTransaction } = require('../src/transactions/checklist');
const { resolveChecklist } = require('../src/transactions/resolver');
const { markItemComplete } = require('../src/transactions/items');
const { setFact } = require('../src/transactions/facts');
const { createTransaction, writeTransaction, readTransaction } = require('../src/transactions/store');

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

  it('resolves differently at different states: collapsed includes mutual_release, conditional does not', () => {
    const conditional = create('buyer_purchase', 'conditional');
    const collapsed = create('buyer_purchase', 'collapsed');

    const conditionalResult = resolveTransactionChecklist(AGENT_ID, conditional.transactionId, { baseDir });
    const collapsedResult = resolveTransactionChecklist(AGENT_ID, collapsed.transactionId, { baseDir });

    expect(conditionalResult.some((item) => item.id === 'mutual_release')).toBe(false);
    expect(collapsedResult.some((item) => item.id === 'mutual_release')).toBe(true);
  });
});

describe('resolveChecklistForTransaction', () => {
  it("given the same transaction, matches resolveTransactionChecklist's result", () => {
    const created = create();
    markItemComplete(AGENT_ID, created.transactionId, 'reco_information_guide', {
      at: AT, actor: 'agent', completedAt: COMPLETED_AT, baseDir, now: LATER,
    });

    const viaDiskRead = resolveTransactionChecklist(AGENT_ID, created.transactionId, { baseDir });

    const transaction = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    const viaPureFunction = resolveChecklistForTransaction(transaction);

    expect(viaPureFunction).toEqual(viaDiskRead);
  });

  it('does no I/O: resolves a hand-built transaction for an agent and id that do not exist on disk', () => {
    const transaction = {
      type: 'buyer_purchase',
      state: 'conditional',
      items: {},
      facts: {},
    };

    const result = resolveChecklistForTransaction(transaction);

    expect(result).toEqual(resolveChecklist('buyer_purchase', 'conditional', {}));
  });

  it('uses the participants-derived representedPersons over a stale stored facts.representedPersons', () => {
    // facts.representedPersons here is a leftover from before this field
    // was derived: a real transaction could carry one if it was written
    // under the old regime and never rewritten. participants names a
    // different id entirely. The resolved output must reflect the
    // participants-derived id, never the stale stored one.
    const transaction = {
      type: 'buyer_purchase',
      state: 'conditional',
      items: {},
      facts: { representedPersons: ['per-99999999'] },
      participants: { 'per-11111111': { roles: ['client'] } },
    };

    const result = resolveChecklistForTransaction(transaction);
    const item = result.find((entry) => entry.id === 'reco_information_guide');

    expect(item.outstandingPersons).toEqual(['per-11111111']);
    expect(item.outstandingPersons).not.toContain('per-99999999');
  });

  it('shows the absent-representedPersons behaviour when participants derives to undefined, not the stale stored value', () => {
    // facts.representedPersons here is a leftover from before this field
    // was derived. participants holds only a non-qualifying role, so
    // deriveRepresentedPersons returns undefined -- "nobody named yet", not
    // "the stale list is still valid". The resolved row must carry neither
    // satisfiedPersons nor outstandingPersons, exactly as if participants
    // had never been set at all: the stale array must not leak through.
    const transaction = {
      type: 'buyer_purchase',
      state: 'conditional',
      items: {},
      facts: { representedPersons: ['per-99999999'] },
      participants: { 'per-11111111': { roles: ['lawyer'] } },
    };

    const result = resolveChecklistForTransaction(transaction);
    const item = result.find((entry) => entry.id === 'reco_information_guide');

    expect(item).not.toHaveProperty('satisfiedPersons');
    expect(item).not.toHaveProperty('outstandingPersons');
  });

  it('reads state off the object it is handed: same transaction, different state field, different result', () => {
    const base = { type: 'buyer_purchase', items: {}, facts: {} };

    const conditionalResult = resolveChecklistForTransaction({ ...base, state: 'conditional' });
    const collapsedResult = resolveChecklistForTransaction({ ...base, state: 'collapsed' });

    expect(conditionalResult.some((item) => item.id === 'mutual_release')).toBe(false);
    expect(collapsedResult.some((item) => item.id === 'mutual_release')).toBe(true);
  });
});
