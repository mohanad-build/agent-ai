'use strict';

const universal = require('./universal');

// -- Landlord listing items ---------------------------------------------------

const LANDLORD_LISTING_ITEMS = [
  ...universal.UNIVERSAL_ITEMS,
  {
    id: 'listing_agreement_lease',
    label: 'Listing Agreement (Lease), in writing with remuneration method stated',
    source: 'TRESA',
    scope: 'transaction',
    evidence: 'document',
    reads: [],
  },
];

module.exports = {
  LANDLORD_LISTING_ITEMS,
};
