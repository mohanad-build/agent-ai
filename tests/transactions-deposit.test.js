'use strict';

const {
  HOLDING_SIDE_DEPOSIT_ITEMS,
  PAYING_SIDE_DEPOSIT_ITEMS,
  HOLDING_SIDE_ADDITIONAL_DEPOSIT_ITEMS,
  PAYING_SIDE_ADDITIONAL_DEPOSIT_ITEMS,
  chainEndingAt,
} = require('../src/transactions/rules/deposit');
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

describe('HOLDING_SIDE_ADDITIONAL_DEPOSIT_ITEMS', () => {
  it('has the one holding-side additional deposit id', () => {
    expect(HOLDING_SIDE_ADDITIONAL_DEPOSIT_ITEMS.map((item) => item.id)).toEqual([
      'additional_deposit_receipt_issued',
    ]);
  });

  it('has the one holding-side additional deposit label', () => {
    expect(HOLDING_SIDE_ADDITIONAL_DEPOSIT_ITEMS.map((item) => item.label)).toEqual([
      'Additional Deposit Receipt Issued',
    ]);
  });

  it('has no omitWhenDoubleEnded property', () => {
    HOLDING_SIDE_ADDITIONAL_DEPOSIT_ITEMS.forEach((item) => {
      expect(item).not.toHaveProperty('omitWhenDoubleEnded');
    });
  });
});

describe('PAYING_SIDE_ADDITIONAL_DEPOSIT_ITEMS', () => {
  it('has the one paying-side additional deposit id', () => {
    expect(PAYING_SIDE_ADDITIONAL_DEPOSIT_ITEMS.map((item) => item.id)).toEqual([
      'additional_deposit_receipt_received',
    ]);
  });

  it('has the one paying-side additional deposit label', () => {
    expect(PAYING_SIDE_ADDITIONAL_DEPOSIT_ITEMS.map((item) => item.label)).toEqual([
      'Additional Deposit Receipt Received',
    ]);
  });

  it('has omitWhenDoubleEnded exactly true', () => {
    PAYING_SIDE_ADDITIONAL_DEPOSIT_ITEMS.forEach((item) => {
      expect(item.omitWhenDoubleEnded).toBe(true);
    });
  });
});

describe('additional deposit ids per type', () => {
  const ADDITIONAL_DEPOSIT_ID_SET = new Set([
    'additional_deposit_receipt_issued',
    'additional_deposit_receipt_received',
  ]);

  const EXPECTED_ADDITIONAL_DEPOSIT_IDS = {
    buyer_purchase: ['additional_deposit_receipt_received'],
    seller_sale: ['additional_deposit_receipt_issued'],
    tenant_lease: [],
    landlord_lease: [],
    seller_listing: [],
    landlord_listing: [],
  };

  Object.keys(EXPECTED_ADDITIONAL_DEPOSIT_IDS).forEach((type) => {
    it(`${type} carries exactly its expected additional-deposit ids, in catalog order`, () => {
      const additionalDepositIds = CATALOG[type]
        .filter((item) => ADDITIONAL_DEPOSIT_ID_SET.has(item.id))
        .map((item) => item.id);
      expect(additionalDepositIds).toEqual(EXPECTED_ADDITIONAL_DEPOSIT_IDS[type]);
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

describe('chainEndingAt', () => {
  it('each of the four receipt ids returns its full chain, in catalog order', () => {
    expect(chainEndingAt('brokerage_deposit_receipt_issued')).toEqual([
      'deposit_slip_received',
      'deposit_forwarded_to_accounting',
      'brokerage_deposit_receipt_issued',
    ]);
    expect(chainEndingAt('brokerage_deposit_receipt_received')).toEqual([
      'deposit_obtained_from_client',
      'deposit_delivered_to_listing_agent',
      'brokerage_deposit_receipt_received',
    ]);
    expect(chainEndingAt('additional_deposit_receipt_issued')).toEqual([
      'additional_deposit_receipt_issued',
    ]);
    expect(chainEndingAt('additional_deposit_receipt_received')).toEqual([
      'additional_deposit_receipt_received',
    ]);
  });

  it('a mid-chain id (deposit_slip_received) returns null', () => {
    expect(chainEndingAt('deposit_slip_received')).toBeNull();
  });

  it('an unknown id returns null', () => {
    expect(chainEndingAt('not_a_real_item')).toBeNull();
  });

  it('the returned array is frozen', () => {
    expect(Object.isFrozen(chainEndingAt('brokerage_deposit_receipt_issued'))).toBe(true);
  });
});
