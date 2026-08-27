'use strict';

// Policy layer for TC_SPEC 7.13: wires collectMessageAddresses and
// hasConfirmedFilingOnThread into recordObservedAddresses. Sits where
// matcher.js sits in the dependency graph - it composes the pure signal
// modules and the observedAddresses store, calling their rules rather than
// reimplementing them.
//
// agentId and transactionId are read off the transaction envelope, not
// taken as a separate argument: store.js's validateEnvelope requires both
// on every transaction that comes back from readTransaction, so a caller
// handing in a loaded transaction is handing in both, already tied
// together. A separate agentId argument would let agent A's transaction be
// paired with agent B's id, and the write would land in the wrong agent's
// tree.
//
// THREE OUTCOMES, NOT TWO. gate_not_met (hasConfirmedFilingOnThread false),
// nothing_to_collect (gate met, but collectMessageAddresses returned
// nothing new to observe), and recorded are different operational states,
// same reasoning as no_candidates versus no_bar_met in matchTransaction
// (matcher.js). Collapsing gate_not_met and nothing_to_collect into one
// falsy return would make the dormant period - the whole lifetime of this
// function until something calls it with a confirmed-filing thread -
// unreadable when someone later asks why nothing is accumulating.

const { hasConfirmedFilingOnThread } = require('./filings');
const { collectMessageAddresses } = require('./messageAddresses');
const observedAddresses = require('./observedAddresses');

function accumulateObservedAddresses(transaction, message, agentConfig, opts = {}) {
  if (!hasConfirmedFilingOnThread(transaction, message.threadId)) {
    return { outcome: 'gate_not_met' };
  }

  const entries = collectMessageAddresses(message, agentConfig.gmailAddress);

  if (entries.length === 0) {
    return { outcome: 'nothing_to_collect' };
  }

  const result = observedAddresses.recordObservedAddresses(
    transaction.agentId,
    transaction.transactionId,
    entries,
    { ...opts, threadId: message.threadId }
  );

  return { outcome: 'recorded', transaction: result };
}

module.exports = { accumulateObservedAddresses };
