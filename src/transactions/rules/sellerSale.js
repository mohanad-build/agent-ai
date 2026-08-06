'use strict';

const universal = require('./universal');

// -- Seller sale items ---------------------------------------------------------
// Universal spine plus the seller-side listing agreement.

const SELLER_SALE_ITEMS = [
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
  SELLER_SALE_ITEMS,
};
