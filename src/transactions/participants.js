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
// only who is involved right now. This module therefore ships only an add
// path. There is no updateParticipantRole, and none should be added: a
// changed role is a new participant, not a mutation of an old one.
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

  assertRoles('addParticipant', 'roles', roles);

  const entry = { roles: [...roles] };

  // undefined means the field is absent and must not appear on the written
  // record at all; explicitly passing null is a caller bug and throws, the
  // same convention as listingId and unit in store.js. Each assertion below
  // rejects null on its own (typeof null is not 'string', not a boolean,
  // not an array), so no separate null check is needed here.
  if (name !== undefined) {
    assertNonEmptyString('addParticipant', 'name', name);
    entry.name = name;
  }
  if (emails !== undefined) {
    assertEmails('addParticipant', 'emails', emails);
    entry.emails = [...emails];
  }
  if (phone !== undefined) {
    assertNonEmptyString('addParticipant', 'phone', phone);
    entry.phone = phone;
  }
  if (entityType !== undefined) {
    assertNonEmptyString('addParticipant', 'entityType', entityType);
    entry.entityType = entityType;
  }
  if (isSelfRepresented !== undefined) {
    assertBoolean('addParticipant', 'isSelfRepresented', isSelfRepresented);
    entry.isSelfRepresented = isSelfRepresented;
  }

  const previous = readExisting('addParticipant', agentId, transactionId, baseDir);
  const id = generateParticipantId();

  const event = events.makeEvent({ at, actor, kind: 'participant_added', payload: { id, roles: entry.roles } });

  const next = {
    ...previous,
    participants: { ...(previous.participants || {}), [id]: entry },
    events: events.appendEvent(previous.events, event),
  };

  return store.writeTransaction(agentId, next, { baseDir, now });
}

// -- deriveRepresentedPersons ---------------------------------------------------

// A participant counts as represented when their roles include 'client' or
// 'co_client'. One home for that rule: reused by checklist.js (deriving the
// representedPersons the resolver sees) and by satisfactions.js (deciding
// who is eligible to be marked satisfied), so the two lists can never
// disagree.
const REPRESENTED_ROLES = Object.freeze(['client', 'co_client']);

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
  const ids = Object.keys(participants || {}).filter((id) => {
    return participants[id].roles.some((role) => REPRESENTED_ROLES.includes(role));
  });
  return ids.length > 0 ? ids : undefined;
}

module.exports = { addParticipant, deriveRepresentedPersons };

module.exports._internal = {
  PARTICIPANT_ID_RE,
  generateParticipantId,
  REPRESENTED_ROLES,
};
