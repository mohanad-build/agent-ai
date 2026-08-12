'use strict';

const universal = require('./universal');

// -- Seller listing items ------------------------------------------------------

const SELLER_LISTING_ITEMS = [
  ...universal.UNIVERSAL_ITEMS,
  {
    id: 'listing_agreement',
    label: 'Listing Agreement, in writing with remuneration method stated',
    source: 'TRESA',
    scope: 'transaction',
    evidence: 'document',
    reads: [],
  },
];

module.exports = {
  SELLER_LISTING_ITEMS,
};
