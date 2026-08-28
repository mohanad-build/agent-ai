'use strict';

const universal = require('./universal');
const conditions = require('./conditions');
const terminal = require('./terminal');

// -- Buyer purchase items ------------------------------------------------------
// Universal spine plus the buyer-purchase-specific FINTRAC record.

const BUYER_PURCHASE_ITEMS = [
  ...universal.UNIVERSAL_ITEMS,
  {
    id: 'srp_disclosure',
    label: 'Self-Represented Party Disclosure',
    source: 'TRESA',
    scope: 'transaction',
    evidence: 'document',
    reads: ['hasSelfRepresentedParty'],
    requiredWhen: (facts) => facts.hasSelfRepresentedParty === true,
    notApplicableReason: 'No self-represented party on this transaction',
  },
  {
    id: 'deal_sheet',
    label: 'Deal sheet or brokerage submission summary on file',
    source: 'brokerage',
    scope: 'transaction',
    evidence: 'document',
    reads: [],
  },
  // Required only when representationArrangement is 'double_ended': TRESA
  // requires written, informed consent from both clients before an agent
  // may act as a multiple representative, so this is statutory rather than
  // a brokerage-internal record -- the same justification as
  // buyer_representation_agreement's TRESA source just below. Deliberately
  // does NOT fire on 'designated': whether a two-agent, same-brokerage deal
  // needs this form depends on the brokerage's own designated-
  // representation arrangement, a brokerage-level property this file does
  // not record (decision 33 kept that out of the catalog). Nothing in this
  // codebase creates a 'designated' transaction today, so under-asking
  // here is deliberate and documented, not an oversight.
  {
    id: 'multiple_representation_agreement',
    label: 'Multiple representation consent form or agreement, signed by both clients, on file',
    source: 'TRESA',
    scope: 'transaction',
    evidence: 'document',
    reads: ['representationArrangement'],
    requiredWhen: (facts) => facts.representationArrangement === 'double_ended',
    notApplicableReason: 'Representation arrangement is not double-ended',
  },
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
