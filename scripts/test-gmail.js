// scripts/test-gmail.js
//
// Integration test for src/gmail.js (and src/email.js by extension).
// Exercises every function against the mo-test agent's real Gmail and Sheet.
//
// SIDE EFFECTS: sends 3 test emails to mo-test's own Gmail, adds 1 row to the
// Sheet (with email "gmail-test-lead@example.com"), updates that row, marks
// one test email as read. You should manually delete the test row and emails
// after this script passes.
//
// Usage: node scripts/test-gmail.js

require('dotenv').config();
const { loadAgent } = require('../src/agentConfig');
const email = require('../src/email');
const gmail = require('../src/gmail');
const { google } = require('googleapis');

const TEST_LEAD_EMAIL = 'gmail-test-lead@example.com';
const TEST_SUBJECT_PREFIX = '[gmail.js test]';

let pass = 0;
let fail = 0;

function ok(msg) { pass++; console.log(`  PASS: ${msg}`); }
function bad(msg) { fail++; console.log(`  FAIL: ${msg}`); }
function header(label) { console.log(`\n=== ${label} ===`); }

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  header('1. Load agent config');
  const agent = loadAgent('mo-test');
  if (agent.agentId === 'mo-test') ok('Loaded mo-test config');
  else bad(`Unexpected agentId: ${agent.agentId}`);
  if (agent.googleSheetId) ok('googleSheetId set');
  else bad('googleSheetId missing');
  if (agent.googleRefreshToken) ok('googleRefreshToken set');
  else bad('googleRefreshToken missing');

  header('2. getSignaturePresence');
  const hasSig1 = await email.getSignaturePresence(agent);
  console.log(`  Signature present: ${hasSig1}`);
  ok('getSignaturePresence returned a value');
  const hasSig2 = await email.getSignaturePresence(agent);
  if (hasSig1 === hasSig2) ok('Cached call returned same value');
  else bad('Cached call returned different value');

  header('3. readSheetRows (before any data)');
  const rowsBefore = await email.readSheetRows(agent);
  console.log(`  Found ${rowsBefore.length} existing rows`);
  ok('readSheetRows returned an array');
  const leftover = rowsBefore.find((r) => r.leadId === TEST_LEAD_EMAIL);
  if (leftover) {
    console.log(`  WARNING: leftover test row at rowIndex ${leftover.rowIndex}.`);
  }

  header('4. appendSheetRow');
  await email.appendSheetRow(agent, {
    leadId: TEST_LEAD_EMAIL,
    name: 'Gmail Test Lead',
    phone: '+15555550123',
    source: 'gmail.js test',
    dateAdded: new Date().toISOString().slice(0, 10),
    originalMessage: 'This is a test lead added by scripts/test-gmail.js',
    status: 'new',
    aiEnabled: 'true',
  });
  ok('appendSheetRow completed without error');

  header('5. readSheetRows (after append)');
  const rowsAfter = await email.readSheetRows(agent);
  console.log(`  Found ${rowsAfter.length} rows (was ${rowsBefore.length})`);
  const testRow = rowsAfter.find((r) => r.leadId === TEST_LEAD_EMAIL);
  if (!testRow) {
    bad('Test row not found after append');
  } else {
    ok(`Test row found at rowIndex ${testRow.rowIndex}`);
    if (testRow.name === 'Gmail Test Lead') ok('Name field correct');
    else bad(`Name field wrong: "${testRow.name}"`);
    if (testRow.status === 'new') ok('Status field correct');
    else bad(`Status field wrong: "${testRow.status}"`);
  }

  header('6. updateSheetRow');
  if (testRow) {
    await email.updateSheetRow(agent, testRow.rowIndex, {
      status: 'in_conversation',
      lastActionTimestamp: new Date().toISOString(),
    });
    ok('updateSheetRow completed without error');
    const verified = (await email.readSheetRows(agent)).find(
      (r) => r.leadId === TEST_LEAD_EMAIL
    );
    if (verified.status === 'in_conversation') ok('Status update verified');
    else bad(`Status update failed: "${verified.status}"`);
    if (verified.lastActionTimestamp) ok('lastActionTimestamp written');
    else bad('lastActionTimestamp not written');
  } else {
    bad('Skipped: no test row');
  }

  header('7. appendToConversationHistory');
  if (testRow) {
    await email.appendToConversationHistory(
      agent,
      testRow.rowIndex,
      'First test entry from gmail.js test script'
    );
    ok('First append completed');
    await email.appendToConversationHistory(
      agent,
      testRow.rowIndex,
      'Second test entry to verify newline appending'
    );
    ok('Second append completed');
    const reread = (await email.readSheetRows(agent)).find(
      (r) => r.leadId === TEST_LEAD_EMAIL
    );
    if (reread.conversationHistory.includes('First test entry')) ok('First entry persisted');
    else bad('First entry missing');
    if (reread.conversationHistory.includes('Second test entry')) ok('Second entry persisted');
    else bad('Second entry missing');
    if (reread.conversationHistory.split('\n').length === 2) ok('Two entries on separate lines');
    else bad(`Expected 2 lines, got ${reread.conversationHistory.split('\n').length}`);
  } else {
    bad('Skipped: no test row');
  }

  header('8. sendNewEmail');
  const result1 = await email.sendNewEmail(agent, {
    to: agent.gmailAddress,
    subject: `${TEST_SUBJECT_PREFIX} new email -- please ignore`,
    body: 'This is test email #1 from scripts/test-gmail.js. Safe to delete.',
  });
  const firstSentMessageId = result1.id;
  const firstSentThreadId = result1.threadId;
  if (firstSentMessageId) ok(`Sent, messageId: ${firstSentMessageId}`);
  else bad('No messageId returned');

  header('9. sendReply with subject normalization');
  const result2 = await email.sendReply(agent, {
    to: agent.gmailAddress,
    subject: `Re: Re: FW: Re: ${TEST_SUBJECT_PREFIX} subject normalization`,
    body: 'Test email #2 -- verifies subject normalization. Safe to delete.',
    threadId: null,
  });
  if (result2.id) ok(`Sent, messageId: ${result2.id}`);
  else bad('No messageId returned');
  await sleep(2000);
  const sent2 = await email.getMessage(agent, result2.id);
  const expectedSubject = `Re: ${TEST_SUBJECT_PREFIX} subject normalization`;
  if (sent2.subject === expectedSubject) ok(`Subject normalized correctly: "${sent2.subject}"`);
  else bad(`Subject not normalized correctly. Got: "${sent2.subject}", expected: "${expectedSubject}"`);

  header('10. sendReply with CC + BCC (leak check)');
  const agentWithCcBcc = {
    ...agent,
    ccEmails: [agent.gmailAddress],
    bccEmails: [agent.gmailAddress],
  };
  const ccBccSubject = `${TEST_SUBJECT_PREFIX} cc-bcc-leak-test`;
  const result3 = await email.sendReply(agentWithCcBcc, {
    to: agent.gmailAddress,
    subject: ccBccSubject,
    body: 'Test email #3 -- CC/BCC leak check. Safe to delete.',
    threadId: null,
  });
  if (result3.id) ok(`Sent, messageId: ${result3.id}`);
  else bad('No messageId returned');
  await sleep(4000);
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: agent.googleRefreshToken });
  const rawGmail = google.gmail({ version: 'v1', auth });
  const found = await rawGmail.users.messages.list({
    userId: 'me',
    q: `subject:"${ccBccSubject}"`,
    maxResults: 5,
  });
  const matches = found.data.messages || [];
  console.log(`  Found ${matches.length} delivered copies`);
  if (matches.length >= 1) {
    const fullMsg = await rawGmail.users.messages.get({
      userId: 'me',
      id: matches[0].id,
      format: 'full',
    });
    const headers = fullMsg.data.payload.headers;
    const ccHeader = headers.find((h) => h.name.toLowerCase() === 'cc');
    const bccHeader = headers.find((h) => h.name.toLowerCase() === 'bcc');
    if (ccHeader && ccHeader.value.includes(agent.gmailAddress)) {
      ok(`Cc header visible: "${ccHeader.value}"`);
    } else {
      bad('Cc header missing or wrong');
    }
    if (!bccHeader) {
      ok('Bcc header NOT in delivered message (no leak)');
    } else {
      bad(`LEAK: Bcc header found in delivered message: "${bccHeader.value}"`);
    }
  } else {
    bad('Could not find delivered message');
  }

  header('11. fetchUnreadReplies');
  const unread = await email.fetchUnreadReplies(agent);
  console.log(`  Found ${unread.length} unread messages in last 24h`);
  ok('fetchUnreadReplies returned an array');
  if (unread.length > 0) ok(`At least one unread message present`);
  else console.log('  (no unread messages -- not a failure)');

  header('12. searchEmails');
  const searched = await email.searchEmails(
    agent,
    `subject:"${TEST_SUBJECT_PREFIX}" newer_than:1d`
  );
  console.log(`  Search returned ${searched.length} matches`);
  if (searched.length >= 3) ok(`Found at least 3 test emails (got ${searched.length})`);
  else bad(`Expected at least 3, got ${searched.length}`);

  header('13. markRead');
  await email.markRead(agent, firstSentMessageId);
  ok('markRead completed without error');
  await sleep(1500);
  const unreadAfter = await email.fetchUnreadReplies(agent);
  const stillUnread = unreadAfter.find((m) => m.messageId === firstSentMessageId);
  if (!stillUnread) ok('Message no longer in unread list');
  else bad('Message still appears in unread list');

  header('14. getMessage + getThreadHistory');
  const fetched = await email.getMessage(agent, firstSentMessageId);
  if (fetched.messageId === firstSentMessageId) ok('getMessage returned correct message');
  else bad('getMessage returned wrong message');
  if (fetched.subject) ok(`Subject parsed: "${fetched.subject}"`);
  else bad('Subject missing');
  const thread = await email.getThreadHistory(agent, firstSentThreadId);
  console.log(`  Thread contains ${thread.length} message(s)`);
  if (thread.length >= 1) ok('getThreadHistory returned messages');
  else bad('getThreadHistory returned empty thread');

  console.log('\n========================================');
  console.log(`RESULTS: ${pass} pass, ${fail} fail`);
  console.log('========================================');
  if (fail === 0) {
    console.log('\nAll tests passed. Manual cleanup:');
    console.log(`  1. Delete row with leadId "${TEST_LEAD_EMAIL}" from your Sheet`);
    console.log(`  2. Delete the test emails with subject "${TEST_SUBJECT_PREFIX}..." from inbox`);
  } else {
    console.log('\nFailures detected. Review output above.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nTest script crashed:');
  console.error(err);
  process.exit(1);
});
