'use strict';

const buyerPurchase = require('./buyerPurchase');
const tenantLease = require('./tenantLease');
const landlordLease = require('./landlordLease');
const sellerSale = require('./sellerSale');
const sellerListing = require('./sellerListing');
const landlordListing = require('./landlordListing');

// -- Catalog assembly -----------------------------------------------------------

const CATALOG = {
  buyer_purchase: buyerPurchase.BUYER_PURCHASE_ITEMS,
  tenant_lease: tenantLease.TENANT_LEASE_ITEMS,
  landlord_lease: landlordLease.LANDLORD_LEASE_ITEMS,
  seller_sale: sellerSale.SELLER_SALE_ITEMS,
  seller_listing: sellerListing.SELLER_LISTING_ITEMS,
  landlord_listing: landlordListing.LANDLORD_LISTING_ITEMS,
};

function deepFreeze(value) {
  Object.getOwnPropertyNames(value).forEach((key) => {
    const child = value[key];
    if (child && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  });
  return Object.freeze(value);
}

deepFreeze(CATALOG);

module.exports = {
  CATALOG,
};
