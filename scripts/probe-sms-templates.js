// scripts/probe-sms-templates.js
//
// Manual probe for investigating Canadian carrier SMS filtering behavior
// across different message templates.
//
// WHAT THIS PROBE DOES:
//   - Sends 3 SMS variants to mo-test's verified phone number.
//   - Waits for delivery status to settle (5s), then fetches the final status.
//   - Prints what the carrier actually did for each variant.
//   - This is INVESTIGATIVE only. There are no assertions and no pass/fail.
//     Nothing in production code is modified based on these results.
//
// COST: ~$0.024 in Twilio fees (3 SMS sends at ~$0.008 each).
//
// WHY: Some Canadian-bound SMS get carrier-filtered with errorCode 30044.
// The hypothesis is that message content (emoji, ALL CAPS, urgency words,
// embedded email addresses) influences carrier spam scoring. This probe
// tests 3 variants of the same core message to see if content affects delivery.
//
// Usage: node scripts/probe-sms-templates.js

require('dotenv').config();

const twilio = require('twilio');
const { loadAgent } = require('../src/agentConfig');

function divider(char = '=', length = 80) {
  return char.repeat(length);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const variants = [
  {
    label: 'A) Original template (control)',
    body: '🔥 HOT LEAD: Valid Lead just said: "I want to book a showing this weekend!"\nReply to wpsmohanadmohamed@gmail.com ASAP.',
  },
  {
    label: 'B) Minimal urgency markers',
    body: 'HOT lead replied: Valid Lead said "I want to book a showing this weekend!". Check email for details.',
  },
  {
    label: 'C) Conservative phrasing (no urgency language)',
    body: 'New activity: Valid Lead sent a reply that needs your attention. Check email for details.',
  },
];

async function main() {
  console.log(divider('='));
  console.log('SMS TEMPLATE PROBE: Canadian carrier filtering investigation');
  console.log(divider('='));
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
  console.log(`  gmailAddress: ${agent.gmailAddress}`);
  console.log(`  agentPhone:   ${agent.agentPhone}`);

  if (!agent.agentPhone || !agent.agentPhone.startsWith('+')) {
    console.error('\nABORTED: agent.agentPhone is missing or not in E.164 format.');
    process.exit(1);
  }
  console.log();

  const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
  const agentPhone = agent.agentPhone;

  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  // --------------------------------------------------------------------------
  // SECTION 2: Send all 3 variants
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 2: Send all 3 variants');
  console.log(divider('-'));
  console.log();

  const sent = [];

  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    console.log(`[sending] ${variant.label}`);
    console.log(`  ${variant.body.replace(/\n/g, '\n  ')}`);

    try {
      const result = await client.messages.create({
        to: agentPhone,
        from: TWILIO_FROM_NUMBER,
        body: variant.body,
      });
      console.log(`  sid: ${result.sid}`);
      sent.push({ label: variant.label, sid: result.sid, body: variant.body });
    } catch (err) {
      console.log(`  ERROR sending: ${err.message}`);
      sent.push({ label: variant.label, sid: null, body: variant.body, sendError: err.message });
    }

    if (i < variants.length - 1) {
      console.log('  [waiting 2s before next send...]');
      await sleep(2000);
    }
    console.log();
  }

  // --------------------------------------------------------------------------
  // SECTION 3: Wait for status to settle
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 3: Wait for status to settle');
  console.log(divider('-'));
  console.log('[waiting 5s for delivery status to settle...]');
  await sleep(5000);
  console.log();

  // --------------------------------------------------------------------------
  // SECTION 4: Fetch actual delivery status for each
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 4: Fetch actual delivery status');
  console.log(divider('-'));
  console.log();

  const results = [];

  for (const s of sent) {
    if (!s.sid) {
      console.log(`[skipping] ${s.label}: no sid (send failed at Section 2)`);
      results.push({ label: s.label, sid: null, status: 'send_error', errorCode: null, errorMessage: s.sendError });
      continue;
    }
    try {
      const m = await client.messages(s.sid).fetch();
      console.log(`[fetched] ${s.label}: status=${m.status}`);
      results.push({
        label: s.label,
        sid: s.sid,
        status: m.status,
        errorCode: m.errorCode,
        errorMessage: m.errorMessage,
      });
    } catch (err) {
      console.log(`[error fetching] ${s.label}: ${err.message}`);
      results.push({
        label: s.label,
        sid: s.sid,
        status: 'fetch_error',
        errorCode: null,
        errorMessage: err.message,
      });
    }
  }
  console.log();

  // --------------------------------------------------------------------------
  // SECTION 5: Results table
  // --------------------------------------------------------------------------
  console.log(divider('='));
  console.log('SECTION 5: Results');
  console.log(divider('='));
  console.log();

  for (const r of results) {
    console.log(r.label);
    console.log('  status:    ' + r.status);
    console.log('  errorCode: ' + (r.errorCode != null ? r.errorCode : 'none'));
    console.log('  sid:       ' + (r.sid || 'none'));
    console.log();
  }

  // --------------------------------------------------------------------------
  // SECTION 6: Interpretation guidance
  // --------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 6: Interpretation guidance');
  console.log(divider('-'));
  console.log();
  console.log('Status meanings:');
  console.log("  'delivered' or 'sent': carrier accepted, you should have received the SMS");
  console.log("  'failed' or 'undelivered': carrier rejected (check errorCode)");
  console.log("  'queued' or 'sending': still in flight, results inconclusive");
  console.log();
  console.log('Common errorCodes:');
  console.log('  30044: Canadian carrier A2P filtering (unregistered sender). The expected error in our current setup.');
  console.log('  30003: Unreachable destination (handset off, out of coverage)');
  console.log('  21610: Recipient unsubscribed (STOP keyword sent earlier)');
  console.log();
  console.log('What to look for: a clear difference in pass/fail across the 3 variants suggests content scoring matters.');
  console.log('Single-run results are anecdotal. Run this probe multiple times across different hours of the day to draw real conclusions.');
}

main().catch((err) => {
  console.error('\nProbe crashed:');
  console.error(err);
  process.exit(0);
});
