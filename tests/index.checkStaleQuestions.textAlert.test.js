'use strict';

// Same heavy-mock convention as tests/index.checkStaleQuestions.isActiveGate.test.js
// (index.js requires a large dependency graph at the top of the file).

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../src/agentConfig',   () => ({ loadAgent: jest.fn(), isLeadCategoryActionable: jest.fn() }));
jest.mock('../src/leadIntake',    () => ({ runLeadIntake: jest.fn(), transitionToIntaken: jest.fn() }));
jest.mock('../src/followUp',      () => ({ runFollowUps: jest.fn() }));
jest.mock('../src/agentState',    () => ({
  getState: jest.fn(),
  setState: jest.fn(),
  issueToken: jest.fn(),
  incrementWeeklyPreflightSkips: jest.fn(),
  resetWeeklyPreflightSkips: jest.fn(),
  recordDailyDigestRun: jest.fn(),
}));
jest.mock('../src/digest', () => ({
  shouldRunDailyDigest:        jest.fn().mockReturnValue(false),
  runDailyDigestForAgent:      jest.fn(),
  shouldRunWeeklyDigest:       jest.fn().mockReturnValue(false),
  runWeeklyDigestForOperator:  jest.fn(),
}));
jest.mock('../src/operatorState',  () => ({ getState: jest.fn(), recordWeeklyDigestRun: jest.fn() }));
jest.mock('../src/operatorConfig', () => ({ loadOperator: jest.fn(), discoverOperatorIds: jest.fn().mockReturnValue([]) }));
jest.mock('../src/email',   () => ({
  readSheetRows: jest.fn(),
  updateSheetRow: jest.fn().mockResolvedValue(undefined),
  appendToConversationHistory: jest.fn().mockResolvedValue(undefined),
  sendNewEmail: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/claude',  () => ({}));
jest.mock('../src/prompts', () => ({}));
jest.mock('../src/twilio', () => {
  const real = jest.requireActual('../src/twilio');
  return { ...real, sendSMS: jest.fn() };
});
jest.mock('../src/textFailureAlert', () => ({
  alertAgentTextFailed: jest.fn().mockResolvedValue({ sent: true }),
}));
jest.mock('../src/paths',   () => ({
  pathHotSignal:     jest.fn(),
  pathStopSignal:    jest.fn(),
  pathAskAgent:      jest.fn(),
  pathAnswerGeneral: jest.fn(),
  pathNeedsReview:   jest.fn(),
}));
jest.mock('../src/content/engine', () => ({
  runContentEngineForAgent: jest.fn(),
  shouldRunContentEngine:   jest.fn(),
}));
jest.mock('../src/content/profile', () => ({
  readContentProfile:     jest.fn(),
  isContentEngineEnabled: jest.fn(),
}));
jest.mock('../src/content/state', () => ({
  readContentState: jest.fn(),
  recordBatchSent:  jest.fn(),
}));
jest.mock('../src/content/angles', () => ({
  generateWeeklyAngles: jest.fn(),
}));
jest.mock('../src/content/evergreenAngles', () => ({
  generateEvergreenAngles: jest.fn(),
  evergreenAnglesFilePath: jest.fn(),
}));

// NOW: fixed instant so elapsed-time math is deterministic.
const mockNowMs = new Date('2026-06-26T12:00:00.000Z').getTime();
jest.mock('../src/time', () => ({
  getNow:     jest.fn(() => mockNowMs),
  getNowIso:  jest.fn().mockReturnValue('2026-06-26T12:00:00.000Z'),
  getNowDate: jest.fn(() => new Date(mockNowMs)),
}));

const { checkStaleQuestions } = require('../src/index');
const email = require('../src/email');
const twilio = require('../src/twilio');
const { alertAgentTextFailed } = require('../src/textFailureAlert');

const agent = { agentId: 'agent-1', isActive: true, googleSheetId: 'sheet-123', timezone: 'America/Toronto' };

// 3 hours stale: past the 2h reminder threshold, short of the 24h escalation one.
const THREE_HOURS_AGO = new Date(mockNowMs - 3 * 60 * 60 * 1000).toISOString();

function makeRow(overrides = {}) {
  return {
    rowIndex: 2,
    name: 'Jane Lead',
    status: 'awaiting_agent',
    lastActionTimestamp: THREE_HOURS_AGO,
    reminderSent: '',
    operatorEscalated: '',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  email.updateSheetRow.mockResolvedValue(undefined);
  email.appendToConversationHistory.mockResolvedValue(undefined);
  email.sendNewEmail.mockResolvedValue(undefined);
  alertAgentTextFailed.mockResolvedValue({ sent: true });
});

test('reminder SMS fails: alerts with kind path1b_reminder, Sheet is not updated', async () => {
  const smsError = new Error("The 'To' number is not a valid phone number.");
  twilio.sendSMS.mockRejectedValue(smsError);
  email.readSheetRows.mockResolvedValue([makeRow()]);

  const result = await checkStaleQuestions(agent);

  expect(alertAgentTextFailed).toHaveBeenCalledTimes(1);
  const [calledAgent, payload] = alertAgentTextFailed.mock.calls[0];
  expect(calledAgent).toBe(agent);
  expect(payload.kind).toBe('path1b_reminder');
  expect(payload.error).toBe(smsError);

  expect(email.updateSheetRow).not.toHaveBeenCalled();
  expect(result).toEqual({
    remindersSent: 0,
    escalationsSent: 0,
    errors: [{ rowIndex: 2, branch: 'reminder', message: smsError.message }],
  });
});

test('reminder SMS succeeds but the Sheet write fails afterward: alert is not called', async () => {
  const sheetError = new Error('Sheet temporarily unavailable');
  twilio.sendSMS.mockResolvedValue(undefined);
  email.updateSheetRow.mockRejectedValue(sheetError);
  email.readSheetRows.mockResolvedValue([makeRow()]);

  const result = await checkStaleQuestions(agent);

  expect(twilio.sendSMS).toHaveBeenCalledTimes(1);
  expect(alertAgentTextFailed).not.toHaveBeenCalled();
  expect(result).toEqual({
    remindersSent: 0,
    escalationsSent: 0,
    errors: [{ rowIndex: 2, branch: 'reminder', message: sheetError.message }],
  });
});

test('reminder SMS fails but escalation (branch B) still runs independently for the same row', async () => {
  const smsError = new Error("The 'To' number is not a valid phone number.");
  twilio.sendSMS.mockRejectedValue(smsError);
  const escalationError = new Error('escalation email failed');
  email.sendNewEmail.mockRejectedValue(escalationError);
  const TWENTY_FIVE_HOURS_AGO = new Date(mockNowMs - 25 * 60 * 60 * 1000).toISOString();
  email.readSheetRows.mockResolvedValue([makeRow({ lastActionTimestamp: TWENTY_FIVE_HOURS_AGO })]);

  const result = await checkStaleQuestions(agent);

  expect(alertAgentTextFailed).toHaveBeenCalledTimes(1);
  expect(result.errors).toEqual(
    expect.arrayContaining([{ rowIndex: 2, branch: 'reminder', message: smsError.message }])
  );
  expect(result.errors.some((e) => e.branch === 'escalation')).toBe(true);
});
