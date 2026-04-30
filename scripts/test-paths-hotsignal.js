// scripts/test-paths-hotsignal.js
//
// Integration test for Path 2 (hot_signal) in src/paths.js.
// Exercises pathHotSignal end-to-end against the mo-test agent and row 2
// of the test Sheet.
//
// WHAT THIS TEST DOES:
//   - Verifies Path 2's HONEST REPORTING CONTRACT, not carrier delivery outcome.
//   - Runs two scenarios against row 2 of the Sheet.
//   - Scenario A: high-confidence (0.95). SMS is attempted. Carrier delivery is
//     probabilistic for unregistered Canadian A2P traffic (Bell/Rogers/Telus may
//     filter with errorCode 30044). Both outcomes (delivered or filtered) are
//     passing results for this test. Once Twilio A2P registration is complete,
//     SMS should deliver consistently.
//   - Scenario B: below-threshold (0.78): expects sheet + columnL + email, SMS skipped.
//
// SIDE EFFECTS (manual cleanup required after running):
//   - Attempts real SMS to agent phone (~$0.008 per scenario, ~$0.016 total).
//   - Sends real email alerts to mo-test's gmailAddress.
//   - Mutates row 2 of the Sheet: status -> 'HOT', lastActionTimestamp updated,
//     column L appended twice.
//   - To reset: set row 2 status back to 'new' and clear columns P and L manually.
//
// Usage: node scripts/test-paths-hotsignal.js

require('dotenv').config();

const { loadAgent } = require('../src/agentConfig');
const { pathHotSignal, HOT_SMS_CONFIDENCE_THRESHOLD } = require('../src/paths');
const email = require('../src/email');

function divider(char = '=', length = 80) {
  return char.repeat(length);
}

let totalAssertions = 0;
let passed = 0;
let failed = 0;

function assert(description, actual, expected) {
  totalAssertions++;
  const ok = actual === expected;
  if (ok) {
    passed++;
    console.log(`  ✓ ${description}`);
  } else {
    failed++;
    console.log(`  ✗ ${description} -- actual: ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(description, arr, value) {
  totalAssertions++;
  const ok = Array.isArray(arr) && arr.includes(value);
  if (ok) {
    passed++;
    console.log(`  ✓ ${description}`);
  } else {
    failed++;
    console.log(`  ✗ ${description} -- actual array: ${JSON.stringify(arr)}`);
  }
}

function assertNotIncludes(description, arr, value) {
  totalAssertions++;
  const ok = Array.isArray(arr) && !arr.includes(value);
  if (ok) {
    passed++;
    console.log(`  ✓ ${description}`);
  } else {
    failed++;
    console.log(`  ✗ ${description} -- actual array: ${JSON.stringify(arr)}`);
  }
}

function assertEmptyArray(description, arr) {
  totalAssertions++;
  const ok = Array.isArray(arr) && arr.length === 0;
  if (ok) {
    passed++;
    console.log(`  ✓ ${description}`);
  } else {
    failed++;
    console.log(`  ✗ ${description} -- actual: ${JSON.stringify(arr)}`);
  }
}

async function main() {
  console.log(divider('='));
  console.log('PATH 2 (hot_signal) INTEGRATION TEST');
  console.log(divider('='));
  console.log();
  console.log('This test mutates row 2 of the Sheet and sends real SMS + email.');
  console.log(`SMS fires on Scenario A (confidence 0.95 >= threshold ${HOT_SMS_CONFIDENCE_THRESHOLD}).`);
  console.log(`SMS skipped on Scenario B (confidence 0.78 < threshold ${HOT_SMS_CONFIDENCE_THRESHOLD}).`);
  console.log('Estimated cost: ~$0.016 (two SMS messages).');
  console.log();

  // --------------------------------------------------------------------------
  // SECTION 1: Environment + agent config check
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 1: Environment + agent config check');
  console.log(divider('-'));

  const requiredEnvVars = [
    'ANTHROPIC_API_KEY',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_NUMBER',
  ];
  let envOk = true;
  for (const key of requiredEnvVars) {
    if (process.env[key]) {
      console.log(`  ✓ ${key} is set`);
    } else {
      console.log(`  ✗ ${key} is NOT set`);
      envOk = false;
    }
  }
  if (!envOk) {
    console.error('\nABORTED: Missing required environment variables. Check .env.');
    process.exit(1);
  }

  const agent = loadAgent('mo-test');
  console.log();
  console.log('Agent config (googleRefreshToken redacted):');
  console.log(JSON.stringify(
    agent,
    (k, v) => k === 'googleRefreshToken' ? '[REDACTED]' : v,
    2
  ));
  console.log();

  if (!agent.agentPhone) {
    console.error('ABORTED: agent.agentPhone is not set.');
    process.exit(1);
  }
  if (!agent.gmailAddress) {
    console.error('ABORTED: agent.gmailAddress is not set.');
    process.exit(1);
  }
  if (!agent.googleSheetId) {
    console.error('ABORTED: agent.googleSheetId is not set.');
    process.exit(1);
  }
  console.log(`  ✓ agentPhone: ${agent.agentPhone}`);
  console.log(`  ✓ gmailAddress: ${agent.gmailAddress}`);
  console.log(`  ✓ googleSheetId: ${agent.googleSheetId}`);
  console.log();

  assert(
    `HOT_SMS_CONFIDENCE_THRESHOLD === 0.85`,
    HOT_SMS_CONFIDENCE_THRESHOLD,
    0.85
  );
  console.log();

  // --------------------------------------------------------------------------
  // SECTION 2: Find row 2 in the Sheet
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 2: Find row 2 in the Sheet (sanity check)');
  console.log(divider('-'));

  const rows = await email.readSheetRows(agent);
  const row = rows.find((r) => r.rowIndex === 2);

  if (!row) {
    console.error('ABORTED: Row 2 not found in the Sheet. Add a lead to row 2 before running this test.');
    process.exit(1);
  }
  if (!row.leadId) {
    console.error('ABORTED: Row 2 has no leadId (column A). Fill in a valid email address first.');
    process.exit(1);
  }
  if (!row.name) {
    console.error('ABORTED: Row 2 has no name (column B). Fill in a lead name first.');
    process.exit(1);
  }

  console.log(`  Row 2 found:`);
  console.log(`    leadId (column A): ${row.leadId}`);
  console.log(`    name   (column B): ${row.name}`);
  console.log(`    status (column G): ${row.status || '(blank)'}`);
  console.log();

  // --------------------------------------------------------------------------
  // SECTION 3: SCENARIO A - high-confidence (SMS should fire)
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SCENARIO A: high-confidence hot_signal (expect SMS to fire)');
  console.log(divider('-'));

  const msgA = {
    messageId: 'test-message-id-a',
    threadId: 'test-thread-id-a',
    snippet: 'I want to book a showing this weekend! Can we do Saturday afternoon? I am ready to make an offer if it is the right fit.',
    from: row.leadId,
    subject: 'Re: Looking at the Yorkville place',
  };

  const catA = {
    category: 'hot_signal',
    confidence: 0.95,
    reasoning: 'Lead explicitly requests a showing this weekend and mentions readiness to make an offer. Clear action intent with concrete timing.',
    downgraded: false,
    originalCategory: 'hot_signal',
  };

  const resultA = await pathHotSignal(agent, row, msgA, catA);

  console.log();
  console.log('Result A:');
  console.log(JSON.stringify(resultA, null, 2));
  console.log();
  console.log('Assertions:');

  assert('resultA.ok === true', resultA.ok, true);
  assertIncludes('resultA.actions includes "sheet"', resultA.actions, 'sheet');
  assertIncludes('resultA.actions includes "columnL"', resultA.actions, 'columnL');
  assertIncludes('resultA.actions includes "email"', resultA.actions, 'email');
  assertEmptyArray('resultA.skipped is empty (confidence was high, SMS was attempted not skipped)', resultA.skipped);

  // SMS was attempted. Carrier may deliver or filter (Canadian A2P, errorCode 30044).
  // Both are valid outcomes. Assert the path reported honestly: exactly one of
  // (actions includes "sms") or (errors contains step="sms") must be true.
  const smsDelivered = resultA.actions.includes('sms');
  const smsFailed = Array.isArray(resultA.errors) && resultA.errors.some((e) => e.step === 'sms');
  const smsAttemptedHonestly = (smsDelivered && !smsFailed) || (!smsDelivered && smsFailed);
  assert('SMS step was attempted and reported honestly (delivered XOR errors.step="sms")', smsAttemptedHonestly, true);
  if (smsDelivered) {
    console.log('  [info] SMS delivered (carrier accepted this one)');
  } else if (smsFailed) {
    console.log('  [info] SMS filtered by carrier (errorCode in errors). This is expected for unregistered Canadian SMS until A2P registration is complete.');
  }
  console.log();

  // --------------------------------------------------------------------------
  // SECTION 4: SCENARIO B - below-threshold (SMS should be skipped)
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SCENARIO B: below-threshold hot_signal (expect SMS to be skipped)');
  console.log(divider('-'));

  const msgB = {
    messageId: 'test-message-id-b',
    threadId: 'test-thread-id-b',
    snippet: 'I want to book a showing this weekend! Can we do Saturday afternoon? I am ready to make an offer if it is the right fit.',
    from: row.leadId,
    subject: 'Re: Looking at the Yorkville place',
  };

  const catB = {
    category: 'hot_signal',
    confidence: 0.78,
    reasoning: 'Lead asks "are you free this weekend" which suggests interest, but the language is not concrete. Could be exploratory.',
    downgraded: false,
    originalCategory: 'hot_signal',
  };

  const resultB = await pathHotSignal(agent, row, msgB, catB);

  console.log();
  console.log('Result B:');
  console.log(JSON.stringify(resultB, null, 2));
  console.log();
  console.log('Assertions:');

  assert('resultB.ok === true', resultB.ok, true);
  assertIncludes('resultB.actions includes "sheet"', resultB.actions, 'sheet');
  assertIncludes('resultB.actions includes "columnL"', resultB.actions, 'columnL');
  assertIncludes('resultB.actions includes "email"', resultB.actions, 'email');
  assertNotIncludes('resultB.actions does NOT include "sms"', resultB.actions, 'sms');
  assertIncludes('resultB.skipped includes "sms_below_threshold"', resultB.skipped, 'sms_below_threshold');
  assertEmptyArray('resultB.errors is empty', resultB.errors);
  console.log();

  // --------------------------------------------------------------------------
  // SECTION 5: Test summary
  // --------------------------------------------------------------------------
  console.log(divider('='));
  console.log('TEST SUMMARY');
  console.log(divider('='));
  console.log(`Total assertions: ${totalAssertions}`);
  console.log(`Passed:           ${passed}`);
  console.log(`Failed:           ${failed}`);
  console.log();

  if (failed === 0) {
    console.log('All assertions passed.');
  } else {
    console.log(`${failed} assertion(s) failed. Review output above.`);
  }

  console.log();
  console.log('CLEANUP REMINDER:');
  console.log('  Row 2 has been mutated (status -> HOT, lastActionTimestamp updated, column L appended).');
  console.log('  To reset for future tests, manually edit row 2 in the Sheet:');
  console.log('    - Set column G (status) back to "new"');
  console.log('    - Clear column P (lastActionTimestamp)');
  console.log('    - Clear column L (conversationHistory) if desired');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nTest script crashed:');
  console.error(err);
  process.exit(1);
});
