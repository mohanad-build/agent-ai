// scripts/list-participants.js
//
// Lists every participant on a transaction: id, name, roles, and whether
// represented. Read only; it does not write the transaction and appends no
// event. A participant with no name is otherwise unreachable except by
// opening the transaction JSON by hand, since satisfy-person can only
// address one by id or by name; this is how you get the id.
//
// Shows ALL participants, not only represented ones: a lawyer cannot be
// satisfied, but you may still need their id. Represented status uses
// participants.isRepresented directly rather than re-deriving the rule.
//
// Usage: node scripts/list-participants.js <agent-id> <transaction-id> --base-dir <path>

'use strict';

const store = require('../src/transactions/store');
const participants = require('../src/transactions/participants');

const NO_NAME = '(no name)';

function runListParticipants(agentId, transactionId, opts = {}) {
  const { baseDir } = opts;

  const transaction = store.readTransaction(agentId, transactionId, { baseDir });
  if (transaction === null) {
    throw new Error(`list-participants: no transaction ${transactionId} for agent ${agentId}`);
  }

  const ids = Object.keys(transaction.participants || {}).sort();
  return ids.map((id) => {
    const participant = transaction.participants[id];
    return {
      id,
      name: participant.name === undefined ? NO_NAME : participant.name,
      roles: [...participant.roles],
      represented: participants.isRepresented(participant),
    };
  });
}

module.exports = { runListParticipants };

if (require.main === module) {
  const args = process.argv.slice(2);

  let baseDirFromFlag;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-dir') {
      baseDirFromFlag = args[i + 1];
      i++;
    } else {
      positional.push(args[i]);
    }
  }
  const [agentId, transactionId] = positional;

  const usage = 'Usage: node scripts/list-participants.js <agent-id> <transaction-id> --base-dir <path>';

  if (!agentId || !transactionId) {
    console.error(usage);
    process.exit(1);
  }

  // This deliberately does not fall back to getStorageRoot()'s
  // process.cwd() default the way the transaction modules' own callers do
  // internally. A transaction file is a compliance record: reading whatever
  // happens to be in the directory the process was launched from, with no
  // confirmation, is the wrong failure mode here. Refusing and naming both
  // places baseDir could have come from is safer than guessing.
  let baseDir;
  if (baseDirFromFlag) {
    baseDir = baseDirFromFlag;
  } else if (process.env.STORAGE_ROOT) {
    baseDir = process.env.STORAGE_ROOT;
  } else {
    console.error('list-participants: baseDir is required. Pass --base-dir <path> or set STORAGE_ROOT.');
    process.exit(1);
  }

  try {
    const rows = runListParticipants(agentId, transactionId, { baseDir });
    if (rows.length === 0) {
      console.log(`No participants on transaction ${transactionId}.`);
    } else {
      rows.forEach((row) => {
        const marker = row.represented ? '(represented)' : '';
        console.log(`${row.id}  ${row.name}  ${row.roles.join(', ')}  ${marker}`.trimEnd());
      });
    }
    console.log(`File: ${store._internal.transactionPath(baseDir, agentId, transactionId)}`);
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
