// scripts/satisfy-person.js
//
// Marks a represented person satisfied, or with --undo, unsatisfied, for a
// scope 'client' / clientScope 'event' checklist item. Thin CLI wrapper
// over src/transactions/satisfactions.js's markPersonSatisfied and
// markPersonUnsatisfied.
//
// The person argument may be a participant id or a represented participant's
// name (case-insensitive, trimmed); see resolveParticipantByName in
// src/transactions/participants.js for the resolution rules.
//
// Usage: node scripts/satisfy-person.js <agent-id> <transaction-id> <person-id-or-name> <item-id> --base-dir <path> [--actor <actor>] [--undo]

'use strict';

const store = require('../src/transactions/store');
const { markPersonSatisfied, markPersonUnsatisfied } = require('../src/transactions/satisfactions');
const participants = require('../src/transactions/participants');

function runSatisfyPerson(agentId, transactionId, personId, itemId, opts = {}) {
  const { undo, actor, baseDir, now, at } = opts;

  if (undo) {
    return markPersonUnsatisfied(agentId, transactionId, personId, itemId, { at, actor, baseDir, now });
  }
  return markPersonSatisfied(agentId, transactionId, personId, itemId, { at, actor, baseDir, now });
}

module.exports = { runSatisfyPerson };

// -- name resolution (CLI only) --------------------------------------------------

function formatCandidate(candidate) {
  return `  ${candidate.id}  ${candidate.name}  ${candidate.roles.join(', ')}`;
}

function buildAmbiguousMessage(personArg, transactionId, candidates) {
  return [
    `satisfy-person: '${personArg}' matches more than one represented participant on transaction ${transactionId}. Pass the id instead of the name:`,
    ...candidates.map(formatCandidate),
  ].join('\n');
}

function buildNotFoundMessage(personArg, transactionId, namelessCount) {
  let message = `satisfy-person: no represented participant named '${personArg}' on transaction ${transactionId}.`;
  if (namelessCount > 0) {
    const plural = namelessCount === 1 ? 'participant has' : 'participants have';
    message += ` ${namelessCount} represented ${plural} no name recorded and cannot be matched by name; pass the id instead.`;
  }
  return message;
}

// Resolves personArg to a participant id, in place. personArg that is
// already shaped like a participant id is passed straight through
// unchanged and unvalidated here: an id that names nobody on the
// transaction is still a valid id-shaped argument, and its failure belongs
// to markPersonSatisfied/markPersonUnsatisfied, not to this resolution
// step.
function resolvePerson(agentId, transactionId, personArg, baseDir) {
  if (participants._internal.PARTICIPANT_ID_RE.test(personArg)) {
    return { id: personArg, resolvedName: undefined };
  }

  const transaction = store.readTransaction(agentId, transactionId, { baseDir });
  if (transaction === null) {
    throw new Error(`satisfy-person: no transaction ${transactionId} for agent ${agentId}`);
  }

  const resolution = participants.resolveParticipantByName(transaction.participants, personArg);
  if (!resolution.resolved) {
    if (resolution.reason === 'ambiguous') {
      throw new Error(buildAmbiguousMessage(personArg, transactionId, resolution.candidates));
    }
    throw new Error(buildNotFoundMessage(personArg, transactionId, resolution.namelessCount));
  }

  return { id: resolution.id, resolvedName: personArg };
}

if (require.main === module) {
  const args = process.argv.slice(2);

  let baseDirFromFlag;
  let actorFromFlag;
  let undoFlag = false;
  // An id-shaped argument (matches participants._internal.PARTICIPANT_ID_RE)
  // is passed through completely unmodified: no trim, no case-folding.
  // Anything else is resolved as a represented participant's name below,
  // trimmed and matched case-insensitively.
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
  const [agentId, transactionId, personArg, itemId] = positional;

  const usage = 'Usage: node scripts/satisfy-person.js <agent-id> <transaction-id> <person-id-or-name> <item-id> --base-dir <path> [--actor <actor>] [--undo]';

  if (!agentId || !transactionId || !personArg || !itemId) {
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
    const { id: personId, resolvedName } = resolvePerson(agentId, transactionId, personArg, baseDir);
    const label = resolvedName ? `${resolvedName} (${personId})` : personId;

    runSatisfyPerson(agentId, transactionId, personId, itemId, { undo: undoFlag, actor, baseDir, at });
    console.log(undoFlag ? `Person unsatisfied: ${label} / ${itemId}` : `Person satisfied: ${label} / ${itemId}`);
    console.log(`File: ${store._internal.transactionPath(baseDir, agentId, transactionId)}`);
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
