'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { setFact, confirmFact, correctFact } = require('../src/transactions/facts');
const { createTransaction, readTransaction } = require('../src/transactions/store');
const { CATALOG } = require('../src/transactions/rules');
const { FACT_KEYS, DATE_FACT_KEYS } = require('../src/transactions/rules/factKeys');

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

  it('is the hand-written eight keys, in order', () => {
    expect(FACT_KEYS).toEqual([
      'hasSelfRepresentedParty', 'entityType', 'conditions', 'brokerageReceivedFunds', 'representationArrangement',
      'acceptedDate', 'conditionDates', 'additionalDepositDueDates',
    ]);
  });
});

describe('DATE_FACT_KEYS', () => {
  it('is the hand-written three keys, in order', () => {
    expect(DATE_FACT_KEYS).toEqual(['acceptedDate', 'conditionDates', 'additionalDepositDueDates']);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(DATE_FACT_KEYS)).toBe(true);
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

describe('conditions validation', () => {
  it('setFact accepts a list of known condition names', () => {
    const created = create();
    const result = setFact(AGENT_ID, created.transactionId, 'conditions', ['financing', 'status_certificate'], {
      at: AT, actor: 'agent', baseDir, now: LATER,
    });
    expect(result.facts.conditions).toEqual(['financing', 'status_certificate']);
  });

  it('setFact accepts an empty array', () => {
    const created = create();
    const result = setFact(AGENT_ID, created.transactionId, 'conditions', [], {
      at: AT, actor: 'agent', baseDir, now: LATER,
    });
    expect(result.facts.conditions).toEqual([]);
  });

  it('setFact rejects null and writes nothing to disk', () => {
    const created = create();
    expect(() => setFact(AGENT_ID, created.transactionId, 'conditions', null, {
      at: AT, actor: 'agent', baseDir, now: LATER,
    })).toThrow('setFact: conditions must be an array, got null');

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.facts).toBeUndefined();
    expect(onDisk.events).toBeUndefined();
  });

  it('setFact rejects a bare string and writes nothing to disk', () => {
    const created = create();
    expect(() => setFact(AGENT_ID, created.transactionId, 'conditions', 'financing', {
      at: AT, actor: 'agent', baseDir, now: LATER,
    })).toThrow('setFact: conditions must be an array, got string');

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.facts).toBeUndefined();
    expect(onDisk.events).toBeUndefined();
  });

  it('setFact rejects an unknown condition name and writes nothing to disk', () => {
    const created = create();
    expect(() => setFact(AGENT_ID, created.transactionId, 'conditions', ['finnancing'], {
      at: AT, actor: 'agent', baseDir, now: LATER,
    })).toThrow("setFact: unknown condition 'finnancing'");

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.facts).toBeUndefined();
    expect(onDisk.events).toBeUndefined();
  });

  it('setFact rejects a non-string entry and writes nothing to disk', () => {
    const created = create();
    expect(() => setFact(AGENT_ID, created.transactionId, 'conditions', ['financing', 42], {
      at: AT, actor: 'agent', baseDir, now: LATER,
    })).toThrow('setFact: conditions entries must be strings, got number');

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.facts).toBeUndefined();
    expect(onDisk.events).toBeUndefined();
  });

  it('setFact rejects a duplicate condition name and writes nothing to disk', () => {
    const created = create();
    expect(() => setFact(AGENT_ID, created.transactionId, 'conditions', ['financing', 'financing'], {
      at: AT, actor: 'agent', baseDir, now: LATER,
    })).toThrow("setFact: duplicate condition 'financing'");

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.facts).toBeUndefined();
    expect(onDisk.events).toBeUndefined();
  });

  it('setFact validates conditions before reading the transaction: unknown condition beats not-found', () => {
    expect(() => setFact(AGENT_ID, 'txn-20260101-deadbeef', 'conditions', ['finnancing'], {
      at: AT, actor: 'agent', baseDir, now: LATER,
    })).toThrow("setFact: unknown condition 'finnancing'");
  });

  it('correctFact rejects an unknown condition name and leaves the stored value unchanged', () => {
    const created = create();
    const afterSet = setFact(AGENT_ID, created.transactionId, 'conditions', ['financing'], {
      at: AT, actor: 'agent', baseDir, now: LATER,
    });
    expect(() => correctFact(AGENT_ID, created.transactionId, 'conditions', ['finnancing'], {
      at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
    })).toThrow("correctFact: unknown condition 'finnancing'");

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.facts.conditions).toEqual(['financing']);
    expect(onDisk.events).toHaveLength(afterSet.events.length);
  });

  it('correctFact rejects null and leaves the stored value unchanged', () => {
    const created = create();
    const afterSet = setFact(AGENT_ID, created.transactionId, 'conditions', ['financing'], {
      at: AT, actor: 'agent', baseDir, now: LATER,
    });
    expect(() => correctFact(AGENT_ID, created.transactionId, 'conditions', null, {
      at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
    })).toThrow('correctFact: conditions must be an array, got null');

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.facts.conditions).toEqual(['financing']);
    expect(onDisk.events).toHaveLength(afterSet.events.length);
  });
});

describe('date facts', () => {
  describe('acceptedDate', () => {
    it('1. operator sets 2026-10-01 on buyer_purchase; stored value is 2026-10-01', () => {
      const created = create();
      const result = setFact(AGENT_ID, created.transactionId, 'acceptedDate', '2026-10-01', {
        at: AT, actor: 'operator', baseDir, now: LATER,
      });
      expect(result.facts.acceptedDate).toBe('2026-10-01');
    });

    it("2. rejects 2026-02-30 and writes nothing to disk", () => {
      const created = create();
      expect(() => setFact(AGENT_ID, created.transactionId, 'acceptedDate', '2026-02-30', {
        at: AT, actor: 'agent', baseDir, now: LATER,
      })).toThrow("setFact: acceptedDate must be a calendar date (YYYY-MM-DD), got '2026-02-30'");

      const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(onDisk.facts).toBeUndefined();
      expect(onDisk.events).toBeUndefined();
    });

    it('3. rejects null and writes nothing to disk', () => {
      const created = create();
      expect(() => setFact(AGENT_ID, created.transactionId, 'acceptedDate', null, {
        at: AT, actor: 'agent', baseDir, now: LATER,
      })).toThrow('setFact: acceptedDate must be a calendar date (YYYY-MM-DD), got null');

      const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(onDisk.facts).toBeUndefined();
      expect(onDisk.events).toBeUndefined();
    });

    it('4. rejected on seller_listing and writes nothing to disk', () => {
      const created = createTransaction(
        AGENT_ID,
        { type: 'seller_listing', state: 'preparing', address: '12 Main St' },
        { baseDir, now: CLOCK }
      );
      expect(() => setFact(AGENT_ID, created.transactionId, 'acceptedDate', '2026-10-01', {
        at: AT, actor: 'agent', baseDir, now: LATER,
      })).toThrow("setFact: acceptedDate is not permitted on type 'seller_listing'; a listing has no acceptance, its offers do");

      const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(onDisk.facts).toBeUndefined();
      expect(onDisk.events).toBeUndefined();
    });

    it('5. accepted on tenant_lease', () => {
      const created = createTransaction(
        AGENT_ID,
        { type: 'tenant_lease', state: 'accepted', address: '12 Main St' },
        { baseDir, now: CLOCK }
      );
      const result = setFact(AGENT_ID, created.transactionId, 'acceptedDate', '2026-10-01', {
        at: AT, actor: 'agent', baseDir, now: LATER,
      });
      expect(result.facts.acceptedDate).toBe('2026-10-01');
    });
  });

  describe('conditionDates', () => {
    it("6. after conditions ['financing'], sets { financing: '2026-10-06' }", () => {
      const created = create();
      setFact(AGENT_ID, created.transactionId, 'conditions', ['financing'], {
        at: AT, actor: 'agent', baseDir, now: LATER,
      });
      const result = setFact(AGENT_ID, created.transactionId, 'conditionDates', { financing: '2026-10-06' }, {
        at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
      });
      expect(result.facts.conditionDates).toEqual({ financing: '2026-10-06' });
    });

    it('7. accepts {} with no conditions set', () => {
      const created = create();
      const result = setFact(AGENT_ID, created.transactionId, 'conditionDates', {}, {
        at: AT, actor: 'agent', baseDir, now: LATER,
      });
      expect(result.facts.conditionDates).toEqual({});
    });

    it('8. rejects [] and writes nothing to disk', () => {
      const created = create();
      expect(() => setFact(AGENT_ID, created.transactionId, 'conditionDates', [], {
        at: AT, actor: 'agent', baseDir, now: LATER,
      })).toThrow('setFact: conditionDates must be an object mapping condition names to dates, got array');

      const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(onDisk.facts).toBeUndefined();
      expect(onDisk.events).toBeUndefined();
    });

    it('9. rejects null and writes nothing to disk', () => {
      const created = create();
      expect(() => setFact(AGENT_ID, created.transactionId, 'conditionDates', null, {
        at: AT, actor: 'agent', baseDir, now: LATER,
      })).toThrow('setFact: conditionDates must be an object mapping condition names to dates, got null');

      const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(onDisk.facts).toBeUndefined();
      expect(onDisk.events).toBeUndefined();
    });

    it("10. rejects { finnancing: '2026-10-06' } and writes nothing to disk", () => {
      const created = create();
      expect(() => setFact(AGENT_ID, created.transactionId, 'conditionDates', { finnancing: '2026-10-06' }, {
        at: AT, actor: 'agent', baseDir, now: LATER,
      })).toThrow("setFact: unknown condition 'finnancing' in conditionDates");

      const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(onDisk.facts).toBeUndefined();
      expect(onDisk.events).toBeUndefined();
    });

    it("11. after conditions ['financing'], rejects { financing: '2026-02-30' } and leaves the stored value unchanged", () => {
      const created = create();
      const afterConditions = setFact(AGENT_ID, created.transactionId, 'conditions', ['financing'], {
        at: AT, actor: 'agent', baseDir, now: LATER,
      });
      expect(() => setFact(AGENT_ID, created.transactionId, 'conditionDates', { financing: '2026-02-30' }, {
        at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
      })).toThrow('setFact: conditionDates.financing must be a calendar date');

      const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(onDisk.facts).toEqual({ conditions: ['financing'] });
      expect(onDisk.events).toHaveLength(afterConditions.events.length);
    });

    it("12. after conditions ['financing'], rejects { inspection: '2026-10-04' } and leaves the stored value unchanged", () => {
      const created = create();
      const afterConditions = setFact(AGENT_ID, created.transactionId, 'conditions', ['financing'], {
        at: AT, actor: 'agent', baseDir, now: LATER,
      });
      expect(() => setFact(AGENT_ID, created.transactionId, 'conditionDates', { inspection: '2026-10-04' }, {
        at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
      })).toThrow("setFact: conditionDates has a date for 'inspection', but this deal's conditions are [financing]");

      const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(onDisk.facts).toEqual({ conditions: ['financing'] });
      expect(onDisk.events).toHaveLength(afterConditions.events.length);
    });

    it("13. with no conditions set, rejects { financing: '2026-10-06' } and writes nothing to disk", () => {
      const created = create();
      expect(() => setFact(AGENT_ID, created.transactionId, 'conditionDates', { financing: '2026-10-06' }, {
        at: AT, actor: 'agent', baseDir, now: LATER,
      })).toThrow('setFact: set conditions before conditionDates');

      const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(onDisk.facts).toBeUndefined();
      expect(onDisk.events).toBeUndefined();
    });

    it('14. ordering: unknown condition beats not-found for a transaction id that does not exist', () => {
      expect(() => setFact(AGENT_ID, 'txn-20260101-deadbeef', 'conditionDates', { finnancing: '2026-10-06' }, {
        at: AT, actor: 'agent', baseDir, now: LATER,
      })).toThrow("setFact: unknown condition 'finnancing' in conditionDates");
    });
  });

  describe('additionalDepositDueDates', () => {
    it("15. accepts ['2026-11-01'] on seller_sale", () => {
      const created = createTransaction(
        AGENT_ID,
        { type: 'seller_sale', state: 'conditional', address: '12 Main St' },
        { baseDir, now: CLOCK }
      );
      const result = setFact(AGENT_ID, created.transactionId, 'additionalDepositDueDates', ['2026-11-01'], {
        at: AT, actor: 'agent', baseDir, now: LATER,
      });
      expect(result.facts.additionalDepositDueDates).toEqual(['2026-11-01']);
    });

    it('16. accepts [] on buyer_purchase', () => {
      const created = create();
      const result = setFact(AGENT_ID, created.transactionId, 'additionalDepositDueDates', [], {
        at: AT, actor: 'agent', baseDir, now: LATER,
      });
      expect(result.facts.additionalDepositDueDates).toEqual([]);
    });

    it("17. rejects ['2026-11-01', '2026-12-01'] and writes nothing to disk", () => {
      const created = create();
      expect(() => setFact(AGENT_ID, created.transactionId, 'additionalDepositDueDates', ['2026-11-01', '2026-12-01'], {
        at: AT, actor: 'agent', baseDir, now: LATER,
      })).toThrow('setFact: additionalDepositDueDates holds at most one date in v1; track a second additional deposit by hand');

      const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(onDisk.facts).toBeUndefined();
      expect(onDisk.events).toBeUndefined();
    });

    it("18. rejects ['2026-02-30'] and writes nothing to disk", () => {
      const created = create();
      expect(() => setFact(AGENT_ID, created.transactionId, 'additionalDepositDueDates', ['2026-02-30'], {
        at: AT, actor: 'agent', baseDir, now: LATER,
      })).toThrow("setFact: additionalDepositDueDates entries must be calendar dates (YYYY-MM-DD), got '2026-02-30'");

      const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(onDisk.facts).toBeUndefined();
      expect(onDisk.events).toBeUndefined();
    });

    it("19. rejects the bare string '2026-11-01' and writes nothing to disk", () => {
      const created = create();
      expect(() => setFact(AGENT_ID, created.transactionId, 'additionalDepositDueDates', '2026-11-01', {
        at: AT, actor: 'agent', baseDir, now: LATER,
      })).toThrow("setFact: additionalDepositDueDates must be an array of calendar dates, got '2026-11-01'");

      const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(onDisk.facts).toBeUndefined();
      expect(onDisk.events).toBeUndefined();
    });

    it('20. rejected on tenant_lease and writes nothing to disk', () => {
      const created = createTransaction(
        AGENT_ID,
        { type: 'tenant_lease', state: 'accepted', address: '12 Main St' },
        { baseDir, now: CLOCK }
      );
      expect(() => setFact(AGENT_ID, created.transactionId, 'additionalDepositDueDates', ['2026-11-01'], {
        at: AT, actor: 'agent', baseDir, now: LATER,
      })).toThrow("setFact: additionalDepositDueDates is not permitted on type 'tenant_lease'; additional deposits are tracked on sales only in v1, so track this one by hand");

      const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(onDisk.facts).toBeUndefined();
      expect(onDisk.events).toBeUndefined();
    });
  });

  describe('who may write dates', () => {
    it("21. setFact with actor 'system' is refused for acceptedDate", () => {
      const created = create();
      expect(() => setFact(AGENT_ID, created.transactionId, 'acceptedDate', '2026-10-01', {
        at: AT, actor: 'system', baseDir, now: LATER,
      })).toThrow("setFact: acceptedDate must be set by a person, not 'system'; extracted dates belong in a proposal, not a fact");

      const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(onDisk.facts).toBeUndefined();
      expect(onDisk.events).toBeUndefined();
    });

    it("22. setFact with actor 'system' is refused for conditionDates", () => {
      const created = create();
      expect(() => setFact(AGENT_ID, created.transactionId, 'conditionDates', {}, {
        at: AT, actor: 'system', baseDir, now: LATER,
      })).toThrow("setFact: conditionDates must be set by a person, not 'system'; extracted dates belong in a proposal, not a fact");

      const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(onDisk.facts).toBeUndefined();
      expect(onDisk.events).toBeUndefined();
    });

    it("23. setFact with actor 'system' is refused for additionalDepositDueDates", () => {
      const created = create();
      expect(() => setFact(AGENT_ID, created.transactionId, 'additionalDepositDueDates', [], {
        at: AT, actor: 'system', baseDir, now: LATER,
      })).toThrow("setFact: additionalDepositDueDates must be set by a person, not 'system'; extracted dates belong in a proposal, not a fact");

      const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(onDisk.facts).toBeUndefined();
      expect(onDisk.events).toBeUndefined();
    });

    it("24. setFact 'entityType' with actor 'system' is still accepted", () => {
      const created = create();
      const result = setFact(AGENT_ID, created.transactionId, 'entityType', 'individual', {
        at: AT, actor: 'system', baseDir, now: LATER,
      });
      expect(result.facts.entityType).toBe('individual');
    });
  });

  describe('correctFact', () => {
    it('25. after a valid acceptedDate, correctFact with 2026-02-30 is refused and the stored value is unchanged', () => {
      const created = create();
      const afterSet = setFact(AGENT_ID, created.transactionId, 'acceptedDate', '2026-10-01', {
        at: AT, actor: 'agent', baseDir, now: LATER,
      });
      expect(() => correctFact(AGENT_ID, created.transactionId, 'acceptedDate', '2026-02-30', {
        at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
      })).toThrow("correctFact: acceptedDate must be a calendar date (YYYY-MM-DD), got '2026-02-30'");

      const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(onDisk.facts.acceptedDate).toBe('2026-10-01');
      expect(onDisk.events).toHaveLength(afterSet.events.length);
    });

    it("26. after conditions ['financing'] and a valid conditionDates, correctFact with { inspection: '2026-10-04' } is refused and the stored value is unchanged", () => {
      const created = create();
      setFact(AGENT_ID, created.transactionId, 'conditions', ['financing'], {
        at: AT, actor: 'agent', baseDir, now: LATER,
      });
      const afterConditionDates = setFact(AGENT_ID, created.transactionId, 'conditionDates', { financing: '2026-10-06' }, {
        at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
      });
      expect(() => correctFact(AGENT_ID, created.transactionId, 'conditionDates', { inspection: '2026-10-04' }, {
        at: AT3, actor: 'agent', baseDir, now: EVEN_LATER,
      })).toThrow("correctFact: conditionDates has a date for 'inspection', but this deal's conditions are [financing]");

      const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(onDisk.facts.conditionDates).toEqual({ financing: '2026-10-06' });
      expect(onDisk.events).toHaveLength(afterConditionDates.events.length);
    });
  });
});
