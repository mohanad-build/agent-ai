'use strict';

const universal = require('./universal');

// -- Landlord lease items ---------------------------------------------------------
// Universal spine only, for now. No landlord-lease-specific items yet.

const LANDLORD_LEASE_ITEMS = [
  ...universal.UNIVERSAL_ITEMS,
];

module.exports = {
  LANDLORD_LEASE_ITEMS,
};
