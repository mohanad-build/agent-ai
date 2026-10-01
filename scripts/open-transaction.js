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
// Usage: node scripts/open-transaction.js <agent-id> <type> <state> --address <address> [--base-dir <path>] [--listing-id <id>] [--unit <unit>] [--no-folder] [--accepted YYYY-MM-DD] [--condition NAME[=YYYY-MM-DD]]... [--no-conditions] [--additional-deposit YYYY-MM-DD] [--no-additional-deposit]
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
//
// The facts step sits between create and the Drive folder; validate first,
// then write, so a typo leaves nothing behind.

'use strict';

const states = require('../src/transactions/states');
const store = require('../src/transactions/store');
const facts = require('../src/transactions/facts');
const checklist = require('../src/transactions/checklist');
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
  const factPlan = opts.factPlan || [];

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

  // Validate every planned fact against the deal as it is about to be,
  // before anything is created: a typo refuses the whole command instead
  // of leaving a half-built deal. checkFact runs exactly setFact's rules
  // (src/transactions/facts.js), so there is one set of rules, not two.
  const accumulatedFacts = {};
  factPlan.forEach(([key, value]) => {
    facts.checkFact('open-transaction', key, value, { type, facts: accumulatedFacts, actor: 'operator' });
    accumulatedFacts[key] = value;
  });

  const txnFields = { type, state, address };
  if (listingId !== undefined) {
    txnFields.listingId = listingId;
  }
  if (unit !== undefined) {
    txnFields.unit = unit;
  }

  const now = opts.now || new Date();
  let transaction = store.createTransaction(agentId, txnFields, { baseDir: opts.baseDir, now });

  const factsWritten = [];
  for (const [key, value] of factPlan) {
    try {
      transaction = facts.setFact(agentId, transaction.transactionId, key, value, {
        at: now.toISOString(), actor: 'operator', baseDir: opts.baseDir, now,
      });
      factsWritten.push(key);
    } catch (err) {
      const wrapped = new Error(`open-transaction: created ${transaction.transactionId} but could not finish setting facts: ${err.message}`);
      wrapped.transactionId = transaction.transactionId;
      wrapped.factsWritten = factsWritten;
      throw wrapped;
    }
  }

  return transaction;
}

module.exports = { openTransaction };

if (require.main === module) {
  const args = process.argv.slice(2);

  let baseDirFromFlag;
  let listingIdFromFlag;
  let addressFromFlag;
  let unitFromFlag;
  let noFolder = false;
  let acceptedFromFlag;
  let acceptedCount = 0;
  const conditionEntries = [];
  let noConditions = false;
  let additionalDepositFromFlag;
  let additionalDepositCount = 0;
  let noAdditionalDeposit = false;
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
    } else if (args[i] === '--accepted') {
      acceptedFromFlag = args[i + 1];
      acceptedCount++;
      i++;
    } else if (args[i] === '--condition') {
      const raw = args[i + 1] || '';
      const eqIndex = raw.indexOf('=');
      if (eqIndex === -1) {
        conditionEntries.push({ name: raw, date: undefined });
      } else {
        conditionEntries.push({ name: raw.slice(0, eqIndex), date: raw.slice(eqIndex + 1) });
      }
      i++;
    } else if (args[i] === '--no-conditions') {
      noConditions = true;
    } else if (args[i] === '--additional-deposit') {
      additionalDepositFromFlag = args[i + 1];
      additionalDepositCount++;
      i++;
    } else if (args[i] === '--no-additional-deposit') {
      noAdditionalDeposit = true;
    } else {
      positional.push(args[i]);
    }
  }
  const [agentId, type, state] = positional;

  const usage = 'Usage: node scripts/open-transaction.js <agent-id> <type> <state> --address <address> [--base-dir <path>] [--listing-id <id>] [--unit <unit>] [--no-folder] [--accepted YYYY-MM-DD] [--condition NAME[=YYYY-MM-DD]]... [--no-conditions] [--additional-deposit YYYY-MM-DD] [--no-additional-deposit]';

  if (!agentId || !type || !state) {
    console.error(usage);
    process.exit(1);
  }

  if (conditionEntries.length > 0 && noConditions) {
    console.error('open-transaction: --condition and --no-conditions cannot both be given');
    process.exit(1);
  }

  if (acceptedCount > 1) {
    console.error('open-transaction: --accepted given more than once');
    process.exit(1);
  }

  if (additionalDepositCount > 1) {
    console.error('open-transaction: --additional-deposit given more than once');
    process.exit(1);
  }

  if (acceptedCount > 0 && acceptedFromFlag === undefined) {
    console.error('open-transaction: --accepted needs a date (YYYY-MM-DD)');
    process.exit(1);
  }

  if (additionalDepositCount > 0 && additionalDepositFromFlag === undefined) {
    console.error('open-transaction: --additional-deposit needs a date (YYYY-MM-DD)');
    process.exit(1);
  }

  if (additionalDepositFromFlag !== undefined && noAdditionalDeposit) {
    console.error('open-transaction: --additional-deposit and --no-additional-deposit cannot both be given');
    process.exit(1);
  }

  if ((conditionEntries.length > 0 || noConditions) && type !== 'buyer_purchase' && type !== 'seller_sale') {
    console.error('open-transaction: --condition and --no-conditions apply to sales only (buyer_purchase, seller_sale)');
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

  // Built in this order, including only what was given: conditions,
  // conditionDates (only when at least one condition carries a date),
  // acceptedDate, additionalDepositDueDates.
  const factPlan = [];

  if (conditionEntries.length > 0) {
    factPlan.push(['conditions', conditionEntries.map((e) => e.name)]);
  } else if (noConditions) {
    factPlan.push(['conditions', []]);
  }

  const conditionDatesEntries = conditionEntries.filter((e) => e.date !== undefined);
  if (conditionDatesEntries.length > 0) {
    const conditionDates = {};
    conditionDatesEntries.forEach((e) => { conditionDates[e.name] = e.date; });
    factPlan.push(['conditionDates', conditionDates]);
  }

  if (acceptedFromFlag !== undefined) {
    factPlan.push(['acceptedDate', acceptedFromFlag]);
  }

  if (additionalDepositFromFlag !== undefined) {
    factPlan.push(['additionalDepositDueDates', [additionalDepositFromFlag]]);
  } else if (noAdditionalDeposit) {
    factPlan.push(['additionalDepositDueDates', []]);
  }

  (async () => {
    let transaction;
    try {
      transaction = openTransaction(agentId, { type, state, address: addressFromFlag, listingId: listingIdFromFlag, unit: unitFromFlag }, { baseDir, factPlan });
    } catch (err) {
      console.error(err.message);
      if (err.transactionId) {
        const written = err.factsWritten && err.factsWritten.length > 0 ? err.factsWritten.join(', ') : 'none';
        console.error(`Facts set before the failure: ${written}`);
      }
      process.exit(1);
      return;
    }

    const filePath = store._internal.transactionPath(baseDir, agentId, transaction.transactionId);
    console.log(`Transaction created: ${transaction.transactionId}`);
    console.log(`File: ${filePath}`);

    if (factPlan.length > 0) {
      console.log(`Facts set: ${factPlan.map(([key]) => key).join(', ')}`);
    }

    // Blanks are allowed but never silent: every indeterminate item's
    // pendingFacts, deduplicated in first-seen order, so the agent sees
    // exactly what the deal is still waiting on.
    const checklistItems = checklist.resolveChecklistForTransaction(transaction);
    const stillUnanswered = [];
    checklistItems.forEach((item) => {
      if (item.applicability === 'indeterminate') {
        (item.pendingFacts || []).forEach((pendingFact) => {
          if (!stillUnanswered.includes(pendingFact)) {
            stillUnanswered.push(pendingFact);
          }
        });
      }
    });
    console.log(`Still unanswered: ${stillUnanswered.length > 0 ? stillUnanswered.join(', ') : 'none'}`);

    const conditionsWithoutDate = conditionEntries.filter((e) => e.date === undefined).map((e) => e.name);
    if (conditionsWithoutDate.length > 0) {
      console.log(`No date yet for: ${conditionsWithoutDate.join(', ')}`);
    }

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
