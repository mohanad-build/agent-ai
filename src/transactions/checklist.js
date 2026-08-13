'use strict';

// The read path: load a stored transaction and return its resolved
// checklist. This is the first production caller of resolver.reResolve —
// everything before this module only exercised it from tests.

const store = require('./store');
const resolver = require('./resolver');

// -- Argument assertions ------------------------------------------------------------

function readExisting(fnName, agentId, transactionId, baseDir) {
  const transaction = store.readTransaction(agentId, transactionId, { baseDir });
  if (transaction === null) {
    throw new Error(`${fnName}: no transaction ${transactionId} for agent ${agentId}`);
  }
  return transaction;
}

// -- Stored-shape conversion --------------------------------------------------------

// Stored `items` is a map keyed by item id: { [itemId]: { completed,
// completedAt, documents, note } } (see items.js). reResolve wants an ARRAY
// whose elements carry `id`. The id lives only in the map key, so
// Object.values() would discard it: every entry would come back with
// `id: undefined`, previousById (resolver.js) would collapse to a single
// Map entry keyed undefined, nothing would match, and every item would come
// back looking freshly incomplete — with no error. Object.entries plus
// reattaching the key as `id` is what avoids that.
function toItemsArray(items) {
  return Object.entries(items || {}).map(([id, entry]) => ({ id, ...entry }));
}

// -- resolveTransactionChecklist ------------------------------------------------------

function resolveTransactionChecklist(agentId, transactionId, opts = {}) {
  const { baseDir } = opts;

  const transaction = readExisting('resolveTransactionChecklist', agentId, transactionId, baseDir);

  const previousItems = toItemsArray(transaction.items);
  const facts = transaction.facts || {};

  // Every stored id is converted and passed through, never filtered against
  // the current catalog. An id that no longer resolves (a catalog item
  // renamed or removed since it was completed) still reaches reResolve,
  // which carries it forward as 'no_longer_applicable' instead of dropping
  // it — the row loses its label (carriedOver only spreads the stored
  // entry, which never had one) but the record survives. Filtering stale
  // ids out here instead would silently discard a recorded completion,
  // the same mistake as shrinking `conditions`.
  return resolver.reResolve(previousItems, transaction.type, transaction.state, facts);
}

module.exports = { resolveTransactionChecklist };
