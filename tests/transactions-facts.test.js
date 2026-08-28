'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { setFact, confirmFact, correctFact } = require('../src/transactions/facts');
const { createTransaction, readTransaction } = require('../src/transactions/store');
const { CATALOG } = require('../src/transactions/rules');
const { FACT_KEYS } = require('../src/transactions/rules/factKeys');

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');
const LATER = new Date('2026-07-16T09:30:00.000Z');
const EVEN_LATER = new Date('2026-07-17T08:00:00.000Z');
const AT = '2026-07-16T09:30:00.000Z';
const AT2 = '2026-07-17T08:00:00.000Z';
const AT3 = '2026-07-18T08:00:00.000Z';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transactions-facts-test-'));
}

let baseDir;

beforeEach(() => { baseDir = makeTmpDir(); });
afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

function create() {
  return createTransaction(
    AGENT_ID,
    { type: 'buyer_purchase', state: 'conditional', address: '12 Main St' },
    { baseDir, now: CLOCK }
  );
}

describe('FACT_KEYS', () => {
  it('contains every key any catalog item lists in reads, across all six types', () => {
    // This only pins the reads half of the enumeration. requiredWhen bodies
    // dereference facts.x directly inside opaque closures and cannot be
    // walked mechanically, so that half of FACT_KEYS is hand-verified, not
    // covered by this test.
    const readKeys = new Set();
    Object.values(CATALOG).forEach((items) => {
      items.forEach((item) => {
        item.reads.forEach((key) => readKeys.add(key));
      });
    });

    readKeys.forEach((key) => {
      expect(FACT_KEYS).toContain(key);
    });
  });

  it('does not include clientSatisfactions', () => {
    expect(FACT_KEYS).not.toContain('clientSatisfactions');
  });

  it('does not include representedPersons', () => {
    expect(FACT_KEYS).not.toContain('representedPersons');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(FACT_KEYS)).toBe(true);
  });
});

describe('setFact', () => {
  it('a first set omits before', () => {
    const created = create();
    const result = setFact(AGENT_ID, created.transactionId, 'entityType', 'corporation', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ at: AT, actor: 'agent', kind: 'fact_set' });
    expect(result.events[0].payload).toEqual({ key: 'entityType', after: 'corporation' });
    expect(result.facts).toEqual({ entityType: 'corporation' });
  });

  it('a second set includes before', () => {
    const created = create();
    setFact(AGENT_ID, created.transactionId, 'entityType', 'corporation', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    });
    const result = setFact(AGENT_ID, created.transactionId, 'entityType', 'individual', {
      at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
    });

    expect(result.events).toHaveLength(2);
    expect(result.events[1].payload).toEqual({ key: 'entityType', before: 'corporation', after: 'individual' });
    expect(result.facts).toEqual({ entityType: 'individual' });
  });

  it.each([
    ['string', 'corporation'],
    ['number', 42],
    ['boolean', true],
    ['null', null],
    ['array', ['inspection', 'financing']],
  ])('the value that lands on disk matches what was passed (%s)', (_label, value) => {
    const created = create();
    setFact(AGENT_ID, created.transactionId, 'entityType', value, {
      at: AT, actor: 'agent', baseDir, now: LATER,
    });

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.facts.entityType).toEqual(value);
  });

  it('throws on undefined and writes nothing to disk', () => {
    const created = create();
    expect(() => setFact(AGENT_ID, created.transactionId, 'entityType', undefined, {
      at: AT, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^setFact: value must not be undefined/);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk).toEqual(created);
  });

  it('throws on an unknown key and writes nothing to disk', () => {
    const created = create();
    expect(() => setFact(AGENT_ID, created.transactionId, 'notARealFact', 'x', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^setFact: unknown fact key 'notARealFact'/);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk).toEqual(created);
  });

  it('throws on clientSatisfactions specifically, pinning the deliberate exclusion', () => {
    const created = create();
    expect(() => setFact(AGENT_ID, created.transactionId, 'clientSatisfactions', {}, {
      at: AT, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^setFact: unknown fact key 'clientSatisfactions'/);
  });

  it('throws on representedPersons specifically, pinning the deliberate exclusion', () => {
    const created = create();
    expect(() => setFact(AGENT_ID, created.transactionId, 'representedPersons', ['Jane Smith'], {
      at: AT, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^setFact: unknown fact key 'representedPersons'/);
  });

  it('throws when evidence is passed with actor agent', () => {
    const created = create();
    expect(() => setFact(AGENT_ID, created.transactionId, 'entityType', 'corporation', {
      at: AT, actor: 'agent', evidence: { excerpt: 'x' }, baseDir, now: LATER,
    })).toThrow(/^setFact: evidence may only be passed when actor is 'system'/);
  });

  it('throws when evidence is passed with actor operator', () => {
    const created = create();
    expect(() => setFact(AGENT_ID, created.transactionId, 'entityType', 'corporation', {
      at: AT, actor: 'operator', evidence: { excerpt: 'x' }, baseDir, now: LATER,
    })).toThrow(/^setFact: evidence may only be passed when actor is 'system'/);
  });

  it('lands evidence in the payload when actor is system', () => {
    const created = create();
    const evidence = { excerpt: 'Certificate of Incorporation attached' };
    const result = setFact(AGENT_ID, created.transactionId, 'entityType', 'corporation', {
      at: AT, actor: 'system', evidence, baseDir, now: LATER,
    });

    expect(result.events[0].payload.evidence).toEqual(evidence);
  });

  it('a transaction that never had a fact set has no facts key', () => {
    const created = create();
    expect(created.facts).toBeUndefined();
    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.facts).toBeUndefined();
  });

  it('accumulates events across writes, in order', () => {
    const created = create();
    setFact(AGENT_ID, created.transactionId, 'entityType', 'corporation', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    });
    setFact(AGENT_ID, created.transactionId, 'hasSelfRepresentedParty', true, {
      at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
    });
    const result = confirmFact(AGENT_ID, created.transactionId, 'entityType', {
      at: AT3, actor: 'agent', baseDir, now: EVEN_LATER,
    });

    expect(result.events).toHaveLength(3);
    expect(result.events.map((e) => e.kind)).toEqual(['fact_set', 'fact_set', 'fact_confirmed']);
    expect(result.events.map((e) => e.at)).toEqual([AT, AT2, AT3]);
  });

  it('throws when the transaction does not exist', () => {
    expect(() => setFact(AGENT_ID, 'txn-20260715-00000000', 'entityType', 'corporation', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^setFact: no transaction txn-20260715-00000000 for agent test-agent/);
  });

  describe('representationArrangement', () => {
    it('refuses double_ended on buyer_purchase, which has no sell-side pairing, and writes nothing to disk', () => {
      const created = create(); // type: 'buyer_purchase'
      expect(() => setFact(AGENT_ID, created.transactionId, 'representationArrangement', 'double_ended', {
        at: AT, actor: 'agent', baseDir, now: LATER,
      })).toThrow(/^setFact: representationArrangement 'double_ended' is not permitted on type 'buyer_purchase'/);

      const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(onDisk).toEqual(created);
    });

    it('accepts double_ended on seller_sale, which pairs with buyer_purchase', () => {
      const created = createTransaction(
        AGENT_ID,
        { type: 'seller_sale', state: 'conditional', address: '12 Main St' },
        { baseDir, now: CLOCK }
      );
      const result = setFact(AGENT_ID, created.transactionId, 'representationArrangement', 'double_ended', {
        at: AT, actor: 'agent', baseDir, now: LATER,
      });
      expect(result.facts).toEqual({ representationArrangement: 'double_ended' });
    });

    it('accepts double_ended on landlord_lease, which pairs with tenant_lease', () => {
      const created = createTransaction(
        AGENT_ID,
        { type: 'landlord_lease', state: 'accepted', address: '12 Main St' },
        { baseDir, now: CLOCK }
      );
      const result = setFact(AGENT_ID, created.transactionId, 'representationArrangement', 'double_ended', {
        at: AT, actor: 'agent', baseDir, now: LATER,
      });
      expect(result.facts).toEqual({ representationArrangement: 'double_ended' });
    });

    it('accepts single on buyer_purchase: the type restriction is specific to double_ended', () => {
      const created = create(); // type: 'buyer_purchase'
      const result = setFact(AGENT_ID, created.transactionId, 'representationArrangement', 'single', {
        at: AT, actor: 'agent', baseDir, now: LATER,
      });
      expect(result.facts).toEqual({ representationArrangement: 'single' });
    });

    it('accepts designated on buyer_purchase: the type restriction is specific to double_ended', () => {
      const created = create(); // type: 'buyer_purchase'
      const result = setFact(AGENT_ID, created.transactionId, 'representationArrangement', 'designated', {
        at: AT, actor: 'agent', baseDir, now: LATER,
      });
      expect(result.facts).toEqual({ representationArrangement: 'designated' });
    });
  });
});

describe('confirmFact', () => {
  it('carries the current value, not just the key', () => {
    const created = create();
    setFact(AGENT_ID, created.transactionId, 'entityType', 'corporation', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    });
    const result = confirmFact(AGENT_ID, created.transactionId, 'entityType', {
      at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
    });

    expect(result.events[1]).toMatchObject({ at: AT2, actor: 'agent', kind: 'fact_confirmed' });
    expect(result.events[1].payload).toEqual({ key: 'entityType', value: 'corporation' });
  });

  it('does not change the stored value', () => {
    const created = create();
    setFact(AGENT_ID, created.transactionId, 'entityType', 'corporation', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    });
    const result = confirmFact(AGENT_ID, created.transactionId, 'entityType', {
      at: AT2, actor: 'system', baseDir, now: EVEN_LATER,
    });

    expect(result.facts).toEqual({ entityType: 'corporation' });
  });

  it('throws when confirming a fact that was never set', () => {
    const created = create();
    expect(() => confirmFact(AGENT_ID, created.transactionId, 'entityType', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^confirmFact: no value set for key 'entityType'/);
  });

  it('throws on an unknown key', () => {
    const created = create();
    expect(() => confirmFact(AGENT_ID, created.transactionId, 'notARealFact', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^confirmFact: unknown fact key 'notARealFact'/);
  });

  it('throws on representedPersons specifically, pinning the deliberate exclusion', () => {
    const created = create();
    expect(() => confirmFact(AGENT_ID, created.transactionId, 'representedPersons', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^confirmFact: unknown fact key 'representedPersons'/);
  });
});

describe('correctFact', () => {
  it('payload always carries before and after', () => {
    const created = create();
    setFact(AGENT_ID, created.transactionId, 'entityType', 'corporation', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    });
    const result = correctFact(AGENT_ID, created.transactionId, 'entityType', 'individual', {
      at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
    });

    expect(result.events[1]).toMatchObject({ at: AT2, actor: 'agent', kind: 'fact_corrected' });
    expect(result.events[1].payload).toEqual({ key: 'entityType', before: 'corporation', after: 'individual' });
    expect(result.facts).toEqual({ entityType: 'individual' });
  });

  it('throws when correcting a fact that was never set', () => {
    const created = create();
    expect(() => correctFact(AGENT_ID, created.transactionId, 'entityType', 'individual', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^correctFact: no value set for key 'entityType'/);
  });

  it('throws when actor is system', () => {
    const created = create();
    setFact(AGENT_ID, created.transactionId, 'entityType', 'corporation', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    });
    expect(() => correctFact(AGENT_ID, created.transactionId, 'entityType', 'individual', {
      at: AT2, actor: 'system', baseDir, now: EVEN_LATER,
    })).toThrow(/^correctFact: actor must be 'agent'/);
  });

  it('throws when actor is operator', () => {
    const created = create();
    setFact(AGENT_ID, created.transactionId, 'entityType', 'corporation', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    });
    expect(() => correctFact(AGENT_ID, created.transactionId, 'entityType', 'individual', {
      at: AT2, actor: 'operator', baseDir, now: EVEN_LATER,
    })).toThrow(/^correctFact: actor must be 'agent'/);
  });

  it('throws on undefined value and writes nothing', () => {
    const created = create();
    setFact(AGENT_ID, created.transactionId, 'entityType', 'corporation', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    });
    const beforeCorrect = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    expect(() => correctFact(AGENT_ID, created.transactionId, 'entityType', undefined, {
      at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
    })).toThrow(/^correctFact: value must not be undefined/);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk).toEqual(beforeCorrect);
  });

  it('throws on an unknown key', () => {
    const created = create();
    expect(() => correctFact(AGENT_ID, created.transactionId, 'notARealFact', 'x', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^correctFact: unknown fact key 'notARealFact'/);
  });

  it('throws on representedPersons specifically, pinning the deliberate exclusion', () => {
    const created = create();
    expect(() => correctFact(AGENT_ID, created.transactionId, 'representedPersons', ['Jane Smith'], {
      at: AT, actor: 'agent', baseDir, now: LATER,
    })).toThrow(/^correctFact: unknown fact key 'representedPersons'/);
  });

  it('refuses correcting representationArrangement to double_ended on buyer_purchase, which has no sell-side pairing', () => {
    const created = create(); // type: 'buyer_purchase'
    setFact(AGENT_ID, created.transactionId, 'representationArrangement', 'single', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    });
    expect(() => correctFact(AGENT_ID, created.transactionId, 'representationArrangement', 'double_ended', {
      at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
    })).toThrow(/^correctFact: representationArrangement 'double_ended' is not permitted on type 'buyer_purchase'/);
  });
});
