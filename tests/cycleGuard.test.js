'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const cycleGuard = require('../src/cycleGuard');
const { runGuardedCycle, checkWatchdog, countRecentRestarts, isCycleRunning } = cycleGuard;
const { beginCycle, endCycle, appendRestartLog, formatDuration, STUCK_THRESHOLD_MS } = cycleGuard._internal;

// cycleStartedAtMs is module-level state; every test starts from a clean
// slate regardless of what an earlier test left behind.
beforeEach(() => {
  endCycle();
});

// ── formatDuration ────────────────────────────────────────────────────────

describe('formatDuration', () => {
  test('30 minutes', () => {
    expect(formatDuration(30 * 60 * 1000)).toBe('30m');
  });

  test('rounds 90 seconds up to 2m', () => {
    expect(formatDuration(90 * 1000)).toBe('2m');
  });
});

// ── runGuardedCycle ───────────────────────────────────────────────────────

describe('runGuardedCycle', () => {
  test('runs cycleFn and reports ran: true', async () => {
    const cycleFn = jest.fn().mockResolvedValue(undefined);
    const result = await runGuardedCycle(cycleFn, { getNow: () => 0 });
    expect(cycleFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ran: true });
  });

  test('a concurrent call while one is in flight does not run its own cycleFn, and logs the skip', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    let releaseFirst;
    const firstCycleFn = () => new Promise((resolve) => { releaseFirst = resolve; });
    const secondCycleFn = jest.fn().mockResolvedValue(undefined);

    const firstPromise = runGuardedCycle(firstCycleFn, { getNow: () => 1000 });
    const secondResult = await runGuardedCycle(secondCycleFn, { getNow: () => 1000 + 6 * 60 * 1000 });

    expect(secondResult).toEqual({ ran: false });
    expect(secondCycleFn).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith('[cycle-guard] skipped tick: a cycle has been running for 6m');

    releaseFirst();
    await firstPromise;
    consoleSpy.mockRestore();
  });

  test('cycleFn throws: isCycleRunning() is false afterward, and the error still propagates', async () => {
    const boom = new Error('cycle boom');
    const cycleFn = jest.fn().mockRejectedValue(boom);

    await expect(runGuardedCycle(cycleFn, { getNow: () => 0 })).rejects.toBe(boom);
    expect(isCycleRunning()).toBe(false);
  });

  test('logs the finished duration on a normal completion', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    let call = 0;
    const times = [1000, 1000 + 4 * 60 * 1000];
    const getNow = () => times[call++];

    await runGuardedCycle(jest.fn().mockResolvedValue(undefined), { getNow });

    expect(consoleSpy).toHaveBeenCalledWith('[cycle-guard] cycle finished in 4m');
    consoleSpy.mockRestore();
  });
});

// ── checkWatchdog ─────────────────────────────────────────────────────────

describe('checkWatchdog', () => {
  test('no cycle running: does not exit', () => {
    const exit = jest.fn();
    const result = checkWatchdog({ getNow: () => 0, exit });
    expect(result).toEqual({ exited: false });
    expect(exit).not.toHaveBeenCalled();
  });

  test('cycle running 29 minutes: does not exit', () => {
    beginCycle({ getNow: () => 0 });
    const exit = jest.fn();
    const result = checkWatchdog({ getNow: () => 29 * 60 * 1000, exit });
    expect(result).toEqual({ exited: false });
    expect(exit).not.toHaveBeenCalled();
  });

  test('cycle running exactly 30 minutes: exits and writes the restart log line', () => {
    beginCycle({ getNow: () => 0 });
    const exit = jest.fn();
    const appendFileSync = jest.fn();
    const result = checkWatchdog({ getNow: () => STUCK_THRESHOLD_MS, exit, fs: { appendFileSync }, logPath: '/tmp/fake-restart.log' });

    expect(result).toEqual({ exited: true });
    expect(exit).toHaveBeenCalledWith(1);
    expect(appendFileSync).toHaveBeenCalledTimes(1);
    expect(appendFileSync).toHaveBeenCalledWith(
      '/tmp/fake-restart.log',
      '1970-01-01T00:30:00.000Z ran for 30m\n',
      'utf8'
    );
  });

  test('a restart-log write failure still lets the watchdog exit', () => {
    beginCycle({ getNow: () => 0 });
    const exit = jest.fn();
    const appendFileSync = jest.fn(() => { throw new Error('disk full'); });
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = checkWatchdog({ getNow: () => STUCK_THRESHOLD_MS, exit, fs: { appendFileSync } });

    expect(result).toEqual({ exited: true });
    expect(exit).toHaveBeenCalledWith(1);
    consoleErrorSpy.mockRestore();
  });
});

// ── countRecentRestarts ───────────────────────────────────────────────────

describe('countRecentRestarts', () => {
  const NOW_MS = new Date('2026-06-15T12:00:00.000Z').getTime();

  test('file does not exist: count 0, no error', () => {
    const readFileSync = jest.fn(() => {
      const err = new Error('no such file');
      err.code = 'ENOENT';
      throw err;
    });
    const result = countRecentRestarts(NOW_MS, 7, { fs: { readFileSync } });
    expect(result).toEqual({ count: 0, error: null });
  });

  test('3 lines all within the last 7 days: count 3', () => {
    const raw = [
      '2026-06-09T12:00:00.000Z ran for 30m',
      '2026-06-10T08:00:00.000Z ran for 31m',
      '2026-06-14T23:59:00.000Z ran for 45m',
    ].join('\n') + '\n';
    const readFileSync = jest.fn().mockReturnValue(raw);
    const result = countRecentRestarts(NOW_MS, 7, { fs: { readFileSync } });
    expect(result).toEqual({ count: 3, error: null });
  });

  test('2 recent lines plus 1 line 8 days old: counts only the 2 recent ones', () => {
    const raw = [
      '2026-06-10T08:00:00.000Z ran for 31m', // 5 days old: in window
      '2026-06-14T23:59:00.000Z ran for 45m', // < 1 day old: in window
      '2026-06-07T12:00:00.000Z ran for 30m', // 8 days old: out of window
    ].join('\n') + '\n';
    const readFileSync = jest.fn().mockReturnValue(raw);
    const result = countRecentRestarts(NOW_MS, 7, { fs: { readFileSync } });
    expect(result).toEqual({ count: 2, error: null });
  });

  test('a line whose leading timestamp does not parse is skipped, not counted, and does not throw', () => {
    const raw = [
      '2026-06-14T23:59:00.000Z ran for 45m',
      'garbage',
    ].join('\n') + '\n';
    const readFileSync = jest.fn().mockReturnValue(raw);
    const result = countRecentRestarts(NOW_MS, 7, { fs: { readFileSync } });
    expect(result).toEqual({ count: 1, error: null });
  });

  test('a non-ENOENT read error: count 0, error is the message', () => {
    const readFileSync = jest.fn(() => {
      const err = new Error('EACCES: permission denied');
      err.code = 'EACCES';
      throw err;
    });
    const result = countRecentRestarts(NOW_MS, 7, { fs: { readFileSync } });
    expect(result).toEqual({ count: 0, error: 'EACCES: permission denied' });
  });
});

// ── appendRestartLog / countRecentRestarts round trip, real filesystem ────

describe('restart log round trip on a real temp directory', () => {
  let tmpDir;
  let logPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cycleGuard-'));
    logPath = path.join(tmpDir, '_cycle-restarts.log');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('a line written by appendRestartLog is read back and counted', () => {
    const nowMs = new Date('2026-06-15T12:31:00.000Z').getTime();
    appendRestartLog(nowMs, 31 * 60 * 1000, { logPath });

    expect(fs.readFileSync(logPath, 'utf8')).toBe('2026-06-15T12:31:00.000Z ran for 31m\n');

    const result = countRecentRestarts(nowMs, 7, { logPath });
    expect(result).toEqual({ count: 1, error: null });
  });
});
