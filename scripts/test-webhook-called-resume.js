// scripts/test-webhook-called-resume.js
//
// Unit tests for the CALLED and RESUME SMS commands in src/webhook.js.
// No live API calls. email and twilio modules are mocked via require-cache patching.
//
// Covers:
//   - CALLED <email>: sets status to manual_handling, sends confirmation SMS
//   - CALLED <Q-token>: finds row by pending question token, sets manual_handling
//   - CALLED <unknown>: sends not-found SMS, no sheet update
//   - CALLED with missing token (bare "CALLED"): sends format help SMS
//   - RESUME <email>: validates manual_handling, flips to awaiting_response, resets counters
//   - RESUME <email>: resets followUpCount to "0"
//   - RESUME <email>: resets lastFollowUpDate to now
//   - RESUME on non-manual_handling row: sends error SMS, no sheet update
//   - RESUME <unknown>: sends not-found SMS
//   - CALLED: logs to conversation history
//   - RESUME: logs to conversation history
//   - CALLED and RESUME never throw (error resilience)
//
// Usage: node scripts/test-webhook-called-resume.js

require('dotenv').config();

const emailModule = require('../src/email');
const twilioModule = require('../src/twilio');

const { handleCalledCommand, handleResumeCommand } = require('../src/webhook');

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
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_AGENT = {
  agentId: 'test-agent',
  googleSheetId: 'sheet-id',
  googleRefreshToken: 'token',
  agentName: 'Sarah Chen',
  gmailAddress: 'agent@example.com',
  agentPhone: '+16475550100',
};

const MANUAL_HANDLING_ROW = {
  rowIndex: 5,
  leadId: 'alice@example.com',
  name: 'Alice Johnson',
  status: 'manual_handling',
  followUpCount: '2',
  lastFollowUpDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  lastActionTimestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  pendingQuestion: '',
};

const AWAITING_RESPONSE_ROW = {
  rowIndex: 6,
  leadId: 'bob@example.com',
  name: 'Bob Martinez',
  status: 'awaiting_response',
  followUpCount: '1',
  lastFollowUpDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  lastActionTimestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  pendingQuestion: '[Q42] How many bedrooms does the Oak St listing have?',
};

const WARM_ROW = {
  rowIndex: 7,
  leadId: 'carol@example.com',
  name: 'Carol Lee',
  status: 'warm',
  followUpCount: '0',
  lastFollowUpDate: '',
  lastActionTimestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  pendingQuestion: '',
};

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

let updateSheetRowCalls = [];
let appendToHistoryCalls = [];
let smsSentBodies = [];
let sheetRows = [];

function resetTracking() {
  updateSheetRowCalls = [];
  appendToHistoryCalls = [];
  smsSentBodies = [];
}

function installMocks(rows) {
  sheetRows = rows;
  emailModule.readSheetRows = async () => sheetRows;
  emailModule.updateSheetRow = async (agentConfig, rowIndex, updates) => {
    updateSheetRowCalls.push({ rowIndex, updates });
  };
  emailModule.appendToConversationHistory = async (agentConfig, rowIndex, entry) => {
    appendToHistoryCalls.push({ rowIndex, entry });
  };
  twilioModule.sendSMS = async (agentConfig, body) => {
    smsSentBodies.push(body);
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(divider('='));
  console.log('WEBHOOK CALLED/RESUME UNIT TEST');
  console.log(divider('='));
  console.log();

  // -------------------------------------------------------------------------
  // SECTION 1: CALLED with email token
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 1: CALLED <email>');
  console.log(divider('-'));

  {
    resetTracking();
    installMocks([MANUAL_HANDLING_ROW, AWAITING_RESPONSE_ROW, WARM_ROW]);
    await handleCalledCommand(MOCK_AGENT, 'CALLED alice@example.com');
    check('CALLED email: updateSheetRow called', updateSheetRowCalls.length === 1);
    check('CALLED email: target row is correct rowIndex', updateSheetRowCalls[0].rowIndex === MANUAL_HANDLING_ROW.rowIndex);
    check('CALLED email: status set to manual_handling', updateSheetRowCalls[0].updates.status === 'manual_handling');
    check('CALLED email: lastActionTimestamp updated', typeof updateSheetRowCalls[0].updates.lastActionTimestamp === 'string' && updateSheetRowCalls[0].updates.lastActionTimestamp.length > 0);
    check('CALLED email: confirmation SMS sent', smsSentBodies.length === 1);
    check('CALLED email: SMS contains lead name', smsSentBodies[0].includes('Alice Johnson'));
    check('CALLED email: SMS contains lead email', smsSentBodies[0].includes('alice@example.com'));
    check('CALLED email: SMS contains "manual_handling"', smsSentBodies[0].includes('manual_handling'));
  }

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 2: CALLED with Q-token
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 2: CALLED <Q-token>');
  console.log(divider('-'));

  {
    resetTracking();
    installMocks([MANUAL_HANDLING_ROW, AWAITING_RESPONSE_ROW, WARM_ROW]);
    await handleCalledCommand(MOCK_AGENT, 'CALLED Q42');
    check('CALLED Q-token: updateSheetRow called', updateSheetRowCalls.length === 1);
    check('CALLED Q-token: target row is the awaiting_response row (has Q42)',
      updateSheetRowCalls.length > 0 && updateSheetRowCalls[0].rowIndex === AWAITING_RESPONSE_ROW.rowIndex
    );
    check('CALLED Q-token: status set to manual_handling',
      updateSheetRowCalls.length > 0 && updateSheetRowCalls[0].updates.status === 'manual_handling'
    );
    check('CALLED Q-token: SMS mentions lead name', smsSentBodies.length > 0 && smsSentBodies[0].includes('Bob Martinez'));
  }

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 3: CALLED with unknown email
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 3: CALLED <unknown email>');
  console.log(divider('-'));

  {
    resetTracking();
    installMocks([MANUAL_HANDLING_ROW, AWAITING_RESPONSE_ROW, WARM_ROW]);
    await handleCalledCommand(MOCK_AGENT, 'CALLED nobody@example.com');
    check('CALLED unknown: updateSheetRow NOT called', updateSheetRowCalls.length === 0);
    check('CALLED unknown: not-found SMS sent', smsSentBodies.length === 1);
    check('CALLED unknown: SMS says "not found"', smsSentBodies[0].toLowerCase().includes('not found'));
  }

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 4: CALLED with no token (bare "CALLED")
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 4: CALLED with no token');
  console.log(divider('-'));

  {
    resetTracking();
    installMocks([MANUAL_HANDLING_ROW]);
    await handleCalledCommand(MOCK_AGENT, 'CALLED');
    check('CALLED bare: updateSheetRow NOT called', updateSheetRowCalls.length === 0);
    check('CALLED bare: format help SMS sent', smsSentBodies.length === 1);
    check('CALLED bare: SMS mentions format', smsSentBodies[0].toLowerCase().includes('format'));
  }

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 5: CALLED logs to conversation history
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 5: CALLED logs to conversation history');
  console.log(divider('-'));

  {
    resetTracking();
    installMocks([MANUAL_HANDLING_ROW, AWAITING_RESPONSE_ROW, WARM_ROW]);
    await handleCalledCommand(MOCK_AGENT, 'CALLED alice@example.com');
    check('CALLED history: appendToConversationHistory called', appendToHistoryCalls.length === 1);
    check('CALLED history: entry mentions "called"', appendToHistoryCalls[0].entry.toLowerCase().includes('called'));
    check('CALLED history: entry mentions "manual_handling"', appendToHistoryCalls[0].entry.includes('manual_handling'));
  }

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 6: RESUME on manual_handling row
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 6: RESUME <email> on manual_handling row');
  console.log(divider('-'));

  const beforeResumeTime = Date.now();
  {
    resetTracking();
    installMocks([MANUAL_HANDLING_ROW, AWAITING_RESPONSE_ROW, WARM_ROW]);
    await handleResumeCommand(MOCK_AGENT, 'RESUME alice@example.com');
    check('RESUME: updateSheetRow called', updateSheetRowCalls.length === 1);
    check('RESUME: target row is manual_handling row', updateSheetRowCalls[0].rowIndex === MANUAL_HANDLING_ROW.rowIndex);
    check('RESUME: status set to awaiting_response', updateSheetRowCalls[0].updates.status === 'awaiting_response');
    check('RESUME: followUpCount reset to "0"', updateSheetRowCalls[0].updates.followUpCount === '0');
    check('RESUME: lastFollowUpDate set to now (within 2s)',
      typeof updateSheetRowCalls[0].updates.lastFollowUpDate === 'string' &&
      Math.abs(new Date(updateSheetRowCalls[0].updates.lastFollowUpDate).getTime() - beforeResumeTime) < 2000
    );
    check('RESUME: lastActionTimestamp updated', typeof updateSheetRowCalls[0].updates.lastActionTimestamp === 'string');
    check('RESUME: confirmation SMS sent', smsSentBodies.length === 1);
    check('RESUME: SMS mentions lead name', smsSentBodies[0].includes('Alice Johnson'));
    check('RESUME: SMS mentions "resumed"', smsSentBodies[0].toLowerCase().includes('resumed'));
  }

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 7: RESUME on non-manual_handling row
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 7: RESUME on row that is NOT manual_handling');
  console.log(divider('-'));

  {
    resetTracking();
    installMocks([MANUAL_HANDLING_ROW, AWAITING_RESPONSE_ROW, WARM_ROW]);
    await handleResumeCommand(MOCK_AGENT, 'RESUME bob@example.com');
    check('RESUME non-manual: updateSheetRow NOT called', updateSheetRowCalls.length === 0);
    check('RESUME non-manual: error SMS sent', smsSentBodies.length === 1);
    check('RESUME non-manual: SMS mentions current status', smsSentBodies[0].includes('awaiting_response'));
  }

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 8: RESUME with unknown email
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 8: RESUME <unknown email>');
  console.log(divider('-'));

  {
    resetTracking();
    installMocks([MANUAL_HANDLING_ROW, AWAITING_RESPONSE_ROW, WARM_ROW]);
    await handleResumeCommand(MOCK_AGENT, 'RESUME nobody@example.com');
    check('RESUME unknown: updateSheetRow NOT called', updateSheetRowCalls.length === 0);
    check('RESUME unknown: not-found SMS sent', smsSentBodies.length === 1);
    check('RESUME unknown: SMS says "not found"', smsSentBodies[0].toLowerCase().includes('not found'));
  }

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 9: RESUME logs to conversation history
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 9: RESUME logs to conversation history');
  console.log(divider('-'));

  {
    resetTracking();
    installMocks([MANUAL_HANDLING_ROW, AWAITING_RESPONSE_ROW, WARM_ROW]);
    await handleResumeCommand(MOCK_AGENT, 'RESUME alice@example.com');
    check('RESUME history: appendToConversationHistory called', appendToHistoryCalls.length === 1);
    check('RESUME history: entry mentions "resumed"', appendToHistoryCalls[0].entry.toLowerCase().includes('resumed'));
    check('RESUME history: entry mentions follow-up count reset', appendToHistoryCalls[0].entry.includes('0'));
  }

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 10: RESUME with no token (bare "RESUME")
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 10: RESUME with no token');
  console.log(divider('-'));

  {
    resetTracking();
    installMocks([MANUAL_HANDLING_ROW]);
    await handleResumeCommand(MOCK_AGENT, 'RESUME');
    check('RESUME bare: updateSheetRow NOT called', updateSheetRowCalls.length === 0);
    check('RESUME bare: format help SMS sent', smsSentBodies.length === 1);
    check('RESUME bare: SMS mentions format', smsSentBodies[0].toLowerCase().includes('format'));
  }

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 11: Error resilience - readSheetRows failure
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 11: Error resilience - readSheetRows failure does not throw');
  console.log(divider('-'));

  {
    resetTracking();
    emailModule.readSheetRows = async () => { throw new Error('Sheet API down'); };
    let threw = false;
    try {
      await handleCalledCommand(MOCK_AGENT, 'CALLED alice@example.com');
    } catch (e) {
      threw = true;
    }
    check('CALLED resilience: does not throw on readSheetRows failure', threw === false);

    threw = false;
    try {
      await handleResumeCommand(MOCK_AGENT, 'RESUME alice@example.com');
    } catch (e) {
      threw = true;
    }
    check('RESUME resilience: does not throw on readSheetRows failure', threw === false);
    // Restore mock
    installMocks([MANUAL_HANDLING_ROW, AWAITING_RESPONSE_ROW, WARM_ROW]);
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
