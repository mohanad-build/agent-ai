'use strict';

const universal = require('./universal');

// -- Buyer purchase items ------------------------------------------------------
// Universal spine plus the buyer-purchase-specific FINTRAC record.

const BUYER_PURCHASE_ITEMS = [
  ...universal.UNIVERSAL_ITEMS,
  {
    id: 'buyer_representation_agreement',
    label: 'Buyer Representation Agreement, in writing with remuneration method stated',
    source: 'TRESA',
    scope: 'client',
    clientScope: 'dated',
    evidence: 'document',
    reads: [],
  },
  {
    id: 'fintrac_corporation_identification_record',
    label: 'FINTRAC Corporation Identification Record',
    source: 'FINTRAC',
    scope: 'transaction',
    evidence: 'external_system',
    externalSystem: 'Fintracker',
    reads: ['entityType'],
    requiredWhen: (facts) => facts.entityType === 'corporation',
    notApplicableReason: 'Entity type is not a corporation',
  },
];

module.exports = {
  BUYER_PURCHASE_ITEMS,
};
