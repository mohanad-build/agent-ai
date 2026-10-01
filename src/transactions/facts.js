'use strict';

const store  = require('./store');
const events = require('./events');
const states = require('./states');
const { FACT_KEYS, DATE_FACT_KEYS } = require('./rules/factKeys');
const { CONDITION_NAMES } = require('./rules/conditions');
const { isCalendarDate } = require('../calendarDate');

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

// null is rejected because it resolves to a thrown hasCondition on every
// later checklist read, and the three legitimate answers are a list, []
// for none, and no write for not answered; validation runs before the
// read so a rejected value never touches disk.
function assertConditionsValue(fnName, key, value) {
  if (key !== 'conditions') {
    return;
  }
  if (!Array.isArray(value)) {
    const got = value === null ? 'null' : typeof value;
    throw new Error(`${fnName}: conditions must be an array, got ${got}`);
  }
  const seen = new Set();
  value.forEach((entry) => {
    if (typeof entry !== 'string') {
      throw new Error(`${fnName}: conditions entries must be strings, got ${typeof entry}`);
    }
    if (!CONDITION_NAMES.includes(entry)) {
      throw new Error(`${fnName}: unknown condition '${entry}'; valid conditions: ${CONDITION_NAMES.join(', ')}`);
    }
    if (seen.has(entry)) {
      throw new Error(`${fnName}: duplicate condition '${entry}'`);
    }
    seen.add(entry);
  });
}

function describeValue(value) {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return `'${value}'`;
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

const ACCEPTED_DATE_TYPES = Object.freeze(['buyer_purchase', 'seller_sale', 'tenant_lease', 'landlord_lease']);
const ADDITIONAL_DEPOSIT_TYPES = Object.freeze(['buyer_purchase', 'seller_sale']);

// Shape before the read so a malformed date never touches disk; fit after
// the read because it needs the deal's type and conditions; a date for a
// condition not on the deal is refused because it would produce an alert
// about a condition that does not exist; removing a condition later leaves
// its date behind harmlessly, since the alerts read only conditions still
// on the list.
function assertDateFactShape(fnName, key, value) {
  if (!DATE_FACT_KEYS.includes(key)) {
    return;
  }

  if (key === 'acceptedDate') {
    if (!isCalendarDate(value)) {
      throw new Error(`${fnName}: acceptedDate must be a calendar date (YYYY-MM-DD), got ${describeValue(value)}`);
    }
    return;
  }

  if (key === 'conditionDates') {
    const isPlainObject = value !== null && typeof value === 'object' && !Array.isArray(value)
      && Object.getPrototypeOf(value) === Object.prototype;
    if (!isPlainObject) {
      throw new Error(`${fnName}: conditionDates must be an object mapping condition names to dates, got ${describeValue(value)}`);
    }
    Object.keys(value).forEach((k) => {
      if (!CONDITION_NAMES.includes(k)) {
        throw new Error(`${fnName}: unknown condition '${k}' in conditionDates; valid conditions: ${CONDITION_NAMES.join(', ')}`);
      }
      if (!isCalendarDate(value[k])) {
        throw new Error(`${fnName}: conditionDates.${k} must be a calendar date (YYYY-MM-DD), got ${describeValue(value[k])}`);
      }
    });
    return;
  }

  if (key === 'additionalDepositDueDates') {
    if (!Array.isArray(value)) {
      throw new Error(`${fnName}: additionalDepositDueDates must be an array of calendar dates, got ${describeValue(value)}`);
    }
    if (value.length > 1) {
      throw new Error(`${fnName}: additionalDepositDueDates holds at most one date in v1; track a second additional deposit by hand`);
    }
    value.forEach((entry) => {
      if (!isCalendarDate(entry)) {
        throw new Error(`${fnName}: additionalDepositDueDates entries must be calendar dates (YYYY-MM-DD), got ${describeValue(entry)}`);
      }
    });
  }
}

function assertDateFactFitsTransaction(fnName, key, value, previous) {
  if (key === 'acceptedDate' && !ACCEPTED_DATE_TYPES.includes(previous.type)) {
    throw new Error(`${fnName}: acceptedDate is not permitted on type '${previous.type}'; a listing has no acceptance, its offers do`);
  }

  if (key === 'additionalDepositDueDates' && !ADDITIONAL_DEPOSIT_TYPES.includes(previous.type)) {
    throw new Error(`${fnName}: additionalDepositDueDates is not permitted on type '${previous.type}'; additional deposits are tracked on sales only in v1, so track this one by hand`);
  }

  if (key === 'conditionDates') {
    Object.keys(value).forEach((k) => {
      if (!hasFact(previous.facts, 'conditions')) {
        throw new Error(`${fnName}: set conditions before conditionDates`);
      }
      if (!previous.facts.conditions.includes(k)) {
        throw new Error(`${fnName}: conditionDates has a date for '${k}', but this deal's conditions are [${previous.facts.conditions.join(', ')}]`);
      }
    });
  }
}

// setFact's own checks, grouped so checkFact can run exactly them against a
// deal that does not exist yet. Order and messages match setFact's current
// body precisely, with fnName threaded through so the same group reads
// correctly whichever caller's name is passed in.
function assertFactBeforeRead(fnName, key, value, { actor, evidence } = {}) {
  assertKnownFactKey(fnName, key);
  if (value === undefined) {
    throw new Error(`${fnName}: value must not be undefined`);
  }
  if (evidence !== undefined && actor !== 'system') {
    throw new Error(`${fnName}: evidence may only be passed when actor is 'system'`);
  }
  assertConditionsValue(fnName, key, value);
  if (DATE_FACT_KEYS.includes(key) && actor === 'system') {
    throw new Error(`${fnName}: ${key} must be set by a person, not 'system'; extracted dates belong in a proposal, not a fact`);
  }
  assertDateFactShape(fnName, key, value);
}

function assertFactFitsTransaction(fnName, key, value, transaction) {
  assertRepresentationArrangementValidForType(fnName, key, value, transaction.type);
  assertDateFactFitsTransaction(fnName, key, value, transaction);
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

  assertFactBeforeRead('setFact', key, value, { actor, evidence });

  const previous = readExisting('setFact', agentId, transactionId, baseDir);
  assertFactFitsTransaction('setFact', key, value, previous);
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
  assertFactBeforeRead('correctFact', key, value, { actor, evidence: undefined });

  const previous = readExisting('correctFact', agentId, transactionId, baseDir);
  const previousFacts = previous.facts;
  if (!hasFact(previousFacts, key)) {
    throw new Error(`correctFact: no value set for key '${key}'`);
  }
  assertFactFitsTransaction('correctFact', key, value, previous);

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

// -- checkFact --------------------------------------------------------------------

// The same rules setFact enforces, run against the deal as it is about to
// be, so deal-open can validate every planned fact before creating
// anything. Mirrors setFact only, not correctFact's extra rules. The
// parity test in tests/transactions-facts.test.js pins that the two never
// drift.
function checkFact(label, key, value, { type, facts = {}, actor = 'operator', evidence } = {}) {
  if (typeof type !== 'string' || type.trim() === '') {
    throw new Error(`${label}: type is required`);
  }

  assertFactBeforeRead(label, key, value, { actor, evidence });
  assertFactFitsTransaction(label, key, value, { type, facts });
}

module.exports = { setFact, confirmFact, correctFact, checkFact };
