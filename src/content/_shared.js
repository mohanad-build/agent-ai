'use strict';

const RATE_DISCLAIMER_BLOCK =
  '*Not financial or rate advice. Consult a licensed mortgage professional for personal guidance.*';

const VALID_THEME_TAGS = new Set([
  'rates', 'supply', 'prices', 'sales_volume',
  'buyer_psychology', 'seller_psychology', 'regulation', 'economy',
]);

module.exports = {
  RATE_DISCLAIMER_BLOCK,
  VALID_THEME_TAGS,
};
