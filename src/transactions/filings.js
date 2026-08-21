'use strict';

// The record for an attachment on its way from an inbox to Drive. Stored
// `filings` is a map, the same shape as `facts` and `items`: { [filingKey]:
// { messageId, attachmentId, filename, mimeType, size, threadId, status,
// review, seenAt, attempts, lastError?, lastAttemptAt?, contentHash?,
// driveFileId? } }.
//
// Key: `${messageId.length}:${messageId}:${attachmentId}`. A plain
// `${messageId}:${attachmentId}` join is not safe: Gmail does not document
// a character set for either id, so nothing rules out one of them
// containing a colon, and two different (messageId, attachmentId) pairs
// could then produce the same string. Prefixing with messageId's length
// pins exactly where messageId ends regardless of what characters either id
// contains, so the join is injective. The content hash cannot be the key:
// this record is written before the bytes exist, at seen-time.
//
// attempts, lastError, lastAttemptAt, contentHash and driveFileId are part
// of the shape from the first commit even though nothing in this module
// populates lastError, lastAttemptAt or contentHash beyond what is
// documented below. Retrofitting fields onto a persisted compliance record
// later is worse than shipping them unused now.
//
// Absent, never null, for every field that has no value yet: this follows
// listingId and unit in store.js. `review` is the deliberate exception: it
// is set to 'needs_review' at creation rather than left absent, because
// "nobody has looked yet" is itself a real state the agent needs to see,
// not a missing value.
//
// `threadId` is stored so signal D ("has this thread been filed against
// this transaction") can be answered; this commit only stores the field,
// it does not add a reader for it.

const store = require('./store');
const events = require('./events');

const FILING_STATUSES = Object.freeze(['seen', 'filed', 'abandoned']);

// A second, independent axis. `status` is what the machine did with the
// bytes; `review` is what the agent said about the match. A document can be
// filed AND rejected - it landed in Drive on the wrong deal - so this is a
// separate field, not new members of `status`.
const FILING_REVIEW_STATUSES = Object.freeze(['needs_review', 'confirmed', 'rejected']);

// -- Key ------------------------------------------------------------------------

function buildFilingKey(messageId, attachmentId) {
  return `${messageId.length}:${messageId}:${attachmentId}`;
}

// -- Argument assertions ------------------------------------------------------------

function assertNonEmptyString(fnName, name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fnName}: ${name} must be a non-empty string`);
  }
}

function readExisting(fnName, agentId, transactionId, baseDir) {
  const previous = store.readTransaction(agentId, transactionId, { baseDir });
  if (previous === null) {
    throw new Error(`${fnName}: no transaction ${transactionId} for agent ${agentId}`);
  }
  return previous;
}

// -- recordDocumentSeen ---------------------------------------------------------

// Idempotent on an already-seen record: returns the transaction unchanged,
// with no second event and no field reset. This is a true no-op, not a
// rewrite of identical bytes: readers relying on updatedAt to mean "this
// file changed" would be misled by a write that changes nothing meaningful.
// Re-seeing a record that has moved on to filed or abandoned is refused:
// that would be a transition out of a terminal status through the back
// door of the seen writer.
function recordDocumentSeen(agentId, transactionId, messageId, attachmentId, opts = {}) {
  const { at, actor, filename, mimeType, size, threadId, baseDir, now } = opts;

  assertNonEmptyString('recordDocumentSeen', 'messageId', messageId);
  assertNonEmptyString('recordDocumentSeen', 'attachmentId', attachmentId);
  assertNonEmptyString('recordDocumentSeen', 'at', at);
  assertNonEmptyString('recordDocumentSeen', 'filename', filename);
  assertNonEmptyString('recordDocumentSeen', 'mimeType', mimeType);
  assertNonEmptyString('recordDocumentSeen', 'threadId', threadId);
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
    throw new Error('recordDocumentSeen: size must be a non-negative number');
  }

  const previous = readExisting('recordDocumentSeen', agentId, transactionId, baseDir);
  const previousFilings = previous.filings || {};
  const key = buildFilingKey(messageId, attachmentId);
  const existing = previousFilings[key];

  if (existing) {
    if (existing.status === 'seen') {
      return previous;
    }
    throw new Error(`recordDocumentSeen: filing '${key}' is already '${existing.status}'; cannot re-seen a terminal filing`);
  }

  const record = {
    messageId,
    attachmentId,
    filename,
    mimeType,
    size,
    threadId,
    status: 'seen',
    review: 'needs_review',
    seenAt: at,
    attempts: 0,
  };

  const event = events.makeEvent({
    at,
    actor,
    kind: 'document_seen',
    payload: { key, filename, mimeType, size },
  });

  const next = {
    ...previous,
    filings: { ...previousFilings, [key]: record },
    events: events.appendEvent(previous.events, event),
  };

  return store.writeTransaction(agentId, next, { baseDir, now });
}

// -- recordDocumentFiled ----------------------------------------------------------

function recordDocumentFiled(agentId, transactionId, messageId, attachmentId, opts = {}) {
  const { at, actor, driveFileId, contentHash, baseDir, now } = opts;

  assertNonEmptyString('recordDocumentFiled', 'driveFileId', driveFileId);
  assertNonEmptyString('recordDocumentFiled', 'contentHash', contentHash);

  const previous = readExisting('recordDocumentFiled', agentId, transactionId, baseDir);
  const previousFilings = previous.filings || {};
  const key = buildFilingKey(messageId, attachmentId);
  const existing = previousFilings[key];

  if (!existing) {
    throw new Error(`recordDocumentFiled: no filing record '${key}' on transaction ${transactionId}`);
  }
  if (existing.status !== 'seen') {
    throw new Error(`recordDocumentFiled: filing '${key}' is '${existing.status}', not 'seen'; cannot transition out of a terminal status`);
  }

  const record = { ...existing, status: 'filed', driveFileId, contentHash };

  const event = events.makeEvent({
    at,
    actor,
    kind: 'document_filed',
    payload: { key, filename: existing.filename, driveFileId, contentHash },
  });

  const next = {
    ...previous,
    filings: { ...previousFilings, [key]: record },
    events: events.appendEvent(previous.events, event),
  };

  return store.writeTransaction(agentId, next, { baseDir, now });
}

// -- abandonDocumentFiling ----------------------------------------------------------

function abandonDocumentFiling(agentId, transactionId, messageId, attachmentId, opts = {}) {
  const { at, actor, lastError, baseDir, now } = opts;

  assertNonEmptyString('abandonDocumentFiling', 'lastError', lastError);

  const previous = readExisting('abandonDocumentFiling', agentId, transactionId, baseDir);
  const previousFilings = previous.filings || {};
  const key = buildFilingKey(messageId, attachmentId);
  const existing = previousFilings[key];

  if (!existing) {
    throw new Error(`abandonDocumentFiling: no filing record '${key}' on transaction ${transactionId}`);
  }
  if (existing.status !== 'seen') {
    throw new Error(`abandonDocumentFiling: filing '${key}' is '${existing.status}', not 'seen'; cannot transition out of a terminal status`);
  }

  const record = { ...existing, status: 'abandoned', lastError };

  const event = events.makeEvent({
    at,
    actor,
    kind: 'document_filing_abandoned',
    payload: { key, filename: existing.filename, attempts: existing.attempts, lastError },
  });

  const next = {
    ...previous,
    filings: { ...previousFilings, [key]: record },
    events: events.appendEvent(previous.events, event),
  };

  return store.writeTransaction(agentId, next, { baseDir, now });
}

// -- confirmFiling ----------------------------------------------------------

function confirmFiling(agentId, transactionId, messageId, attachmentId, opts = {}) {
  const { at, actor, baseDir, now } = opts;

  const previous = readExisting('confirmFiling', agentId, transactionId, baseDir);
  const previousFilings = previous.filings || {};
  const key = buildFilingKey(messageId, attachmentId);
  const existing = previousFilings[key];

  if (!existing) {
    throw new Error(`confirmFiling: no filing record '${key}' on transaction ${transactionId}`);
  }
  if (existing.review !== 'needs_review') {
    throw new Error(`confirmFiling: filing '${key}' review is '${existing.review}', not 'needs_review'; cannot transition out of a terminal review`);
  }

  const record = { ...existing, review: 'confirmed' };

  const event = events.makeEvent({
    at,
    actor,
    kind: 'document_confirmed',
    payload: { key, filename: existing.filename },
  });

  const next = {
    ...previous,
    filings: { ...previousFilings, [key]: record },
    events: events.appendEvent(previous.events, event),
  };

  return store.writeTransaction(agentId, next, { baseDir, now });
}

// -- rejectFiling ----------------------------------------------------------

function rejectFiling(agentId, transactionId, messageId, attachmentId, opts = {}) {
  const { at, actor, baseDir, now } = opts;

  const previous = readExisting('rejectFiling', agentId, transactionId, baseDir);
  const previousFilings = previous.filings || {};
  const key = buildFilingKey(messageId, attachmentId);
  const existing = previousFilings[key];

  if (!existing) {
    throw new Error(`rejectFiling: no filing record '${key}' on transaction ${transactionId}`);
  }
  if (existing.review !== 'needs_review') {
    throw new Error(`rejectFiling: filing '${key}' review is '${existing.review}', not 'needs_review'; cannot transition out of a terminal review`);
  }

  const record = { ...existing, review: 'rejected' };

  const event = events.makeEvent({
    at,
    actor,
    kind: 'document_rejected',
    payload: { key, filename: existing.filename },
  });

  const next = {
    ...previous,
    filings: { ...previousFilings, [key]: record },
    events: events.appendEvent(previous.events, event),
  };

  return store.writeTransaction(agentId, next, { baseDir, now });
}

module.exports = {
  FILING_STATUSES,
  FILING_REVIEW_STATUSES,
  recordDocumentSeen,
  recordDocumentFiled,
  abandonDocumentFiling,
  confirmFiling,
  rejectFiling,
};

module.exports._internal = {
  buildFilingKey,
};
