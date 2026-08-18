'use strict';

// The writer for clientSatisfactions, the mirror of items.js but for
// per-person completion on scope 'client' / clientScope 'event' items.
// Stored clientSatisfactions is a map keyed by personId, then itemId:
// { [personId]: { [itemId]: { at, actor } } } — see resolver.js
// (isPersonSatisfied), which reads only hasOwnProperty on the inner map and
// never looks inside the record. setFact refuses this key (see
// rules/factKeys.js) because a per-person, per-item map does not fit a
// { key, before, after } payload; this module is the writer that gap was
// left for.
//
// clientScope 'dated' is deliberately unsupported here: window evaluation
// needs a clock the resolver does not have (TC_SPEC 4.2), and is separate
// work. Marking a person satisfied on a transaction-scoped item is a caller
// bug, not a real state: that item's completion lives in `items`, not here.

const store = require('./store');
const events = require('./events');
const rules = require('./rules');
const participants = require('./participants');

const REPRESENTED_ROLES = participants._internal.REPRESENTED_ROLES;

// -- Argument assertions ------------------------------------------------------------

function findCatalogItem(fnName, type, itemId) {
  const item = rules.CATALOG[type].find((candidate) => candidate.id === itemId);
  if (!item) {
    throw new Error(`${fnName}: unknown item id '${itemId}' for type '${type}'`);
  }
  return item;
}

function assertClientEventItem(fnName, item) {
  if (item.scope !== 'client') {
    throw new Error(`${fnName}: item '${item.id}' is not client-scoped; its completion lives in items, not clientSatisfactions`);
  }
  if (item.clientScope === 'dated') {
    throw new Error(`${fnName}: item '${item.id}' is clientScope 'dated', which is not supported yet (needs a clock the resolver does not have)`);
  }
  if (item.clientScope !== 'event') {
    throw new Error(`${fnName}: item '${item.id}' has unsupported clientScope '${item.clientScope}'`);
  }
}

function readExisting(fnName, agentId, transactionId, baseDir) {
  const previous = store.readTransaction(agentId, transactionId, { baseDir });
  if (previous === null) {
    throw new Error(`${fnName}: no transaction ${transactionId} for agent ${agentId}`);
  }
  return previous;
}

// Checked against the participants map directly, not a stored fact:
// representedPersons no longer exists as a stored fact (see checklist.js),
// so authorization to satisfy an item is decided here by looking the id up
// as a participant and checking its roles. Object-key lookup is exact by
// construction, so there is no separate case-folding concern the way there
// was for name matching. Three distinct error messages, because they are
// three different mistakes: no participants recorded on the transaction at
// all, an id that names nobody on this transaction, and an id that names
// someone on this transaction who holds no role that counts as represented.
function assertRepresented(fnName, previous, personId) {
  const participantsMap = previous.participants;
  if (!participantsMap || Object.keys(participantsMap).length === 0) {
    throw new Error(`${fnName}: no participants on transaction ${previous.transactionId}; there is nobody to satisfy yet`);
  }

  const participant = participantsMap[personId];
  if (!participant) {
    throw new Error(`${fnName}: '${personId}' is not a participant on transaction ${previous.transactionId}`);
  }

  const qualifies = participant.roles.some((role) => REPRESENTED_ROLES.includes(role));
  if (!qualifies) {
    throw new Error(`${fnName}: '${personId}' is a participant on transaction ${previous.transactionId} but holds no role in ${REPRESENTED_ROLES.join(', ')}`);
  }
}

// -- markPersonSatisfied ------------------------------------------------------------

function markPersonSatisfied(agentId, transactionId, personId, itemId, opts = {}) {
  const { at, actor, baseDir, now } = opts;

  const previous = readExisting('markPersonSatisfied', agentId, transactionId, baseDir);
  const item = findCatalogItem('markPersonSatisfied', previous.type, itemId);
  assertClientEventItem('markPersonSatisfied', item);
  assertRepresented('markPersonSatisfied', previous, personId);

  const previousSatisfactions = (previous.facts && previous.facts.clientSatisfactions) || {};
  const previousPerson = previousSatisfactions[personId] || {};

  const nextSatisfactions = {
    ...previousSatisfactions,
    [personId]: { ...previousPerson, [itemId]: { at, actor } },
  };

  const event = events.makeEvent({ at, actor, kind: 'person_satisfied', payload: { personId, itemId } });

  const next = {
    ...previous,
    facts: { ...(previous.facts || {}), clientSatisfactions: nextSatisfactions },
    events: events.appendEvent(previous.events, event),
  };

  return store.writeTransaction(agentId, next, { baseDir, now });
}

// -- markPersonUnsatisfied ----------------------------------------------------------

// Deletes the item key under the person, never sets it to a falsy value:
// isPersonSatisfied (resolver.js) reads hasOwnProperty, so absence is the
// only representation of "not satisfied" it recognizes. If the person's map
// becomes empty, the person key is removed too, so the fact does not
// accumulate empty objects. A person's other satisfactions are untouched.
function markPersonUnsatisfied(agentId, transactionId, personId, itemId, opts = {}) {
  const { at, actor, baseDir, now } = opts;

  const previous = readExisting('markPersonUnsatisfied', agentId, transactionId, baseDir);
  const item = findCatalogItem('markPersonUnsatisfied', previous.type, itemId);
  assertClientEventItem('markPersonUnsatisfied', item);
  assertRepresented('markPersonUnsatisfied', previous, personId);

  const previousSatisfactions = (previous.facts && previous.facts.clientSatisfactions) || {};
  const previousPerson = previousSatisfactions[personId];
  if (previousPerson === undefined || !Object.prototype.hasOwnProperty.call(previousPerson, itemId)) {
    throw new Error(`markPersonUnsatisfied: '${personId}' is not satisfied for item '${itemId}'`);
  }

  const nextPerson = { ...previousPerson };
  delete nextPerson[itemId];

  const nextSatisfactions = { ...previousSatisfactions };
  if (Object.keys(nextPerson).length === 0) {
    delete nextSatisfactions[personId];
  } else {
    nextSatisfactions[personId] = nextPerson;
  }

  const event = events.makeEvent({ at, actor, kind: 'person_unsatisfied', payload: { personId, itemId } });

  const next = {
    ...previous,
    facts: { ...(previous.facts || {}), clientSatisfactions: nextSatisfactions },
    events: events.appendEvent(previous.events, event),
  };

  return store.writeTransaction(agentId, next, { baseDir, now });
}

module.exports = { markPersonSatisfied, markPersonUnsatisfied };
