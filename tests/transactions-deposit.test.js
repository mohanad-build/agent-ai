'use strict';

const { HOLDING_SIDE_DEPOSIT_ITEMS, PAYING_SIDE_DEPOSIT_ITEMS } = require('../src/transactions/rules/deposit');
const { CATALOG } = require('../src/transactions/rules');

describe('HOLDING_SIDE_DEPOSIT_ITEMS', () => {
  it('has the three holding-side ids, in order', () => {
    expect(HOLDING_SIDE_DEPOSIT_ITEMS.map((item) => item.id)).toEqual([
      'deposit_slip_received',
      'deposit_forwarded_to_accounting',
      'brokerage_deposit_receipt_issued',
    ]);
  });

  it('has the three holding-side labels, in order', () => {
    expect(HOLDING_SIDE_DEPOSIT_ITEMS.map((item) => item.label)).toEqual([
      'Deposit Slip Received',
      'Deposit Forwarded to Brokerage Accounting',
      'Brokerage Deposit Receipt Issued',
    ]);
  });

  it('no holding item has omitWhenDoubleEnded at all', () => {
    HOLDING_SIDE_DEPOSIT_ITEMS.forEach((item) => {
      expect(item).not.toHaveProperty('omitWhenDoubleEnded');
    });
  });
});

describe('PAYING_SIDE_DEPOSIT_ITEMS', () => {
  it('has the three paying-side ids, in order', () => {
    expect(PAYING_SIDE_DEPOSIT_ITEMS.map((item) => item.id)).toEqual([
      'deposit_obtained_from_client',
      'deposit_delivered_to_listing_agent',
      'brokerage_deposit_receipt_received',
    ]);
  });

  it('has the three paying-side labels, in order', () => {
    expect(PAYING_SIDE_DEPOSIT_ITEMS.map((item) => item.label)).toEqual([
      'Deposit Obtained from Client',
      'Deposit Delivered to Listing Agent',
      'Brokerage Deposit Receipt Received',
    ]);
  });

  it('every paying item has omitWhenDoubleEnded exactly true', () => {
    PAYING_SIDE_DEPOSIT_ITEMS.forEach((item) => {
      expect(item.omitWhenDoubleEnded).toBe(true);
    });
  });
});

describe('deposit ids per type', () => {
  const DEPOSIT_ID_SET = new Set([
    'deposit_slip_received',
    'deposit_forwarded_to_accounting',
    'brokerage_deposit_receipt_issued',
    'deposit_obtained_from_client',
    'deposit_delivered_to_listing_agent',
    'brokerage_deposit_receipt_received',
  ]);

  const EXPECTED_DEPOSIT_IDS = {
    buyer_purchase: ['deposit_obtained_from_client', 'deposit_delivered_to_listing_agent', 'brokerage_deposit_receipt_received'],
    tenant_lease: ['deposit_obtained_from_client', 'deposit_delivered_to_listing_agent', 'brokerage_deposit_receipt_received'],
    seller_sale: ['deposit_slip_received', 'deposit_forwarded_to_accounting', 'brokerage_deposit_receipt_issued'],
    landlord_lease: ['deposit_slip_received', 'deposit_forwarded_to_accounting', 'brokerage_deposit_receipt_issued'],
    seller_listing: [],
    landlord_listing: [],
  };

  Object.keys(EXPECTED_DEPOSIT_IDS).forEach((type) => {
    it(`${type} carries exactly its expected deposit ids, in catalog order`, () => {
      const depositIds = CATALOG[type]
        .filter((item) => DEPOSIT_ID_SET.has(item.id))
        .map((item) => item.id);
      expect(depositIds).toEqual(EXPECTED_DEPOSIT_IDS[type]);
    });
  });
});

describe('deposit chain is contiguous on each deal type', () => {
  const DEAL_TYPES = ['buyer_purchase', 'tenant_lease', 'seller_sale', 'landlord_lease'];
  const CHAIN_IDS_BY_TYPE = {
    buyer_purchase: ['deposit_obtained_from_client', 'deposit_delivered_to_listing_agent', 'brokerage_deposit_receipt_received'],
    tenant_lease: ['deposit_obtained_from_client', 'deposit_delivered_to_listing_agent', 'brokerage_deposit_receipt_received'],
    seller_sale: ['deposit_slip_received', 'deposit_forwarded_to_accounting', 'brokerage_deposit_receipt_issued'],
    landlord_lease: ['deposit_slip_received', 'deposit_forwarded_to_accounting', 'brokerage_deposit_receipt_issued'],
  };

  DEAL_TYPES.forEach((type) => {
    it(`${type}'s three deposit items sit at consecutive indexes`, () => {
      const [firstId, secondId, thirdId] = CHAIN_IDS_BY_TYPE[type];
      const ids = CATALOG[type].map((item) => item.id);
      const firstIndex = ids.indexOf(firstId);
      const secondIndex = ids.indexOf(secondId);
      const thirdIndex = ids.indexOf(thirdId);

      expect(secondIndex).toBe(firstIndex + 1);
      expect(thirdIndex).toBe(secondIndex + 1);
    });
  });
});
