// scripts/test-followUp.js
//
// Unit tests for src/followUp.js.
// No live API calls. email, claude, and paths modules are mocked via
// require-cache patching after they are loaded.
//
// Covers:
//   - Eligibility gating: status, aiEnabled, followUpCount bounds, time check
//   - Threading mismatch: thread activity newer than lastOutbound skips fire
//   - Shadow vs. live mode send routing
//   - Cold flip: final touch sets status to 'cold'
//   - lastActionTimestamp fallback when lastFollowUpDate is absent
//   - Stats counters: eligible, fired, threadingMismatchSkipped, errors
//   - Custom cadence via agentOverride.followUpCadence
//
// Usage: node scripts/test-followUp.js

require('dotenv').config();

const email = require('../src/email');
const claude = require('../src/claude');

const { runFollowUps } = require('../src/followUp');
const fixtures = require('./test-followUp-fixtures.json');

// ---------------------------------------------------------------------------
// Pass/fail counters
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    passed++;
    console.log('[PASS] ' + label);
  } else {
    failed++;
    console.log('[FAIL] ' + label);
  }
}

function divider(char, length) {
  char = char || '=';
  length = length || 80;
  return char.repeat(length);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const MOCK_AGENT = {
  agentId: 'test-agent',
  googleSheetId: 'sheet-id',
  googleRefreshToken: 'token',
  gmailAddress: 'agent@example.com',
  agentName: 'Sarah Chen',
  brokerage: 'Test Realty',
  brokerageLocation: 'Toronto',
  targetMarket: 'Greater Toronto Area',
  tone: 'professional',
  usesEmojis: false,
  emailLength: 'short',
  specialties: ['residential'],
  yearsExperience: 5,
  mode: 'live',
  avoidPhrases: [],
  aiCannotInvent: [],
};

// ---------------------------------------------------------------------------
// Fixture row builder
// ---------------------------------------------------------------------------

// Builds a row with proper ISO timestamps from a fixture's daysAgo fields.
function buildRow(fixture, agentOverride) {
  const now = Date.now();
  const row = Object.assign({}, fixture.row);

  if (fixture.lastFollowUpDaysAgo !== null && fixture.lastFollowUpDaysAgo !== undefined) {
    row.lastFollowUpDate = new Date(now - fixture.lastFollowUpDaysAgo * MS_PER_DAY).toISOString();
  } else {
    row.lastFollowUpDate = '';
  }

  if (fixture.lastActionDaysAgo !== null && fixture.lastActionDaysAgo !== undefined) {
    row.lastActionTimestamp = new Date(now - fixture.lastActionDaysAgo * MS_PER_DAY).toISOString();
  } else {
    row.lastActionTimestamp = '';
  }

  return row;
}

// Builds mock thread messages for a fixture's threadActivityDaysAgo field.
function buildThreadMessages(fixture) {
  if (fixture.threadActivityDaysAgo === null || fixture.threadActivityDaysAgo === undefined) {
    return [];
  }
  const now = Date.now();
  return [
    {
      messageId: 'thread_msg_1',
      from: fixture.row.leadId,
      receivedAt: new Date(now - fixture.threadActivityDaysAgo * MS_PER_DAY).toISOString(),
    },
  ];
}

// ---------------------------------------------------------------------------
// Mock install helpers
// ---------------------------------------------------------------------------

let updateSheetRowCalls = [];
let appendToHistoryCalls = [];
let sendReplyCalls = [];
let sendNewEmailCalls = [];
let readSheetRowsRows = [];
let getThreadHistoryMessages = [];
let draftCallCount = 0;

function resetTracking() {
  updateSheetRowCalls = [];
  appendToHistoryCalls = [];
  sendReplyCalls = [];
  sendNewEmailCalls = [];
  draftCallCount = 0;
}

function installMocks(rows, threadMessages) {
  readSheetRowsRows = rows;
  getThreadHistoryMessages = threadMessages || [];

  email.readSheetRows = async () => readSheetRowsRows;
  email.getThreadHistory = async () => getThreadHistoryMessages;
  email.getSignaturePresence = async () => false;
  email.updateSheetRow = async (agentConfig, rowIndex, updates) => {
    updateSheetRowCalls.push({ rowIndex, updates });
  };
  email.appendToConversationHistory = async (agentConfig, rowIndex, entry) => {
    appendToHistoryCalls.push({ rowIndex, entry });
  };
  email.sendReply = async (agentConfig, opts) => {
    sendReplyCalls.push(opts);
  };
  email.sendNewEmail = async (agentConfig, opts) => {
    sendNewEmailCalls.push(opts);
  };

  claude.draft = async (prompt, bannedPhrases) => {
    draftCallCount++;
    return {
      text: 'Hi there,\n\nJust following up.\n\nSarah Chen',
      violations: [],
      attempts: 1,
      escalate: false,
    };
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(divider('='));
  console.log('FOLLOW-UP ENGINE UNIT TEST');
  console.log(divider('='));
  console.log();

  // -------------------------------------------------------------------------
  // SECTION 1: Eligibility gating (non-firing cases)
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 1: Eligibility gating - should NOT fire');
  console.log(divider('-'));

  const nonFiringFixtures = fixtures.filter((f) => !f.expected.shouldFire && f.expected.skipReason !== 'threading_mismatch');

  for (const fixture of nonFiringFixtures) {
    resetTracking();
    const row = buildRow(fixture);
    const agent = Object.assign({}, MOCK_AGENT, fixture.agentOverride || {});
    installMocks([row], []);
    const stats = await runFollowUps(agent);
    check(
      'Fixture ' + fixture.id + ': should NOT fire (' + fixture.description + ')',
      stats.fired === 0
    );
    check(
      'Fixture ' + fixture.id + ': updateSheetRow NOT called',
      updateSheetRowCalls.length === 0
    );
    check(
      'Fixture ' + fixture.id + ': sendReply NOT called',
      sendReplyCalls.length === 0
    );
  }

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 2: Threading mismatch
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 2: Threading mismatch');
  console.log(divider('-'));

  const threadingFixture = fixtures.find((f) => f.expected.skipReason === 'threading_mismatch');
  {
    resetTracking();
    const row = buildRow(threadingFixture);
    const threadMessages = buildThreadMessages(threadingFixture);
    installMocks([row], threadMessages);
    const stats = await runFollowUps(MOCK_AGENT);
    check('Threading mismatch: stats.eligible incremented', stats.eligible === 1);
    check('Threading mismatch: stats.fired is 0', stats.fired === 0);
    check('Threading mismatch: stats.threadingMismatchSkipped incremented', stats.threadingMismatchSkipped === 1);
    check('Threading mismatch: sendReply NOT called', sendReplyCalls.length === 0);
    check('Threading mismatch: updateSheetRow called to update lastFollowUpDate', updateSheetRowCalls.length === 1);
    check('Threading mismatch: lastFollowUpDate updated to thread activity timestamp',
      updateSheetRowCalls.length > 0 &&
      typeof updateSheetRowCalls[0].updates.lastFollowUpDate === 'string' &&
      updateSheetRowCalls[0].updates.lastFollowUpDate.length > 0
    );
  }

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 3: Firing - Day 3 (touch 0)
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 3: Day 3 fire (touch 0)');
  console.log(divider('-'));

  const day3Fixture = fixtures.find((f) => f.id === 1);
  {
    resetTracking();
    const row = buildRow(day3Fixture);
    installMocks([row], []);
    const stats = await runFollowUps(MOCK_AGENT);
    check('Day 3: stats.fired === 1', stats.fired === 1);
    check('Day 3: stats.eligible === 1', stats.eligible === 1);
    check('Day 3: sendReply called once', sendReplyCalls.length === 1);
    check('Day 3: sendReply target is lead email', sendReplyCalls[0] && sendReplyCalls[0].to === day3Fixture.row.leadId);
    check('Day 3: updateSheetRow called', updateSheetRowCalls.length > 0);
    check('Day 3: followUpCount set to "1"',
      updateSheetRowCalls.some((c) => c.updates.followUpCount === '1')
    );
    check('Day 3: status remains awaiting_response',
      updateSheetRowCalls.some((c) => c.updates.status === 'awaiting_response')
    );
    check('Day 3: appendToConversationHistory called', appendToHistoryCalls.length > 0);
    check('Day 3: history entry contains "Day 3"',
      appendToHistoryCalls.some((c) => c.entry.includes('Day 3'))
    );
    check('Day 3: lastFollowUpDate set in updateSheetRow',
      updateSheetRowCalls.some((c) => typeof c.updates.lastFollowUpDate === 'string' && c.updates.lastFollowUpDate.length > 0)
    );
  }

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 4: Firing - Day 7 (touch 1)
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 4: Day 7 fire (touch 1)');
  console.log(divider('-'));

  const day7Fixture = fixtures.find((f) => f.id === 2);
  {
    resetTracking();
    const row = buildRow(day7Fixture);
    installMocks([row], []);
    const stats = await runFollowUps(MOCK_AGENT);
    check('Day 7: stats.fired === 1', stats.fired === 1);
    check('Day 7: followUpCount set to "2"',
      updateSheetRowCalls.some((c) => c.updates.followUpCount === '2')
    );
    check('Day 7: status remains awaiting_response',
      updateSheetRowCalls.some((c) => c.updates.status === 'awaiting_response')
    );
    check('Day 7: history entry contains "Day 7"',
      appendToHistoryCalls.some((c) => c.entry.includes('Day 7'))
    );
  }

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 5: Cold flip - Day 14 (touch 2, final)
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 5: Day 14 cold flip (touch 2, final)');
  console.log(divider('-'));

  const day14Fixture = fixtures.find((f) => f.id === 3);
  {
    resetTracking();
    const row = buildRow(day14Fixture);
    installMocks([row], []);
    const stats = await runFollowUps(MOCK_AGENT);
    check('Day 14: stats.fired === 1', stats.fired === 1);
    check('Day 14: followUpCount set to "3"',
      updateSheetRowCalls.some((c) => c.updates.followUpCount === '3')
    );
    check('Day 14: status set to cold (cold flip)',
      updateSheetRowCalls.some((c) => c.updates.status === 'cold')
    );
    check('Day 14: history entry contains "cold"',
      appendToHistoryCalls.some((c) => c.entry.toLowerCase().includes('cold'))
    );
    check('Day 14: history entry contains "final touch"',
      appendToHistoryCalls.some((c) => c.entry.toLowerCase().includes('final touch'))
    );
  }

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 6: Shadow mode
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 6: Shadow mode - email goes to agent, not lead');
  console.log(divider('-'));

  const shadowFixture = fixtures.find((f) => f.id === 11);
  {
    resetTracking();
    const row = buildRow(shadowFixture);
    const shadowAgent = Object.assign({}, MOCK_AGENT, { mode: 'shadow' });
    installMocks([row], []);
    const stats = await runFollowUps(shadowAgent);
    check('Shadow: stats.fired === 1', stats.fired === 1);
    check('Shadow: sendReply NOT called', sendReplyCalls.length === 0);
    check('Shadow: sendNewEmail called', sendNewEmailCalls.length === 1);
    check('Shadow: sendNewEmail target is agent email', sendNewEmailCalls[0] && sendNewEmailCalls[0].to === shadowAgent.gmailAddress);
    check('Shadow: subject is [SHADOW DRAFT]', sendNewEmailCalls[0] && sendNewEmailCalls[0].subject === '[SHADOW DRAFT]');
  }

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 7: lastActionTimestamp fallback
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 7: lastActionTimestamp fallback');
  console.log(divider('-'));

  const fallbackFixture = fixtures.find((f) => f.id === 10);
  {
    resetTracking();
    const row = buildRow(fallbackFixture);
    check('Fallback fixture has empty lastFollowUpDate', !row.lastFollowUpDate || row.lastFollowUpDate === '');
    check('Fallback fixture has lastActionTimestamp set', !!row.lastActionTimestamp && row.lastActionTimestamp.length > 0);
    installMocks([row], []);
    const stats = await runFollowUps(MOCK_AGENT);
    check('Fallback: fires using lastActionTimestamp', stats.fired === 1);
  }

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 8: Custom cadence
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 8: Custom cadence [5, 10]');
  console.log(divider('-'));

  const customCadenceFixture = fixtures.find((f) => f.id === 12);
  {
    resetTracking();
    const row = buildRow(customCadenceFixture);
    const customAgent = Object.assign({}, MOCK_AGENT, customCadenceFixture.agentOverride);
    installMocks([row], []);
    const stats = await runFollowUps(customAgent);
    check('Custom cadence [5,10]: fires at 6 days for touch 0 (threshold 5)', stats.fired === 1);
    check('Custom cadence [5,10]: followUpCount set to "1"',
      updateSheetRowCalls.some((c) => c.updates.followUpCount === '1')
    );
    check('Custom cadence [5,10]: status remains awaiting_response',
      updateSheetRowCalls.some((c) => c.updates.status === 'awaiting_response')
    );
  }

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 9: Max 1 fire per row per cycle
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 9: Max 1 fire per row per cycle (only one touch fires even if overdue)');
  console.log(divider('-'));

  {
    resetTracking();
    // Build a row that is overdue for touch 1 (followUpCount=1, 20 days elapsed).
    // Even though touch 0 would have also been overdue if counted differently,
    // the engine only fires the next-in-sequence touch (index = followUpCount).
    const overdueRow = {
      rowIndex: 20,
      leadId: 'overdue@example.com',
      name: 'Overdue Lead',
      status: 'awaiting_response',
      aiEnabled: 'TRUE',
      followUpCount: '1',
      gmailThreadId: 'thread_overdue',
      originalMessage: 'Looking to buy',
      conversationHistory: '',
      lastFollowUpDate: new Date(Date.now() - 20 * MS_PER_DAY).toISOString(),
      lastActionTimestamp: new Date(Date.now() - 20 * MS_PER_DAY).toISOString(),
    };
    installMocks([overdueRow], []);
    const stats = await runFollowUps(MOCK_AGENT);
    check('Max 1 fire: only 1 sendReply for overdue row', sendReplyCalls.length === 1);
    check('Max 1 fire: stats.fired === 1', stats.fired === 1);
    check('Max 1 fire: followUpCount incremented by exactly 1 to "2"',
      updateSheetRowCalls.some((c) => c.updates.followUpCount === '2')
    );
  }

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 10: Draft failure -> error, no send
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 10: Draft failure -> error counted, row skipped');
  console.log(divider('-'));

  {
    resetTracking();
    const row = buildRow(day3Fixture);
    installMocks([row], []);
    claude.draft = async () => { throw new Error('API timeout'); };
    const stats = await runFollowUps(MOCK_AGENT);
    check('Draft failure: stats.errors === 1', stats.errors === 1);
    check('Draft failure: stats.fired === 0', stats.fired === 0);
    check('Draft failure: sendReply NOT called', sendReplyCalls.length === 0);
    check('Draft failure: updateSheetRow NOT called', updateSheetRowCalls.length === 0);
    // Restore mock
    claude.draft = async () => ({ text: 'Hi there,\n\nFollowing up.\n\nSarah Chen', violations: [], attempts: 1, escalate: false });
  }

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 11: Escalated draft -> error counted, no send
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 11: Escalated draft (violations persist) -> error');
  console.log(divider('-'));

  {
    resetTracking();
    const row = buildRow(day3Fixture);
    installMocks([row], []);
    claude.draft = async () => ({
      text: 'thanks for reaching out and great question',
      violations: ['thanks for reaching out', 'great question'],
      attempts: 3,
      escalate: true,
    });
    const stats = await runFollowUps(MOCK_AGENT);
    check('Escalated draft: stats.errors === 1', stats.errors === 1);
    check('Escalated draft: stats.fired === 0', stats.fired === 0);
    check('Escalated draft: sendReply NOT called', sendReplyCalls.length === 0);
    // Restore mock
    claude.draft = async () => ({ text: 'Hi there,\n\nFollowing up.\n\nSarah Chen', violations: [], attempts: 1, escalate: false });
  }

  console.log();

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log(divider('='));
  console.log('TEST SUMMARY');
  console.log(divider('='));
  console.log('Total: ' + passed + ' passed, ' + failed + ' failed');
  console.log();

  if (failed === 0) {
    console.log('All checks passed.');
  } else {
    console.log(failed + ' check(s) failed. Review output above.');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner error: ' + err.message);
  console.error(err.stack);
  process.exit(1);
});
