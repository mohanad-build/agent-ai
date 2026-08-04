'use strict';

const { resolveChecklist, reResolve } = require('../src/transactions/resolver');
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
    const item = result.find((entry) => entry.id === 'ontario_standard_lease');
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

  it('marks srp_disclosure indeterminate for landlord_lease on empty facts', () => {
    const result = resolveChecklist('landlord_lease', {});
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

describe('lease item catalog (RTA replacement)', () => {
  it('resolves the exact tenant_lease id set', () => {
    const result = resolveChecklist('tenant_lease', {});
    const ids = result.map((entry) => entry.id);
    expect(ids).toEqual([
      'reco_information_guide',
      'srp_disclosure',
      'tenant_representation_agreement',
      'agreement_to_lease',
      'ontario_standard_lease',
      'signed_lease_copy_received',
      'deposit_obtained_from_tenant',
      'deposit_delivered_to_listing_agent',
      'brokerage_deposit_receipt_received',
      'first_month_rent_paid',
      'keys_received',
    ]);
  });

  it('resolves the exact landlord_lease id set', () => {
    const result = resolveChecklist('landlord_lease', {});
    const ids = result.map((entry) => entry.id);
    expect(ids).toEqual([
      'reco_information_guide',
      'srp_disclosure',
      'listing_agreement_lease',
      'agreement_to_lease',
      'ontario_standard_lease',
      'signed_lease_copy_delivered',
      'deposit_slip_received',
      'deposit_forwarded_to_accounting',
      'brokerage_deposit_receipt_issued',
      'first_month_rent_received',
      'keys_delivered',
    ]);
  });

  it('never presents a security or damage deposit item anywhere in the catalog', () => {
    const pattern = /security|damage/i;
    Object.keys(CATALOG).forEach((type) => {
      CATALOG[type].forEach((item) => {
        expect(pattern.test(item.id)).toBe(false);
        expect(pattern.test(item.label)).toBe(false);
      });
    });
  });

  it('no longer resolves last_month_rent_deposit for tenant_lease', () => {
    const result = resolveChecklist('tenant_lease', {});
    const ids = result.map((entry) => entry.id);
    expect(ids).not.toContain('last_month_rent_deposit');
  });

  it('listing_agreement_lease resolves for landlord_lease with scope transaction and no clientScope', () => {
    const result = resolveChecklist('landlord_lease', {});
    const item = result.find((entry) => entry.id === 'listing_agreement_lease');
    expect(item.scope).toBe('transaction');
    expect(item).not.toHaveProperty('clientScope');
  });

  it('tenant_representation_agreement resolves for tenant_lease with scope client and clientScope dated', () => {
    const result = resolveChecklist('tenant_lease', {});
    const item = result.find((entry) => entry.id === 'tenant_representation_agreement');
    expect(item.scope).toBe('client');
    expect(item.clientScope).toBe('dated');
  });

  it('no catalog entry anywhere still has id representation_agreement', () => {
    Object.keys(CATALOG).forEach((type) => {
      const ids = CATALOG[type].map((item) => item.id);
      expect(ids).not.toContain('representation_agreement');
    });
  });

  it('resolves the exact seller_sale id set', () => {
    const result = resolveChecklist('seller_sale', {});
    const ids = result.map((entry) => entry.id);
    expect(ids).toEqual(['reco_information_guide', 'srp_disclosure', 'listing_agreement']);
  });

  it('listing_agreement resolves for seller_sale with scope transaction and no clientScope', () => {
    const result = resolveChecklist('seller_sale', {});
    const item = result.find((entry) => entry.id === 'listing_agreement');
    expect(item.scope).toBe('transaction');
    expect(item).not.toHaveProperty('clientScope');
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

describe('reResolve', () => {
  const previousItems = [
    {
      id: 'reco_information_guide',
      label: 'RECO Information Guide',
      source: 'TRESA',
      scope: 'client',
      clientScope: 'event',
      evidence: 'attestation',
      reads: [],
      applicability: 'required',
      completed: true,
      completedAt: '2026-01-05T12:00:00Z',
      documents: ['guide.pdf'],
    },
    {
      id: 'buyer_representation_agreement',
      label: 'Buyer Representation Agreement',
      source: 'TRESA',
      scope: 'client',
      clientScope: 'dated',
      evidence: 'document',
      reads: [],
      applicability: 'required',
      completed: false,
    },
    {
      id: 'srp_disclosure',
      label: 'Self-Represented Party Disclosure',
      source: 'TRESA',
      scope: 'transaction',
      evidence: 'document',
      reads: ['hasSelfRepresentedParty'],
      notApplicableReason: 'No self-represented party on this transaction',
      applicability: 'not_applicable',
      reason: 'stale reason from a previous resolution',
    },
    {
      id: 'last_month_rent_deposit',
      label: 'Last Month Rent Deposit',
      source: 'RTA',
      scope: 'transaction',
      evidence: 'document',
      reads: [],
      applicability: 'required',
      completed: true,
      documents: ['lmr-receipt.pdf'],
    },
  ];

  const facts = { entityType: 'individual', hasSelfRepresentedParty: true };

  it('throws with the reResolve prefix when previousItems is not an array', () => {
    expect(() => reResolve('nope', 'buyer_purchase', facts)).toThrow(/reResolve:/);
  });

  it('keeps completed, completedAt, and documents for an item present in both sets', () => {
    const result = reResolve(previousItems, 'buyer_purchase', facts);
    const item = result.find((entry) => entry.id === 'reco_information_guide');
    expect(item.completed).toBe(true);
    expect(item.completedAt).toBe('2026-01-05T12:00:00Z');
    expect(item.documents).toEqual(['guide.pdf']);
  });

  it('takes applicability and reason from the new resolution, not the old one', () => {
    const result = reResolve(previousItems, 'buyer_purchase', facts);
    const item = result.find((entry) => entry.id === 'srp_disclosure');
    expect(item.applicability).toBe('required');
    expect(item).not.toHaveProperty('reason');
  });

  it('an item only in the new set carries no state fields', () => {
    const result = reResolve(previousItems, 'buyer_purchase', facts);
    const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
    expect(item).not.toHaveProperty('completed');
    expect(item).not.toHaveProperty('completedAt');
    expect(item).not.toHaveProperty('documents');
  });

  it('keeps a dropped item in the result as no_longer_applicable with its state intact', () => {
    const result = reResolve(previousItems, 'buyer_purchase', facts);
    const item = result.find((entry) => entry.id === 'last_month_rent_deposit');
    expect(item).toBeDefined();
    expect(item.applicability).toBe('no_longer_applicable');
    expect(item.completed).toBe(true);
    expect(item.documents).toEqual(['lmr-receipt.pdf']);
    expect(item.reason).toMatch(/buyer_purchase/);
  });

  it('produces an identical result when re-resolved again, with no duplicated no_longer_applicable entries', () => {
    const first = reResolve(previousItems, 'buyer_purchase', facts);
    const second = reResolve(first, 'buyer_purchase', facts);
    expect(second).toEqual(first);
    const noLongerApplicable = second.filter((entry) => entry.applicability === 'no_longer_applicable');
    expect(noLongerApplicable.length).toBe(1);
  });

  it('equals resolveChecklist when previousItems is empty', () => {
    const result = reResolve([], 'buyer_purchase', facts);
    expect(result).toEqual(resolveChecklist('buyer_purchase', facts));
  });

  it('orders the new set in catalog order first, then no_longer_applicable items in previousItems order', () => {
    const result = reResolve(previousItems, 'buyer_purchase', facts);
    const ids = result.map((entry) => entry.id);
    const catalogIds = CATALOG.buyer_purchase.map((item) => item.id);
    expect(ids.slice(0, catalogIds.length)).toEqual(catalogIds);
    expect(ids.slice(catalogIds.length)).toEqual(['last_month_rent_deposit']);
  });
});
