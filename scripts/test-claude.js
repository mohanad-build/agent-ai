// scripts/test-claude.js
// Real-API integration test for src/claude.js.
// Exercises one categorization call (Haiku) and one drafting call (Sonnet)
// against the live Anthropic API. Costs roughly 2 to 4 cents per run.
//
// Usage: node scripts/test-claude.js
// Requires: ANTHROPIC_API_KEY in .env

require('dotenv').config();

const { loadAgent } = require('../src/agentConfig');
const {
  buildCategorizationPrompt,
  buildPath1ADraftPrompt,
  UNIVERSAL_BANNED_PHRASES,
  buildBannedPhrasesList,
} = require('../src/prompts');
const { categorize, draft } = require('../src/claude');

function divider(char = '=', length = 80) {
  return char.repeat(length);
}

const FAKE_REPLY = 'Hi, quick question, how does the pre-approval process actually work? I have not bought a house before.';

const FAKE_LEAD_CONTEXT = {
  name: 'Sarah Chen',
  originalInquiry: 'Looking for a 2BR condo in Yorkville, budget around $1.4M',
  status: 'in_conversation',
};

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY not set in .env');
    process.exit(1);
  }

  const agent = loadAgent('mo-test');

  console.log(divider('='));
  console.log('CLAUDE.JS REAL-API INTEGRATION TEST');
  console.log(divider('='));
  console.log(`Agent: ${agent.agentName} (${agent.agentId})`);
  console.log(`API key present: yes (length ${process.env.ANTHROPIC_API_KEY.length})`);
  console.log();

  // -----------------------------------------------------------------------
  // TEST 1: Categorization
  // -----------------------------------------------------------------------
  console.log(divider('-'));
  console.log('TEST 1: Categorization (Haiku)');
  console.log(`Fake reply: "${FAKE_REPLY}"`);
  console.log(divider('-'));

  const catPrompt = buildCategorizationPrompt(agent, FAKE_REPLY);

  const t1Start = Date.now();
  let catResult;
  try {
    catResult = await categorize(catPrompt);
  } catch (err) {
    console.error('CATEGORIZATION FAILED:');
    console.error(err.message);
    process.exit(1);
  }
  const t1Elapsed = Date.now() - t1Start;

  console.log(`Latency: ${t1Elapsed}ms`);
  console.log(`Category: ${catResult.category}`);
  console.log(`Confidence: ${catResult.confidence}`);
  console.log(`Reasoning: ${catResult.reasoning}`);
  console.log();

  // Sanity check: this should clearly be answer_general with high confidence.
  if (catResult.category !== 'answer_general') {
    console.warn(`WARNING: expected category "answer_general", got "${catResult.category}". Worth investigating but not a hard fail.`);
  }
  if (catResult.confidence < 0.7) {
    console.warn(`WARNING: confidence ${catResult.confidence} below 0.7 threshold. The orchestrator would downgrade this to needs_review.`);
  }

  // -----------------------------------------------------------------------
  // TEST 2: Drafting
  // -----------------------------------------------------------------------
  console.log(divider('-'));
  console.log('TEST 2: Drafting (Sonnet, Path 1A)');
  console.log(`Same fake reply, lead = Sarah Chen`);
  console.log(`hasGmailSignature = true (so sign-off should be just "Mohanad Mohamed")`);
  console.log(divider('-'));

  const draftPrompt = buildPath1ADraftPrompt(
    agent,
    FAKE_REPLY,
    FAKE_LEAD_CONTEXT,
    true
  );

  // Build the full banned phrases list as the orchestrator would.
  // Same dedupe logic that prompts.js uses internally.
  const bannedListString = buildBannedPhrasesList(agent);
  const bannedPhrases = bannedListString
    .split('\n')
    .map((line) => line.replace(/^- "/, '').replace(/"$/, ''))
    .filter(Boolean);

  console.log(`Banned phrases being checked (${bannedPhrases.length}):`);
  bannedPhrases.forEach((p) => console.log(`  - "${p}"`));
  console.log();

  const t2Start = Date.now();
  let draftResult;
  try {
    draftResult = await draft(draftPrompt, bannedPhrases);
  } catch (err) {
    console.error('DRAFTING FAILED:');
    console.error(err.message);
    process.exit(1);
  }
  const t2Elapsed = Date.now() - t2Start;

  console.log(`Latency: ${t2Elapsed}ms`);
  console.log(`Attempts: ${draftResult.attempts}`);
  console.log(`Violations: ${draftResult.violations.length === 0 ? 'none' : draftResult.violations.join(', ')}`);
  console.log(`Escalate: ${draftResult.escalate}`);
  console.log();
  console.log('--- DRAFT TEXT ---');
  console.log(draftResult.text);
  console.log('--- END DRAFT ---');
  console.log();

  // Word count check
  const wordCount = draftResult.text.trim().split(/\s+/).length;
  console.log(`Word count: ${wordCount} (target range for "short": 80-120)`);
  if (wordCount < 60 || wordCount > 160) {
    console.warn(`WARNING: word count ${wordCount} is well outside target range. Worth reviewing the draft.`);
  }
  console.log();

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log(divider('='));
  console.log('TESTS COMPLETE. Manual review checklist:');
  console.log(divider('='));
  console.log('  [ ] TEST 1 returned a valid category, confidence, reasoning');
  console.log('  [ ] TEST 2 produced an email draft, no errors thrown');
  console.log('  [ ] Draft starts with "Hi Sarah,"');
  console.log('  [ ] Draft ends with sign-off "Mohanad Mohamed" on its own line');
  console.log('  [ ] Draft answers the pre-approval question directly');
  console.log('  [ ] Draft contains a concrete next-step CTA, not "let me know"');
  console.log('  [ ] No em-dashes or en-dashes anywhere in the draft text');
  console.log('  [ ] No banned phrases (the violations field above shows "none")');
  console.log('  [ ] Tone matches "warm, professional, and concise"');
  console.log('  [ ] Reads like something a real agent could plausibly send');
  console.log();
  console.log('If anything fails the checklist, paste the draft text back and we will adjust.');
}

main().catch((err) => {
  console.error('UNEXPECTED ERROR:');
  console.error(err);
  process.exit(1);
});
