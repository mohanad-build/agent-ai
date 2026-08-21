'use strict';

const { evaluateSignals, matchTransaction } = require('../src/transactions/matcher');
const { SIGNAL_KEYS, COUNTING_SIGNALS } = require('../src/transactions/matcher')._internal;

const THREAD_ID = 'thread-main';
const OTHER_THREAD_ID = 'thread-other';
const ADDRESS = '12 Main St';

const MATCHING_SUBJECT = 'The offer on 12 Main St is firm';
const MATCHING_BODY = 'The property at 12 Main St is under contract';
const MATCHING_FILENAME = '12_Main_St_Agreement.pdf';
const NON_MATCHING_SUBJECT = 'no address mentioned here';
const NON_MATCHING_FILENAME = '99_Other_Ave_Agreement.pdf';

function baseTransaction(overrides = {}) {
  return {
    type: 'buyer_purchase',
    state: 'conditional',
    address: ADDRESS,
    ...overrides,
  };
}

function baseMessage(overrides = {}) {
  return {
    threadId: THREAD_ID,
    addresses: [],
    ...overrides,
  };
}

// Drives met via signal D alone, independent of everything else on the
// transaction, so matchTransaction fixtures can be built without needing
// A, B or C to line up.
function metByD(threadId = THREAD_ID) {
  return { filings: { f1: { threadId, status: 'filed', review: 'confirmed' } } };
}

describe('evaluateSignals', () => {
  describe('each signal true in isolation', () => {
    it('A true alone gives met false', () => {
      const transaction = baseTransaction();
      const message = baseMessage({ subject: MATCHING_SUBJECT });

      const result = evaluateSignals(transaction, message);

      expect(result).toEqual({ met: false, signals: { A: true, D: false } });
    });

    it('B true alone gives met false', () => {
      const transaction = baseTransaction({
        participants: { 'per-1': { roles: ['client'], emails: ['jane@example.com'] } },
      });
      const message = baseMessage({ addresses: [{ address: 'jane@example.com' }] });

      const result = evaluateSignals(transaction, message);

      expect(result).toEqual({ met: false, signals: { B: true, D: false } });
    });

    it('C true alone gives met false', () => {
      const transaction = baseTransaction();
      const message = baseMessage({ filename: MATCHING_FILENAME });

      const result = evaluateSignals(transaction, message);

      expect(result).toEqual({ met: false, signals: { C: true, D: false } });
    });
  });

  describe('each pair of A, B, C true', () => {
    it('A and B true gives met true', () => {
      const transaction = baseTransaction({
        participants: { 'per-1': { roles: ['client'], emails: ['jane@example.com'] } },
      });
      const message = baseMessage({
        subject: MATCHING_SUBJECT,
        addresses: [{ address: 'jane@example.com' }],
      });

      const result = evaluateSignals(transaction, message);

      expect(result).toEqual({ met: true, signals: { A: true, B: true, D: false } });
    });

    it('A and C true gives met true', () => {
      const transaction = baseTransaction();
      const message = baseMessage({
        subject: MATCHING_SUBJECT,
        filename: MATCHING_FILENAME,
      });

      const result = evaluateSignals(transaction, message);

      expect(result).toEqual({ met: true, signals: { A: true, C: true, D: false } });
    });

    it('B and C true gives met true', () => {
      const transaction = baseTransaction({
        observedAddresses: { 'bob@example.com': { firstSeenAt: '2026-07-15T10:00:00.000Z', threadId: THREAD_ID } },
      });
      const message = baseMessage({
        addresses: [{ address: 'bob@example.com' }],
        filename: MATCHING_FILENAME,
      });

      const result = evaluateSignals(transaction, message);

      expect(result).toEqual({ met: true, signals: { B: true, C: true, D: false } });
    });
  });

  it('D true alone gives met true, with A, B and C all false', () => {
    const transaction = baseTransaction({
      participants: { 'per-1': { roles: ['client'], emails: ['jane@example.com'] } },
      filings: { 'f1': { threadId: THREAD_ID, status: 'filed', review: 'confirmed' } },
    });
    const message = baseMessage({
      subject: NON_MATCHING_SUBJECT,
      filename: NON_MATCHING_FILENAME,
      addresses: [{ address: 'stranger@example.com' }],
    });

    const result = evaluateSignals(transaction, message);

    expect(result).toEqual({
      met: true,
      signals: { A: false, B: false, C: false, D: true },
    });
  });

  it('D false with two of A, B, C true gives met true', () => {
    const transaction = baseTransaction({
      participants: { 'per-1': { roles: ['client'], emails: ['jane@example.com'] } },
      filings: { 'f1': { threadId: OTHER_THREAD_ID, status: 'filed', review: 'confirmed' } },
    });
    const message = baseMessage({
      subject: MATCHING_SUBJECT,
      addresses: [{ address: 'jane@example.com' }],
    });

    const result = evaluateSignals(transaction, message);

    expect(result).toEqual({ met: true, signals: { A: true, B: true, D: false } });
  });

  it('all four absent-or-false gives met false', () => {
    const transaction = baseTransaction();
    const message = baseMessage();

    const result = evaluateSignals(transaction, message);

    expect(result).toEqual({ met: false, signals: { D: false } });
  });

  describe('the absence rule', () => {
    it('A is absent when subject and body are both empty strings', () => {
      const transaction = baseTransaction();
      const message = baseMessage({ subject: '', body: '' });

      const result = evaluateSignals(transaction, message);

      expect(result.signals).not.toHaveProperty('A');
    });

    it('A is absent when subject is missing entirely', () => {
      const transaction = baseTransaction();
      const message = baseMessage();

      const result = evaluateSignals(transaction, message);

      expect(result.signals).not.toHaveProperty('A');
    });

    it('B is absent when addresses is empty', () => {
      const transaction = baseTransaction({
        participants: { 'per-1': { roles: ['client'], emails: ['jane@example.com'] } },
      });
      const message = baseMessage({ addresses: [] });

      const result = evaluateSignals(transaction, message);

      expect(result.signals).not.toHaveProperty('B');
    });

    it('C is absent when filename is missing', () => {
      const transaction = baseTransaction();
      const message = baseMessage();

      const result = evaluateSignals(transaction, message);

      expect(result.signals).not.toHaveProperty('C');
    });

    it('D is present and false on a transaction with no filings key', () => {
      const transaction = baseTransaction();
      const message = baseMessage();

      const result = evaluateSignals(transaction, message);

      expect(result.signals).toHaveProperty('D', false);
    });

    it('A and C are both absent because transaction.address is "TBD", even though the message text matches the shape of an address', () => {
      const transaction = baseTransaction({ address: 'TBD' });
      const message = baseMessage({
        subject: MATCHING_SUBJECT,
        filename: MATCHING_FILENAME,
      });

      const result = evaluateSignals(transaction, message);

      expect(result.signals).not.toHaveProperty('A');
      expect(result.signals).not.toHaveProperty('C');
      expect(result).toEqual({ met: false, signals: { D: false } });
    });
  });

  describe('signal A via body', () => {
    it('subject absent, body carrying the matching address gives A true', () => {
      const transaction = baseTransaction();
      const message = baseMessage({ body: MATCHING_BODY });

      const result = evaluateSignals(transaction, message);

      expect(result.signals.A).toBe(true);
    });

    it('subject present and non-matching, body carrying the matching address gives A true', () => {
      const transaction = baseTransaction();
      const message = baseMessage({ subject: NON_MATCHING_SUBJECT, body: MATCHING_BODY });

      const result = evaluateSignals(transaction, message);

      expect(result.signals.A).toBe(true);
    });
  });

  describe('signal D and filing review status', () => {
    it('a filing on the thread with review needs_review gives D false', () => {
      const transaction = baseTransaction({
        filings: { 'f1': { threadId: THREAD_ID, status: 'seen', review: 'needs_review' } },
      });
      const message = baseMessage();

      const result = evaluateSignals(transaction, message);

      expect(result.signals.D).toBe(false);
    });

    it('a filing on the thread with review rejected gives D false', () => {
      const transaction = baseTransaction({
        filings: { 'f1': { threadId: THREAD_ID, status: 'filed', review: 'rejected' } },
      });
      const message = baseMessage();

      const result = evaluateSignals(transaction, message);

      expect(result.signals.D).toBe(false);
    });

    it('a filing on the thread with review confirmed but status abandoned gives D true', () => {
      const transaction = baseTransaction({
        filings: { 'f1': { threadId: THREAD_ID, status: 'abandoned', review: 'confirmed' } },
      });
      const message = baseMessage();

      const result = evaluateSignals(transaction, message);

      expect(result.signals.D).toBe(true);
    });
  });

  describe('signal B sources', () => {
    it('B true via participant emails only', () => {
      const transaction = baseTransaction({
        participants: { 'per-1': { roles: ['client'], emails: ['jane@example.com'] } },
      });
      const message = baseMessage({ addresses: [{ address: 'jane@example.com' }] });

      const result = evaluateSignals(transaction, message);

      expect(result.signals.B).toBe(true);
    });

    it('B true via observedAddresses only', () => {
      const transaction = baseTransaction({
        observedAddresses: { 'bob@example.com': { firstSeenAt: '2026-07-15T10:00:00.000Z', threadId: THREAD_ID } },
      });
      const message = baseMessage({ addresses: [{ address: 'bob@example.com' }] });

      const result = evaluateSignals(transaction, message);

      expect(result.signals.B).toBe(true);
    });

    it('B false when an address is on the message but on neither source', () => {
      const transaction = baseTransaction({
        participants: { 'per-1': { roles: ['client'], emails: ['jane@example.com'] } },
        observedAddresses: { 'bob@example.com': { firstSeenAt: '2026-07-15T10:00:00.000Z', threadId: THREAD_ID } },
      });
      const message = baseMessage({ addresses: [{ address: 'stranger@example.com' }] });

      const result = evaluateSignals(transaction, message);

      expect(result.signals.B).toBe(false);
    });

    it('B matching is case and whitespace insensitive on the message side', () => {
      const transaction = baseTransaction({
        participants: { 'per-1': { roles: ['client'], emails: ['jane@example.com'] } },
      });
      const message = baseMessage({ addresses: [{ address: '  JANE@Example.COM  ' }] });

      const result = evaluateSignals(transaction, message);

      expect(result.signals.B).toBe(true);
    });
  });

  describe('argument validation', () => {
    it('throws on missing threadId', () => {
      const transaction = baseTransaction();
      const message = { addresses: [] };

      expect(() => evaluateSignals(transaction, message)).toThrow();
    });

    it('throws on empty threadId', () => {
      const transaction = baseTransaction();
      const message = baseMessage({ threadId: '' });

      expect(() => evaluateSignals(transaction, message)).toThrow();
    });

    it('throws on a non-object transaction', () => {
      const message = baseMessage();

      expect(() => evaluateSignals(null, message)).toThrow();
    });

    it('throws when message.addresses is not an array', () => {
      const transaction = baseTransaction();
      const message = { threadId: THREAD_ID, addresses: 'not-an-array' };

      expect(() => evaluateSignals(transaction, message)).toThrow();
    });
  });

  describe('SIGNAL_KEYS', () => {
    it('is exactly A, B, C, D and frozen', () => {
      expect(SIGNAL_KEYS).toEqual(['A', 'B', 'C', 'D']);
      expect(Object.isFrozen(SIGNAL_KEYS)).toBe(true);
    });
  });

  describe('COUNTING_SIGNALS', () => {
    it('is exactly A, B, C and frozen', () => {
      expect(COUNTING_SIGNALS).toEqual(['A', 'B', 'C']);
      expect(Object.isFrozen(COUNTING_SIGNALS)).toBe(true);
    });
  });
});

describe('matchTransaction', () => {
  describe('no matching set', () => {
    it('empty candidates array gives no_candidates', () => {
      const result = matchTransaction([], baseMessage());

      expect(result).toEqual({ matched: false, reason: 'no_candidates', candidateIds: [] });
    });

    it('all candidates terminal gives no_candidates', () => {
      const candidates = [
        baseTransaction({ transactionId: 'txn-1', state: 'collapsed' }),
      ];

      const result = matchTransaction(candidates, baseMessage());

      expect(result).toEqual({ matched: false, reason: 'no_candidates', candidateIds: [] });
    });

    it('one non-terminal candidate, bar not met, gives no_bar_met', () => {
      const candidates = [baseTransaction({ transactionId: 'txn-1' })];

      const result = matchTransaction(candidates, baseMessage());

      expect(result).toEqual({ matched: false, reason: 'no_bar_met', candidateIds: [] });
    });

    it('a terminal transaction that would have met the bar is excluded, and the result is no_candidates', () => {
      const candidates = [
        baseTransaction({ transactionId: 'txn-1', state: 'closed', ...metByD() }),
      ];

      const result = matchTransaction(candidates, baseMessage());

      expect(result).toEqual({ matched: false, reason: 'no_candidates', candidateIds: [] });
    });
  });

  describe('single match', () => {
    it('resolution is single, signals passed through', () => {
      const candidates = [baseTransaction({ transactionId: 'txn-1', ...metByD() })];

      const result = matchTransaction(candidates, baseMessage());

      expect(result).toEqual({
        matched: true,
        transactionId: 'txn-1',
        signals: { D: true },
        resolution: 'single',
      });
    });

    it('has no supersededTransactionId key', () => {
      const candidates = [baseTransaction({ transactionId: 'txn-solo', ...metByD() })];

      const result = matchTransaction(candidates, baseMessage());

      expect(result).not.toHaveProperty('supersededTransactionId');
    });
  });

  describe('deal beats listing', () => {
    it('seller_sale with listingId pointing at a seller_listing, both matching', () => {
      const deal = baseTransaction({
        type: 'seller_sale',
        transactionId: 'txn-deal',
        listingId: 'txn-listing',
        ...metByD(),
      });
      const listing = baseTransaction({
        type: 'seller_listing',
        state: 'live',
        transactionId: 'txn-listing',
        ...metByD(),
      });

      const result = matchTransaction([deal, listing], baseMessage());

      expect(result).toEqual({
        matched: true,
        transactionId: 'txn-deal',
        signals: { D: true },
        resolution: 'deal_over_listing',
        supersededTransactionId: 'txn-listing',
      });
    });

    it('landlord_lease with listingId pointing at a landlord_listing, both matching', () => {
      const deal = baseTransaction({
        type: 'landlord_lease',
        state: 'accepted',
        transactionId: 'txn-lease',
        listingId: 'txn-llisting',
        ...metByD(),
      });
      const listing = baseTransaction({
        type: 'landlord_listing',
        state: 'live',
        transactionId: 'txn-llisting',
        ...metByD(),
      });

      const result = matchTransaction([deal, listing], baseMessage());

      expect(result.matched).toBe(true);
      expect(result.transactionId).toBe('txn-lease');
      expect(result.resolution).toBe('deal_over_listing');
      expect(result.supersededTransactionId).toBe('txn-llisting');
    });
  });

  describe('paired types without a proven link', () => {
    it('addresses equal, listingId absent, gives ambiguous_unlinked_listing with both ids', () => {
      const deal = baseTransaction({ type: 'seller_sale', transactionId: 'txn-d3', ...metByD() });
      const listing = baseTransaction({
        type: 'seller_listing',
        state: 'live',
        transactionId: 'txn-l3',
        ...metByD(),
      });

      const result = matchTransaction([deal, listing], baseMessage());

      expect(result).toEqual({
        matched: false,
        reason: 'ambiguous_unlinked_listing',
        candidateIds: ['txn-d3', 'txn-l3'],
      });
    });

    it('addresses equal, listingId present but pointing at a different transactionId, gives ambiguous_unlinked_listing', () => {
      const deal = baseTransaction({
        type: 'seller_sale',
        transactionId: 'txn-d4',
        listingId: 'txn-nonexistent',
        ...metByD(),
      });
      const listing = baseTransaction({
        type: 'seller_listing',
        state: 'live',
        transactionId: 'txn-l4',
        ...metByD(),
      });

      const result = matchTransaction([deal, listing], baseMessage());

      expect(result.matched).toBe(false);
      expect(result.reason).toBe('ambiguous_unlinked_listing');
    });

    it('addresses not equal, no link, gives plain ambiguous', () => {
      const deal = baseTransaction({
        type: 'seller_sale',
        transactionId: 'txn-d5',
        address: '45 Oak Ave',
        ...metByD(),
      });
      const listing = baseTransaction({
        type: 'seller_listing',
        state: 'live',
        transactionId: 'txn-l5',
        ...metByD(),
      });

      const result = matchTransaction([deal, listing], baseMessage());

      expect(result.matched).toBe(false);
      expect(result.reason).toBe('ambiguous');
    });
  });

  describe('same building beats unlinked listing', () => {
    it('both units present and differing gives ambiguous_same_building, proving rule b runs before rule c', () => {
      const deal = baseTransaction({
        type: 'seller_sale',
        transactionId: 'txn-d6',
        unit: '302',
        ...metByD(),
      });
      const listing = baseTransaction({
        type: 'seller_listing',
        state: 'live',
        transactionId: 'txn-l6',
        unit: '505',
        ...metByD(),
      });

      const result = matchTransaction([deal, listing], baseMessage());

      expect(result).toEqual({
        matched: false,
        reason: 'ambiguous_same_building',
        candidateIds: ['txn-d6', 'txn-l6'],
      });
    });

    it('both units present and equal gives ambiguous_unlinked_listing, not same_building', () => {
      const deal = baseTransaction({
        type: 'seller_sale',
        transactionId: 'txn-d7',
        unit: '302',
        ...metByD(),
      });
      const listing = baseTransaction({
        type: 'seller_listing',
        state: 'live',
        transactionId: 'txn-l7',
        unit: '302',
        ...metByD(),
      });

      const result = matchTransaction([deal, listing], baseMessage());

      expect(result.matched).toBe(false);
      expect(result.reason).toBe('ambiguous_unlinked_listing');
    });

    it('one unit present, one absent, gives ambiguous_unlinked_listing: absence is not evidence', () => {
      const deal = baseTransaction({
        type: 'seller_sale',
        transactionId: 'txn-d8',
        unit: '302',
        ...metByD(),
      });
      const listing = baseTransaction({
        type: 'seller_listing',
        state: 'live',
        transactionId: 'txn-l8',
        ...metByD(),
      });

      const result = matchTransaction([deal, listing], baseMessage());

      expect(result.matched).toBe(false);
      expect(result.reason).toBe('ambiguous_unlinked_listing');
    });

    it('two landlord_lease records with differing units gives ambiguous_same_building', () => {
      const first = baseTransaction({
        type: 'landlord_lease',
        state: 'accepted',
        transactionId: 'txn-la',
        unit: '1A',
        ...metByD(),
      });
      const second = baseTransaction({
        type: 'landlord_lease',
        state: 'signed',
        transactionId: 'txn-lb',
        unit: '1B',
        ...metByD(),
      });

      const result = matchTransaction([first, second], baseMessage());

      expect(result.matched).toBe(false);
      expect(result.reason).toBe('ambiguous_same_building');
    });
  });

  describe('three or more candidates', () => {
    it('gives ambiguous with no tiebreak, and candidateIds sorted', () => {
      const candidates = [
        baseTransaction({ transactionId: 'txn-z', ...metByD() }),
        baseTransaction({ transactionId: 'txn-a', ...metByD() }),
        baseTransaction({ transactionId: 'txn-m', ...metByD() }),
      ];

      const result = matchTransaction(candidates, baseMessage());

      expect(result).toEqual({
        matched: false,
        reason: 'ambiguous',
        candidateIds: ['txn-a', 'txn-m', 'txn-z'],
      });
    });
  });

  it('buyer_purchase plus seller_listing at one address, both matching, gives ambiguous because buyer_purchase has no paired listing type', () => {
    const purchase = baseTransaction({ type: 'buyer_purchase', transactionId: 'txn-bp', ...metByD() });
    const listing = baseTransaction({
      type: 'seller_listing',
      state: 'live',
      transactionId: 'txn-sl',
      ...metByD(),
    });

    const result = matchTransaction([purchase, listing], baseMessage());

    expect(result.matched).toBe(false);
    expect(result.reason).toBe('ambiguous');
  });

  it('candidateIds is sorted regardless of input order', () => {
    const candidates = [
      baseTransaction({ transactionId: 'txn-zzz', ...metByD() }),
      baseTransaction({ transactionId: 'txn-aaa', ...metByD() }),
    ];

    const result = matchTransaction(candidates, baseMessage());

    expect(result.matched).toBe(false);
    expect(result.candidateIds).toEqual(['txn-aaa', 'txn-zzz']);
  });

  describe('argument validation', () => {
    it('propagates isTerminal\'s throw on a candidate with an unknown type', () => {
      const candidates = [baseTransaction({ transactionId: 'txn-bad', type: 'not_a_real_type' })];

      expect(() => matchTransaction(candidates, baseMessage())).toThrow();
    });

    it('throws when candidates is not an array', () => {
      expect(() => matchTransaction('not-an-array', baseMessage())).toThrow();
    });
  });
});
