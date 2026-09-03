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

beforeEach(() => {
  baseDir = makeTmpDir();
});

afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

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
    receivedAt: '2026-07-16T08:00:00.000Z',
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

// Builds candidates the same way leadIntake.js's merged TC loop now does:
// one readAllTransactions call, reused by whatever needs it for this
// message. matchAndFileAttachments no longer reads transactions itself --
// see its header comment in intake.js -- so every call site here supplies
// its own candidates array, fresh, the same way the real caller must.
function candidatesFor() {
  return queries.readAllTransactions(AGENT_ID, { baseDir });
}

describe('matchAndFileAttachments', () => {
  it('returns an empty array without ever touching the candidates array when the message has no attachments', () => {
    const msg = message({ hasAttachments: false, attachmentInfo: [] });

    const results = matchAndFileAttachments(agentConfig(), msg, [], opts());

    expect(results).toEqual([]);
  });

  it('throws when candidates is not an array', () => {
    const msg = message();
    expect(() => matchAndFileAttachments(agentConfig(), msg, undefined, opts()))
      .toThrow(/candidates must be an array/);
  });

  it('does nothing for an attachment that matches no transaction', () => {
    const created = create(); // no confirmed filing on THREAD_ID, no address signals
    const msg = message();

    const results = matchAndFileAttachments(agentConfig(), msg, candidatesFor(), opts());

    expect(results).toHaveLength(1);
    expect(results[0].matched).toBe(false);

    const reread = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(reread.filings).toBeUndefined();
  });

  it('records a filing, with the full reported size carried onto it, for a matching attachment', () => {
    const created = create(withConfirmedFiling());
    const att = attachment({ filename: 'aps.pdf', mimeType: 'application/pdf', size: 37399, attachmentId: 'att-1' });
    const msg = message({ attachmentInfo: [att] });

    const results = matchAndFileAttachments(agentConfig(), msg, candidatesFor(), opts());

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
      sender: 'lawyer@firm.com',
      receivedAt: '2026-07-16T08:00:00.000Z',
      subject: '',
      status: 'seen',
      review: 'needs_review',
      seenAt: AT,
      attempts: 0,
    });
  });

  it('uses the one injected candidates array for every attachment on the message, filing every attachment, not just the first', () => {
    const created = create(withConfirmedFiling());
    const att1 = attachment({ filename: 'aps.pdf', attachmentId: 'att-1' });
    const att2 = attachment({ filename: 'waiver.pdf', attachmentId: 'att-2' });
    const msg = message({ attachmentInfo: [att1, att2] });

    const results = matchAndFileAttachments(agentConfig(), msg, candidatesFor(), opts());

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

  it('records against the matched candidate even when it is not the first candidate in the array', () => {
    const unmatched = create({ address: '99 Other Ave' }); // no confirmed filing, address won't match
    const matched = create(withConfirmedFiling());
    const msg = message();

    // Force the candidate order so `matched` is deliberately second: this is
    // the exact shape a "record against candidates[0]" bug would get wrong.
    const results = matchAndFileAttachments(agentConfig(), msg, [unmatched, matched], opts());

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

    matchAndFileAttachments(agentConfig(), msg, candidatesFor(), opts());
    const afterFirst = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    const keyCountAfterFirst = Object.keys(afterFirst.filings).length;
    const seenAtAfterFirst = afterFirst.filings[key].seenAt;

    // Second call deliberately uses a DIFFERENT `at` than the first, so a
    // no-op that incorrectly reseeds seenAt would be observable here rather
    // than accidentally matching by reusing an identical timestamp. It also
    // re-reads candidates, the same as a later orchestrator cycle would.
    const results = matchAndFileAttachments(agentConfig(), msg, candidatesFor(), opts({ at: AT2, now: new Date(AT2) }));

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

  // TC_SPEC 10.x hygiene guard: an attachment over Gmail's own ceiling never
  // gets fetched. It still gets a filing record (deal history), immediately
  // abandoned with a reason naming both numbers.
  describe('the byte cap', () => {
    const OVERSIZED = 26214401; // ATTACHMENT_BYTE_CAP + 1

    it('records the filing, then abandons it immediately, for an attachment over the cap', () => {
      const created = create(withConfirmedFiling());
      const att = attachment({ size: OVERSIZED });
      const msg = message({ attachmentInfo: [att] });

      const results = matchAndFileAttachments(agentConfig(), msg, candidatesFor(), opts());

      expect(results).toHaveLength(1);
      expect(results[0].matched).toBe(true);

      const key = filings.buildFilingKey(msg.messageId, att.attachmentId);
      const reread = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(reread.filings[key].status).toBe('abandoned');
      expect(reread.filings[key].attempts).toBe(0); // honest: never attempted, only rejected on sight
      expect(reread.filings[key].lastError).toBe('size 26214401 bytes exceeds cap 26214400 bytes');
    });

    it('does not abandon an attachment exactly at the cap', () => {
      const created = create(withConfirmedFiling());
      const att = attachment({ size: 26214400 });
      const msg = message({ attachmentInfo: [att] });

      matchAndFileAttachments(agentConfig(), msg, candidatesFor(), opts());

      const key = filings.buildFilingKey(msg.messageId, att.attachmentId);
      const reread = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(reread.filings[key].status).toBe('seen');
    });

    // THE RE-ENTRANCY TRAP: recordDocumentSeen throws attempting to re-seen
    // any terminal filing, not just an abandoned one, and abandonDocumentFiling
    // is itself one-directional too. Without checking the filing's current
    // status before ever calling recordDocumentSeen, this exact sequence
    // (an oversized attachment on a message that stays unread, re-entering
    // Pass 1 on the next cycle) would throw every cycle, silently, forever,
    // since leadIntake.js swallows this call in a try/catch and only logs.
    // This is the whole point of that paragraph: assert the SECOND run is a
    // clean no-op, not merely that it doesn't crash the test process.
    it('running Pass 1 twice over the same oversized attachment is a clean no-op on the second run', () => {
      const created = create(withConfirmedFiling());
      const att = attachment({ size: OVERSIZED });
      const msg = message({ attachmentInfo: [att] });
      const key = filings.buildFilingKey(msg.messageId, att.attachmentId);

      matchAndFileAttachments(agentConfig(), msg, candidatesFor(), opts());
      const afterFirst = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(afterFirst.filings[key].status).toBe('abandoned');

      expect(() => {
        matchAndFileAttachments(agentConfig(), msg, candidatesFor(), opts({ at: AT2, now: new Date(AT2) }));
      }).not.toThrow();

      const afterSecond = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(afterSecond.filings[key].status).toBe('abandoned');
      expect(afterSecond.filings[key].lastError).toBe('size 26214401 bytes exceeds cap 26214400 bytes');
      // No second document_filing_abandoned event: the second run never
      // reaches the cap check at all, since the terminal-status guard skips
      // straight past recordDocumentSeen.
      const abandonEvents = afterSecond.events.filter((e) => e.kind === 'document_filing_abandoned');
      expect(abandonEvents).toHaveLength(1);
    });
  });

  // This is the SAME re-entrancy trap as the oversized-cap case above, but
  // triggered by the ordinary successful path instead: once the drain pass
  // (src/drain.js) transitions a filing to 'filed', a message that is still
  // unread keeps re-entering this function every cycle (this function's own
  // header comment documents that re-entrancy as deliberate). Without the
  // status guard, recordDocumentSeen would throw on that re-entry exactly
  // as it would for an abandoned one.
  it('re-entrant re-processing of an already-filed filing is a clean no-op, not a throw', () => {
    const created = create(withConfirmedFiling());
    const msg = message();
    const key = filings._internal.buildFilingKey(msg.messageId, msg.attachmentInfo[0].attachmentId);

    matchAndFileAttachments(agentConfig(), msg, candidatesFor(), opts());
    filings.recordDocumentFiled(AGENT_ID, created.transactionId, msg.messageId, msg.attachmentInfo[0].attachmentId, {
      at: AT2, actor: 'system', driveFileId: 'drive-xyz', contentHash: 'sha256:deadbeef', baseDir, now: new Date(AT2),
    });

    expect(() => {
      matchAndFileAttachments(agentConfig(), msg, candidatesFor(), opts({ at: AT2, now: new Date(AT2) }));
    }).not.toThrow();

    const reread = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(reread.filings[key].status).toBe('filed');
    expect(reread.filings[key].driveFileId).toBe('drive-xyz');
  });
});
