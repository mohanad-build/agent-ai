'use strict';

const universal = require('./universal');

// -- Tenant lease items ---------------------------------------------------------
// Universal spine plus the tenant-lease-specific last month rent deposit.

const TENANT_LEASE_ITEMS = [
  ...universal.UNIVERSAL_ITEMS,
  {
    id: 'last_month_rent_deposit',
    label: 'Last Month Rent Deposit',
    source: 'RTA',
    scope: 'transaction',
    evidence: 'document',
    reads: [],
  },
];

module.exports = {
  TENANT_LEASE_ITEMS,
};
