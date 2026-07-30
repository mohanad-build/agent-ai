'use strict';

const { resolveChecklist } = require('../src/transactions/resolver');
const { CATALOG } = require('../src/transactions/rules');

const TYPES = Object.keys(CATALOG);

const VALID_SOURCES = new Set(['TRESA', 'FINTRAC', 'RTA', 'APS', 'brokerage', 'agent']);

describe('resolveChecklist', () => {
  it('throws for an unknown type', () => {
    expect(() => resolveChecklist('not_a_type', {})).toThrow(/resolveChecklist: unknown type/);
  });

  it('throws for a missing type', () => {
    expect(() => resolveChecklist(undefined, {})).toThrow(/resolveChecklist: unknown type/);
  });

  it('throws for a non-string type', () => {
    expect(() => resolveChecklist(123, {})).toThrow(/resolveChecklist: unknown type/);
  });

  it('throws when facts is missing', () => {
    expect(() => resolveChecklist('buyer_purchase')).toThrow(/resolveChecklist:/);
  });

  it('throws when facts is null', () => {
    expect(() => resolveChecklist('buyer_purchase', null)).toThrow(/resolveChecklist:/);
  });

  it('throws when facts is not an object', () => {
    expect(() => resolveChecklist('buyer_purchase', 'nope')).toThrow(/resolveChecklist:/);
  });

  it('returns every catalog item for the type, annotated', () => {
    const result = resolveChecklist('tenant_lease', {});
    expect(result.length).toBe(CATALOG.tenant_lease.length);
    result.forEach((entry) => {
      expect(entry).toHaveProperty('applicability');
    });
  });

  it('marks an item with no requiredWhen as required', () => {
    const result = resolveChecklist('tenant_lease', {});
    const item = result.find((entry) => entry.id === 'last_month_rent_deposit');
    expect(item.applicability).toBe('required');
    expect(item).not.toHaveProperty('reason');
  });

  it('marks an item as indeterminate when a read fact is missing entirely', () => {
    const result = resolveChecklist('buyer_purchase', {});
    const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
    expect(item.applicability).toBe('indeterminate');
    expect(item.pendingFacts).toEqual(['entityType']);
    expect(item.reason).toMatch(/entityType/);
  });

  it('marks an item as indeterminate when a read fact is explicitly undefined', () => {
    const result = resolveChecklist('buyer_purchase', { entityType: undefined });
    const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
    expect(item.applicability).toBe('indeterminate');
    expect(item.pendingFacts).toEqual(['entityType']);
  });

  it('treats a null fact value as present, not missing', () => {
    const result = resolveChecklist('buyer_purchase', { entityType: null });
    const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
    expect(item.applicability).toBe('not_applicable');
  });

  it('marks an item not_applicable when requiredWhen evaluates false, with the catalog reason', () => {
    const result = resolveChecklist('buyer_purchase', { entityType: 'individual' });
    const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
    expect(item.applicability).toBe('not_applicable');
    expect(item.reason).toBe('Entity type is not a corporation');
  });

  it('marks an item required when requiredWhen evaluates true, with no reason key', () => {
    const result = resolveChecklist('buyer_purchase', { entityType: 'corporation' });
    const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
    expect(item.applicability).toBe('required');
    expect(item).not.toHaveProperty('reason');
  });

  it('names the missing read in pendingFacts for a single-read item', () => {
    const result = resolveChecklist('buyer_purchase', {});
    const item = result.find((entry) => entry.id === 'srp_disclosure');
    expect(item.applicability).toBe('indeterminate');
    expect(item.pendingFacts).toEqual(['hasSelfRepresentedParty']);
  });
});

describe('structural invariants (iterate the catalog, do not hardcode)', () => {
  it('S1: every item has a non-empty id, label, source, scope, evidence', () => {
    TYPES.forEach((type) => {
      CATALOG[type].forEach((item) => {
        expect(typeof item.id).toBe('string');
        expect(item.id.trim()).not.toBe('');
        expect(typeof item.label).toBe('string');
        expect(item.label.trim()).not.toBe('');
        expect(typeof item.source).toBe('string');
        expect(item.source.trim()).not.toBe('');
        expect(typeof item.scope).toBe('string');
        expect(item.scope.trim()).not.toBe('');
        expect(typeof item.evidence).toBe('string');
        expect(item.evidence.trim()).not.toBe('');
      });
    });
  });

  it('S2: source is one of the six allowed values', () => {
    TYPES.forEach((type) => {
      CATALOG[type].forEach((item) => {
        expect(VALID_SOURCES.has(item.source)).toBe(true);
      });
    });
  });

  it('S3: clientScope is present if and only if scope is client', () => {
    TYPES.forEach((type) => {
      CATALOG[type].forEach((item) => {
        if (item.scope === 'client') {
          expect(item.clientScope).toBeDefined();
        } else {
          expect(item).not.toHaveProperty('clientScope');
        }
      });
    });
  });

  it('S4: externalSystem is present if and only if evidence is external_system', () => {
    TYPES.forEach((type) => {
      CATALOG[type].forEach((item) => {
        if (item.evidence === 'external_system') {
          expect(item.externalSystem).toBeDefined();
        } else {
          expect(item).not.toHaveProperty('externalSystem');
        }
      });
    });
  });

  it('S5: notApplicableReason is present if and only if requiredWhen is present', () => {
    TYPES.forEach((type) => {
      CATALOG[type].forEach((item) => {
        if (Object.prototype.hasOwnProperty.call(item, 'requiredWhen')) {
          expect(typeof item.notApplicableReason).toBe('string');
          expect(item.notApplicableReason.trim()).not.toBe('');
        } else {
          expect(item).not.toHaveProperty('notApplicableReason');
        }
      });
    });
  });

  it('S6: ids are unique within a type', () => {
    TYPES.forEach((type) => {
      const ids = CATALOG[type].map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  it('S7: the catalog is frozen', () => {
    expect(Object.isFrozen(CATALOG)).toBe(true);
    TYPES.forEach((type) => {
      expect(Object.isFrozen(CATALOG[type])).toBe(true);
      CATALOG[type].forEach((item) => {
        expect(Object.isFrozen(item)).toBe(true);
      });
    });
  });
});

describe('locked spec content', () => {
  it('never returns fewer items than the type catalog length, for any facts input including {}', () => {
    TYPES.forEach((type) => {
      expect(resolveChecklist(type, {}).length).toBe(CATALOG[type].length);
      expect(
        resolveChecklist(type, { entityType: 'corporation', hasSelfRepresentedParty: true }).length
      ).toBe(CATALOG[type].length);
    });
  });

  it('the corporation record resolves indeterminate on {} and names entityType in pendingFacts', () => {
    const result = resolveChecklist('buyer_purchase', {});
    const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
    expect(item.applicability).toBe('indeterminate');
    expect(item.pendingFacts).toEqual(['entityType']);
  });

  it('resolves not_applicable on entityType individual', () => {
    const result = resolveChecklist('buyer_purchase', { entityType: 'individual' });
    const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
    expect(item.applicability).toBe('not_applicable');
  });

  it('resolves required on entityType corporation', () => {
    const result = resolveChecklist('buyer_purchase', { entityType: 'corporation' });
    const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
    expect(item.applicability).toBe('required');
  });

  it('an item resolved required has no reason key at all', () => {
    const result = resolveChecklist('tenant_lease', {});
    result
      .filter((entry) => entry.applicability === 'required')
      .forEach((entry) => {
        expect(entry).not.toHaveProperty('reason');
      });
  });

  it('no item id or label in the entire catalog matches security deposit or damage deposit', () => {
    const pattern = /security deposit|damage deposit/i;
    TYPES.forEach((type) => {
      CATALOG[type].forEach((item) => {
        expect(pattern.test(item.id)).toBe(false);
        expect(pattern.test(item.label)).toBe(false);
      });
    });
  });
});
