// scripts/test-prompts.js
// Sanity test for src/prompts.js: exercises buildCategorizationPrompt and all
// drafting prompt builders with fake reply scenarios and prints results.
// No API calls. Pure prompt-string inspection.

const { loadAgent } = require('../src/agentConfig');
const {
  buildCategorizationPrompt,
  buildPath1ADraftPrompt,
  buildPath1BDraftPrompt,
  buildPath3DraftPrompt,
  buildSignoffInstructions,
  BASELINE_AI_CANNOT_INVENT,
  buildCannotInventList,
} = require('../src/prompts');

const FAKE_REPLIES = [
  {
    label: 'Obvious answer_general',
    text: 'Hi, quick question — how does the pre-approval process work? I have never bought a house before.',
  },
  {
    label: 'Obvious answer_property_specific',
    text: 'How many bedrooms does the place on Maple have, and what is the asking price?',
  },
  {
    label: 'Obvious hot_signal',
    text: 'I want to book a showing this weekend if possible. Saturday afternoon works best.',
  },
  {
    label: 'Obvious stop_signal',
    text: 'Hey, please take me off your list. We ended up going with another agent. Thanks.',
  },
  {
    label: 'Tricky / ambiguous',
    text: 'Look, I am frustrated. We have been looking for 6 months and nothing is working. Is the market always like this? My wife thinks we should give up. What would you do?',
  },
];

function divider(char = '=', length = 80) {
  return char.repeat(length);
}

function main() {
  const agent = loadAgent('mo-test');

  console.log(divider('='));
  console.log('PROMPTS.JS SANITY TEST');
  console.log(divider('='));
  console.log();
  console.log(`Agent: ${agent.agentName} (${agent.agentId})`);
  console.log(`Brokerage: ${agent.brokerage}, ${agent.brokerageLocation}`);
  console.log();

  console.log(divider('-'));
  console.log('CHECK 1: Cannot-invent list (baseline + agent additions)');
  console.log(divider('-'));
  console.log(`Baseline items: ${BASELINE_AI_CANNOT_INVENT.length}`);
  console.log(`Agent additions: ${(agent.aiCannotInvent || []).length}`);
  console.log();
  console.log('Merged list as it will appear in prompt:');
  console.log(buildCannotInventList(agent));
  console.log();

  console.log(divider('-'));
  console.log('CHECK 2: System prompt for one fake reply');
  console.log('(This is what every categorization call will look like.)');
  console.log(divider('-'));
  const sample = buildCategorizationPrompt(agent, FAKE_REPLIES[0].text);
  console.log('--- SYSTEM ---');
  console.log(sample.system);
  console.log();
  console.log('--- USER ---');
  console.log(sample.user);
  console.log();

  console.log(divider('-'));
  console.log('CHECK 3: User-prompt rendering for all 5 fake replies');
  console.log('(Spot-check that each email text drops in cleanly.)');
  console.log(divider('-'));
  FAKE_REPLIES.forEach(({ label, text }, i) => {
    const { user } = buildCategorizationPrompt(agent, text);
    console.log(`\n[${i + 1}] ${label}`);
    console.log(user);
  });

  console.log(divider('-'));
  console.log('CHECK 4: Sign-off instructions, both branches');
  console.log(divider('-'));
  console.log('\n--- WITH Gmail signature (hasGmailSignature = true) ---');
  console.log(buildSignoffInstructions(agent, true));
  console.log('\n--- WITHOUT Gmail signature (hasGmailSignature = false) ---');
  console.log(buildSignoffInstructions(agent, false));
  console.log();

  const fakeLeadContext = {
    name: 'Sarah Chen',
    originalInquiry: 'Looking for a 2BR condo in Yorkville, budget around $1.4M',
    status: 'in_conversation',
  };

  console.log(divider('-'));
  console.log('CHECK 5: Path 1A drafting prompt (answer_general)');
  console.log('Scenario: lead asks how pre-approval works');
  console.log(divider('-'));
  const path1A = buildPath1ADraftPrompt(
    agent,
    'Hi, quick question, how does the pre-approval process actually work? I have not bought before.',
    fakeLeadContext,
    true
  );
  console.log('--- SYSTEM ---');
  console.log(path1A.system);
  console.log('\n--- USER ---');
  console.log(path1A.user);
  console.log();

  console.log(divider('-'));
  console.log('CHECK 6: Path 1B drafting prompt (answer_property_specific completion)');
  console.log('Scenario: lead asked about bedrooms and price, agent SMSed back terse answer');
  console.log(divider('-'));
  const path1B = buildPath1BDraftPrompt(
    agent,
    'How many bedrooms does the place on Maple have, and what is the asking price?',
    '3BR plus den, 1850 sqft, $1.2M asking',
    fakeLeadContext,
    true
  );
  console.log('--- SYSTEM ---');
  console.log(path1B.system);
  console.log('\n--- USER ---');
  console.log(path1B.user);
  console.log();

  console.log(divider('-'));
  console.log('CHECK 7: Path 3 drafting prompt, WITH optOutReason');
  console.log('Scenario: lead says they already bought a home');
  console.log(divider('-'));
  const path3WithReason = buildPath3DraftPrompt(
    agent,
    { name: 'Sarah Chen', optOutReason: 'We ended up buying a place last month' },
    true
  );
  console.log('--- SYSTEM ---');
  console.log(path3WithReason.system);
  console.log('\n--- USER ---');
  console.log(path3WithReason.user);
  console.log();

  console.log(divider('-'));
  console.log('CHECK 8: Path 3 drafting prompt, WITHOUT optOutReason');
  console.log('Scenario: lead just says "please remove me" with no context');
  console.log(divider('-'));
  const path3NoReason = buildPath3DraftPrompt(
    agent,
    { name: 'Sarah Chen' },
    true
  );
  console.log('--- SYSTEM ---');
  console.log(path3NoReason.system);
  console.log('\n--- USER ---');
  console.log(path3NoReason.user);
  console.log();

  console.log(divider('-'));
  console.log('CHECK 9: Path 1A with hasGmailSignature = false (fallback sign-off)');
  console.log('Scenario: same as CHECK 5 but no Gmail signature configured');
  console.log(divider('-'));
  const path1AFallback = buildPath1ADraftPrompt(
    agent,
    'Hi, quick question, how does the pre-approval process actually work?',
    fakeLeadContext,
    false
  );
  console.log('--- SIGN-OFF SECTION ONLY (search for SIGN-OFF in system prompt) ---');
  const signoffMatch = path1AFallback.system.match(/SIGN-OFF:[\s\S]*?(?=\n\nBANNED PHRASES)/);
  console.log(signoffMatch ? signoffMatch[0] : '(could not extract sign-off section)');
  console.log();

  console.log(divider('='));
  console.log('Test complete. Read the output above and confirm:');
  console.log('  1. Agent context (CHECK 2 system prompt) reads correctly');
  console.log('  2. Cannot-invent list (CHECK 1) has baseline + 4 agent items');
  console.log('  3. Each fake reply (CHECK 3) renders inside the user prompt cleanly');
  console.log('  4. No obvious formatting bugs, missing fields, or undefined values');
  console.log('  5. Sign-off branches (CHECK 4) differ correctly between true and false');
  console.log('  6. Path 1A (CHECK 5) renders agent context, word range, salutation, sign-off all correctly');
  console.log('  7. Path 1B (CHECK 6) shows the no-fabrication rule TWICE (top and bottom of system prompt)');
  console.log('  8. Path 3 with reason (CHECK 7) tells model to reference reason warmly');
  console.log('  9. Path 3 without reason (CHECK 8) tells model to keep generic');
  console.log(' 10. Path 1A fallback (CHECK 9) sign-off contains brokerage and location, not just name');
  console.log(divider('='));
}

main();
