'use strict';

const universal = require('./universal');
const terminal = require('./terminal');

// -- Tenant lease items ---------------------------------------------------------
// Universal spine plus the tenant-side lease execution and deposit sequence.

const TENANT_LEASE_ITEMS = [
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
  // tenant_representation_agreement's TRESA source just below.
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
    id: 'tenant_representation_agreement',
    label: 'Tenant Representation Agreement, in writing with remuneration method stated',
    source: 'TRESA',
    scope: 'client',
    clientScope: 'dated',
    evidence: 'document',
    reads: [],
  },
  {
    id: 'agreement_to_lease',
    label: 'Agreement to Lease (Form 400)',
    source: 'brokerage',
    scope: 'transaction',
    evidence: 'document',
    reads: [],
  },
  {
    id: 'ontario_standard_lease',
    label: 'Ontario Standard Lease Executed',
    source: 'RTA',
    scope: 'transaction',
    evidence: 'document',
    reads: [],
  },
  {
    id: 'signed_lease_copy_received',
    label: 'Signed Lease Copy Received',
    source: 'RTA',
    scope: 'transaction',
    evidence: 'document',
    reads: [],
  },
  {
    id: 'deposit_obtained_from_tenant',
    label: 'Deposit Obtained from Tenant',
    source: 'brokerage',
    scope: 'transaction',
    evidence: 'attestation',
    reads: [],
  },
  {
    id: 'deposit_delivered_to_listing_agent',
    label: 'Deposit Delivered to Listing Agent',
    source: 'brokerage',
    scope: 'transaction',
    evidence: 'attestation',
    reads: [],
  },
  {
    id: 'brokerage_deposit_receipt_received',
    label: 'Brokerage Deposit Receipt Received',
    source: 'brokerage',
    scope: 'transaction',
    evidence: 'document',
    reads: [],
  },
  {
    id: 'first_month_rent_paid',
    label: 'First Month Rent Paid',
    source: 'brokerage',
    scope: 'transaction',
    evidence: 'attestation',
    reads: [],
  },
  {
    id: 'keys_received',
    label: 'Keys Received on Closing',
    source: 'RTA',
    scope: 'transaction',
    evidence: 'attestation',
    reads: [],
  },
  ...terminal.TERMINAL_ITEMS,
];

module.exports = {
  TENANT_LEASE_ITEMS,
};
