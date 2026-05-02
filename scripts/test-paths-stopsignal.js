// scripts/test-paths-stopsignal.js
//
// Integration test for Path 3 (stop_signal) in src/paths.js.
// Exercises pathStopSignal end-to-end against the mo-test agent and row 2
// of the test Sheet.
//
// WHAT THIS TEST DOES:
//   - Runs two scenarios against row 2 of the Sheet.
//   - Scenario A: shadow mode (mo-test default). Draft goes to agent, NOT lead.
//     Verifies sheet update, column L, shadow email delivery, and that the
//     email body contains the shadow preamble with no em-dashes.
//   - Scenario B: live mode (agent.mode overridden in memory only, JSON NOT
//     modified). Draft is sent as a real reply to the lead.
//     Verifies sheet update, column L, and that the email did NOT get the
//     shadow wrapper.
//
// SIDE EFFECTS (manual cleanup required after running):
//   - Sends real emails (shadow draft to agent, live reply to lead).
//   - Mutates row 2 of the Sheet: status -> 'cold', lastActionTimestamp updated,
//     column L appended twice.
//   - To reset: set column G (status) back to 'new', clear column P, clear
//     column L if desired.
//
// Cost: ~$0.002 in Claude (one Sonnet draft per scenario). $0 in Twilio.
//
// Usage: node scripts/test-paths-stopsignal.js

require('dotenv').config();

const { loadAgent } = require('../src/agentConfig');
const { pathStopSignal } = require('../src/paths');
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

function assertStringNotContains(description, str, substring) {
  totalAssertions++;
  const ok = typeof str === 'string' && !str.includes(substring);
  if (ok) {
    passed++;
    console.log(`  ✓ ${description}`);
  } else {
    failed++;
    console.log(`  ✗ ${description} -- found unexpected substring in: ${JSON.stringify(typeof str === 'string' ? str.slice(0, 200) : str)}`);
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

function assertStringNotStartsWith(description, str, prefix) {
  totalAssertions++;
  const ok = typeof str === 'string' && !str.startsWith(prefix);
  if (ok) {
    passed++;
    console.log(`  ✓ ${description}`);
  } else {
    failed++;
    console.log(`  ✗ ${description} -- actual starts with: ${JSON.stringify(prefix)}`);
  }
}

function assertNoDashes(description, str) {
  totalAssertions++;
  // \u2014 = em-dash, \u2013 = en-dash
  const ok = typeof str === 'string' && !/[\u2014\u2013]/.test(str);
  if (ok) {
    passed++;
    console.log(`  ✓ ${description}`);
  } else {
    failed++;
    const match = str.match(/[\u2014\u2013]/);
    console.log(`  ✗ ${description} -- found dash character (U+${match[0].codePointAt(0).toString(16).toUpperCase()}) in text`);
  }
}

async function main() {
  console.log(divider('='));
  console.log('PATH 3 (stop_signal) INTEGRATION TEST');
  console.log(divider('='));
  console.log();
  console.log('This test mutates row 2 of the Sheet and sends real emails.');
  console.log('Scenario A: shadow mode, draft goes to agent (not lead).');
  console.log('Scenario B: live mode (in-memory override only), draft goes to lead.');
  console.log('Estimated cost: ~$0.004 in Claude (two Sonnet drafts). $0 in Twilio.');
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

  if (!agent.gmailAddress) {
    console.error('ABORTED: agent.gmailAddress is not set.');
    process.exit(1);
  }
  if (!agent.googleSheetId) {
    console.error('ABORTED: agent.googleSheetId is not set.');
    process.exit(1);
  }
  console.log(`  ✓ gmailAddress: ${agent.gmailAddress}`);
  console.log(`  ✓ googleSheetId: ${agent.googleSheetId}`);
  console.log(`  ✓ mode: ${agent.mode}`);

  assert('agent.mode is "shadow" (Scenario A uses shadow mode as-is)', agent.mode, 'shadow');
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
  // SECTION 3: SCENARIO A - shadow mode (mo-test default)
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SCENARIO A: stop_signal in shadow mode (draft to agent, not lead)');
  console.log(divider('-'));

  const msgA = {
    messageId: 'test-message-id-stopsignal-a',
    threadId: 'test-thread-id-stopsignal-a',
    snippet: 'Thanks but we already went with another agent. Please stop emailing.',
    from: row.leadId,
    subject: 'Re: Your listing inquiry',
  };

  const catA = {
    category: 'stop_signal',
    confidence: 0.92,
    reasoning: 'Lead clearly declined and asked to stop contact. Polite but firm.',
    downgraded: false,
    originalCategory: 'stop_signal',
  };

  const resultA = await pathStopSignal(agent, row, msgA, catA);

  console.log();
  console.log('Result A:');
  console.log(JSON.stringify(resultA, null, 2));
  console.log();
  console.log('Assertions:');

  assert('resultA.ok === true', resultA.ok, true);
  assert('resultA.actions.sheet === "updated"', resultA.actions.sheet, 'updated');

  // Read back the Sheet to verify actual writes.
  rows = await email.readSheetRows(agent);
  row = rows.find((r) => r.rowIndex === 2);
  assert('row status is "cold" after Scenario A', row && row.status, 'cold');
  assertStringContains(
    'column L contains "stop_signal"',
    row && row.conversationHistory,
    'stop_signal'
  );
  assertStringContains(
    'column L contains "Draft source:"',
    row && row.conversationHistory,
    'Draft source:'
  );

  assert('resultA.actions.email === "sent_to_agent_shadow"', resultA.actions.email, 'sent_to_agent_shadow');

  const draftAValid = resultA.actions.draft === 'claude' || resultA.actions.draft === 'fallback_template';
  assert('resultA.actions.draft is "claude" or "fallback_template"', draftAValid, true);
  console.log(`  [info] draft source: ${resultA.actions.draft}`);

  // Verify via Gmail: shadow draft email should be in the agent's mailbox.
  // Wait briefly for Gmail to index the sent message.
  console.log('  [searching Gmail for shadow draft email...]');
  await sleep(2000);
  const shadowMessages = await email.searchEmails(agent, 'subject:"[SHADOW DRAFT]" in:sent');
  const recentShadow = shadowMessages.find((m) => {
    if (!m.receivedAt) return false;
    const age = Date.now() - new Date(m.receivedAt).getTime();
    return age < 3 * 60 * 1000; // within 3 minutes
  });

  totalAssertions++;
  if (recentShadow) {
    passed++;
    console.log('  ✓ Gmail search found shadow draft email sent within last 3 minutes');
  } else {
    failed++;
    console.log(`  ✗ Gmail search did not find a recent "[SHADOW DRAFT]" email (found ${shadowMessages.length} total, none recent)`);
  }

  if (recentShadow) {
    assertStringStartsWith(
      'shadow email subject starts with "[SHADOW DRAFT]"',
      recentShadow.subject,
      '[SHADOW DRAFT]'
    );
    assertStringContains(
      'shadow email snippet contains "This is a draft."',
      recentShadow.snippet,
      'This is a draft.'
    );
    assertNoDashes(
      'shadow email snippet contains no em-dashes or en-dashes',
      recentShadow.snippet
    );
  } else {
    // Skip the 3 dependent assertions so they don't artificially inflate failures.
    console.log('  [skipping 3 email-body assertions: no recent shadow email found in Gmail]');
    totalAssertions += 3;
    failed += 3;
  }
  console.log();

  // --------------------------------------------------------------------------
  // SECTION 4: SCENARIO B - live mode (in-memory override, JSON NOT modified)
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SCENARIO B: stop_signal in live mode (draft sent directly to lead)');
  console.log('  NOTE: agent.mode overridden to "live" in memory only. agents/mo-test.json is NOT modified.');
  console.log(divider('-'));

  // Shallow-copy the agent object so we do NOT mutate the original loaded config.
  const agentLive = { ...agent, mode: 'live' };

  // Re-read row 2 so we have the current state (status is now 'cold' from Scenario A).
  rows = await email.readSheetRows(agent);
  row = rows.find((r) => r.rowIndex === 2);

  const msgB = {
    messageId: 'test-message-id-stopsignal-b',
    threadId: null, // null so sendReply sends without threading into a fake (non-existent) thread
    snippet: 'Already bought a place. All the best.',
    from: row.leadId,
    subject: 'Re: Your listing inquiry',
  };

  const catB = {
    category: 'stop_signal',
    confidence: 0.95,
    reasoning: 'Lead confirmed they purchased elsewhere. Positive exit, warm tone appropriate.',
    downgraded: false,
    originalCategory: 'stop_signal',
  };

  const resultB = await pathStopSignal(agentLive, row, msgB, catB);

  console.log();
  console.log('Result B:');
  console.log(JSON.stringify(resultB, null, 2));
  console.log();
  console.log('Assertions:');

  assert('resultB.ok === true', resultB.ok, true);
  assert('resultB.actions.sheet === "updated"', resultB.actions.sheet, 'updated');

  rows = await email.readSheetRows(agent);
  row = rows.find((r) => r.rowIndex === 2);
  assert('row status is "cold" after Scenario B', row && row.status, 'cold');
  assertStringContains(
    'column L contains "Already bought a place" (Scenario B snippet in history)',
    row && row.conversationHistory,
    'Already bought a place'
  );

  assert('resultB.actions.email === "sent_to_lead"', resultB.actions.email, 'sent_to_lead');

  const draftBValid = resultB.actions.draft === 'claude' || resultB.actions.draft === 'fallback_template';
  assert('resultB.actions.draft is "claude" or "fallback_template"', draftBValid, true);
  console.log(`  [info] draft source: ${resultB.actions.draft}`);

  // Verify via Gmail: the live email should appear in the Sent folder addressed
  // to the lead. The subject is normalizeSubject applied to msg.subject.
  console.log('  [searching Gmail for live reply to lead...]');
  await sleep(2000);
  const liveMessages = await email.searchEmails(
    agent,
    `to:${row.leadId} in:sent`
  );
  const recentLive = liveMessages.find((m) => {
    if (!m.receivedAt) return false;
    const age = Date.now() - new Date(m.receivedAt).getTime();
    return age < 3 * 60 * 1000;
  });

  totalAssertions++;
  if (recentLive) {
    passed++;
    console.log(`  ✓ Gmail search found live email to ${row.leadId} sent within last 3 minutes`);
  } else {
    failed++;
    console.log(`  ✗ Gmail search did not find a recent email to ${row.leadId} in sent folder (found ${liveMessages.length} total, none recent)`);
  }

  if (recentLive) {
    assertStringNotStartsWith(
      'live email subject does NOT start with "[SHADOW DRAFT]"',
      recentLive.subject,
      '[SHADOW DRAFT]'
    );
    assertStringNotContains(
      'live email snippet does NOT contain shadow preamble',
      recentLive.snippet,
      'This is a draft. The lead did NOT receive this message.'
    );
  } else {
    console.log('  [skipping 2 email-body assertions: no recent live email found in Gmail]');
    totalAssertions += 2;
    failed += 2;
  }
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
  console.log('  Row 2 has been mutated (status -> cold, lastActionTimestamp updated, column L appended).');
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
