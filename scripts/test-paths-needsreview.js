// scripts/test-paths-needsreview.js
//
// Integration test for Path 4 (needs_review) in src/paths.js.
// Exercises pathNeedsReview end-to-end against the mo-test agent and row 2
// of the test Sheet.
//
// WHAT THIS TEST DOES:
//   - Verifies Path 4's HONEST REPORTING CONTRACT.
//   - Runs two scenarios against row 2 of the Sheet.
//   - Scenario A: reply WITH urgent keyword ('lawyer'). Sheet, column L, email,
//     and SMS all attempted. SMS outcome is non-deterministic (Canadian carrier
//     A2P filtering). Both 'delivered' and 'failed' are passing outcomes.
//   - Scenario B: reply WITHOUT urgent keyword. Sheet, column L, email all
//     attempted. SMS must be 'skipped' (keyword gate prevents the send entirely).
//
// SIDE EFFECTS (manual cleanup required after running):
//   - Attempts real SMS to agent phone on Scenario A only (~$0.008).
//   - Sends real email alerts to mo-test's escalationEmail.
//   - Mutates row 2 of the Sheet: status -> 'needs_review', lastActionTimestamp
//     updated, column L appended twice.
//   - To reset: set column G (status) back to 'new', clear column P, clear
//     column L if desired.
//
// Cost: ~$0.008 in Twilio (Scenario A SMS). $0.00 in Claude (no AI calls).
//
// Usage: node scripts/test-paths-needsreview.js

require('dotenv').config();

const { loadAgent } = require('../src/agentConfig');
const { pathNeedsReview, URGENT_KEYWORDS } = require('../src/paths');
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

function assertStringContains(description, str, substring) {
  totalAssertions++;
  const ok = typeof str === 'string' && str.includes(substring);
  if (ok) {
    passed++;
    console.log(`  ✓ ${description}`);
  } else {
    failed++;
    console.log(`  ✗ ${description} -- actual: ${JSON.stringify(str)}`);
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
  console.log('PATH 4 (needs_review) INTEGRATION TEST');
  console.log(divider('='));
  console.log();
  console.log('This test mutates row 2 of the Sheet and sends real email.');
  console.log('SMS fires on Scenario A only (urgent keyword detected).');
  console.log('Estimated cost: ~$0.008 (one SMS in Scenario A).');
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

  assert('URGENT_KEYWORDS has 5 entries', URGENT_KEYWORDS.length, 5);
  assertIncludes('URGENT_KEYWORDS includes "lawyer"', URGENT_KEYWORDS, 'lawyer');
  console.log();

  // --------------------------------------------------------------------------
  // SECTION 2: Find row 2 in the Sheet
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 2: Find row 2 in the Sheet (sanity check)');
  console.log(divider('-'));

  let rows = await email.readSheetRows(agent);
  let row = rows.find((r) => r.rowIndex === 2);

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

  console.log('  Row 2 found:');
  console.log(`    leadId (column A): ${row.leadId}`);
  console.log(`    name   (column B): ${row.name}`);
  console.log(`    status (column G): ${row.status || '(blank)'}`);
  console.log();

  // --------------------------------------------------------------------------
  // SECTION 3: SCENARIO A - needs_review WITH urgent keyword
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SCENARIO A: needs_review with urgent keyword (SMS should be attempted)');
  console.log(divider('-'));

  const msgA = {
    messageId: 'test-message-id-needsreview-a',
    threadId: 'test-thread-id-needsreview-a',
    snippet: "I'm consulting a lawyer about how this whole process has been handled.",
    from: row.leadId,
    subject: 'Re: Your listing inquiry',
  };

  const catA = {
    category: 'needs_review',
    confidence: 0.78,
    reasoning: 'Lead expressed dissatisfaction and mentioned legal consultation. Ambiguous intent: could be venting or could be escalating. Flagging for human review.',
    downgraded: false,
    originalCategory: 'needs_review',
  };

  const resultA = await pathNeedsReview(agent, row, msgA, catA);

  console.log();
  console.log('Result A:');
  console.log(JSON.stringify(resultA, null, 2));
  console.log();
  console.log('Assertions:');

  assert('resultA.ok === true', resultA.ok, true);
  assert('resultA.actions.sheet === true', resultA.actions.sheet, true);

  // Read back the sheet to verify status and column L were actually written.
  rows = await email.readSheetRows(agent);
  row = rows.find((r) => r.rowIndex === 2);
  assert('row status is "needs_review" after Scenario A', row && row.status, 'needs_review');
  assertStringContains(
    'column L contains "needs_review" after Scenario A',
    row && row.conversationHistory,
    'needs_review'
  );
  assertStringContains(
    'column L contains "lawyer" (snippet keyword present in history)',
    row && row.conversationHistory,
    'lawyer'
  );

  assert('resultA.actions.email === "sent"', resultA.actions.email, 'sent');

  // SMS was attempted because 'lawyer' is an urgent keyword. Carrier may deliver
  // or filter. Both are valid outcomes; assert the path reported honestly.
  const smsADelivered = resultA.actions.sms === 'delivered';
  const smsAFailed = resultA.actions.sms === 'failed';
  const smsAHonest = smsADelivered || smsAFailed;
  assert('resultA.actions.sms is "delivered" or "failed" (not skipped, not undefined)', smsAHonest, true);
  if (smsADelivered) {
    console.log('  [info] SMS delivered (carrier accepted this one)');
  } else if (smsAFailed) {
    console.log('  [info] SMS failed (carrier filtered or Twilio error, see errors array)');
  }
  console.log();

  // --------------------------------------------------------------------------
  // SECTION 4: SCENARIO B - needs_review WITHOUT urgent keyword
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SCENARIO B: needs_review without urgent keyword (SMS must be skipped)');
  console.log(divider('-'));

  const msgB = {
    messageId: 'test-message-id-needsreview-b',
    threadId: 'test-thread-id-needsreview-b',
    snippet: "I'm not really sure what to do next, this is all a lot to process and we have some family stuff going on.",
    from: row.leadId,
    subject: 'Re: Your listing inquiry',
  };

  const catB = {
    category: 'needs_review',
    confidence: 0.72,
    reasoning: 'Lead sounds overwhelmed and uncertain. No clear action requested and no urgency signals. Flagging for human review to avoid sending a tone-deaf AI reply.',
    downgraded: false,
    originalCategory: 'needs_review',
  };

  const resultB = await pathNeedsReview(agent, row, msgB, catB);

  console.log();
  console.log('Result B:');
  console.log(JSON.stringify(resultB, null, 2));
  console.log();
  console.log('Assertions:');

  assert('resultB.ok === true', resultB.ok, true);
  assert('resultB.actions.sheet === true', resultB.actions.sheet, true);

  // Read back the sheet to verify status and column L.
  rows = await email.readSheetRows(agent);
  row = rows.find((r) => r.rowIndex === 2);
  assert('row status is "needs_review" after Scenario B', row && row.status, 'needs_review');
  assertStringContains(
    'column L contains "family stuff" (Scenario B snippet in history)',
    row && row.conversationHistory,
    'family stuff'
  );

  assert('resultB.actions.email === "sent"', resultB.actions.email, 'sent');
  assert('resultB.actions.sms === "skipped"', resultB.actions.sms, 'skipped');
  assertIncludes('resultB.skipped includes "no_urgent_keyword"', resultB.skipped, 'no_urgent_keyword');
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
  console.log('  Row 2 has been mutated (status -> needs_review, lastActionTimestamp updated, column L appended).');
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
