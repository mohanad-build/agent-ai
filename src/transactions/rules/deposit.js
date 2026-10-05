'use strict';

// The deposit is a three-step chain and the same steps on a lease and a
// sale (Mo, deals desk, session 81); the listing brokerage holds it.
//
// Two sides with different ids because they are different steps done by
// different agents, not one step seen twice.
//
// The receipt closes the chain: once it is in, the deposit is done.
//
// The paying side is omitted on a double-end (omitWhenDoubleEnded,
// resolver.js), because only the holding side's steps happen when one
// agent represents both sides.
//
// reads [] on purpose: a paying-side item that read representationArrangement
// would resolve indeterminate on every buy-side deal, since buy-side deals
// never carry that fact.
//
// Unrelated to fintrac_receipt_of_funds_record, which is a FINTRAC
// compliance record, not the deposit's journey.
//
// The deposit is data, not a rule: no item proposes an amount or type, and
// no security or damage deposit item exists (see the catalog-wide negative
// assertion).
//
// The additional deposit tracks the receipt only, since the receipt closes
// it; sales only in v1. Unlike the three-step chain it reads a fact, so it
// is indeterminate until the additional-deposit question is answered, and
// [] is the answer for none.

const HOLDING_SIDE_DEPOSIT_ITEMS = [
  {
    id: 'deposit_slip_received',
    label: 'Deposit Slip Received',
    source: 'brokerage',
    scope: 'transaction',
    evidence: 'document',
    reads: [],
  },
  {
    id: 'deposit_forwarded_to_accounting',
    label: 'Deposit Forwarded to Brokerage Accounting',
    source: 'brokerage',
    scope: 'transaction',
    evidence: 'attestation',
    reads: [],
  },
  {
    id: 'brokerage_deposit_receipt_issued',
    label: 'Brokerage Deposit Receipt Issued',
    source: 'brokerage',
    scope: 'transaction',
    evidence: 'document',
    reads: [],
  },
];

const PAYING_SIDE_DEPOSIT_ITEMS = [
  {
    id: 'deposit_obtained_from_client',
    label: 'Deposit Obtained from Client',
    source: 'brokerage',
    scope: 'transaction',
    evidence: 'attestation',
    reads: [],
    omitWhenDoubleEnded: true,
  },
  {
    id: 'deposit_delivered_to_listing_agent',
    label: 'Deposit Delivered to Listing Agent',
    source: 'brokerage',
    scope: 'transaction',
    evidence: 'attestation',
    reads: [],
    omitWhenDoubleEnded: true,
  },
  {
    id: 'brokerage_deposit_receipt_received',
    label: 'Brokerage Deposit Receipt Received',
    source: 'brokerage',
    scope: 'transaction',
    evidence: 'document',
    reads: [],
    omitWhenDoubleEnded: true,
  },
];

// Same reasoning as hasCondition; setFact guarantees an array, so a
// non-array here means a hand-edited file, and a quiet not_applicable
// would hide it.
function hasAdditionalDepositDate(facts) {
  if (!Array.isArray(facts.additionalDepositDueDates)) {
    const got = facts.additionalDepositDueDates === null ? 'null' : typeof facts.additionalDepositDueDates;
    throw new Error(`hasAdditionalDepositDate: facts.additionalDepositDueDates must be an array, got ${got}`);
  }
  return facts.additionalDepositDueDates.length > 0;
}

const HOLDING_SIDE_ADDITIONAL_DEPOSIT_ITEMS = [
  {
    id: 'additional_deposit_receipt_issued',
    label: 'Additional Deposit Receipt Issued',
    source: 'brokerage',
    scope: 'transaction',
    evidence: 'document',
    reads: ['additionalDepositDueDates'],
    requiredWhen: (facts) => hasAdditionalDepositDate(facts),
    notApplicableReason: 'No additional deposit in the agreement',
  },
];

const PAYING_SIDE_ADDITIONAL_DEPOSIT_ITEMS = [
  {
    id: 'additional_deposit_receipt_received',
    label: 'Additional Deposit Receipt Received',
    source: 'brokerage',
    scope: 'transaction',
    evidence: 'document',
    reads: ['additionalDepositDueDates'],
    requiredWhen: (facts) => hasAdditionalDepositDate(facts),
    notApplicableReason: 'No additional deposit in the agreement',
    omitWhenDoubleEnded: true,
  },
];

// The chain of step ids ending at receiptId, in catalog order, inclusive.
// A chain of one (the additional deposit) answers the same question the
// same way: its only id is its own last element. Returns null when
// receiptId is not the last id of any known chain -- not a step partway
// through one, and not an unknown id -- so a caller (the RECEIPT verb)
// can refuse cleanly instead of completing the wrong rows.
const DEPOSIT_CHAINS = [
  HOLDING_SIDE_DEPOSIT_ITEMS,
  PAYING_SIDE_DEPOSIT_ITEMS,
  HOLDING_SIDE_ADDITIONAL_DEPOSIT_ITEMS,
  PAYING_SIDE_ADDITIONAL_DEPOSIT_ITEMS,
].map((items) => Object.freeze(items.map((item) => item.id)));

function chainEndingAt(receiptId) {
  const chain = DEPOSIT_CHAINS.find((ids) => ids[ids.length - 1] === receiptId);
  return chain || null;
}

module.exports = {
  HOLDING_SIDE_DEPOSIT_ITEMS,
  PAYING_SIDE_DEPOSIT_ITEMS,
  HOLDING_SIDE_ADDITIONAL_DEPOSIT_ITEMS,
  PAYING_SIDE_ADDITIONAL_DEPOSIT_ITEMS,
  chainEndingAt,
};
