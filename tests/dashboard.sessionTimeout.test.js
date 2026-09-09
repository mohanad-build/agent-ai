'use strict';

// CASA 2.2.1: idle and absolute session timeouts, enforced independently
// in requireAuth. These tests exercise the real requireAuth against a real
// express-session + the store src/sessionStore.js actually creates
// (session-file-store, see that file), so "the store no longer holds it"
// is a real assertion, not a stand-in for one.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const cookieSignature = require('cookie-signature');

const { createSessionStore } = require('../src/sessionStore');
const {
  requireAuth,
  SESSION_ABSOLUTE_TIMEOUT_MS,
  SESSION_IDLE_TIMEOUT_MS,
} = require('../src/routes/dashboard');

const SESSION_SECRET = 'test-secret-not-real';

// Deliberately far larger than SESSION_ABSOLUTE_TIMEOUT_MS. If the cookie's
// own maxAge were close to it, the store's own built-in lazy expiry (every
// store here has one - see src/sessionStore.js's comments on both
// MemoryStore's and session-file-store's versions) would prune the record
// on its own during these tests, and a denial could no longer be
// attributed cleanly to requireAuth's own idle/absolute checks instead of
// to that unrelated mechanism.
const COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 365;

// A test-only login endpoint. It sets exactly what the real login routes
// set (see dashboard.js), with the option to omit a timestamp, so each
// scenario below can be constructed precisely without going through the
// real password/MFA flow.
function buildApp(store) {
  const app = express();
  app.use(session({
    secret: SESSION_SECRET,
    store,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: COOKIE_MAX_AGE_MS },
  }));

  app.post('/test-login', (req, res) => {
    req.session.authenticated = true;
    req.session.principal = { type: 'operator', allowedAgents: '*' };
    const omit = new Set((req.query.omit || '').split(',').filter(Boolean));
    if (!omit.has('authenticatedAt')) req.session.authenticatedAt = Date.now();
    if (!omit.has('lastSeenAt')) req.session.lastSeenAt = Date.now();
    res.status(200).send('logged-in');
  });

  app.get('/protected', requireAuth, (req, res) => res.status(200).send('ok'));

  return app;
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function firstCookie(res) {
  const raw = res.headers.get('set-cookie');
  return raw ? raw.split(';')[0] : null;
}

// Recovers the raw session id from a `connect.sid=s%3A<sid>.<hmac>` cookie
// without needing to verify the signature - we have direct store access
// ourselves, we just need the same key the store is keyed on.
function sidFromCookie(cookie) {
  const raw = decodeURIComponent(cookie.split('=')[1]);
  const withoutPrefix = raw.slice(2); // strip "s:"
  return withoutPrefix.slice(0, withoutPrefix.lastIndexOf('.'));
}

function patchStoredSession(store, sid, patch) {
  return new Promise((resolve, reject) => {
    store.get(sid, (err, sess) => {
      if (err) return reject(err);
      Object.assign(sess, patch);
      store.set(sid, sess, (err2) => (err2 ? reject(err2) : resolve()));
    });
  });
}

// Deliberately goes through store.get() rather than reaching into
// MemoryStore's private `sessions` object. That property is not part of
// the express-session Store interface - a file-backed store has no such
// object at all. This helper asserts the actual contract: whether the
// session can still be retrieved. ENOENT from a file-backed store and a
// null session from an in-memory store are the same answer to the same
// question, which is why express-session's own middleware (index.js,
// store.get callback) special-cases ENOENT identically to a missing
// session. Correct against any conforming store, not just this one.
function sessionIsGone(store, sid) {
  return new Promise((resolve) => {
    store.get(sid, (err, sess) => resolve((err && err.code === 'ENOENT') || !sess));
  });
}

describe('session idle and absolute timeouts (CASA 2.2.1)', () => {
  let store;
  let server;
  let port;
  let tmpDir;
  let savedStorageRoot;
  let savedSessionSecret;

  beforeEach(async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
    });

    // Per-file save/restore, matching tests/agentDiscovery.test.js's
    // STORAGE_ROOT convention - not a global default in test setup, which
    // would make the missing-SESSION_SECRET failure path (below) untestable
    // everywhere at once. createSessionStore() now writes real files
    // (fs.mkdirSync/fs.chmodSync, then session-file-store's own writes) and
    // derives its encryption key from process.env.SESSION_SECRET, neither
    // of which MemoryStore ever touched - both need isolating here or this
    // suite litters the real STORAGE_ROOT with test session files.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-sessionTimeout-test-'));
    savedStorageRoot = process.env.STORAGE_ROOT;
    savedSessionSecret = process.env.SESSION_SECRET;
    process.env.STORAGE_ROOT = tmpDir;
    process.env.SESSION_SECRET = SESSION_SECRET;

    store = createSessionStore();
    server = await startServer(buildApp(store));
    port = server.address().port;
  });

  afterEach(async () => {
    await stopServer(server);
    jest.useRealTimers();

    if (savedStorageRoot === undefined) {
      delete process.env.STORAGE_ROOT;
    } else {
      process.env.STORAGE_ROOT = savedStorageRoot;
    }
    if (savedSessionSecret === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = savedSessionSecret;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Draining the body matters: express-session's res.end patch
  // (node_modules/express-session/index.js) writes all but the response's
  // last byte immediately, and withholds that final byte - along with
  // ending the connection - until req.session.save()'s callback (i.e. the
  // store's own set()/destroy()) actually completes. fetch() resolves once
  // headers arrive, before that final byte, so a caller that only reads
  // headers (as this did before) can race ahead of its own request's
  // session write landing. That race was invisible against MemoryStore
  // (an in-memory set() completes in well under a millisecond) but is real
  // against session-file-store, where set() does synchronous scrypt key
  // derivation plus a real disk write - tens of milliseconds, long enough
  // for the very next request in these tests to fire first. Confirmed by
  // instrumenting store.set/get directly, not assumed: without draining,
  // the second of two back-to-back requests could observe an ENOENT read
  // on a session whose write simply hadn't landed yet. A real client (a
  // browser navigating between pages) always consumes the full response;
  // this test now does too, matching what express-session was already
  // designed to be waited on for.
  async function login() {
    const res = await fetch(`http://127.0.0.1:${port}/test-login`, { method: 'POST' });
    const cookie = firstCookie(res);
    await res.text();
    return { cookie, sid: sidFromCookie(cookie) };
  }

  it('(a) denies and destroys a session idle past the idle limit', async () => {
    const t0 = Date.now();
    const { cookie, sid } = await login();

    jest.setSystemTime(t0 + SESSION_IDLE_TIMEOUT_MS + 1000); // idle limit elapsed, no activity in between

    const res = await fetch(`http://127.0.0.1:${port}/protected`, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/dashboard/login');
    await res.text(); // see login()'s comment: waits for the destroy() this response is withholding its last byte for
    expect(await sessionIsGone(store, sid)).toBe(true);
  });

  it('(b) denies a session active within the idle limit but past the absolute limit', async () => {
    const t0 = Date.now();
    const { cookie, sid } = await login();

    const checkTime = t0 + SESSION_ABSOLUTE_TIMEOUT_MS + 1000; // absolute limit elapsed

    // Directly construct "idle clock says fine" without a real request,
    // since any real request this close to checkTime would itself already
    // be past the absolute limit and denied - that is exactly what this
    // test proves, so it cannot be produced by a legitimate request.
    await patchStoredSession(store, sid, { lastSeenAt: checkTime - 5 * 60 * 1000 });

    jest.setSystemTime(checkTime);

    const res = await fetch(`http://127.0.0.1:${port}/protected`, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/dashboard/login');
  });

  it('(c) a session refreshed by activity survives past the idle limit measured from login', async () => {
    const t0 = Date.now();
    const { cookie } = await login();

    // Activity at +20 minutes, well inside the 30 minute idle limit -
    // this both succeeds and pushes lastSeenAt forward to this instant.
    jest.setSystemTime(t0 + 20 * 60 * 1000);
    const midRes = await fetch(`http://127.0.0.1:${port}/protected`, { headers: { Cookie: cookie } });
    expect(midRes.status).toBe(200);
    await midRes.text(); // see login()'s comment: waits for THIS request's lastSeenAt update to land before the next one reads it

    // +45 minutes from login (65 min total would be past a 30 min window
    // measured from login), but only 25 minutes since the activity above -
    // inside the idle limit measured from lastSeenAt. Proves the idle
    // clock actually moves on activity rather than being fixed at login.
    jest.setSystemTime(t0 + 45 * 60 * 1000);
    const laterRes = await fetch(`http://127.0.0.1:${port}/protected`, { headers: { Cookie: cookie } });
    expect(laterRes.status).toBe(200);
    expect(await laterRes.text()).toBe('ok');
  });

  it('(d) denies a session missing authenticatedAt or lastSeenAt', async () => {
    const missingAuthenticatedAt = await (async () => {
      const res = await fetch(`http://127.0.0.1:${port}/test-login?omit=authenticatedAt`, { method: 'POST' });
      const cookie = firstCookie(res);
      await res.text(); // see login()'s comment
      return cookie;
    })();
    const resA = await fetch(`http://127.0.0.1:${port}/protected`, {
      headers: { Cookie: missingAuthenticatedAt },
      redirect: 'manual',
    });
    expect(resA.status).toBe(302);
    expect(resA.headers.get('location')).toBe('/dashboard/login');

    const missingLastSeenAt = await (async () => {
      const res = await fetch(`http://127.0.0.1:${port}/test-login?omit=lastSeenAt`, { method: 'POST' });
      const cookie = firstCookie(res);
      await res.text(); // see login()'s comment
      return cookie;
    })();
    const resB = await fetch(`http://127.0.0.1:${port}/protected`, {
      headers: { Cookie: missingLastSeenAt },
      redirect: 'manual',
    });
    expect(resB.status).toBe(302);
    expect(resB.headers.get('location')).toBe('/dashboard/login');
  });
});
