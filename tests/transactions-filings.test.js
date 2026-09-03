'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const {
  recordDocumentSeen,
  recordDocumentFiled,
  recordFilingAttemptFailure,
  abandonDocumentFiling,
  confirmFiling,
  rejectFiling,
  hasConfirmedFilingOnThread,
  FILING_STATUSES,
  FILING_REVIEW_STATUSES,
} = require('../src/transactions/filings');
const { createTransaction, readTransaction } = require('../src/transactions/store');

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');
const LATER = new Date('2026-07-16T09:30:00.000Z');
const EVEN_LATER = new Date('2026-07-17T08:00:00.000Z');
const AT = '2026-07-16T09:30:00.000Z';
const AT2 = '2026-07-17T08:00:00.000Z';

const MESSAGE_ID = 'msg-abc123';
const ATTACHMENT_ID = 'att-def456';
const THREAD_ID = 'thread-xyz789';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transactions-filings-test-'));
}

let baseDir;

beforeEach(() => { baseDir = makeTmpDir(); });
afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

function create(type = 'buyer_purchase', state = 'conditional') {
  return createTransaction(
    AGENT_ID,
    { type, state, address: '12 Main St' },
    { baseDir, now: CLOCK }
  );
}

function seeDocument(transactionId, opts = {}) {
  return recordDocumentSeen(AGENT_ID, transactionId, MESSAGE_ID, ATTACHMENT_ID, {
    at: AT,
    actor: 'system',
    filename: 'agreement.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    threadId: THREAD_ID,
    sender: 'Lawyer <lawyer@firm.com>',
    receivedAt: '2026-07-16T09:00:00.000Z',
    subject: 'Purchase Agreement',
    baseDir,
    now: LATER,
    ...opts,
  });
}

describe('FILING_STATUSES', () => {
  it('lists exactly the three expected statuses', () => {
    expect(FILING_STATUSES).toEqual(['seen', 'filed', 'abandoned']);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(FILING_STATUSES)).toBe(true);
  });
});

describe('recordDocumentSeen', () => {
  it('creates a filing record at status seen with the four future fields absent', () => {
    const created = create();
    const result = seeDocument(created.transactionId);

    const key = `${MESSAGE_ID.length}:${MESSAGE_ID}:${ATTACHMENT_ID}`;
    const record = result.filings[key];

    expect(record).toEqual({
      messageId: MESSAGE_ID,
      attachmentId: ATTACHMENT_ID,
      filename: 'agreement.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      threadId: THREAD_ID,
      sender: 'Lawyer <lawyer@firm.com>',
      receivedAt: '2026-07-16T09:00:00.000Z',
      subject: 'Purchase Agreement',
      status: 'seen',
      review: 'needs_review',
      seenAt: AT,
      attempts: 0,
    });
    expect(record).not.toHaveProperty('lastError');
    expect(record).not.toHaveProperty('lastAttemptAt');
    expect(record).not.toHaveProperty('contentHash');
    expect(record).not.toHaveProperty('driveFileId');
  });

  it('emits a document_seen event with the key, filename, mimeType and size', () => {
    const created = create();
    const result = seeDocument(created.transactionId);

    const key = `${MESSAGE_ID.length}:${MESSAGE_ID}:${ATTACHMENT_ID}`;
    const event = result.events[result.events.length - 1];

    expect(event.kind).toBe('document_seen');
    expect(event.at).toBe(AT);
    expect(event.actor).toBe('system');
    expect(event.payload).toEqual({
      key,
      filename: 'agreement.pdf',
      mimeType: 'application/pdf',
      size: 2048,
    });
  });

  it('persists the record and event to disk', () => {
    const created = create();
    seeDocument(created.transactionId);

    const reread = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    const key = `${MESSAGE_ID.length}:${MESSAGE_ID}:${ATTACHMENT_ID}`;
    expect(reread.filings[key].status).toBe('seen');
    expect(reread.events).toHaveLength(1);
    expect(reread.events[0].kind).toBe('document_seen');
  });

  it('re-seeing an already-seen record is idempotent: no second event, no field change', () => {
    const created = create();
    seeDocument(created.transactionId);
    const second = seeDocument(created.transactionId, { at: AT2, filename: 'renamed.pdf' });

    expect(second.events).toHaveLength(1);
    const key = `${MESSAGE_ID.length}:${MESSAGE_ID}:${ATTACHMENT_ID}`;
    expect(second.filings[key].filename).toBe('agreement.pdf');
    expect(second.filings[key].seenAt).toBe(AT);
  });

  // THE CASE THAT ACTUALLY MATTERS: not the oversized-and-abandoned edge
  // case, but the ORDINARY successful path. TC_SPEC 7.14's Pass 1 re-runs
  // over the same message every cycle until it falls out of the fetch
  // window (intake.js's header comment); once the drain pass successfully
  // uploads a document, the very next cycle re-observes the same message
  // and attachment, now sitting at 'filed'. This has to be a clean no-op
  // exactly like re-seeing a still-'seen' record above, not a throw --
  // recordDocumentSeen is a re-observation, not a transition, and applies
  // at every status a filing can be in, not only 'seen'.
  it('re-seeing an already-filed record is a clean no-op: no throw, no second event, every field on the record unchanged', () => {
    const created = create();
    seeDocument(created.transactionId);
    const filed = recordDocumentFiled(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2, actor: 'system', driveFileId: 'drive-xyz', contentHash: 'sha256:deadbeef', baseDir, now: EVEN_LATER,
    });
    const key = `${MESSAGE_ID.length}:${MESSAGE_ID}:${ATTACHMENT_ID}`;
    const recordBefore = filed.filings[key];

    let result;
    expect(() => {
      result = seeDocument(created.transactionId, { at: '2026-07-18T10:00:00.000Z', filename: 'renamed.pdf', now: new Date('2026-07-18T10:00:00.000Z') });
    }).not.toThrow();

    expect(result.events).toHaveLength(filed.events.length);
    expect(result.filings[key]).toEqual(recordBefore);
  });

  it('re-seeing an already-abandoned record is a clean no-op: no throw, no second event, every field on the record unchanged', () => {
    const created = create();
    seeDocument(created.transactionId);
    const abandoned = abandonDocumentFiling(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2, actor: 'system', lastError: 'attachment fetch timed out', baseDir, now: EVEN_LATER,
    });
    const key = `${MESSAGE_ID.length}:${MESSAGE_ID}:${ATTACHMENT_ID}`;
    const recordBefore = abandoned.filings[key];

    let result;
    expect(() => {
      result = seeDocument(created.transactionId, { at: '2026-07-18T10:00:00.000Z', filename: 'renamed.pdf', now: new Date('2026-07-18T10:00:00.000Z') });
    }).not.toThrow();

    expect(result.events).toHaveLength(abandoned.events.length);
    expect(result.filings[key]).toEqual(recordBefore);
  });

  it('two different attachments on the same message each get their own record', () => {
    const created = create();
    seeDocument(created.transactionId);
    const result = recordDocumentSeen(AGENT_ID, created.transactionId, MESSAGE_ID, 'att-other', {
      at: AT2, actor: 'system', filename: 'disclosure.pdf', mimeType: 'application/pdf', size: 512, threadId: THREAD_ID, sender: '', receivedAt: '', subject: '', baseDir, now: EVEN_LATER,
    });

    expect(Object.keys(result.filings)).toHaveLength(2);
  });

  it('throws when the transaction does not exist', () => {
    expect(() => seeDocument('txn-20260715-00000000'))
      .toThrow(/no transaction/);
  });

  it('throws when size is not a non-negative number', () => {
    const created = create();
    expect(() => seeDocument(created.transactionId, { size: -1 }))
      .toThrow(/size must be a non-negative number/);
  });

  it('throws when at is absent', () => {
    const created = create();
    expect(() => seeDocument(created.transactionId, { at: undefined }))
      .toThrow(/at must be a non-empty string/);
  });

  // Required-but-tolerant: sender, receivedAt and subject must be present
  // as strings, but an empty string is a legitimate value (Gmail sent
  // nothing in that header). Missing the key entirely is a different
  // problem -- a caller that forgot to thread it through -- and must throw
  // immediately rather than silently storing undefined.
  it.each(['sender', 'receivedAt', 'subject'])('throws when %s is missing from opts entirely', (field) => {
    const created = create();
    expect(() => seeDocument(created.transactionId, { [field]: undefined }))
      .toThrow(new RegExp(`${field} must be present in opts as a string`));
  });

  it.each(['sender', 'receivedAt', 'subject'])('accepts an empty string for %s', (field) => {
    const created = create();
    const result = seeDocument(created.transactionId, { [field]: '' });

    const key = `${MESSAGE_ID.length}:${MESSAGE_ID}:${ATTACHMENT_ID}`;
    expect(result.filings[key][field]).toBe('');
  });
});

describe('recordDocumentFiled', () => {
  function file(transactionId, opts = {}) {
    return recordDocumentFiled(AGENT_ID, transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2,
      actor: 'system',
      driveFileId: 'drive-xyz',
      contentHash: 'sha256:deadbeef',
      baseDir,
      now: EVEN_LATER,
      ...opts,
    });
  }

  it('transitions seen to filed and sets driveFileId and contentHash', () => {
    const created = create();
    seeDocument(created.transactionId);
    const result = file(created.transactionId);

    const key = `${MESSAGE_ID.length}:${MESSAGE_ID}:${ATTACHMENT_ID}`;
    expect(result.filings[key]).toEqual({
      messageId: MESSAGE_ID,
      attachmentId: ATTACHMENT_ID,
      filename: 'agreement.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      threadId: THREAD_ID,
      sender: 'Lawyer <lawyer@firm.com>',
      receivedAt: '2026-07-16T09:00:00.000Z',
      subject: 'Purchase Agreement',
      status: 'filed',
      review: 'needs_review',
      seenAt: AT,
      attempts: 0,
      driveFileId: 'drive-xyz',
      contentHash: 'sha256:deadbeef',
    });
  });

  it('emits a document_filed event with the key, filename, driveFileId and contentHash', () => {
    const created = create();
    seeDocument(created.transactionId);
    const result = file(created.transactionId);

    const key = `${MESSAGE_ID.length}:${MESSAGE_ID}:${ATTACHMENT_ID}`;
    const event = result.events[result.events.length - 1];
    expect(event.kind).toBe('document_filed');
    expect(event.payload).toEqual({
      key,
      filename: 'agreement.pdf',
      driveFileId: 'drive-xyz',
      contentHash: 'sha256:deadbeef',
    });
  });

  it('throws when there is no filing record at all', () => {
    const created = create();
    expect(() => file(created.transactionId))
      .toThrow(/no filing record/);
  });

  it('throws attempting to file an already-filed record (terminal, one-directional)', () => {
    const created = create();
    seeDocument(created.transactionId);
    file(created.transactionId);
    expect(() => file(created.transactionId))
      .toThrow(/is 'filed', not 'seen'/);
  });

  it('throws attempting to file an abandoned record (terminal, one-directional)', () => {
    const created = create();
    seeDocument(created.transactionId);
    abandonDocumentFiling(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2, actor: 'system', lastError: 'fetch failed', baseDir, now: EVEN_LATER,
    });
    expect(() => file(created.transactionId))
      .toThrow(/is 'abandoned', not 'seen'/);
  });
});

describe('recordFilingAttemptFailure', () => {
  function fail(transactionId, opts = {}) {
    return recordFilingAttemptFailure(AGENT_ID, transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2,
      actor: 'system',
      lastError: 'attachment fetch timed out',
      baseDir,
      now: EVEN_LATER,
      ...opts,
    });
  }

  it('increments attempts by 1 and sets lastError and lastAttemptAt, leaving status at seen', () => {
    const created = create();
    seeDocument(created.transactionId);
    const result = fail(created.transactionId);

    const key = `${MESSAGE_ID.length}:${MESSAGE_ID}:${ATTACHMENT_ID}`;
    expect(result.filings[key]).toEqual({
      messageId: MESSAGE_ID,
      attachmentId: ATTACHMENT_ID,
      filename: 'agreement.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      threadId: THREAD_ID,
      sender: 'Lawyer <lawyer@firm.com>',
      receivedAt: '2026-07-16T09:00:00.000Z',
      subject: 'Purchase Agreement',
      status: 'seen',
      review: 'needs_review',
      seenAt: AT,
      attempts: 1,
      lastError: 'attachment fetch timed out',
      lastAttemptAt: AT2,
    });
  });

  it('a second failure increments attempts to 2 and overwrites lastError and lastAttemptAt', () => {
    const created = create();
    seeDocument(created.transactionId);
    fail(created.transactionId, { at: AT2, lastError: 'first failure' });
    const result = fail(created.transactionId, { at: AT2, lastError: 'second failure' });

    const key = `${MESSAGE_ID.length}:${MESSAGE_ID}:${ATTACHMENT_ID}`;
    expect(result.filings[key].attempts).toBe(2);
    expect(result.filings[key].lastError).toBe('second failure');
  });

  // Break-the-fix instrument: if an event is ever added to this function,
  // this must go red. Every OTHER writer in this file emits an event on a
  // successful write; this one deliberately does not (TC_SPEC 7.7 -- a
  // failed-then-retried fetch is machinery, not deal history), and that
  // asymmetry is easy to "fix" by accident.
  it('emits no event at all', () => {
    const created = create();
    seeDocument(created.transactionId);
    const beforeCount = readTransaction(AGENT_ID, created.transactionId, { baseDir }).events.length;

    const result = fail(created.transactionId);

    expect(result.events).toHaveLength(beforeCount);
  });

  it('does not change status', () => {
    const created = create();
    seeDocument(created.transactionId);
    const result = fail(created.transactionId);

    const key = `${MESSAGE_ID.length}:${MESSAGE_ID}:${ATTACHMENT_ID}`;
    expect(result.filings[key].status).toBe('seen');
  });

  it('throws when there is no filing record at all', () => {
    const created = create();
    expect(() => fail(created.transactionId))
      .toThrow(/no filing record/);
  });

  it('throws recording an attempt against an already-filed record (terminal)', () => {
    const created = create();
    seeDocument(created.transactionId);
    recordDocumentFiled(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2, actor: 'system', driveFileId: 'drive-xyz', contentHash: 'sha256:deadbeef', baseDir, now: EVEN_LATER,
    });
    expect(() => fail(created.transactionId))
      .toThrow(/is 'filed', not 'seen'/);
  });

  it('throws recording an attempt against an already-abandoned record (terminal)', () => {
    const created = create();
    seeDocument(created.transactionId);
    abandonDocumentFiling(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2, actor: 'system', lastError: 'fetch failed', baseDir, now: EVEN_LATER,
    });
    expect(() => fail(created.transactionId))
      .toThrow(/is 'abandoned', not 'seen'/);
  });

  it('throws when lastError is empty', () => {
    const created = create();
    seeDocument(created.transactionId);
    expect(() => fail(created.transactionId, { lastError: '' }))
      .toThrow(/lastError must be a non-empty string/);
  });

  it('throws when at is absent', () => {
    const created = create();
    seeDocument(created.transactionId);
    expect(() => fail(created.transactionId, { at: undefined }))
      .toThrow(/at must be a non-empty string/);
  });
});

describe('abandonDocumentFiling', () => {
  function abandon(transactionId, opts = {}) {
    return abandonDocumentFiling(AGENT_ID, transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2,
      actor: 'system',
      lastError: 'attachment fetch timed out',
      baseDir,
      now: EVEN_LATER,
      ...opts,
    });
  }

  it('transitions seen to abandoned and sets lastError, carrying forward whatever attempts count already accrued', () => {
    const created = create();
    seeDocument(created.transactionId);
    // Two real failed attempts before the drain pass gives up, so this
    // pins a real accrued count, not the untouched-since-creation 0.
    recordFilingAttemptFailure(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2, actor: 'system', lastError: 'fetch failed (attempt 1)', baseDir, now: EVEN_LATER,
    });
    recordFilingAttemptFailure(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2, actor: 'system', lastError: 'fetch failed (attempt 2)', baseDir, now: EVEN_LATER,
    });
    const result = abandon(created.transactionId);

    const key = `${MESSAGE_ID.length}:${MESSAGE_ID}:${ATTACHMENT_ID}`;
    expect(result.filings[key]).toEqual({
      messageId: MESSAGE_ID,
      attachmentId: ATTACHMENT_ID,
      filename: 'agreement.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      threadId: THREAD_ID,
      sender: 'Lawyer <lawyer@firm.com>',
      receivedAt: '2026-07-16T09:00:00.000Z',
      subject: 'Purchase Agreement',
      status: 'abandoned',
      review: 'needs_review',
      seenAt: AT,
      attempts: 2,
      lastAttemptAt: AT2,
      lastError: 'attachment fetch timed out',
    });
  });

  it('emits a document_filing_abandoned event with the key, filename, attempts and lastError', () => {
    const created = create();
    seeDocument(created.transactionId);
    recordFilingAttemptFailure(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2, actor: 'system', lastError: 'fetch failed (attempt 1)', baseDir, now: EVEN_LATER,
    });
    recordFilingAttemptFailure(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2, actor: 'system', lastError: 'fetch failed (attempt 2)', baseDir, now: EVEN_LATER,
    });
    const result = abandon(created.transactionId);

    const key = `${MESSAGE_ID.length}:${MESSAGE_ID}:${ATTACHMENT_ID}`;
    const event = result.events[result.events.length - 1];
    expect(event.kind).toBe('document_filing_abandoned');
    expect(event.payload).toEqual({
      key,
      filename: 'agreement.pdf',
      attempts: 2,
      lastError: 'attachment fetch timed out',
    });
  });

  it('throws when there is no filing record at all', () => {
    const created = create();
    expect(() => abandon(created.transactionId))
      .toThrow(/no filing record/);
  });

  it('throws attempting to abandon an already-abandoned record (terminal, one-directional)', () => {
    const created = create();
    seeDocument(created.transactionId);
    abandon(created.transactionId);
    expect(() => abandon(created.transactionId))
      .toThrow(/is 'abandoned', not 'seen'/);
  });

  it('throws attempting to abandon an already-filed record (terminal, one-directional)', () => {
    const created = create();
    seeDocument(created.transactionId);
    recordDocumentFiled(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2, actor: 'system', driveFileId: 'drive-xyz', contentHash: 'sha256:deadbeef', baseDir, now: EVEN_LATER,
    });
    expect(() => abandon(created.transactionId))
      .toThrow(/is 'filed', not 'seen'/);
  });
});

describe('FILING_REVIEW_STATUSES', () => {
  it('lists exactly the three expected review statuses', () => {
    expect(FILING_REVIEW_STATUSES).toEqual(['needs_review', 'confirmed', 'rejected']);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(FILING_REVIEW_STATUSES)).toBe(true);
  });
});

describe('confirmFiling', () => {
  function confirm(transactionId, opts = {}) {
    return confirmFiling(AGENT_ID, transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2,
      actor: 'agent',
      baseDir,
      now: EVEN_LATER,
      ...opts,
    });
  }

  it('moves a needs_review record to confirmed, leaving status untouched', () => {
    const created = create();
    seeDocument(created.transactionId);
    const result = confirm(created.transactionId);

    const key = `${MESSAGE_ID.length}:${MESSAGE_ID}:${ATTACHMENT_ID}`;
    expect(result.filings[key].review).toBe('confirmed');
    expect(result.filings[key].status).toBe('seen');
  });

  it('emits a document_confirmed event with the key and filename', () => {
    const created = create();
    seeDocument(created.transactionId);
    const result = confirm(created.transactionId);

    const key = `${MESSAGE_ID.length}:${MESSAGE_ID}:${ATTACHMENT_ID}`;
    expect(result.events).toHaveLength(2);
    const event = result.events[result.events.length - 1];
    expect(event.kind).toBe('document_confirmed');
    expect(event.at).toBe(AT2);
    expect(event.actor).toBe('agent');
    expect(event.payload).toEqual({ key, filename: 'agreement.pdf' });
  });

  it('throws when there is no filing record at all', () => {
    const created = create();
    expect(() => confirm(created.transactionId))
      .toThrow(/no filing record/);
  });

  it('throws confirming an already-confirmed record (terminal, one-directional)', () => {
    const created = create();
    seeDocument(created.transactionId);
    confirm(created.transactionId);
    expect(() => confirm(created.transactionId))
      .toThrow(/review is 'confirmed', not 'needs_review'/);
  });

  it('throws confirming an already-rejected record (terminal, one-directional)', () => {
    const created = create();
    seeDocument(created.transactionId);
    rejectFiling(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
    });
    expect(() => confirm(created.transactionId))
      .toThrow(/review is 'rejected', not 'needs_review'/);
  });
});

describe('rejectFiling', () => {
  function reject(transactionId, opts = {}) {
    return rejectFiling(AGENT_ID, transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2,
      actor: 'agent',
      baseDir,
      now: EVEN_LATER,
      ...opts,
    });
  }

  it('moves a needs_review record to rejected, leaving status untouched', () => {
    const created = create();
    seeDocument(created.transactionId);
    const result = reject(created.transactionId);

    const key = `${MESSAGE_ID.length}:${MESSAGE_ID}:${ATTACHMENT_ID}`;
    expect(result.filings[key].review).toBe('rejected');
    expect(result.filings[key].status).toBe('seen');
  });

  it('emits a document_rejected event with the key and filename', () => {
    const created = create();
    seeDocument(created.transactionId);
    const result = reject(created.transactionId);

    const key = `${MESSAGE_ID.length}:${MESSAGE_ID}:${ATTACHMENT_ID}`;
    expect(result.events).toHaveLength(2);
    const event = result.events[result.events.length - 1];
    expect(event.kind).toBe('document_rejected');
    expect(event.at).toBe(AT2);
    expect(event.actor).toBe('agent');
    expect(event.payload).toEqual({ key, filename: 'agreement.pdf' });
  });

  it('throws when there is no filing record at all', () => {
    const created = create();
    expect(() => reject(created.transactionId))
      .toThrow(/no filing record/);
  });

  it('throws rejecting an already-rejected record (terminal, one-directional)', () => {
    const created = create();
    seeDocument(created.transactionId);
    reject(created.transactionId);
    expect(() => reject(created.transactionId))
      .toThrow(/review is 'rejected', not 'needs_review'/);
  });

  it('throws rejecting an already-confirmed record (terminal, one-directional)', () => {
    const created = create();
    seeDocument(created.transactionId);
    confirmFiling(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
    });
    expect(() => reject(created.transactionId))
      .toThrow(/review is 'confirmed', not 'needs_review'/);
  });

  it('a record can be status filed AND review rejected, and round-trips through the store', () => {
    const created = create();
    seeDocument(created.transactionId);
    recordDocumentFiled(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2, actor: 'system', driveFileId: 'drive-xyz', contentHash: 'sha256:deadbeef', baseDir, now: EVEN_LATER,
    });
    const result = reject(created.transactionId);

    const key = `${MESSAGE_ID.length}:${MESSAGE_ID}:${ATTACHMENT_ID}`;
    expect(result.filings[key]).toEqual({
      messageId: MESSAGE_ID,
      attachmentId: ATTACHMENT_ID,
      filename: 'agreement.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      threadId: THREAD_ID,
      sender: 'Lawyer <lawyer@firm.com>',
      receivedAt: '2026-07-16T09:00:00.000Z',
      subject: 'Purchase Agreement',
      status: 'filed',
      review: 'rejected',
      seenAt: AT,
      attempts: 0,
      driveFileId: 'drive-xyz',
      contentHash: 'sha256:deadbeef',
    });

    const reread = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(reread.filings[key].status).toBe('filed');
    expect(reread.filings[key].review).toBe('rejected');
  });
});

describe('hasConfirmedFilingOnThread', () => {
  it('returns false when the transaction has no filings map at all', () => {
    const created = create();
    const transaction = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    expect(hasConfirmedFilingOnThread(transaction, THREAD_ID)).toBe(false);
  });

  it('returns false for a seen-but-unreviewed filing on the thread', () => {
    const created = create();
    seeDocument(created.transactionId);
    const transaction = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    expect(hasConfirmedFilingOnThread(transaction, THREAD_ID)).toBe(false);
  });

  it('returns true for a confirmed filing on the thread', () => {
    const created = create();
    seeDocument(created.transactionId);
    confirmFiling(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
    });
    const transaction = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    expect(hasConfirmedFilingOnThread(transaction, THREAD_ID)).toBe(true);
  });

  it('returns false for a rejected filing on the thread', () => {
    const created = create();
    seeDocument(created.transactionId);
    rejectFiling(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
    });
    const transaction = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    expect(hasConfirmedFilingOnThread(transaction, THREAD_ID)).toBe(false);
  });

  it('returns false for a confirmed filing on a different thread', () => {
    const created = create();
    seeDocument(created.transactionId, { threadId: 'thread-other' });
    confirmFiling(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
    });
    const transaction = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    expect(hasConfirmedFilingOnThread(transaction, THREAD_ID)).toBe(false);
  });

  it('returns true for a confirmed filing whose status is abandoned - status is irrelevant', () => {
    const created = create();
    seeDocument(created.transactionId);
    confirmFiling(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
    });
    abandonDocumentFiling(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2, actor: 'system', lastError: 'drive upload failed', baseDir, now: EVEN_LATER,
    });
    const transaction = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    expect(transaction.filings[`${MESSAGE_ID.length}:${MESSAGE_ID}:${ATTACHMENT_ID}`].status).toBe('abandoned');
    expect(hasConfirmedFilingOnThread(transaction, THREAD_ID)).toBe(true);
  });

  it('returns true when one filing on the thread is rejected and another is confirmed', () => {
    const created = create();
    seeDocument(created.transactionId);
    rejectFiling(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
    });
    recordDocumentSeen(AGENT_ID, created.transactionId, MESSAGE_ID, 'att-second', {
      at: AT, actor: 'system', filename: 'second.pdf', mimeType: 'application/pdf', size: 100, threadId: THREAD_ID, sender: '', receivedAt: '', subject: '', baseDir, now: LATER,
    });
    confirmFiling(AGENT_ID, created.transactionId, MESSAGE_ID, 'att-second', {
      at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
    });
    const transaction = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    expect(hasConfirmedFilingOnThread(transaction, THREAD_ID)).toBe(true);
  });

  it('returns false for a threadId differing only in case from a confirmed record - no normalisation', () => {
    const created = create();
    seeDocument(created.transactionId);
    confirmFiling(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT2, actor: 'agent', baseDir, now: EVEN_LATER,
    });
    const transaction = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    expect(hasConfirmedFilingOnThread(transaction, THREAD_ID.toUpperCase())).toBe(false);
  });
});

// Every writer here reads the whole transaction file, patches it in memory,
// and rewrites the whole file, same as facts.js and items.js. That pattern
// is only safe under concurrent callers if the read-patch-write cycle
// cannot be interrupted mid-flight. Every step of it (store.readTransaction,
// store.writeTransaction) is synchronous fs (readFileSync, writeFileSync,
// renameSync with no callback), so once a writer starts it runs to
// completion before Node's single thread picks up anything else queued
// against the same file, regardless of how the caller schedules the calls.
// This test dispatches two writes through real macrotask boundaries (two
// separate setTimeout callbacks, not two synchronous calls in the same
// tick) to exercise that property under a realistic Promise.all-style
// caller, the shape leadIntake.js already uses for per-message work, and
// confirms neither record is lost.
describe('concurrent writes to one transaction', () => {
  it('both records survive when two recordDocumentSeen calls race via Promise.all', async () => {
    const created = create();

    function seeAfterTick(attachmentId, filename) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            resolve(recordDocumentSeen(AGENT_ID, created.transactionId, MESSAGE_ID, attachmentId, {
              at: AT, actor: 'system', filename, mimeType: 'application/pdf', size: 100, threadId: THREAD_ID, sender: '', receivedAt: '', subject: '', baseDir, now: LATER,
            }));
          } catch (err) {
            reject(err);
          }
        }, 0);
      });
    }

    await Promise.all([
      seeAfterTick('att-race-1', 'first.pdf'),
      seeAfterTick('att-race-2', 'second.pdf'),
    ]);

    const final = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(Object.keys(final.filings)).toHaveLength(2);
    expect(final.events).toHaveLength(2);

    const filenames = Object.values(final.filings).map((r) => r.filename).sort();
    expect(filenames).toEqual(['first.pdf', 'second.pdf']);
  });

  it('five concurrent seens for five different attachments all survive', async () => {
    const created = create();
    const attachmentIds = ['att-1', 'att-2', 'att-3', 'att-4', 'att-5'];

    function seeAfterTick(attachmentId) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            resolve(recordDocumentSeen(AGENT_ID, created.transactionId, MESSAGE_ID, attachmentId, {
              at: AT, actor: 'system', filename: `${attachmentId}.pdf`, mimeType: 'application/pdf', size: 1, threadId: THREAD_ID, sender: '', receivedAt: '', subject: '', baseDir, now: LATER,
            }));
          } catch (err) {
            reject(err);
          }
        }, Math.floor(Math.random() * 5));
      });
    }

    await Promise.all(attachmentIds.map(seeAfterTick));

    const final = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(Object.keys(final.filings)).toHaveLength(5);
    expect(final.events).toHaveLength(5);
  });
});
