'use strict';

// TC orchestrator arrival pass, TC_SPEC section 14 tier 2 item 5 (first of
// three): for one message, matches each of its attachments against the
// agent's transactions and records a filing (filings.js) for each match. No
// Drive, no attachment bytes, no uploads: those belong to the drain pass
// (commits two and three), and src/gmailAttachments.js's fetchAttachmentBytes
// stays uncalled here on purpose.
//
// Synchronous end to end, deliberately: every module this composes (matcher,
// filings) is sync, and TC_SPEC 7.7 warns that the store's
// concurrency safety breaks the moment an await lands between a transaction's
// read and its write. Keeping this whole module sync makes that hazard
// structurally impossible here rather than a rule someone has to remember.
//
// Requires matcher/filings as module objects and calls through them, the
// same convention leadIntake.js documents for gmail/email: it is what lets
// require-cache mocking in tests intercept these calls.

const matcher = require('./matcher');
const filings = require('./filings');
const { collectMessageAddresses } = require('./messageAddresses');

// -- Argument assertions ------------------------------------------------------------

function assertNonEmptyString(fnName, name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fnName}: ${name} must be a non-empty string`);
  }
}

// 25MB, Gmail's own attachment ceiling: nothing Gmail hands us should ever
// report a larger size, so this never fires in normal operation. It is a
// hygiene guard against a malformed or hostile size value, not a memory
// limit -- Railway's headroom here is roughly 7.8GB.
const ATTACHMENT_BYTE_CAP = 26214400;

// -- matchAndFileAttachments ----------------------------------------------------

// Takes `candidates` as a parameter rather than reading them itself:
// leadIntake.js's merged TC loop now reads once per message and reuses that
// one read for BOTH accumulateObservedAddresses and this function, so a
// second, separate readAllTransactions call in here would defeat the point
// of merging the two loops. The once-per-message contract queries.js
// documents on readAllTransactions still applies -- it has just moved to the
// caller, which is the only place that can actually satisfy it now that two
// different TC steps share the one read. This is NOT hoistable to once per
// orchestrator cycle as an optimization: this same pass writes filing
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
// recordDocumentSeen is documented as an idempotent no-op on an existing
// filing AT ANY STATUS (no second event, no field reset, whether the filing
// is still 'seen' or has since moved to 'filed' or 'abandoned' by the drain
// pass), which is why nothing here tracks "have I already looked at this
// message" itself -- the filing record already is that guard, independent
// of any Gmail label.
function matchAndFileAttachments(agentConfig, message, candidates, opts = {}) {
  const { at, actor, baseDir, now } = opts;

  assertNonEmptyString('matchAndFileAttachments', 'agentId', agentConfig?.agentId);
  assertNonEmptyString('matchAndFileAttachments', 'messageId', message?.messageId);
  assertNonEmptyString('matchAndFileAttachments', 'threadId', message?.threadId);
  if (!Array.isArray(candidates)) {
    throw new Error('matchAndFileAttachments: candidates must be an array');
  }

  const attachments = message.attachmentInfo || [];
  if (attachments.length === 0) {
    return [];
  }

  const agentId = agentConfig.agentId;
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
        sender: message.from,
        // parseGmailMessage (gmail.js) uses null, not '', when Gmail's
        // internalDate is absent; recordDocumentSeen's required-but-tolerant
        // sender/receivedAt/subject fields are typed as strings, so that
        // sentinel is translated to '' at this boundary.
        receivedAt: message.receivedAt || '',
        subject: message.subject,
        baseDir,
        now,
      }
    );

    // TC_SPEC 10.x hygiene guard: an attachment over Gmail's own ceiling is
    // never fetched -- the record above is written first (it is deal
    // history: the document arrived, whether or not it can ever reach
    // Drive), then abandoned immediately with a reason naming both numbers.
    // attempts stays 0, which is honest: nothing was ever attempted, only
    // rejected on sight.
    //
    // The status check below is still needed even though recordDocumentSeen
    // itself is now re-entry-safe at every status: abandonDocumentFiling is
    // a TRANSITION, not a re-observation, and still throws leaving a
    // terminal filing. On a re-entrant cycle over the same oversized
    // attachment, recordDocumentSeen just returned the existing record
    // unchanged (already 'abandoned' from the first cycle that saw it), and
    // calling abandonDocumentFiling again on it would hit that throw. Only
    // abandon a record that recordDocumentSeen just now confirmed is still
    // 'seen'.
    const key = filings.buildFilingKey(message.messageId, attachment.attachmentId);
    if (attachment.size > ATTACHMENT_BYTE_CAP && transaction.filings[key].status === 'seen') {
      const abandoned = filings.abandonDocumentFiling(
        agentId,
        matchResult.transactionId,
        message.messageId,
        attachment.attachmentId,
        {
          at,
          actor,
          lastError: `size ${attachment.size} bytes exceeds cap ${ATTACHMENT_BYTE_CAP} bytes`,
          baseDir,
          now,
        }
      );
      return { attachment, matched: true, transactionId: matchResult.transactionId, signals: matchResult.signals, transaction: abandoned };
    }

    return { attachment, matched: true, transactionId: matchResult.transactionId, signals: matchResult.signals, transaction };
  });
}

module.exports = { matchAndFileAttachments, ATTACHMENT_BYTE_CAP };
