'use strict';

jest.mock('../src/twilio');
jest.mock('../src/email');
jest.mock('../src/agentState');
jest.mock('../src/textFailureAlert');

const twilioMod = require('../src/twilio');
const emailMod = require('../src/email');
const agentStateMod = require('../src/agentState');
const { alertAgentTextFailed } = require('../src/textFailureAlert');
const { runDailyDigestForAgent } = require('../src/digest');

// MOCK_NOW: Wednesday 2026-05-13T11:30:00.000Z = 07:30 EDT, same instant
// tests/digest.integration.daily.test.js uses.
const MOCK_NOW_ISO = '2026-05-13T11:30:00.000Z';

const AGENT = {
  agentId: 'test-agent',
  agentName: 'Test Agent',
  agentEmail: 'agent@example.com',
  agentPhone: '+15555550199',
  gmailAddress: 'agent@example.com',
  isActive: true,
  mode: 'shadow',
  timezone: 'America/Toronto',
  digestTime: '07:00',
  googleSheetId: 'fake-sheet-id',
  escalationEmail: 'mo@example.com',
};

// A HOT row so smsDecision sees needs_agent and actually attempts the send
// -- without it, the SMS is correctly never attempted at all (Commit B),
// and these tests would never reach the retry/failure logic they mean to
// exercise.
const HOT_ROW = {
  leadId: 'hot@example.com', name: 'Alice Hot', phone: '+15555550100', source: '', dateAdded: '',
  originalMessage: '', status: 'HOT', followUpCount: '0', nextFollowUpDay: '', lastFollowUpDate: '',
  reserved: '', conversationHistory: '[2026-05-12T09:00:00.000Z] Heuristic intake (confidence 0.90): lead inquired',
  pendingQuestion: '', gmailThreadId: '', aiEnabled: '', lastActionTimestamp: '2026-05-13T09:00:00.000Z',
  reminderSent: '', validationStatus: '', operatorEscalated: '', leadCategory: '', rowIndex: 2,
};

let _origMockNow;

beforeEach(() => {
  _origMockNow = process.env.MOCK_NOW;
  process.env.MOCK_NOW = MOCK_NOW_ISO;

  agentStateMod.getState.mockReturnValue({
    lastDailyDigestRun: null,
    weeklyPreflightSkips: 0,
    lastTokenIssued: 0,
  });
  agentStateMod.getDeliveredDealAlerts.mockReturnValue({});
  emailMod.readSheetRows.mockResolvedValue([]);
  emailMod.appendToConversationHistory.mockResolvedValue();
  emailMod.sendNewEmail.mockResolvedValue();
  alertAgentTextFailed.mockResolvedValue({ sent: true });
});

afterEach(() => {
  if (_origMockNow === undefined) delete process.env.MOCK_NOW;
  else process.env.MOCK_NOW = _origMockNow;
  jest.clearAllMocks();
});

test('daily-brief SMS fails every retry: alerts with kind daily_brief, smsResult stays failed', async () => {
  emailMod.readSheetRows.mockResolvedValue([HOT_ROW]);
  const smsError = new Error("The 'To' number is not a valid phone number.");
  twilioMod.sendSMS.mockRejectedValue(smsError);

  jest.useFakeTimers();
  const resultPromise = runDailyDigestForAgent(AGENT);
  await jest.runAllTimersAsync();
  const result = await resultPromise;
  jest.useRealTimers();

  expect(result.smsResult).toBe('failed');
  expect(alertAgentTextFailed).toHaveBeenCalledTimes(1);
  const [calledAgent, payload] = alertAgentTextFailed.mock.calls[0];
  expect(calledAgent).toBe(AGENT);
  expect(payload.kind).toBe('daily_brief');
  expect(payload.error).toBe(smsError);
  expect(typeof payload.smsBody).toBe('string');
});

test('daily-brief SMS succeeds (an urgent lead present): alert is not called', async () => {
  emailMod.readSheetRows.mockResolvedValue([HOT_ROW]);
  twilioMod.sendSMS.mockResolvedValue();

  const result = await runDailyDigestForAgent(AGENT);

  expect(result.smsResult).toBe('sent');
  expect(alertAgentTextFailed).not.toHaveBeenCalled();
});

test('quiet morning: SMS is never attempted, so no failure and no alert', async () => {
  twilioMod.sendSMS.mockResolvedValue();

  const result = await runDailyDigestForAgent(AGENT);

  expect(result.smsResult).toBe('skipped');
  expect(twilioMod.sendSMS).not.toHaveBeenCalled();
  expect(alertAgentTextFailed).not.toHaveBeenCalled();
});
