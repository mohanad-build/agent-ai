'use strict';

// CASA 2.2.1: idle and absolute session timeouts, enforced independently
// in requireAuth. These tests exercise the real requireAuth against a real
// express-session + MemoryStore, so "the store no longer holds it" is a
// real assertion, not a stand-in for one.

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
// own maxAge were close to it, MemoryStore's built-in lazy expiry (CASA
// 2.2.1's earlier commit) would prune the record on its own during these
// tests, and a denial could no longer be attributed cleanly to requireAuth's
// own idle/absolute checks instead of to that unrelated mechanism.
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

describe('session idle and absolute timeouts (CASA 2.2.1)', () => {
  let store;
  let server;
  let port;

  beforeEach(async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
    });
    store = createSessionStore();
    server = await startServer(buildApp(store));
    port = server.address().port;
  });

  afterEach(async () => {
    await stopServer(server);
    jest.useRealTimers();
  });

  async function login() {
    const res = await fetch(`http://127.0.0.1:${port}/test-login`, { method: 'POST' });
    const cookie = firstCookie(res);
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
    expect(store.sessions[sid]).toBeUndefined();
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
      return firstCookie(res);
    })();
    const resA = await fetch(`http://127.0.0.1:${port}/protected`, {
      headers: { Cookie: missingAuthenticatedAt },
      redirect: 'manual',
    });
    expect(resA.status).toBe(302);
    expect(resA.headers.get('location')).toBe('/dashboard/login');

    const missingLastSeenAt = await (async () => {
      const res = await fetch(`http://127.0.0.1:${port}/test-login?omit=lastSeenAt`, { method: 'POST' });
      return firstCookie(res);
    })();
    const resB = await fetch(`http://127.0.0.1:${port}/protected`, {
      headers: { Cookie: missingLastSeenAt },
      redirect: 'manual',
    });
    expect(resB.status).toBe(302);
    expect(resB.headers.get('location')).toBe('/dashboard/login');
  });
});
