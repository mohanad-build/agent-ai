// scripts/review-filing.js
//
// Confirms or, with --reject, rejects a filing record on a transaction. Thin
// CLI wrapper over src/transactions/filings.js's confirmFiling and
// rejectFiling.
//
// Confirm and reject share one script because they are the same operation
// with opposite outcomes on the same record, exactly the way
// satisfy-person.js handles satisfied and unsatisfied: one axis, two
// directions, one flag choosing between them. Confirm is the default,
// --reject is the flag.
//
// messageId and attachmentId are raw Gmail ids, taken as-is, with no
// resolution step. satisfy-person.js resolves a name to a participant id
// because a human at a terminal cannot be expected to know participant ids
// by heart. The equivalent here would be resolving something human-readable,
// a filename, say, to a filing record. That resolution is deliberately not
// built: nothing in this codebase creates filing records yet (see the
// recon: no script calls recordDocumentSeen), so there is nothing on disk to
// resolve a filename against. What the agent-facing key for this operation
// should look like is an open question left for whenever the orchestrator
// that actually creates filing records exists.
//
// Confirm and reject are both TERMINAL. filings.js refuses any transition
// out of 'confirmed' or 'rejected': running this command twice against the
// same record is an error, not a no-op, and the second run's error message
// names whatever the record's review value already is.
//
// Usage: node scripts/review-filing.js <agent-id> <transaction-id> <message-id> <attachment-id> --base-dir <path> [--actor <actor>] [--reject]

'use strict';

const store = require('../src/transactions/store');
const filings = require('../src/transactions/filings');
const { confirmFiling, rejectFiling } = filings;

function runReviewFiling(agentId, transactionId, messageId, attachmentId, opts = {}) {
  const { reject, actor, baseDir, now, at } = opts;

  if (reject) {
    return rejectFiling(agentId, transactionId, messageId, attachmentId, { at, actor, baseDir, now });
  }
  return confirmFiling(agentId, transactionId, messageId, attachmentId, { at, actor, baseDir, now });
}

module.exports = { runReviewFiling };

if (require.main === module) {
  const args = process.argv.slice(2);

  let baseDirFromFlag;
  let actorFromFlag;
  let rejectFlag = false;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-dir') {
      baseDirFromFlag = args[i + 1];
      i++;
    } else if (args[i] === '--actor') {
      actorFromFlag = args[i + 1];
      i++;
    } else if (args[i] === '--reject') {
      rejectFlag = true;
    } else {
      positional.push(args[i]);
    }
  }
  const [agentId, transactionId, messageId, attachmentId] = positional;

  const usage = 'Usage: node scripts/review-filing.js <agent-id> <transaction-id> <message-id> <attachment-id> --base-dir <path> [--actor <actor>] [--reject]';

  if (!agentId || !transactionId || !messageId || !attachmentId) {
    console.error(usage);
    process.exit(1);
  }

  // This deliberately does not fall back to getStorageRoot()'s
  // process.cwd() default the way other scripts in this repo do. A
  // transaction file is a compliance record: writing it into whatever
  // directory the process happened to be launched from, with no
  // confirmation, is the wrong failure mode here. Refusing and naming both
  // places baseDir could have come from is safer than guessing.
  let baseDir;
  if (baseDirFromFlag) {
    baseDir = baseDirFromFlag;
  } else if (process.env.STORAGE_ROOT) {
    baseDir = process.env.STORAGE_ROOT;
  } else {
    console.error('review-filing: baseDir is required. Pass --base-dir <path> or set STORAGE_ROOT.');
    process.exit(1);
  }

  const actor = actorFromFlag || 'agent';
  // `at` is not a flag. The writers take it because tests need to inject a
  // fixed clock; a human at a terminal reviewing a filing right now has no
  // reason to backdate the event.
  const at = new Date().toISOString();

  try {
    const transaction = runReviewFiling(agentId, transactionId, messageId, attachmentId, { reject: rejectFlag, actor, baseDir, at });
    const key = filings._internal.buildFilingKey(messageId, attachmentId);
    const filename = transaction.filings[key].filename;
    console.log(rejectFlag ? `Filing rejected: ${filename}` : `Filing confirmed: ${filename}`);
    console.log(`File: ${store._internal.transactionPath(baseDir, agentId, transactionId)}`);
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
