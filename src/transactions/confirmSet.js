'use strict';

// The confirm composition (TC_SPEC 6.7.2): one read, three pure builders
// chained through a single envelope, one save. Turns a proposal set's
// pending members into real participants and marks their source filing
// reviewed, in one atomic write.
//
// Nothing calls this yet -- 4c-2 (the subject verbs) will.

const store = require('./store');
const filings = require('./filings');
const participants = require('./participants');
const proposals = require('./proposals');

function confirmProposalSet(agentId, transactionId, setId, opts = {}) {
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

  if (set.status === 'confirmed') {
    return { outcome: 'already_confirmed' };
  }
  if (set.status === 'discarded') {
    return { outcome: 'set_discarded' };
  }

  const filingKey = set.source.filingKey;
  const filing = (transaction.filings || {})[filingKey];
  if (!filing) {
    throw new Error(`confirmProposalSet: set ${setId} references filing ${JSON.stringify(filingKey)} which does not exist on transaction ${transactionId}`);
  }
  if (filing.review === 'rejected') {
    return { outcome: 'filing_rejected' };
  }

  let envelope = transaction;
  let filingConfirmed = false;

  if (filing.review === 'needs_review') {
    envelope = filings.buildFilingConfirmation(envelope, {
      transactionId,
      messageId: filing.messageId,
      attachmentId: filing.attachmentId,
      at,
      actor: 'agent',
    }).transaction;
    filingConfirmed = true;
  } else if (filing.review !== 'confirmed') {
    // needs_review and confirmed are handled above; rejected returned
    // early. FILING_REVIEW_STATUSES has no fourth value, so this is an
    // invariant guard against that closed list ever growing silently, not
    // a reachable branch.
    throw new Error(`confirmProposalSet: filing ${JSON.stringify(filingKey)} on set ${setId} has unrecognized review ${JSON.stringify(filing.review)}`);
  }
  // filing.review === 'confirmed': tolerated by decision (TC_SPEC 6.7.2,
  // confirmed from the CLI) -- filingConfirmed stays false, envelope is
  // untouched, and the loop below proceeds against the same filing.

  const participantIds = {};
  Object.keys(set.members)
    .filter((memberId) => set.members[memberId].status === 'pending')
    .sort()
    .forEach((memberId) => {
      const member = set.members[memberId];
      const emails = member.emails === undefined ? undefined : member.emails.map((emailEntry) => emailEntry.address);

      const result = participants.buildParticipant(envelope, {
        transactionId,
        roles: member.roles,
        name: member.name,
        emails,
        phone: member.phone,
        entityType: member.entityType,
        isSelfRepresented: member.isSelfRepresented,
        at,
        actor: 'agent',
      });

      envelope = result.transaction;
      participantIds[memberId] = result.participantId;
    });

  const confirmResult = proposals.buildSetConfirmation(envelope, {
    transactionId,
    setId,
    participantIds,
    at,
    actor: 'agent',
  });
  if (confirmResult.outcome !== 'confirmed') {
    // Step 4 above already returned on 'already_confirmed' and
    // 'set_discarded', so this builder can only ever see an open set with
    // full participantIds coverage here. Any other outcome means that
    // assumption broke, not a real case to handle.
    throw new Error(`confirmProposalSet: buildSetConfirmation returned unexpected outcome ${JSON.stringify(confirmResult.outcome)} for set ${setId} on transaction ${transactionId}`);
  }
  envelope = confirmResult.transaction;

  store.writeTransaction(agentId, envelope, { baseDir, now });

  return { outcome: 'confirmed', participantIds, filingConfirmed };
}

module.exports = {
  confirmProposalSet,
};
