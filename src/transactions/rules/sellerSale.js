'use strict';

const universal = require('./universal');
const conditions = require('./conditions');
const terminal = require('./terminal');

// -- Seller sale items ---------------------------------------------------------
// Universal spine plus the seller-side listing agreement.

const SELLER_SALE_ITEMS = [
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
  // a brokerage-internal record -- the same justification behind
  // buyerPurchase.js's buyer_representation_agreement TRESA source.
  // Deliberately does NOT fire on 'designated': whether a two-agent,
  // same-brokerage deal needs this form depends on the brokerage's own
  // designated-representation arrangement, a brokerage-level property this
  // file does not record (decision 33 kept that out of the catalog).
  // Nothing in this codebase creates a 'designated' transaction today, so
  // under-asking here is deliberate and documented, not an oversight.
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
  // Conditional by design, unlike the buy side: responsibility for the
  // receipt of funds record falls to the buyer's agent when all parties are
  // represented, so a listing agent only inherits the obligation when taking
  // a deposit from an unrepresented buyer. On a seller_sale the
  // self-represented party is the buyer, so this reads the same
  // hasSelfRepresentedParty fact as fintrac_unrepresented_party_record and
  // srp_disclosure. The buy-side version of this same id is unconditional by
  // design; that asymmetry is deliberate.
  {
    id: 'fintrac_receipt_of_funds_record',
    label: 'FINTRAC Receipt of Funds Record',
    source: 'FINTRAC',
    scope: 'transaction',
    evidence: 'external_system',
    externalSystem: 'Fintracker',
    reads: ['hasSelfRepresentedParty', 'brokerageReceivedFunds'],
    requiredWhen: (facts) =>
      facts.hasSelfRepresentedParty === true && facts.brokerageReceivedFunds === true,
    notApplicableReason:
      "Responsibility for the receipt of funds record falls to the buyer's agent when the buyer is represented",
  },
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
  SELLER_SALE_ITEMS,
};
