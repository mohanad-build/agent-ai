'use strict';

// Every address seen on a message for a transaction, independent of whether
// it was ever filed against - the audit trail behind signal B ("an address
// on the message belongs to this transaction"). Stored `observedAddresses`
// is a map keyed by address, the same shape family as `participants`
// (participants.js) and `filings` (filings.js): { [address]: { firstSeenAt,
// threadId, name? } }, absent (never null) for name when unknown.
//
// MONOTONIC: firstSeenAt and threadId are written once, at first sight, and
// never change - they answer "why does the system think this address
// belongs to this deal", and that answer must stay pinned to the first
// observation, not drift to the most recent one. The one exception is
// `name`: a stored entry with no name gains one from a later observation,
// because a name is information and discarding it manufactures the
// nameless-participant problem section 6.2 exists to work around. On a
// second name conflict (both observations named it, differently), the
// FIRST name wins - same discipline as `conditions` recording what the
// agreement contained rather than tracking current state.

const store = require('./store');
const events = require('./events');

// -- Argument assertions ------------------------------------------------------------

function assertNonEmptyString(fnName, name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fnName}: ${name} must be a non-empty string`);
  }
}

// entries is the output of collectMessageAddresses: an array of
// { address, name? }. Validated here rather than trusted, since this
// module's own address normalisation (trim + lowercase, in the writer
// below) already refuses to trust the caller on shape.
function assertEntries(fnName, name, value) {
  if (!Array.isArray(value)) {
    throw new Error(`${fnName}: ${name} must be an array of { address, name? }`);
  }
  value.forEach((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${fnName}: ${name} must be an array of { address, name? }`);
    }
    assertNonEmptyString(fnName, `${name}[].address`, entry.address);
    if (entry.name !== undefined) {
      assertNonEmptyString(fnName, `${name}[].name`, entry.name);
    }
  });
}

function readExisting(fnName, agentId, transactionId, baseDir) {
  const previous = store.readTransaction(agentId, transactionId, { baseDir });
  if (previous === null) {
    throw new Error(`${fnName}: no transaction ${transactionId} for agent ${agentId}`);
  }
  return previous;
}

// -- recordObservedAddresses ----------------------------------------------------

// Takes the whole entries array and writes ONCE: N read-patch-write cycles
// against one transaction file is exactly the concurrency shape the
// "concurrent writes to one transaction" tests in
// tests/transactions-filings.test.js exist to guard against, so there is no
// per-address writer here, only this one.
//
// threadId is required: an observed address with no record of where it was
// seen cannot answer why the system believes it belongs to this deal.
//
// THREE STATES, not a guard on entries.length alone:
//   - nothing changed    -> no write, no event, return the transaction unchanged
//   - addresses added    -> write; event names them in `addresses`
//   - names backfilled    -> write; event names them in `backfilledAddresses`
//
// A literally empty entries array (a message with only the agent on it is
// not an observation) is one way to reach "nothing changed", checked first
// below since it needs no read of previousObserved to decide. But it is not
// the ONLY way: a non-empty entries array where every address is already
// stored, and none of them gains a name it didn't have, also changes
// nothing. addedAddresses.length === 0 cannot detect that second case on
// its own, because a name backfill mutates an existing entry without ever
// appearing in addedAddresses -- that mismatch is exactly what let a real
// mutation report `addresses: []` in the event log, as if nothing happened.
// The no-op condition after the loop is therefore BOTH lists empty, never
// addedAddresses alone.
//
// addedAddresses and backfilledAddresses are tracked separately and never
// folded together: "we learned a new party is on this deal" and "we learned
// an existing party's name" are different facts, and an audit trail that
// cannot tell them apart is worse than one that reports neither.
function recordObservedAddresses(agentId, transactionId, entries, opts = {}) {
  const { threadId, at, actor, baseDir, now } = opts;

  assertEntries('recordObservedAddresses', 'entries', entries);
  assertNonEmptyString('recordObservedAddresses', 'threadId', threadId);

  const previous = readExisting('recordObservedAddresses', agentId, transactionId, baseDir);

  if (entries.length === 0) {
    return previous;
  }

  const previousObserved = previous.observedAddresses || {};
  const nextObserved = { ...previousObserved };
  const addedAddresses = [];
  const backfilledAddresses = [];

  for (const entry of entries) {
    const address = entry.address.trim().toLowerCase();
    const existing = nextObserved[address];

    if (!existing) {
      const record = { firstSeenAt: at, threadId };
      if (entry.name) record.name = entry.name;
      nextObserved[address] = record;
      addedAddresses.push(address);
    } else if (!existing.name && entry.name) {
      nextObserved[address] = { ...existing, name: entry.name };
      backfilledAddresses.push(address);
    }
  }

  if (addedAddresses.length === 0 && backfilledAddresses.length === 0) {
    return previous;
  }

  const event = events.makeEvent({
    at,
    actor,
    kind: 'addresses_observed',
    payload: { threadId, addresses: addedAddresses, backfilledAddresses },
  });

  const next = {
    ...previous,
    observedAddresses: nextObserved,
    events: events.appendEvent(previous.events, event),
  };

  return store.writeTransaction(agentId, next, { baseDir, now });
}

module.exports = {
  recordObservedAddresses,
};
