'use strict';

// CASA 2.2.1: the default MemoryStore (node_modules/express-session/session/
// memory.js) only prunes an expired session record lazily, inside get(),
// when that exact sid is looked up again (getSession(), lines 164-187,
// deletes the entry if `expires <= Date.now()`). There is no background
// reaper. A session nobody ever looks up again (the common case once its
// cookie has expired in the browser) sits in process memory until the
// server restarts.
//
// store.all() (memory.js lines 58-72) walks every sid and calls the same
// getSession() helper for each one, which means it deletes expired entries
// as a side effect of simply being called. Calling store.all() on a timer
// turns that side effect into a real reaper, with no new dependency.

const session = require('express-session');

const { MemoryStore } = session;

function createSessionStore() {
  return new MemoryStore();
}

// Runs one sweep pass immediately (no timer), for tests and for the
// interval callback below to share the same code path.
function sweepExpiredSessions(store) {
  return new Promise((resolve, reject) => {
    store.all((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// Hourly: comfortably inside the 12 hour cookie maxAge set in server.js, so
// an expired session's memory is reclaimed well before it would matter, but
// not so frequent that this does real work every few seconds for nothing.
const SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

function startSessionSweep(store, intervalMs = SESSION_SWEEP_INTERVAL_MS) {
  const timer = setInterval(() => {
    store.all(() => {});
  }, intervalMs);
  // Must never hold the process open. An un-unref'd interval here is
  // exactly the kind of thing that hangs Jest on exit.
  timer.unref();
  return timer;
}

module.exports = {
  createSessionStore,
  sweepExpiredSessions,
  startSessionSweep,
  SESSION_SWEEP_INTERVAL_MS,
};
