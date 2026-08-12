'use strict';

const { resolveChecklist, reResolve } = require('../src/transactions/resolver');
const { CATALOG } = require('../src/transactions/rules');
const { getStates } = require('../src/transactions/states');

const TYPES = Object.keys(CATALOG);

// The four types that carry the deal-only universal items (deal_sheet,
// srp_disclosure) and the collapsed/mutual_release terminal machinery. The
// listing types (seller_listing, landlord_listing) are non-deal records and
// have neither, so tests exercising those must scope to this list explicitly
// rather than iterating TYPES, which would try 'collapsed' as a state that
// doesn't exist for the listing types.
const DEAL_TYPES = ['buyer_purchase', 'seller_sale', 'tenant_lease', 'landlord_lease'];

const VALID_SOURCES = new Set(['TRESA', 'FINTRAC', 'RTA', 'APS', 'brokerage', 'agent']);

// A representative non-collapsed state per type, for tests that need a valid
// state but aren't exercising state-dependent behavior themselves.
const NON_COLLAPSED_STATE = {
  buyer_purchase: 'conditional',
  seller_sale: 'live',
  tenant_lease: 'accepted',
  landlord_lease: 'live',
  seller_listing: 'live',
  landlord_listing: 'live',
};

describe('resolveChecklist', () => {
  it('throws for an unknown type', () => {
    expect(() => resolveChecklist('not_a_type', 'conditional', {})).toThrow(/resolveChecklist: unknown type/);
  });

  it('throws for a missing type', () => {
    expect(() => resolveChecklist(undefined, 'conditional', {})).toThrow(/resolveChecklist: unknown type/);
  });

  it('throws for a non-string type', () => {
    expect(() => resolveChecklist(123, 'conditional', {})).toThrow(/resolveChecklist: unknown type/);
  });

  it('throws for an unknown state', () => {
    expect(() => resolveChecklist('buyer_purchase', 'not_a_real_state', {})).toThrow(
      /resolveChecklist: unknown state 'not_a_real_state' for type 'buyer_purchase'/
    );
  });

  it('throws when facts is missing', () => {
    expect(() => resolveChecklist('buyer_purchase', 'conditional')).toThrow(/resolveChecklist:/);
  });

  it('throws when facts is null', () => {
    expect(() => resolveChecklist('buyer_purchase', 'conditional', null)).toThrow(/resolveChecklist:/);
  });

  it('throws when facts is not an object', () => {
    expect(() => resolveChecklist('buyer_purchase', 'conditional', 'nope')).toThrow(/resolveChecklist:/);
  });

  it('returns every non-terminal-only catalog item for the type, annotated', () => {
    const result = resolveChecklist('tenant_lease', 'accepted', {});
    const expectedLength = CATALOG.tenant_lease.filter((item) => !item.terminalOnly).length;
    expect(result.length).toBe(expectedLength);
    result.forEach((entry) => {
      expect(entry).toHaveProperty('applicability');
    });
  });

  it('marks an item with no requiredWhen as required', () => {
    const result = resolveChecklist('tenant_lease', 'accepted', {});
    const item = result.find((entry) => entry.id === 'ontario_standard_lease');
    expect(item.applicability).toBe('required');
    expect(item).not.toHaveProperty('reason');
  });

  it('marks an item as indeterminate when a read fact is missing entirely', () => {
    const result = resolveChecklist('buyer_purchase', 'conditional', {});
    const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
    expect(item.applicability).toBe('indeterminate');
    expect(item.pendingFacts).toEqual(['entityType']);
    expect(item.reason).toMatch(/entityType/);
  });

  it('marks an item as indeterminate when a read fact is explicitly undefined', () => {
    const result = resolveChecklist('buyer_purchase', 'conditional', { entityType: undefined });
    const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
    expect(item.applicability).toBe('indeterminate');
    expect(item.pendingFacts).toEqual(['entityType']);
  });

  it('treats a null fact value as present, not missing', () => {
    const result = resolveChecklist('buyer_purchase', 'conditional', { entityType: null });
    const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
    expect(item.applicability).toBe('not_applicable');
  });

  it('marks an item not_applicable when requiredWhen evaluates false, with the catalog reason', () => {
    const result = resolveChecklist('buyer_purchase', 'conditional', { entityType: 'individual' });
    const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
    expect(item.applicability).toBe('not_applicable');
    expect(item.reason).toBe('Entity type is not a corporation');
  });

  it('marks an item required when requiredWhen evaluates true, with no reason key', () => {
    const result = resolveChecklist('buyer_purchase', 'conditional', { entityType: 'corporation' });
    const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
    expect(item.applicability).toBe('required');
    expect(item).not.toHaveProperty('reason');
  });

  it('names the missing read in pendingFacts for a single-read item', () => {
    const result = resolveChecklist('buyer_purchase', 'conditional', {});
    const item = result.find((entry) => entry.id === 'srp_disclosure');
    expect(item.applicability).toBe('indeterminate');
    expect(item.pendingFacts).toEqual(['hasSelfRepresentedParty']);
  });

  it('marks srp_disclosure indeterminate for landlord_lease on empty facts', () => {
    const result = resolveChecklist('landlord_lease', 'live', {});
    const item = result.find((entry) => entry.id === 'srp_disclosure');
    expect(item.applicability).toBe('indeterminate');
    expect(item.pendingFacts).toEqual(['hasSelfRepresentedParty']);
  });

  it('emits neither satisfiedPersons nor outstandingPersons when representedPersons is absent', () => {
    const result = resolveChecklist('buyer_purchase', 'conditional', {});
    const item = result.find((entry) => entry.id === 'reco_information_guide');
    expect(item).not.toHaveProperty('satisfiedPersons');
    expect(item).not.toHaveProperty('outstandingPersons');
  });

  it('treats everyone as outstanding when clientSatisfactions is absent', () => {
    const result = resolveChecklist('buyer_purchase', 'conditional', { representedPersons: ['alice', 'bob'] });
    const item = result.find((entry) => entry.id === 'reco_information_guide');
    expect(item.satisfiedPersons).toEqual([]);
    expect(item.outstandingPersons).toEqual(['alice', 'bob']);
  });

  it('partitions representedPersons into satisfiedPersons and outstandingPersons for a genuine partial', () => {
    const result = resolveChecklist('buyer_purchase', 'conditional', {
      representedPersons: ['alice', 'bob'],
      clientSatisfactions: { alice: { reco_information_guide: { signedAt: '2026-01-05' } } },
    });
    const item = result.find((entry) => entry.id === 'reco_information_guide');
    expect(item.satisfiedPersons).toEqual(['alice']);
    expect(item.outstandingPersons).toEqual(['bob']);
  });

  it('partitions representedPersons for the FINTRAC individual identification record and third party determination', () => {
    const result = resolveChecklist('buyer_purchase', 'conditional', {
      representedPersons: ['alice', 'bob'],
      clientSatisfactions: {
        alice: {
          fintrac_individual_identification_record: { verifiedAt: '2026-01-05' },
          fintrac_third_party_determination: { verifiedAt: '2026-01-05' },
        },
      },
    });
    const individualRecord = result.find((entry) => entry.id === 'fintrac_individual_identification_record');
    expect(individualRecord.satisfiedPersons).toEqual(['alice']);
    expect(individualRecord.outstandingPersons).toEqual(['bob']);
    const thirdPartyDetermination = result.find((entry) => entry.id === 'fintrac_third_party_determination');
    expect(thirdPartyDetermination.satisfiedPersons).toEqual(['alice']);
    expect(thirdPartyDetermination.outstandingPersons).toEqual(['bob']);
  });

  it('preserves representedPersons input order within satisfiedPersons and outstandingPersons', () => {
    const result = resolveChecklist('buyer_purchase', 'conditional', {
      representedPersons: ['zoe', 'amy', 'mike'],
      clientSatisfactions: {
        zoe: { reco_information_guide: {} },
        mike: { reco_information_guide: {} },
      },
    });
    const item = result.find((entry) => entry.id === 'reco_information_guide');
    expect(item.satisfiedPersons).toEqual(['zoe', 'mike']);
    expect(item.outstandingPersons).toEqual(['amy']);
  });

  it('emits both fields as empty arrays when representedPersons is an empty array', () => {
    const result = resolveChecklist('buyer_purchase', 'conditional', { representedPersons: [] });
    const item = result.find((entry) => entry.id === 'reco_information_guide');
    expect(item.satisfiedPersons).toEqual([]);
    expect(item.outstandingPersons).toEqual([]);
  });

  it('does not add satisfiedPersons or outstandingPersons to a scope transaction item', () => {
    const result = resolveChecklist('buyer_purchase', 'conditional', {
      representedPersons: ['alice'],
      clientSatisfactions: { alice: { deal_sheet: {} } },
    });
    const item = result.find((entry) => entry.id === 'deal_sheet');
    expect(item).not.toHaveProperty('satisfiedPersons');
    expect(item).not.toHaveProperty('outstandingPersons');
  });

  it('does not add satisfiedPersons or outstandingPersons to a clientScope dated item', () => {
    const result = resolveChecklist('buyer_purchase', 'conditional', {
      representedPersons: ['alice'],
      clientSatisfactions: { alice: { buyer_representation_agreement: {} } },
    });
    const item = result.find((entry) => entry.id === 'buyer_representation_agreement');
    expect(item).not.toHaveProperty('satisfiedPersons');
    expect(item).not.toHaveProperty('outstandingPersons');
  });

  it('throws when representedPersons is present and not an array', () => {
    expect(() => resolveChecklist('buyer_purchase', 'conditional', { representedPersons: 'alice' })).toThrow(
      /resolveChecklist: representedPersons must be an array/
    );
  });

  it('throws when clientSatisfactions is present and not a non-null object', () => {
    expect(() => resolveChecklist('buyer_purchase', 'conditional', { clientSatisfactions: 'alice' })).toThrow(
      /resolveChecklist: clientSatisfactions must be a non-null object/
    );
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
    const result = resolveChecklist('tenant_lease', 'accepted', {});
    const ids = result.map((entry) => entry.id);
    expect(ids).toEqual([
      'reco_information_guide',
      'srp_disclosure',
      'deal_sheet',
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
    const result = resolveChecklist('landlord_lease', 'live', {});
    const ids = result.map((entry) => entry.id);
    expect(ids).toEqual([
      'reco_information_guide',
      'srp_disclosure',
      'deal_sheet',
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
    const result = resolveChecklist('tenant_lease', 'accepted', {});
    const ids = result.map((entry) => entry.id);
    expect(ids).not.toContain('last_month_rent_deposit');
  });

  it('listing_agreement_lease resolves for landlord_lease with scope transaction and no clientScope', () => {
    const result = resolveChecklist('landlord_lease', 'live', {});
    const item = result.find((entry) => entry.id === 'listing_agreement_lease');
    expect(item.scope).toBe('transaction');
    expect(item).not.toHaveProperty('clientScope');
  });

  it('tenant_representation_agreement resolves for tenant_lease with scope client and clientScope dated', () => {
    const result = resolveChecklist('tenant_lease', 'accepted', {});
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
    const result = resolveChecklist('seller_sale', 'live', {});
    const ids = result.map((entry) => entry.id);
    expect(ids).toEqual([
      'reco_information_guide',
      'srp_disclosure',
      'deal_sheet',
      'listing_agreement',
      'fintrac_corporation_identification_record',
      'fintrac_articles_of_incorporation',
      'fintrac_individual_identification_record',
      'fintrac_third_party_determination',
      'fintrac_receipt_of_funds_record',
      'fintrac_unrepresented_party_record',
      'financing_condition',
      'inspection_condition',
      'sale_of_property_condition',
      'solicitor_approval_condition',
      'insurance_condition',
      'well_septic_condition',
      'status_certificate_receipt',
      'status_certificate_review',
    ]);
  });

  it('resolves the exact buyer_purchase id set', () => {
    const result = resolveChecklist('buyer_purchase', 'conditional', {});
    const ids = result.map((entry) => entry.id);
    expect(ids).toEqual([
      'reco_information_guide',
      'srp_disclosure',
      'deal_sheet',
      'buyer_representation_agreement',
      'fintrac_corporation_identification_record',
      'fintrac_articles_of_incorporation',
      'fintrac_individual_identification_record',
      'fintrac_third_party_determination',
      'fintrac_receipt_of_funds_record',
      'fintrac_unrepresented_party_record',
      'financing_condition',
      'inspection_condition',
      'sale_of_property_condition',
      'solicitor_approval_condition',
      'insurance_condition',
      'well_septic_condition',
      'status_certificate_receipt',
      'status_certificate_review',
    ]);
  });

  it('listing_agreement resolves for seller_sale with scope transaction and no clientScope', () => {
    const result = resolveChecklist('seller_sale', 'live', {});
    const item = result.find((entry) => entry.id === 'listing_agreement');
    expect(item.scope).toBe('transaction');
    expect(item).not.toHaveProperty('clientScope');
  });

  it('resolves deal_sheet as required on all four deal types with empty facts', () => {
    DEAL_TYPES.forEach((type) => {
      const result = resolveChecklist(type, NON_COLLAPSED_STATE[type], {});
      const item = result.find((entry) => entry.id === 'deal_sheet');
      expect(item.applicability).toBe('required');
    });
  });

  it('resolves no item with source FINTRAC for either lease type, since FINTRAC does not apply to leases', () => {
    const tenantResult = resolveChecklist('tenant_lease', 'accepted', {});
    expect(tenantResult.some((entry) => entry.source === 'FINTRAC')).toBe(false);
    const landlordResult = resolveChecklist('landlord_lease', 'live', {});
    expect(landlordResult.some((entry) => entry.source === 'FINTRAC')).toBe(false);
  });
});

describe('listing item catalog (seller_listing, landlord_listing)', () => {
  it('resolves the exact seller_listing id set', () => {
    const result = resolveChecklist('seller_listing', 'live', {});
    const ids = result.map((entry) => entry.id);
    expect(ids).toEqual(['reco_information_guide', 'listing_agreement']);
  });

  it('resolves the exact landlord_listing id set', () => {
    const result = resolveChecklist('landlord_listing', 'live', {});
    const ids = result.map((entry) => entry.id);
    expect(ids).toEqual(['reco_information_guide', 'listing_agreement_lease']);
  });

  it('resolves no item with source FINTRAC for either listing type', () => {
    const sellerResult = resolveChecklist('seller_listing', 'live', {});
    expect(sellerResult.some((entry) => entry.source === 'FINTRAC')).toBe(false);
    const landlordResult = resolveChecklist('landlord_listing', 'live', {});
    expect(landlordResult.some((entry) => entry.source === 'FINTRAC')).toBe(false);
  });

  it('resolves the identical id set at both initial states, preparing and live', () => {
    const preparingIds = resolveChecklist('seller_listing', 'preparing', {}).map((entry) => entry.id);
    const liveIds = resolveChecklist('seller_listing', 'live', {}).map((entry) => entry.id);
    expect(preparingIds).toEqual(liveIds);
  });
});

describe('terminal items (mutual_release)', () => {
  it('is absent from the resolved set on every non-collapsed state, for every type', () => {
    TYPES.forEach((type) => {
      getStates(type)
        .filter((state) => state !== 'collapsed')
        .forEach((state) => {
          const result = resolveChecklist(type, state, {});
          expect(result.some((entry) => entry.id === 'mutual_release')).toBe(false);
        });
    });
  });

  it('is present and required when state is collapsed, for all four deal types', () => {
    DEAL_TYPES.forEach((type) => {
      const result = resolveChecklist(type, 'collapsed', {});
      const item = result.find((entry) => entry.id === 'mutual_release');
      expect(item).toBeDefined();
      expect(item.applicability).toBe('required');
    });
  });

  it('resolves the exact tenant_lease id set at state collapsed, with mutual_release appended', () => {
    const result = resolveChecklist('tenant_lease', 'collapsed', {});
    const ids = result.map((entry) => entry.id);
    expect(ids).toEqual([
      'reco_information_guide',
      'srp_disclosure',
      'deal_sheet',
      'tenant_representation_agreement',
      'agreement_to_lease',
      'ontario_standard_lease',
      'signed_lease_copy_received',
      'deposit_obtained_from_tenant',
      'deposit_delivered_to_listing_agent',
      'brokerage_deposit_receipt_received',
      'first_month_rent_paid',
      'keys_received',
      'mutual_release',
    ]);
  });

  it('resolves the exact landlord_lease id set at state collapsed, with mutual_release appended', () => {
    const result = resolveChecklist('landlord_lease', 'collapsed', {});
    const ids = result.map((entry) => entry.id);
    expect(ids).toEqual([
      'reco_information_guide',
      'srp_disclosure',
      'deal_sheet',
      'listing_agreement_lease',
      'agreement_to_lease',
      'ontario_standard_lease',
      'signed_lease_copy_delivered',
      'deposit_slip_received',
      'deposit_forwarded_to_accounting',
      'brokerage_deposit_receipt_issued',
      'first_month_rent_received',
      'keys_delivered',
      'mutual_release',
    ]);
  });

  it('resolves the exact seller_sale id set at state collapsed, with mutual_release appended', () => {
    const result = resolveChecklist('seller_sale', 'collapsed', {});
    const ids = result.map((entry) => entry.id);
    expect(ids).toEqual([
      'reco_information_guide',
      'srp_disclosure',
      'deal_sheet',
      'listing_agreement',
      'fintrac_corporation_identification_record',
      'fintrac_articles_of_incorporation',
      'fintrac_individual_identification_record',
      'fintrac_third_party_determination',
      'fintrac_receipt_of_funds_record',
      'fintrac_unrepresented_party_record',
      'financing_condition',
      'inspection_condition',
      'sale_of_property_condition',
      'solicitor_approval_condition',
      'insurance_condition',
      'well_septic_condition',
      'status_certificate_receipt',
      'status_certificate_review',
      'mutual_release',
    ]);
  });

  it('resolves the exact buyer_purchase id set at state collapsed, with mutual_release appended', () => {
    const result = resolveChecklist('buyer_purchase', 'collapsed', {});
    const ids = result.map((entry) => entry.id);
    expect(ids).toEqual([
      'reco_information_guide',
      'srp_disclosure',
      'deal_sheet',
      'buyer_representation_agreement',
      'fintrac_corporation_identification_record',
      'fintrac_articles_of_incorporation',
      'fintrac_individual_identification_record',
      'fintrac_third_party_determination',
      'fintrac_receipt_of_funds_record',
      'fintrac_unrepresented_party_record',
      'financing_condition',
      'inspection_condition',
      'sale_of_property_condition',
      'solicitor_approval_condition',
      'insurance_condition',
      'well_septic_condition',
      'status_certificate_receipt',
      'status_certificate_review',
      'mutual_release',
    ]);
  });

  it('no item in any catalog has an id containing deposit_disposition', () => {
    TYPES.forEach((type) => {
      CATALOG[type].forEach((item) => {
        expect(item.id).not.toMatch(/deposit_disposition/);
      });
    });
  });
});

describe('locked spec content', () => {
  it('returns exactly the non-terminal-only catalog items for the type at a non-collapsed state, for any facts input including {}', () => {
    DEAL_TYPES.forEach((type) => {
      const state = NON_COLLAPSED_STATE[type];
      const expectedLength = CATALOG[type].filter((item) => !item.terminalOnly).length;
      expect(resolveChecklist(type, state, {}).length).toBe(expectedLength);
      expect(
        resolveChecklist(type, state, { entityType: 'corporation', hasSelfRepresentedParty: true }).length
      ).toBe(expectedLength);
    });
  });

  it('returns the full catalog length for the type at state collapsed, for any facts input including {}', () => {
    DEAL_TYPES.forEach((type) => {
      expect(resolveChecklist(type, 'collapsed', {}).length).toBe(CATALOG[type].length);
      expect(
        resolveChecklist(type, 'collapsed', { entityType: 'corporation', hasSelfRepresentedParty: true }).length
      ).toBe(CATALOG[type].length);
    });
  });

  it('the corporation record resolves indeterminate on {} and names entityType in pendingFacts', () => {
    const result = resolveChecklist('buyer_purchase', 'conditional', {});
    const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
    expect(item.applicability).toBe('indeterminate');
    expect(item.pendingFacts).toEqual(['entityType']);
  });

  it('resolves not_applicable on entityType individual', () => {
    const result = resolveChecklist('buyer_purchase', 'conditional', { entityType: 'individual' });
    const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
    expect(item.applicability).toBe('not_applicable');
  });

  it('resolves required on entityType corporation', () => {
    const result = resolveChecklist('buyer_purchase', 'conditional', { entityType: 'corporation' });
    const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
    expect(item.applicability).toBe('required');
  });

  // Spec 5.3: every FINTRAC item lives only in the Fintracker app, there is no
  // document evidence and there never will be.
  it('every FINTRAC item on buyer_purchase carries externalSystem Fintracker and evidence external_system', () => {
    const fintracItems = CATALOG.buyer_purchase.filter((item) => item.source === 'FINTRAC');
    expect(fintracItems.length).toBeGreaterThan(0);
    fintracItems.forEach((item) => {
      expect(item.evidence).toBe('external_system');
      expect(item.externalSystem).toBe('Fintracker');
    });
  });

  it('the receipt of funds record resolves required on buyer_purchase with an empty facts object', () => {
    const result = resolveChecklist('buyer_purchase', 'conditional', {});
    const item = result.find((entry) => entry.id === 'fintrac_receipt_of_funds_record');
    expect(item.applicability).toBe('required');
    expect(item).not.toHaveProperty('reason');
  });

  it('the unrepresented party record resolves not_applicable, required, or indeterminate based on hasSelfRepresentedParty', () => {
    const absent = resolveChecklist('buyer_purchase', 'conditional', {});
    const absentItem = absent.find((entry) => entry.id === 'fintrac_unrepresented_party_record');
    expect(absentItem.applicability).toBe('indeterminate');
    expect(absentItem.pendingFacts).toEqual(['hasSelfRepresentedParty']);

    const falseResult = resolveChecklist('buyer_purchase', 'conditional', { hasSelfRepresentedParty: false });
    const falseItem = falseResult.find((entry) => entry.id === 'fintrac_unrepresented_party_record');
    expect(falseItem.applicability).toBe('not_applicable');
    expect(falseItem.reason).toBe('No self-represented party on this transaction');

    const trueResult = resolveChecklist('buyer_purchase', 'conditional', { hasSelfRepresentedParty: true });
    const trueItem = trueResult.find((entry) => entry.id === 'fintrac_unrepresented_party_record');
    expect(trueItem.applicability).toBe('required');
    expect(trueItem).not.toHaveProperty('reason');
  });

  // Spec 5.3: every FINTRAC item lives only in the Fintracker app, there is no
  // document evidence and there never will be.
  it('every FINTRAC item on seller_sale carries externalSystem Fintracker and evidence external_system', () => {
    const fintracItems = CATALOG.seller_sale.filter((item) => item.source === 'FINTRAC');
    expect(fintracItems.length).toBeGreaterThan(0);
    fintracItems.forEach((item) => {
      expect(item.evidence).toBe('external_system');
      expect(item.externalSystem).toBe('Fintracker');
    });
  });

  it('the receipt of funds record on seller_sale resolves indeterminate on an empty facts object, naming both facts in reads order', () => {
    const result = resolveChecklist('seller_sale', 'live', {});
    const item = result.find((entry) => entry.id === 'fintrac_receipt_of_funds_record');
    expect(item.applicability).toBe('indeterminate');
    expect(item.pendingFacts).toEqual(['hasSelfRepresentedParty', 'brokerageReceivedFunds']);
  });

  it('the receipt of funds record on seller_sale resolves not_applicable when hasSelfRepresentedParty is false and brokerageReceivedFunds is true', () => {
    const result = resolveChecklist('seller_sale', 'live', {
      hasSelfRepresentedParty: false,
      brokerageReceivedFunds: true,
    });
    const item = result.find((entry) => entry.id === 'fintrac_receipt_of_funds_record');
    expect(item.applicability).toBe('not_applicable');
    expect(item.reason).toBe(
      "Responsibility for the receipt of funds record falls to the buyer's agent when the buyer is represented"
    );
  });

  it('the receipt of funds record on seller_sale resolves not_applicable when hasSelfRepresentedParty is true and brokerageReceivedFunds is false', () => {
    const result = resolveChecklist('seller_sale', 'live', {
      hasSelfRepresentedParty: true,
      brokerageReceivedFunds: false,
    });
    const item = result.find((entry) => entry.id === 'fintrac_receipt_of_funds_record');
    expect(item.applicability).toBe('not_applicable');
    expect(item.reason).toBe(
      "Responsibility for the receipt of funds record falls to the buyer's agent when the buyer is represented"
    );
  });

  it('the receipt of funds record on seller_sale resolves required only when both hasSelfRepresentedParty and brokerageReceivedFunds are true', () => {
    const result = resolveChecklist('seller_sale', 'live', {
      hasSelfRepresentedParty: true,
      brokerageReceivedFunds: true,
    });
    const item = result.find((entry) => entry.id === 'fintrac_receipt_of_funds_record');
    expect(item.applicability).toBe('required');
    expect(item).not.toHaveProperty('reason');
  });

  it('the same id fintrac_receipt_of_funds_record resolves required on buyer_purchase and indeterminate on seller_sale, both with empty facts', () => {
    const buyerResult = resolveChecklist('buyer_purchase', 'conditional', {});
    const buyerItem = buyerResult.find((entry) => entry.id === 'fintrac_receipt_of_funds_record');
    expect(buyerItem.applicability).toBe('required');

    const sellerResult = resolveChecklist('seller_sale', 'live', {});
    const sellerItem = sellerResult.find((entry) => entry.id === 'fintrac_receipt_of_funds_record');
    expect(sellerItem.applicability).toBe('indeterminate');
  });

  it('an item resolved required has no reason key at all', () => {
    const result = resolveChecklist('tenant_lease', 'accepted', {});
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

  // TRESA s. 5.1: the representation/listing agreement must be in writing and
  // must clearly identify the method used to determine remuneration. There is
  // no structural marker distinguishing "the representation instrument" item
  // from any other catalog item, so this is an explicit id list rather than a
  // pattern match, since it fails loudly if a type gains a second instrument
  // instead of silently covering nothing.
  it('every representation/listing agreement instrument states its remuneration method in the label', () => {
    const REPRESENTATION_INSTRUMENT_IDS = {
      buyer_purchase: 'buyer_representation_agreement',
      tenant_lease: 'tenant_representation_agreement',
      seller_sale: 'listing_agreement',
      landlord_lease: 'listing_agreement_lease',
      seller_listing: 'listing_agreement',
      landlord_listing: 'listing_agreement_lease',
    };
    TYPES.forEach((type) => {
      const id = REPRESENTATION_INSTRUMENT_IDS[type];
      const item = CATALOG[type].find((entry) => entry.id === id);
      expect(item).toBeDefined();
      expect(item.label).toMatch(/remuneration/);
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
      label: 'Buyer Representation Agreement, in writing with remuneration method stated',
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
  const state = 'conditional';

  it('throws with the reResolve prefix when previousItems is not an array', () => {
    expect(() => reResolve('nope', 'buyer_purchase', state, facts)).toThrow(/reResolve:/);
  });

  it('throws with the reResolve prefix when representedPersons is present and not an array', () => {
    expect(() =>
      reResolve([], 'buyer_purchase', state, { ...facts, representedPersons: 'alice' })
    ).toThrow(/reResolve: representedPersons must be an array/);
  });

  it('throws with the reResolve prefix when clientSatisfactions is present and not a non-null object', () => {
    expect(() =>
      reResolve([], 'buyer_purchase', state, { ...facts, clientSatisfactions: 'alice' })
    ).toThrow(/reResolve: clientSatisfactions must be a non-null object/);
  });

  it('throws with the reResolve prefix when state is unknown', () => {
    expect(() => reResolve([], 'buyer_purchase', 'not_a_real_state', facts)).toThrow(
      /reResolve: unknown state 'not_a_real_state' for type 'buyer_purchase'/
    );
  });

  it('keeps completed, completedAt, and documents for an item present in both sets', () => {
    const result = reResolve(previousItems, 'buyer_purchase', state, facts);
    const item = result.find((entry) => entry.id === 'reco_information_guide');
    expect(item.completed).toBe(true);
    expect(item.completedAt).toBe('2026-01-05T12:00:00Z');
    expect(item.documents).toEqual(['guide.pdf']);
  });

  it('takes applicability and reason from the new resolution, not the old one', () => {
    const result = reResolve(previousItems, 'buyer_purchase', state, facts);
    const item = result.find((entry) => entry.id === 'srp_disclosure');
    expect(item.applicability).toBe('required');
    expect(item).not.toHaveProperty('reason');
  });

  it('an item only in the new set carries no state fields', () => {
    const result = reResolve(previousItems, 'buyer_purchase', state, facts);
    const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
    expect(item).not.toHaveProperty('completed');
    expect(item).not.toHaveProperty('completedAt');
    expect(item).not.toHaveProperty('documents');
  });

  it('keeps a dropped item in the result as no_longer_applicable with its state intact', () => {
    const result = reResolve(previousItems, 'buyer_purchase', state, facts);
    const item = result.find((entry) => entry.id === 'last_month_rent_deposit');
    expect(item).toBeDefined();
    expect(item.applicability).toBe('no_longer_applicable');
    expect(item.completed).toBe(true);
    expect(item.documents).toEqual(['lmr-receipt.pdf']);
    expect(item.reason).toMatch(/buyer_purchase/);
  });

  it('keeps a note for an item present in both sets', () => {
    const items = [
      { id: 'reco_information_guide', note: 'confirmed verbally, guide emailed same day' },
    ];
    const result = reResolve(items, 'buyer_purchase', state, facts);
    const item = result.find((entry) => entry.id === 'reco_information_guide');
    expect(item.note).toBe('confirmed verbally, guide emailed same day');
  });

  it('keeps a note on a dropped item that becomes no_longer_applicable', () => {
    const items = [
      { id: 'last_month_rent_deposit', note: 'landlord waived LMR, confirmed in writing' },
    ];
    const result = reResolve(items, 'buyer_purchase', state, facts);
    const item = result.find((entry) => entry.id === 'last_month_rent_deposit');
    expect(item.applicability).toBe('no_longer_applicable');
    expect(item.note).toBe('landlord waived LMR, confirmed in writing');
  });

  it('does not add a note key to an item that had none', () => {
    const items = [{ id: 'reco_information_guide' }];
    const result = reResolve(items, 'buyer_purchase', state, facts);
    const item = result.find((entry) => entry.id === 'reco_information_guide');
    expect(item).not.toHaveProperty('note');
  });

  it('carries forward an empty-string note rather than dropping it', () => {
    const items = [{ id: 'reco_information_guide', note: '' }];
    const result = reResolve(items, 'buyer_purchase', state, facts);
    const item = result.find((entry) => entry.id === 'reco_information_guide');
    expect(item.note).toBe('');
  });

  it('does not carry forward a stale outstandingPersons when new facts say the person is now satisfied', () => {
    const items = [
      {
        id: 'reco_information_guide',
        satisfiedPersons: [],
        outstandingPersons: ['alice'],
      },
    ];
    const result = reResolve(items, 'buyer_purchase', state, {
      ...facts,
      representedPersons: ['alice'],
      clientSatisfactions: { alice: { reco_information_guide: {} } },
    });
    const item = result.find((entry) => entry.id === 'reco_information_guide');
    expect(item.satisfiedPersons).toEqual(['alice']);
    expect(item.outstandingPersons).toEqual([]);
  });

  it('produces an identical result when re-resolved again, with no duplicated no_longer_applicable entries', () => {
    const first = reResolve(previousItems, 'buyer_purchase', state, facts);
    const second = reResolve(first, 'buyer_purchase', state, facts);
    expect(second).toEqual(first);
    const noLongerApplicable = second.filter((entry) => entry.applicability === 'no_longer_applicable');
    expect(noLongerApplicable.length).toBe(1);
  });

  it('equals resolveChecklist when previousItems is empty', () => {
    const result = reResolve([], 'buyer_purchase', state, facts);
    expect(result).toEqual(resolveChecklist('buyer_purchase', state, facts));
  });

  it('orders the new set in catalog order first, then no_longer_applicable items in previousItems order', () => {
    const result = reResolve(previousItems, 'buyer_purchase', state, facts);
    const ids = result.map((entry) => entry.id);
    const catalogIds = CATALOG.buyer_purchase.filter((item) => !item.terminalOnly).map((item) => item.id);
    expect(ids.slice(0, catalogIds.length)).toEqual(catalogIds);
    expect(ids.slice(catalogIds.length)).toEqual(['last_month_rent_deposit']);
  });

  it('preserves STATE_FIELDS across a transition into collapsed', () => {
    const items = [
      {
        id: 'reco_information_guide',
        completed: true,
        completedAt: '2026-01-05T12:00:00Z',
        documents: ['guide.pdf'],
        note: 'confirmed',
      },
    ];
    const result = reResolve(items, 'buyer_purchase', 'collapsed', facts);
    const item = result.find((entry) => entry.id === 'reco_information_guide');
    expect(item.completed).toBe(true);
    expect(item.completedAt).toBe('2026-01-05T12:00:00Z');
    expect(item.documents).toEqual(['guide.pdf']);
    expect(item.note).toBe('confirmed');
  });

  it('reResolving from collapsed to collapsed keeps mutual_release in the merged set with its state carried, not appended as no_longer_applicable', () => {
    const items = [
      {
        id: 'mutual_release',
        label: 'Mutual Release signed by all parties and submitted to the brokerage',
        source: 'brokerage',
        scope: 'transaction',
        evidence: 'document',
        reads: [],
        terminalOnly: true,
        applicability: 'required',
        completed: true,
        completedAt: '2026-02-01T09:00:00Z',
        documents: ['mutual-release.pdf'],
      },
    ];
    const result = reResolve(items, 'buyer_purchase', 'collapsed', facts);
    const item = result.find((entry) => entry.id === 'mutual_release');
    expect(item).toBeDefined();
    expect(item.applicability).toBe('required');
    expect(item.completed).toBe(true);
    expect(item.completedAt).toBe('2026-02-01T09:00:00Z');
    expect(item.documents).toEqual(['mutual-release.pdf']);
    const noLongerApplicable = result.filter((entry) => entry.applicability === 'no_longer_applicable');
    expect(noLongerApplicable.find((entry) => entry.id === 'mutual_release')).toBeUndefined();
  });
});

describe('condition items (buyer_purchase and seller_sale)', () => {
  const CONDITION_IDS = [
    'financing_condition',
    'inspection_condition',
    'sale_of_property_condition',
    'solicitor_approval_condition',
    'insurance_condition',
    'well_septic_condition',
    'status_certificate_receipt',
    'status_certificate_review',
  ];

  const REASONS = {
    financing_condition: 'No financing condition in the agreement',
    inspection_condition: 'No home inspection condition in the agreement',
    sale_of_property_condition: 'No sale of buyer property condition in the agreement',
    solicitor_approval_condition: 'No solicitor approval condition in the agreement',
    insurance_condition: 'No insurance condition in the agreement',
    well_septic_condition: 'No well and septic inspection condition in the agreement',
    status_certificate_receipt: 'No status certificate condition in the agreement',
    status_certificate_review: 'No status certificate condition in the agreement',
  };

  ['buyer_purchase', 'seller_sale'].forEach((type) => {
    const state = NON_COLLAPSED_STATE[type];

    it(`resolves financing_condition required and the other seven not_applicable on ${type} when conditions is ['financing']`, () => {
      const result = resolveChecklist(type, state, { conditions: ['financing'] });
      const byId = new Map(result.map((entry) => [entry.id, entry]));
      expect(byId.get('financing_condition').applicability).toBe('required');
      CONDITION_IDS.filter((id) => id !== 'financing_condition').forEach((id) => {
        expect(byId.get(id).applicability).toBe('not_applicable');
        expect(byId.get(id).reason).toBe(REASONS[id]);
      });
    });

    it(`resolves all eight condition items not_applicable on ${type} when conditions is []`, () => {
      const result = resolveChecklist(type, state, { conditions: [] });
      const byId = new Map(result.map((entry) => [entry.id, entry]));
      CONDITION_IDS.forEach((id) => {
        expect(byId.get(id).applicability).toBe('not_applicable');
        expect(byId.get(id).reason).toBe(REASONS[id]);
      });
    });

    it(`resolves all eight condition items indeterminate on ${type} when conditions is absent`, () => {
      const result = resolveChecklist(type, state, {});
      const byId = new Map(result.map((entry) => [entry.id, entry]));
      CONDITION_IDS.forEach((id) => {
        expect(byId.get(id).applicability).toBe('indeterminate');
        expect(byId.get(id).pendingFacts).toEqual(['conditions']);
      });
    });

    it(`resolves both status certificate rows required on ${type} when conditions is ['status_certificate']`, () => {
      const result = resolveChecklist(type, state, { conditions: ['status_certificate'] });
      const byId = new Map(result.map((entry) => [entry.id, entry]));
      expect(byId.get('status_certificate_receipt').applicability).toBe('required');
      expect(byId.get('status_certificate_review').applicability).toBe('required');
    });

    it(`throws on ${type} when conditions is null`, () => {
      expect(() => resolveChecklist(type, state, { conditions: null })).toThrow(
        'hasCondition: facts.conditions must be an array, got null'
      );
    });
  });

  it('produces identical condition results on buyer_purchase and seller_sale for the same facts', () => {
    const facts = { conditions: ['financing', 'status_certificate'] };
    const pick = (result) =>
      CONDITION_IDS.map((id) => {
        const { applicability, reason, pendingFacts } = result.find((entry) => entry.id === id);
        return { id, applicability, reason, pendingFacts };
      });
    const buyerResult = pick(resolveChecklist('buyer_purchase', NON_COLLAPSED_STATE.buyer_purchase, facts));
    const sellerResult = pick(resolveChecklist('seller_sale', NON_COLLAPSED_STATE.seller_sale, facts));
    expect(buyerResult).toEqual(sellerResult);
  });
});

describe('corporate client identification (fintrac_corporation_identification_record / fintrac_articles_of_incorporation)', () => {
  ['buyer_purchase', 'seller_sale'].forEach((type) => {
    const state = NON_COLLAPSED_STATE[type];

    it(`resolves the corporation record required with both person fields correctly partitioned on ${type} when entityType is corporation`, () => {
      const result = resolveChecklist(type, state, {
        entityType: 'corporation',
        representedPersons: ['alice', 'bob'],
        clientSatisfactions: { alice: { fintrac_corporation_identification_record: {} } },
      });
      const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
      expect(item.applicability).toBe('required');
      expect(item.satisfiedPersons).toEqual(['alice']);
      expect(item.outstandingPersons).toEqual(['bob']);
    });

    it(`resolves the corporation record not_applicable on ${type} when entityType is individual, with satisfiedPersons present and outstandingPersons absent`, () => {
      const result = resolveChecklist(type, state, {
        entityType: 'individual',
        representedPersons: ['alice', 'bob'],
      });
      const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
      expect(item.applicability).toBe('not_applicable');
      expect(item.satisfiedPersons).toEqual([]);
      expect(item).not.toHaveProperty('outstandingPersons');
    });

    it(`resolves the corporation record indeterminate on ${type} when entityType is absent, with both person fields absent`, () => {
      const result = resolveChecklist(type, state, { representedPersons: ['alice', 'bob'] });
      const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
      expect(item.applicability).toBe('indeterminate');
      expect(item).not.toHaveProperty('satisfiedPersons');
      expect(item).not.toHaveProperty('outstandingPersons');
    });

    it(`preserves evidence on ${type}: satisfiedPersons still names a person checked before the corporation record was ruled not_applicable`, () => {
      const result = resolveChecklist(type, state, {
        entityType: 'individual',
        representedPersons: ['alice', 'bob'],
        clientSatisfactions: { alice: { fintrac_corporation_identification_record: {} } },
      });
      const item = result.find((entry) => entry.id === 'fintrac_corporation_identification_record');
      expect(item.applicability).toBe('not_applicable');
      expect(item.satisfiedPersons).toEqual(['alice']);
      expect(item).not.toHaveProperty('outstandingPersons');
    });

    it(`resolves fintrac_articles_of_incorporation's applicability the same as the corporation record on ${type}`, () => {
      const required = resolveChecklist(type, state, { entityType: 'corporation' }).find(
        (entry) => entry.id === 'fintrac_articles_of_incorporation'
      );
      expect(required.applicability).toBe('required');

      const notApplicable = resolveChecklist(type, state, { entityType: 'individual' }).find(
        (entry) => entry.id === 'fintrac_articles_of_incorporation'
      );
      expect(notApplicable.applicability).toBe('not_applicable');

      const indeterminate = resolveChecklist(type, state, {}).find(
        (entry) => entry.id === 'fintrac_articles_of_incorporation'
      );
      expect(indeterminate.applicability).toBe('indeterminate');
    });

    it(`fintrac_articles_of_incorporation carries scope client and clientScope event on ${type}`, () => {
      const result = resolveChecklist(type, state, { entityType: 'corporation' });
      const item = result.find((entry) => entry.id === 'fintrac_articles_of_incorporation');
      expect(item.scope).toBe('client');
      expect(item.clientScope).toBe('event');
    });
  });
});
