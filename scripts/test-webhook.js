// scripts/test-webhook.js
//
// Integration test for the Path 1B webhook handler (handleAgentReply) in src/webhook.js.
// Calls handleAgentReply directly, bypassing Express, Twilio signature verification,
// and idempotency. Those layers are tested separately with live ngrok.
//
// SCENARIOS:
//   A: Path Alpha success, queue empties, status -> warm
//   B: Path Alpha success, queue has remaining entries, status -> awaiting_agent
//   C: Path Beta - unrecognized token, Sheet unchanged
//   D: Path Gamma - no token, Sheet unchanged
//   E: Path Gamma - multi-token, Sheet unchanged
//   F: empty queue, bad token, Sheet unchanged
//
// EXPECTED SIDE EFFECTS:
//   Mo's phone:           4 SMS messages
//     Scenario C: bad-token suggestion (Q9 listed)
//     Scenario D: no-token suggestion (Q12 listed)
//     Scenario E: multi-token suggestion (Q12 listed)
//     Scenario F: bad-token suggestion with empty queue
//   Mo's gmailAddress inbox: 2 SHADOW DRAFT emails (Scenarios A and B)
//   Verify manually after the test completes.
//
// Cost: ~$0.01 in Claude (2 draft calls). ~$0.032 in Twilio (4 SMS).
//
// Usage: node scripts/test-webhook.js

require('dotenv').config();

const { loadAgent } = require('../src/agentConfig');
const emailModule = require('../src/email');
const { handleAgentReply } = require('../src/webhook');
const { parsePendingQuestions } = require('../src/pendingQuestions');

const TEST_ROW_INDEX = 7;
const AGENT_ID = 'mo-test';

function divider(char, length) {
  char = char || '=';
  length = length || 80;
  return char.repeat(length);
}

// ---------------------------------------------------------------------------
// Pass/fail counters
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    passed++;
    console.log('[PASS] ' + label);
  } else {
    failed++;
    console.log('[FAIL] ' + label);
  }
}

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------

async function getRow7(agent) {
  const rows = await emailModule.readSheetRows(agent);
  return rows.find((r) => r.rowIndex === TEST_ROW_INDEX);
}

async function setupRow7(agent, options) {
  const pendingQuestion = (options && options.pendingQuestion !== undefined) ? options.pendingQuestion : '';
  const status = (options && options.status !== undefined) ? options.status : '';
  const lastActionTimestamp = (options && options.lastActionTimestamp !== undefined) ? options.lastActionTimestamp : '';
  await emailModule.updateSheetRow(agent, TEST_ROW_INDEX, {
    pendingQuestion,
    status,
    lastActionTimestamp,
  });
}

async function clearRow7(agent) {
  await emailModule.updateSheetRow(agent, TEST_ROW_INDEX, {
    pendingQuestion: '',
    status: '',
    lastActionTimestamp: '',
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(divider('='));
  console.log('WEBHOOK HANDLER (handleAgentReply) INTEGRATION TEST');
  console.log(divider('='));
  console.log();
  console.log('EXPECTED SIDE EFFECTS during this test:');
  console.log("  Mo's phone: 4 SMS messages");
  console.log('    Scenario C: bad-token suggestion SMS (Q9 listed as open)');
  console.log('    Scenario D: no-token suggestion SMS (Q12 listed as open)');
  console.log('    Scenario E: multi-token suggestion SMS (Q12 listed as open)');
  console.log('    Scenario F: bad-token suggestion SMS with empty queue');
  console.log("  Mo's gmailAddress inbox: 2 SHADOW DRAFT emails (Scenarios A and B)");
  console.log('  After test completes, manually verify these arrived.');
  console.log();

  // --------------------------------------------------------------------------
  // Pre-flight: env vars + agent config + row sanity
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('PRE-FLIGHT: environment + agent config + row ' + TEST_ROW_INDEX);
  console.log(divider('-'));

  const requiredEnvVars = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_NUMBER',
    'ANTHROPIC_API_KEY',
  ];
  let envOk = true;
  for (const key of requiredEnvVars) {
    if (process.env[key]) {
      console.log('  [ok] ' + key + ' is set');
    } else {
      console.log('  [missing] ' + key + ' is NOT set');
      envOk = false;
    }
  }
  if (!envOk) {
    console.error('\nABORTED: missing required environment variables. Check .env.');
    process.exit(1);
  }

  const agent = loadAgent(AGENT_ID);
  console.log();
  console.log('Agent config (googleRefreshToken redacted):');
  console.log(JSON.stringify(agent, function (k, v) {
    return k === 'googleRefreshToken' ? '[REDACTED]' : v;
  }, 2));
  console.log();

  if (!agent.agentPhone) {
    console.error('ABORTED: agent.agentPhone not set.');
    process.exit(1);
  }
  if (!agent.gmailAddress) {
    console.error('ABORTED: agent.gmailAddress not set.');
    process.exit(1);
  }
  if (!agent.googleSheetId) {
    console.error('ABORTED: agent.googleSheetId not set.');
    process.exit(1);
  }

  console.log('  [ok] agentPhone:   ' + agent.agentPhone);
  console.log('  [ok] gmailAddress: ' + agent.gmailAddress);
  console.log('  [ok] mode:         ' + agent.mode);
  console.log();

  const preflightRow = await getRow7(agent);
  if (!preflightRow) {
    console.error('ABORTED: row ' + TEST_ROW_INDEX + ' not found in Sheet. Add a lead to that row first.');
    process.exit(1);
  }
  if (!preflightRow.leadId) {
    console.error('ABORTED: row ' + TEST_ROW_INDEX + ' has no leadId (column A). Fill it in first.');
    process.exit(1);
  }
  if (!preflightRow.name) {
    console.error('ABORTED: row ' + TEST_ROW_INDEX + ' has no name (column B). Fill it in first.');
    process.exit(1);
  }

  console.log('  Row ' + TEST_ROW_INDEX + ' found:');
  console.log('    leadId (column A): ' + preflightRow.leadId);
  console.log('    name   (column B): ' + preflightRow.name);
  console.log('    status (column G): ' + (preflightRow.status || '(blank)'));
  console.log();

  // --------------------------------------------------------------------------
  // SCENARIO A: Path Alpha, queue empties -> status warm
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SCENARIO A: Path Alpha success, queue empties to warm');
  console.log(divider('-'));

  await setupRow7(agent, {
    pendingQuestion: '[Q1] What is the square footage of the Annex listing?',
    status: 'awaiting_agent',
    lastActionTimestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  });
  const rowAStart = await getRow7(agent);
  const lenA_before = (rowAStart && rowAStart.conversationHistory) ? rowAStart.conversationHistory.length : 0;

  try {
    await handleAgentReply(agent, 'Q1 1850 sqft, 3 bedrooms 2 bath', 'SM-test-A', 'single', 'Q1');

    const rowA = await getRow7(agent);

    check('A: pendingQuestion is empty', rowA && rowA.pendingQuestion === '');
    check('A: status === "warm"', rowA && rowA.status === 'warm');

    const tsA = rowA ? new Date(rowA.lastActionTimestamp) : null;
    const ageA = tsA ? Date.now() - tsA.getTime() : Infinity;
    check('A: lastActionTimestamp is recent (within 60s)', !isNaN(ageA) && ageA < 60000);

    const lenA_after = (rowA && rowA.conversationHistory) ? rowA.conversationHistory.length : 0;
    check('A: conversationHistory grew (Path 1B entry appended)', lenA_after > lenA_before);
  } finally {
    await clearRow7(agent);
    console.log('  [cleared row ' + TEST_ROW_INDEX + ']');
  }

  console.log();

  // --------------------------------------------------------------------------
  // SCENARIO B: Path Alpha, queue has remaining entries -> awaiting_agent
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SCENARIO B: Path Alpha success, queue has remaining entries');
  console.log(divider('-'));

  await setupRow7(agent, {
    pendingQuestion: '[Q5] question one || [Q6] question two',
    status: 'awaiting_agent',
    lastActionTimestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  });
  const rowBStart = await getRow7(agent);
  const lenB_before = (rowBStart && rowBStart.conversationHistory) ? rowBStart.conversationHistory.length : 0;

  try {
    await handleAgentReply(agent, 'Q5 here is the answer to question one', 'SM-test-B', 'single', 'Q5');

    const rowB = await getRow7(agent);

    check('B: pendingQuestion is non-empty', rowB && rowB.pendingQuestion !== '');

    const entriesB = parsePendingQuestions(rowB ? rowB.pendingQuestion : '');
    check('B: queue parses to 1 remaining entry', entriesB.length === 1);
    check('B: remaining entry token === "Q6"', entriesB[0] && entriesB[0].token === 'Q6');
    check('B: remaining entry question === "question two"', entriesB[0] && entriesB[0].question === 'question two');

    check('B: status === "awaiting_agent"', rowB && rowB.status === 'awaiting_agent');

    const tsB = rowB ? new Date(rowB.lastActionTimestamp) : null;
    const ageB = tsB ? Date.now() - tsB.getTime() : Infinity;
    check('B: lastActionTimestamp is recent (within 60s)', !isNaN(ageB) && ageB < 60000);

    const lenB_after = (rowB && rowB.conversationHistory) ? rowB.conversationHistory.length : 0;
    check('B: conversationHistory grew (Path 1B entry appended)', lenB_after > lenB_before);
  } finally {
    await clearRow7(agent);
    console.log('  [cleared row ' + TEST_ROW_INDEX + ']');
  }

  console.log();

  // --------------------------------------------------------------------------
  // SCENARIO C: Path Beta - unrecognized token, Sheet unchanged
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SCENARIO C: Path Beta - unrecognized token, Sheet unchanged');
  console.log(divider('-'));

  await setupRow7(agent, {
    pendingQuestion: '[Q9] real pending question',
    status: 'awaiting_agent',
    lastActionTimestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  });
  const rowCBefore = await getRow7(agent);
  const tsSnapshotC = rowCBefore ? rowCBefore.lastActionTimestamp : '';

  try {
    await handleAgentReply(agent, 'Q99 wrong token answer', 'SM-test-C', 'single', 'Q99');

    const rowC = await getRow7(agent);

    check(
      'C: pendingQuestion unchanged',
      rowC && rowC.pendingQuestion === '[Q9] real pending question'
    );
    check('C: status unchanged (awaiting_agent)', rowC && rowC.status === 'awaiting_agent');
    check(
      'C: lastActionTimestamp unchanged',
      rowC && rowC.lastActionTimestamp === tsSnapshotC
    );
  } finally {
    await clearRow7(agent);
    console.log('  [cleared row ' + TEST_ROW_INDEX + ']');
  }

  console.log();

  // --------------------------------------------------------------------------
  // SCENARIO D: Path Gamma - no token, Sheet unchanged
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SCENARIO D: Path Gamma - no token, Sheet unchanged');
  console.log(divider('-'));

  await setupRow7(agent, {
    pendingQuestion: '[Q12] some question',
    status: 'awaiting_agent',
    lastActionTimestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  });
  const rowDBefore = await getRow7(agent);
  const tsSnapshotD = rowDBefore ? rowDBefore.lastActionTimestamp : '';

  try {
    await handleAgentReply(agent, 'just some random text without any token', 'SM-test-D', 'none', null);

    const rowD = await getRow7(agent);

    check('D: pendingQuestion unchanged', rowD && rowD.pendingQuestion === '[Q12] some question');
    check('D: status unchanged (awaiting_agent)', rowD && rowD.status === 'awaiting_agent');
    check(
      'D: lastActionTimestamp unchanged',
      rowD && rowD.lastActionTimestamp === tsSnapshotD
    );
  } finally {
    await clearRow7(agent);
    console.log('  [cleared row ' + TEST_ROW_INDEX + ']');
  }

  console.log();

  // --------------------------------------------------------------------------
  // SCENARIO E: Path Gamma - multi-token, Sheet unchanged
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SCENARIO E: Path Gamma - multi-token, Sheet unchanged');
  console.log(divider('-'));

  await setupRow7(agent, {
    pendingQuestion: '[Q12] some question',
    status: 'awaiting_agent',
    lastActionTimestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  });
  const rowEBefore = await getRow7(agent);
  const tsSnapshotE = rowEBefore ? rowEBefore.lastActionTimestamp : '';

  try {
    await handleAgentReply(agent, 'Q12 Q13 stacked answer', 'SM-test-E', 'multi', null);

    const rowE = await getRow7(agent);

    check('E: pendingQuestion unchanged', rowE && rowE.pendingQuestion === '[Q12] some question');
    check('E: status unchanged (awaiting_agent)', rowE && rowE.status === 'awaiting_agent');
    check(
      'E: lastActionTimestamp unchanged',
      rowE && rowE.lastActionTimestamp === tsSnapshotE
    );
  } finally {
    await clearRow7(agent);
    console.log('  [cleared row ' + TEST_ROW_INDEX + ']');
  }

  console.log();

  // --------------------------------------------------------------------------
  // SCENARIO F: empty queue, bad token, Sheet unchanged
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SCENARIO F: empty queue, bad token, Sheet unchanged');
  console.log(divider('-'));

  await setupRow7(agent, {
    pendingQuestion: '',
    status: '',
    lastActionTimestamp: '',
  });

  try {
    await handleAgentReply(agent, 'Q47 answer to a stale token', 'SM-test-F', 'single', 'Q47');

    const rowF = await getRow7(agent);

    check('F: pendingQuestion still empty', rowF && rowF.pendingQuestion === '');
    check('F: status still empty', rowF && rowF.status === '');
  } finally {
    await clearRow7(agent);
    console.log('  [cleared row ' + TEST_ROW_INDEX + ']');
  }

  console.log();

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log(divider('='));
  console.log('TEST SUMMARY');
  console.log(divider('='));
  console.log('Total: ' + passed + ' passed, ' + failed + ' failed');
  console.log();

  if (failed === 0) {
    console.log('All checks passed.');
  } else {
    console.log(failed + ' check(s) failed. Review output above.');
  }

  console.log();
  console.log('REMINDER: verify side effects manually:');
  console.log("  Mo's phone: 4 SMS (Scenarios C, D, E, F)");
  console.log("  Mo's inbox: 2 SHADOW DRAFT emails (Scenarios A, B)");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\nTest script crashed:');
  console.error(err);
  process.exit(1);
});
