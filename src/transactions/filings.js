'use strict';

// The record for an attachment on its way from an inbox to Drive. Stored
// `filings` is a map, the same shape as `facts` and `items`: { [filingKey]:
// { messageId, attachmentId, filename, mimeType, size, threadId, sender,
// receivedAt, subject, status, review, seenAt, attempts, lastError?,
// lastAttemptAt?, contentHash?, driveFileId? } }.
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
// populates lastError or contentHash beyond what is documented below.
// Retrofitting fields onto a persisted compliance record later is worse
// than shipping them unused now.
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
//
// sender and subject are the raw, verbatim `From` and `Subject` headers,
// stored exactly as Gmail returned them: no parsing, no trimming, no
// lowercasing. This record is a compliance artifact and the verbatim-storage
// rule for stored addresses (6762e9c) applies here too; anything that needs
// a parsed sender (a filename, say) parses at read time, not at storage
// time. Both are required-but-tolerant: the caller must pass the key so a
// caller that forgot to thread it through fails immediately, but an empty
// string is a legitimate value meaning the header carried nothing. A
// missing key and an absent header are different problems and must not
// produce the same symptom.
//
// receivedAt exists alongside seenAt because they answer different
// questions: seenAt is when THIS SYSTEM saw the message; receivedAt is when
// the message arrived in the agent's inbox, taken from Gmail's own
// internalDate. TC_SPEC 7.14 guarantees these diverge -- a document that
// arrives before its transaction is even opened still gets filed on a later
// cycle, anywhere inside the matching window, so seenAt can trail
// receivedAt by days. Anything derived from "when was this received" (a
// Drive filename, for instance) has to use receivedAt: building it from
// seenAt instead would be silently wrong by however long the document
// waited, and would look completely correct.

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

// REQUIRED-BUT-TOLERANT: the key must be present in opts, but an empty
// string is an accepted value. That separates "a developer forgot to wire
// this through" (missing key, throws immediately) from "Gmail had nothing
// in this header" (empty string, a legitimate stored value) -- different
// problems that must not produce the same symptom. Checking the destructured
// value's type is enough to catch a missing key too: an omitted opts key
// destructures to undefined, which is not a string.
function assertPresentString(fnName, name, value) {
  if (typeof value !== 'string') {
    throw new Error(`${fnName}: ${name} must be present in opts as a string (empty string allowed, a missing key is not)`);
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

// Idempotent on ANY existing record, at ANY status, not only one still at
// 'seen': this is a RE-OBSERVATION, not a transition, and re-observing
// something already recorded changes nothing about what was observed, no
// matter what has happened to it since. No second event, no field reset, at
// any status. TC_SPEC 7.14's re-entrancy design is a property of the RECORD,
// not of any one caller's discipline: a guard living in a caller (intake.js,
// or 7.5's future completion detector) is a rule the NEXT caller has to
// remember to also implement, forever; a guard here is automatic for every
// caller, including ones that don't exist yet. This is the same reasoning
// that put the two-pass split on the sync/async seam rather than inside a
// single module.
//
// This is deliberately NOT the same rule TC_SPEC 7.7 enforces on
// recordDocumentFiled and abandonDocumentFiling, which DO throw re-entering
// a terminal filing, and that difference is the load-bearing point, not an
// inconsistency: those two are TRANSITIONS (seen -> filed, seen ->
// abandoned), and a transition OUT of a terminal status is illegal by
// definition -- filed -> seen makes no sense as a state change. Calling
// recordDocumentSeen on an already-filed or already-abandoned record is not
// a transition at all; it is the same message being seen again, and the
// filing's status is exactly what it was before this call, same as it was
// after.
function recordDocumentSeen(agentId, transactionId, messageId, attachmentId, opts = {}) {
  const { at, actor, filename, mimeType, size, threadId, sender, receivedAt, subject, baseDir, now } = opts;

  assertNonEmptyString('recordDocumentSeen', 'messageId', messageId);
  assertNonEmptyString('recordDocumentSeen', 'attachmentId', attachmentId);
  assertNonEmptyString('recordDocumentSeen', 'at', at);
  assertNonEmptyString('recordDocumentSeen', 'filename', filename);
  assertNonEmptyString('recordDocumentSeen', 'mimeType', mimeType);
  assertNonEmptyString('recordDocumentSeen', 'threadId', threadId);
  assertPresentString('recordDocumentSeen', 'sender', sender);
  assertPresentString('recordDocumentSeen', 'receivedAt', receivedAt);
  assertPresentString('recordDocumentSeen', 'subject', subject);
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
    throw new Error('recordDocumentSeen: size must be a non-negative number');
  }

  const previous = readExisting('recordDocumentSeen', agentId, transactionId, baseDir);
  const previousFilings = previous.filings || {};
  const key = buildFilingKey(messageId, attachmentId);
  const existing = previousFilings[key];

  if (existing) {
    return previous;
  }

  const record = {
    messageId,
    attachmentId,
    filename,
    mimeType,
    size,
    threadId,
    sender,
    receivedAt,
    subject,
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

// -- recordFilingAttemptFailure -----------------------------------------------------

// The attempts incrementer. Called by the drain pass after a failed fetch,
// folder, upload or record step, before it decides whether to give up.
//
// IT EMITS NO EVENT, unlike every other writer in this file, and that
// asymmetry is deliberate, not an oversight. TC_SPEC 7.7: the event log
// records what happened TO THE DEAL; the record itself carries what the
// MACHINE is doing about it. A fetch that failed once and then succeeds on
// the next cycle is machinery working as designed, not deal history -- nobody
// reviewing this transaction needs a log line for an attempt nothing came of.
//
// It throws if the filing is not at status 'seen', same discipline as
// recordDocumentFiled and abandonDocumentFiling: this is a mid-flight update
// to an in-progress filing, not a transition, and a terminal filing has
// nothing left to retry.
//
// It does NOT change status. Only the drain pass, by comparing the returned
// attempts count against its own retry limit, decides when to call
// abandonDocumentFiling. This function only ever reports what happened.
//
// `at` is asserted here (unlike recordDocumentFiled/abandonDocumentFiling,
// which lean on events.makeEvent to validate their own `at`): since this
// writer emits no event, makeEvent never runs, so nothing else would ever
// catch a malformed `at` before it lands in lastAttemptAt.
function recordFilingAttemptFailure(agentId, transactionId, messageId, attachmentId, opts = {}) {
  const { at, actor, lastError, baseDir, now } = opts; // eslint-disable-line no-unused-vars

  assertNonEmptyString('recordFilingAttemptFailure', 'at', at);
  assertNonEmptyString('recordFilingAttemptFailure', 'lastError', lastError);

  const previous = readExisting('recordFilingAttemptFailure', agentId, transactionId, baseDir);
  const previousFilings = previous.filings || {};
  const key = buildFilingKey(messageId, attachmentId);
  const existing = previousFilings[key];

  if (!existing) {
    throw new Error(`recordFilingAttemptFailure: no filing record '${key}' on transaction ${transactionId}`);
  }
  if (existing.status !== 'seen') {
    throw new Error(`recordFilingAttemptFailure: filing '${key}' is '${existing.status}', not 'seen'; cannot record an attempt against a terminal filing`);
  }

  const record = { ...existing, attempts: existing.attempts + 1, lastError, lastAttemptAt: at };

  const next = {
    ...previous,
    filings: { ...previousFilings, [key]: record },
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

// -- hasConfirmedFilingOnThread ----------------------------------------------------

// Pure read over an already-loaded transaction: no agentId, no readExisting,
// no store touch - the caller has the transaction in hand, unlike the
// writers above. The first argument is a transaction object, not an
// agentId, so assertNonEmptyString does not apply to it; it gets its own
// non-null-object guard instead, and threadId (a string) is still checked
// with assertNonEmptyString like every other string argument in this file.
//
// status is irrelevant and never read here: a document the agent confirmed
// belongs to this deal still belongs to it even if the Drive upload was
// abandoned. Reading status would make an infrastructure failure look like
// a matching failure. 'needs_review' is not enough - nobody has looked.
// 'rejected' is evidence the thread does NOT belong to this transaction,
// never evidence that it does.
//
// Returns a boolean, deliberately unlike compareAddresses and
// resolveParticipantByName, which return result objects: the question here
// is genuinely yes-or-no, and returning the matching record would invite
// callers to use this as a filing lookup - a different function, keyed on
// message/attachment rather than thread.
function hasConfirmedFilingOnThread(transaction, threadId) {
  if (transaction === null || typeof transaction !== 'object') {
    throw new Error('hasConfirmedFilingOnThread: transaction must be a non-null object');
  }
  assertNonEmptyString('hasConfirmedFilingOnThread', 'threadId', threadId);

  const filings = transaction.filings || {};
  return Object.values(filings).some(
    (record) => record.threadId === threadId && record.review === 'confirmed'
  );
}

module.exports = {
  FILING_STATUSES,
  FILING_REVIEW_STATUSES,
  buildFilingKey,
  recordDocumentSeen,
  recordDocumentFiled,
  recordFilingAttemptFailure,
  abandonDocumentFiling,
  confirmFiling,
  rejectFiling,
  hasConfirmedFilingOnThread,
};

module.exports._internal = {
  buildFilingKey,
};
