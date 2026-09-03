// src/drain.js
//
// TC_SPEC 7.14 PASS 2 (the drain pass): sweeps one agent's transactions for
// filings sitting at status 'seen', fetches the attachment bytes, uploads
// them to Drive, and records the outcome. Async, and deliberately NOT under
// src/transactions/ -- every module in that directory is synchronous, and
// that property is load-bearing for TC_SPEC 7.7's concurrency safety (a
// store read-patch-write cycle with an await inside it is exactly the
// hazard 7.7 warns about). This is the same reasoning driveFolders.js's
// header gives for its own placement next to this file.

'use strict';

// Required as module objects and called through them (gmailAttachments.
// fetchAttachmentBytes, not a destructured fetchAttachmentBytes), the same
// convention intake.js documents for queries/matcher/filings: it is what
// lets require-cache mocking in tests intercept these calls.
const gmailAttachments = require('./gmailAttachments');
const driveFolders = require('./driveFolders');
const drive = require('./drive');
const { parseRecipientList } = require('./recipientParsing');
const queries = require('./transactions/queries');
const filings = require('./transactions/filings');
const store = require('./transactions/store');

// Each cycle already spends up to 3 gaxios retries on the GET fetch
// (googleRetry.js's header) plus up to 3 withGoogleRetry attempts on the
// POST upload (drive.js) before a single recordFilingAttemptFailure call
// even happens. 5 cycles of that is roughly 15 real attempts spread across
// 25 minutes (5 cycles x the 5 minute orchestrator interval), which is
// enough runway to ride out a transient Google outage without retrying
// forever.
const MAX_ATTEMPTS = 5;

// -- Filename -----------------------------------------------------------------

function formatDateOnly(receivedAt) {
  return receivedAt ? receivedAt.slice(0, 10) : 'unknown date';
}

// TC_SPEC 10.2: a filename may contain only what was OBSERVED, never
// anything inferred. The sender label is derived here, at naming time, from
// the raw `From` header the record already stored verbatim -- parsing at
// storage time would have thrown away the original header this exact
// derivation needs. parseRecipientList (recipientParsing.js) already parses
// this exact shape and is well tested since session 67; writing a second
// header parser here would be two sources of truth for one format.
function deriveSenderLabel(rawSender) {
  if (!rawSender) return 'unknown sender';
  const [parsed] = parseRecipientList(rawSender);
  if (!parsed) return 'unknown sender';
  return parsed.name || parsed.address;
}

// Only the derived filename is sanitised for Drive, never the stored
// record: the record is what was observed, the filename is a label, the
// same distinction driveFolders.js's buildTransactionFolderName draws for
// the transaction folder name. Strips path separators and control
// characters (Drive treats a bare filename as one path segment, but nothing
// stops a header from containing one), collapses whitespace, and drops a
// leading dot so the result can never masquerade as a hidden file.
function sanitizeForDrive(value) {
  return value
    .replace(/[\\/\x00-\x1f]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '');
}

function buildDriveFilename(record) {
  const dateReceived = formatDateOnly(record.receivedAt);
  const senderLabel = deriveSenderLabel(record.sender);
  return sanitizeForDrive(`${dateReceived} - from ${senderLabel} - ${record.filename}`);
}

// -- drainFilings ---------------------------------------------------------------

async function drainFilings(agentConfig, opts = {}) {
  const { at, actor, baseDir, now } = opts;
  const agentId = agentConfig.agentId;

  // No index over filing status, and none is being added. An index would be
  // a second source of truth about what status a filing is at, and drift
  // between an index and the transaction file -- the actual compliance
  // record -- is exactly the failure class this project designs against.
  // This scans every transaction and every filing on it, every cycle. If
  // that read cost ever bites, the fix is archiving terminal transactions,
  // not building an index here.
  const transactions = queries.readAllTransactions(agentId, { baseDir });

  const entries = [];
  for (const transaction of transactions) {
    const transactionFilings = transaction.filings || {};
    for (const [key, record] of Object.entries(transactionFilings)) {
      if (record.status === 'seen') {
        entries.push({ transactionId: transaction.transactionId, key, record });
      }
    }
  }

  // SEQUENTIAL, not Promise.all, and this is load-bearing. TC_SPEC 7.7's
  // store concurrency safety holds only because every read-patch-write
  // cycle on a transaction file runs synchronously end to end with nothing
  // interleaved. Every await below must settle before the next filing's
  // writes open their own read-patch-write cycle; Promise.all here would
  // let two filings' awaits interleave around writes to the same
  // transaction file, including two filings on the very same transaction.
  for (const { transactionId, key, record } of entries) {
    let step = 'fetch';
    try {
      const { buffer, contentHash } = await gmailAttachments.fetchAttachmentBytes(
        agentConfig,
        record.messageId,
        record.attachmentId
      );
      // contentHash comes straight from fetchAttachmentBytes, computed on
      // the raw bytes inside that call, and is never recomputed here. That
      // is what makes TC_SPEC 7.7's "hash before the write cycle" rule
      // structurally impossible to violate: there is no second hashing step
      // downstream where a re-hash could drift from what was actually
      // fetched.

      step = 'folder';
      // Re-read the transaction fresh from disk immediately before this
      // call, rather than reusing the entry's snapshot from the top of this
      // function. ensureTransactionFolder's own store write (driveFolders.js)
      // persists whatever transaction object its caller hands it; if two
      // filings on the same transaction are drained in this same cycle and
      // the first one writes to the file (recordDocumentFiled or
      // recordFilingAttemptFailure) before the second one reaches this line,
      // handing ensureTransactionFolder the original stale snapshot would
      // silently overwrite that first write. A fresh read here means this
      // call only ever sees, and only ever persists, the current state of
      // the file.
      const currentTransaction = store.readTransaction(agentId, transactionId, { baseDir });
      const folderId = await driveFolders.ensureTransactionFolder(agentConfig, currentTransaction, { baseDir, now });

      step = 'upload';
      const uploadResult = await drive.uploadFile(agentConfig, {
        name: buildDriveFilename(record),
        folderId,
        mimeType: record.mimeType,
        buffer,
      });

      step = 'record';
      filings.recordDocumentFiled(agentId, transactionId, record.messageId, record.attachmentId, {
        at,
        actor,
        driveFileId: uploadResult.id,
        contentHash,
        baseDir,
        now,
      });
    } catch (err) {
      // One filing's failure must not stop the others in this agent's
      // batch, same discipline as index.js's per-agent loop: catch here,
      // log, move on to the next entry.
      const lastError = `${step} failed: ${err.message}`;
      const updated = filings.recordFilingAttemptFailure(
        agentId,
        transactionId,
        record.messageId,
        record.attachmentId,
        { at, actor, lastError, baseDir, now }
      );

      if (updated.filings[key].attempts >= MAX_ATTEMPTS) {
        filings.abandonDocumentFiling(agentId, transactionId, record.messageId, record.attachmentId, {
          at,
          actor,
          lastError,
          baseDir,
          now,
        });
      }
    }
  }
}

module.exports = { drainFilings, MAX_ATTEMPTS };

module.exports._internal = {
  buildDriveFilename,
  deriveSenderLabel,
  sanitizeForDrive,
  formatDateOnly,
};
