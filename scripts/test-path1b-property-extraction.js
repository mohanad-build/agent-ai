#!/usr/bin/env node
'use strict';

/**
 * Live verification for Path 1B property-extraction (commit a4fd6ed).
 *
 * Runs three fixtures (clean, property-shift, ambiguous) against real Haiku
 * and prints the extracted property reference + post-processing result + the
 * SMS body that would be sent. Does NOT touch the Sheet, send SMS, or hit
 * the orchestrator. Pure model-behavior verification.
 *
 * Usage: node scripts/test-path1b-property-extraction.js
 */

require('dotenv').config();

const prompts = require('../src/prompts');
const claude = require('../src/claude');
const twilio = require('../src/twilio');

const FIXTURES = [
  {
    label: 'A: Clean single-property (Yorkville)',
    leadName: 'Alex Park',
    leadEmail: 'alex.park@example.com',
    originalMessage: 'Hi, I saw your listing for 23 Yorkville Ave Unit 504 on Realtor.ca and I am very interested. Can you tell me more about it? Looking to view next week.',
    conversationHistory: [
      '[2026-05-18T14:00:00Z] inbound: I saw your listing for 23 Yorkville Ave Unit 504 on Realtor.ca and I am very interested. Can you tell me more about it?',
      '[2026-05-19T10:30:00Z] outbound: Hi Alex, happy to help. The Yorkville unit is a 1-bed 1-bath, 720 sqft, 899k. Currently available. Want to schedule a viewing?',
      '[2026-05-19T16:00:00Z] inbound: Yes, that works. What about parking?',
      '[2026-05-20T09:15:00Z] outbound: Yes, one parking spot included in maintenance fees. The locker is also included.',
    ].join('\n'),
    currentQuestion: 'What are the maintenance fees per month? And does the unit face north or south?',
    expectPass: (result) => result !== null && /yorkville/i.test(result),
    expectDescription: 'non-null, contains "Yorkville"',
  },
  {
    label: 'B: Property-shift (Bloor unavailable, moved to Church)',
    leadName: 'Jamie Liu',
    leadEmail: 'jamie.liu@example.com',
    originalMessage: 'Looking for a 2-bedroom condo downtown, under 800k. Saw 88 Bloor East Unit 1205 on your site, is it still available?',
    conversationHistory: [
      '[2026-05-15T11:00:00Z] inbound: Looking for a 2-bedroom condo downtown, under 800k. Saw 88 Bloor East Unit 1205 on your site, is it still available?',
      '[2026-05-15T15:30:00Z] outbound: Hi Jamie, unfortunately 88 Bloor East 1205 went under contract last week. I have a similar option that just listed: 199 Church St Unit 808, 2-bed, 785k, also downtown. Want details?',
      '[2026-05-16T09:00:00Z] inbound: Sure, send me the details on Church St.',
      '[2026-05-17T14:00:00Z] outbound: 199 Church St Unit 808 is 850 sqft, south-facing, with a balcony. Built 2019. Maintenance 640 per month including water and one parking spot. Asking 785k.',
      '[2026-05-18T20:00:00Z] inbound: Looks promising. Can we view this weekend?',
      '[2026-05-19T08:30:00Z] outbound: Saturday 2pm works. I will book it.',
    ].join('\n'),
    currentQuestion: 'Hey, quick question before Saturday, what is the kitchen like? Renovated or original?',
    expectPass: (result) => result !== null && /church/i.test(result) && !/bloor/i.test(result),
    expectDescription: 'non-null, contains "Church", does NOT contain "Bloor"',
  },
  {
    label: 'C: Ambiguous (first-time buyer, no specific property)',
    leadName: 'Sam Rodriguez',
    leadEmail: 'sam.rodriguez@example.com',
    originalMessage: 'Hi, I am thinking about buying my first home in Toronto this year. Wondering if you could help me figure out what is realistic for my budget.',
    conversationHistory: [
      '[2026-05-10T13:00:00Z] inbound: Hi, I am thinking about buying my first home in Toronto this year. Wondering if you could help me figure out what is realistic for my budget.',
      '[2026-05-11T10:00:00Z] outbound: Hi Sam, happy to help. What is your budget range and which neighborhoods are you considering?',
      '[2026-05-12T19:00:00Z] inbound: Probably 600 to 750k. Open to east end, west end, anywhere with a transit connection. First-time buyer so still figuring it out.',
      '[2026-05-13T08:00:00Z] outbound: Got it. I will send a few options across different neighborhoods so you can compare. Are you pre-approved?',
    ].join('\n'),
    currentQuestion: 'Not yet pre-approved but starting that process. In the meantime, what should I be looking out for in a building? Like what makes a good vs bad condo to buy?',
    expectPass: (result) => result === null,
    expectDescription: 'null (unclear)',
  },
];

async function runFixture(fix, index) {
  const num = index + 1;
  console.log('\n========================================');
  console.log('Fixture ' + num + ' of ' + FIXTURES.length + ': ' + fix.label);
  console.log('========================================');
  console.log('Lead: ' + fix.leadName + ' (' + fix.leadEmail + ')');
  console.log('Current question: ' + fix.currentQuestion);
  console.log('Original message: ' + fix.originalMessage.slice(0, 100) + (fix.originalMessage.length > 100 ? '...' : ''));
  console.log('Conversation history: ' + fix.conversationHistory.split('\n').length + ' lines');

  const promptObj = prompts.buildPropertyExtractionPrompt({
    originalMessage: fix.originalMessage,
    conversationHistory: fix.conversationHistory,
    currentQuestion: fix.currentQuestion,
  });

  let rawOutput = null;
  let extractError = null;
  try {
    rawOutput = await claude.callRaw({
      system: promptObj.system,
      user: promptObj.user,
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 100,
    });
  } catch (err) {
    extractError = err.message;
  }

  if (extractError) {
    console.log('\nRAW HAIKU OUTPUT: (extraction threw: ' + extractError + ')');
    console.log('POST-PROCESSED:   null');
    console.log('SMS BODY:         (would omit "about" clause)');
    const pass = fix.expectPass(null);
    console.log('EXPECTED:         ' + fix.expectDescription);
    console.log('VERDICT:          ' + (pass ? 'PASS' : 'FAIL'));
    return { label: fix.label, pass };
  }

  const trimmed = (rawOutput || '').trim().slice(0, 60);
  const postProcessed = (trimmed && trimmed.toLowerCase() !== 'unclear') ? trimmed : null;

  const smsBody = twilio.TEMPLATES.leadPropertyQuestion(
    fix.leadName,
    fix.leadEmail,
    fix.currentQuestion,
    'Q99',
    { isFirstTouch: false, propertyReference: postProcessed }
  );

  console.log('\nRAW HAIKU OUTPUT: ' + JSON.stringify(rawOutput));
  console.log('POST-PROCESSED:   ' + (postProcessed === null ? 'null (unclear)' : JSON.stringify(postProcessed)));
  console.log('\n--- SMS BODY ---');
  console.log(smsBody);
  console.log('--- end SMS ---');

  const pass = fix.expectPass(postProcessed);
  console.log('\nEXPECTED:         ' + fix.expectDescription);
  console.log('VERDICT:          ' + (pass ? 'PASS' : 'FAIL'));
  return { label: fix.label, pass };
}

async function main() {
  console.log('Path 1B property-extraction live verification');
  console.log('Model: claude-haiku-4-5-20251001');
  console.log('Fixtures: ' + FIXTURES.length);

  const results = [];
  for (let i = 0; i < FIXTURES.length; i++) {
    const r = await runFixture(FIXTURES[i], i);
    results.push(r);
  }

  console.log('\n\n========================================');
  console.log('SUMMARY');
  console.log('========================================');
  results.forEach((r) => {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.label);
  });
  const passCount = results.filter((r) => r.pass).length;
  console.log('\n' + passCount + ' of ' + results.length + ' fixtures passed.');
  process.exit(passCount === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error('Script crashed:', err);
  process.exit(2);
});
