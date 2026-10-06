'use strict';

// Three one-save compositions for the DONE/RECEIPT/UNDO assistant@ verbs
// (docs/designs/done-verb.md). Same model as confirmSet.js/wrongDeal.js:
// one read, early-return outcomes, chained pure builders, exactly one
// store.writeTransaction at the end. Expected refusals are returned as
// { outcome }, never thrown; a throw here is a programmer error (a bad
// argument type), not something an agent's tap could trigger.

const store = require('./store');
const states = require('./states');
const rules = require('./rules');
const checklist = require('./checklist');
const deposit = require('./rules/deposit');
const { buildItemComplete, buildItemIncomplete } = require('./items');

const ACTOR = 'agent';
const TAP_NOTE = "Confirmed by the agent's tap on assistant@";

// unknown_item means "not an item a tap can reach on this deal": either
// the id is not on this type's catalog, or it is scope 'client' rather
// than 'transaction'. Alerts only ever point a tap at a transaction-scoped
// row (docs/designs/done-verb.md recon, question 5); completing a
// client-scoped item at the transaction level would be a misleading
// record, so taps never reach one.
function isKnownItemId(type, itemId) {
  const item = rules.CATALOG[type].find((candidate) => candidate.id === itemId);
  return item !== undefined && item.scope === 'transaction';
}

function findResolvedRow(resolvedItems, itemId) {
  return resolvedItems.find((item) => item.id === itemId);
}

// -- completeOne (DONE) --------------------------------------------------------

function completeOne(agentId, transactionId, itemId, opts = {}) {
  const { at, completedAt, baseDir, now } = opts;

  const transaction = store.readTransaction(agentId, transactionId, { baseDir });
  if (!transaction) {
    return { outcome: 'transaction_not_found' };
  }
  if (states.isTerminal(transaction.type, transaction.state)) {
    return { outcome: 'deal_closed', state: transaction.state };
  }
  if (!isKnownItemId(transaction.type, itemId)) {
    return { outcome: 'unknown_item' };
  }

  const row = findResolvedRow(checklist.resolveChecklistForTransaction(transaction), itemId);
  if (!row || row.applicability !== 'required') {
    return { outcome: 'not_required' };
  }

  const existingEntry = transaction.items ? transaction.items[itemId] : undefined;
  if (existingEntry && existingEntry.completed === true) {
    return { outcome: 'already_complete', completedAt: existingEntry.completedAt };
  }

  const { transaction: next } = buildItemComplete(transaction, {
    itemId, completedAt, note: TAP_NOTE, at, actor: ACTOR,
  });
  store.writeTransaction(agentId, next, { baseDir, now });

  return { outcome: 'completed', itemIds: [itemId] };
}

// -- completeChain (RECEIPT) ---------------------------------------------------

function completeChain(agentId, transactionId, receiptItemId, opts = {}) {
  const { at, completedAt, baseDir, now } = opts;

  const transaction = store.readTransaction(agentId, transactionId, { baseDir });
  if (!transaction) {
    return { outcome: 'transaction_not_found' };
  }
  if (states.isTerminal(transaction.type, transaction.state)) {
    return { outcome: 'deal_closed', state: transaction.state };
  }
  if (!isKnownItemId(transaction.type, receiptItemId)) {
    return { outcome: 'unknown_item' };
  }
  const chain = deposit.chainEndingAt(receiptItemId);
  if (!chain) {
    return { outcome: 'unknown_item' };
  }

  const resolvedItems = checklist.resolveChecklistForTransaction(transaction);
  for (const stepId of chain) {
    const row = findResolvedRow(resolvedItems, stepId);
    if (!row || row.applicability !== 'required') {
      return { outcome: 'not_required' };
    }
  }

  const storedItems = transaction.items || {};
  if (chain.every((stepId) => storedItems[stepId] && storedItems[stepId].completed === true)) {
    return { outcome: 'already_complete', completedAt: storedItems[receiptItemId].completedAt };
  }

  const freshIds = [];
  let envelope = transaction;
  chain.forEach((stepId) => {
    const entry = envelope.items ? envelope.items[stepId] : undefined;
    if (entry && entry.completed === true) {
      return;
    }
    envelope = buildItemComplete(envelope, {
      itemId: stepId, completedAt, note: TAP_NOTE, at, actor: ACTOR,
    }).transaction;
    freshIds.push(stepId);
  });
  store.writeTransaction(agentId, envelope, { baseDir, now });

  return { outcome: 'completed', itemIds: freshIds };
}

// -- uncompleteRows (UNDO) -----------------------------------------------------

function uncompleteRows(agentId, transactionId, itemIds, opts = {}) {
  if (!Array.isArray(itemIds)) {
    throw new Error('uncompleteRows: itemIds must be an array');
  }
  const { at, baseDir, now } = opts;

  const transaction = store.readTransaction(agentId, transactionId, { baseDir });
  if (!transaction) {
    return { outcome: 'transaction_not_found' };
  }
  if (states.isTerminal(transaction.type, transaction.state)) {
    return { outcome: 'deal_closed', state: transaction.state };
  }

  const uniqueIds = [...new Set(itemIds)];
  for (const itemId of uniqueIds) {
    if (!isKnownItemId(transaction.type, itemId)) {
      return { outcome: 'unknown_item' };
    }
  }

  const storedItems = transaction.items || {};
  const toUndo = [];
  const skipped = [];
  uniqueIds.forEach((itemId) => {
    const entry = storedItems[itemId];
    (entry && entry.completed === true ? toUndo : skipped).push(itemId);
  });

  if (toUndo.length === 0) {
    return { outcome: 'nothing_to_undo', skipped };
  }

  let envelope = transaction;
  toUndo.forEach((itemId) => {
    envelope = buildItemIncomplete(envelope, { itemId, at, actor: ACTOR }).transaction;
  });
  store.writeTransaction(agentId, envelope, { baseDir, now });

  return { outcome: 'uncompleted', itemIds: toUndo, skipped };
}

module.exports = { completeOne, completeChain, uncompleteRows };
