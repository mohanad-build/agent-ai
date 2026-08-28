'use strict';

const store  = require('./store');
const events = require('./events');
const states = require('./states');
const { FACT_KEYS } = require('./rules/factKeys');

// -- Argument assertions ------------------------------------------------------------

function assertKnownFactKey(fnName, key) {
  if (typeof key !== 'string' || !FACT_KEYS.includes(key)) {
    throw new Error(`${fnName}: unknown fact key '${key}'`);
  }
}

// Refuses representationArrangement: 'double_ended' at the write boundary
// when the transaction's type has no buy-side counterpart (TC_SPEC 7.1.2b),
// the same place and shape as store.js's listingId-not-permitted-on-type
// check (store.js validateEnvelope). This is the only fact whose valid
// values depend on the transaction's type, so it is the only one that
// needs a type parameter here; every other key's validity is type-
// independent. Only 'double_ended' is restricted: 'single' and
// 'designated' carry no type requirement.
function assertRepresentationArrangementValidForType(fnName, key, value, type) {
  if (key !== 'representationArrangement' || value !== 'double_ended') {
    return;
  }
  if (!states.buySideTypeForSellSide(type)) {
    throw new Error(`${fnName}: representationArrangement 'double_ended' is not permitted on type '${type}'`);
  }
}

function readExisting(fnName, agentId, transactionId, baseDir) {
  const previous = store.readTransaction(agentId, transactionId, { baseDir });
  if (previous === null) {
    throw new Error(`${fnName}: no transaction ${transactionId} for agent ${agentId}`);
  }
  return previous;
}

function hasFact(facts, key) {
  return facts !== undefined && Object.prototype.hasOwnProperty.call(facts, key);
}

// -- setFact --------------------------------------------------------------------

function setFact(agentId, transactionId, key, value, opts = {}) {
  const { at, actor, evidence, baseDir, now } = opts;

  assertKnownFactKey('setFact', key);
  if (value === undefined) {
    throw new Error('setFact: value must not be undefined');
  }
  if (evidence !== undefined && actor !== 'system') {
    throw new Error("setFact: evidence may only be passed when actor is 'system'");
  }

  const previous = readExisting('setFact', agentId, transactionId, baseDir);
  assertRepresentationArrangementValidForType('setFact', key, value, previous.type);
  const previousFacts = previous.facts;
  const hadKey = hasFact(previousFacts, key);

  const payload = hadKey
    ? { key, before: previousFacts[key], after: value }
    : { key, after: value };
  if (evidence !== undefined) {
    payload.evidence = evidence;
  }

  const event = events.makeEvent({ at, actor, kind: 'fact_set', payload });

  const next = {
    ...previous,
    facts: { ...(previousFacts || {}), [key]: value },
    events: events.appendEvent(previous.events, event),
  };

  return store.writeTransaction(agentId, next, { baseDir, now });
}

// -- confirmFact ------------------------------------------------------------------

function confirmFact(agentId, transactionId, key, opts = {}) {
  const { at, actor, baseDir, now } = opts;

  assertKnownFactKey('confirmFact', key);

  const previous = readExisting('confirmFact', agentId, transactionId, baseDir);
  const previousFacts = previous.facts;
  if (!hasFact(previousFacts, key)) {
    throw new Error(`confirmFact: no value set for key '${key}'`);
  }

  const event = events.makeEvent({
    at,
    actor,
    kind: 'fact_confirmed',
    payload: { key, value: previousFacts[key] },
  });

  const next = { ...previous, events: events.appendEvent(previous.events, event) };

  return store.writeTransaction(agentId, next, { baseDir, now });
}

// -- correctFact ------------------------------------------------------------------

function correctFact(agentId, transactionId, key, value, opts = {}) {
  const { at, actor, baseDir, now } = opts;

  assertKnownFactKey('correctFact', key);
  if (actor !== 'agent') {
    throw new Error("correctFact: actor must be 'agent'");
  }
  if (value === undefined) {
    throw new Error('correctFact: value must not be undefined');
  }

  const previous = readExisting('correctFact', agentId, transactionId, baseDir);
  const previousFacts = previous.facts;
  if (!hasFact(previousFacts, key)) {
    throw new Error(`correctFact: no value set for key '${key}'`);
  }
  assertRepresentationArrangementValidForType('correctFact', key, value, previous.type);

  const event = events.makeEvent({
    at,
    actor,
    kind: 'fact_corrected',
    payload: { key, before: previousFacts[key], after: value },
  });

  const next = {
    ...previous,
    facts: { ...previousFacts, [key]: value },
    events: events.appendEvent(previous.events, event),
  };

  return store.writeTransaction(agentId, next, { baseDir, now });
}

module.exports = { setFact, confirmFact, correctFact };
