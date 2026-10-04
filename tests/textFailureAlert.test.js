'use strict';

// MOCK_NOW: 2026-06-15T12:00:00.000Z = 08:00 EDT (America/Toronto is UTC-4
// in June), so "today" in the agent's timezone is 2026-06-15.
const MOCK_NOW_ISO = '2026-06-15T12:00:00.000Z';
const TODAY = '2026-06-15';
const YESTERDAY = '2026-06-14';

jest.mock('../src/email');

const emailMod = require('../src/email');
const { alertAgentTextFailed } = require('../src/textFailureAlert');

const AGENT = {
  agentId: 'agent-1',
  agentName: 'Sam Agent',
  operatorId: 'op-1',
  timezone: 'America/Toronto',
};

const OPERATOR = {
  operatorId: 'op-1',
  operatorEmail: 'operator@test.example.com',
};

// A small in-memory fake that actually remembers what was recorded, shared
// by every test in this file via beforeEach, rather than a mock with fixed
// answers -- so a test can both prime state before a call and assert on
// state after it.
function makeAlertedTodayFake() {
  const store = {};
  return {
    hasAlertedToday: jest.fn((agentId, kind, today) => !!(store[agentId] && store[agentId][kind] === today)),
    recordAlertSent: jest.fn((agentId, kind, today) => {
      store[agentId] = store[agentId] || {};
      store[agentId][kind] = today;
    }),
  };
}

let _origMockNow;
let fake;
let loadOperatorMock;

beforeAll(() => {
  _origMockNow = process.env.MOCK_NOW;
  process.env.MOCK_NOW = MOCK_NOW_ISO;
});

afterAll(() => {
  if (_origMockNow === undefined) delete process.env.MOCK_NOW;
  else process.env.MOCK_NOW = _origMockNow;
});

beforeEach(() => {
  fake = makeAlertedTodayFake();
  loadOperatorMock = jest.fn().mockReturnValue(OPERATOR);
  emailMod.sendNewEmail.mockResolvedValue();
});

afterEach(() => {
  jest.clearAllMocks();
});

function deps() {
  return {
    loadOperator: loadOperatorMock,
    hasAlertedToday: fake.hasAlertedToday,
    recordAlertSent: fake.recordAlertSent,
  };
}

const SMS_BODY = "🔥 HOT LEAD: Jane Lead just said: \"call me\"\nReply to jane@example.com ASAP.";
const SOME_ERROR = { code: 21211, message: "The 'To' number +14165550199 is not a valid phone number." };

test('hot_lead sends without ever consulting hasAlertedToday', async () => {
  const result = await alertAgentTextFailed(AGENT, { kind: 'hot_lead', smsBody: SMS_BODY, error: SOME_ERROR }, deps());

  expect(result).toEqual({ sent: true });
  expect(emailMod.sendNewEmail).toHaveBeenCalledTimes(1);
  expect(fake.hasAlertedToday).not.toHaveBeenCalled();
});

test('hot_lead sends even when the fake already holds today\'s date for hot_lead', async () => {
  fake.recordAlertSent(AGENT.agentId, 'hot_lead', TODAY);

  const result = await alertAgentTextFailed(AGENT, { kind: 'hot_lead', smsBody: SMS_BODY, error: SOME_ERROR }, deps());

  expect(result).toEqual({ sent: true });
  expect(emailMod.sendNewEmail).toHaveBeenCalledTimes(1);
});

test('hot_lead fires twice in a row and both send', async () => {
  const r1 = await alertAgentTextFailed(AGENT, { kind: 'hot_lead', smsBody: SMS_BODY, error: SOME_ERROR }, deps());
  const r2 = await alertAgentTextFailed(AGENT, { kind: 'hot_lead', smsBody: SMS_BODY, error: SOME_ERROR }, deps());

  expect(r1).toEqual({ sent: true });
  expect(r2).toEqual({ sent: true });
  expect(emailMod.sendNewEmail).toHaveBeenCalledTimes(2);
});

test('limited kind, first failure today: sends and records today for that kind', async () => {
  const result = await alertAgentTextFailed(AGENT, { kind: 'needs_review', smsBody: SMS_BODY, error: SOME_ERROR }, deps());

  expect(result).toEqual({ sent: true });
  expect(emailMod.sendNewEmail).toHaveBeenCalledTimes(1);
  expect(fake.recordAlertSent).toHaveBeenCalledWith('agent-1', 'needs_review', TODAY);
  expect(fake.hasAlertedToday('agent-1', 'needs_review', TODAY)).toBe(true);
});

test('limited kind, already alerted today: no email, reason already_alerted_today', async () => {
  fake.recordAlertSent(AGENT.agentId, 'needs_review', TODAY);

  const result = await alertAgentTextFailed(AGENT, { kind: 'needs_review', smsBody: SMS_BODY, error: SOME_ERROR }, deps());

  expect(result).toEqual({ sent: false, reason: 'already_alerted_today' });
  expect(emailMod.sendNewEmail).not.toHaveBeenCalled();
});

test('limited kind, alerted on a different day: sends again', async () => {
  fake.recordAlertSent(AGENT.agentId, 'needs_review', YESTERDAY);

  const result = await alertAgentTextFailed(AGENT, { kind: 'needs_review', smsBody: SMS_BODY, error: SOME_ERROR }, deps());

  expect(result).toEqual({ sent: true });
  expect(emailMod.sendNewEmail).toHaveBeenCalledTimes(1);
});

test('two different limited kinds on the same day do not block each other', async () => {
  // Both calls go through the module's own record/check path (rather than
  // priming the fake directly) so this test can actually observe a bug that
  // collapses per-kind tracking into one shared key.
  const r1 = await alertAgentTextFailed(AGENT, { kind: 'needs_review', smsBody: SMS_BODY, error: SOME_ERROR }, deps());
  const r2 = await alertAgentTextFailed(AGENT, { kind: 'daily_brief', smsBody: SMS_BODY, error: SOME_ERROR }, deps());

  expect(r1).toEqual({ sent: true });
  expect(r2).toEqual({ sent: true });
  expect(emailMod.sendNewEmail).toHaveBeenCalledTimes(2);
});

test('no operatorId: no send, reason no_operator', async () => {
  const agentNoOperator = { agentId: 'agent-1', agentName: 'Sam Agent', timezone: 'America/Toronto' };

  const result = await alertAgentTextFailed(agentNoOperator, { kind: 'needs_review', smsBody: SMS_BODY, error: SOME_ERROR }, deps());

  expect(result).toEqual({ sent: false, reason: 'no_operator' });
  expect(loadOperatorMock).not.toHaveBeenCalled();
  expect(emailMod.sendNewEmail).not.toHaveBeenCalled();
});

test('loadOperator throws: no send, reason operator_load_failed', async () => {
  loadOperatorMock.mockImplementation(() => { throw new Error('operator config not found'); });

  const result = await alertAgentTextFailed(AGENT, { kind: 'needs_review', smsBody: SMS_BODY, error: SOME_ERROR }, deps());

  expect(result).toEqual({ sent: false, reason: 'operator_load_failed' });
  expect(emailMod.sendNewEmail).not.toHaveBeenCalled();
});

test('operator with no operatorEmail: no send, reason no_operator_email', async () => {
  loadOperatorMock.mockReturnValue({ operatorId: 'op-1' });

  const result = await alertAgentTextFailed(AGENT, { kind: 'needs_review', smsBody: SMS_BODY, error: SOME_ERROR }, deps());

  expect(result).toEqual({ sent: false, reason: 'no_operator_email' });
  expect(emailMod.sendNewEmail).not.toHaveBeenCalled();
});

test('sendNewEmail rejects: reason send_failed, and recordAlertSent is not called', async () => {
  emailMod.sendNewEmail.mockRejectedValue(new Error('SMTP timeout'));

  const result = await alertAgentTextFailed(AGENT, { kind: 'needs_review', smsBody: SMS_BODY, error: SOME_ERROR }, deps());

  expect(result).toEqual({ sent: false, reason: 'send_failed' });
  expect(fake.recordAlertSent).not.toHaveBeenCalled();
  expect(fake.hasAlertedToday('agent-1', 'needs_review', TODAY)).toBe(false);
});

test('unknown kind: no send, reason unknown_kind', async () => {
  const result = await alertAgentTextFailed(AGENT, { kind: 'not_a_real_kind', smsBody: SMS_BODY, error: SOME_ERROR }, deps());

  expect(result).toEqual({ sent: false, reason: 'unknown_kind' });
  expect(emailMod.sendNewEmail).not.toHaveBeenCalled();
});

test('a throwing timezone resolves sent false reason error, never rejects', async () => {
  const badAgent = { ...AGENT, timezone: 'Not/AZone' };

  const result = await alertAgentTextFailed(badAgent, { kind: 'needs_review', smsBody: SMS_BODY, error: SOME_ERROR }, deps());

  expect(result).toEqual({ sent: false, reason: 'error' });
  expect(emailMod.sendNewEmail).not.toHaveBeenCalled();
});

test('hot_lead with a throwing timezone still sends: it never needs today', async () => {
  const badAgent = { ...AGENT, timezone: 'Not/AZone' };

  const result = await alertAgentTextFailed(badAgent, { kind: 'hot_lead', smsBody: SMS_BODY, error: SOME_ERROR }, deps());

  expect(result).toEqual({ sent: true });
  expect(emailMod.sendNewEmail).toHaveBeenCalledTimes(1);
});

test('falls back to agentId when agentName is missing', async () => {
  const noName = { agentId: 'agent-1', operatorId: 'op-1', timezone: 'America/Toronto' };

  await alertAgentTextFailed(noName, { kind: 'hot_lead', smsBody: SMS_BODY, error: SOME_ERROR }, deps());

  const [, opts] = emailMod.sendNewEmail.mock.calls[0];
  expect(opts.subject).toBe("GetKlosed: a text to agent-1 didn't send (hot-lead alert)");
});

test('hot_lead subject and body, exact text', async () => {
  await alertAgentTextFailed(AGENT, { kind: 'hot_lead', smsBody: SMS_BODY, error: SOME_ERROR }, deps());

  const [sentConfig, opts] = emailMod.sendNewEmail.mock.calls[0];
  expect(sentConfig).toBe(OPERATOR);
  expect(opts.to).toBe('operator@test.example.com');
  expect(opts.subject).toBe("GetKlosed: a text to Sam Agent didn't send (hot-lead alert)");
  expect(opts.body).toBe([
    "A hot lead came in and Sam Agent wasn't told. Worth a call.",
    '',
    "Twilio said: 21211 The 'To' number +14165550199 is not a valid phone number.",
    '',
    "The text they didn't get:",
    SMS_BODY,
  ].join('\n'));
});

test('needs_review (a limited kind) subject and body, exact text, with the daily-limit footer', async () => {
  const smsBody = '⚠️ Jane Lead\'s reply mentions "lawyer". Needs your eyes, check email for full context.';
  await alertAgentTextFailed(AGENT, { kind: 'needs_review', smsBody, error: SOME_ERROR }, deps());

  const [, opts] = emailMod.sendNewEmail.mock.calls[0];
  expect(opts.subject).toBe("GetKlosed: a text to Sam Agent didn't send (urgent review alert)");
  expect(opts.body).toBe([
    "Twilio said: 21211 The 'To' number +14165550199 is not a valid phone number.",
    '',
    "The text they didn't get:",
    smsBody,
    '',
    "You'll get at most one of these a day for this kind of text.",
  ].join('\n'));
});

test('missing error.code renders n/a', async () => {
  await alertAgentTextFailed(AGENT, { kind: 'path1b_reminder', smsBody: SMS_BODY, error: new Error('network timeout') }, deps());

  const [, opts] = emailMod.sendNewEmail.mock.calls[0];
  expect(opts.body).toContain('Twilio said: n/a network timeout');
});
