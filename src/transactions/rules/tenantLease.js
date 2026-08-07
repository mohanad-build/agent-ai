'use strict';

const universal = require('./universal');
const terminal = require('./terminal');

// -- Tenant lease items ---------------------------------------------------------
// Universal spine plus the tenant-side lease execution and deposit sequence.

const TENANT_LEASE_ITEMS = [
  ...universal.UNIVERSAL_ITEMS,
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
