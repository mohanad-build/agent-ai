// scripts/iterate-prompts.js
//
// Offline iteration harness for follow-up and Path 1A drafting prompts.
// Runs production prompt builders against synthetic lead fixtures and
// prints resulting drafts. Pure offline except for live Claude API calls.
// No Gmail, no Sheets, no state changes.
//
// Usage:
//   node scripts/iterate-prompts.js followup <fixture> <day>
//     fixture: A | B | C
//     day: 3 | 7 | 14
//     example: node scripts/iterate-prompts.js followup A 3
//
//   node scripts/iterate-prompts.js path1a <fixture>
//     fixture: 1 | 2 | 3
//     example: node scripts/iterate-prompts.js path1a 2
//
//   node scripts/iterate-prompts.js all
//     runs all 3 follow-up fixtures x 3 days (9 drafts)
//     + all 3 path1a fixtures (3 drafts) = 12 total Claude calls

require('dotenv').config();

const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadAgent } = require('../src/agentConfig');
const claude = require('../src/claude');
const prompts = require('../src/prompts');
const FIXTURES = require('./iterate-prompts-fixtures.json');

const DIVIDER = '='.repeat(60);
const SEPARATOR = '-'.repeat(60);

// ---------------------------------------------------------------------------
// File output
// ---------------------------------------------------------------------------

function draftFilePath(mode, fixtureId, variant) {
  const name = `iterate-prompts-${mode}-${fixtureId}-${variant}.txt`;
  return path.join(os.tmpdir(), name);
}

function writeDraft(filePath, text) {
  fs.writeFileSync(filePath, text, 'utf8');
}

// ---------------------------------------------------------------------------
// Follow-up runner
// ---------------------------------------------------------------------------

async function runFollowup(fixtureId, day, agentConfig) {
  const fixture = FIXTURES.followup[fixtureId];
  if (!fixture) {
    throw new Error('Unknown followup fixture: ' + fixtureId);
  }

  const validDays = [3, 7, 14];
  if (!validDays.includes(day)) {
    throw new Error('Invalid day: ' + day + '. Must be 3, 7, or 14.');
  }

  const row = { name: fixture.name, originalMessage: fixture.originalMessage };
  const conversationHistory = fixture.initialAgentReply || '';
  const hasGmailSignature = false;

  let prompt;
  if (day === 3) {
    prompt = prompts.buildFollowUpDay3Prompt(agentConfig, row, conversationHistory, hasGmailSignature);
  } else if (day === 7) {
    prompt = prompts.buildFollowUpDay7Prompt(agentConfig, row, conversationHistory, hasGmailSignature);
  } else {
    prompt = prompts.buildFollowUpDay14Prompt(agentConfig, row, conversationHistory, hasGmailSignature);
  }

  const variant = 'day' + day;
  const filePath = draftFilePath('followup', fixtureId, variant);

  const draft = await claude.callRaw({ system: prompt.system, user: prompt.user, maxTokens: 1024 });

  writeDraft(filePath, draft);

  console.log(DIVIDER);
  console.log('MODE: followup');
  console.log('FIXTURE: ' + fixtureId + ' — ' + fixture.name + ' — ' + fixture.description);
  console.log('DAY: ' + day);
  console.log('LEAD ORIGINAL: ' + fixture.originalMessage);
  console.log('DRAFT FILE: ' + filePath);
  console.log(SEPARATOR);
  console.log(draft);
  console.log(DIVIDER);
  console.log('');

  return { mode: 'followup', fixtureId, variant, filePath };
}

// ---------------------------------------------------------------------------
// Path 1A runner
// ---------------------------------------------------------------------------

async function runPath1a(fixtureId, agentConfig) {
  const fixture = FIXTURES.path1a[fixtureId];
  if (!fixture) {
    throw new Error('Unknown path1a fixture: ' + fixtureId);
  }

  const leadContext = {
    name: fixture.leadName,
    originalInquiry: fixture.originalInquiry,
    conversationHistory: fixture.conversationHistory,
  };
  const isFirstTouch = false;
  const hasGmailSignature = false;

  const prompt = prompts.buildPath1ADraftPrompt(
    agentConfig,
    fixture.replyMessage,
    leadContext,
    hasGmailSignature,
    isFirstTouch
  );

  const variant = 'reply';
  const filePath = draftFilePath('path1a', fixtureId, variant);

  const draft = await claude.callRaw({ system: prompt.system, user: prompt.user, maxTokens: 1024 });

  writeDraft(filePath, draft);

  console.log(DIVIDER);
  console.log('MODE: path1a');
  console.log('FIXTURE: ' + fixtureId + ' — ' + fixture.leadName + ' — ' + fixture.description);
  console.log('REPLY MESSAGE: ' + fixture.replyMessage);
  console.log('DRAFT FILE: ' + filePath);
  console.log(SEPARATOR);
  console.log(draft);
  console.log(DIVIDER);
  console.log('');

  return { mode: 'path1a', fixtureId, variant, filePath };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const [, , mode, fixtureArg, dayArg] = process.argv;

  if (!mode) {
    console.error('Usage:');
    console.error('  node scripts/iterate-prompts.js followup <A|B|C> <3|7|14>');
    console.error('  node scripts/iterate-prompts.js path1a <1|2|3>');
    console.error('  node scripts/iterate-prompts.js all');
    process.exit(1);
  }

  let agentConfig;
  try {
    agentConfig = loadAgent('mo-test');
  } catch (err) {
    console.error('Failed to load mo-test agent config: ' + err.message);
    process.exit(1);
  }

  if (mode === 'all') {
    const results = [];
    const followupFixtures = ['A', 'B', 'C'];
    const followupDays = [3, 7, 14];
    const path1aFixtures = ['1', '2', '3'];

    for (const fid of followupFixtures) {
      for (const day of followupDays) {
        try {
          const result = await runFollowup(fid, day, agentConfig);
          results.push(result);
        } catch (err) {
          console.error('Error followup ' + fid + ' day' + day + ': ' + err.message);
          results.push({ mode: 'followup', fixtureId: fid, variant: 'day' + day, filePath: null, error: err.message });
        }
      }
    }

    for (const fid of path1aFixtures) {
      try {
        const result = await runPath1a(fid, agentConfig);
        results.push(result);
      } catch (err) {
        console.error('Error path1a ' + fid + ': ' + err.message);
        results.push({ mode: 'path1a', fixtureId: fid, variant: 'reply', filePath: null, error: err.message });
      }
    }

    console.log(DIVIDER);
    console.log('SUMMARY — ' + results.length + ' drafts generated, file paths:');
    for (const r of results) {
      const label = r.mode === 'followup'
        ? 'followup ' + r.fixtureId + ' ' + r.variant + ':'
        : 'path1a ' + r.fixtureId + ' ' + r.variant + ':  ';
      const value = r.filePath || '(error: ' + r.error + ')';
      console.log('  ' + label.padEnd(22) + value);
    }
    console.log(DIVIDER);

    const errors = results.filter((r) => r.error);
    process.exit(errors.length > 0 ? 1 : 0);
    return;
  }

  if (mode === 'followup') {
    if (!fixtureArg || !dayArg) {
      console.error('Usage: node scripts/iterate-prompts.js followup <A|B|C> <3|7|14>');
      process.exit(1);
    }
    const day = parseInt(dayArg, 10);
    await runFollowup(fixtureArg, day, agentConfig);
    return;
  }

  if (mode === 'path1a') {
    if (!fixtureArg) {
      console.error('Usage: node scripts/iterate-prompts.js path1a <1|2|3>');
      process.exit(1);
    }
    await runPath1a(fixtureArg, agentConfig);
    return;
  }

  console.error('Unknown mode: ' + mode);
  console.error('Valid modes: followup, path1a, all');
  process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error: ' + err.message);
  console.error(err.stack);
  process.exit(1);
});
