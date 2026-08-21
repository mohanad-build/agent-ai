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
const states = require('./states');

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

// -- matchTransaction ----------------------------------------------------------------

// Candidate-set half of the TC matching rule, TC_SPEC 7.1.2. Takes a set of
// candidate transactions and one message, filters out terminal candidates,
// runs each survivor through evaluateSignals above, and resolves the set of
// candidates that met the bar down to a single winner or a reason the
// caller cannot pick one. evaluateSignals is not changed by any of this;
// this function only composes it.
//
// THE LISTING LINK IS REQUIRED, NOT INFERRED. A deal only beats its listing
// when transaction.listingId names that exact listing. It is tempting to
// widen this to "paired types plus a matching address", since that is
// almost always the same deal. It is not always the same deal: a
// landlord_listing on unit 302 and a landlord_lease on unit 505 in the same
// building compare equal on address (address.js does not read unit) but
// are two different apartments under one roof. Treating that pair as
// linked would silently attach a lease to the wrong listing's compliance
// record. The unit check below (rule b) exists because of exactly this
// case, and it runs before the paired-type-plus-address check (rule c) so
// that a real building-level collision is never masked by an address match
// that was never specific enough to prove anything.
//
// UNITS DIFFERING IS EVIDENCE; UNITS ABSENT IS NOT. Two candidates with
// different stored units are provably different apartments. Two candidates
// where one or both have no stored unit tell us nothing: most agents type
// just a street address, so an absent unit is the common case, not a
// signal that the properties are the same. Treating absence as agreement
// would turn "we don't know" into "confirmed same building", which is the
// wrong direction to guess in on a compliance record.
//
// THREE OR MORE CANDIDATES IS A NAMED OPEN PROBLEM. A seller_listing, a
// seller_sale and a buyer_purchase can all legitimately meet the bar on
// one address at once (the true double-end case: ONE agent representing
// both sides of the same property, so the same agent's own message can
// carry signals for the listing, the sale and the purchase all at once).
// The brokerage's system of record opens ONE deal file on a double-end,
// not two, so whether three transactions is even the right model here is
// an open section 3 question, not a matching problem to solve in this
// module. Nothing below tries to rank or pair three or more candidates;
// it reports 'ambiguous' and stops. Solving the double-end case is out of
// scope for this commit.

function normalizeUnit(value) {
  return String(value).trim().toLowerCase();
}

// Returns { deal, listing } when exactly one of a, b is a deal type whose
// paired listing type (states.listingTypeForDeal) equals the other's type.
// Returns null otherwise, including when neither side is a deal type with
// a paired listing (buyer_purchase, tenant_lease, and the listing types
// themselves all resolve to undefined here) and when both or neither side
// qualifies.
function pairedDealAndListing(a, b) {
  const aListingType = states.listingTypeForDeal(a.type);
  if (aListingType !== undefined && aListingType === b.type) {
    return { deal: a, listing: b };
  }
  const bListingType = states.listingTypeForDeal(b.type);
  if (bListingType !== undefined && bListingType === a.type) {
    return { deal: b, listing: a };
  }
  return null;
}

// Rule a: deal beats listing. The listingId link is required; see the
// module comment above for why paired types plus address is not enough.
function ruleDealBeatsListing(a, b) {
  const pair = pairedDealAndListing(a, b);
  if (pair === null) {
    return null;
  }
  if (pair.deal.listingId !== undefined && pair.deal.listingId === pair.listing.transactionId) {
    return pair;
  }
  return null;
}

// Rule b: same building. Runs regardless of type pairing; see the module
// comment above for why absence on either side is not evidence.
function ruleSameBuilding(a, b) {
  if (a.unit === undefined || b.unit === undefined) {
    return false;
  }
  return normalizeUnit(a.unit) !== normalizeUnit(b.unit);
}

// Rule c: unlinked listing. Paired types plus a comparing-equal address,
// with no listingId link (rule a already failed by the time this runs).
function ruleUnlinkedListing(a, b) {
  const pair = pairedDealAndListing(a, b);
  if (pair === null) {
    return false;
  }
  return compareAddresses(parseAddress(a.address), parseAddress(b.address)).match;
}

// Resolves exactly two matching-set entries per the ordered rules a
// through d. entries[*].transaction is the full candidate object;
// entries[*].result is that candidate's evaluateSignals return value.
function resolvePair(entries, candidateIds) {
  const [a, b] = entries.map((entry) => entry.transaction);

  const dealBeatsListing = ruleDealBeatsListing(a, b);
  if (dealBeatsListing !== null) {
    const winner = entries.find((entry) => entry.transaction === dealBeatsListing.deal);
    return {
      matched: true,
      transactionId: dealBeatsListing.deal.transactionId,
      signals: winner.result.signals,
      resolution: 'deal_over_listing',
      supersededTransactionId: dealBeatsListing.listing.transactionId,
    };
  }

  if (ruleSameBuilding(a, b)) {
    return { matched: false, reason: 'ambiguous_same_building', candidateIds };
  }

  if (ruleUnlinkedListing(a, b)) {
    return { matched: false, reason: 'ambiguous_unlinked_listing', candidateIds };
  }

  return { matched: false, reason: 'ambiguous', candidateIds };
}

function matchTransaction(candidates, message) {
  if (!Array.isArray(candidates)) {
    throw new Error('matchTransaction: candidates must be an array');
  }

  // isTerminal throws on an unknown type or empty state and that throw is
  // deliberately not caught here: a transaction the store wrote that
  // states.js cannot read is a store bug, and swallowing it would mean a
  // real deal silently never matches anything, forever.
  const nonTerminal = candidates.filter(
    (transaction) => !states.isTerminal(transaction.type, transaction.state)
  );

  const matchingSet = nonTerminal
    .map((transaction) => ({ transaction, result: evaluateSignals(transaction, message) }))
    .filter((entry) => entry.result.met === true);

  if (matchingSet.length === 0) {
    const reason = nonTerminal.length === 0 ? 'no_candidates' : 'no_bar_met';
    return { matched: false, reason, candidateIds: [] };
  }

  if (matchingSet.length === 1) {
    const [{ transaction, result }] = matchingSet;
    return {
      matched: true,
      transactionId: transaction.transactionId,
      signals: result.signals,
      resolution: 'single',
    };
  }

  const candidateIds = matchingSet
    .map((entry) => entry.transaction.transactionId)
    .sort((a, b) => a.localeCompare(b));

  if (matchingSet.length === 2) {
    return resolvePair(matchingSet, candidateIds);
  }

  return { matched: false, reason: 'ambiguous', candidateIds };
}

module.exports = { evaluateSignals, matchTransaction };

module.exports._internal = { SIGNAL_KEYS, COUNTING_SIGNALS };
