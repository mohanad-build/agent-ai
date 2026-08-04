'use strict';

const universal = require('./universal');

// -- Landlord lease items ---------------------------------------------------------
// Universal spine plus the landlord-side lease execution and deposit sequence.

const LANDLORD_LEASE_ITEMS = [
  ...universal.UNIVERSAL_ITEMS,
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
    id: 'signed_lease_copy_delivered',
    label: 'Signed Lease Copy Delivered to Tenant (21 days)',
    source: 'RTA',
    scope: 'transaction',
    evidence: 'document',
    reads: [],
  },
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
  {
    id: 'first_month_rent_received',
    label: 'First Month Rent Received',
    source: 'brokerage',
    scope: 'transaction',
    evidence: 'attestation',
    reads: [],
  },
  {
    id: 'keys_delivered',
    label: 'Keys Delivered on Closing',
    source: 'RTA',
    scope: 'transaction',
    evidence: 'attestation',
    reads: [],
  },
];

module.exports = {
  LANDLORD_LEASE_ITEMS,
};
