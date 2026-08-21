'use strict';

// Per-candidate half of the TC matching rule: for ONE transaction and ONE
// message, which of four signals fired and whether the matching bar is
// met. Candidate sets, collisions and terminality are a different concern
// and do not belong here.
//
// Pure: no fs, no network, no clock, no store calls. Requiring
// filings.js pulls in store.js transitively, but requiring is not
// calling, and store.js has no module-load side effects (it only opens
// files inside function bodies).
//
// THE ABSENCE RULE. Each of signals A, B, C and D is either the boolean
// true, the boolean false, or ABSENT FROM THE signals OBJECT ENTIRELY.
// Never null, never an explicit undefined. ABSENT means the comparison
// was never formed: there was nothing on one side to compare (no
// subject and no body, no addresses on the message, no filename, or a
// stored address that does not parse). FALSE means the comparison WAS
// formed and it disagreed: there was something to compare, and it did
// not match.
//
// This distinction is not decoration. A caller that truthy-tests an
// absent key (`if (signals.A)`) still gets the right answer, because
// both absent and false are falsy. A caller that checks key presence
// (`'A' in signals`) gets a MORE PRECISE answer: whether a comparison
// happened at all, which absent-as-false can never tell it. A string
// sentinel such as 'n/a' was rejected for the same reason false was
// rejected: it is truthy, and would silently flip every truthy-testing
// caller's answer.
//
// A and C are not fully independent signals: when a message body names
// its own attachment's filename, an address found in the body and the
// same address found in the filename are, in a sense, the same
// observation twice. This cannot produce a WRONG match, because both A
// and C are anchored to the same comparison, comparing the same parsed
// transaction address against text scraped from the message. The "two
// independent observations" phrasing in TC_SPEC 7.1.1 is therefore
// looser than it reads: A and C can co-fire off a single piece of
// text repeated in two places on the same message, not two unrelated
// pieces of evidence.

const { parseAddress, compareAddresses } = require('./address');
const { findAddressCandidates } = require('./addressScan');
const { hasConfirmedFilingOnThread } = require('./filings');

const SIGNAL_KEYS = Object.freeze(['A', 'B', 'C', 'D']);

// D is sufficient alone and is never counted toward the bar, so the
// counted set is a strict subset of SIGNAL_KEYS, not a duplicate of it.
const COUNTING_SIGNALS = Object.freeze(['A', 'B', 'C']);

// -- Argument assertions ------------------------------------------------------------

function assertNonEmptyString(fnName, name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fnName}: ${name} must be a non-empty string`);
  }
}

// -- Signal A / C: address text against subject, body or filename -----------------

// Shared by A (subject + body) and C (filename): parseAddress(transaction.address)
// has already been checked non-null by the caller before either is attempted.
// text may be missing or empty; findAddressCandidates throws on an empty
// string, so this guards before ever calling it, and returns false (not
// absent) for a text that produced no address hit -- absence for A and C is
// decided by the caller, not here.
//
// THIS GUARD IS LOAD-BEARING IN PRODUCTION, NOT DEFENSIVE. Four of
// parseGmailMessage's five callers (src/gmail.js) return objects with no
// body field at all, so body is routinely undefined in real messages, not
// just in adversarial input. Line 117 evaluates
// textNamesAddress(subject, target) || textNamesAddress(body, target)
// whenever subject is present and non-matching, which reaches this
// function with body still undefined on every real message that has no
// body field. Removing this guard does not just fail an edge case; it
// throws on a routine production path. Do not tidy it away.
function textNamesAddress(text, target) {
  if (typeof text !== 'string' || text.trim() === '') {
    return false;
  }
  return findAddressCandidates(text)
    .some((candidate) => compareAddresses(candidate, target).match);
}

// -- Signal B: message addresses against participants and observedAddresses -------

function normalizeAddress(value) {
  return String(value || '').trim().toLowerCase();
}

function collectKnownAddresses(transaction) {
  const known = new Set();

  const participants = transaction.participants || {};
  Object.keys(participants).forEach((id) => {
    const emails = participants[id].emails || [];
    emails.forEach((email) => known.add(normalizeAddress(email)));
  });

  const observed = transaction.observedAddresses || {};
  Object.keys(observed).forEach((address) => known.add(normalizeAddress(address)));

  return known;
}

// -- evaluateSignals ----------------------------------------------------------------

function evaluateSignals(transaction, message) {
  if (transaction === null || typeof transaction !== 'object') {
    throw new Error('evaluateSignals: transaction must be a non-null object');
  }
  assertNonEmptyString('evaluateSignals', 'threadId', message?.threadId);
  if (!Array.isArray(message?.addresses)) {
    throw new Error('evaluateSignals: addresses must be an array');
  }

  const { threadId, addresses, subject, body, filename } = message;

  const target = parseAddress(transaction.address);
  const signals = {};

  // A and C: absent outright when the stored address does not parse, since
  // no address comparison can ever be formed against it, regardless of
  // what the message carries.
  if (target !== null) {
    const hasSubjectOrBody =
      (typeof subject === 'string' && subject.trim() !== '') ||
      (typeof body === 'string' && body.trim() !== '');
    if (hasSubjectOrBody) {
      signals.A = textNamesAddress(subject, target) || textNamesAddress(body, target);
    }

    if (typeof filename === 'string' && filename.trim() !== '') {
      signals.C = textNamesAddress(filename, target);
    }
  }

  // B: absent when addresses is empty, never absent otherwise.
  if (addresses.length > 0) {
    const known = collectKnownAddresses(transaction);
    signals.B = addresses.some((entry) => known.has(normalizeAddress(entry?.address)));
  }

  // D: never absent. An empty filings map is a real answer, and
  // hasConfirmedFilingOnThread already treats an absent filings key as
  // empty.
  signals.D = hasConfirmedFilingOnThread(transaction, threadId);

  const met = computeMet(signals);

  return { met, signals };
}

// The bar, computed in exactly one place. Every other reference to "met"
// in this module goes through this function.
function computeMet(signals) {
  if (signals.D === true) {
    return true;
  }
  const trueCount = COUNTING_SIGNALS.filter((key) => signals[key] === true).length;
  return trueCount >= 2;
}

module.exports = { evaluateSignals };

module.exports._internal = { SIGNAL_KEYS, COUNTING_SIGNALS };
