'use strict';

jest.mock('../src/email', () => ({
  updateSheetRow: jest.fn().mockResolvedValue(undefined),
  appendToConversationHistory: jest.fn().mockResolvedValue(undefined),
  sendNewEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/claude', () => ({
  callRaw: jest.fn().mockResolvedValue('unclear'),
}));

jest.mock('../src/agentState', () => ({
  issueToken: jest.fn().mockReturnValue('Q99'),
}));

jest.mock('../src/time', () => ({
  getNowIso: jest.fn().mockReturnValue('2026-05-21T00:00:00.000Z'),
}));

jest.mock('../src/twilio', () => {
  const real = jest.requireActual('../src/twilio');
  return { ...real, sendSMS: jest.fn() };
});

jest.mock('../src/textFailureAlert', () => ({
  alertAgentTextFailed: jest.fn().mockResolvedValue({ sent: true }),
}));

const { pathHotSignal, pathNeedsReview, pathAskAgent } = require('../src/paths');
const twilio = require('../src/twilio');
const { alertAgentTextFailed } = require('../src/textFailureAlert');

const agent = { agentId: 'agent-1', gmailAddress: 'agent@example.com', escalationEmail: 'agent@example.com' };

let SMS_ERROR;

beforeEach(() => {
  jest.clearAllMocks();
  SMS_ERROR = new Error("The 'To' number is not a valid phone number.");
  require('../src/email').updateSheetRow.mockResolvedValue(undefined);
  require('../src/email').appendToConversationHistory.mockResolvedValue(undefined);
  require('../src/email').sendNewEmail.mockResolvedValue(undefined);
  require('../src/claude').callRaw.mockResolvedValue('unclear');
  twilio.sendSMS.mockRejectedValue(SMS_ERROR);
  alertAgentTextFailed.mockResolvedValue({ sent: true });
});

test('pathHotSignal: SMS failure calls alertAgentTextFailed with kind hot_lead, return shape unchanged', async () => {
  const row = { rowIndex: 2, leadId: 'lead@example.com', name: 'Jane Lead', phone: '+14165550111' };
  const msg = { snippet: 'call me now' };
  const cat = { reasoning: 'urgent tone', confidence: 0.9 };

  const result = await pathHotSignal(agent, row, msg, cat);

  expect(alertAgentTextFailed).toHaveBeenCalledTimes(1);
  const [calledAgent, payload] = alertAgentTextFailed.mock.calls[0];
  expect(calledAgent).toBe(agent);
  expect(payload.kind).toBe('hot_lead');
  expect(payload.error).toBe(SMS_ERROR);
  expect(payload.smsBody).toContain('Jane Lead');

  expect(result).toEqual({
    ok: true,
    actions: ['sheet', 'columnL', 'email'],
    skipped: [],
    errors: [{ step: 'sms', error: SMS_ERROR.message }],
  });
});

test('pathNeedsReview: urgent-keyword SMS failure calls alertAgentTextFailed with kind needs_review, return shape unchanged', async () => {
  const row = { rowIndex: 3, leadId: 'lead@example.com', name: 'Jane Lead', phone: '+14165550111', originalMessage: 'inquiry' };
  const msg = { snippet: "I'm getting my lawyer involved" };
  const cat = { reasoning: 'threat of legal action', confidence: 0.7 };

  const result = await pathNeedsReview(agent, row, msg, cat);

  expect(alertAgentTextFailed).toHaveBeenCalledTimes(1);
  const [calledAgent, payload] = alertAgentTextFailed.mock.calls[0];
  expect(calledAgent).toBe(agent);
  expect(payload.kind).toBe('needs_review');
  expect(payload.error).toBe(SMS_ERROR);
  expect(payload.smsBody).toContain('lawyer');

  expect(result).toEqual({
    ok: true,
    actions: { sheet: true, columnL: true, email: 'sent', sms: 'failed' },
    skipped: [],
    errors: [{ step: 'sms', error: SMS_ERROR.message }],
  });
});

test('pathAskAgent: SMS failure calls alertAgentTextFailed with kind path1b_question, return shape unchanged', async () => {
  const row = { rowIndex: 4, leadId: 'lead@example.com', name: 'Jane Lead', status: 'new', pendingQuestion: '', originalMessage: 'inquiry', conversationHistory: '' };
  const msg = { snippet: 'is it still available?' };
  const cat = {};

  const result = await pathAskAgent(agent, row, msg, cat);

  expect(alertAgentTextFailed).toHaveBeenCalledTimes(1);
  const [calledAgent, payload] = alertAgentTextFailed.mock.calls[0];
  expect(calledAgent).toBe(agent);
  expect(payload.kind).toBe('path1b_question');
  expect(payload.error).toBe(SMS_ERROR);

  expect(result).toEqual({
    ok: true,
    actions: {
      sheet: 'updated',
      tokenIssued: 'Q99',
      propertyExtraction: 'unclear',
      columnL: 'logged',
      email: 'sent',
      sms: 'failed',
      smsAttempted: true,
      leadEmail: 'not_sent_intentional',
    },
    skipped: [],
    errors: [{ step: 'sms', error: SMS_ERROR.message }],
  });
});
