'use strict';

const fs = require('fs');
const path = require('path');
const { incrementWeeklyPreflightSkips, resetWeeklyPreflightSkips, getState } = require('../src/agentState');

const AGENT_ID = 'test-preflight-skip-counter';
const STATE_PATH = path.join(__dirname, '..', 'agents', `${AGENT_ID}.state.json`);

beforeEach(() => {
  if (fs.existsSync(STATE_PATH)) fs.unlinkSync(STATE_PATH);
});

afterEach(() => {
  if (fs.existsSync(STATE_PATH)) fs.unlinkSync(STATE_PATH);
});

test('incrementWeeklyPreflightSkips on fresh agent creates file with weeklyPreflightSkips: 1 and preserves lastTokenIssued: 0', () => {
  const result = incrementWeeklyPreflightSkips(AGENT_ID);
  expect(result).toBe(1);
  const state = getState(AGENT_ID);
  expect(state.weeklyPreflightSkips).toBe(1);
  expect(state.lastTokenIssued).toBe(0);
});

test('incrementWeeklyPreflightSkips called three times returns 1, 2, 3 and persists 3', () => {
  expect(incrementWeeklyPreflightSkips(AGENT_ID)).toBe(1);
  expect(incrementWeeklyPreflightSkips(AGENT_ID)).toBe(2);
  expect(incrementWeeklyPreflightSkips(AGENT_ID)).toBe(3);
  const state = getState(AGENT_ID);
  expect(state.weeklyPreflightSkips).toBe(3);
});

test('incrementWeeklyPreflightSkips preserves non-zero lastTokenIssued', () => {
  const { setState } = require('../src/agentState');
  setState(AGENT_ID, { lastTokenIssued: 7, weeklyPreflightSkips: 0 });
  incrementWeeklyPreflightSkips(AGENT_ID);
  const state = getState(AGENT_ID);
  expect(state.weeklyPreflightSkips).toBe(1);
  expect(state.lastTokenIssued).toBe(7);
});

test('resetWeeklyPreflightSkips sets counter to 0 without touching lastTokenIssued', () => {
  const { setState } = require('../src/agentState');
  setState(AGENT_ID, { lastTokenIssued: 5, weeklyPreflightSkips: 9 });
  resetWeeklyPreflightSkips(AGENT_ID);
  const state = getState(AGENT_ID);
  expect(state.weeklyPreflightSkips).toBe(0);
  expect(state.lastTokenIssued).toBe(5);
});

test('resetWeeklyPreflightSkips on fresh agent creates file with weeklyPreflightSkips: 0', () => {
  resetWeeklyPreflightSkips(AGENT_ID);
  const state = getState(AGENT_ID);
  expect(state.weeklyPreflightSkips).toBe(0);
});
