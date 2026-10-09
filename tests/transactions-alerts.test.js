'use strict';

const { alertsForTransaction } = require('../src/transactions/alerts');

const NOW = new Date('2026-10-06T11:00:00Z');

const BASE_FACTS = {
  conditions: ['financing', 'status_certificate'],
  conditionDates: { financing: '2026-10-08', status_certificate: '2026-10-05' },
  acceptedDate: '2026-10-04',
  additionalDepositDueDates: [],
  hasSelfRepresentedParty: false,
  entityType: 'individual',
  representationArrangement: 'single',
};

function baseTransaction(overrides = {}) {
  return {
    transactionId: 'txn-1',
    agentId: 'test-agent',
    type: 'buyer_purchase',
    state: 'conditional',
    address: '12 Main St',
    facts: { ...BASE_FACTS },
    items: {},
    filings: {},
    events: [],
    ...overrides,
  };
}

describe('alertsForTransaction', () => {
  it('1. today 2026-10-06: financing is daysUntil 2 (no heads-up), passed and deposit overdue carry their delivery keys', () => {
    const transaction = baseTransaction({ facts: { ...BASE_FACTS } });

    const result = alertsForTransaction(transaction, { today: '2026-10-06', now: NOW, delivered: {} });

    expect(result).toEqual([
      {
        kind: 'condition_passed',
        transactionId: 'txn-1',
        address: '12 Main St',
        condition: 'status_certificate',
        itemId: 'status_certificate_review',
        date: '2026-10-05',
        daysPast: 1,
        deliveryKeys: ['condition_passed:status_certificate:2026-10-05:1'],
      },
      {
        kind: 'deposit_overdue',
        transactionId: 'txn-1',
        address: '12 Main St',
        itemId: 'brokerage_deposit_receipt_received',
        stuckAt: 'deposit_obtained_from_client',
        date: '2026-10-04',
        daysPast: 2,
        deliveryKeys: ['deposit_overdue:2026-10-04:2'],
      },
    ]);
  });

  it('2. today 2026-10-07: financing condition_heads_up, plus status_certificate and deposit now past their day-1/day-2 thresholds under >=', () => {
    const transaction = baseTransaction();

    const result = alertsForTransaction(transaction, { today: '2026-10-07', now: NOW, delivered: {} });

    expect(result).toEqual([
      {
        kind: 'condition_heads_up',
        transactionId: 'txn-1',
        address: '12 Main St',
        condition: 'financing',
        itemId: 'financing_condition',
        date: '2026-10-08',
        daysUntil: 1,
        deliveryKeys: [],
      },
      {
        kind: 'condition_passed',
        transactionId: 'txn-1',
        address: '12 Main St',
        condition: 'status_certificate',
        itemId: 'status_certificate_review',
        date: '2026-10-05',
        daysPast: 2,
        deliveryKeys: ['condition_passed:status_certificate:2026-10-05:1'],
      },
      {
        kind: 'deposit_overdue',
        transactionId: 'txn-1',
        address: '12 Main St',
        itemId: 'brokerage_deposit_receipt_received',
        stuckAt: 'deposit_obtained_from_client',
        date: '2026-10-04',
        daysPast: 3,
        deliveryKeys: ['deposit_overdue:2026-10-04:2'],
      },
    ]);
  });

  it('3. today 2026-10-09: status_certificate has sailed past both thresholds (1 and 4) and collapses into one alert with both keys; deposit has also passed its day-2 threshold', () => {
    const transaction = baseTransaction();

    const result = alertsForTransaction(transaction, { today: '2026-10-09', now: NOW, delivered: {} });

    expect(result).toEqual([
      {
        kind: 'condition_passed',
        transactionId: 'txn-1',
        address: '12 Main St',
        condition: 'financing',
        itemId: 'financing_condition',
        date: '2026-10-08',
        daysPast: 1,
        deliveryKeys: ['condition_passed:financing:2026-10-08:1'],
      },
      {
        kind: 'condition_passed',
        transactionId: 'txn-1',
        address: '12 Main St',
        condition: 'status_certificate',
        itemId: 'status_certificate_review',
        date: '2026-10-05',
        daysPast: 4,
        deliveryKeys: [
          'condition_passed:status_certificate:2026-10-05:1',
          'condition_passed:status_certificate:2026-10-05:4',
        ],
      },
      {
        kind: 'deposit_overdue',
        transactionId: 'txn-1',
        address: '12 Main St',
        itemId: 'brokerage_deposit_receipt_received',
        stuckAt: 'deposit_obtained_from_client',
        date: '2026-10-04',
        daysPast: 5,
        deliveryKeys: ['deposit_overdue:2026-10-04:2'],
      },
    ]);
  });

  it('4. today 2026-10-11: deposit daysPast 7, both thresholds (2 and 7) undelivered, collapse into one alert', () => {
    const transaction = baseTransaction({
      facts: { conditions: [], additionalDepositDueDates: [], acceptedDate: '2026-10-04' },
    });

    const result = alertsForTransaction(transaction, { today: '2026-10-11', now: NOW, delivered: {} });

    expect(result).toEqual([
      {
        kind: 'deposit_overdue',
        transactionId: 'txn-1',
        address: '12 Main St',
        itemId: 'brokerage_deposit_receipt_received',
        stuckAt: 'deposit_obtained_from_client',
        date: '2026-10-04',
        daysPast: 7,
        deliveryKeys: ['deposit_overdue:2026-10-04:2', 'deposit_overdue:2026-10-04:7'],
      },
    ]);
  });

  it('5. today 2026-10-06, all three rows completed: no alerts', () => {
    const transaction = baseTransaction({
      items: {
        financing_condition: { completed: true, completedAt: '2026-10-01T00:00:00.000Z' },
        status_certificate_review: { completed: true, completedAt: '2026-10-01T00:00:00.000Z' },
        brokerage_deposit_receipt_received: { completed: true, completedAt: '2026-10-01T00:00:00.000Z' },
      },
    });

    const result = alertsForTransaction(transaction, { today: '2026-10-06', now: NOW, delivered: {} });

    expect(result).toEqual([]);
  });

  it('6. today 2026-10-06, only deposit_obtained_from_client completed: stuckAt moves to the next row', () => {
    const transaction = baseTransaction({
      items: {
        deposit_obtained_from_client: { completed: true, completedAt: '2026-10-01T00:00:00.000Z' },
      },
    });

    const result = alertsForTransaction(transaction, { today: '2026-10-06', now: NOW, delivered: {} });

    expect(result).toEqual([
      {
        kind: 'condition_passed',
        transactionId: 'txn-1',
        address: '12 Main St',
        condition: 'status_certificate',
        itemId: 'status_certificate_review',
        date: '2026-10-05',
        daysPast: 1,
        deliveryKeys: ['condition_passed:status_certificate:2026-10-05:1'],
      },
      {
        kind: 'deposit_overdue',
        transactionId: 'txn-1',
        address: '12 Main St',
        itemId: 'brokerage_deposit_receipt_received',
        stuckAt: 'deposit_delivered_to_listing_agent',
        date: '2026-10-04',
        daysPast: 2,
        deliveryKeys: ['deposit_overdue:2026-10-04:2'],
      },
    ]);
  });

  it('7. today 2026-10-06, status_certificate_receipt completed but not review: passed alert still fires', () => {
    const transaction = baseTransaction({
      items: {
        status_certificate_receipt: { completed: true, completedAt: '2026-10-01T00:00:00.000Z' },
      },
    });

    const result = alertsForTransaction(transaction, { today: '2026-10-06', now: NOW, delivered: {} });

    expect(result).toEqual([
      {
        kind: 'condition_passed',
        transactionId: 'txn-1',
        address: '12 Main St',
        condition: 'status_certificate',
        itemId: 'status_certificate_review',
        date: '2026-10-05',
        daysPast: 1,
        deliveryKeys: ['condition_passed:status_certificate:2026-10-05:1'],
      },
      {
        kind: 'deposit_overdue',
        transactionId: 'txn-1',
        address: '12 Main St',
        itemId: 'brokerage_deposit_receipt_received',
        stuckAt: 'deposit_obtained_from_client',
        date: '2026-10-04',
        daysPast: 2,
        deliveryKeys: ['deposit_overdue:2026-10-04:2'],
      },
    ]);
  });

  it('8. an orphan conditionDate for a condition no longer listed is ignored', () => {
    const transaction = baseTransaction({
      facts: {
        conditions: ['financing'],
        conditionDates: { financing: '2026-10-07', inspection: '2026-10-07' },
        additionalDepositDueDates: [],
      },
    });

    const result = alertsForTransaction(transaction, { today: '2026-10-06', now: NOW, delivered: {} });

    expect(result).toEqual([
      {
        kind: 'condition_heads_up',
        transactionId: 'txn-1',
        address: '12 Main St',
        condition: 'financing',
        itemId: 'financing_condition',
        date: '2026-10-07',
        daysUntil: 1,
        deliveryKeys: [],
      },
    ]);
  });

  describe('condition_heads_up: day-before and day-of window (commit 1)', () => {
    function headsUpWindowTransaction(conditionDate, overrides = {}) {
      return baseTransaction({
        facts: {
          conditions: ['financing'],
          conditionDates: { financing: conditionDate },
          additionalDepositDueDates: [],
        },
        ...overrides,
      });
    }

    it('a. condition date 2 days away: no heads-up', () => {
      const transaction = headsUpWindowTransaction('2026-10-08');

      const result = alertsForTransaction(transaction, { today: '2026-10-06', now: NOW, delivered: {} });

      expect(result).toEqual([]);
    });

    it('b. condition date 1 day away: one condition_heads_up with daysUntil 1', () => {
      const transaction = headsUpWindowTransaction('2026-10-07');

      const result = alertsForTransaction(transaction, { today: '2026-10-06', now: NOW, delivered: {} });

      expect(result).toEqual([
        {
          kind: 'condition_heads_up',
          transactionId: 'txn-1',
          address: '12 Main St',
          condition: 'financing',
          itemId: 'financing_condition',
          date: '2026-10-07',
          daysUntil: 1,
          deliveryKeys: [],
        },
      ]);
    });

    it('c. condition date is today: one condition_heads_up with daysUntil 0', () => {
      const transaction = headsUpWindowTransaction('2026-10-06');

      const result = alertsForTransaction(transaction, { today: '2026-10-06', now: NOW, delivered: {} });

      expect(result).toEqual([
        {
          kind: 'condition_heads_up',
          transactionId: 'txn-1',
          address: '12 Main St',
          condition: 'financing',
          itemId: 'financing_condition',
          date: '2026-10-06',
          daysUntil: 0,
          deliveryKeys: [],
        },
      ]);
    });

    it('d. condition date 1 day after today: condition_passed, no heads-up', () => {
      const transaction = headsUpWindowTransaction('2026-10-05');

      const result = alertsForTransaction(transaction, { today: '2026-10-06', now: NOW, delivered: {} });

      expect(result).toEqual([
        {
          kind: 'condition_passed',
          transactionId: 'txn-1',
          address: '12 Main St',
          condition: 'financing',
          itemId: 'financing_condition',
          date: '2026-10-05',
          daysPast: 1,
          deliveryKeys: ['condition_passed:financing:2026-10-05:1'],
        },
      ]);
    });

    it('e. condition date is today, but the row is already completed: no alert', () => {
      const transaction = headsUpWindowTransaction('2026-10-06', {
        items: {
          financing_condition: { completed: true, completedAt: '2026-10-01T00:00:00.000Z' },
        },
      });

      const result = alertsForTransaction(transaction, { today: '2026-10-06', now: NOW, delivered: {} });

      expect(result).toEqual([]);
    });
  });

  describe('overdue thresholds use >= and the delivered record (commit 3)', () => {
    function depositOnlyTransaction(acceptedDate, overrides = {}) {
      return baseTransaction({
        facts: { conditions: [], additionalDepositDueDates: [], acceptedDate },
        ...overrides,
      });
    }

    it('deposit day 3, nothing delivered: fires once carrying only the day-2 key', () => {
      const transaction = depositOnlyTransaction('2026-10-01');

      const result = alertsForTransaction(transaction, { today: '2026-10-04', now: NOW, delivered: {} });

      expect(result).toEqual([
        {
          kind: 'deposit_overdue',
          transactionId: 'txn-1',
          address: '12 Main St',
          itemId: 'brokerage_deposit_receipt_received',
          stuckAt: 'deposit_obtained_from_client',
          date: '2026-10-01',
          daysPast: 3,
          deliveryKeys: ['deposit_overdue:2026-10-01:2'],
        },
      ]);
    });

    it('deposit day 3, day-2 key already delivered: silent', () => {
      const transaction = depositOnlyTransaction('2026-10-01');
      const delivered = { 'deposit_overdue:2026-10-01:2': '2026-10-03' };

      const result = alertsForTransaction(transaction, { today: '2026-10-04', now: NOW, delivered });

      expect(result).toEqual([]);
    });

    it('deposit day 9, nothing delivered: fires once carrying both the day-2 and day-7 keys', () => {
      const transaction = depositOnlyTransaction('2026-10-01');

      const result = alertsForTransaction(transaction, { today: '2026-10-10', now: NOW, delivered: {} });

      expect(result).toEqual([
        {
          kind: 'deposit_overdue',
          transactionId: 'txn-1',
          address: '12 Main St',
          itemId: 'brokerage_deposit_receipt_received',
          stuckAt: 'deposit_obtained_from_client',
          date: '2026-10-01',
          daysPast: 9,
          deliveryKeys: ['deposit_overdue:2026-10-01:2', 'deposit_overdue:2026-10-01:7'],
        },
      ]);
    });

    it('deposit day 9, day-2 key already delivered: fires with only the day-7 key', () => {
      const transaction = depositOnlyTransaction('2026-10-01');
      const delivered = { 'deposit_overdue:2026-10-01:2': '2026-10-03' };

      const result = alertsForTransaction(transaction, { today: '2026-10-10', now: NOW, delivered });

      expect(result).toEqual([
        {
          kind: 'deposit_overdue',
          transactionId: 'txn-1',
          address: '12 Main St',
          itemId: 'brokerage_deposit_receipt_received',
          stuckAt: 'deposit_obtained_from_client',
          date: '2026-10-01',
          daysPast: 9,
          deliveryKeys: ['deposit_overdue:2026-10-01:7'],
        },
      ]);
    });

    it('deposit receipt already completed: silent regardless of delivered', () => {
      const transaction = depositOnlyTransaction('2026-10-01', {
        items: { brokerage_deposit_receipt_received: { completed: true, completedAt: '2026-10-02T00:00:00.000Z' } },
      });

      const result = alertsForTransaction(transaction, { today: '2026-10-10', now: NOW, delivered: {} });

      expect(result).toEqual([]);
    });

    it('an amended condition date fires again even though the old date was fully delivered', () => {
      const transaction = baseTransaction({
        facts: {
          conditions: ['financing'],
          conditionDates: { financing: '2026-10-05' },
          additionalDepositDueDates: [],
        },
      });
      // The OLD date's key is delivered; the condition date was since amended
      // to a new value, which has never been delivered under its own key.
      const delivered = { 'condition_passed:financing:2026-10-01:1': '2026-10-02' };

      const result = alertsForTransaction(transaction, { today: '2026-10-06', now: NOW, delivered });

      expect(result).toEqual([
        {
          kind: 'condition_passed',
          transactionId: 'txn-1',
          address: '12 Main St',
          condition: 'financing',
          itemId: 'financing_condition',
          date: '2026-10-05',
          daysPast: 1,
          deliveryKeys: ['condition_passed:financing:2026-10-05:1'],
        },
      ]);
    });

    it('delivered missing throws', () => {
      const transaction = depositOnlyTransaction('2026-10-01');

      expect(() => alertsForTransaction(transaction, { today: '2026-10-04', now: NOW }))
        .toThrow('alertsForTransaction: delivered must be a plain object');
    });

    it('delivered as an array throws', () => {
      const transaction = depositOnlyTransaction('2026-10-01');

      expect(() => alertsForTransaction(transaction, { today: '2026-10-04', now: NOW, delivered: [] }))
        .toThrow('alertsForTransaction: delivered must be a plain object');
    });
  });

  it('9. a terminal state produces no alerts at all', () => {
    const transaction = baseTransaction({ state: 'collapsed' });

    const result = alertsForTransaction(transaction, { today: '2026-10-06', now: NOW, delivered: {} });

    expect(result).toEqual([]);
  });

  it('10. seller_sale double-ended watches the holding-side receipt', () => {
    const transaction = {
      transactionId: 'txn-10',
      agentId: 'test-agent',
      type: 'seller_sale',
      state: 'conditional',
      address: '34 Oak Ave',
      facts: {
        conditions: [],
        acceptedDate: '2026-10-04',
        additionalDepositDueDates: [],
        representationArrangement: 'double_ended',
      },
      items: {},
      filings: {},
      events: [],
    };

    const result = alertsForTransaction(transaction, { today: '2026-10-06', now: NOW, delivered: {} });

    expect(result).toEqual([
      {
        kind: 'deposit_overdue',
        transactionId: 'txn-10',
        address: '34 Oak Ave',
        itemId: 'brokerage_deposit_receipt_issued',
        stuckAt: 'deposit_slip_received',
        date: '2026-10-04',
        daysPast: 2,
        deliveryKeys: ['deposit_overdue:2026-10-04:2'],
      },
    ]);
  });

  it('11. additional deposit overdue fires on the due date, and not when there is none', () => {
    const transactionWithDate = {
      transactionId: 'txn-11',
      agentId: 'test-agent',
      type: 'seller_sale',
      state: 'conditional',
      address: '56 Pine Rd',
      facts: {
        conditions: [],
        additionalDepositDueDates: ['2026-11-01'],
      },
      items: {},
      filings: {},
      events: [],
    };

    const result = alertsForTransaction(transactionWithDate, { today: '2026-11-03', now: NOW, delivered: {} });

    expect(result).toEqual([
      {
        kind: 'additional_deposit_overdue',
        transactionId: 'txn-11',
        address: '56 Pine Rd',
        itemId: 'additional_deposit_receipt_issued',
        date: '2026-11-01',
        daysPast: 2,
        deliveryKeys: ['additional_deposit_overdue:2026-11-01:2'],
      },
    ]);

    const transactionWithoutDate = {
      ...transactionWithDate,
      facts: { ...transactionWithDate.facts, additionalDepositDueDates: [] },
    };

    const resultWithoutDate = alertsForTransaction(transactionWithoutDate, { today: '2026-11-03', now: NOW, delivered: {} });

    expect(resultWithoutDate).toEqual([]);
  });

  it('12. tenant_lease watches the paying-side receipt', () => {
    const transaction = {
      transactionId: 'txn-12',
      agentId: 'test-agent',
      type: 'tenant_lease',
      state: 'accepted',
      address: '78 Elm St',
      facts: {
        acceptedDate: '2026-10-04',
      },
      items: {},
      filings: {},
      events: [],
    };

    const result = alertsForTransaction(transaction, { today: '2026-10-06', now: NOW, delivered: {} });

    expect(result).toEqual([
      {
        kind: 'deposit_overdue',
        transactionId: 'txn-12',
        address: '78 Elm St',
        itemId: 'brokerage_deposit_receipt_received',
        stuckAt: 'deposit_obtained_from_client',
        date: '2026-10-04',
        daysPast: 2,
        deliveryKeys: ['deposit_overdue:2026-10-04:2'],
      },
    ]);
  });

  describe('13. filing_failed uses an instant window, not a calendar day', () => {
    const FILING_KEY = 'filing-key-1';

    function makeFilingTransaction(at) {
      return {
        transactionId: 'txn-13',
        agentId: 'test-agent',
        type: 'buyer_purchase',
        state: 'conditional',
        address: '90 Cedar Ct',
        facts: { conditions: [] },
        items: {},
        filings: {
          [FILING_KEY]: {
            messageId: 'msg-1',
            attachmentId: 'att-1',
            filename: 'aps.pdf',
            mimeType: 'application/pdf',
            size: 12345,
            threadId: 'thread-1',
            sender: 'buyer@example.com',
            receivedAt: '2026-10-05T10:00:00.000Z',
            subject: 'APS',
            status: 'abandoned',
            review: 'needs_review',
            seenAt: '2026-10-05T09:00:00.000Z',
            attempts: 3,
            lastError: 'too large',
          },
        },
        events: [
          {
            at,
            actor: 'system',
            kind: 'document_filing_abandoned',
            payload: { key: FILING_KEY, filename: 'aps.pdf', attempts: 3, lastError: 'too large' },
          },
        ],
      };
    }

    it('fires for an abandonment inside the 24h window', () => {
      const transaction = makeFilingTransaction('2026-10-05T19:00:00Z');

      const result = alertsForTransaction(transaction, { today: '2026-10-06', now: NOW, delivered: {} });

      expect(result).toEqual([
        {
          kind: 'filing_failed',
          transactionId: 'txn-13',
          address: '90 Cedar Ct',
          filingKey: FILING_KEY,
          filename: 'aps.pdf',
          threadId: 'thread-1',
          abandonedAt: '2026-10-05T19:00:00Z',
          lastError: 'too large',
          deliveryKeys: [],
        },
      ]);
    });

    it('fires for an abandonment exactly at now', () => {
      const transaction = makeFilingTransaction('2026-10-06T11:00:00Z');

      const result = alertsForTransaction(transaction, { today: '2026-10-06', now: NOW, delivered: {} });

      expect(result).toEqual([
        {
          kind: 'filing_failed',
          transactionId: 'txn-13',
          address: '90 Cedar Ct',
          filingKey: FILING_KEY,
          filename: 'aps.pdf',
          threadId: 'thread-1',
          abandonedAt: '2026-10-06T11:00:00Z',
          lastError: 'too large',
          deliveryKeys: [],
        },
      ]);
    });

    it('does not fire for an abandonment exactly 24h before now', () => {
      const transaction = makeFilingTransaction('2026-10-05T11:00:00Z');

      const result = alertsForTransaction(transaction, { today: '2026-10-06', now: NOW, delivered: {} });

      expect(result).toEqual([]);
    });

    it('does not fire for an abandonment just before the 24h window', () => {
      const transaction = makeFilingTransaction('2026-10-05T10:59:59Z');

      const result = alertsForTransaction(transaction, { today: '2026-10-06', now: NOW, delivered: {} });

      expect(result).toEqual([]);
    });
  });

  it('14. no acceptedDate, no conditions: no alerts', () => {
    const transaction = {
      transactionId: 'txn-14',
      agentId: 'test-agent',
      type: 'buyer_purchase',
      state: 'conditional',
      address: '21 Birch Blvd',
      facts: { conditions: [] },
      items: {},
      filings: {},
      events: [],
    };

    const result = alertsForTransaction(transaction, { today: '2026-10-06', now: NOW, delivered: {} });

    expect(result).toEqual([]);
  });

  it('16. a deal with no facts key at all returns no alerts and does not throw', () => {
    const transaction = {
      transactionId: 'txn-16',
      agentId: 'test-agent',
      type: 'buyer_purchase',
      state: 'conditional',
      address: '5 Maple Way',
    };

    const result = alertsForTransaction(transaction, { today: '2026-10-06', now: NOW, delivered: {} });

    expect(result).toEqual([]);
  });

  it('17. a deal with no facts key but an abandoned filing still surfaces the filing alert', () => {
    const FILING_KEY = 'filing-key-1';
    const transaction = {
      transactionId: 'txn-16',
      agentId: 'test-agent',
      type: 'buyer_purchase',
      state: 'conditional',
      address: '5 Maple Way',
      filings: {
        [FILING_KEY]: {
          messageId: 'msg-1',
          attachmentId: 'att-1',
          filename: 'aps.pdf',
          mimeType: 'application/pdf',
          size: 12345,
          threadId: 'thread-1',
          sender: 'buyer@example.com',
          receivedAt: '2026-10-05T10:00:00.000Z',
          subject: 'APS',
          status: 'abandoned',
          review: 'needs_review',
          seenAt: '2026-10-05T09:00:00.000Z',
          attempts: 3,
          lastError: 'too large',
        },
      },
      events: [
        {
          at: '2026-10-05T19:00:00Z',
          actor: 'system',
          kind: 'document_filing_abandoned',
          payload: { key: FILING_KEY, filename: 'aps.pdf', attempts: 3, lastError: 'too large' },
        },
      ],
    };

    const result = alertsForTransaction(transaction, { today: '2026-10-06', now: NOW, delivered: {} });

    expect(result).toEqual([
      {
        kind: 'filing_failed',
        transactionId: 'txn-16',
        address: '5 Maple Way',
        filingKey: FILING_KEY,
        filename: 'aps.pdf',
        threadId: 'thread-1',
        abandonedAt: '2026-10-05T19:00:00Z',
        lastError: 'too large',
        deliveryKeys: [],
      },
    ]);
  });

  describe('15. throws', () => {
    it("today '2026-02-30' throws", () => {
      const transaction = baseTransaction();

      expect(() => alertsForTransaction(transaction, { today: '2026-02-30', now: NOW }))
        .toThrow('alertsForTransaction: today must be a calendar date (YYYY-MM-DD)');
    });

    it("now = new Date('x') throws", () => {
      const transaction = baseTransaction();

      expect(() => alertsForTransaction(transaction, { today: '2026-10-06', now: new Date('x') }))
        .toThrow('alertsForTransaction: now must be a valid Date');
    });
  });
});
