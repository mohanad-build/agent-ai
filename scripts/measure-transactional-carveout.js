// scripts/measure-transactional-carveout.js
//
// Measurement harness for commit 3 of the intake bundle: carving transactional
// mail (security alerts, 2FA codes, receipts, billing, service alerts) out of
// the noise category so it lands in business_correspondence instead.
//
// Runs the SAME classifier path production uses (buildHeuristicClassifierPrompt
// + claude.callRaw) against a fixed fixture set, live, no mocks. Intended to be
// run once before the prompt edit and once after, to compare.
//
// Usage: node scripts/measure-transactional-carveout.js

require('dotenv').config();

const claude = require('../src/claude');
const prompts = require('../src/prompts');
const leadIntake = require('../src/leadIntake');
const { parseClassifierResponse } = leadIntake._internal;

const FIXTURES = [
  {
    id: 'A',
    label: 'Google security alert',
    subject: 'Security alert: new sign-in on Mac',
    senderName: 'Google',
    senderEmail: 'no-reply@accounts.google.com',
    body: 'A new sign-in was detected on your Google Account from a Mac device in Toronto, Canada. If this was you, no action is needed. If not, secure your account immediately.',
  },
  {
    id: 'B',
    label: 'Login / 2FA code',
    subject: '247598 is your Railway login code',
    senderName: 'Railway',
    senderEmail: 'noreply@railway.app',
    body: 'Your Railway login verification code is 247598. This code expires in 10 minutes. If you did not request this, you can safely ignore this email.',
  },
  {
    id: 'C',
    label: 'Service / infrastructure alert',
    subject: 'Scheduled Volume Deletion: upcoming volume deletion in production',
    senderName: 'Railway',
    senderEmail: 'alerts@railway.app',
    body: 'A volume in your production environment is scheduled for deletion in 7 days due to inactivity. Log in to your dashboard to cancel this deletion if the volume is still in use.',
  },
  {
    id: 'D',
    label: 'Payment receipt',
    subject: 'Your receipt from Railway Corporation #2620-7820',
    senderName: 'Railway Corporation',
    senderEmail: 'receipts@railway.app',
    body: 'Thank you for your payment. Receipt #2620-7820. Amount charged: $20.00 USD to card ending in 4242. This is an automated confirmation of your recent transaction.',
  },
  {
    id: 'E',
    label: 'Billing / invoice notice',
    subject: 'Your monthly invoice is ready',
    senderName: 'DocuSign Billing',
    senderEmail: 'billing@docusign.com',
    body: 'Your monthly invoice for the period ending this month is now available. Total due: $45.00. Log in to your account to view and download the full invoice.',
  },
  {
    id: 'F',
    label: 'Password reset confirmation',
    subject: 'Your password has been changed',
    senderName: 'Dropbox',
    senderEmail: 'no-reply@dropbox.com',
    body: 'This is a confirmation that the password for your account was successfully changed. If you did not make this change, please reset your password immediately and contact support.',
  },
  {
    id: 'G',
    label: 'CONTROL: promotional newsletter (must stay noise)',
    subject: '50% off staging services this weekend only!',
    senderName: 'HomeStage Pro Marketing',
    senderEmail: 'deals@homestagepro-marketing.com',
    body: 'Limited time offer! Get 50% off all home staging packages this weekend only. Click here to book your consultation and make your listings shine. Unsubscribe at any time.',
  },
  {
    id: 'H',
    label: 'CONTROL: genuine inbound lead (must stay lead)',
    subject: 'Question about 45 Maple listing',
    senderName: 'Jane Doe',
    senderEmail: 'jane.doe@gmail.com',
    body: 'Hi, I saw your listing at 45 Maple Street on MLS and I am very interested. Is it still available? I would love to schedule a viewing this week if possible. Thanks, Jane',
  },
];

async function classifyFixture(fixture) {
  const prompt = prompts.buildHeuristicClassifierPrompt(
    fixture.subject,
    fixture.body,
    fixture.senderName,
    fixture.senderEmail
  );
  const rawText = await claude.callRaw({ system: prompt.system, user: prompt.user });
  const parsed = parseClassifierResponse(rawText);
  return parsed;
}

async function main() {
  const rows = [];
  for (const fixture of FIXTURES) {
    let result;
    try {
      result = await classifyFixture(fixture);
    } catch (err) {
      result = { category: 'ERROR', confidence: 0, reasoning: err.message };
    }
    rows.push({
      id: fixture.id,
      label: fixture.label,
      category: result.category,
      confidence: result.confidence,
      reasoning: result.reasoning,
    });
  }

  console.log('');
  console.log(
    'ID  | Fixture'.padEnd(56) + '| Category'.padEnd(28) + '| Confidence | Reasoning'
  );
  console.log('-'.repeat(140));
  for (const row of rows) {
    console.log(
      String(row.id).padEnd(4) +
        '| ' +
        row.label.padEnd(52) +
        '| ' +
        String(row.category).padEnd(26) +
        '| ' +
        String(row.confidence).padEnd(11) +
        '| ' +
        row.reasoning
    );
  }
  console.log('');
}

main().catch((err) => {
  console.error('Measurement run failed: ' + err.message);
  process.exit(1);
});
