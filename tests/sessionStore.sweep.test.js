'use strict';

// CASA 2.2.1 evidence: session-file-store implements no background reaper
// exposed on its public API (see the comment in src/sessionStore.js's
// sweepExpiredSessions). These tests prove the reaper we built against
// list/expired/destroy actually removes an expired session's file from
// disk, and that it leaves a still-valid session's file alone.

const fs = require('fs');
const os = require('os');
const path = require('path');
const session = require('express-session');
const FileStoreFactory = require('session-file-store');

const {
  sweepExpiredSessions,
  deriveSessionFileKey,
} = require('../src/sessionStore');

const FileStore = FileStoreFactory(session);
const TEST_SECRET = 'test-session-secret-not-real-but-long-enough';

// Matches the cookie.maxAge set in src/server.js's session() config.
const MAX_AGE_MS = 1000 * 60 * 60 * 12;

let tmpDir;
let store;

function sessionFilePath(sid) {
  return path.join(tmpDir, `${sid}.json`);
}

function setSession(theStore, sid, sess) {
  return new Promise((resolve, reject) => {
    theStore.set(sid, sess, (err) => (err ? reject(err) : resolve()));
  });
}

function destroySession(theStore, sid) {
  return new Promise((resolve, reject) => {
    theStore.destroy(sid, (err) => (err ? reject(err) : resolve()));
  });
}

function sessionWithFreshLastAccess() {
  // FileStore's isExpired (session-file-helpers.js) is __lastAccess-based,
  // not cookie.expires-based like MemoryStore: __lastAccess is stamped by
  // the store itself, inside set(), to whatever Date.now() reads at write
  // time (faked below via jest.setSystemTime). originalMaxAge on the
  // cookie is what real express-session cookies carry, and what
  // isExpired() prefers over the store's own `ttl` option, so this
  // exercises the same branch production sessions actually hit.
  return { cookie: { originalMaxAge: MAX_AGE_MS }, authenticated: true };
}

describe('session store reaper (CASA 2.2.1)', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionStore-sweep-test-'));

    // reapInterval: -1 disables session-file-store's OWN internal reaper
    // for this store instance only. In production (createSessionStore in
    // src/sessionStore.js) that reaper is deliberately left enabled as an
    // independent backstop to our sweep. Here it would be a second actor
    // able to delete the same expired file our sweep is supposed to
    // delete -- with both live, this test would pass whether or not
    // sweepExpiredSessions does anything at all, which is the exact
    // tautology this file exists to avoid (see the store.sessions[sid]
    // history of this file). Disabling it here means the only thing that
    // can possibly remove the file in this test is the call to
    // sweepExpiredSessions() below.
    store = new FileStore({
      path: tmpDir,
      secret: deriveSessionFileKey(TEST_SECRET),
      reapInterval: -1,
    });

    // Only Date is faked. Real timers/setImmediate stay real so the
    // store's own async callbacks still fire, and we never advance fake
    // timers here -- sweepExpiredSessions is always called directly, not
    // waited for via an interval, so nothing but that direct call can act.
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes the on-disk file for a session past maxAge', async () => {
    const createdAt = Date.now();
    jest.setSystemTime(createdAt);
    await setSession(store, 'expired-sid', sessionWithFreshLastAccess());

    jest.setSystemTime(createdAt + MAX_AGE_MS + 1000); // advance the fake clock past maxAge

    await sweepExpiredSessions(store);

    expect(fs.existsSync(sessionFilePath('expired-sid'))).toBe(false);
  });

  it('control: a session still inside maxAge survives the same sweep', async () => {
    const createdAt = Date.now();
    jest.setSystemTime(createdAt);
    await setSession(store, 'live-sid', sessionWithFreshLastAccess());

    jest.setSystemTime(createdAt + MAX_AGE_MS - 1000); // still inside maxAge

    await sweepExpiredSessions(store);

    expect(fs.existsSync(sessionFilePath('live-sid'))).toBe(true);
  });

  // Two reapers race on the same file in production (our sweep and
  // session-file-store's own, left enabled as a backstop per the build
  // brief). Whichever runs second finds the file already gone. destroy()
  // must tolerate that rather than surface it as a sweep failure -- fs-
  // extra's remove() (which destroy() calls) swallows ENOENT internally,
  // confirmed here directly rather than assumed from reading its source.
  it('destroy() tolerates being called twice on the same id (simulated reaper race)', async () => {
    jest.setSystemTime(Date.now());
    await setSession(store, 'raced-sid', sessionWithFreshLastAccess());

    await destroySession(store, 'raced-sid'); // first delete, e.g. our sweep
    await expect(destroySession(store, 'raced-sid')).resolves.toBeUndefined(); // second delete, e.g. the library's own reaper
  });

  // The SAME race, one step earlier: expired() (session-file-helpers.js)
  // reads the file internally to check it, so it can ENOENT too, not just
  // destroy(). This simulates the library's own reaper (or a concurrent
  // real logout's req.session.destroy()) deleting the file in the exact
  // gap between our sweep's list() and its subsequent expired() call for
  // that same id. Before this fix, that ENOENT rejected the whole
  // sweepExpiredSessions() promise -- one already-won race aborting
  // reporting on the entire sweep batch, not just this one file.
  it('tolerates a file already deleted by the time expired() checks it (reaper race)', async () => {
    jest.setSystemTime(Date.now());
    await setSession(store, 'raced-sid', sessionWithFreshLastAccess());

    const originalExpired = store.expired.bind(store);
    store.expired = (sessionId, cb) => {
      fs.unlinkSync(sessionFilePath(sessionId)); // the race: gone before expired() itself reads it
      originalExpired(sessionId, cb);
    };

    await expect(sweepExpiredSessions(store)).resolves.toBeUndefined();
  });
});
