// scripts/test-paths-askagent.js
//
// Integration test for Path 1B initiation (answer_property_specific) in src/paths.js.
// Exercises pathAskAgent end-to-end against the mo-test agent and row 2 of the test Sheet.
//
// WHAT THIS TEST DOES:
//   - Scenario A: high-confidence categorization. Verifies Sheet update (awaiting_agent),
//     pendingQuestion written to column M, email sent to escalationEmail, SMS attempted,
//     and that no [SHADOW DRAFT] email was produced (Path 1B sends nothing to the lead).
//   - Scenario B: low-confidence categorization (0.62). Verifies the SMS still fires at
//     low confidence because Path 1B has NO confidence gate on SMS.
//
// SIDE EFFECTS (manual cleanup required after running):
//   - Sends real email alerts to mo-test's escalationEmail.
//   - Attempts real SMS to agent phone on both scenarios.
//   - Mutates row 2 of the Sheet: status -> 'awaiting_agent', column M and column L
//     written twice, lastActionTimestamp updated.
//   - To reset: set column G (status) back to 'new', clear column M, clear column P,
//     clear column L if desired.
//
// Cost: ~$0 in Claude (no drafting). ~$0.008 per Twilio SMS (2 sends). Total ~$0.016.
//
// Usage: node scripts/test-paths-askagent.js

require('dotenv').config();

const { loadAgent } = require('../src/agentConfig');
const { pathAskAgent } = require('../src/paths');
const email = require('../src/email');

function divider(char = '=', length = 80) {
  return char.repeat(length);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    console.log(`  ✗ ${description} -- actual: ${JSON.stringify(typeof str === 'string' ? str.slice(0, 200) : str)}`);
  }
}

function assertStringStartsWith(description, str, prefix) {
  totalAssertions++;
  const ok = typeof str === 'string' && str.startsWith(prefix);
  if (ok) {
    passed++;
    console.log(`  ✓ ${description}`);
  } else {
    failed++;
    console.log(`  ✗ ${description} -- actual: ${JSON.stringify(typeof str === 'string' ? str.slice(0, 80) : str)}`);
  }
}

async function main() {
  console.log(divider('='));
  console.log('PATH 1B INITIATION (answer_property_specific) INTEGRATION TEST');
  console.log(divider('='));
  console.log();
  console.log('This test mutates row 2 of the Sheet and sends real emails and SMS.');
  console.log('Scenario A: high-confidence (0.91). SMS fires.');
  console.log('Scenario B: low-confidence (0.62). SMS still fires (no confidence gate on this path).');
  console.log('Estimated cost: ~$0.016 in Twilio (2 SMS sends). $0 in Claude.');
  console.log();

  // --------------------------------------------------------------------------
  // SECTION 1: Environment + agent config check
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 1: Environment + agent config check');
  console.log(divider('-'));

  const requiredEnvVars = [
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
  console.log(`  ✓ escalationEmail: ${agent.escalationEmail}`);
  console.log(`  ✓ googleSheetId: ${agent.googleSheetId}`);
  console.log(`  ✓ mode: ${agent.mode}`);
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
  // SECTION 3: SCENARIO A - high confidence
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SCENARIO A: answer_property_specific, confidence 0.91');
  console.log(divider('-'));

  const snippetA = 'How flexible is the seller on the asking price for this listing?';

  const msgA = {
    messageId: 'test-message-id-askagent-a',
    threadId: null,
    snippet: snippetA,
    from: row.leadId,
    subject: 'Re: Your listing inquiry',
  };

  const catA = {
    category: 'answer_property_specific',
    confidence: 0.91,
    reasoning: 'Lead asked about seller flexibility on a specific listing. Requires agent knowledge to answer.',
    downgraded: false,
    originalCategory: 'answer_property_specific',
  };

  const resultA = await pathAskAgent(agent, row, msgA, catA);

  console.log();
  console.log('Result A:');
  console.log(JSON.stringify(resultA, null, 2));
  console.log();
  console.log('Assertions:');

  assert('resultA.ok === true', resultA.ok, true);
  assert('resultA.actions.sheet === "updated"', resultA.actions.sheet, 'updated');
  assert('resultA.actions.leadEmail === "not_sent_intentional"', resultA.actions.leadEmail, 'not_sent_intentional');
  assert('resultA.actions.email === "sent"', resultA.actions.email, 'sent');

  const smsAValid = resultA.actions.sms === 'delivered' || resultA.actions.sms === 'failed';
  assert('resultA.actions.sms is "delivered" or "failed" (not skipped, not undefined)', smsAValid, true);
  if (resultA.actions.sms === 'delivered') {
    console.log('  [info] SMS delivered');
  } else {
    console.log('  [info] SMS failed (carrier filtered or Twilio error, see errors array)');
  }

  // Read back the Sheet to verify actual writes.
  rows = await email.readSheetRows(agent);
  row = rows.find((r) => r.rowIndex === 2);

  assert('row status is "awaiting_agent" after Scenario A', row && row.status, 'awaiting_agent');
  assert(
    'column M (pendingQuestion) contains the exact lead snippet',
    row && row.pendingQuestion,
    snippetA
  );
  assertStringContains(
    'column L contains "answer_property_specific"',
    row && row.conversationHistory,
    'answer_property_specific'
  );
  assertStringContains(
    'column L contains "Question captured:"',
    row && row.conversationHistory,
    'Question captured:'
  );

  // Verify via Gmail: [LEAD QUESTION] email sent to escalationEmail.
  console.log('  [searching Gmail for [LEAD QUESTION] email...]');
  await sleep(2000);

  const leadQuestionMsgs = await email.searchEmails(agent, 'subject:"[LEAD QUESTION]" in:sent');
  const recentLeadQuestion = leadQuestionMsgs.find((m) => {
    if (!m.receivedAt) return false;
    const age = Date.now() - new Date(m.receivedAt).getTime();
    return age < 3 * 60 * 1000;
  });

  totalAssertions++;
  if (recentLeadQuestion) {
    passed++;
    console.log('  ✓ Gmail found [LEAD QUESTION] email sent within last 3 minutes');
  } else {
    failed++;
    console.log(`  ✗ Gmail did not find a recent [LEAD QUESTION] email (found ${leadQuestionMsgs.length} total, none recent)`);
  }

  if (recentLeadQuestion) {
    assertStringStartsWith(
      '[LEAD QUESTION] email subject starts with "[LEAD QUESTION]"',
      recentLeadQuestion.subject,
      '[LEAD QUESTION]'
    );
  } else {
    console.log('  [skipping subject assertion: no recent [LEAD QUESTION] email found]');
    totalAssertions += 1;
    failed += 1;
  }

  // Verify that this path did NOT produce a [SHADOW DRAFT] email.
  // Search within the last 60 seconds. Path 1B never wraps drafts, so none should exist.
  const shadowMsgs = await email.searchEmails(agent, 'subject:"[SHADOW DRAFT]" in:sent');
  const recentShadow = shadowMsgs.find((m) => {
    if (!m.receivedAt) return false;
    const age = Date.now() - new Date(m.receivedAt).getTime();
    return age < 60 * 1000;
  });

  totalAssertions++;
  if (!recentShadow) {
    passed++;
    console.log('  ✓ No [SHADOW DRAFT] email produced by this path (correct: Path 1B has no lead-facing draft)');
  } else {
    failed++;
    console.log('  ✗ Unexpected [SHADOW DRAFT] email found within last 60 seconds -- Path 1B should not produce shadow drafts');
  }

  // Restore column M to empty so subsequent runs start clean.
  console.log();
  console.log('  [restoring column M (pendingQuestion) to empty]');
  await email.updateSheetRow(agent, row.rowIndex, { pendingQuestion: '' });
  console.log();

  // --------------------------------------------------------------------------
  // SECTION 4: SCENARIO B - low confidence, SMS must still fire
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SCENARIO B: answer_property_specific, confidence 0.62 (no SMS gate on this path)');
  console.log(divider('-'));

  // Re-read row so we have the current state.
  rows = await email.readSheetRows(agent);
  row = rows.find((r) => r.rowIndex === 2);

  const snippetB = 'Wondering about a few things on this place if you have time';

  const msgB = {
    messageId: 'test-message-id-askagent-b',
    threadId: null,
    snippet: snippetB,
    from: row.leadId,
    subject: 'Re: Your listing inquiry',
  };

  const catB = {
    category: 'answer_property_specific',
    confidence: 0.62,
    reasoning: 'Vague reference to a property but unclear what specifically the lead wants to know.',
    downgraded: false,
    originalCategory: 'answer_property_specific',
  };

  const resultB = await pathAskAgent(agent, row, msgB, catB);

  console.log();
  console.log('Result B:');
  console.log(JSON.stringify(resultB, null, 2));
  console.log();
  console.log('Assertions:');

  assert('resultB.ok === true', resultB.ok, true);
  assert('resultB.actions.sheet === "updated"', resultB.actions.sheet, 'updated');
  assert('resultB.actions.leadEmail === "not_sent_intentional"', resultB.actions.leadEmail, 'not_sent_intentional');
  assert('resultB.actions.email === "sent"', resultB.actions.email, 'sent');

  // Key assertion: SMS must be 'delivered' or 'failed', NOT 'skipped'.
  // Path 1B has no confidence gate, so SMS fires at any confidence level.
  const smsBDelivered = resultB.actions.sms === 'delivered';
  const smsBFailed = resultB.actions.sms === 'failed';
  const smsBFired = smsBDelivered || smsBFailed;
  assert('resultB.actions.sms is "delivered" or "failed" (NOT skipped, even at low confidence)', smsBFired, true);
  if (smsBDelivered) {
    console.log('  [info] SMS delivered (carrier accepted this one)');
  } else if (smsBFailed) {
    console.log('  [info] SMS failed (carrier filtered or Twilio error, see errors array)');
  }

  // Read back the Sheet to verify actual writes.
  rows = await email.readSheetRows(agent);
  row = rows.find((r) => r.rowIndex === 2);

  assert('row status is "awaiting_agent" after Scenario B', row && row.status, 'awaiting_agent');
  assert(
    'column M (pendingQuestion) contains the Scenario B snippet',
    row && row.pendingQuestion,
    snippetB
  );

  // Restore column M to empty after assertions.
  console.log();
  console.log('  [restoring column M (pendingQuestion) to empty]');
  await email.updateSheetRow(agent, row.rowIndex, { pendingQuestion: '' });
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
  console.log('  Row 2 has been mutated (status -> awaiting_agent, column L appended, lastActionTimestamp updated).');
  console.log('  Column M (pendingQuestion) was restored to empty by the test.');
  console.log('  To fully reset for future tests, manually edit row 2 in the Sheet:');
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
