'use strict';

const { collectDealAlerts } = require('../src/transactions/dealAlerts');

// Shared instant for every filing_failed fixture: all abandonedAt literals
// below are chosen to land inside (NOW - 24h, NOW] for whichever `now` the
// test passes, matching alerts.js's filing window.

function settledWith(transactions, unreadable = []) {
  return { transactions, unreadable };
}

// -- Minimal per-kind transaction builders, same shape as
// tests/transactions-alerts.test.js's literals: just enough facts for the
// one alert kind under test, nothing that would fire a second kind.

function conditionPassedTxn({ transactionId, address, conditionDate, today, driveFolderId }) {
  return {
    transactionId,
    agentId: 'test-agent',
    type: 'buyer_purchase',
    state: 'conditional',
    address,
    facts: {
      conditions: ['financing'],
      conditionDates: { financing: conditionDate },
      additionalDepositDueDates: [],
    },
    items: {},
    filings: {},
    events: [],
    ...(driveFolderId !== undefined ? { driveFolderId } : {}),
  };
}

function conditionHeadsUpTxn({ transactionId, address, conditionDate }) {
  return {
    transactionId,
    agentId: 'test-agent',
    type: 'buyer_purchase',
    state: 'conditional',
    address,
    facts: {
      conditions: ['financing'],
      conditionDates: { financing: conditionDate },
      additionalDepositDueDates: [],
    },
    items: {},
    filings: {},
    events: [],
  };
}

function depositOverdueTxn({ transactionId, address, acceptedDate }) {
  return {
    transactionId,
    agentId: 'test-agent',
    type: 'buyer_purchase',
    state: 'conditional',
    address,
    facts: {
      conditions: [],
      acceptedDate,
      additionalDepositDueDates: [],
    },
    items: {},
    filings: {},
    events: [],
  };
}

function additionalDepositOverdueTxn({ transactionId, address, dueDate }) {
  return {
    transactionId,
    agentId: 'test-agent',
    type: 'buyer_purchase',
    state: 'conditional',
    address,
    facts: {
      conditions: [],
      additionalDepositDueDates: [dueDate],
    },
    items: {},
    filings: {},
    events: [],
  };
}

function filingFailedTxn({ transactionId, address, abandonedAt }) {
  const filingKey = `${transactionId}-filing`;
  return {
    transactionId,
    agentId: 'test-agent',
    type: 'buyer_purchase',
    state: 'conditional',
    address,
    facts: { conditions: [] },
    items: {},
    filings: {
      [filingKey]: {
        filename: 'aps.pdf',
        threadId: 'thread-1',
        status: 'abandoned',
        lastError: 'too large',
      },
    },
    events: [
      {
        at: abandonedAt,
        actor: 'system',
        kind: 'document_filing_abandoned',
        payload: { key: filingKey, filename: 'aps.pdf', attempts: 1, lastError: 'too large' },
      },
    ],
  };
}

// A real, reachable throw inside alertsForTransaction's call chain
// (rules/conditions.js hasCondition), confirmed in the commit-1 recon:
// facts.conditions must be an array, and this type's catalog always
// evaluates that check.
function badConditionsTxn({ transactionId, address }) {
  return {
    transactionId,
    agentId: 'test-agent',
    type: 'buyer_purchase',
    state: 'conditional',
    address,
    facts: { conditions: 'nope' },
    items: {},
    filings: {},
    events: [],
  };
}

describe('collectDealAlerts', () => {
  it('adds type and driveFolderId (null when absent); the transaction is never mutated', () => {
    // Object.freeze: any attempted mutation of the transaction (e.g.
    // transaction.type = ...) throws a TypeError under strict mode, so
    // reaching the assertions below is itself proof nothing was written.
    const withFolder = Object.freeze(
      conditionPassedTxn({
        transactionId: 'txn-folder',
        address: '1 Folder Ave',
        conditionDate: '2026-10-06',
        driveFolderId: 'drive-folder-1',
      })
    );
    const withoutFolder = Object.freeze(
      conditionPassedTxn({
        transactionId: 'txn-nofolder',
        address: '2 Nofolder Ave',
        conditionDate: '2026-10-06',
      })
    );

    const result = collectDealAlerts(
      settledWith([withFolder, withoutFolder]),
      { today: '2026-10-10', now: new Date('2026-10-10T11:00:00Z'), delivered: {} }
    );

    const folderAlert = result.alerts.find((a) => a.transactionId === 'txn-folder');
    const noFolderAlert = result.alerts.find((a) => a.transactionId === 'txn-nofolder');

    expect(folderAlert.type).toBe('buyer_purchase');
    expect(folderAlert.driveFolderId).toBe('drive-folder-1');
    expect(noFolderAlert.type).toBe('buyer_purchase');
    expect(noFolderAlert.driveFolderId).toBeNull();
  });

  it('full rank order: one alert of every kind, across several deals, shuffled input order', () => {
    const today = '2026-10-10';
    const now = new Date('2026-10-10T11:00:00Z');

    const headsUp = conditionHeadsUpTxn({ transactionId: 'txn-hu', address: 'A Headsup Ln', conditionDate: '2026-10-11' }); // daysUntil 1
    const passed = conditionPassedTxn({ transactionId: 'txn-cp', address: 'B Passed Ave', conditionDate: '2026-10-06' });
    const depositOverdue7 = depositOverdueTxn({ transactionId: 'txn-d7', address: 'D Deposit7 St', acceptedDate: '2026-10-03' });
    const additionalOverdue2 = additionalDepositOverdueTxn({ transactionId: 'txn-ad2', address: 'E Addl2 Rd', dueDate: '2026-10-08' });
    const filingFailed = filingFailedTxn({ transactionId: 'txn-ff', address: 'C Filing Ct', abandonedAt: '2026-10-10T05:00:00Z' });

    // Shuffled: not in rank order, not in transactionId/address order either.
    const settled = settledWith([additionalOverdue2, filingFailed, passed, headsUp, depositOverdue7]);

    const result = collectDealAlerts(settled, { today, now, delivered: {} });

    expect(result.alerts.map((a) => a.transactionId)).toEqual([
      'txn-cp',  // rank 0: condition_passed
      'txn-d7',  // rank 1: deposit_overdue, daysPast 7
      'txn-ad2', // rank 1: additional_deposit_overdue, daysPast 2 (tie-break: smaller daysPast, so after txn-d7)
      'txn-hu',  // rank 2: condition_heads_up
      'txn-ff',  // rank 3: filing_failed
    ]);
    expect(result.alerts.map((a) => a.kind)).toEqual([
      'condition_passed',
      'deposit_overdue',
      'additional_deposit_overdue',
      'condition_heads_up',
      'filing_failed',
    ]);
  });

  it('condition_passed tie-break: larger daysPast first', () => {
    const today = '2026-10-10';
    const now = new Date('2026-10-10T11:00:00Z');

    // daysPast 1 and 4 are both real CONDITION_PASSED_DAYS_AFTER values
    // (alerts.js), so no stub is needed here.
    const daysPast1 = conditionPassedTxn({ transactionId: 'txn-p1', address: 'P1 St', conditionDate: '2026-10-09' });
    const daysPast4 = conditionPassedTxn({ transactionId: 'txn-p4', address: 'P4 St', conditionDate: '2026-10-06' });

    const result = collectDealAlerts(settledWith([daysPast1, daysPast4]), { today, now, delivered: {} });

    expect(result.alerts.map((a) => ({ transactionId: a.transactionId, daysPast: a.daysPast }))).toEqual([
      { transactionId: 'txn-p4', daysPast: 4 },
      { transactionId: 'txn-p1', daysPast: 1 },
    ]);
  });

  it('deposit_overdue and additional_deposit_overdue interleave by daysPast, not grouped by kind', () => {
    const today = '2026-10-10';
    const now = new Date('2026-10-10T11:00:00Z');

    // Real DEPOSIT_OVERDUE_DAYS_AFTER values (2 and 7, alerts.js), deliberately
    // reversed from the full-rank-order test's assignment: the additional
    // deposit (a different kind) carries the larger daysPast here, so it must
    // sort first despite not being a deposit_overdue, proving the two kinds
    // share one rank rather than deposit_overdue always leading.
    const deposit = depositOverdueTxn({ transactionId: 'txn-deposit-2', address: 'Deposit St', acceptedDate: '2026-10-08' });
    const additional = additionalDepositOverdueTxn({ transactionId: 'txn-additional-7', address: 'Additional St', dueDate: '2026-10-03' });

    const result = collectDealAlerts(settledWith([deposit, additional]), { today, now, delivered: {} });

    expect(result.alerts.map((a) => ({ kind: a.kind, transactionId: a.transactionId, daysPast: a.daysPast }))).toEqual([
      { kind: 'additional_deposit_overdue', transactionId: 'txn-additional-7', daysPast: 7 },
      { kind: 'deposit_overdue', transactionId: 'txn-deposit-2', daysPast: 2 },
    ]);
  });

  it('filing_failed tie-break: later abandonedAt first', () => {
    const today = '2026-10-10';
    const now = new Date('2026-10-10T11:00:00Z');

    const earlier = filingFailedTxn({ transactionId: 'txn-f-early', address: 'F Early St', abandonedAt: '2026-10-10T02:00:00Z' });
    const later = filingFailedTxn({ transactionId: 'txn-f-late', address: 'F Late St', abandonedAt: '2026-10-10T09:00:00Z' });

    const result = collectDealAlerts(settledWith([earlier, later]), { today, now, delivered: {} });

    expect(result.alerts.map((a) => a.transactionId)).toEqual(['txn-f-late', 'txn-f-early']);
  });

  it('final tie-break: same rank and within-rank value, ordered by address then transactionId', () => {
    const today = '2026-10-10';
    const now = new Date('2026-10-10T11:00:00Z');

    // Same daysPast (4), different addresses: address order wins.
    const zebra = conditionPassedTxn({ transactionId: 'txn-1', address: 'Zebra St', conditionDate: '2026-10-06' });
    const alpha = conditionPassedTxn({ transactionId: 'txn-2', address: 'Alpha St', conditionDate: '2026-10-06' });

    const byAddress = collectDealAlerts(settledWith([zebra, alpha]), { today, now, delivered: {} });
    expect(byAddress.alerts.map((a) => a.address)).toEqual(['Alpha St', 'Zebra St']);

    // Same daysPast (4), same address, different transactionId: transactionId order wins.
    const sameAddrB = conditionPassedTxn({ transactionId: 'txn-b', address: 'Shared St', conditionDate: '2026-10-06' });
    const sameAddrA = conditionPassedTxn({ transactionId: 'txn-a', address: 'Shared St', conditionDate: '2026-10-06' });

    const byTransactionId = collectDealAlerts(settledWith([sameAddrB, sameAddrA]), { today, now, delivered: {} });
    expect(byTransactionId.alerts.map((a) => a.transactionId)).toEqual(['txn-a', 'txn-b']);
  });

  it('activeCount: non-terminal deal types count; terminal deal types and listings in any state do not', () => {
    const today = '2026-10-10';
    const now = new Date('2026-10-10T11:00:00Z');

    const transactions = [
      // Non-terminal deal types: count.
      { transactionId: 'd1', type: 'buyer_purchase', state: 'conditional', address: '1 A St', facts: { conditions: [] }, items: {}, filings: {}, events: [] },
      { transactionId: 'd2', type: 'seller_sale', state: 'firm', address: '2 A St', facts: { conditions: [] }, items: {}, filings: {}, events: [] },
      { transactionId: 'd3', type: 'tenant_lease', state: 'accepted', address: '3 A St', facts: {}, items: {}, filings: {}, events: [] },
      { transactionId: 'd4', type: 'landlord_lease', state: 'signed', address: '4 A St', facts: {}, items: {}, filings: {}, events: [] },
      // Terminal deal types: do not count.
      { transactionId: 'd5', type: 'buyer_purchase', state: 'closed', address: '5 A St', facts: {}, items: {}, filings: {}, events: [] },
      { transactionId: 'd6', type: 'buyer_purchase', state: 'collapsed', address: '6 A St', facts: {}, items: {}, filings: {}, events: [] },
      { transactionId: 'd7', type: 'tenant_lease', state: 'collapsed', address: '7 A St', facts: {}, items: {}, filings: {}, events: [] },
      // Listings, non-terminal and terminal: never count.
      { transactionId: 'l1', type: 'seller_listing', state: 'live', address: '8 A St', facts: {}, items: {}, filings: {}, events: [] },
      { transactionId: 'l2', type: 'landlord_listing', state: 'preparing', address: '9 A St', facts: {}, items: {}, filings: {}, events: [] },
      { transactionId: 'l3', type: 'seller_listing', state: 'terminated', address: '10 A St', facts: {}, items: {}, filings: {}, events: [] },
    ];

    const result = collectDealAlerts(settledWith(transactions), { today, now, delivered: {} });

    expect(result.activeCount).toBe(4);
    expect(result.unreadable).toEqual([]);
  });

  it('unreadable: read failures pass through with stage "read", and the id is kept', () => {
    const result = collectDealAlerts(
      settledWith([], [{ transactionId: 'txn-missing', error: 'ENOENT' }]),
      { today: '2026-10-10', now: new Date('2026-10-10T11:00:00Z'), delivered: {} }
    );

    expect(result).toEqual({
      alerts: [],
      activeCount: 0,
      unreadable: [{ transactionId: 'txn-missing', error: 'ENOENT', stage: 'read' }],
      deliveries: [],
      keepTransactionIds: ['txn-missing'],
    });
  });

  it('unreadable: a throwing deal gets stage "alerts", still counts toward activeCount, and does not block the other deal\'s alerts', () => {
    const today = '2026-10-10';
    const now = new Date('2026-10-10T11:00:00Z');

    const broken = badConditionsTxn({ transactionId: 'txn-broken', address: 'Broken St' });
    const fine = conditionPassedTxn({ transactionId: 'txn-fine', address: 'Fine St', conditionDate: '2026-10-06' });

    const result = collectDealAlerts(settledWith([broken, fine]), { today, now, delivered: {} });

    expect(result.unreadable).toEqual([
      { transactionId: 'txn-broken', error: 'hasCondition: facts.conditions must be an array, got string', stage: 'alerts' },
    ]);
    expect(result.alerts.map((a) => a.transactionId)).toEqual(['txn-fine']);
    // broken is a non-terminal buyer_purchase, so it still counts even though
    // its own alerts threw.
    expect(result.activeCount).toBe(2);
  });

  it('keepTransactionIds: every non-terminal readable id plus every unreadable id (both stages); a terminal deal is excluded', () => {
    const today = '2026-10-10';
    const now = new Date('2026-10-10T11:00:00Z');

    const active = depositOverdueTxn({ transactionId: 'txn-active', address: 'Active St', acceptedDate: '2026-10-08' });
    const terminal = { ...depositOverdueTxn({ transactionId: 'txn-terminal', address: 'Terminal St', acceptedDate: '2026-10-08' }), state: 'closed' };
    // stage 'alerts': read fine, but its own alertsForTransaction call throws.
    // It must still be kept -- a deal collectDealAlerts can see is non-terminal
    // is not the same thing as a deal that closed.
    const broken = badConditionsTxn({ transactionId: 'txn-broken', address: 'Broken St' });

    const settled = settledWith(
      [active, terminal, broken],
      [{ transactionId: 'txn-missing', error: 'ENOENT' }] // stage 'read'
    );

    const result = collectDealAlerts(settled, { today, now, delivered: {} });

    expect(result.keepTransactionIds.slice().sort()).toEqual(['txn-active', 'txn-broken', 'txn-missing'].sort());
  });

  it('bad settled input throws with the collectDealAlerts prefix', () => {
    const opts = { today: '2026-10-10', now: new Date('2026-10-10T11:00:00Z') };

    expect(() => collectDealAlerts(null, opts)).toThrow('collectDealAlerts: settled must have array transactions and array unreadable');
    expect(() => collectDealAlerts({}, opts)).toThrow('collectDealAlerts: settled must have array transactions and array unreadable');
    expect(() => collectDealAlerts({ transactions: 'nope', unreadable: [] }, opts)).toThrow('collectDealAlerts:');
    expect(() => collectDealAlerts({ transactions: [], unreadable: 'nope' }, opts)).toThrow('collectDealAlerts:');
  });

  it('bad delivered input throws with the collectDealAlerts prefix, checked after settled is valid', () => {
    const settled = settledWith([]);

    expect(() => collectDealAlerts(settled, { today: '2026-10-10', now: new Date('2026-10-10T11:00:00Z') }))
      .toThrow('collectDealAlerts: delivered must be a plain object');
    expect(() => collectDealAlerts(settled, { today: '2026-10-10', now: new Date('2026-10-10T11:00:00Z'), delivered: [] }))
      .toThrow('collectDealAlerts: delivered must be a plain object');
  });

  it('empty settled result returns empty alerts, zero activeCount, empty unreadable, empty deliveries and keepTransactionIds', () => {
    const result = collectDealAlerts(settledWith([]), { today: '2026-10-10', now: new Date('2026-10-10T11:00:00Z'), delivered: {} });

    expect(result).toEqual({ alerts: [], activeCount: 0, unreadable: [], deliveries: [], keepTransactionIds: [] });
  });

  it('deliveries flattens every undelivered key across every deal, each tagged with its own transactionId', () => {
    const today = '2026-10-10';
    const now = new Date('2026-10-10T11:00:00Z');

    // daysPast 4: both the day-1 and day-4 thresholds have passed, so this
    // single alert carries two keys.
    const condTxn = conditionPassedTxn({ transactionId: 'txn-cond', address: 'A St', conditionDate: '2026-10-06' });
    // daysPast 2: one threshold, one key.
    const depTxn = depositOverdueTxn({ transactionId: 'txn-dep', address: 'B St', acceptedDate: '2026-10-08' });
    // Heads-up never contributes a key.
    const headsUpTxn = conditionHeadsUpTxn({ transactionId: 'txn-hu', address: 'C St', conditionDate: '2026-10-11' });

    const result = collectDealAlerts(settledWith([condTxn, depTxn, headsUpTxn]), { today, now, delivered: {} });

    expect(result.deliveries).toEqual([
      { transactionId: 'txn-cond', alertKey: 'condition_passed:financing:2026-10-06:1' },
      { transactionId: 'txn-cond', alertKey: 'condition_passed:financing:2026-10-06:4' },
      { transactionId: 'txn-dep', alertKey: 'deposit_overdue:2026-10-08:2' },
    ]);
  });

  // -- Cases real alerts.js constants cannot produce --------------------------------
  //
  // CONDITION_HEADS_UP_DAYS_BEFORE is a fixed two-value set ([1, 0]), so a
  // real condition_heads_up alert only ever carries daysUntil 1 or 0, never
  // 3. And since commit 3, DEPOSIT_OVERDUE_DAYS_AFTER's thresholds (2 and 7)
  // are compared with >=, not ===, so a real deposit alert CAN land at
  // daysPast 6 or 8 now (any day past a threshold does) -- what real data
  // still cannot produce is three deposit alerts at 6, 7 and 8 all missing
  // a deliveryKeys array, which is the shape these tie-break fixtures need.
  // These two tie-breaks and the unknown-kind guard need an injected
  // alertsForTransaction. jest.resetModules plus a scoped jest.doMock keeps
  // the stub out of every other test in this file (same pattern as
  // tests/googleRetry.test.js's auth-failure describe block).
  describe('stubbed alertsForTransaction (cases real alert data cannot produce)', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    function loadWithStubbedAlerts(alertsByTransactionId) {
      jest.doMock('../src/transactions/alerts', () => ({
        alertsForTransaction: (transaction) => alertsByTransactionId[transaction.transactionId] || [],
      }));
      return require('../src/transactions/dealAlerts');
    }

    it('never mutates the alert object alertsForTransaction returned', () => {
      // Frozen: if collectDealAlerts wrote type/driveFolderId onto this
      // object instead of spreading into a new one, this would throw a
      // TypeError under strict mode before the assertions ran.
      const original = Object.freeze({
        kind: 'condition_passed', transactionId: 'txn-frozen', address: '1 Frozen St', condition: 'financing', itemId: 'financing_condition', date: '2026-10-06', daysPast: 4,
        deliveryKeys: ['condition_passed:financing:2026-10-06:1', 'condition_passed:financing:2026-10-06:4'],
      });

      const { collectDealAlerts: collectStubbed } = loadWithStubbedAlerts({ 'txn-frozen': [original] });

      const transactions = [
        { transactionId: 'txn-frozen', type: 'buyer_purchase', state: 'conditional', address: '1 Frozen St', facts: {}, items: {}, filings: {}, events: [] },
      ];

      const result = collectStubbed(settledWith(transactions), { today: '2026-10-10', now: new Date('2026-10-10T11:00:00Z'), delivered: {} });

      expect(result.alerts).toHaveLength(1);
      expect(result.alerts[0]).not.toBe(original);
      expect(result.alerts[0]).toEqual({ ...original, type: 'buyer_purchase', driveFolderId: null });
      expect(Object.keys(original)).not.toContain('type');
      expect(Object.keys(original)).not.toContain('driveFolderId');
    });

    it('condition_heads_up tie-break: smaller daysUntil first', () => {
      const far = { kind: 'condition_heads_up', transactionId: 'txn-far', address: 'Far St', condition: 'financing', itemId: 'financing_condition', date: '2026-10-13', daysUntil: 3, deliveryKeys: [] };
      const near = { kind: 'condition_heads_up', transactionId: 'txn-near', address: 'Near St', condition: 'financing', itemId: 'financing_condition', date: '2026-10-11', daysUntil: 1, deliveryKeys: [] };

      const { collectDealAlerts: collectStubbed } = loadWithStubbedAlerts({
        'txn-far': [far],
        'txn-near': [near],
      });

      const transactions = [
        { transactionId: 'txn-far', type: 'buyer_purchase', state: 'conditional', address: 'Far St', facts: {}, items: {}, filings: {}, events: [] },
        { transactionId: 'txn-near', type: 'buyer_purchase', state: 'conditional', address: 'Near St', facts: {}, items: {}, filings: {}, events: [] },
      ];

      const result = collectStubbed(settledWith(transactions), { today: '2026-10-10', now: new Date('2026-10-10T11:00:00Z'), delivered: {} });

      expect(result.alerts.map((a) => a.transactionId)).toEqual(['txn-near', 'txn-far']);
    });

    it('deposits (daysPast 6, 7, 8) order by daysPast descending, one rank, no 7-day boundary', () => {
      const makeDeposit = (transactionId, address, daysPast) => ({
        kind: 'deposit_overdue', transactionId, address, itemId: 'brokerage_deposit_receipt_received', stuckAt: 'deposit_obtained_from_client', date: '2026-10-01', daysPast, deliveryKeys: [],
      });

      const { collectDealAlerts: collectStubbed } = loadWithStubbedAlerts({
        'txn-6': [makeDeposit('txn-6', '6 St', 6)],
        'txn-7': [makeDeposit('txn-7', '7 St', 7)],
        'txn-8': [makeDeposit('txn-8', '8 St', 8)],
      });

      const transactions = ['txn-6', 'txn-7', 'txn-8'].map((transactionId, i) => ({
        transactionId, type: 'buyer_purchase', state: 'conditional', address: `${i}`, facts: {}, items: {}, filings: {}, events: [],
      }));

      const result = collectStubbed(settledWith(transactions), { today: '2026-10-10', now: new Date('2026-10-10T11:00:00Z'), delivered: {} });

      // All three share rank 1; 6, 7 and 8 are just three daysPast values on
      // one continuous "larger first" ordering, with no boundary at 7.
      expect(result.alerts.map((a) => ({ transactionId: a.transactionId, daysPast: a.daysPast }))).toEqual([
        { transactionId: 'txn-8', daysPast: 8 },
        { transactionId: 'txn-7', daysPast: 7 },
        { transactionId: 'txn-6', daysPast: 6 },
      ]);
    });

    it('an unknown alert kind throws, prefixed with collectDealAlerts', () => {
      const { collectDealAlerts: collectStubbed } = loadWithStubbedAlerts({
        'txn-bogus': [{ kind: 'bogus_kind', transactionId: 'txn-bogus', address: '1 Bogus St', deliveryKeys: [] }],
      });

      const transactions = [
        { transactionId: 'txn-bogus', type: 'buyer_purchase', state: 'conditional', address: '1 Bogus St', facts: {}, items: {}, filings: {}, events: [] },
      ];

      expect(() => collectStubbed(settledWith(transactions), { today: '2026-10-10', now: new Date('2026-10-10T11:00:00Z'), delivered: {} }))
        .toThrow("collectDealAlerts: unknown alert kind 'bogus_kind'");
    });
  });
});
