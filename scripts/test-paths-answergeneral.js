// scripts/test-paths-answergeneral.js
//
// Integration test for Path 1A (answer_general + conversation_continue) in src/paths.js.
// Exercises pathAnswerGeneral end-to-end against the mo-test agent and row 2
// of the test Sheet.
//
// WHAT THIS TEST DOES:
//   - Scenario A: shadow mode (mo-test default). Claude draft. Draft goes to agent, NOT lead.
//     Pre-populates column L with a fixture, verifies history is threaded correctly, then
//     restores column L to the fixture state so subsequent runs start clean.
//   - Scenario B: live mode (agent.mode overridden in memory only, JSON NOT modified).
//     Uses category 'conversation_continue' to verify both categories route here correctly.
//     Draft sent as a real reply to the lead.
//   - Scenario C: fallback template (claude.draft monkey-patched to throw). Verifies Sheet
//     status becomes 'needs_review', escalation email fires, shadow draft still goes to agent.
//
// SIDE EFFECTS (manual cleanup required after running):
//   - Sends real emails.
//   - Mutates row 2 of the Sheet: status, lastActionTimestamp, and column L.
//   - To reset: set column G (status) back to 'new', clear column P, clear column L.
//
// Cost: ~$0.006 in Claude (two Sonnet drafts, Scenarios A and B). $0 in Twilio.
//
// Usage: node scripts/test-paths-answergeneral.js

require('dotenv').config();

const { loadAgent } = require('../src/agentConfig');
const { pathAnswerGeneral } = require('../src/paths');
const email = require('../src/email');
const claude = require('../src/claude');

// Known-safe fixture written to column L before Scenario A.
// The string is chosen to be recognisable and grep-friendly in assertions.
const FIXTURE_HISTORY = '[2026-04-01T10:00:00.000Z] hot_signal initial draft sent | (test fixture)';

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

function assertStringNotStartsWith(description, str, sfx) {
  totalAssertions++;
  const ok = typeof str === 'string' && !str.startsWith(sfx);
  if (ok) {
    passed++;
    console.log(`  ✓ ${description}`);
  } else {
    failed++;
    console.log(`  ✗ ${description} -- actual starts with: ${JSON.stringify(sfx)}`);
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
  console.log('PATH 1A (answer_general / conversation_continue) INTEGRATION TEST');
  console.log(divider('='));
  console.log();
  console.log('This test mutates row 2 of the Sheet and sends real emails.');
  console.log('Scenario A: shadow mode, Claude draft. Draft goes to agent, not lead.');
  console.log('Scenario B: live mode (in-memory override only). Draft sent directly to lead.');
  console.log('Scenario C: fallback template (claude.draft monkey-patched to throw).');
  console.log('Estimated cost: ~$0.006 in Claude (Scenarios A and B). $0 in Twilio.');
  console.log();

  // --------------------------------------------------------------------------
  // SECTION 1: Environment + agent config check
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 1: Environment + agent config check');
  console.log(divider('-'));

  const requiredEnvVars = ['ANTHROPIC_API_KEY'];
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
  // SECTION 3: SCENARIO A - shadow mode, successful Claude draft
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SCENARIO A: answer_general in shadow mode (draft to agent, not lead)');
  console.log(divider('-'));

  // Pre-populate column L with a known fixture so we can verify history is read.
  console.log('  [pre-populating column L with test fixture]');
  await email.updateSheetRow(agent, row.rowIndex, { conversationHistory: FIXTURE_HISTORY });

  // Re-read row so row.conversationHistory reflects the fixture we just wrote.
  rows = await email.readSheetRows(agent);
  row = rows.find((r) => r.rowIndex === 2);

  const msgA = {
    messageId: 'test-message-id-answergeneral-a',
    threadId: null,
    snippet: "What's a typical down payment for first-time buyers in Toronto?",
    from: row.leadId,
    subject: 'Re: Your listing inquiry',
  };

  const catA = {
    category: 'answer_general',
    confidence: 0.89,
    reasoning: 'Lead asked a general question about down payment requirements. Standard Path 1A territory.',
    downgraded: false,
    originalCategory: 'answer_general',
  };

  const resultA = await pathAnswerGeneral(agent, row, msgA, catA);

  console.log();
  console.log('Result A:');
  console.log(JSON.stringify(resultA, null, 2));
  console.log();
  console.log('Assertions:');

  assert('resultA.ok === true', resultA.ok, true);
  assert('resultA.actions.draft === "claude"', resultA.actions.draft, 'claude');
  assert('resultA.actions.sheet === "updated"', resultA.actions.sheet, 'updated');
  assert('resultA.actions.escalationEmail === "not_needed"', resultA.actions.escalationEmail, 'not_needed');
  assert('resultA.actions.email === "sent_to_agent_shadow"', resultA.actions.email, 'sent_to_agent_shadow');

  // Read back the Sheet to verify actual writes.
  rows = await email.readSheetRows(agent);
  row = rows.find((r) => r.rowIndex === 2);
  assert('row status is "warm" after Scenario A', row && row.status, 'warm');
  assertStringContains(
    'column L still contains the test fixture entry',
    row && row.conversationHistory,
    '(test fixture)'
  );
  assertStringContains(
    'column L contains new "answer_general" entry',
    row && row.conversationHistory,
    'answer_general'
  );
  assertStringContains(
    'column L contains "Draft source: claude"',
    row && row.conversationHistory,
    'Draft source: claude'
  );

  // Verify via Gmail: shadow draft email should be in the agent's sent folder.
  console.log('  [searching Gmail for shadow draft email...]');
  await sleep(2000);
  const shadowMessagesA = await email.searchEmails(agent, 'subject:"[SHADOW DRAFT]" in:sent');
  const recentShadowA = shadowMessagesA.find((m) => {
    if (!m.receivedAt) return false;
    const age = Date.now() - new Date(m.receivedAt).getTime();
    return age < 3 * 60 * 1000;
  });

  totalAssertions++;
  if (recentShadowA) {
    passed++;
    console.log('  ✓ Gmail search found shadow draft email sent within last 3 minutes');
  } else {
    failed++;
    console.log(`  ✗ Gmail search did not find a recent "[SHADOW DRAFT]" email (found ${shadowMessagesA.length} total, none recent)`);
  }

  if (recentShadowA) {
    assertStringStartsWith(
      'shadow email subject starts with "[SHADOW DRAFT]"',
      recentShadowA.subject,
      '[SHADOW DRAFT]'
    );
    assertStringContains(
      'shadow email snippet contains "This is a draft."',
      recentShadowA.snippet,
      'This is a draft.'
    );
    assertNoDashes(
      'shadow email snippet contains no em-dashes or en-dashes',
      recentShadowA.snippet
    );
  } else {
    console.log('  [skipping 3 email-body assertions: no recent shadow email found in Gmail]');
    totalAssertions += 3;
    failed += 3;
  }
  console.log();

  // Restore column L to the fixture state so Scenario B starts clean.
  console.log('  [restoring column L to test fixture state]');
  await email.updateSheetRow(agent, row.rowIndex, { conversationHistory: FIXTURE_HISTORY });
  console.log();

  // --------------------------------------------------------------------------
  // SECTION 4: SCENARIO B - live mode, category = conversation_continue
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SCENARIO B: conversation_continue in live mode (draft sent directly to lead)');
  console.log('  NOTE: agent.mode overridden to "live" in memory only. agents/mo-test.json is NOT modified.');
  console.log(divider('-'));

  // Shallow-copy so we do NOT mutate the loaded config.
  const agentLive = { ...agent, mode: 'live' };

  // Re-read row so we have the current state (column L is back to the fixture after restore).
  rows = await email.readSheetRows(agent);
  row = rows.find((r) => r.rowIndex === 2);

  const msgB = {
    messageId: 'test-message-id-answergeneral-b',
    threadId: null,
    snippet: 'How long does the closing process usually take in Ontario?',
    from: row.leadId,
    subject: 'Re: Your listing inquiry',
  };

  const catB = {
    category: 'conversation_continue',
    confidence: 0.86,
    reasoning: 'Lead is asking a follow up question after our prior interaction.',
    downgraded: false,
    originalCategory: 'conversation_continue',
  };

  const resultB = await pathAnswerGeneral(agentLive, row, msgB, catB);

  console.log();
  console.log('Result B:');
  console.log(JSON.stringify(resultB, null, 2));
  console.log();
  console.log('Assertions:');

  assert('resultB.ok === true', resultB.ok, true);
  assert('resultB.actions.draft === "claude"', resultB.actions.draft, 'claude');
  assert('resultB.actions.sheet === "updated"', resultB.actions.sheet, 'updated');
  assert('resultB.actions.escalationEmail === "not_needed"', resultB.actions.escalationEmail, 'not_needed');
  assert('resultB.actions.email === "sent_to_lead"', resultB.actions.email, 'sent_to_lead');

  rows = await email.readSheetRows(agent);
  row = rows.find((r) => r.rowIndex === 2);
  assert('row status is "warm" after Scenario B', row && row.status, 'warm');
  assertStringContains(
    'column L contains "conversation_continue"',
    row && row.conversationHistory,
    'conversation_continue'
  );
  assertStringContains(
    'column L contains "Draft source: claude" (Scenario B)',
    row && row.conversationHistory,
    'Draft source: claude'
  );

  // Verify via Gmail: live email in Sent folder addressed to the lead.
  console.log(`  [searching Gmail for live reply to ${row.leadId}...]`);
  await sleep(2000);
  const liveMessages = await email.searchEmails(agent, `to:${row.leadId} in:sent`);
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
      'This is a draft.'
    );
    assertNoDashes(
      'live email snippet contains no em-dashes or en-dashes',
      recentLive.snippet
    );
  } else {
    console.log('  [skipping 3 email-body assertions: no recent live email found in Gmail]');
    totalAssertions += 3;
    failed += 3;
  }
  console.log();

  // --------------------------------------------------------------------------
  // SECTION 5: SCENARIO C - fallback template (monkey-patched claude.draft)
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SCENARIO C: fallback template path (claude.draft monkey-patched to throw)');
  console.log(divider('-'));

  // Re-read row for the latest state.
  rows = await email.readSheetRows(agent);
  row = rows.find((r) => r.rowIndex === 2);

  const msgC = {
    messageId: 'test-message-id-answergeneral-c',
    threadId: null,
    snippet: 'Just had a quick question about pre-approval timelines.',
    from: row.leadId,
    subject: 'Re: Your listing inquiry',
  };

  const catC = {
    category: 'answer_general',
    confidence: 0.82,
    reasoning: 'Standard Path 1A.',
    downgraded: false,
    originalCategory: 'answer_general',
  };

  // Temporarily monkey-patch claude.draft to simulate a total Claude failure.
  // Agent is mo-test (shadow mode), so the fallback draft goes to the agent, not the lead.
  const originalDraft = claude.draft;
  claude.draft = async () => { throw new Error('Simulated Claude failure for testing fallback'); };

  let resultC;
  try {
    resultC = await pathAnswerGeneral(agent, row, msgC, catC);
  } finally {
    claude.draft = originalDraft;
  }

  console.log();
  console.log('Result C:');
  console.log(JSON.stringify(resultC, null, 2));
  console.log();
  console.log('Assertions:');

  assert('resultC.ok === true', resultC.ok, true);
  assert('resultC.actions.draft === "fallback_template"', resultC.actions.draft, 'fallback_template');
  assert('resultC.actions.sheet === "updated"', resultC.actions.sheet, 'updated');
  assert('resultC.actions.email === "sent_to_agent_shadow"', resultC.actions.email, 'sent_to_agent_shadow');
  assert('resultC.actions.escalationEmail === "sent"', resultC.actions.escalationEmail, 'sent');

  rows = await email.readSheetRows(agent);
  row = rows.find((r) => r.rowIndex === 2);
  assert('row status is "needs_review" after Scenario C (fallback path)', row && row.status, 'needs_review');
  assertStringContains(
    'column L contains "Draft source: fallback_template"',
    row && row.conversationHistory,
    'Draft source: fallback_template'
  );

  // Verify via Gmail: two emails in the last 3 minutes (one shadow draft + one escalation).
  console.log('  [searching Gmail for shadow draft and escalation emails (Scenario C)...]');
  await sleep(2000);

  const shadowMessagesC = await email.searchEmails(agent, 'subject:"[SHADOW DRAFT]" in:sent');
  const recentShadowC = shadowMessagesC.find((m) => {
    if (!m.receivedAt) return false;
    const age = Date.now() - new Date(m.receivedAt).getTime();
    return age < 3 * 60 * 1000;
  });

  totalAssertions++;
  if (recentShadowC) {
    passed++;
    console.log('  ✓ Gmail found [SHADOW DRAFT] email sent within last 3 minutes (Scenario C)');
  } else {
    failed++;
    console.log(`  ✗ Gmail did not find a recent [SHADOW DRAFT] email for Scenario C (found ${shadowMessagesC.length} total, none recent)`);
  }

  const escalationMessages = await email.searchEmails(agent, 'subject:"[ESCALATION]" in:sent');
  const recentEscalation = escalationMessages.find((m) => {
    if (!m.receivedAt) return false;
    const age = Date.now() - new Date(m.receivedAt).getTime();
    return age < 3 * 60 * 1000;
  });

  totalAssertions++;
  if (recentEscalation) {
    passed++;
    console.log('  ✓ Gmail found [ESCALATION] email sent within last 3 minutes');
  } else {
    failed++;
    console.log(`  ✗ Gmail did not find a recent [ESCALATION] email (found ${escalationMessages.length} total, none recent)`);
  }

  if (recentEscalation) {
    assertStringStartsWith(
      'escalation email subject starts with "[ESCALATION]"',
      recentEscalation.subject,
      '[ESCALATION]'
    );
  } else {
    console.log('  [skipping escalation subject assertion: no recent escalation email found]');
    totalAssertions += 1;
    failed += 1;
  }
  console.log();

  // --------------------------------------------------------------------------
  // SECTION 6: Test summary
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
  console.log('  Row 2 has been mutated (status -> needs_review, column L appended, lastActionTimestamp updated).');
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
