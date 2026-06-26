// src/agentState.js
//
// Per-agent state stored in agents/<agentId>.state.json.
// Holds agent-level metadata that does not fit in the per-row Sheet model.

const fs = require('fs');
const path = require('path');
const { getStorageRoot } = require('./storagePaths');

const DEFAULT_STATE = { lastTokenIssued: 0, weeklyPreflightSkips: 0, lastDailyDigestRun: null, deactivatedAt: null };

function statePath(agentId) {
  return path.join(getStorageRoot(), `${agentId}.state.json`);
}

// Returns the parsed state object for agentId.
// Returns default state if the file does not exist (does not create it).
// Throws if the file exists but contains malformed JSON.
function getState(agentId) {
  const filePath = statePath(agentId);
  if (!fs.existsSync(filePath)) {
    return { ...DEFAULT_STATE };
  }
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read state file at ${filePath}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Malformed state file at ${filePath}: ${err.message}`);
  }
}

// Writes state to agents/<agentId>.state.json using an atomic tmp-then-rename pattern.
function setState(agentId, state) {
  const filePath = statePath(agentId);
  const tmpPath = filePath + '.tmp';
  const serialized = JSON.stringify(state, null, 2);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tmpPath, serialized, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

// Increments lastTokenIssued, persists the new state, and returns the token string.
function issueToken(agentId) {
  const state = getState(agentId);
  const newValue = (state.lastTokenIssued || 0) + 1;
  setState(agentId, { ...state, lastTokenIssued: newValue });
  return 'Q' + newValue;
}

function incrementWeeklyPreflightSkips(agentId) {
  const state = getState(agentId);
  const newValue = (state.weeklyPreflightSkips || 0) + 1;
  setState(agentId, { ...state, weeklyPreflightSkips: newValue });
  return newValue;
}

function resetWeeklyPreflightSkips(agentId) {
  const state = getState(agentId);
  setState(agentId, { ...state, weeklyPreflightSkips: 0 });
}

function recordDailyDigestRun(agentId, iso) {
  const state = getState(agentId);
  setState(agentId, { ...state, lastDailyDigestRun: iso });
}

module.exports = { getState, setState, issueToken, incrementWeeklyPreflightSkips, resetWeeklyPreflightSkips, recordDailyDigestRun };
