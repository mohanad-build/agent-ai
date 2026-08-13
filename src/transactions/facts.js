'use strict';

const store  = require('./store');
const events = require('./events');
const { FACT_KEYS } = require('./rules/factKeys');

// -- Argument assertions ------------------------------------------------------------

function assertKnownFactKey(fnName, key) {
  if (typeof key !== 'string' || !FACT_KEYS.includes(key)) {
    throw new Error(`${fnName}: unknown fact key '${key}'`);
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
