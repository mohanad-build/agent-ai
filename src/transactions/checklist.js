'use strict';

// The read path: load a stored transaction and return its resolved
// checklist. This is the first production caller of resolver.reResolve —
// everything before this module only exercised it from tests.

const store = require('./store');
const resolver = require('./resolver');
const participants = require('./participants');

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

// -- resolveChecklistForTransaction ---------------------------------------------------

// Every stored id is converted and passed through, never filtered against
// the current catalog. An id that no longer resolves (a catalog item
// renamed or removed since it was completed) still reaches reResolve,
// which carries it forward as 'no_longer_applicable' instead of dropping
// it — the row loses its label (carriedOver only spreads the stored
// entry, which never had one) but the record survives. Filtering stale
// ids out here instead would silently discard a recorded completion,
// the same mistake as shrinking `conditions`.
function resolveChecklistForTransaction(transaction) {
  const previousItems = toItemsArray(transaction.items);

  // representedPersons is derived from transaction.participants
  // (participants.js) and is the only source used here: any stored
  // facts.representedPersons left over from before this derivation existed
  // is deleted below, never read. The derived key is set only when
  // deriveRepresentedPersons returns something -- omitted, not set to
  // undefined -- because an explicitly-undefined key is not the same as an
  // omitted one. resolver.js:41 happens to check both `'representedPersons'
  // in facts` and `=== undefined`, so relying on that second half to paper
  // over the difference would be fragile.
  const facts = { ...transaction.facts };
  delete facts.representedPersons;

  const derivedRepresentedPersons = participants.deriveRepresentedPersons(transaction.participants);
  if (derivedRepresentedPersons !== undefined) {
    facts.representedPersons = derivedRepresentedPersons;
  }

  return resolver.reResolve(previousItems, transaction.type, transaction.state, facts);
}

// -- resolveTransactionChecklist ------------------------------------------------------

function resolveTransactionChecklist(agentId, transactionId, opts = {}) {
  const { baseDir } = opts;

  const transaction = readExisting('resolveTransactionChecklist', agentId, transactionId, baseDir);

  return resolveChecklistForTransaction(transaction);
}

module.exports = { resolveTransactionChecklist, resolveChecklistForTransaction };
