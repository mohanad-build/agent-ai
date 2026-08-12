'use strict';

const universal = require('./universal');
const conditions = require('./conditions');
const terminal = require('./terminal');

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
    scope: 'client',
    clientScope: 'event',
    evidence: 'external_system',
    externalSystem: 'Fintracker',
    reads: ['entityType'],
    requiredWhen: (facts) => facts.entityType === 'corporation',
    notApplicableReason: 'Entity type is not a corporation',
  },
  {
    id: 'fintrac_articles_of_incorporation',
    label: 'FINTRAC Articles of Incorporation',
    source: 'FINTRAC',
    scope: 'client',
    clientScope: 'event',
    evidence: 'external_system',
    externalSystem: 'Fintracker',
    reads: ['entityType'],
    requiredWhen: (facts) => facts.entityType === 'corporation',
    notApplicableReason: 'Entity type is not a corporation',
  },
  {
    id: 'fintrac_individual_identification_record',
    label: 'FINTRAC Individual Identification Information Record, per represented person',
    source: 'FINTRAC',
    scope: 'client',
    clientScope: 'event',
    evidence: 'external_system',
    externalSystem: 'Fintracker',
    reads: [],
  },
  {
    id: 'fintrac_third_party_determination',
    label: 'FINTRAC Third Party Determination',
    source: 'FINTRAC',
    scope: 'client',
    clientScope: 'event',
    evidence: 'external_system',
    externalSystem: 'Fintracker',
    reads: [],
  },
  // Unconditional by design: on the buy side, responsibility for the receipt
  // of funds record falls to the buyer's agent when all parties are
  // represented, and the buyer's agent is who this catalog is for. The
  // seller-side version is conditional and lives in sellerSale.js. Do not
  // add a predicate here to "fix" this.
  {
    id: 'fintrac_receipt_of_funds_record',
    label: 'FINTRAC Receipt of Funds Record',
    source: 'FINTRAC',
    scope: 'transaction',
    evidence: 'external_system',
    externalSystem: 'Fintracker',
    reads: [],
  },
  // Reads the same fact as srp_disclosure, deliberately: TRESA's
  // self-represented party and FINTRAC's unrepresented party are the same
  // person in the same situation, described by two different regulators.
  // One fact means the agent is asked once.
  {
    id: 'fintrac_unrepresented_party_record',
    label: 'FINTRAC Unrepresented Party Information Record and Identity Verification',
    source: 'FINTRAC',
    scope: 'transaction',
    evidence: 'external_system',
    externalSystem: 'Fintracker',
    reads: ['hasSelfRepresentedParty'],
    requiredWhen: (facts) => facts.hasSelfRepresentedParty === true,
    notApplicableReason: 'No self-represented party on this transaction',
  },
  ...conditions.CONDITION_ITEMS,
  ...terminal.TERMINAL_ITEMS,
];

module.exports = {
  BUYER_PURCHASE_ITEMS,
};
