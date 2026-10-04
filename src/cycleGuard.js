// src/cycleGuard.js
//
// Guards src/server.js's orchestrator loop against overlapping cycles, and
// against a stuck one. See docs/designs/cycle-guard.md.
//
// A plain "skip if running" guard alone would be worse than nothing: a
// cycle that hangs on a network call that never answers would make every
// later tick skip forever, with nothing crashing to say so. The watchdog
// below exists because a hung network call does not block Node's event
// loop, so the interval checking for it keeps firing; a CPU-bound hang
// would block it too, and is not the failure this guards against.

const fs = require('fs');
const path = require('path');
const { getNow } = require('./time');
const { getStorageRoot } = require('./storagePaths');

const STUCK_THRESHOLD_MS = 30 * 60 * 1000;
const RESTART_LOG_FILENAME = '_cycle-restarts.log';

// Module-level: one process runs one cycle at a time, so one flag is the
// whole guard. null means no cycle is in flight.
let cycleStartedAtMs = null;

function formatDuration(ms) {
  return `${Math.round(ms / 60000)}m`;
}

function restartLogPath(deps) {
  return (deps && deps.logPath) || path.join(getStorageRoot(), RESTART_LOG_FILENAME);
}

function beginCycle(deps = {}) {
  const now = (deps.getNow || getNow)();
  if (cycleStartedAtMs !== null) {
    console.log(`[cycle-guard] skipped tick: a cycle has been running for ${formatDuration(now - cycleStartedAtMs)}`);
    return false;
  }
  cycleStartedAtMs = now;
  return true;
}

function endCycle(deps = {}) {
  const now = (deps.getNow || getNow)();
  if (cycleStartedAtMs !== null) {
    console.log(`[cycle-guard] cycle finished in ${formatDuration(now - cycleStartedAtMs)}`);
  }
  cycleStartedAtMs = null;
}

function isCycleRunning() {
  return cycleStartedAtMs !== null;
}

// Decision 1 + 2: skips (and logs) if a cycle is already running; otherwise
// runs cycleFn and always clears the flag on the way out, including when
// cycleFn throws, via finally rather than a line after the await. The
// error itself is rethrown unchanged so the caller's own .catch still logs
// it exactly as it did before this guard existed.
async function runGuardedCycle(cycleFn, deps = {}) {
  if (!beginCycle(deps)) {
    return { ran: false };
  }
  try {
    await cycleFn();
  } finally {
    endCycle(deps);
  }
  return { ran: true };
}

function appendRestartLog(nowMs, elapsedMs, deps = {}) {
  const fsImpl = deps.fs || fs;
  const line = `${new Date(nowMs).toISOString()} ran for ${formatDuration(elapsedMs)}\n`;
  fsImpl.appendFileSync(restartLogPath(deps), line, 'utf8');
}

// Decision 3: called roughly once a minute from src/server.js. Never calls
// existsSync: see countRecentRestarts below for why trusting it here would
// be wrong.
function checkWatchdog(deps = {}) {
  if (cycleStartedAtMs === null) {
    return { exited: false };
  }
  const now = (deps.getNow || getNow)();
  const elapsedMs = now - cycleStartedAtMs;
  if (elapsedMs < STUCK_THRESHOLD_MS) {
    return { exited: false };
  }

  try {
    appendRestartLog(now, elapsedMs, deps);
  } catch (err) {
    console.error(`[cycle-guard] failed to write restart log: ${err.message}`);
  }
  console.error(`[cycle-guard] WATCHDOG: cycle stuck for ${formatDuration(elapsedMs)}, exiting process`);
  const exit = deps.exit || ((code) => process.exit(code));
  exit(1);
  return { exited: true };
}

// Decision 4: a read error is only ever "unreadable" when it is something
// other than the file not existing yet. Checking existsSync first would
// create exactly the race that made that distinction meaningless (and in
// this codebase's own weekly-digest test, a blanket fs.existsSync spy
// written for an unrelated agent-discovery check would make existsSync
// lie true for this path too) -- reading directly and keying off the
// error code is both simpler and the only version that is actually
// correct.
function countRecentRestarts(nowMs, days, deps = {}) {
  const fsImpl = deps.fs || fs;
  let raw;
  try {
    raw = fsImpl.readFileSync(restartLogPath(deps), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { count: 0, error: null };
    }
    return { count: 0, error: err.message };
  }

  const cutoffMs = nowMs - days * 24 * 60 * 60 * 1000;
  let count = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const ts = new Date(line.split(' ')[0]).getTime();
    if (!Number.isNaN(ts) && ts >= cutoffMs) count++;
  }
  return { count, error: null };
}

module.exports = {
  runGuardedCycle,
  checkWatchdog,
  countRecentRestarts,
  isCycleRunning,
  _internal: {
    beginCycle,
    endCycle,
    appendRestartLog,
    formatDuration,
    STUCK_THRESHOLD_MS,
    RESTART_LOG_FILENAME,
  },
};
