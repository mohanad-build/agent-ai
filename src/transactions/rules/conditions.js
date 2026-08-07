'use strict';

// -- Condition items ------------------------------------------------------------
// Spread into buyer_purchase and seller_sale, at the end of each array.

// The resolver's presence check (annotateItem in resolver.js) treats null as
// present: `name in facts` is true and `facts[name]` is `null`, not
// `undefined`, so a null conditions array reaches requiredWhen. Array.isArray
// returning false there would silently resolve all eight rows not_applicable
// with a reason nobody supplied. These rows decide whether a deal is firm, so
// that failure mode must be loud instead.
function hasCondition(facts, name) {
  if (!Array.isArray(facts.conditions)) {
    const got = facts.conditions === null ? 'null' : typeof facts.conditions;
    throw new Error(`hasCondition: facts.conditions must be an array, got ${got}`);
  }
  return facts.conditions.includes(name);
}

const CONDITION_ITEMS = [
  {
    id: 'financing_condition',
    label: 'Financing condition cleared by waiver, notice of fulfilment, or amendment',
    source: 'APS',
    scope: 'transaction',
    evidence: 'document',
    reads: ['conditions'],
    requiredWhen: (facts) => hasCondition(facts, 'financing'),
    notApplicableReason: 'No financing condition in the agreement',
  },
  {
    id: 'inspection_condition',
    label: 'Home inspection condition cleared by waiver, notice of fulfilment, or amendment',
    source: 'APS',
    scope: 'transaction',
    evidence: 'document',
    reads: ['conditions'],
    requiredWhen: (facts) => hasCondition(facts, 'inspection'),
    notApplicableReason: 'No home inspection condition in the agreement',
  },
  {
    id: 'sale_of_property_condition',
    label: 'Sale of buyer property condition cleared by waiver, notice of fulfilment, or amendment',
    source: 'APS',
    scope: 'transaction',
    evidence: 'document',
    reads: ['conditions'],
    requiredWhen: (facts) => hasCondition(facts, 'sale_of_property'),
    notApplicableReason: 'No sale of buyer property condition in the agreement',
  },
  {
    id: 'solicitor_approval_condition',
    label: 'Solicitor approval condition cleared by waiver, notice of fulfilment, or amendment',
    source: 'APS',
    scope: 'transaction',
    evidence: 'document',
    reads: ['conditions'],
    requiredWhen: (facts) => hasCondition(facts, 'solicitor_approval'),
    notApplicableReason: 'No solicitor approval condition in the agreement',
  },
  {
    id: 'insurance_condition',
    label: 'Insurance condition cleared by waiver, notice of fulfilment, or amendment',
    source: 'APS',
    scope: 'transaction',
    evidence: 'document',
    reads: ['conditions'],
    requiredWhen: (facts) => hasCondition(facts, 'insurance'),
    notApplicableReason: 'No insurance condition in the agreement',
  },
  {
    id: 'well_septic_condition',
    label: 'Well and septic inspection condition cleared by waiver, notice of fulfilment, or amendment',
    source: 'APS',
    scope: 'transaction',
    evidence: 'document',
    reads: ['conditions'],
    requiredWhen: (facts) => hasCondition(facts, 'well_septic'),
    notApplicableReason: 'No well and septic inspection condition in the agreement',
  },
  {
    id: 'status_certificate_receipt',
    label: 'Status Certificate delivered and received',
    source: 'APS',
    scope: 'transaction',
    evidence: 'document',
    reads: ['conditions'],
    requiredWhen: (facts) => hasCondition(facts, 'status_certificate'),
    notApplicableReason: 'No status certificate condition in the agreement',
  },
  {
    id: 'status_certificate_review',
    label: 'Status Certificate reviewed and condition cleared by waiver, notice of fulfilment, or amendment',
    source: 'APS',
    scope: 'transaction',
    evidence: 'document',
    reads: ['conditions'],
    requiredWhen: (facts) => hasCondition(facts, 'status_certificate'),
    notApplicableReason: 'No status certificate condition in the agreement',
  },
];

module.exports = {
  CONDITION_ITEMS,
};
