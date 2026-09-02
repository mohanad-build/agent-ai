'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { matchAndFileAttachments } = require('../src/transactions/intake');
const queries = require('../src/transactions/queries');
const filings = require('../src/transactions/filings');
const { createTransaction, readTransaction } = require('../src/transactions/store');

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');
const AT = '2026-07-16T09:30:00.000Z';
const LATER = new Date(AT);
const AT2 = '2026-07-17T12:00:00.000Z';
const THREAD_ID = 'thread-abc123';
const OWN_ADDRESS = 'agent@rlp.ca';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transactions-intake-test-'));
}

let baseDir;
let spies;

beforeEach(() => {
  baseDir = makeTmpDir();
  spies = [];
});

afterEach(() => {
  spies.forEach((s) => s.mockRestore());
  fs.rmSync(baseDir, { recursive: true, force: true });
});

function spyOn(obj, method) {
  const s = jest.spyOn(obj, method);
  spies.push(s);
  return s;
}

function create(overrides = {}) {
  return createTransaction(
    AGENT_ID,
    { type: 'buyer_purchase', state: 'conditional', address: '12 Main St', ...overrides },
    { baseDir, now: CLOCK }
  );
}

// Signal D alone meets the bar (matcher.js): a transaction whose filings map
// already has a confirmed filing on this exact thread matches any message on
// that thread, regardless of address text. Used throughout below instead of
// crafting address-parsing fixtures, the same shortcut
// tests/transactions-accumulator.test.js takes for the same reason.
function withConfirmedFiling(threadId = THREAD_ID) {
  return {
    filings: {
      f1: { threadId, status: 'filed', review: 'confirmed' },
    },
  };
}

function agentConfig(overrides = {}) {
  return { agentId: AGENT_ID, gmailAddress: OWN_ADDRESS, ...overrides };
}

function attachment(overrides = {}) {
  return {
    filename: 'aps.pdf',
    mimeType: 'application/pdf',
    size: 1024,
    attachmentId: 'att-1',
    ...overrides,
  };
}

function message(overrides = {}) {
  return {
    messageId: 'msg-1',
    threadId: THREAD_ID,
    subject: '',
    body: '',
    from: 'lawyer@firm.com',
    to: [],
    cc: [],
    hasAttachments: true,
    attachmentInfo: [attachment()],
    ...overrides,
  };
}

function opts(overrides = {}) {
  return { at: AT, actor: 'system', baseDir, now: LATER, ...overrides };
}

describe('matchAndFileAttachments', () => {
  it('returns an empty array and never reads transactions when the message has no attachments', () => {
    const readSpy = spyOn(queries, 'readAllTransactions');
    const msg = message({ hasAttachments: false, attachmentInfo: [] });

    const results = matchAndFileAttachments(agentConfig(), msg, opts());

    expect(results).toEqual([]);
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('does nothing for an attachment that matches no transaction', () => {
    const created = create(); // no confirmed filing on THREAD_ID, no address signals
    const msg = message();

    const results = matchAndFileAttachments(agentConfig(), msg, opts());

    expect(results).toHaveLength(1);
    expect(results[0].matched).toBe(false);

    const reread = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(reread.filings).toBeUndefined();
  });

  it('records a filing, with the full reported size carried onto it, for a matching attachment', () => {
    const created = create(withConfirmedFiling());
    const att = attachment({ filename: 'aps.pdf', mimeType: 'application/pdf', size: 37399, attachmentId: 'att-1' });
    const msg = message({ attachmentInfo: [att] });

    const results = matchAndFileAttachments(agentConfig(), msg, opts());

    expect(results).toHaveLength(1);
    expect(results[0].matched).toBe(true);
    expect(results[0].transactionId).toBe(created.transactionId);

    const reread = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    const key = filings._internal.buildFilingKey(msg.messageId, att.attachmentId);
    expect(reread.filings[key]).toEqual({
      messageId: msg.messageId,
      attachmentId: att.attachmentId,
      filename: 'aps.pdf',
      mimeType: 'application/pdf',
      size: 37399,
      threadId: THREAD_ID,
      status: 'seen',
      review: 'needs_review',
      seenAt: AT,
      attempts: 0,
    });
  });

  it('reads the agent transactions exactly once per message and files every attachment, not just the first', () => {
    const created = create(withConfirmedFiling());
    const att1 = attachment({ filename: 'aps.pdf', attachmentId: 'att-1' });
    const att2 = attachment({ filename: 'waiver.pdf', attachmentId: 'att-2' });
    const msg = message({ attachmentInfo: [att1, att2] });

    const readSpy = spyOn(queries, 'readAllTransactions');

    const results = matchAndFileAttachments(agentConfig(), msg, opts());

    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);
    expect(results[0].matched).toBe(true);
    expect(results[1].matched).toBe(true);

    const reread = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    const key1 = filings._internal.buildFilingKey(msg.messageId, att1.attachmentId);
    const key2 = filings._internal.buildFilingKey(msg.messageId, att2.attachmentId);
    expect(reread.filings[key1]).toBeDefined();
    expect(reread.filings[key2]).toBeDefined();
    expect(reread.filings[key1].filename).toBe('aps.pdf');
    expect(reread.filings[key2].filename).toBe('waiver.pdf');
  });

  it('records against the matched candidate even when it is not the first candidate read', () => {
    const unmatched = create({ address: '99 Other Ave' }); // no confirmed filing, address won't match
    const matched = create(withConfirmedFiling());
    const msg = message();

    // Force the candidate order so `matched` is deliberately second: this is
    // the exact shape a "record against candidates[0]" bug would get wrong.
    spyOn(queries, 'readAllTransactions').mockReturnValue([unmatched, matched]);

    const results = matchAndFileAttachments(agentConfig(), msg, opts());

    expect(results).toHaveLength(1);
    expect(results[0].matched).toBe(true);
    expect(results[0].transactionId).toBe(matched.transactionId);

    const rerereadMatched = readTransaction(AGENT_ID, matched.transactionId, { baseDir });
    const rerereadUnmatched = readTransaction(AGENT_ID, unmatched.transactionId, { baseDir });
    expect(rerereadMatched.filings).toBeDefined();
    expect(rerereadUnmatched.filings).toBeUndefined();
  });

  it('re-entrant re-processing is a no-op: seeing the same message+attachment again does not duplicate or error', () => {
    const created = create(withConfirmedFiling()); // fixture itself seeds one filing key ('f1')
    const msg = message();
    const key = filings._internal.buildFilingKey(msg.messageId, msg.attachmentInfo[0].attachmentId);

    matchAndFileAttachments(agentConfig(), msg, opts());
    const afterFirst = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    const keyCountAfterFirst = Object.keys(afterFirst.filings).length;
    const seenAtAfterFirst = afterFirst.filings[key].seenAt;

    // Second call deliberately uses a DIFFERENT `at` than the first, so a
    // no-op that incorrectly reseeds seenAt would be observable here rather
    // than accidentally matching by reusing an identical timestamp.
    const results = matchAndFileAttachments(agentConfig(), msg, opts({ at: AT2, now: new Date(AT2) }));

    expect(results[0].matched).toBe(true);
    const afterSecond = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(Object.keys(afterSecond.filings)).toHaveLength(keyCountAfterFirst);

    // TC_SPEC 7.7: re-seeing an already-'seen' filing is an idempotent
    // no-op -- no second event, no field reset. Both assertions below must
    // be able to go red independently of each other.
    const documentSeenEventsForKey = afterSecond.events.filter(
      (e) => e.kind === 'document_seen' && e.payload.key === key
    );
    expect(documentSeenEventsForKey).toHaveLength(1);

    expect(afterSecond.filings[key].seenAt).toBe(seenAtAfterFirst);
    expect(afterSecond.filings[key].seenAt).not.toBe(AT2);
  });
});
