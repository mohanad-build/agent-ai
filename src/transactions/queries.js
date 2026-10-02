'use strict';

const { getStorageRoot } = require('../storagePaths');
const store = require('./store');

// This reads every transaction file that belongs to an agent, unfiltered by
// anything except whether the file is still there to read. Agents carry
// roughly 2 to 20 open transactions; 200 is a rare outlier. Even 200 small
// JSON reads is cheap. That closes the question of whether this needs an
// index instead of a scan: it does not, on the evidence in hand, and this is
// not a shape parked for later, it is a decision already made.
//
// THE ONCE PER MESSAGE CONTRACT: callers must call this once per message and
// reuse the returned array for every attachment on that message, passing it
// to matchTransaction once per attachment. The candidate set of an agent's
// transactions cannot change between attachments on the same message, so
// calling this again for each attachment would multiply the read cost by the
// attachment count for no benefit. This module has no way to enforce that;
// it is a contract the caller has to honor.
//
// listTransactionIds can return an id whose file is gone by the time
// readTransaction goes to read it, because readTransaction returns null on
// ENOENT instead of throwing (store.js). That id is treated as absent and
// skipped without complaint. Nothing in this codebase deletes a single
// transaction, but moveAgentFilesToDeleted sweeps every path prefixed with
// the agent id, which includes the whole transactions directory, so an
// operator soft-deleting an agent mid-poll-cycle produces exactly this
// window. It is a race, not a bug, and skipping is the correct response.
//
// A transaction whose file exists but cannot be turned into a usable object,
// invalid JSON raising TransactionCorruptionError, or a valid envelope that
// fails schema validation raising TransactionSchemaValidationError, both
// from readTransaction, is not caught here and is allowed to propagate. A
// file that is present and unreadable is a store bug, not an absence, and
// swallowing it would mean a real deal silently stops matching anything,
// forever, with nothing to signal that it happened. That is the same
// reasoning behind matcher.js keeping its isTerminal check where it is
// instead of pushing it down here.
//
// This function applies no other filtering. No terminality check, no type
// check, no address comparison. Those decisions belong to matcher.js and
// stay there.
function readAllTransactions(agentId, opts = {}) {
  if (typeof agentId !== 'string' || agentId.trim() === '') {
    throw new Error('readAllTransactions: agentId required non-empty string');
  }

  const baseDir = opts.baseDir || getStorageRoot();

  return store
    .listTransactionIds(agentId, { baseDir })
    .map((transactionId) => store.readTransaction(agentId, transactionId, { baseDir }))
    .filter((transaction) => transaction !== null);
}

// The digest reads every deal for an agent each morning, and one corrupt or
// invalid file must not hide the others. readAllTransactions keeps throwing
// because its callers rely on failing loudly; this is a second reader for
// the one caller that needs partial results instead. A whole-folder listing
// failure still throws: that is the digest section's concern, not a
// per-file one.
function readAllTransactionsSettled(agentId, opts = {}) {
  if (typeof agentId !== 'string' || agentId.trim() === '') {
    throw new Error('readAllTransactionsSettled: agentId required non-empty string');
  }

  const baseDir = opts.baseDir || getStorageRoot();

  const transactions = [];
  const unreadable = [];

  store.listTransactionIds(agentId, { baseDir }).forEach((transactionId) => {
    try {
      const transaction = store.readTransaction(agentId, transactionId, { baseDir });
      if (transaction !== null) {
        transactions.push(transaction);
      }
    } catch (err) {
      unreadable.push({ transactionId, error: err.message });
    }
  });

  return { transactions, unreadable };
}

module.exports = { readAllTransactions, readAllTransactionsSettled };
