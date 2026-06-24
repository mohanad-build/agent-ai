'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

// getStorageRoot() reads process.env.STORAGE_ROOT at call time, so setting it
// in beforeEach is sufficient without resetting the module cache.
const { getState, setState, recordWeeklyDigestRun } = require('../src/operatorState');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'operatorState-'));
  fs.mkdirSync(path.join(tmpDir, '_operators'));
  process.env.STORAGE_ROOT = tmpDir;
});

afterEach(() => {
  delete process.env.STORAGE_ROOT;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── getState ──────────────────────────────────────────────────────────────────

describe('getState', () => {
  test('returns parsed state from STORAGE_ROOT/_operators/<id>.state.json', () => {
    const state = { lastWeeklyDigestRun: '2026-06-01T08:00:00.000Z' };
    fs.writeFileSync(
      path.join(tmpDir, '_operators', 'test-op.state.json'),
      JSON.stringify(state),
    );
    expect(getState('test-op')).toEqual(state);
  });

  test('returns default state { lastWeeklyDigestRun: null } when file does not exist', () => {
    expect(getState('no-such-op')).toEqual({ lastWeeklyDigestRun: null });
  });
});

// ── setState ──────────────────────────────────────────────────────────────────

describe('setState', () => {
  test('writes via atomic tmp-then-rename and file ends up at expected path', () => {
    const state = { lastWeeklyDigestRun: '2026-06-01T08:00:00.000Z' };
    setState('test-op', state);

    const expectedPath = path.join(tmpDir, '_operators', 'test-op.state.json');
    expect(fs.existsSync(expectedPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(expectedPath, 'utf8'))).toEqual(state);

    // tmp file should be cleaned up by rename
    expect(fs.existsSync(expectedPath + '.tmp')).toBe(false);
  });
});

// ── recordWeeklyDigestRun ─────────────────────────────────────────────────────

describe('recordWeeklyDigestRun', () => {
  test('reads-modify-writes lastWeeklyDigestRun correctly', () => {
    const iso = '2026-06-24T08:00:00.000Z';
    recordWeeklyDigestRun('test-op', iso);

    const filePath = path.join(tmpDir, '_operators', 'test-op.state.json');
    const written = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(written.lastWeeklyDigestRun).toBe(iso);
  });

  test('preserves existing state fields when updating lastWeeklyDigestRun', () => {
    const initial = { lastWeeklyDigestRun: null, extraField: 'preserved' };
    fs.writeFileSync(
      path.join(tmpDir, '_operators', 'test-op.state.json'),
      JSON.stringify(initial),
    );

    recordWeeklyDigestRun('test-op', '2026-06-24T08:00:00.000Z');

    const filePath = path.join(tmpDir, '_operators', 'test-op.state.json');
    const written = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(written.extraField).toBe('preserved');
    expect(written.lastWeeklyDigestRun).toBe('2026-06-24T08:00:00.000Z');
  });
});
