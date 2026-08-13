'use strict';

// Per-item completion state, the mirror of facts.js. Stored `items` is a map
// keyed by item id: { [itemId]: { completed, completedAt, documents, note } }
// — only those four fields, nothing derived (TC_SPEC 4.3): no label, no
// applicability, no source. This is NOT the same shape as the `items` option
// transitions.js takes (see the comment at transitions.js:8): that one is an
// array of fully annotated resolver output. Same name, different shape, no
// converter between them.
//
// Item ids are not unique across types (a given id can appear on more than
// one type's catalog array), so validity depends on which transaction is
// being written to. That means the transaction must be read before an item
// id can be checked, the opposite order from facts.js, where FACT_KEYS is
// type-independent and gets checked before the read. Nothing writes until
// every check — completedAt shape, then item id against the transaction's
// own type — has passed.
//
// This module takes no position on applicability: nothing here checks
// whether an item is required, not_applicable, or terminalOnly before
// letting it be marked complete. It stores what it is told.

const store = require('./store');
const events = require('./events');
const rules = require('./rules');

// -- Argument assertions ------------------------------------------------------------

function assertKnownItemId(fnName, type, itemId) {
  const ids = rules.CATALOG[type].map((item) => item.id);
  if (typeof itemId !== 'string' || !ids.includes(itemId)) {
    throw new Error(`${fnName}: unknown item id '${itemId}' for type '${type}'`);
  }
}

function readExisting(fnName, agentId, transactionId, baseDir) {
  const previous = store.readTransaction(agentId, transactionId, { baseDir });
  if (previous === null) {
    throw new Error(`${fnName}: no transaction ${transactionId} for agent ${agentId}`);
  }
  return previous;
}

// -- markItemComplete ---------------------------------------------------------------

function markItemComplete(agentId, transactionId, itemId, opts = {}) {
  const { at, actor, completedAt, documents, note, baseDir, now } = opts;

  if (typeof completedAt !== 'string' || completedAt.trim() === '') {
    throw new Error('markItemComplete: completedAt must be a non-empty string');
  }

  const previous = readExisting('markItemComplete', agentId, transactionId, baseDir);
  assertKnownItemId('markItemComplete', previous.type, itemId);

  const entry = { completed: true, completedAt };
  const payload = { itemId, completedAt };
  if (documents !== undefined) {
    entry.documents = documents;
    payload.documents = documents;
  }
  if (note !== undefined) {
    entry.note = note;
    payload.note = note;
  }

  const event = events.makeEvent({ at, actor, kind: 'item_completed', payload });

  const next = {
    ...previous,
    items: { ...(previous.items || {}), [itemId]: entry },
    events: events.appendEvent(previous.events, event),
  };

  return store.writeTransaction(agentId, next, { baseDir, now });
}

// -- markItemIncomplete -------------------------------------------------------------

function markItemIncomplete(agentId, transactionId, itemId, opts = {}) {
  const { at, actor, baseDir, now } = opts;

  const previous = readExisting('markItemIncomplete', agentId, transactionId, baseDir);
  assertKnownItemId('markItemIncomplete', previous.type, itemId);

  const previousItems = previous.items;
  const entry = previousItems ? previousItems[itemId] : undefined;
  if (!entry || entry.completed !== true) {
    throw new Error(`markItemIncomplete: item '${itemId}' is not complete`);
  }

  const event = events.makeEvent({ at, actor, kind: 'item_uncompleted', payload: { itemId } });

  const next = {
    ...previous,
    items: { ...previousItems, [itemId]: { ...entry, completed: false } },
    events: events.appendEvent(previous.events, event),
  };

  return store.writeTransaction(agentId, next, { baseDir, now });
}

module.exports = { markItemComplete, markItemIncomplete };
