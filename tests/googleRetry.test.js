'use strict';

const fs = require('fs');

const { withGoogleRetry, _internal } = require('../src/googleRetry');
const { computeBackoffMs } = _internal;

function makeHttpError(status, headers) {
  return { message: `http ${status}`, response: { status, headers: headers || {} } };
}

function makeNetworkError() {
  return { message: 'socket hang up', code: 'ECONNRESET' };
}

describe('withGoogleRetry', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('succeeds on first attempt: no delay, fn called once', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withGoogleRetry({ agentId: 'a1' }, fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('succeeds on second attempt after one retryable failure', async () => {
    jest.useFakeTimers();
    const fn = jest.fn()
      .mockRejectedValueOnce(makeHttpError(500))
      .mockResolvedValue('ok');

    const resultPromise = withGoogleRetry({ agentId: 'a1' }, fn);
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('succeeds on third attempt after two retryable failures', async () => {
    jest.useFakeTimers();
    const fn = jest.fn()
      .mockRejectedValueOnce(makeHttpError(500))
      .mockRejectedValueOnce(makeHttpError(503))
      .mockResolvedValue('ok');

    const resultPromise = withGoogleRetry({ agentId: 'a1' }, fn);
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('exhausts after three attempts: rejects with the third error, fn called thrice', async () => {
    jest.useFakeTimers();
    const err1 = makeHttpError(500);
    const err2 = makeHttpError(502);
    const err3 = makeHttpError(503);
    const fn = jest.fn()
      .mockRejectedValueOnce(err1)
      .mockRejectedValueOnce(err2)
      .mockRejectedValueOnce(err3);

    const resultPromise = withGoogleRetry({ agentId: 'a1' }, fn);
    const assertion = expect(resultPromise).rejects.toBe(err3);
    await jest.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test.each([429, 500, 502, 503])('status %d is retried', async (status) => {
    jest.useFakeTimers();
    const fn = jest.fn()
      .mockRejectedValueOnce(makeHttpError(status))
      .mockResolvedValue('ok');

    const resultPromise = withGoogleRetry({ agentId: 'a1' }, fn);
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('network-level error (no response) is retried', async () => {
    jest.useFakeTimers();
    const fn = jest.fn()
      .mockRejectedValueOnce(makeNetworkError())
      .mockResolvedValue('ok');

    const resultPromise = withGoogleRetry({ agentId: 'a1' }, fn);
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test.each([400, 403, 404])('status %d is NOT retried: thrown immediately, fn called once', async (status) => {
    const err = makeHttpError(status);
    const fn = jest.fn().mockRejectedValue(err);

    await expect(withGoogleRetry({ agentId: 'a1' }, fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('Retry-After header is honoured over the computed backoff', async () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const err = makeHttpError(429, { 'retry-after': '2' });
    const fn = jest.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValue('ok');

    const resultPromise = withGoogleRetry({ agentId: 'a1' }, fn);
    await jest.runAllTimersAsync();
    await resultPromise;

    // Computed jitter for attempt 1 is in [0, BASE_DELAY_MS) = [0, 1000)ms,
    // so 2000ms could only have come from the Retry-After header.
    const delayArgs = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(delayArgs).toContain(2000);
    setTimeoutSpy.mockRestore();
  });

  test('jitter produces different delays for the same attempt across runs', () => {
    const randomSpy = jest.spyOn(Math, 'random');
    randomSpy.mockReturnValueOnce(0.1);
    const delayA = computeBackoffMs(1);
    randomSpy.mockReturnValueOnce(0.9);
    const delayB = computeBackoffMs(1);
    expect(delayA).not.toBe(delayB);
    randomSpy.mockRestore();
  });

  describe('auth failure short-circuit', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    test('invalid_grant short-circuits with no retry; handleAuthFailure is called', async () => {
      jest.doMock('../src/gmail', () => ({
        isAuthFailure: jest.fn(() => true),
        handleAuthFailure: jest.fn(() => {
          throw new Error('AuthFailureError-mock');
        }),
      }));

      const { withGoogleRetry: withGoogleRetryMocked } = require('../src/googleRetry');
      const { isAuthFailure: mockIsAuthFailure, handleAuthFailure: mockHandleAuthFailure } = require('../src/gmail');

      const agentConfig = { agentId: 'a1' };
      const authErr = { message: 'invalid_grant' };
      const fn = jest.fn().mockRejectedValue(authErr);

      await expect(withGoogleRetryMocked(agentConfig, fn)).rejects.toThrow('AuthFailureError-mock');

      expect(fn).toHaveBeenCalledTimes(1);
      expect(mockIsAuthFailure).toHaveBeenCalledWith(authErr);
      expect(mockHandleAuthFailure).toHaveBeenCalledWith(agentConfig, authErr);
    });
  });
});

// ── Pinned assumption ─────────────────────────────────────────────────────
//
// gaxios's httpMethodsToRetry list is a local variable inside
// getRetryConfig, not an exported constant, so it cannot be imported
// directly (tried: `require('gaxios/build/src/retry').httpMethodsToRetry`
// -- retry.js only exports `getRetryConfig`). This test instead reads the
// installed source file as text and parses the array literal out of it, so
// a version bump that adds POST to that list fails this test loudly instead
// of silently invalidating the reasoning this whole module is built on.
describe('pinned assumption: gaxios does not retry POST by default', () => {
  test('installed gaxios/build/src/retry.js httpMethodsToRetry does not include POST', () => {
    const retrySrcPath = require.resolve('gaxios/build/src/retry.js');
    const src = fs.readFileSync(retrySrcPath, 'utf8');
    const match = src.match(/httpMethodsToRetry\s*=\s*config\.httpMethodsToRetry\s*\|\|\s*\[([^\]]*)\]/);
    if (!match) {
      throw new Error(
        'Could not find the httpMethodsToRetry array literal in installed gaxios/build/src/retry.js. ' +
        'The source shape has changed since this pin was written -- rewrite the pin, do not delete it.'
      );
    }
    const methods = match[1]
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter(Boolean);

    expect(methods.length).toBeGreaterThan(0);
    expect(methods).not.toContain('POST');
  });
});
