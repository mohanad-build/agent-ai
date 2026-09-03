'use strict';

// TC orchestrator (TC_SPEC 12a's accumulator, 14 tier 2 item 5's arrival
// pass): one merged loop over every fetched message, replacing what used to
// be two separate touchpoints into this directory. Lives here, not in
// leadIntake.js, for the same reason every other module in src/transactions/
// does: it is fully synchronous end to end (queries, accumulator, matcher,
// filings all are -- see intake.js's header for why that matters to TC_SPEC
// 7.7), and a _internal re-export out of leadIntake.js was the exact shape
// session 66 rejected for parseRecipientList -- a second import path for a
// function with one real caller is the _internal-as-production-path pattern
// TC_SPEC 7.48.8 closed. leadIntake.js requires this like any other module.
//
// Do not add an await anywhere in this file. 7.14's two-pass split depends
// on everything in src/transactions/ staying synchronous, and this module is
// what holds the two TC touchpoints of the arrival pass together.

const queries = require('./queries');
const accumulator = require('./accumulator');
const intake = require('./intake');

// ONE readAllTransactions PER MESSAGE, reused by BOTH the accumulator and
// the matcher below -- cheaper than the two separate reads this used to be
// split across. NOT hoisted to once per cycle: this loop writes
// (recordObservedAddresses, recordDocumentSeen), so a later message in the
// same cycle can legitimately need to see a transaction an earlier message
// in the same cycle just changed, the same reasoning intake.js's own header
// already gives for not hoisting further than once per message.
//
// The cost accepted here is real and deliberate: this read now runs for
// EVERY fetched unread message, not only attachment-bearing ones, where
// before only attachment-bearing messages paid for a read at all. These are
// small synchronous JSON reads, O(one agent's open transaction count) each.
// If that cost ever bites, the fix is archiving terminal transactions, not
// an index -- the same reasoning src/drain.js's sweep already accepted for
// exactly this tradeoff.
function processTcTouchpoints(agentConfig, messages, opts = {}) {
  const agentId = agentConfig.agentId;
  const results = [];

  for (const msg of messages) {
    try {
      let candidates = queries.readAllTransactions(agentId, { baseDir: opts.baseDir });

      // ACCUMULATOR BEFORE MATCHER, and this order is load-bearing.
      // accumulateObservedAddresses (TC_SPEC 12a / 7.13) takes a transaction
      // OBJECT and its gate, hasConfirmedFilingOnThread, reads
      // transaction.filings straight off that object -- it does not re-read
      // from disk. matchAndFileAttachments below calls recordDocumentSeen,
      // which WRITES to the transaction file. Running the matcher first
      // would hand the accumulator, off this same candidates array, a
      // transaction object that is stale relative to whatever the matcher
      // just wrote for THIS message -- the same object-vs-id staleness class
      // src/drain.js's ensureTransactionFolder fix addressed this session.
      // It happens to be harmless today only because a freshly written
      // filing is always 'needs_review' while the gate wants 'confirmed'
      // review -- that is a safety property borrowed from another module's
      // unrelated rule, not one this loop actually holds, and is not
      // something to depend on as the two modules keep changing. Accumulator
      // first means every candidate the gate checks is fresh by
      // construction, not by accident.
      //
      // Per-candidate try/catch: one candidate transaction failing
      // accumulation must not stop the accumulator from running against the
      // other candidates for this same message, nor stop the matcher step
      // below.
      let anyRecorded = false;
      for (const candidate of candidates) {
        try {
          const result = accumulator.accumulateObservedAddresses(candidate, msg, agentConfig, opts);
          if (result.outcome === 'recorded') {
            anyRecorded = true;
          }
        } catch (err) {
          console.error(
            '[' + agentId + '] Lead Intake: TC address accumulation failed for ' + msg.messageId +
            ' / ' + candidate.transactionId + ': ' + err.message
          );
        }
      }

      // THE STALE CANDIDATES ARRAY: TC_SPEC 7.13's signal B reads either a
      // participant's emails[] or transaction.observedAddresses -- exactly
      // what the accumulator just wrote. If any candidate's accumulation
      // outcome was 'recorded' this iteration, the candidates array the
      // matcher is about to search against is one write out of date, so it
      // is re-read here before the matcher ever sees it. NOT otherwise: a
      // second read on every message would defeat the one-read-serves-both
      // point this loop exists for, and 'gate_not_met' / 'nothing_to_collect'
      // both mean nothing on disk changed, so the array in hand is already
      // current. This conditional only stays cheap to test for because the
      // accumulator reports three distinct outcomes (a session 69 decision
      // made for unrelated reasons) instead of a single boolean -- collapse
      // those outcomes later and this check has to be rebuilt some other way.
      if (anyRecorded) {
        candidates = queries.readAllTransactions(agentId, { baseDir: opts.baseDir });
      }

      // matchResults, and this function's own return value, exist for
      // observability: nothing in production reads them today (the caller
      // fires this and moves on), but without them there is no way to prove
      // signal B saw fresh data from outside this module -- the filing this
      // writes looks identical whether the match came from a stale or a
      // fresh read, since signal D alone already carries it either way.
      const matchResults = msg.hasAttachments
        ? intake.matchAndFileAttachments(agentConfig, msg, candidates, opts)
        : [];

      results.push({ messageId: msg.messageId, matchResults });
    } catch (err) {
      console.error(
        '[' + agentId + '] Lead Intake: TC processing failed for ' + msg.messageId + ': ' + err.message
      );
    }
  }

  return results;
}

module.exports = { processTcTouchpoints };
