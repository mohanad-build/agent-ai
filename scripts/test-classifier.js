// scripts/test-classifier.js
//
// Offline test harness for the Lead Intake heuristic classifier.
// Calls claude.callRaw with prompts.buildHeuristicClassifierPrompt against
// hand-built fixtures. No Gmail, no Sheets, no staging.
//
// Usage:
//   node scripts/test-classifier.js fixture4_brother
//   node scripts/test-classifier.js all

require('dotenv').config();

const { loadAgent } = require('../src/agentConfig');
const claude = require('../src/claude');
const prompts = require('../src/prompts');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURES = {
  fixture1_daniel: {
    name: 'Fixture 1: Daniel Chen (strong-signal lead)',
    expected: 'lead',
    senderName: 'Daniel Chen',
    senderEmail: 'daniel.chen@example.com',
    subject: 'Interested in your Davisville listing',
    body: `Hi Mo,

I'm Daniel Chen, saw your name on the listing for the 1-bedroom condo
near Davisville station. Is it still available? My wife and I are
relocating from Vancouver in late July and looking to lock something
down in the next few weeks.

Pre-approved up to $720k. Could we schedule a viewing this Saturday
afternoon if it's still on the market?

Thanks,
Daniel
416-555-0188`,
  },
  fixture2_weak: {
    name: 'Fixture 2: weak-signal lead (looking to buy)',
    expected: 'lead',
    senderName: 'Keith Lee',
    senderEmail: 'keith.lee@example.com',
    subject: 'looking to buy',
    body: `hey, are you taking new clients? thinking about buying my first
place in toronto somewhere downtown ish. no rush, just exploring.`,
  },
  fixture3_coffee: {
    name: 'Fixture 3: friendly personal email (NOT a lead)',
    expected: 'business_correspondence',
    senderName: 'Adam',
    senderEmail: 'adam@example.com',
    subject: 'Coffee next week?',
    body: `Mo, long time. You free for coffee Thursday or Friday afternoon? Want
to catch up, lots to share. Let me know.

Adam`,
  },
  fixture4_brother: {
    name: 'Fixture 4: SOI-adjacent friend mentioning real estate (NOT a lead)',
    expected: 'business_correspondence',
    senderName: 'Mohanad Mohamed',
    senderEmail: 'mohanad@auditex.ca',
    subject: 'quick q',
    body: `hey mo, my brother and his wife are thinking about buying in
leslieville sometime next year. nothing serious yet, just looking
around. is that area still going crazy or has it cooled off?
curious what you're seeing. no rush.

talk soon`,
  },
  fixture5_referral: {
    name: 'Fixture 5: explicit referral with contact info (lead)',
    expected: 'lead',
    senderName: 'Lisa Park',
    senderEmail: 'lisa.park@example.com',
    subject: 'My friend Sarah is looking',
    body: `Hi Mo,

My friend Sarah Patel is looking to buy a condo in the Annex. Her
number is 416-555-0234, she said you can call her anytime this week.
She's pre-approved and ready to move quickly.

Thanks,
Lisa`,
  },
  fixture6_industry: {
    name: 'Fixture 6: mortgage broker (business_correspondence)',
    expected: 'business_correspondence',
    senderName: 'Jamie Liu',
    senderEmail: 'jamie@samplelender.com',
    subject: 'New rate sheet for May',
    body: `Hi Mo,

Attaching this month's rate sheet for your buyers. Let me know if you
have any clients who need pre-approval, happy to fast-track.

Best,
Jamie Liu
Mortgage Agent, Sample Lender Inc.`,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function divider() {
  return '='.repeat(60);
}

function stripCodeFences(text) {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

async function runFixture(fixtureKey, agent) {
  const fixture = FIXTURES[fixtureKey];
  const prompt = prompts.buildHeuristicClassifierPrompt(
    fixture.subject,
    fixture.body,
    fixture.senderName,
    fixture.senderEmail
  );

  let rawText;
  try {
    rawText = await claude.callRaw({ system: prompt.system, user: prompt.user });
  } catch (err) {
    console.log(divider());
    console.log('FIXTURE: ' + fixtureKey);
    console.log('Expected: ' + fixture.expected);
    console.log('ERROR: API call failed: ' + err.message);
    console.log(divider());
    return { fixtureKey, pass: false, error: err.message };
  }

  let parsed;
  try {
    parsed = JSON.parse(stripCodeFences(rawText));
  } catch (err) {
    console.log(divider());
    console.log('FIXTURE: ' + fixtureKey);
    console.log('Expected: ' + fixture.expected);
    console.log('ERROR: JSON parse error');
    console.log('Raw response: ' + rawText);
    console.log(divider());
    return { fixtureKey, pass: false, error: 'JSON parse error' };
  }

  const got = parsed.category || '(missing)';
  const pass = got === fixture.expected;
  const passLabel = pass ? 'PASS' : 'FAIL';
  const confidence = typeof parsed.confidence === 'number'
    ? parsed.confidence.toFixed(2)
    : String(parsed.confidence || '');
  const reasoning = String(parsed.reasoning || '').trim();
  const extractedName = String(parsed.name || '');
  const extractedEmail = String(parsed.email || '');
  const extractedPhone = String(parsed.phone || '');
  const inquiry = String(parsed.inquiryMessage || '').slice(0, 80);

  console.log(divider());
  console.log('FIXTURE: ' + fixtureKey);
  console.log('Expected: ' + fixture.expected);
  console.log('Got:      ' + got + (pass ? '' : '          <- ' + passLabel));
  console.log('Confidence: ' + confidence);
  console.log('Reasoning: ' + reasoning);
  console.log('Extracted: name="' + extractedName + '" email="' + extractedEmail + '" phone="' + extractedPhone + '"');
  console.log('Inquiry: ' + inquiry);
  console.log(divider());

  return { fixtureKey, pass, got, expected: fixture.expected };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const arg = process.argv[2];

  if (!arg) {
    console.error('Usage: node scripts/test-classifier.js <fixture_name|all>');
    console.error('Available fixtures: ' + Object.keys(FIXTURES).join(', '));
    process.exit(1);
  }

  let agent;
  try {
    agent = loadAgent('mo-test');
  } catch (err) {
    console.error('Failed to load mo-test agent config: ' + err.message);
    process.exit(1);
  }

  if (arg === 'all') {
    const keys = Object.keys(FIXTURES);
    const results = [];
    for (const key of keys) {
      console.log('\n[' + FIXTURES[key].name + ']');
      try {
        const result = await runFixture(key, agent);
        results.push(result);
      } catch (err) {
        console.error('Unhandled error for ' + key + ': ' + err.message);
        results.push({ fixtureKey: key, pass: false, error: err.message });
      }
    }

    const passing = results.filter((r) => r.pass);
    const failing = results.filter((r) => !r.pass);

    console.log('\n' + divider());
    console.log('SUMMARY: ' + passing.length + '/' + results.length + ' fixtures match expected category');
    if (passing.length > 0) {
      console.log('PASS: ' + passing.map((r) => r.fixtureKey).join(', '));
    }
    for (const f of failing) {
      if (f.error) {
        console.log('FAIL: ' + f.fixtureKey + ' (error: ' + f.error + ')');
      } else {
        console.log('FAIL: ' + f.fixtureKey + ' (got ' + f.got + ', expected ' + f.expected + ')');
      }
    }
    console.log(divider());

    process.exit(failing.length > 0 ? 1 : 0);
  }

  if (!FIXTURES[arg]) {
    console.error('Unknown fixture: ' + arg);
    console.error('Available fixtures: ' + Object.keys(FIXTURES).join(', '));
    process.exit(1);
  }

  const result = await runFixture(arg, agent);
  process.exit(result.pass ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error: ' + err.message);
  console.error(err.stack);
  process.exit(1);
});
