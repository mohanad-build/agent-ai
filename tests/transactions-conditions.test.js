'use strict';

const { CONDITION_NAMES, CONDITION_ITEMS } = require('../src/transactions/rules/conditions');

describe('CONDITION_NAMES', () => {
  it('is the hand-written closed vocabulary, in order', () => {
    expect(CONDITION_NAMES).toEqual([
      'financing', 'inspection', 'sale_of_property', 'solicitor_approval',
      'insurance', 'well_septic', 'status_certificate',
    ]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(CONDITION_NAMES)).toBe(true);
  });
});

describe('CONDITION_ITEMS ids', () => {
  it('are the hand-written eight ids, in catalog order', () => {
    expect(CONDITION_ITEMS.map((item) => item.id)).toEqual([
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
});

describe('condition name to item mapping', () => {
  const EXPECTED_REQUIRED = {
    financing: ['financing_condition'],
    inspection: ['inspection_condition'],
    sale_of_property: ['sale_of_property_condition'],
    solicitor_approval: ['solicitor_approval_condition'],
    insurance: ['insurance_condition'],
    well_septic: ['well_septic_condition'],
    status_certificate: ['status_certificate_receipt', 'status_certificate_review'],
  };

  it.each(Object.keys(EXPECTED_REQUIRED))('%s gates exactly its expected items', (name) => {
    const requiredIds = CONDITION_ITEMS
      .filter((item) => item.requiredWhen({ conditions: [name] }))
      .map((item) => item.id);
    expect(requiredIds).toEqual(EXPECTED_REQUIRED[name]);
  });
});
