'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { markPersonSatisfied, markPersonUnsatisfied } = require('../src/transactions/satisfactions');
const { createTransaction, readTransaction, writeTransaction } = require('../src/transactions/store');
const { setFact } = require('../src/transactions/facts');
const { resolveTransactionChecklist } = require('../src/transactions/checklist');

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');
const LATER = new Date('2026-07-16T09:30:00.000Z');
const EVEN_LATER = new Date('2026-07-17T08:00:00.000Z');
const AT = '2026-07-15T10:00:00.000Z';
const AT2 = '2026-07-16T09:30:00.000Z';
const AT3 = '2026-07-17T08:00:00.000Z';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transactions-satisfactions-test-'));
}

let baseDir;

beforeEach(() => { baseDir = makeTmpDir(); });
afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

function create(type = 'buyer_purchase', state = 'conditional') {
  return createTransaction(AGENT_ID, { type, state, address: '12 Main St' }, { baseDir, now: CLOCK });
}

function represent(transactionId, personIds) {
  return setFact(AGENT_ID, transactionId, 'representedPersons', personIds, { at: AT, actor: 'agent', baseDir, now: CLOCK });
}

describe('markPersonSatisfied', () => {
  it('a first satisfaction writes a person_satisfied event and a clientSatisfactions entry of only { at, actor }', () => {
    const created = create();
    represent(created.transactionId, ['Jane Smith']);

    const result = markPersonSatisfied(AGENT_ID, created.transactionId, 'Jane Smith', 'reco_information_guide', {
      at: AT2, actor: 'agent', baseDir, now: LATER,
    });

    const satisfiedEvents = result.events.filter((e) => e.kind === 'person_satisfied');
    expect(satisfiedEvents).toHaveLength(1);
    expect(satisfiedEvents[0]).toMatchObject({ at: AT2, actor: 'agent', kind: 'person_satisfied' });
    expect(satisfiedEvents[0].payload).toEqual({ personId: 'Jane Smith', itemId: 'reco_information_guide' });
    expect(result.facts.clientSatisfactions).toEqual({
      'Jane Smith': { reco_information_guide: { at: AT2, actor: 'agent' } },
    });
  });

  it('throws when personId is not in representedPersons, and writes nothing to disk', () => {
    const created = create();
    represent(created.transactionId, ['Jane Smith']);
    const before = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    expect(() => markPersonSatisfied(AGENT_ID, created.transactionId, 'John Smith', 'reco_information_guide', {
      at: AT2, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^markPersonSatisfied: 'John Smith' is not in representedPersons/);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk).toEqual(before);
  });

  it('throws when representedPersons is not set at all, and writes nothing to disk', () => {
    const created = create();

    expect(() => markPersonSatisfied(AGENT_ID, created.transactionId, 'Jane Smith', 'reco_information_guide', {
      at: AT2, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^markPersonSatisfied: representedPersons is not set/);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk).toEqual(created);
  });

  it('matches personId by strict equality: differing case is a different, unrepresented person', () => {
    const created = create();
    represent(created.transactionId, ['Jane Smith']);

    expect(() => markPersonSatisfied(AGENT_ID, created.transactionId, 'jane smith', 'reco_information_guide', {
      at: AT2, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^markPersonSatisfied: 'jane smith' is not in representedPersons/);
  });

  it('throws when the item is not client-scoped, naming the item', () => {
    const created = create();
    represent(created.transactionId, ['Jane Smith']);

    expect(() => markPersonSatisfied(AGENT_ID, created.transactionId, 'Jane Smith', 'deal_sheet', {
      at: AT2, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^markPersonSatisfied: item 'deal_sheet' is not client-scoped/);
  });

  it("throws when the item is clientScope 'dated', naming the item", () => {
    const created = create();
    represent(created.transactionId, ['Jane Smith']);

    expect(() => markPersonSatisfied(AGENT_ID, created.transactionId, 'Jane Smith', 'buyer_representation_agreement', {
      at: AT2, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^markPersonSatisfied: item 'buyer_representation_agreement' is clientScope 'dated'/);
  });

  it('throws on an unknown item id for the type', () => {
    const created = create();
    represent(created.transactionId, ['Jane Smith']);

    expect(() => markPersonSatisfied(AGENT_ID, created.transactionId, 'Jane Smith', 'not_a_real_item', {
      at: AT2, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^markPersonSatisfied: unknown item id 'not_a_real_item' for type 'buyer_purchase'/);
  });

  it('throws when the transaction does not exist', () => {
    expect(() => markPersonSatisfied(AGENT_ID, 'txn-20260715-00000000', 'Jane Smith', 'reco_information_guide', {
      at: AT2, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^markPersonSatisfied: no transaction txn-20260715-00000000 for agent test-agent/);
  });

  it('satisfying one of two persons leaves the other in outstandingPersons (proven through resolveTransactionChecklist)', () => {
    const created = create();
    represent(created.transactionId, ['Jane Smith', 'John Smith']);

    markPersonSatisfied(AGENT_ID, created.transactionId, 'Jane Smith', 'reco_information_guide', {
      at: AT2, actor: 'agent', baseDir, now: LATER,
    });

    const resolved = resolveTransactionChecklist(AGENT_ID, created.transactionId, { baseDir });
    const row = resolved.find((item) => item.id === 'reco_information_guide');
    expect(row.satisfiedPersons).toEqual(['Jane Smith']);
    expect(row.outstandingPersons).toEqual(['John Smith']);
  });

  it('satisfying both persons empties outstandingPersons (proven through resolveTransactionChecklist)', () => {
    const created = create();
    represent(created.transactionId, ['Jane Smith', 'John Smith']);

    markPersonSatisfied(AGENT_ID, created.transactionId, 'Jane Smith', 'reco_information_guide', {
      at: AT2, actor: 'agent', baseDir, now: LATER,
    });
    markPersonSatisfied(AGENT_ID, created.transactionId, 'John Smith', 'reco_information_guide', {
      at: AT2, actor: 'agent', baseDir, now: LATER,
    });

    const resolved = resolveTransactionChecklist(AGENT_ID, created.transactionId, { baseDir });
    const row = resolved.find((item) => item.id === 'reco_information_guide');
    expect(row.satisfiedPersons).toEqual(['Jane Smith', 'John Smith']);
    expect(row.outstandingPersons).toEqual([]);
  });

  it('writing on an item that currently resolves indeterminate still succeeds, and the resolved row still carries neither field', () => {
    const created = create();
    represent(created.transactionId, ['Jane Smith']);
    // entityType is never set, so fintrac_corporation_identification_record
    // (reads: ['entityType']) resolves 'indeterminate'. The writer records
    // what it was told regardless; the resolver decides what to show.

    const result = markPersonSatisfied(AGENT_ID, created.transactionId, 'Jane Smith', 'fintrac_corporation_identification_record', {
      at: AT2, actor: 'agent', baseDir, now: LATER,
    });

    expect(result.facts.clientSatisfactions['Jane Smith']).toEqual({
      fintrac_corporation_identification_record: { at: AT2, actor: 'agent' },
    });

    const resolved = resolveTransactionChecklist(AGENT_ID, created.transactionId, { baseDir });
    const row = resolved.find((item) => item.id === 'fintrac_corporation_identification_record');
    expect(row.applicability).toBe('indeterminate');
    expect(row).not.toHaveProperty('satisfiedPersons');
    expect(row).not.toHaveProperty('outstandingPersons');
  });

  it('a satisfaction stored for a person not in representedPersons is silently ignored by the resolver', () => {
    // Written directly via writeTransaction, bypassing markPersonSatisfied's
    // personId validation entirely, to pin the resolver's own behaviour: the
    // validation in this commit is the only thing that normally prevents an
    // orphaned entry like this from being written at all.
    const created = create();
    represent(created.transactionId, ['Jane Smith']);
    const before = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    writeTransaction(AGENT_ID, {
      ...before,
      facts: {
        ...before.facts,
        clientSatisfactions: {
          'Ghost Person': { reco_information_guide: { at: AT, actor: 'agent' } },
        },
      },
    }, { baseDir, now: CLOCK });

    const resolved = resolveTransactionChecklist(AGENT_ID, created.transactionId, { baseDir });
    const row = resolved.find((item) => item.id === 'reco_information_guide');
    expect(row.satisfiedPersons).toEqual([]);
    expect(row.outstandingPersons).toEqual(['Jane Smith']);
  });
});

describe('markPersonUnsatisfied', () => {
  it('writes a person_unsatisfied event with a payload of personId and itemId', () => {
    const created = create();
    represent(created.transactionId, ['Jane Smith']);
    markPersonSatisfied(AGENT_ID, created.transactionId, 'Jane Smith', 'reco_information_guide', {
      at: AT2, actor: 'agent', baseDir, now: LATER,
    });

    const result = markPersonUnsatisfied(AGENT_ID, created.transactionId, 'Jane Smith', 'reco_information_guide', {
      at: AT3, actor: 'agent', baseDir, now: EVEN_LATER,
    });

    const events = result.events.filter((e) => e.kind === 'person_unsatisfied');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ at: AT3, actor: 'agent', kind: 'person_unsatisfied' });
    expect(events[0].payload).toEqual({ personId: 'Jane Smith', itemId: 'reco_information_guide' });
  });

  it('unsatisfying one item removes only that item key, leaving the person satisfied on their other items', () => {
    const created = create();
    represent(created.transactionId, ['Jane Smith']);
    markPersonSatisfied(AGENT_ID, created.transactionId, 'Jane Smith', 'reco_information_guide', {
      at: AT2, actor: 'agent', baseDir, now: CLOCK,
    });
    markPersonSatisfied(AGENT_ID, created.transactionId, 'Jane Smith', 'fintrac_individual_identification_record', {
      at: AT2, actor: 'agent', baseDir, now: CLOCK,
    });

    const result = markPersonUnsatisfied(AGENT_ID, created.transactionId, 'Jane Smith', 'reco_information_guide', {
      at: AT3, actor: 'agent', baseDir, now: LATER,
    });

    expect(result.facts.clientSatisfactions['Jane Smith']).toEqual({
      fintrac_individual_identification_record: { at: AT2, actor: 'agent' },
    });

    const resolved = resolveTransactionChecklist(AGENT_ID, created.transactionId, { baseDir });
    const recoRow = resolved.find((item) => item.id === 'reco_information_guide');
    const fintracRow = resolved.find((item) => item.id === 'fintrac_individual_identification_record');
    expect(recoRow.outstandingPersons).toEqual(['Jane Smith']);
    expect(fintracRow.satisfiedPersons).toEqual(['Jane Smith']);
    expect(fintracRow.outstandingPersons).toEqual([]);
  });

  it('unsatisfying the last item for a person removes the person key entirely, not just the item key', () => {
    const created = create();
    represent(created.transactionId, ['Jane Smith']);
    markPersonSatisfied(AGENT_ID, created.transactionId, 'Jane Smith', 'reco_information_guide', {
      at: AT2, actor: 'agent', baseDir, now: CLOCK,
    });

    const result = markPersonUnsatisfied(AGENT_ID, created.transactionId, 'Jane Smith', 'reco_information_guide', {
      at: AT3, actor: 'agent', baseDir, now: LATER,
    });

    expect(result.facts.clientSatisfactions).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(result.facts.clientSatisfactions, 'Jane Smith')).toBe(false);
  });

  it('throws when unsatisfying an item the person was never satisfied for, and writes nothing to disk', () => {
    const created = create();
    represent(created.transactionId, ['Jane Smith']);
    const before = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    expect(() => markPersonUnsatisfied(AGENT_ID, created.transactionId, 'Jane Smith', 'reco_information_guide', {
      at: AT2, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^markPersonUnsatisfied: 'Jane Smith' is not satisfied for item 'reco_information_guide'/);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk).toEqual(before);
  });

  it('throws when personId is not in representedPersons, and writes nothing to disk', () => {
    const created = create();
    represent(created.transactionId, ['Jane Smith']);
    const before = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    expect(() => markPersonUnsatisfied(AGENT_ID, created.transactionId, 'John Smith', 'reco_information_guide', {
      at: AT2, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^markPersonUnsatisfied: 'John Smith' is not in representedPersons/);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk).toEqual(before);
  });

  it('throws when the transaction does not exist', () => {
    expect(() => markPersonUnsatisfied(AGENT_ID, 'txn-20260715-00000000', 'Jane Smith', 'reco_information_guide', {
      at: AT2, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^markPersonUnsatisfied: no transaction txn-20260715-00000000 for agent test-agent/);
  });
});

describe('clientSatisfactions key absence', () => {
  it('a transaction with no satisfaction writes has no clientSatisfactions key', () => {
    const created = create();
    expect(created.facts).toBeUndefined();

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.facts).toBeUndefined();
  });
});
