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

let _origMockNow;

beforeEach(() => {
  _origMockNow = process.env.MOCK_NOW;
  process.env.MOCK_NOW = MOCK_NOW_ISO;

  agentStateMod.getState.mockReturnValue({
    lastDailyDigestRun: null,
    weeklyPreflightSkips: 0,
    lastTokenIssued: 0,
  });
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

test('daily-brief SMS succeeds: alert is not called', async () => {
  twilioMod.sendSMS.mockResolvedValue();

  const result = await runDailyDigestForAgent(AGENT);

  expect(result.smsResult).toBe('sent');
  expect(alertAgentTextFailed).not.toHaveBeenCalled();
});
