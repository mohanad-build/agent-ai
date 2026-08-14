// scripts/satisfy-person.js
//
// Marks a represented person satisfied, or with --undo, unsatisfied, for a
// scope 'client' / clientScope 'event' checklist item. Thin CLI wrapper
// over src/transactions/satisfactions.js's markPersonSatisfied and
// markPersonUnsatisfied.
//
// Usage: node scripts/satisfy-person.js <agent-id> <transaction-id> <person> <item-id> --base-dir <path> [--actor <actor>] [--undo]

'use strict';

const store = require('../src/transactions/store');
const { markPersonSatisfied, markPersonUnsatisfied } = require('../src/transactions/satisfactions');

function runSatisfyPerson(agentId, transactionId, personId, itemId, opts = {}) {
  const { undo, actor, baseDir, now, at } = opts;

  if (undo) {
    return markPersonUnsatisfied(agentId, transactionId, personId, itemId, { at, actor, baseDir, now });
  }
  return markPersonSatisfied(agentId, transactionId, personId, itemId, { at, actor, baseDir, now });
}

module.exports = { runSatisfyPerson };

if (require.main === module) {
  const args = process.argv.slice(2);

  let baseDirFromFlag;
  let actorFromFlag;
  let undoFlag = false;
  // The person argument is passed through completely unmodified: no trim.
  // Names are matched by strict equality against representedPersons
  // downstream, and the brokerage files under exactly what the paperwork
  // says.
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-dir') {
      baseDirFromFlag = args[i + 1];
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
  const [agentId, transactionId, personId, itemId] = positional;

  const usage = 'Usage: node scripts/satisfy-person.js <agent-id> <transaction-id> <person> <item-id> --base-dir <path> [--actor <actor>] [--undo]';

  if (!agentId || !transactionId || !personId || !itemId) {
    console.error(usage);
    process.exit(1);
  }

  // This deliberately does not fall back to getStorageRoot()'s
  // process.cwd() default the way satisfactions.js's own callers do
  // internally. A transaction file is a compliance record: writing it into
  // whatever directory the process happened to be launched from, with no
  // confirmation, is the wrong failure mode here. Refusing and naming both
  // places baseDir could have come from is safer than guessing.
  let baseDir;
  if (baseDirFromFlag) {
    baseDir = baseDirFromFlag;
  } else if (process.env.STORAGE_ROOT) {
    baseDir = process.env.STORAGE_ROOT;
  } else {
    console.error('satisfy-person: baseDir is required. Pass --base-dir <path> or set STORAGE_ROOT.');
    process.exit(1);
  }

  const actor = actorFromFlag || 'agent';
  // `at` is not a flag. The writers take it because tests need to inject a
  // fixed clock; a human at a terminal recording satisfaction right now has
  // no reason to backdate the event.
  const at = new Date().toISOString();

  try {
    runSatisfyPerson(agentId, transactionId, personId, itemId, { undo: undoFlag, actor, baseDir, at });
    console.log(undoFlag ? `Person unsatisfied: ${personId} / ${itemId}` : `Person satisfied: ${personId} / ${itemId}`);
    console.log(`File: ${store._internal.transactionPath(baseDir, agentId, transactionId)}`);
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
