'use strict';

jest.mock('../src/twilio');
jest.mock('../src/email');
jest.mock('../src/agentState');

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const twilioMod     = require('../src/twilio');
const emailMod      = require('../src/email');
const agentStateMod = require('../src/agentState');
const { runDailyDigestForAgent } = require('../src/digest');
const { openTransaction } = require('../scripts/open-transaction');
const { OPERATOR_CONTACT_EMAIL } = require('../src/operatorAddress');

// MOCK_NOW pins "now"; today in America/Toronto (the AGENT fixture's
// timezone below) is 2026-10-08, so every condition/deposit date below is
// chosen against that day using the real day-count constants
// (alerts.js: CONDITION_PASSED_DAYS_AFTER [1,4], CONDITION_HEADS_UP_DAYS_BEFORE [1,0],
// DEPOSIT_OVERDUE_DAYS_AFTER [2,7]), never hand-picked to "look about right".
const MOCK_NOW_ISO = '2026-10-08T11:00:00.000Z';

const AGENT = {
  agentId: 'deals-wiring-agent',
  agentName: 'Deals Wiring Agent',
  agentEmail: 'agent@example.com',
  agentPhone: '+15555550199',
  gmailAddress: 'agent@example.com',
  isActive: true,
  mode: 'live',
  timezone: 'America/Toronto',
  googleSheetId: 'fake-sheet-id',
  operatorId: 'test-operator',
};

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'digest-integration-deals-test-'));
}

function writeOperator(baseDir, operatorId, fields) {
  const dir = path.join(baseDir, '_operators');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${operatorId}.json`), JSON.stringify(fields), 'utf8');
}

// -- Real, on-disk fixture deals, each producing exactly one named alert kind.
// acceptedDate/conditionDates are deliberately omitted where irrelevant: a
// deposit item's requiredWhen only fires when acceptedDate is present
// (alerts.js:105-107), so leaving it unset keeps a condition-only fixture
// from also producing a deposit_overdue alert, and vice versa.

function openConditionPassedDeal(baseDir, address) {
  return openTransaction(AGENT.agentId, { type: 'buyer_purchase', state: 'conditional', address }, {
    baseDir, now: new Date(MOCK_NOW_ISO),
    factPlan: [
      ['conditions', ['financing']],
      ['conditionDates', { financing: '2026-10-04' }], // daysPast 4
      ['additionalDepositDueDates', []],
    ],
  });
}

function openConditionHeadsUpDeal(baseDir, address) {
  return openTransaction(AGENT.agentId, { type: 'buyer_purchase', state: 'conditional', address }, {
    baseDir, now: new Date(MOCK_NOW_ISO),
    factPlan: [
      ['conditions', ['financing']],
      ['conditionDates', { financing: '2026-10-09' }], // daysUntil 1
      ['additionalDepositDueDates', []],
    ],
  });
}

function openDepositOverdueDeal(baseDir, address) {
  return openTransaction(AGENT.agentId, { type: 'buyer_purchase', state: 'conditional', address }, {
    baseDir, now: new Date(MOCK_NOW_ISO),
    factPlan: [
      ['conditions', []],
      ['acceptedDate', '2026-10-01'], // daysPast 7
      ['additionalDepositDueDates', []],
    ],
  });
}

// A real deal with nothing due: active, but produces no alert at all.
function openQuietDeal(baseDir, address) {
  return openTransaction(AGENT.agentId, { type: 'buyer_purchase', state: 'conditional', address }, {
    baseDir, now: new Date(MOCK_NOW_ISO),
    factPlan: [
      ['conditions', []],
      ['additionalDepositDueDates', []],
    ],
  });
}

// Simulates the one documented way a deal file can throw during alert
// resolution (rules/conditions.js hasCondition, confirmed in commit 1's
// recon): a hand-edited file, not something setFact's own validation would
// ever write. Build a valid deal first, then corrupt it directly on disk.
function corruptConditionsFact(baseDir, transaction) {
  const filePath = path.join(baseDir, `${AGENT.agentId}.transactions`, `${transaction.transactionId}.json`);
  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  onDisk.facts.conditions = 'nope';
  fs.writeFileSync(filePath, JSON.stringify(onDisk), 'utf8');
}

// An unreadable file: invalid JSON under a filename shaped like a real
// transaction id, so listTransactionIds (store.js) picks it up and
// readTransaction's JSON.parse throws, caught by readAllTransactionsSettled.
function writeUnreadableFile(baseDir) {
  const dir = path.join(baseDir, `${AGENT.agentId}.transactions`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'txn-20261001-deadbeef.json'), '{not valid json', 'utf8');
}

// Breaks readAllTransactionsSettled itself (ENOTDIR on scandir), the
// "the deals path broke for this agent, not just one bad file" case --
// distinct from corruptConditionsFact (one malformed transaction, caught
// INSIDE collectDealAlerts, surfaces as unreadable). Deliberately not a bad
// agentConfig.timezone: that would also break renderEmail's own
// formatDailyDate call later, which would poison the lead content this
// test means to prove is untouched, not just the deals path.
function breakTransactionsDirectory(baseDir, agentId) {
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(path.join(baseDir, `${agentId}.transactions`), 'not a directory', 'utf8');
}

let baseDir;
let _origMockNow;
let _origStorageRoot;

beforeEach(() => {
  baseDir = makeTmpDir();
  _origMockNow = process.env.MOCK_NOW;
  process.env.MOCK_NOW = MOCK_NOW_ISO;
  // readAllTransactionsSettled takes options.baseDir explicitly (passed
  // below), but loadOperator (operatorConfig.js) always resolves through
  // getStorageRoot() with no override parameter, so STORAGE_ROOT is set to
  // the same temp dir for the operator-fallback tests to write real
  // _operators/<id>.json fixtures under.
  _origStorageRoot = process.env.STORAGE_ROOT;
  process.env.STORAGE_ROOT = baseDir;

  agentStateMod.getState.mockReturnValue({ lastDailyDigestRun: null, weeklyPreflightSkips: 0, lastTokenIssued: 0 });
  emailMod.readSheetRows.mockResolvedValue([]);
  emailMod.sendNewEmail.mockResolvedValue();
  twilioMod.sendSMS.mockResolvedValue();
});

afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
  if (_origMockNow === undefined) delete process.env.MOCK_NOW; else process.env.MOCK_NOW = _origMockNow;
  if (_origStorageRoot === undefined) delete process.env.STORAGE_ROOT; else process.env.STORAGE_ROOT = _origStorageRoot;
  jest.clearAllMocks();
});

function capture() {
  const state = { email: null, sms: null };
  emailMod.sendNewEmail.mockImplementation(async (_cfg, opts) => { state.email = opts; });
  twilioMod.sendSMS.mockImplementation(async (_cfg, body) => { state.sms = body; });
  return state;
}

describe('amendment 1: not_configured Sheet skip rule', () => {
  const notConfigured = { ...AGENT, googleSheetId: '' };

  test('alerts present: sends SMS and email', async () => {
    const captured = capture();
    openConditionPassedDeal(baseDir, '12 Main St');

    const result = await runDailyDigestForAgent(notConfigured, { baseDir });

    expect(result.smsResult).toBe('sent');
    expect(result.emailResult).toBe('sent');
    expect(result.deals).toEqual({ status: 'ok' });
    expect(captured.sms).toContain('📋 12 Main St: financing condition passed');
    expect(captured.email.body).toContain('-- Deals needing you --');
    // not_configured: noise filtering and pre-flight skips cannot run without a Sheet, so the section is gone.
    expect(captured.email.body).not.toContain('What the system handled');
    expect(captured.email.html).not.toContain('What the system handled');
  });

  test('no alerts, but an unreadable file is present: email sent, no SMS', async () => {
    const captured = capture();
    writeUnreadableFile(baseDir);

    const result = await runDailyDigestForAgent(notConfigured, { baseDir });

    expect(result.smsResult).toBe('skipped');
    expect(result.emailResult).toBe('sent');
    expect(result.deals.status).toBe('unreadable');
    expect(result.deals.unreadable).toHaveLength(1);
    expect(captured.sms).toBeNull();
    expect(captured.email.body).toContain("couldn't be read this morning. Mo has been told.");
    expect(captured.email.body).not.toContain('What the system handled');
  });

  test('no alerts, one deal file is unreadable (a single bad transaction, caught inside collectDealAlerts): email sent, no SMS', async () => {
    const captured = capture();
    const txn = openConditionPassedDeal(baseDir, '12 Main St');
    corruptConditionsFact(baseDir, txn);

    const result = await runDailyDigestForAgent(notConfigured, { baseDir });

    expect(result.smsResult).toBe('skipped');
    expect(result.emailResult).toBe('sent');
    expect(result.deals).toEqual({
      status: 'unreadable',
      unreadable: [{ transactionId: txn.transactionId, error: expect.any(String), stage: 'alerts' }],
    });
    expect(captured.sms).toBeNull();
    expect(captured.email.body).toContain("couldn't be read this morning. Mo has been told.");
    expect(captured.email.body).not.toContain('What the system handled');
  });

  test('no alerts, the deals path itself threw (an agent-level failure, not one bad file): email sent, no SMS', async () => {
    const captured = capture();
    breakTransactionsDirectory(baseDir, AGENT.agentId);

    const result = await runDailyDigestForAgent(notConfigured, { baseDir });

    expect(result.smsResult).toBe('skipped');
    expect(result.emailResult).toBe('sent');
    expect(result.deals.status).toBe('error');
    expect(typeof result.deals.error).toBe('string');
    expect(captured.sms).toBeNull();
    expect(captured.email.body).toContain("Deal updates couldn't be loaded this morning. Mo has been told.");
    expect(captured.email.body).not.toContain('What the system handled');
  });

  test('no alerts, nothing unreadable, no error (active deals with nothing due): skips, exact unchanged return value', async () => {
    const captured = capture();
    openQuietDeal(baseDir, '12 Main St');

    const result = await runDailyDigestForAgent(notConfigured, { baseDir });

    expect(result).toEqual({ skipped: 'nothing_to_send', leads: { status: 'not_configured', errorKind: null } });
    expect(captured.sms).toBeNull();
    expect(captured.email).toBeNull();
  });

  test('truly nothing at all (no deals ever): skips, exact unchanged return value, no deals field', async () => {
    const result = await runDailyDigestForAgent(notConfigured, { baseDir });
    expect(result).toEqual({ skipped: 'nothing_to_send', leads: { status: 'not_configured', errorKind: null } });
  });
});

describe('deals path throws: lead brief unchanged, honest line present, failure returned', () => {
  test('an ok Sheet with leads: the deals error line is added, the lead content is untouched', async () => {
    const captured = capture();
    emailMod.readSheetRows.mockResolvedValue([]); // no leads, isolates the assertion to the deals line only
    breakTransactionsDirectory(baseDir, AGENT.agentId);

    const result = await runDailyDigestForAgent(AGENT, { baseDir });

    expect(result.deals).toEqual({ status: 'error', error: expect.any(String) });
    expect(result.smsResult).toBe('sent');
    expect(result.emailResult).toBe('sent');
    expect(captured.sms).not.toContain('📋');
    expect(captured.email.body).toContain("-- Deals needing you --\n\nDeal updates couldn't be loaded this morning. Mo has been told.");
    expect(captured.email.html).toContain("Deal updates couldn't be loaded this morning. Mo has been told.");
    // The lead section ("What the system handled") still renders normally.
    expect(captured.email.body).toContain('What the system handled');
  });
});

describe('unreadable deal file present (ok Sheet)', () => {
  test('one unreadable file alongside one real alert: both surface, file name and error never leaked', async () => {
    const captured = capture();
    openConditionPassedDeal(baseDir, '12 Main St');
    writeUnreadableFile(baseDir);

    const result = await runDailyDigestForAgent(AGENT, { baseDir });

    expect(result.deals.status).toBe('unreadable');
    expect(result.deals.unreadable).toEqual([{ transactionId: 'txn-20261001-deadbeef', error: expect.any(String), stage: 'read' }]);
    expect(captured.email.body).toContain("One of your deal files couldn't be read this morning. Mo has been told.");
    expect(captured.email.body).not.toContain('txn-20261001-deadbeef');
    expect(captured.email.html).not.toContain('txn-20261001-deadbeef');
  });
});

describe('subject choice', () => {
  test('deals present: deals subject wins over the lead subject', async () => {
    const captured = capture();
    openConditionPassedDeal(baseDir, '12 Main St');

    await runDailyDigestForAgent(AGENT, { baseDir });

    expect(captured.email.subject).toBe('Your morning brief: 12 Main St needs you today');
  });

  test('no deals: lead subject unchanged (em dash, grandfathered)', async () => {
    const captured = capture();
    emailMod.readSheetRows.mockResolvedValue([]);

    await runDailyDigestForAgent(AGENT, { baseDir });

    expect(captured.email.subject).toBe('Your morning brief — Thursday, October 8');
  });
});

describe('SMS line placement', () => {
  test('a hot lead and a deal alert: deals line sits between the CALLED line and "Full brief in your inbox."', async () => {
    const captured = capture();
    const hotRow = {
      leadId: 'hot@example.com', name: 'Alice Hot', phone: '+15555550100', source: '', dateAdded: '',
      originalMessage: '', status: 'HOT', followUpCount: '0', nextFollowUpDay: '', lastFollowUpDate: '',
      reserved: '', conversationHistory: '[2026-10-07T09:00:00.000Z] Heuristic intake (confidence 0.90): lead inquired',
      pendingQuestion: '', gmailThreadId: '', aiEnabled: '', lastActionTimestamp: '2026-10-08T09:00:00.000Z',
      reminderSent: '', validationStatus: '', operatorEscalated: '', leadCategory: '', rowIndex: 2,
    };
    emailMod.readSheetRows.mockResolvedValue([hotRow]);
    openConditionPassedDeal(baseDir, '12 Main St');

    await runDailyDigestForAgent(AGENT, { baseDir });

    const lines = captured.sms.split('\n');
    const calledIdx = lines.findIndex((l) => l.startsWith('Reply CALLED'));
    const dealsIdx  = lines.findIndex((l) => l.startsWith('📋'));
    const briefIdx  = lines.findIndex((l) => l === 'Full brief in your inbox.');
    expect(calledIdx).toBeGreaterThan(-1);
    expect(dealsIdx).toBe(calledIdx + 1);
    expect(briefIdx).toBe(dealsIdx + 1);
  });
});

describe('amendment 3: operator email fallback for the fell-through link', () => {
  test('no_operator: no operatorId on the agent config', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const captured = capture();
    openConditionPassedDeal(baseDir, '12 Main St');

    await runDailyDigestForAgent({ ...AGENT, operatorId: undefined }, { baseDir });

    expect(captured.email.body).toContain(`mailto:${OPERATOR_CONTACT_EMAIL}?subject=`);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = warnSpy.mock.calls[0][0];
    expect(logged).toContain(AGENT.agentId);
    expect(logged).toContain('no_operator');
    expect(logged).not.toContain('@');
    warnSpy.mockRestore();
  });

  test('operator_load_failed: operatorId set, but no _operators/<id>.json file exists', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const captured = capture();
    openConditionPassedDeal(baseDir, '12 Main St');
    // Deliberately do not write _operators/test-operator.json.

    await runDailyDigestForAgent(AGENT, { baseDir });

    expect(captured.email.body).toContain(`mailto:${OPERATOR_CONTACT_EMAIL}?subject=`);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = warnSpy.mock.calls[0][0];
    expect(logged).toContain(AGENT.agentId);
    expect(logged).toContain('operator_load_failed');
    expect(logged).not.toContain('@');
    warnSpy.mockRestore();
  });

  test('no_operator_email: the operator record exists but has no operatorEmail', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const captured = capture();
    writeOperator(baseDir, 'test-operator', { operatorId: 'test-operator', operatorName: 'Mo' });
    openConditionPassedDeal(baseDir, '12 Main St');

    await runDailyDigestForAgent(AGENT, { baseDir });

    expect(captured.email.body).toContain(`mailto:${OPERATOR_CONTACT_EMAIL}?subject=`);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = warnSpy.mock.calls[0][0];
    expect(logged).toContain(AGENT.agentId);
    expect(logged).toContain('no_operator_email');
    expect(logged).not.toContain('@');
    warnSpy.mockRestore();
  });

  test('operator record is readable with a real operatorEmail: no fallback, no warning', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const captured = capture();
    writeOperator(baseDir, 'test-operator', { operatorId: 'test-operator', operatorName: 'Mo', operatorEmail: 'mo@example.com' });
    openConditionPassedDeal(baseDir, '12 Main St');

    await runDailyDigestForAgent(AGENT, { baseDir });

    expect(captured.email.body).toContain('mailto:mo@example.com?subject=');
    expect(captured.email.body).not.toContain(OPERATOR_CONTACT_EMAIL);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('condition_heads_up and deposit_overdue through the real pipeline', () => {
  test('condition_heads_up produces the expected row and no error', async () => {
    const captured = capture();
    openConditionHeadsUpDeal(baseDir, '12 Main St');

    const result = await runDailyDigestForAgent({ ...AGENT, googleSheetId: '' }, { baseDir });

    expect(result.deals).toEqual({ status: 'ok' });
    expect(captured.email.body).toContain('condition is due tomorrow.');
  });

  test('deposit_overdue produces the expected row and no error', async () => {
    const captured = capture();
    openDepositOverdueDeal(baseDir, '34 Oak Ave');

    const result = await runDailyDigestForAgent({ ...AGENT, googleSheetId: '' }, { baseDir });

    expect(result.deals).toEqual({ status: 'ok' });
    expect(captured.email.body).toContain('Deposit not confirmed, 7 days after acceptance.');
  });
});
