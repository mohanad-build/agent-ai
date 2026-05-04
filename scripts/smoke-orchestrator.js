// scripts/smoke-orchestrator.js
//
// One-shot manual smoke test for the step 3 orchestrator wire-up.
//
// PREREQUISITES (Mo does these before running):
//   1. Make sure at least one unread reply from a Sheet lead is in the mo-test
//      Gmail inbox. The sender address must match column A of a processable row.
//   2. Verify mo-test is in shadow mode (printed below before anything fires).
//
// WHAT THIS DOES NOT DO:
//   - No Sheet reset, no markUnread, no teardown. Mo resets manually between runs.
//   - No assertions. Output is read by a human.
//   - No loops. One processAgent call, then exit.
//
// Usage: node scripts/smoke-orchestrator.js

require('dotenv').config();

const { loadAgent } = require('../src/agentConfig');
const { processAgent } = require('../src/index');

function divider() {
  return '='.repeat(60);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const agent = loadAgent('mo-test');

  console.log(divider());
  console.log('SMOKE TEST: orchestrator step 3 dispatch');
  console.log(`Agent: ${agent.agentId}`);
  console.log(`Mode: ${agent.mode}`);
  console.log('Starting processAgent in 3... 2... 1...');
  console.log(divider());
  console.log();

  await sleep(1000);
  process.stdout.write('3... ');
  await sleep(1000);
  process.stdout.write('2... ');
  await sleep(1000);
  process.stdout.write('1...\n\n');

  try {
    await processAgent(agent.agentId);
  } catch (err) {
    console.error();
    console.error(divider());
    console.error('SMOKE TEST FAILED');
    console.error(divider());
    console.error(err.stack || err.message);
    process.exit(1);
  }

  console.log();
  console.log(divider());
  console.log('SMOKE TEST COMPLETE');
  console.log('Check: Sheet row state, agent gmail inbox for [SHADOW DRAFT], message marked read');
  console.log(divider());
}

main();
