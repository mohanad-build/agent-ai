// scripts/set-fact.js
//
// Sets or confirms a fact on a transaction. Thin CLI wrapper over
// src/transactions/facts.js's setFact and confirmFact. correctFact and
// system evidence are deliberately not exposed here: corrections and
// system-sourced evidence are not things a human types at a terminal today.
//
// Usage: node scripts/set-fact.js <agent-id> <transaction-id> <key> <value> --base-dir <path> [--actor <agent|system|operator>] [--confirm]

'use strict';

const store = require('../src/transactions/store');
const { setFact, confirmFact } = require('../src/transactions/facts');

// Facts are strings, booleans, arrays and null today. Numbers are
// deliberately NOT parsed: no fact key in FACT_KEYS holds one, and silently
// turning '12' into 12 is the kind of coercion that surfaces as a resolver
// mismatch months later. If a numeric fact is ever added, this decision
// should be revisited alongside it.
function parseFactValue(raw) {
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  if (raw === 'null') {
    return null;
  }
  if (raw.startsWith('[')) {
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(`set-fact: could not parse '${raw}' as JSON: ${err.message}`);
    }
  }
  return raw;
}

function runSetFact(agentId, transactionId, key, opts = {}) {
  const { confirm, rawValue, actor, baseDir, now, at } = opts;

  if (confirm) {
    if (rawValue !== undefined) {
      throw new Error('set-fact: --confirm takes no value; a value was also given');
    }
    return confirmFact(agentId, transactionId, key, { at, actor, baseDir, now });
  }

  if (rawValue === undefined) {
    throw new Error('set-fact: value is required unless --confirm is given');
  }

  return setFact(agentId, transactionId, key, parseFactValue(rawValue), { at, actor, baseDir, now });
}

module.exports = { parseFactValue, runSetFact };

if (require.main === module) {
  const args = process.argv.slice(2);

  let baseDirFromFlag;
  let actorFromFlag;
  let confirmFlag = false;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-dir') {
      baseDirFromFlag = args[i + 1];
      i++;
    } else if (args[i] === '--actor') {
      actorFromFlag = args[i + 1];
      i++;
    } else if (args[i] === '--confirm') {
      confirmFlag = true;
    } else {
      positional.push(args[i]);
    }
  }
  const [agentId, transactionId, key, value] = positional;

  const usage = 'Usage: node scripts/set-fact.js <agent-id> <transaction-id> <key> <value> --base-dir <path> [--actor <agent|system|operator>] [--confirm]';

  if (!agentId || !transactionId || !key) {
    console.error(usage);
    process.exit(1);
  }

  if (confirmFlag && value !== undefined) {
    console.error('set-fact: --confirm takes no value argument. A value was also given; drop the value or drop --confirm.');
    process.exit(1);
  }

  if (!confirmFlag && value === undefined) {
    console.error(usage);
    process.exit(1);
  }

  // This deliberately does not fall back to getStorageRoot()'s
  // process.cwd() default the way facts.js's own callers do internally. A
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
    console.error('set-fact: baseDir is required. Pass --base-dir <path> or set STORAGE_ROOT.');
    process.exit(1);
  }

  const actor = actorFromFlag || 'agent';
  // `at` is not a flag. The writers take it because tests need to inject a
  // fixed clock; a human at a terminal setting a fact right now has no
  // reason to backdate the event that records it.
  const at = new Date().toISOString();

  try {
    runSetFact(agentId, transactionId, key, { confirm: confirmFlag, rawValue: value, actor, baseDir, at });
    console.log(confirmFlag ? `Fact confirmed: ${key}` : `Fact set: ${key}`);
    console.log(`File: ${store._internal.transactionPath(baseDir, agentId, transactionId)}`);
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
