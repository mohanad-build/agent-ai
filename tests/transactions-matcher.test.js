'use strict';

const { evaluateSignals } = require('../src/transactions/matcher');
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
