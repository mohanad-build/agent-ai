// scripts/open-transaction.js
//
// Opens a new transaction (deal file) for an agent in one of its type's
// initial states. Thin wrapper over store.createTransaction with
// type/state validation from src/transactions/states.js.
//
// When no --listing-id is given, a successful create is followed by a
// report of any matching listing found via store.findListingCandidates:
// names the id(s) and the flag to link one by hand. It is a report, not an
// automatic link, and this is deliberate, not an oversight to "fix" later.
// findListingCandidates' address matching goes through compareAddresses
// (src/transactions/address.js), which is absence-tolerant by design: an
// absent street type, directional or city on either side is not treated as
// a mismatch. That is correct for the document-matching job it was built
// for, where a missed match is free. Here the output would be a listingId
// written onto a compliance record that a later document-filing tiebreak
// routes on, and '14 Bonacres Rd' would tolerantly match a listing at '14
// Bonacres Rd E'. A wrong silent link is durable and hard to notice; a
// report the agent confirms with --listing-id is not. Do not make this
// write listingId automatically under any condition.
//
// Usage: node scripts/open-transaction.js <agent-id> <type> <state> --address <address> [--base-dir <path>] [--listing-id <id>] [--unit <unit>] [--no-folder]
//
// After a successful create, this also ensures a Drive folder exists for the
// transaction (TC_SPEC 10.1/10.2), creating the agent's app-owned parent
// folder first if this is that agent's first transaction folder. Order is
// always createTransaction first, then the folder: a folder created before a
// failed transaction write would be an orphan in the agent's Drive with
// nothing on disk pointing at it, the reverse of the failure mode this
// ordering avoids. Folder creation is NON-FATAL and best-effort: a network or
// auth failure prints a clear line and the command still exits 0, because a
// deal must never fail to open over a Drive 500, and the drain pass creates
// the folder lazily on first filing if this attempt never ran or failed.
// --no-folder skips the attempt entirely, for running this command with no
// network access at all.

'use strict';

const states = require('../src/transactions/states');
const store = require('../src/transactions/store');
const { loadAgent } = require('../src/agentConfig');
const driveFolders = require('../src/driveFolders');

function openTransaction(agentId, fields, opts = {}) {
  if (typeof agentId !== 'string' || agentId.trim() === '') {
    throw new Error('openTransaction: agentId must be a non-empty string');
  }

  if (typeof opts.baseDir !== 'string' || opts.baseDir.trim() === '') {
    throw new Error('openTransaction: baseDir is required');
  }

  const { type, state, listingId, address, unit } = fields || {};

  if (!states.TRANSACTION_TYPES.includes(type)) {
    throw new Error(`openTransaction: unknown type '${type}'. Must be one of: ${states.TRANSACTION_TYPES.join(', ')}`);
  }

  if (typeof state !== 'string' || state.trim() === '') {
    throw new Error('openTransaction: state must be a non-empty string');
  }

  if (!states.isValidState(type, state)) {
    const valid = states.getStates(type);
    throw new Error(`openTransaction: '${state}' is not a valid state for type '${type}'. Valid states: ${valid.join(', ')}`);
  }

  if (!states.isValidInitialState(type, state)) {
    const initial = states.getInitialStates(type);
    throw new Error(`openTransaction: '${state}' is not a valid initial state for type '${type}'. Valid initial states: ${initial.join(', ')}`);
  }

  const txnFields = { type, state, address };
  if (listingId !== undefined) {
    txnFields.listingId = listingId;
  }
  if (unit !== undefined) {
    txnFields.unit = unit;
  }

  return store.createTransaction(agentId, txnFields, { baseDir: opts.baseDir, now: opts.now });
}

module.exports = { openTransaction };

if (require.main === module) {
  const args = process.argv.slice(2);

  let baseDirFromFlag;
  let listingIdFromFlag;
  let addressFromFlag;
  let unitFromFlag;
  let noFolder = false;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-dir') {
      baseDirFromFlag = args[i + 1];
      i++;
    } else if (args[i] === '--listing-id') {
      listingIdFromFlag = args[i + 1];
      i++;
    } else if (args[i] === '--address') {
      addressFromFlag = args[i + 1];
      i++;
    } else if (args[i] === '--unit') {
      unitFromFlag = args[i + 1];
      i++;
    } else if (args[i] === '--no-folder') {
      noFolder = true;
    } else {
      positional.push(args[i]);
    }
  }
  const [agentId, type, state] = positional;

  const usage = 'Usage: node scripts/open-transaction.js <agent-id> <type> <state> --address <address> [--base-dir <path>] [--listing-id <id>] [--unit <unit>] [--no-folder]';

  if (!agentId || !type || !state) {
    console.error(usage);
    process.exit(1);
  }

  // The store's validation error is written for a caller bug (a
  // programmatic fields object missing a required key); it's the wrong
  // message for a human who forgot a flag at a terminal. Refuse here, in
  // the same style as the baseDir refusal below, naming the flag.
  if (!addressFromFlag) {
    console.error('open-transaction: address is required. Pass --address <address>.');
    process.exit(1);
  }

  // This deliberately does not fall back to getStorageRoot()'s
  // process.cwd() default the way other scripts in this repo do. A
  // transaction file is a compliance record: writing it into whatever
  // directory the process happened to be launched from, with no
  // confirmation, is the wrong failure mode here. Refusing and naming
  // both places baseDir could have come from is safer than guessing.
  let baseDir;
  if (baseDirFromFlag) {
    baseDir = baseDirFromFlag;
  } else if (process.env.STORAGE_ROOT) {
    baseDir = process.env.STORAGE_ROOT;
  } else {
    console.error('open-transaction: baseDir is required. Pass --base-dir <path> or set STORAGE_ROOT.');
    process.exit(1);
  }

  (async () => {
    let transaction;
    try {
      transaction = openTransaction(agentId, { type, state, address: addressFromFlag, listingId: listingIdFromFlag, unit: unitFromFlag }, { baseDir });
    } catch (err) {
      console.error(err.message);
      process.exit(1);
      return;
    }

    const filePath = store._internal.transactionPath(baseDir, agentId, transaction.transactionId);
    console.log(`Transaction created: ${transaction.transactionId}`);
    console.log(`File: ${filePath}`);

    // Order is createTransaction (above, already done and written) THEN the
    // folder, never the reverse -- see the file header. Best-effort and
    // non-fatal: any failure here, Drive or otherwise (including this
    // agent's config not being found under STORAGE_ROOT when --base-dir
    // points somewhere else -- see driveFolders.js), is caught, reported,
    // and left for the drain pass to retry lazily. It must never turn a
    // successful transaction create into a nonzero exit.
    if (!noFolder) {
      try {
        const agentConfig = loadAgent(agentId);
        const folderId = await driveFolders.ensureTransactionFolder(agentConfig, transaction, { baseDir });
        console.log(`Drive folder ready: ${folderId}`);
      } catch (err) {
        console.error(`open-transaction: could not create Drive folder, will be created on first filing: ${err.message}`);
      }
    }

    // Convenience only, and the transaction above is already written: a
    // failure here must not turn a successful create into a nonzero exit.
    // An explicit --listing-id is the agent's own decision and is not
    // second-guessed by looking anything up.
    if (!listingIdFromFlag) {
      try {
        const candidates = store.findListingCandidates(agentId, type, addressFromFlag, { baseDir });
        if (candidates.length === 1) {
          const [only] = candidates;
          console.log(`Matching listing found: ${only.transactionId} (${only.address}, ${only.state}). Link it with: --listing-id ${only.transactionId}`);
        } else if (candidates.length > 1) {
          const lines = candidates.map((c) => `  ${c.transactionId}  ${c.address}  ${c.state}`);
          console.log([`${candidates.length} matching listings found. Pick one and pass --listing-id:`, ...lines].join('\n'));
        }
      } catch (err) {
        console.error(`open-transaction: could not check for candidate listings: ${err.message}`);
      }
    }

    process.exit(0);
  })();
}
