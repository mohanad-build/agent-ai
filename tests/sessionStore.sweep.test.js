'use strict';

// CASA 2.2.1 evidence: the default MemoryStore has no background reaper
// (see the comment in src/sessionStore.js quoting node_modules/express-
// session/session/memory.js). These tests prove the reaper we added
// actually removes an expired session's server-side record, and that it
// leaves a still-valid session alone.

const { createSessionStore, sweepExpiredSessions } = require('../src/sessionStore');

// Matches the cookie.maxAge set in src/server.js's session() config.
const MAX_AGE_MS = 1000 * 60 * 60 * 12;

function sessionExpiringAt(expiresAtMs) {
  return { cookie: { expires: new Date(expiresAtMs) }, authenticated: true };
}

function setSession(store, sid, sess) {
  return new Promise((resolve) => store.set(sid, sess, resolve));
}

describe('session store reaper (CASA 2.2.1)', () => {
  beforeEach(() => {
    // Only Date is faked. Real timers/setImmediate stay real so the
    // store's own async callbacks (used internally by set/all) still fire.
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('removes the server-side record for a session past maxAge', async () => {
    const store = createSessionStore();
    const createdAt = Date.now();
    await setSession(store, 'expired-sid', sessionExpiringAt(createdAt + MAX_AGE_MS));

    jest.setSystemTime(createdAt + MAX_AGE_MS + 1000); // advance the fake clock past maxAge

    await sweepExpiredSessions(store);

    expect(store.sessions['expired-sid']).toBeUndefined();
  });

  it('control: a session still inside maxAge survives the same sweep', async () => {
    const store = createSessionStore();
    const createdAt = Date.now();
    await setSession(store, 'live-sid', sessionExpiringAt(createdAt + MAX_AGE_MS));

    jest.setSystemTime(createdAt + MAX_AGE_MS - 1000); // still inside maxAge

    await sweepExpiredSessions(store);

    expect(store.sessions['live-sid']).toBeDefined();
  });
});
