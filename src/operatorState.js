// src/operatorState.js
//
// Per-operator state stored in STORAGE_ROOT/_operators/<operatorId>.state.json.
// Mirrors src/agentState.js exactly, scoped to operators.

const fs   = require('fs');
const path = require('path');

const { getStorageRoot } = require('./storagePaths');

const DEFAULT_STATE = { lastWeeklyDigestRun: null };

function statePath(operatorId) {
  return path.join(getStorageRoot(), '_operators', `${operatorId}.state.json`);
}

// Returns the parsed state object for operatorId.
// Returns default state if the file does not exist (does not create it).
// Throws if the file exists but contains malformed JSON.
function getState(operatorId) {
  const filePath = statePath(operatorId);
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

// Writes state to STORAGE_ROOT/_operators/<operatorId>.state.json using an atomic tmp-then-rename pattern.
function setState(operatorId, state) {
  const filePath = statePath(operatorId);
  const tmpPath  = filePath + '.tmp';
  const serialized = JSON.stringify(state, null, 2);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tmpPath, serialized, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function recordWeeklyDigestRun(operatorId, iso) {
  const state = getState(operatorId);
  setState(operatorId, { ...state, lastWeeklyDigestRun: iso });
}

module.exports = { getState, setState, recordWeeklyDigestRun };
