'use strict';

// Shared subject and mailto text for the assistant@ TC verbs. One place a
// builder (the daily brief, commit 6) and the parser (actionHandler.js)
// both import, so they cannot drift (docs/designs/done-verb.md's commit-2
// recon). Pure and synchronous: no disk, no clock, no sending.

const store = require('./store');
const proposals = require('./proposals');
const rules = require('./rules');
const { ASSISTANT_EMAIL } = require('../assistantAddress');

// Shared tail for every assistant@ tap's pre-filled body (DONE, RECEIPT,
// UNDO): one sentence, no line breaks, telling the agent the tap is
// already the whole action -- press Send, nothing else to fill in.
// Session 97: moved here from digestDeals.js so the daily brief's own
// tap bodies and actionHandler.js's Undo-link body read off the one
// string, the same reasoning this file's own header comment already
// gives for the subject/mailto builders. "within a few minutes" added
// (live Undo test, 2026-10-27): the reply arrives on the next 5-minute
// cycle, not instantly, and an agent waiting with no hint may tap twice.
const TAP_BODY_TAIL = " Just press Send. You'll get a confirmation back within a few minutes.";

// Loose claim: decides whether this branch is entered at all. No Re:/Fwd:
// stripping -- a forwarded/replied subject is not claimed, same as CALLED.
// txn- directly after the verb is what keeps an ordinary "Done with the
// showing" email out of this branch and on Track 2 (docs/designs/done-verb.md).
const TC_CLAIM_RE = /^\s*(CONFIRM|REJECT|WRONGDEAL|DONE|RECEIPT|UNDO)\s+txn-/i;

// Strict parse of a claimed subject. Verb word case-insensitive; ids
// validated as-is (never case-normalized, never checked against a deal's
// catalog here -- that is taps.js's job, surfaced as unknown_item).
// Anything that doesn't match this shape exactly is a parse failure, never
// a composition call.
function parseTcCommand(subject) {
  const tokens = subject.trim().split(/\s+/);
  const verb = (tokens[0] || '').toUpperCase();

  if (verb === 'REJECT') {
    if (tokens.length !== 4) return null;
    const [, transactionId, setId, memberId] = tokens;
    if (!store.isTransactionId(transactionId)) return null;
    if (!proposals.isProposalSetId(setId)) return null;
    if (!proposals.isProposalMemberId(memberId)) return null;
    return { verb, transactionId, setId, memberId };
  }

  if (verb === 'DONE') {
    if (tokens.length !== 3) return null;
    const [, transactionId, itemId] = tokens;
    if (!store.isTransactionId(transactionId)) return null;
    return { verb, transactionId, itemId };
  }

  if (verb === 'RECEIPT') {
    if (tokens.length !== 3) return null;
    const [, transactionId, receiptItemId] = tokens;
    if (!store.isTransactionId(transactionId)) return null;
    return { verb, transactionId, receiptItemId };
  }

  if (verb === 'UNDO') {
    // txn- plus one to three item ids: at most 3, the longest deposit chain.
    if (tokens.length < 3 || tokens.length > 5) return null;
    const [, transactionId, ...itemIds] = tokens;
    if (!store.isTransactionId(transactionId)) return null;
    return { verb, transactionId, itemIds };
  }

  if (verb !== 'CONFIRM' && verb !== 'WRONGDEAL') return null;
  if (tokens.length !== 3) return null;
  const [, transactionId, setId] = tokens;
  if (!store.isTransactionId(transactionId)) return null;
  if (!proposals.isProposalSetId(setId)) return null;
  return { verb, transactionId, setId, memberId: null };
}

// label lives on the static catalog item (rules.CATALOG[type]) and is never
// stripped by the resolver (resolver.js annotateItem spreads the item), but
// a reply only ever needs the static lookup: by the time DONE/RECEIPT/UNDO
// reach a reply, the id is already known to taps.js's own checks.
function catalogItemLabel(type, itemId) {
  const item = rules.CATALOG[type].find((candidate) => candidate.id === itemId);
  return item ? item.label : itemId;
}

function buildDoneSubject(transactionId, itemId) {
  return `DONE ${transactionId} ${itemId}`;
}

function buildReceiptSubject(transactionId, receiptItemId) {
  return `RECEIPT ${transactionId} ${receiptItemId}`;
}

function buildUndoSubject(transactionId, itemIds) {
  return `UNDO ${transactionId} ${itemIds.join(' ')}`;
}

// body is optional and always the last argument: omitted, the href is
// byte-identical to before body existed (every existing caller and test
// that builds a subject-only href keeps working unchanged). Appended after
// subject, never before, so a caller that only ever reads the subject back
// out of the href (tapLinks.test.js's subjectFromHref) is unaffected by its
// presence.
function withBody(href, body) {
  return body === undefined ? href : `${href}&body=${encodeURIComponent(body)}`;
}

function buildDoneMailtoHref(transactionId, itemId, body) {
  return withBody(`mailto:${ASSISTANT_EMAIL}?subject=${encodeURIComponent(buildDoneSubject(transactionId, itemId))}`, body);
}

function buildReceiptMailtoHref(transactionId, receiptItemId, body) {
  return withBody(`mailto:${ASSISTANT_EMAIL}?subject=${encodeURIComponent(buildReceiptSubject(transactionId, receiptItemId))}`, body);
}

function buildUndoMailtoHref(transactionId, itemIds, body) {
  return withBody(`mailto:${ASSISTANT_EMAIL}?subject=${encodeURIComponent(buildUndoSubject(transactionId, itemIds))}`, body);
}

module.exports = {
  TC_CLAIM_RE,
  parseTcCommand,
  catalogItemLabel,
  TAP_BODY_TAIL,
  buildDoneSubject,
  buildReceiptSubject,
  buildUndoSubject,
  buildDoneMailtoHref,
  buildReceiptMailtoHref,
  buildUndoMailtoHref,
};
