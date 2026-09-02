'use strict';

// TC orchestrator arrival pass, TC_SPEC section 14 tier 2 item 5 (first of
// three): for one message, matches each of its attachments against the
// agent's transactions and records a filing (filings.js) for each match. No
// Drive, no attachment bytes, no uploads: those belong to the drain pass
// (commits two and three), and src/gmailAttachments.js's fetchAttachmentBytes
// stays uncalled here on purpose.
//
// Synchronous end to end, deliberately: every module this composes (queries,
// matcher, filings) is sync, and TC_SPEC 7.7 warns that the store's
// concurrency safety breaks the moment an await lands between a transaction's
// read and its write. Keeping this whole module sync makes that hazard
// structurally impossible here rather than a rule someone has to remember.
//
// Requires queries/matcher/filings as module objects and calls through them
// (queries.readAllTransactions, not a destructured readAllTransactions), the
// same convention leadIntake.js documents for gmail/email: it is what lets
// require-cache mocking in tests intercept these calls.

const queries = require('./queries');
const matcher = require('./matcher');
const filings = require('./filings');
const { collectMessageAddresses } = require('./messageAddresses');

// -- Argument assertions ------------------------------------------------------------

function assertNonEmptyString(fnName, name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fnName}: ${name} must be a non-empty string`);
  }
}

// -- matchAndFileAttachments ----------------------------------------------------

// Reads the agent's transactions ONCE, right here, and reuses that array for
// every attachment on this message -- the once-per-message contract
// queries.js documents on readAllTransactions. This is NOT hoistable to once
// per orchestrator cycle as an optimization: this same pass writes filing
// records via recordDocumentSeen, so a later message in the same cycle can
// legitimately need to see a transaction this pass, or an earlier message in
// the same cycle, just changed. Reading again per message is the cost of
// that correctness, not an oversight.
//
// An unmatched attachment does nothing (TC_SPEC 7.2): no filing record, no
// error, nothing beyond a `matched: false` entry in the returned array for
// the caller to log if it wants to. A matched attachment always gets a
// filing record with the full reported size carried onto it, uncapped --
// deciding an oversized document is untransferable and abandoning it with a
// stated reason is the drain pass's job (filings.js's
// abandonDocumentFiling), not this one's. Skipping it here would be exactly
// the silent-omission failure TC_SPEC 7.7 exists to prevent: the document
// arrived and is deal history whether or not it can ever reach Drive.
//
// Re-entrant by design: this message will be seen again on every
// orchestrator cycle until it falls out of the caller's fetch window.
// recordDocumentSeen is documented as an idempotent no-op on an
// already-'seen' filing (no second event, no field reset), which is why
// nothing here tracks "have I already looked at this message" itself -- the
// filing record already is that guard, independent of any Gmail label.
function matchAndFileAttachments(agentConfig, message, opts = {}) {
  const { at, actor, baseDir, now } = opts;

  assertNonEmptyString('matchAndFileAttachments', 'agentId', agentConfig?.agentId);
  assertNonEmptyString('matchAndFileAttachments', 'messageId', message?.messageId);
  assertNonEmptyString('matchAndFileAttachments', 'threadId', message?.threadId);

  const attachments = message.attachmentInfo || [];
  if (attachments.length === 0) {
    return [];
  }

  const agentId = agentConfig.agentId;
  const candidates = queries.readAllTransactions(agentId, { baseDir });
  const addresses = collectMessageAddresses(message, agentConfig.gmailAddress);

  return attachments.map((attachment) => {
    const view = {
      threadId: message.threadId,
      addresses,
      subject: message.subject,
      body: message.body,
      filename: attachment.filename,
    };

    const matchResult = matcher.matchTransaction(candidates, view);

    if (!matchResult.matched) {
      return { attachment, matched: false, reason: matchResult.reason };
    }

    const transaction = filings.recordDocumentSeen(
      agentId,
      matchResult.transactionId,
      message.messageId,
      attachment.attachmentId,
      {
        at,
        actor,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
        threadId: message.threadId,
        baseDir,
        now,
      }
    );

    return { attachment, matched: true, transactionId: matchResult.transactionId, transaction };
  });
}

module.exports = { matchAndFileAttachments };
