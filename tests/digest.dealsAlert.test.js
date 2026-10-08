'use strict';

const fs = require('fs');

jest.mock('../src/email');

const emailMod = require('../src/email');
const { alertOperatorDealsUnavailable } = require('../src/digest');

const AGENT = {
  agentId: 'agent-1',
  agentName: 'Sam Agent',
  operatorId: 'op-1',
};

const OPERATOR = {
  operatorId: 'op-1',
  operatorEmail: 'operator@test.example.com',
};

let loadOperatorMock;
let appendFileSyncSpy;
let warnSpy;

beforeEach(() => {
  loadOperatorMock = jest.fn().mockReturnValue(OPERATOR);
  emailMod.sendNewEmail.mockResolvedValue();
  appendFileSyncSpy = jest.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  appendFileSyncSpy.mockRestore();
  warnSpy.mockRestore();
  jest.clearAllMocks();
});

// ── Guards ──────────────────────────────────────────────────────────────────

test('1. deals ok: no send, reason not_applicable', async () => {
  const result = await alertOperatorDealsUnavailable(AGENT, { status: 'ok' }, { loadOperator: loadOperatorMock });
  expect(result).toEqual({ sent: false, reason: 'not_applicable' });
  expect(emailMod.sendNewEmail).not.toHaveBeenCalled();
  expect(loadOperatorMock).not.toHaveBeenCalled();
});

test('2. deals missing: no send, reason not_applicable', async () => {
  const result = await alertOperatorDealsUnavailable(AGENT, undefined, { loadOperator: loadOperatorMock });
  expect(result).toEqual({ sent: false, reason: 'not_applicable' });
  expect(emailMod.sendNewEmail).not.toHaveBeenCalled();
});

test('3. no operatorId: no send, reason no_operator, loadOperator not called, exact warn text', async () => {
  const agentNoOperator = { agentId: 'agent-1', agentName: 'Sam Agent' };
  const deals = { status: 'unreadable', unreadable: [{ transactionId: 'txn-1', error: 'boom', stage: 'read' }] };

  const result = await alertOperatorDealsUnavailable(agentNoOperator, deals, { loadOperator: loadOperatorMock });

  expect(result).toEqual({ sent: false, reason: 'no_operator' });
  expect(loadOperatorMock).not.toHaveBeenCalled();
  expect(emailMod.sendNewEmail).not.toHaveBeenCalled();
  expect(warnSpy).toHaveBeenCalledWith('[agent-1] deals alert NOT sent: reason=no_operator');
});

test('4. loadOperator throws: no send, reason operator_load_failed, exact warn text', async () => {
  loadOperatorMock.mockImplementation(() => { throw new Error('operator config not found'); });
  const deals = { status: 'error', error: 'read failed' };

  const result = await alertOperatorDealsUnavailable(AGENT, deals, { loadOperator: loadOperatorMock });

  expect(result).toEqual({ sent: false, reason: 'operator_load_failed' });
  expect(emailMod.sendNewEmail).not.toHaveBeenCalled();
  expect(warnSpy).toHaveBeenCalledWith('[agent-1] deals alert NOT sent: reason=operator_load_failed');
});

test('5. operator with no operatorEmail: no send, reason no_operator_email, exact warn text', async () => {
  loadOperatorMock.mockReturnValue({ operatorId: 'op-1' });
  const deals = { status: 'error', error: 'read failed' };

  const result = await alertOperatorDealsUnavailable(AGENT, deals, { loadOperator: loadOperatorMock });

  expect(result).toEqual({ sent: false, reason: 'no_operator_email' });
  expect(emailMod.sendNewEmail).not.toHaveBeenCalled();
  expect(warnSpy).toHaveBeenCalledWith('[agent-1] deals alert NOT sent: reason=no_operator_email');
});

test('6. sendNewEmail always rejects: resolves sent false reason send_failed, exact warn text, logs to digest-errors', async () => {
  jest.useFakeTimers();
  try {
    emailMod.sendNewEmail.mockRejectedValue(new Error('SMTP timeout'));
    const deals = { status: 'error', error: 'read failed' };

    const promise = alertOperatorDealsUnavailable(AGENT, deals, { loadOperator: loadOperatorMock });
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ sent: false, reason: 'send_failed' });
    expect(emailMod.sendNewEmail).toHaveBeenCalledTimes(3);
    expect(warnSpy).toHaveBeenCalledWith('[agent-1] deals alert NOT sent: reason=send_failed');
    expect(appendFileSyncSpy).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

// ── 'unreadable' status ──────────────────────────────────────────────────────

test('7. unreadable, one read-stage entry: exact subject and body', async () => {
  const deals = {
    status: 'unreadable',
    unreadable: [{ transactionId: 'txn-20261008-aaa', error: 'Unexpected token in JSON', stage: 'read' }],
  };

  const result = await alertOperatorDealsUnavailable(AGENT, deals, { loadOperator: loadOperatorMock });

  expect(result).toEqual({ sent: true });
  const [, opts] = emailMod.sendNewEmail.mock.calls[0];
  expect(opts.subject).toBe("[GetKlosed] agent-1's deal files couldn't be read");
  expect(opts.body).toBe([
    "agent-1's deal files couldn't be read this morning.",
    '',
    'Agent: agent-1',
    '',
    'Unreadable:',
    '',
    "txn-20261008-aaa: the file couldn't be read (damaged or not valid JSON)",
    'File: agent-1.transactions/txn-20261008-aaa.json',
    'Error: Unexpected token in JSON',
    '',
    'This repeats each morning until fixed.',
  ].join('\n'));
});

test('8. unreadable, one entry of each stage in the same email: both wordings render', async () => {
  const deals = {
    status: 'unreadable',
    unreadable: [
      { transactionId: 'txn-read', error: 'bad json', stage: 'read' },
      { transactionId: 'txn-alerts', error: 'rule threw', stage: 'alerts' },
    ],
  };

  await alertOperatorDealsUnavailable(AGENT, deals, { loadOperator: loadOperatorMock });

  const [, opts] = emailMod.sendNewEmail.mock.calls[0];
  expect(opts.body).toBe([
    "agent-1's deal files couldn't be read this morning.",
    '',
    'Agent: agent-1',
    '',
    'Unreadable:',
    '',
    "txn-read: the file couldn't be read (damaged or not valid JSON)",
    'File: agent-1.transactions/txn-read.json',
    'Error: bad json',
    '',
    "txn-alerts: the file was read, but its alerts couldn't be worked out",
    'File: agent-1.transactions/txn-alerts.json',
    'Error: rule threw',
    '',
    'This repeats each morning until fixed.',
  ].join('\n'));
});

// ── 'error' status ───────────────────────────────────────────────────────────

test('9. error status: exact subject and body', async () => {
  const deals = { status: 'error', error: 'ENOTDIR: not a directory' };

  const result = await alertOperatorDealsUnavailable(AGENT, deals, { loadOperator: loadOperatorMock });

  expect(result).toEqual({ sent: true });
  const [, opts] = emailMod.sendNewEmail.mock.calls[0];
  expect(opts.subject).toBe("[GetKlosed] agent-1's deals failed to load");
  expect(opts.body).toBe([
    "agent-1's deals failed to load this morning.",
    '',
    'Agent: agent-1',
    '',
    'The whole deals section failed for this agent.',
    'Error: ENOTDIR: not a directory',
    '',
    'This repeats each morning until fixed.',
  ].join('\n'));
});

// ── Truncation ────────────────────────────────────────────────────────────────

test('10. a 300-character error is cut to 200 chars plus an ellipsis', async () => {
  const longError = 'x'.repeat(300);
  const deals = { status: 'error', error: longError };

  await alertOperatorDealsUnavailable(AGENT, deals, { loadOperator: loadOperatorMock });

  const [, opts] = emailMod.sendNewEmail.mock.calls[0];
  expect(opts.body).toContain(`Error: ${'x'.repeat(200)}...`);
  expect(opts.body).not.toContain('x'.repeat(201));
});

test('11. a 199-character error is not cut', async () => {
  const shortError = 'y'.repeat(199);
  const deals = { status: 'error', error: shortError };

  await alertOperatorDealsUnavailable(AGENT, deals, { loadOperator: loadOperatorMock });

  const [, opts] = emailMod.sendNewEmail.mock.calls[0];
  expect(opts.body).toContain(`Error: ${shortError}`);
  expect(opts.body).not.toContain('...');
});
