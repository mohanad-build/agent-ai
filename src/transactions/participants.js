'use strict';

// Transaction-scoped participants: everyone with a hand in a deal, one
// record per human, keyed by a generated id rather than collected in an
// array. A map makes lookup by id direct and makes two records for the same
// person impossible in a way an array never could. Stored `participants` is
// { [participantId]: { roles, name?, emails?, phone?, entityType?,
// isSelfRepresented? } }, the same shape family as `items` (items.js) and
// `filings` (filings.js): absent, never null, for every optional field with
// no value, following listingId and unit in store.js.
//
// roles is an array, not a single string, because one person can hold two
// roles on one transaction: a self-represented seller who is also the
// property manager is one human with two hats, not two records.
//
// This module deliberately does NOT validate role combinations. A lawyer
// representing both sides of a deal is not legal, and an agent representing
// both sides is multiple representation with its own disclosure form, but
// this is a record of what happened, not a gate on what is allowed to
// happen: the write goes through either way. Do not add a combination
// guard here later.
//
// ROLES ARE SET-ONCE. A role never changes mid-deal: if a lawyer is
// replaced, the old participant stays on the file and a new one is added,
// because the record shows who was involved over the life of the deal, not
// only who is involved right now. There is no updateParticipantRole, and
// none should be added: a changed role is a new participant, not a
// mutation of an old one.
//
// VOIDING MOVES, IT DOES NOT FLAG. voidParticipant removes an entry from
// `participants` entirely and writes it into a sibling top-level map,
// `voidedParticipants`, keyed by the same id. It is not a status field on
// the live record, because every direct reader of `participants`
// (matcher.js's collectKnownAddresses, satisfactions.js's
// assertRepresented, this module's own deriveRepresentedPersons and
// resolveParticipantByName, scripts/list-participants.js) reads the live
// map's full contents with no status filter. A flag would require every
// one of those to learn a new rule; a move requires none of them to
// change at all, because the live map now simply contains the right set.
// There is no editParticipant either: a void's reason is recorded once,
// at the moment of voiding, and is not a mutable field on either record.
//
// representedPersons is no longer a stored fact: checklist.js derives it
// from this module's participants map via deriveRepresentedPersons below,
// and satisfactions.js gates markPersonSatisfied/markPersonUnsatisfied
// against this module's participants map directly, rather than against a
// stored representedPersons array. resolver.js itself is unchanged: it
// still only ever sees a facts object, and still treats an absent
// representedPersons key as "nobody named yet" rather than "named nobody".

const crypto = require('node:crypto');

const store = require('./store');
const events = require('./events');
const { normalizeEmailAddress } = require('./emailAddress');

// -- ID generation --------------------------------------------------------------

// Follows the one id-minting convention in the codebase, generateTransactionId
// (store.js:66-70): crypto.randomBytes(4).toString('hex'), no collision
// handling. No date prefix here: a participant has no meaningful date the
// way a transaction does, so the format is just `per-` plus 8 hex chars.
const PARTICIPANT_ID_RE = /^per-[0-9a-f]{8}$/;

function generateParticipantId() {
  return `per-${crypto.randomBytes(4).toString('hex')}`;
}

// -- Argument assertions ------------------------------------------------------------

function assertNonEmptyString(fnName, name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fnName}: ${name} must be a non-empty string`);
  }
}

function assertRoles(fnName, name, value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${fnName}: ${name} must be a non-empty array of non-empty strings`);
  }
  value.forEach((role) => {
    if (typeof role !== 'string' || role.trim() === '') {
      throw new Error(`${fnName}: ${name} must be a non-empty array of non-empty strings`);
    }
  });
  value.forEach((role) => {
    if (!PARTICIPANT_ROLES.includes(role)) {
      throw new Error(`${fnName}: ${name} contains unknown role ${JSON.stringify(role)}`);
    }
  });
  const seen = new Set();
  value.forEach((role) => {
    if (seen.has(role)) {
      throw new Error(`${fnName}: ${name} contains duplicate role ${JSON.stringify(role)}`);
    }
    seen.add(role);
  });
}

function assertEmails(fnName, name, value) {
  if (!Array.isArray(value)) {
    throw new Error(`${fnName}: ${name} must be an array of non-empty strings`);
  }
  value.forEach((email) => {
    if (typeof email !== 'string' || email.trim() === '') {
      throw new Error(`${fnName}: ${name} must be an array of non-empty strings`);
    }
  });
}

function assertBoolean(fnName, name, value) {
  if (typeof value !== 'boolean') {
    throw new Error(`${fnName}: ${name} must be a boolean`);
  }
}

// Validates the six fields addParticipant accepts, in the same order and
// with the same messages addParticipant has always used, so a second
// caller (a future proposal-confirmation writer, see TC_SPEC section 14)
// can validate against the identical rules without duplicating them.
// undefined means the field is absent and must not appear on the written
// record at all; explicitly passing null is a caller bug and throws, the
// same convention as listingId and unit in store.js. Each assertion
// rejects null on its own (typeof null is not 'string', not a boolean,
// not an array), so no separate null check is needed here.
function assertParticipantFields(fnName, fields) {
  const { roles, name, emails, phone, entityType, isSelfRepresented } = fields;

  assertRoles(fnName, 'roles', roles);

  if (name !== undefined) {
    assertNonEmptyString(fnName, 'name', name);
  }
  if (emails !== undefined) {
    assertEmails(fnName, 'emails', emails);
  }
  if (phone !== undefined) {
    assertNonEmptyString(fnName, 'phone', phone);
  }
  if (entityType !== undefined) {
    assertNonEmptyString(fnName, 'entityType', entityType);
  }
  if (isSelfRepresented !== undefined) {
    assertBoolean(fnName, 'isSelfRepresented', isSelfRepresented);
  }
}

// Two permitted values, not a free-text field: 'recorded_in_error' means
// the entry should never have existed (a duplicate, a wrong name typed
// against the wrong deal); 'no_longer_on_deal' means the person was real
// and genuinely involved, but is not any more (a lawyer who withdrew, a
// co-buyer who dropped off the deal). The distinction matters to whoever
// reads the file later, the same reason FILING_REVIEW_STATUSES and
// FACT_KEYS are closed lists rather than strings the caller invents.
const VOID_REASONS = Object.freeze(['recorded_in_error', 'no_longer_on_deal']);

function assertVoidReason(fnName, reason) {
  if (!VOID_REASONS.includes(reason)) {
    throw new Error(`${fnName}: reason must be one of ${VOID_REASONS.join(', ')}`);
  }
}

// Voiding is a judgment call about who belongs on a deal file, never an
// automated inference: 'system' (events.js's ACTORS) is refused here even
// though makeEvent below would otherwise accept it. This is a narrower
// rule than makeEvent's own actor check, enforced before it, so the error
// names voidParticipant rather than makeEvent.
function assertVoidActor(fnName, actor) {
  if (actor !== 'agent') {
    throw new Error(`${fnName}: actor must be 'agent'`);
  }
}

function readExisting(fnName, agentId, transactionId, baseDir) {
  const previous = store.readTransaction(agentId, transactionId, { baseDir });
  if (previous === null) {
    throw new Error(`${fnName}: no transaction ${transactionId} for agent ${agentId}`);
  }
  return previous;
}

// -- addParticipant -----------------------------------------------------------------

function addParticipant(agentId, transactionId, roles, opts = {}) {
  const { name, emails, phone, entityType, isSelfRepresented, at, actor, baseDir, now } = opts;

  assertParticipantFields('addParticipant', { roles, name, emails, phone, entityType, isSelfRepresented });

  const entry = { roles: [...roles] };

  if (name !== undefined) {
    entry.name = name;
  }
  if (emails !== undefined) {
    entry.emails = [...emails];
  }
  if (phone !== undefined) {
    entry.phone = phone;
  }
  if (entityType !== undefined) {
    entry.entityType = entityType;
  }
  if (isSelfRepresented !== undefined) {
    entry.isSelfRepresented = isSelfRepresented;
  }

  const previous = readExisting('addParticipant', agentId, transactionId, baseDir);
  const id = generateParticipantId();

  // Ids must stay unique across BOTH participants and voidedParticipants,
  // not just within the live map: clientSatisfactions is keyed by
  // participant id, and voiding never removes an id from
  // voidedParticipants, so a freshly generated id landing on one already
  // used there would silently point satisfactions history recorded
  // against the voided person at whoever this call is adding instead.
  // generateParticipantId's collision odds are astronomically low
  // (crypto.randomBytes(4)) but this is the writer that could actually
  // produce the collision, so this is where it gets checked.
  if (
    Object.prototype.hasOwnProperty.call(previous.participants || {}, id) ||
    Object.prototype.hasOwnProperty.call(previous.voidedParticipants || {}, id)
  ) {
    throw new Error(`addParticipant: generated id '${id}' is already in use on transaction ${transactionId}`);
  }

  const event = events.makeEvent({ at, actor, kind: 'participant_added', payload: { id, roles: entry.roles } });

  const next = {
    ...previous,
    participants: { ...(previous.participants || {}), [id]: entry },
    events: events.appendEvent(previous.events, event),
  };

  return store.writeTransaction(agentId, next, { baseDir, now });
}

// -- voidParticipant ------------------------------------------------------------

// Moves one entry from `participants` to `voidedParticipants`, keyed by the
// same id in both maps (never in both at once). The moved record is the
// live entry unchanged, plus `at`, `actor` and `reason` added onto it --
// the same shape discipline satisfactions.js uses for its own per-item
// { at, actor } records, extended with the one extra field a void needs
// that a satisfaction does not.
//
// clientSatisfactions is deliberately left untouched: entries recorded
// against this id still point at it, now inside voidedParticipants rather
// than participants. That is the intended record of who satisfied what
// before being voided, not a dangling reference to clean up.
function voidParticipant(agentId, transactionId, participantId, opts = {}) {
  const { reason, at, actor, baseDir, now } = opts;

  assertVoidReason('voidParticipant', reason);
  assertVoidActor('voidParticipant', actor);

  const previous = readExisting('voidParticipant', agentId, transactionId, baseDir);
  const liveParticipants = previous.participants || {};
  const voidedParticipants = previous.voidedParticipants || {};

  // Two different mistakes get two different messages: an id that never
  // named anyone on this transaction is a caller error (wrong id, wrong
  // transaction); an id that already names a voided entry is a caller
  // trying to void the same person twice. Collapsing these into one
  // "not available" message would hide which one actually happened.
  if (!Object.prototype.hasOwnProperty.call(liveParticipants, participantId)) {
    if (Object.prototype.hasOwnProperty.call(voidedParticipants, participantId)) {
      throw new Error(`voidParticipant: '${participantId}' is already voided on transaction ${transactionId}`);
    }
    throw new Error(`voidParticipant: '${participantId}' is not a participant on transaction ${transactionId}`);
  }

  const liveEntry = liveParticipants[participantId];

  const event = events.makeEvent({ at, actor, kind: 'participant_voided', payload: { id: participantId, reason } });

  const nextParticipants = { ...liveParticipants };
  delete nextParticipants[participantId];

  const nextVoided = {
    ...voidedParticipants,
    [participantId]: { ...liveEntry, at, actor, reason },
  };

  const next = {
    ...previous,
    participants: nextParticipants,
    voidedParticipants: nextVoided,
    events: events.appendEvent(previous.events, event),
  };

  return store.writeTransaction(agentId, next, { baseDir, now });
}

// -- addParticipantEmail --------------------------------------------------------

// Appends one email address to an EXISTING live participant. Add-only:
// never replaces, reorders or removes an entry already in `emails`, the
// same set-once discipline this module already holds for roles. There is
// no removeParticipantEmail for the same reason there is no
// updateParticipantRole -- this is a record of what was learned about a
// person, not a mutable profile.
//
// A voided participant refuses, distinctly from an unknown id, the same
// two-message split voidParticipant already makes: a voided person is
// history, and history does not take new facts.
//
// DUPLICATE IS A NO-OP THAT WRITES NOTHING, following accumulator.js's
// distinct-outcomes convention rather than voidParticipant's throw-or-
// write convention: a duplicate is not a caller error the way a bad
// reason or an unknown id is, it is a fact the caller already told this
// transaction, so there is nothing to refuse and nothing to write. This
// is the same zero-net-change-write problem TC_SPEC 7.13's accumulator
// exists to avoid (see recordObservedAddresses's own "three states, not a
// guard on entries.length alone" reasoning in observedAddresses.js): no
// event, no store write, no updatedAt churn, just a reported outcome.
//
// The stored value is the caller's own casing and whitespace, unchanged
// (following addParticipant's existing storage behavior for emails); the
// duplicate check compares both sides through normalizeEmailAddress
// (emailAddress.js), the same helper matcher.js's collectKnownAddresses
// now shares, so "already has this address" cannot disagree with what
// signal B would consider a match.
//
// actor is deliberately NOT restricted to 'agent' the way voidParticipant
// restricts its own actor: voiding is a judgment call, recording an
// address seen on a message is not, and accumulator.js (TC_SPEC 7.13) is
// a plausible future caller writing as 'system'. events.makeEvent's own
// ACTORS check is the only actor validation here.
function addParticipantEmail(agentId, transactionId, participantId, email, opts = {}) {
  const { at, actor, baseDir, now } = opts;

  assertNonEmptyString('addParticipantEmail', 'email', email);

  const previous = readExisting('addParticipantEmail', agentId, transactionId, baseDir);
  const liveParticipants = previous.participants || {};
  const voidedParticipants = previous.voidedParticipants || {};

  if (!Object.prototype.hasOwnProperty.call(liveParticipants, participantId)) {
    if (Object.prototype.hasOwnProperty.call(voidedParticipants, participantId)) {
      throw new Error(`addParticipantEmail: '${participantId}' is voided on transaction ${transactionId} and cannot take new facts`);
    }
    throw new Error(`addParticipantEmail: '${participantId}' is not a participant on transaction ${transactionId}`);
  }

  const participant = liveParticipants[participantId];
  const existingEmails = participant.emails || [];
  const target = normalizeEmailAddress(email);
  const isDuplicate = existingEmails.some((existing) => normalizeEmailAddress(existing) === target);

  if (isDuplicate) {
    return { outcome: 'duplicate' };
  }

  const event = events.makeEvent({ at, actor, kind: 'participant_email_added', payload: { id: participantId, email } });

  const nextParticipant = { ...participant, emails: [...existingEmails, email] };
  const next = {
    ...previous,
    participants: { ...liveParticipants, [participantId]: nextParticipant },
    events: events.appendEvent(previous.events, event),
  };

  const transaction = store.writeTransaction(agentId, next, { baseDir, now });
  return { outcome: 'added', transaction };
}

// -- deriveRepresentedPersons ---------------------------------------------------

// A participant counts as represented when their roles include 'client' or
// 'co_client'. One home for that rule: reused by checklist.js (deriving the
// representedPersons the resolver sees), by satisfactions.js (deciding who
// is eligible to be marked satisfied) and by resolveParticipantByName below
// (scoping name lookup to the same set), so none of the three can disagree
// about who counts.
const REPRESENTED_ROLES = Object.freeze(['client', 'co_client']);

// The closed vocabulary assertRoles checks every role against. Adding a
// role here is safe at any time; removing or renaming one is not, because
// a stored participant on an existing transaction can already hold a role
// this list no longer accepts, and nothing here ever rewrites history to
// match a shrunk or renamed list.
const PARTICIPANT_ROLES = Object.freeze([
  'client', 'co_client', 'opposing_party', 'opposing_agent',
  'client_lawyer', 'opposing_lawyer', 'mortgage_broker', 'inspector',
  'condo_manager', 'property_manager', 'brokerage_admin', 'other',
]);

function isRepresented(participant) {
  return participant.roles.some((role) => REPRESENTED_ROLES.includes(role));
}

// Returns undefined, NOT AN EMPTY ARRAY, when the participants map is
// absent, empty, or contains nobody qualifying. THIS IS THE MOST IMPORTANT
// LINE IN THIS MODULE: resolver.js:122-126 (withClientSatisfaction) treats
// absent representedPersons as a distinct, meaningful state -- we were
// never told who is on the deal, so it emits neither satisfiedPersons nor
// outstandingPersons. An empty array is NOT absence: it would flow through
// as "zero people outstanding" and render a deal nobody has been named on
// as all-clear. Absent means unknown; empty would mean known-to-be-nobody,
// and this function is never in a position to assert that.
function deriveRepresentedPersons(participants) {
  const ids = Object.keys(participants || {}).filter((id) => isRepresented(participants[id]));
  return ids.length > 0 ? ids : undefined;
}

// -- resolveParticipantByName ---------------------------------------------------

// Resolves a human-typed name to a participant id, scoped to REPRESENTED
// participants only: a lawyer or agent sharing a client's name must not
// resolve here, because satisfactions.js would reject that id one layer
// down with a different error, and by then the name the caller typed is
// gone from the message. This is the one place that error belongs.
//
// Returns a result object; never throws on a miss. This follows
// compareAddresses (address.js): the caller decides what a miss means, and
// a future picker UI needs structured candidate data, not a message string
// to parse names back out of.
//
// Matching is trim-and-lowercase equality, nothing looser. Substring or
// prefix matching would make today's clean resolution depend on who else
// gets added to the file later, which is worse than requiring the id
// up front. There is no shared case-insensitive helper in this repo
// (src/index.js:332, src/webhook.js:94 each inline .trim().toLowerCase());
// this follows that.
//
// Takes the whole transaction, not a bare participants map, because it now
// has to check two maps that must agree with each other: a live match
// always wins, and only when there is none does a name get checked against
// voidedParticipants. A separate voidedParticipants parameter was rejected
// on purpose -- optional would let a caller silently pass none and read
// 'not_found' where the true answer is 'voided'; required would give a
// transaction with no voided participants nothing to pass. The transaction
// object is the one thing that always has both maps, or the absence of
// either, in the same place.
//
// This is NOT a live-set consumer the way collectKnownAddresses or
// assertRepresented are: those must never see a voided participant, and do
// not, because voiding removes the id from `participants` entirely. This
// function's contract is unchanged -- it still only ever RESOLVES to a
// live, represented id -- but a miss now distinguishes "never existed"
// from "existed and was voided" instead of collapsing both into
// not_found, because those are different facts and the caller needs to
// say which one to the person asking.
function resolveParticipantByName(transaction, name) {
  const participants = transaction.participants || {};
  const voidedParticipants = transaction.voidedParticipants || {};
  const target = name.trim().toLowerCase();

  const candidates = [];
  let namelessCount = 0;

  Object.keys(participants).forEach((id) => {
    const participant = participants[id];
    if (!isRepresented(participant)) {
      return;
    }
    // Absence, not an empty string: name is optional on a participant by
    // design (addParticipant), so a represented participant can exist that
    // no name lookup can ever reach. Comparing against it would throw
    // (undefined has no .trim); counting it instead lets the not_found
    // reason tell the caller such a participant exists.
    if (participant.name === undefined) {
      namelessCount += 1;
      return;
    }
    if (participant.name.trim().toLowerCase() === target) {
      candidates.push({ id, name: participant.name, roles: [...participant.roles] });
    }
  });

  if (candidates.length === 1) {
    return { resolved: true, id: candidates[0].id };
  }
  if (candidates.length > 1) {
    return { resolved: false, reason: 'ambiguous', candidates };
  }

  // Zero live candidates. Before calling it not_found, check whether a
  // voided, represented participant matches -- scoped by isRepresented the
  // same way the live search above is, so a voided lawyer sharing the name
  // does not manufacture a 'voided' answer that the live path itself would
  // never have resolved to in the first place.
  const voidedMatchId = Object.keys(voidedParticipants).find((id) => {
    const voided = voidedParticipants[id];
    return isRepresented(voided) && voided.name !== undefined && voided.name.trim().toLowerCase() === target;
  });
  if (voidedMatchId !== undefined) {
    return { resolved: false, reason: 'voided', id: voidedMatchId, voidReason: voidedParticipants[voidedMatchId].reason };
  }

  return { resolved: false, reason: 'not_found', namelessCount };
}

module.exports = {
  addParticipant,
  voidParticipant,
  VOID_REASONS,
  addParticipantEmail,
  deriveRepresentedPersons,
  isRepresented,
  REPRESENTED_ROLES,
  PARTICIPANT_ROLES,
  assertParticipantFields,
  resolveParticipantByName,
};

module.exports._internal = {
  PARTICIPANT_ID_RE,
  generateParticipantId,
};
