// scripts/transition-transaction.js
//
// The operator command for moving a deal to another state (collapsed, closed,
// or any other edge the state machine allows). Thin CLI wrapper over
// src/transactions/transitions.js's transitionTransaction, with its own
// pre-write validation so a dry run can refuse exactly what --yes would
// refuse, without ever calling the writer.
//
// Dry run by default: prints the full preview and exits 0 without writing.
// --yes writes, through transitionTransaction's single save, and prints the
// same preview plus "Done." A terminal target cannot be undone once written,
// so nothing here guesses a target state or a baseDir; both are required.
//
// Usage: node scripts/transition-transaction.js <agentId> <transactionId> <toState> --base-dir <dir> [--reason "<text>"] [--yes]

'use strict';

const store = require('../src/transactions/store');
const states = require('../src/transactions/states');
const { transitionTransaction } = require('../src/transactions/transitions');

// actor is hardcoded 'operator', never a flag: unlike complete-item.js or
// set-fact.js, this command has no legitimate second actor. An agent does
// not run shell commands against the deal store, and the system never
// decides to collapse a deal on its own.
const ACTOR = 'operator';

function runTransitionTransaction(agentId, transactionId, toState, opts = {}) {
  const { reason, yes, baseDir, now, at } = opts;

  const transaction = store.readTransaction(agentId, transactionId, { baseDir });
  if (transaction === null) {
    throw new Error(`transition-transaction: no transaction ${transactionId} for agent ${agentId}`);
  }

  const fromState = transaction.state;

  // The script's own check, ahead of canTransition: canTransition has no
  // explicit "already there" case, so fromState === toState would otherwise
  // fall through to the generic "Cannot move from X to X" edge-not-found
  // message, which is correct but not the clearest answer to what actually
  // happened.
  if (fromState === toState) {
    throw new Error(`transition-transaction: already in state '${toState}'`);
  }

  // canTransition's own refusal covers an unknown toState, an unknown
  // fromState, and fromState already terminal (nothing moves out of a
  // terminal state) in one call. Its message is printed verbatim, with no
  // added prefix: it is already a complete sentence.
  const check = states.canTransition(transaction.type, fromState, toState);
  if (!check.valid) {
    throw new Error(check.reason);
  }

  const targetTerminal = states.isTerminal(transaction.type, toState);
  const hasReason = typeof reason === 'string' && reason.trim() !== '';

  // Only 'collapsed' and 'terminated' require a reason, not every terminal
  // state: 'closed' is the deal completing normally, not a deal dying, so
  // it is not held to the same bar as the two states that record something
  // having gone wrong. Enforced here, not only at the --yes call site, so a
  // missing reason is caught on the dry run, before --yes is ever typed.
  if ((toState === 'collapsed' || toState === 'terminated') && !hasReason) {
    throw new Error(`transition-transaction: --reason is required when moving to '${toState}'`);
  }

  const preview = {
    agentId,
    transactionId,
    address: transaction.address,
    unit: transaction.unit,
    type: transaction.type,
    fromState,
    toState,
    terminal: targetTerminal,
    reason: hasReason ? reason : null,
  };

  if (!yes) {
    return { written: false, preview };
  }

  const result = transitionTransaction(agentId, transactionId, toState, {
    at,
    actor: ACTOR,
    reason: hasReason ? reason : undefined,
    baseDir,
    now,
  });

  return { written: true, preview, transaction: result.transaction };
}

function formatPreview(preview) {
  const lines = [
    `Agent: ${preview.agentId}`,
    `Transaction: ${preview.transactionId}`,
    `Address: ${preview.address}${preview.unit ? `, unit ${preview.unit}` : ''}`,
    `Type: ${preview.type}`,
    `Current state: ${preview.fromState}`,
    `Target state: ${preview.toState}`,
    `Terminal: ${preview.terminal ? 'yes' : 'no'}`,
  ];
  if (preview.terminal) {
    lines.push('This cannot be undone.');
  }
  if (preview.reason) {
    lines.push(`Reason: ${preview.reason}`);
  }
  return lines.join('\n');
}

module.exports = { runTransitionTransaction, formatPreview };

if (require.main === module) {
  const args = process.argv.slice(2);

  let baseDirFromFlag;
  let reasonFromFlag;
  let yesFlag = false;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-dir') {
      baseDirFromFlag = args[i + 1];
      i++;
    } else if (args[i] === '--reason') {
      reasonFromFlag = args[i + 1];
      i++;
    } else if (args[i] === '--yes') {
      yesFlag = true;
    } else {
      positional.push(args[i]);
    }
  }
  const [agentId, transactionId, toState] = positional;

  const usage = 'Usage: node scripts/transition-transaction.js <agentId> <transactionId> <toState> --base-dir <dir> [--reason "<text>"] [--yes]';

  if (!agentId || !transactionId || !toState) {
    console.error(usage);
    process.exit(1);
  }

  // Same reasoning as complete-item.js and set-fact.js: a transaction file is
  // a compliance record, and a terminal write here cannot be undone, so
  // guessing a directory from process.cwd() is the wrong failure mode.
  let baseDir;
  if (baseDirFromFlag) {
    baseDir = baseDirFromFlag;
  } else if (process.env.STORAGE_ROOT) {
    baseDir = process.env.STORAGE_ROOT;
  } else {
    console.error('transition-transaction: baseDir is required. Pass --base-dir <path> or set STORAGE_ROOT.');
    process.exit(1);
  }

  // `at` is not a flag, same reasoning as complete-item.js and set-fact.js:
  // a human at a terminal moving a deal right now has no reason to backdate
  // the event that records it.
  const at = new Date().toISOString();

  try {
    const { written, preview } = runTransitionTransaction(agentId, transactionId, toState, {
      reason: reasonFromFlag,
      yes: yesFlag,
      baseDir,
      at,
    });

    console.log(formatPreview(preview));
    if (written) {
      console.log('Done.');
    } else {
      console.log('Dry run: nothing was changed. Run again with --yes to apply.');
    }
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
