// scripts/open-transaction.js
//
// Opens a new transaction (deal file) for an agent in one of its type's
// initial states. Thin wrapper over store.createTransaction with
// type/state validation from src/transactions/states.js.
//
// Usage: node scripts/open-transaction.js <agent-id> <type> <state> [--base-dir <path>]

'use strict';

const states = require('../src/transactions/states');
const store = require('../src/transactions/store');

function openTransaction(agentId, fields, opts = {}) {
  if (typeof agentId !== 'string' || agentId.trim() === '') {
    throw new Error('openTransaction: agentId must be a non-empty string');
  }

  if (typeof opts.baseDir !== 'string' || opts.baseDir.trim() === '') {
    throw new Error('openTransaction: baseDir is required');
  }

  const { type, state } = fields || {};

  if (!states.TRANSACTION_TYPES.includes(type)) {
    throw new Error(`openTransaction: unknown type '${type}'. Must be one of: ${states.TRANSACTION_TYPES.join(', ')}`);
  }

  if (typeof state !== 'string' || state.trim() === '') {
    throw new Error('openTransaction: state must be a non-empty string');
  }

  if (!states.isValidInitialState(type, state)) {
    const initial = states.getInitialStates(type);
    throw new Error(`openTransaction: '${state}' is not a valid initial state for type '${type}'. Valid initial states: ${initial.join(', ')}`);
  }

  return store.createTransaction(agentId, { type, state }, { baseDir: opts.baseDir, now: opts.now });
}

module.exports = { openTransaction };

if (require.main === module) {
  const args = process.argv.slice(2);

  const baseDirFlagIndex = args.indexOf('--base-dir');
  let baseDirFromFlag;
  let positional = args;
  if (baseDirFlagIndex !== -1) {
    baseDirFromFlag = args[baseDirFlagIndex + 1];
    positional = [...args.slice(0, baseDirFlagIndex), ...args.slice(baseDirFlagIndex + 2)];
  }
  const [agentId, type, state] = positional;

  const usage = 'Usage: node scripts/open-transaction.js <agent-id> <type> <state> [--base-dir <path>]';

  if (!agentId || !type || !state) {
    console.error(usage);
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

  try {
    const transaction = openTransaction(agentId, { type, state }, { baseDir });
    const filePath = store._internal.transactionPath(baseDir, agentId, transaction.transactionId);
    console.log(`Transaction created: ${transaction.transactionId}`);
    console.log(`File: ${filePath}`);
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
