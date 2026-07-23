'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const {
  getState,
  setState,
  issueToken,
  incrementWeeklyPreflightSkips,
  resetWeeklyPreflightSkips,
  incrementNoiseFiltered,
  resetDailyNoiseFiltered,
  resetWeeklyNoiseFiltered,
  recordDailyDigestRun,
} = require('../src/agentState');

const AGENT_ID = 'test-agent-state';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentState-'));
  process.env.STORAGE_ROOT = tmpDir;
});

afterEach(() => {
  delete process.env.STORAGE_ROOT;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function statePath() {
  return path.join(tmpDir, `${AGENT_ID}.state.json`);
}

// ── getState ──────────────────────────────────────────────────────────────────

describe('getState', () => {
  test('returns DEFAULT_STATE when state file does not exist', () => {
    const state = getState(AGENT_ID);
    expect(state).toEqual({
      lastTokenIssued: 0,
      weeklyPreflightSkips: 0,
      lastDailyDigestRun: null,
      deactivatedAt: null,
      dailyNoiseFiltered: 0,
      weeklyNoiseFiltered: 0,
    });
  });

  test('parses existing state file', () => {
    const existing = { lastTokenIssued: 5, weeklyPreflightSkips: 2, lastDailyDigestRun: '2026-01-01', deactivatedAt: null };
    fs.writeFileSync(statePath(), JSON.stringify(existing));
    expect(getState(AGENT_ID)).toEqual(existing);
  });

  test('throws with path in error message on malformed JSON', () => {
    fs.writeFileSync(statePath(), 'not-json{{{');
    expect(() => getState(AGENT_ID)).toThrow(statePath());
  });
});

// ── setState ──────────────────────────────────────────────────────────────────

describe('setState', () => {
  test('writes state file and it can be read back', () => {
    const state = { lastTokenIssued: 3, weeklyPreflightSkips: 1, lastDailyDigestRun: null, deactivatedAt: null };
    setState(AGENT_ID, state);
    expect(JSON.parse(fs.readFileSync(statePath(), 'utf8'))).toEqual(state);
  });

  test('writes atomically via tmp-then-rename (no .tmp file left behind)', () => {
    setState(AGENT_ID, { lastTokenIssued: 0, weeklyPreflightSkips: 0, lastDailyDigestRun: null, deactivatedAt: null });
    const tmpFile = statePath() + '.tmp';
    expect(fs.existsSync(tmpFile)).toBe(false);
    expect(fs.existsSync(statePath())).toBe(true);
  });
});

// ── issueToken ────────────────────────────────────────────────────────────────

describe('issueToken', () => {
  test('increments lastTokenIssued from 0 and returns Q1', () => {
    expect(issueToken(AGENT_ID)).toBe('Q1');
    expect(getState(AGENT_ID).lastTokenIssued).toBe(1);
  });

  test('increments lastTokenIssued on successive calls', () => {
    expect(issueToken(AGENT_ID)).toBe('Q1');
    expect(issueToken(AGENT_ID)).toBe('Q2');
    expect(issueToken(AGENT_ID)).toBe('Q3');
    expect(getState(AGENT_ID).lastTokenIssued).toBe(3);
  });
});

// ── incrementWeeklyPreflightSkips ─────────────────────────────────────────────

describe('incrementWeeklyPreflightSkips', () => {
  test('increments from 0 on fresh agent and returns 1', () => {
    expect(incrementWeeklyPreflightSkips(AGENT_ID)).toBe(1);
    expect(getState(AGENT_ID).weeklyPreflightSkips).toBe(1);
  });

  test('successive calls increment correctly', () => {
    incrementWeeklyPreflightSkips(AGENT_ID);
    incrementWeeklyPreflightSkips(AGENT_ID);
    expect(incrementWeeklyPreflightSkips(AGENT_ID)).toBe(3);
  });

  test('does not touch lastTokenIssued', () => {
    setState(AGENT_ID, { lastTokenIssued: 7, weeklyPreflightSkips: 0, lastDailyDigestRun: null, deactivatedAt: null });
    incrementWeeklyPreflightSkips(AGENT_ID);
    expect(getState(AGENT_ID).lastTokenIssued).toBe(7);
  });
});

// ── resetWeeklyPreflightSkips ─────────────────────────────────────────────────

describe('resetWeeklyPreflightSkips', () => {
  test('sets weeklyPreflightSkips to 0', () => {
    setState(AGENT_ID, { lastTokenIssued: 0, weeklyPreflightSkips: 5, lastDailyDigestRun: null, deactivatedAt: null });
    resetWeeklyPreflightSkips(AGENT_ID);
    expect(getState(AGENT_ID).weeklyPreflightSkips).toBe(0);
  });

  test('does not touch lastTokenIssued', () => {
    setState(AGENT_ID, { lastTokenIssued: 9, weeklyPreflightSkips: 3, lastDailyDigestRun: null, deactivatedAt: null });
    resetWeeklyPreflightSkips(AGENT_ID);
    expect(getState(AGENT_ID).lastTokenIssued).toBe(9);
  });

  test('on fresh agent creates file with weeklyPreflightSkips: 0', () => {
    resetWeeklyPreflightSkips(AGENT_ID);
    expect(getState(AGENT_ID).weeklyPreflightSkips).toBe(0);
  });
});

// ── incrementNoiseFiltered / resetDailyNoiseFiltered / resetWeeklyNoiseFiltered ─

describe('incrementNoiseFiltered', () => {
  test('bumps both dailyNoiseFiltered and weeklyNoiseFiltered from 0 on fresh agent', () => {
    incrementNoiseFiltered(AGENT_ID);
    const state = getState(AGENT_ID);
    expect(state.dailyNoiseFiltered).toBe(1);
    expect(state.weeklyNoiseFiltered).toBe(1);
  });

  test('successive calls increment both fields together', () => {
    incrementNoiseFiltered(AGENT_ID);
    incrementNoiseFiltered(AGENT_ID);
    incrementNoiseFiltered(AGENT_ID);
    const state = getState(AGENT_ID);
    expect(state.dailyNoiseFiltered).toBe(3);
    expect(state.weeklyNoiseFiltered).toBe(3);
  });

  test('does not touch lastTokenIssued', () => {
    setState(AGENT_ID, { lastTokenIssued: 7, weeklyPreflightSkips: 0, lastDailyDigestRun: null, deactivatedAt: null, dailyNoiseFiltered: 0, weeklyNoiseFiltered: 0 });
    incrementNoiseFiltered(AGENT_ID);
    expect(getState(AGENT_ID).lastTokenIssued).toBe(7);
  });
});

describe('resetDailyNoiseFiltered', () => {
  test('zeroes dailyNoiseFiltered and leaves weeklyNoiseFiltered intact', () => {
    incrementNoiseFiltered(AGENT_ID);
    incrementNoiseFiltered(AGENT_ID);
    resetDailyNoiseFiltered(AGENT_ID);
    const state = getState(AGENT_ID);
    expect(state.dailyNoiseFiltered).toBe(0);
    expect(state.weeklyNoiseFiltered).toBe(2);
  });

  test('on fresh agent creates file with dailyNoiseFiltered: 0', () => {
    resetDailyNoiseFiltered(AGENT_ID);
    expect(getState(AGENT_ID).dailyNoiseFiltered).toBe(0);
  });
});

describe('resetWeeklyNoiseFiltered', () => {
  test('zeroes weeklyNoiseFiltered and leaves dailyNoiseFiltered intact', () => {
    incrementNoiseFiltered(AGENT_ID);
    incrementNoiseFiltered(AGENT_ID);
    resetWeeklyNoiseFiltered(AGENT_ID);
    const state = getState(AGENT_ID);
    expect(state.weeklyNoiseFiltered).toBe(0);
    expect(state.dailyNoiseFiltered).toBe(2);
  });

  test('on fresh agent creates file with weeklyNoiseFiltered: 0', () => {
    resetWeeklyNoiseFiltered(AGENT_ID);
    expect(getState(AGENT_ID).weeklyNoiseFiltered).toBe(0);
  });
});

// ── recordDailyDigestRun ──────────────────────────────────────────────────────

describe('recordDailyDigestRun', () => {
  test('persists lastDailyDigestRun ISO string', () => {
    const iso = '2026-06-01T08:00:00.000Z';
    recordDailyDigestRun(AGENT_ID, iso);
    expect(getState(AGENT_ID).lastDailyDigestRun).toBe(iso);
  });

  test('overwrites a previous lastDailyDigestRun', () => {
    recordDailyDigestRun(AGENT_ID, '2026-05-01T08:00:00.000Z');
    recordDailyDigestRun(AGENT_ID, '2026-06-01T08:00:00.000Z');
    expect(getState(AGENT_ID).lastDailyDigestRun).toBe('2026-06-01T08:00:00.000Z');
  });

  test('does not touch lastTokenIssued', () => {
    setState(AGENT_ID, { lastTokenIssued: 4, weeklyPreflightSkips: 0, lastDailyDigestRun: null, deactivatedAt: null });
    recordDailyDigestRun(AGENT_ID, '2026-06-01T08:00:00.000Z');
    expect(getState(AGENT_ID).lastTokenIssued).toBe(4);
  });
});
