'use strict';

const fs = require('fs');

jest.mock('../src/email');

const emailMod = require('../src/email');
const { alertOperatorSheetUnavailable } = require('../src/digest');

const AGENT = {
  agentId: 'agent-1',
  agentName: 'Sam Agent',
  googleSheetId: 'sheet-123',
  operatorId: 'op-1',
};

const OPERATOR = {
  operatorId: 'op-1',
  operatorEmail: 'operator@test.example.com',
};

const ACCESS_DENIED_BODY = [
  "Sam Agent's lead sheet couldn't be read this morning (access denied).",
  '',
  'Their daily brief went out without leads and told them so.',
  '',
  'Agent: agent-1',
  'Sheet: sheet-123',
  '',
  "Check that the Sheet is still shared with the agent's Google account.",
  '',
  'This repeats each morning until the Sheet can be read again.',
].join('\n');

const NOT_FOUND_BODY = [
  "Sam Agent's lead sheet couldn't be read this morning (not found).",
  '',
  'Their daily brief went out without leads and told them so.',
  '',
  'Agent: agent-1',
  'Sheet: sheet-123',
  '',
  'Check whether the Sheet was deleted or moved.',
  '',
  'This repeats each morning until the Sheet can be read again.',
].join('\n');

let loadOperatorMock;
let appendFileSyncSpy;

beforeEach(() => {
  loadOperatorMock = jest.fn().mockReturnValue(OPERATOR);
  emailMod.sendNewEmail.mockResolvedValue();
  appendFileSyncSpy = jest.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
});

afterEach(() => {
  appendFileSyncSpy.mockRestore();
  jest.clearAllMocks();
});

test('1. leads unavailable (permission): sends via the operator config, returns sent true', async () => {
  const leads = { status: 'unavailable', errorKind: 'permission' };

  const result = await alertOperatorSheetUnavailable(AGENT, leads, { loadOperator: loadOperatorMock });

  expect(emailMod.sendNewEmail).toHaveBeenCalledTimes(1);
  const [sentConfig, opts] = emailMod.sendNewEmail.mock.calls[0];
  expect(sentConfig).toBe(OPERATOR);
  expect(opts.to).toBe('operator@test.example.com');
  expect(opts.subject).toBe("[GetKlosed] Sam Agent's lead sheet couldn't be read (access denied)");
  expect(opts.body).toBe(ACCESS_DENIED_BODY);
  expect(result).toEqual({ sent: true });
});

test('2. leads unavailable (not_found): subject and body carry the deleted-or-moved line', async () => {
  const leads = { status: 'unavailable', errorKind: 'not_found' };

  const result = await alertOperatorSheetUnavailable(AGENT, leads, { loadOperator: loadOperatorMock });

  expect(emailMod.sendNewEmail).toHaveBeenCalledTimes(1);
  const [, opts] = emailMod.sendNewEmail.mock.calls[0];
  expect(opts.subject).toBe("[GetKlosed] Sam Agent's lead sheet couldn't be read (not found)");
  expect(opts.body).toBe(NOT_FOUND_BODY);
  expect(result).toEqual({ sent: true });
});

test('3. leads ok or not_configured: no send, reason not_unavailable', async () => {
  const okResult = await alertOperatorSheetUnavailable(AGENT, { status: 'ok', errorKind: null }, { loadOperator: loadOperatorMock });
  expect(okResult).toEqual({ sent: false, reason: 'not_unavailable' });

  const notConfiguredResult = await alertOperatorSheetUnavailable(AGENT, { status: 'not_configured', errorKind: null }, { loadOperator: loadOperatorMock });
  expect(notConfiguredResult).toEqual({ sent: false, reason: 'not_unavailable' });

  expect(emailMod.sendNewEmail).not.toHaveBeenCalled();
  expect(loadOperatorMock).not.toHaveBeenCalled();
});

test('4. no operatorId: no send, reason no_operator, loadOperator not called', async () => {
  const agentNoOperator = {
    agentId: 'agent-1',
    agentName: 'Sam Agent',
    googleSheetId: 'sheet-123',
  };
  const leads = { status: 'unavailable', errorKind: 'permission' };

  const result = await alertOperatorSheetUnavailable(agentNoOperator, leads, { loadOperator: loadOperatorMock });

  expect(result).toEqual({ sent: false, reason: 'no_operator' });
  expect(loadOperatorMock).not.toHaveBeenCalled();
  expect(emailMod.sendNewEmail).not.toHaveBeenCalled();
});

test('5. loadOperator throws: no send, reason operator_load_failed, does not throw', async () => {
  loadOperatorMock.mockImplementation(() => {
    throw new Error('operator config not found');
  });
  const leads = { status: 'unavailable', errorKind: 'permission' };

  const result = await alertOperatorSheetUnavailable(AGENT, leads, { loadOperator: loadOperatorMock });

  expect(result).toEqual({ sent: false, reason: 'operator_load_failed' });
  expect(emailMod.sendNewEmail).not.toHaveBeenCalled();
});

test('6. operator with no operatorEmail: no send, reason no_operator_email', async () => {
  loadOperatorMock.mockReturnValue({ operatorId: 'op-1' });
  const leads = { status: 'unavailable', errorKind: 'permission' };

  const result = await alertOperatorSheetUnavailable(AGENT, leads, { loadOperator: loadOperatorMock });

  expect(result).toEqual({ sent: false, reason: 'no_operator_email' });
  expect(emailMod.sendNewEmail).not.toHaveBeenCalled();
});

test('7. sendNewEmail always rejects: resolves sent false reason send_failed, does not throw', async () => {
  jest.useFakeTimers();
  try {
    emailMod.sendNewEmail.mockRejectedValue(new Error('SMTP timeout'));
    const leads = { status: 'unavailable', errorKind: 'permission' };

    const promise = alertOperatorSheetUnavailable(AGENT, leads, { loadOperator: loadOperatorMock });
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ sent: false, reason: 'send_failed' });
    expect(emailMod.sendNewEmail).toHaveBeenCalledTimes(3);
  } finally {
    jest.useRealTimers();
  }
});
