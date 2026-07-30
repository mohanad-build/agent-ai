'use strict';

const buyerPurchase = require('./buyerPurchase');
const tenantLease = require('./tenantLease');

// -- Catalog assembly -----------------------------------------------------------

const CATALOG = {
  buyer_purchase: buyerPurchase.BUYER_PURCHASE_ITEMS,
  tenant_lease: tenantLease.TENANT_LEASE_ITEMS,
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
