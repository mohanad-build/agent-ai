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

module.exports = {
  HOLDING_SIDE_DEPOSIT_ITEMS,
  PAYING_SIDE_DEPOSIT_ITEMS,
};
