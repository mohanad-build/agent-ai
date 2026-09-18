'use strict';

// The wrong-deal composition (TC_SPEC 6.7.2): one read, two pure builders
// chained through a single envelope, one save. "Wrong deal: rejects the
// filing and sets the set to discarded. Nobody is created."
//
// A tap that AGREES with what is already recorded goes through (an
// already-rejected filing, say); one that CONTRADICTS a recorded answer is
// refused as an outcome and never overwrites (an already-confirmed filing
// or set).
//
// Nothing calls this yet -- 4c-2 (the subject verbs) will.

const store = require('./store');
const filings = require('./filings');
const proposals = require('./proposals');

function markWrongDeal(agentId, transactionId, setId, opts = {}) {
  const { baseDir, now: givenNow } = opts;
  const now = givenNow || new Date();
  const at = now.toISOString();

  const transaction = store.readTransaction(agentId, transactionId, { baseDir });
  if (!transaction) {
    return { outcome: 'transaction_not_found' };
  }

  const proposalSets = transaction.participantProposals || {};
  const set = proposalSets[setId];
  if (!set) {
    return { outcome: 'set_not_found' };
  }

  if (set.status === 'discarded') {
    return { outcome: 'already_discarded' };
  }
  if (set.status === 'confirmed') {
    return { outcome: 'set_confirmed' };
  }

  const filingKey = set.source.filingKey;
  const filing = (transaction.filings || {})[filingKey];
  if (!filing) {
    throw new Error(`markWrongDeal: set ${setId} references filing ${JSON.stringify(filingKey)} which does not exist on transaction ${transactionId}`);
  }
  if (filing.review === 'confirmed') {
    return { outcome: 'filing_confirmed' };
  }

  let envelope = transaction;
  let filingRejected = false;

  if (filing.review === 'needs_review') {
    envelope = filings.buildFilingRejection(envelope, {
      transactionId,
      messageId: filing.messageId,
      attachmentId: filing.attachmentId,
      at,
      actor: 'agent',
    }).transaction;
    filingRejected = true;
  } else if (filing.review !== 'rejected') {
    // needs_review and rejected are handled above; confirmed returned
    // early. FILING_REVIEW_STATUSES has no fourth value, so this is an
    // invariant guard against that closed list ever growing silently, not
    // a reachable branch.
    throw new Error(`markWrongDeal: filing ${JSON.stringify(filingKey)} on set ${setId} has unrecognized review ${JSON.stringify(filing.review)}`);
  }
  // filing.review === 'rejected': agrees with what is already recorded --
  // tolerated, filingRejected stays false, envelope is untouched.

  const discardResult = proposals.buildSetDiscard(envelope, {
    transactionId,
    setId,
    at,
    actor: 'agent',
  });
  if (discardResult.outcome !== 'discarded') {
    // Step 4 above already returned on 'set_confirmed' and
    // 'already_discarded', so this builder can only ever see an open set
    // here. Any other outcome means that assumption broke, not a real case
    // to handle.
    throw new Error(`markWrongDeal: buildSetDiscard returned unexpected outcome ${JSON.stringify(discardResult.outcome)} for set ${setId} on transaction ${transactionId}`);
  }
  envelope = discardResult.transaction;

  store.writeTransaction(agentId, envelope, { baseDir, now });

  return { outcome: 'wrong_deal_recorded', filingRejected };
}

module.exports = {
  markWrongDeal,
};
