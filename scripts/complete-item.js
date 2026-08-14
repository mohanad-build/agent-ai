// scripts/complete-item.js
//
// Marks a checklist item complete or, with --undo, incomplete. Thin CLI
// wrapper over src/transactions/items.js's markItemComplete and
// markItemIncomplete.
//
// Usage: node scripts/complete-item.js <agent-id> <transaction-id> <item-id> --base-dir <path> [--completed-at <iso>] [--note <text>] [--document <path>]... [--actor <actor>] [--undo]

'use strict';

const store = require('../src/transactions/store');
const { markItemComplete, markItemIncomplete } = require('../src/transactions/items');

function runCompleteItem(agentId, transactionId, itemId, opts = {}) {
  const { undo, completedAt, note, documents, actor, baseDir, now, at } = opts;

  if (undo) {
    if (completedAt !== undefined || note !== undefined || (documents !== undefined && documents.length > 0)) {
      throw new Error('complete-item: --undo cannot be combined with --completed-at, --note or --document');
    }
    return markItemIncomplete(agentId, transactionId, itemId, { at, actor, baseDir, now });
  }

  const writerOpts = { at, actor, completedAt, baseDir, now };
  // Omit the key entirely when none are given, never []: markItemComplete
  // stores exactly what it is told, and an empty array would read on disk
  // as "documents were checked and there are none" instead of "no document
  // was mentioned".
  if (documents !== undefined && documents.length > 0) {
    writerOpts.documents = documents;
  }
  if (note !== undefined) {
    writerOpts.note = note;
  }
  return markItemComplete(agentId, transactionId, itemId, writerOpts);
}

module.exports = { runCompleteItem };

if (require.main === module) {
  const args = process.argv.slice(2);

  let baseDirFromFlag;
  let completedAtFromFlag;
  let noteFromFlag;
  let actorFromFlag;
  let undoFlag = false;
  const documents = [];
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-dir') {
      baseDirFromFlag = args[i + 1];
      i++;
    } else if (args[i] === '--completed-at') {
      completedAtFromFlag = args[i + 1];
      i++;
    } else if (args[i] === '--note') {
      noteFromFlag = args[i + 1];
      i++;
    } else if (args[i] === '--document') {
      documents.push(args[i + 1]);
      i++;
    } else if (args[i] === '--actor') {
      actorFromFlag = args[i + 1];
      i++;
    } else if (args[i] === '--undo') {
      undoFlag = true;
    } else {
      positional.push(args[i]);
    }
  }
  const [agentId, transactionId, itemId] = positional;

  const usage = 'Usage: node scripts/complete-item.js <agent-id> <transaction-id> <item-id> --base-dir <path> [--completed-at <iso>] [--note <text>] [--document <path>]... [--actor <actor>] [--undo]';

  if (!agentId || !transactionId || !itemId) {
    console.error(usage);
    process.exit(1);
  }

  if (undoFlag && (completedAtFromFlag !== undefined || noteFromFlag !== undefined || documents.length > 0)) {
    console.error('complete-item: --undo cannot be combined with --completed-at, --note or --document.');
    process.exit(1);
  }

  // This deliberately does not fall back to getStorageRoot()'s
  // process.cwd() default the way items.js's own callers do internally. A
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
    console.error('complete-item: baseDir is required. Pass --base-dir <path> or set STORAGE_ROOT.');
    process.exit(1);
  }

  const actor = actorFromFlag || 'agent';
  // `at` is not a flag. The writers take it because tests need to inject a
  // fixed clock; a human at a terminal marking something complete right now
  // has no reason to backdate the event that records it.
  const at = new Date().toISOString();
  // --completed-at defaults to now, computed separately from `at` above:
  // `at` is when the event was logged, completedAt is when the item was
  // actually completed, and a human ticking something off today means
  // today for both, but they are not the same field and are not forced to
  // share a value just because they usually agree.
  const completedAt = undoFlag ? undefined : (completedAtFromFlag || new Date().toISOString());

  try {
    runCompleteItem(agentId, transactionId, itemId, {
      undo: undoFlag,
      completedAt,
      note: noteFromFlag,
      documents: documents.length > 0 ? documents : undefined,
      actor,
      baseDir,
      at,
    });
    console.log(undoFlag ? `Item uncompleted: ${itemId}` : `Item completed: ${itemId}`);
    console.log(`File: ${store._internal.transactionPath(baseDir, agentId, transactionId)}`);
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
