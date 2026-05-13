'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { _internal } = require('../src/digest');
const { _sendWithRetry, _appendDigestErrorLog } = _internal;

// ── _sendWithRetry ────────────────────────────────────────────────────────────

describe('_sendWithRetry', () => {
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    jest.useRealTimers();
  });

  test('succeeds on first attempt: ok=true, attempts=1, lastError=null, sendFn called once', async () => {
    const sendFn = jest.fn().mockResolvedValue(undefined);
    const result = await _sendWithRetry(sendFn, 'test-label');
    expect(result).toEqual({ ok: true, attempts: 1, lastError: null });
    expect(sendFn).toHaveBeenCalledTimes(1);
  });

  test('succeeds on second attempt: ok=true, attempts=2, sendFn called twice, 10s delay elapsed', async () => {
    jest.useFakeTimers();
    const sendFn = jest.fn()
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValue(undefined);

    const resultPromise = _sendWithRetry(sendFn, 'test-label');
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.lastError).toBeNull();
    expect(sendFn).toHaveBeenCalledTimes(2);
  });

  test('succeeds on third attempt: ok=true, attempts=3, sendFn called thrice, 10s then 60s elapsed', async () => {
    jest.useFakeTimers();
    const sendFn = jest.fn()
      .mockRejectedValueOnce(new Error('first fail'))
      .mockRejectedValueOnce(new Error('second fail'))
      .mockResolvedValue(undefined);

    const resultPromise = _sendWithRetry(sendFn, 'test-label');
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
    expect(result.lastError).toBeNull();
    expect(sendFn).toHaveBeenCalledTimes(3);
  });

  test('fails all three: ok=false, attempts=3, lastError set, sendFn called thrice', async () => {
    jest.useFakeTimers();
    const err1 = new Error('fail 1');
    const err2 = new Error('fail 2');
    const err3 = new Error('fail 3');
    const sendFn = jest.fn()
      .mockRejectedValueOnce(err1)
      .mockRejectedValueOnce(err2)
      .mockRejectedValueOnce(err3);

    const resultPromise = _sendWithRetry(sendFn, 'test-label');
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.lastError).toBeTruthy();
    expect(result.lastError.message).toBe('fail 3');
    expect(sendFn).toHaveBeenCalledTimes(3);
  });

  test('lastError matches the last error thrown (not the first)', async () => {
    jest.useFakeTimers();
    const sendFn = jest.fn()
      .mockRejectedValueOnce(new Error('transient error'))
      .mockRejectedValueOnce(new Error('different error'))
      .mockRejectedValueOnce(new Error('final error'));

    const resultPromise = _sendWithRetry(sendFn, 'test-label');
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.lastError.message).toBe('final error');
  });

  test('retry log messages mention the label', async () => {
    jest.useFakeTimers();
    const sendFn = jest.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);

    const resultPromise = _sendWithRetry(sendFn, 'my-label');
    await jest.runAllTimersAsync();
    await resultPromise;

    const logCalls = consoleSpy.mock.calls.map(args => args[0]);
    expect(logCalls.some(msg => msg.includes('my-label'))).toBe(true);
    expect(logCalls.some(msg => msg.includes('retrying'))).toBe(true);
  });

  test('exhaustion log mentions label and last error', async () => {
    jest.useFakeTimers();
    const sendFn = jest.fn().mockRejectedValue(new Error('persistent'));

    const resultPromise = _sendWithRetry(sendFn, 'exhaust-label');
    await jest.runAllTimersAsync();
    await resultPromise;

    const logCalls = consoleSpy.mock.calls.map(args => args[0]);
    expect(logCalls.some(msg => msg.includes('exhausted') && msg.includes('exhaust-label'))).toBe(true);
  });
});

// ── _appendDigestErrorLog ─────────────────────────────────────────────────────

describe('_appendDigestErrorLog', () => {
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    jest.restoreAllMocks();
  });

  test('appends a correctly-formatted line to a tmp file', () => {
    const tmpFile = path.join(os.tmpdir(), `digest-test-${Date.now()}.log`);
    try {
      _appendDigestErrorLog(tmpFile, 'daily-sms', new Error('connection refused'));
      const contents = fs.readFileSync(tmpFile, 'utf8');
      expect(contents).toMatch(/^\[.*\] daily-sms exhausted: connection refused\n$/);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  test('swallows fs errors without throwing and logs to console', () => {
    jest.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });

    expect(() => {
      _appendDigestErrorLog('/fake/path/test.log', 'daily-email', new Error('oops'));
    }).not.toThrow();

    const logCalls = consoleSpy.mock.calls.map(args => args[0]);
    expect(logCalls.some(msg => msg.includes('failed to append'))).toBe(true);
  });
});
