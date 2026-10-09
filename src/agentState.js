// src/agentState.js
//
// Per-agent state stored in agents/<agentId>.state.json.
// Holds agent-level metadata that does not fit in the per-row Sheet model.

const fs = require('fs');
const path = require('path');
const { getStorageRoot } = require('./storagePaths');
const { isCalendarDate } = require('./calendarDate');

const DEFAULT_STATE = { lastTokenIssued: 0, weeklyPreflightSkips: 0, lastDailyDigestRun: null, deactivatedAt: null, dailyNoiseFiltered: 0, weeklyNoiseFiltered: 0, dailyNoiseArchived: 0, weeklyNoiseArchived: 0 };

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

function incrementNoiseFiltered(agentId) {
  const state = getState(agentId);
  const newDaily = (state.dailyNoiseFiltered || 0) + 1;
  const newWeekly = (state.weeklyNoiseFiltered || 0) + 1;
  setState(agentId, { ...state, dailyNoiseFiltered: newDaily, weeklyNoiseFiltered: newWeekly });
}

function resetDailyNoiseFiltered(agentId) {
  const state = getState(agentId);
  setState(agentId, { ...state, dailyNoiseFiltered: 0 });
}

function resetWeeklyNoiseFiltered(agentId) {
  const state = getState(agentId);
  setState(agentId, { ...state, weeklyNoiseFiltered: 0 });
}

function incrementNoiseArchived(agentId) {
  const state = getState(agentId);
  const newDaily = (state.dailyNoiseArchived || 0) + 1;
  const newWeekly = (state.weeklyNoiseArchived || 0) + 1;
  setState(agentId, { ...state, dailyNoiseArchived: newDaily, weeklyNoiseArchived: newWeekly });
}

function resetDailyNoiseArchived(agentId) {
  const state = getState(agentId);
  setState(agentId, { ...state, dailyNoiseArchived: 0 });
}

function resetWeeklyNoiseArchived(agentId) {
  const state = getState(agentId);
  setState(agentId, { ...state, weeklyNoiseArchived: 0 });
}

function recordDailyDigestRun(agentId, iso) {
  const state = getState(agentId);
  setState(agentId, { ...state, lastDailyDigestRun: iso });
}

// Per-kind, once-a-day cap on agent-facing text-failure alert emails
// (docs/designs/agent-phone.md decision 3). hot_lead is exempt and never
// recorded here; callers skip this pair entirely for that kind.
function hasAlertedToday(agentId, kind, today) {
  const state = getState(agentId);
  return !!(state.smsAlertDates && state.smsAlertDates[kind] === today);
}

function recordAlertSent(agentId, kind, today) {
  const state = getState(agentId);
  setState(agentId, {
    ...state,
    smsAlertDates: { ...(state.smsAlertDates || {}), [kind]: today },
  });
}

// Which TC deal alerts have already reached the brief, so overdue alerts can
// fire on the first brief on or after their threshold, once, instead of only
// on the exact day (which silently lost alerts when that day's brief was missed).
// Shape: { [transactionId]: { [alertKey]: 'YYYY-MM-DD' } }. alertKey is an
// opaque non-empty string (a kind plus whatever distinguishes one firing
// from the next, e.g. a day count) -- this module never parses it, only
// stores and prunes by it.
function getDeliveredDealAlerts(agentId) {
  const state = getState(agentId);
  return state.dealAlertsDelivered || {};
}

// deliveries: array of { transactionId, alertKey }, may be empty. Pruning
// (dropping every transaction group not in activeTransactionIds) runs
// unconditionally, even on an empty deliveries array, so a deal that closed
// or collapsed since the last brief has its delivered-alert history cleared
// instead of silently accumulating keys for a transaction that can never
// produce another alert.
function recordDeliveredDealAlerts(agentId, deliveries, today, activeTransactionIds) {
  if (!Array.isArray(deliveries)) {
    throw new Error('recordDeliveredDealAlerts: deliveries must be an array');
  }
  if (!isCalendarDate(today)) {
    throw new Error('recordDeliveredDealAlerts: today must be a calendar date (YYYY-MM-DD)');
  }
  if (!Array.isArray(activeTransactionIds)) {
    throw new Error('recordDeliveredDealAlerts: activeTransactionIds must be an array');
  }

  deliveries.forEach((delivery) => {
    if (delivery === null || typeof delivery !== 'object' || Array.isArray(delivery)) {
      throw new Error('recordDeliveredDealAlerts: each delivery must be a plain object');
    }
    if (typeof delivery.transactionId !== 'string' || delivery.transactionId === '') {
      throw new Error('recordDeliveredDealAlerts: each delivery must have a non-empty string transactionId');
    }
    if (typeof delivery.alertKey !== 'string' || delivery.alertKey === '') {
      throw new Error('recordDeliveredDealAlerts: each delivery must have a non-empty string alertKey');
    }
    if (!activeTransactionIds.includes(delivery.transactionId)) {
      throw new Error(`recordDeliveredDealAlerts: delivery for transactionId '${delivery.transactionId}' is not in activeTransactionIds`);
    }
  });

  const state = getState(agentId);
  const merged = { ...(state.dealAlertsDelivered || {}) };

  deliveries.forEach(({ transactionId, alertKey }) => {
    merged[transactionId] = { ...(merged[transactionId] || {}), [alertKey]: today };
  });

  Object.keys(merged).forEach((transactionId) => {
    if (!activeTransactionIds.includes(transactionId)) {
      delete merged[transactionId];
    }
  });

  setState(agentId, { ...state, dealAlertsDelivered: merged });
}

module.exports = {
  getState,
  setState,
  issueToken,
  incrementWeeklyPreflightSkips,
  resetWeeklyPreflightSkips,
  incrementNoiseFiltered,
  resetDailyNoiseFiltered,
  resetWeeklyNoiseFiltered,
  incrementNoiseArchived,
  resetDailyNoiseArchived,
  resetWeeklyNoiseArchived,
  recordDailyDigestRun,
  hasAlertedToday,
  recordAlertSent,
  getDeliveredDealAlerts,
  recordDeliveredDealAlerts,
};
