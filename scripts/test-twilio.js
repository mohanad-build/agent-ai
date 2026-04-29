// scripts/test-twilio.js
// Standalone integration test for src/twilio.js. Sends one real SMS to the
// mo-test agent's phone via Twilio. Run: node scripts/test-twilio.js
//
// Costs about $0.008 per run. Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
// TWILIO_FROM_NUMBER set in .env, and the destination phone verified in
// Twilio's Verified Caller IDs list (trial accounts only).

require('dotenv').config();

const twilio = require('../src/twilio');
const { loadAgent } = require('../src/agentConfig');

let pass = 0;
let fail = 0;

function ok(msg) {
  console.log('  PASS: ' + msg);
  pass++;
}

function bad(msg) {
  console.log('  FAIL: ' + msg);
  fail++;
}

function header(title) {
  console.log('\n=== ' + title + ' ===');
}

async function main() {
  header('1. Environment check');
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (sid && sid.startsWith('AC')) ok('TWILIO_ACCOUNT_SID looks valid');
  else bad('TWILIO_ACCOUNT_SID missing or malformed');
  if (token && token.length === 32) ok('TWILIO_AUTH_TOKEN looks valid');
  else bad('TWILIO_AUTH_TOKEN missing or wrong length');
  if (from && from.startsWith('+')) ok('TWILIO_FROM_NUMBER in E.164');
  else bad('TWILIO_FROM_NUMBER missing or not E.164');

  header('2. Load agent config');
  const agent = loadAgent('mo-test');
  if (agent.agentPhone && agent.agentPhone.startsWith('+')) ok('agentPhone in E.164');
  else bad('agentPhone missing or not E.164');
  if (agent.firstName) ok('firstName set: ' + agent.firstName);
  else bad('firstName missing');

  header('3. Templates render correctly');
  const hot = twilio.TEMPLATES.hotLeadAlert({
    leadName: 'Sarah Chen',
    snippet: 'I want to make an offer on 123 Main St',
    leadEmail: 'sarah@example.com',
  });
  if (hot.includes('🔥') && hot.includes('Sarah Chen')) ok('hotLeadAlert renders');
  else bad('hotLeadAlert malformed');

  const path1B = twilio.TEMPLATES.path1BAgentQuery({
    leadName: 'Sarah Chen',
    question: 'How many bedrooms does the property have?',
  });
  if (path1B.includes('Sarah Chen') && path1B.includes('Reply to this text')) {
    ok('path1BAgentQuery renders');
  } else bad('path1BAgentQuery malformed');

  const reminder = twilio.TEMPLATES.path1BReminder({ leadName: 'Sarah Chen' });
  if (reminder.includes('Reminder') && reminder.includes('Sarah Chen')) {
    ok('path1BReminder renders');
  } else bad('path1BReminder malformed');

  const review = twilio.TEMPLATES.urgentNeedsReview({
    keyword: 'lawyer',
    leadName: 'Sarah Chen',
  });
  if (review.includes('lawyer') && review.includes('Sarah Chen')) {
    ok('urgentNeedsReview renders');
  } else bad('urgentNeedsReview malformed');

  header('4. truncate utility');
  const t = twilio._internal.truncate;
  if (t('hello', 100) === 'hello') ok('short string passes through');
  else bad('short string truncate broken');
  const long = 'a'.repeat(200);
  const truncated = t(long, 50);
  if (truncated.length === 50 && truncated.endsWith('…')) ok('long string truncated to 50 with ellipsis');
  else bad('long string truncate broken: length=' + truncated.length);
  if (t(null, 50) === '') ok('null returns empty string');
  else bad('null handling broken');

  header('5. Send real SMS to agentPhone');
  const testMessage = '[twilio.js test] If you got this, twilio.js works. Time: ' + new Date().toLocaleTimeString();
  try {
    const result = await twilio.sendSMS(agent, testMessage);
    if (result && result.sid) {
      ok('sendSMS returned sid: ' + result.sid);
      console.log('  Check your phone (' + agent.agentPhone.slice(0, 2) + '...' + agent.agentPhone.slice(-2) + ') for the test message.');
    } else {
      bad('sendSMS returned no sid');
    }
  } catch (err) {
    bad('sendSMS threw: ' + err.message);
    if (err.code) console.log('  Twilio error code: ' + err.code);
    if (err.code === 21608) {
      console.log('  Error 21608 = unverified-trial-recipient. Add agentPhone to Twilio Verified Caller IDs.');
    }
    if (err.code === 21211) {
      console.log('  Error 21211 = invalid To number. Check agentPhone format.');
    }
    if (err.status === 401) {
      console.log('  401 = bad credentials. Re-check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env.');
    }
  }

  header('Summary');
  console.log('  ' + pass + ' pass, ' + fail + ' fail');
  if (fail === 0) {
    console.log('\nAll checks passed. The test SMS should be on your phone shortly.');
  } else {
    console.log('\nFailures detected. Review output above.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
