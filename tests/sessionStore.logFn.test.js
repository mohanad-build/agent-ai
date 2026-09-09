'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const cookieSignature = require('cookie-signature');

const SESSION_SECRET = 'test-session-secret-not-real-but-long-enough';

let tmpDir;
let savedStorageRoot;
let savedSessionSecret;
let server;
let port;
let consoleErrorSpy;
let consoleLogSpy;

function buildApp(express, session, theStore, requireAuth) {
  const app = express();
  app.use(session({
    secret: SESSION_SECRET,
    store: theStore,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 12 },
  }));
  app.get('/protected', requireAuth, (req, res) => res.status(200).send('ok'));
  return app;
}

function startServer(app) {
  return new Promise((resolve) => {
    const s = http.createServer(app);
    s.listen(0, () => resolve(s));
  });
}

function stopServer(s) {
  return new Promise((resolve) => s.close(resolve));
}

// A cookie shaped exactly like a real express-session cookie
// (connect.sid=s%3A<sid>.<hmac>), signed with the same secret the app
// verifies against, but for a sid that was never written anywhere. Stands
// in for the production symptom this test guards: an expired, already-
// swept, or forged session id. It has to be validly signed - an
// unsigned/mis-signed cookie is rejected before express-session ever
// calls store.get(), which would prove nothing about the ENOENT path.
function cookieForNonexistentSid(sid) {
  const signed = 's:' + cookieSignature.sign(sid, SESSION_SECRET);
  return `connect.sid=${encodeURIComponent(signed)}`;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionStore-logFn-test-'));
  savedStorageRoot = process.env.STORAGE_ROOT;
  savedSessionSecret = process.env.SESSION_SECRET;
  process.env.STORAGE_ROOT = tmpDir;
  process.env.SESSION_SECRET = SESSION_SECRET;

  // Spies installed BEFORE anything below is required, deliberately.
  // session-file-store's own DEFAULTS (session-file-helpers.js) capture
  // `logFn: console.log` ONCE, at module-evaluation time - not per call.
  // If this file's top-level had already `require`d session-file-store
  // (transitively, via ../src/sessionStore) before these spies exist, that
  // DEFAULT would be bound to the ORIGINAL console.log forever, and no
  // spy installed afterward could ever observe calls that fall through to
  // it - which is exactly the case this test needs to observe (an
  // omitted logFn falls back to that default). jest.resetModules() plus a
  // require() here, after the spies exist, forces session-file-helpers.js
  // to be re-evaluated and its DEFAULTS.logFn to capture the CURRENTLY
  // spied console.log instead. Without this, the break-the-fix scenario
  // below silently passes for the wrong reason - confirmed by hitting
  // exactly that false pass while writing this test, not assumed.
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.resetModules();
});

afterEach(async () => {
  await stopServer(server);
  consoleErrorSpy.mockRestore();
  consoleLogSpy.mockRestore();

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

// CASA 2.2.1: a missing session file is the expected outcome of an expired
// cookie, an already-swept session, or a forged session id - not a
// failure. Checks both halves: the request itself still resolves exactly
// as it should (fail closed, redirected to login - the ENOENT path was
// never a functional problem), AND that resolving it doesn't cost an
// error-level log line, which is the actual regression this guards
// against (see src/sessionStore.js's sessionStoreLogFn).
describe('session-file-store logFn: missing session file is not an error (CASA 2.2.1)', () => {
  it('a cookie for a nonexistent session id succeeds (fresh session, redirected to login) and logs no ENOENT', async () => {
    const express = require('express');
    const session = require('express-session');
    const { createSessionStore } = require('../src/sessionStore');
    const { requireAuth } = require('../src/routes/dashboard');

    const store = createSessionStore();
    server = await startServer(buildApp(express, session, store, requireAuth));
    port = server.address().port;

    const cookie = cookieForNonexistentSid('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');

    const res = await fetch(`http://127.0.0.1:${port}/protected`, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    });
    await res.text();

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/dashboard/login');

    const logged = [...consoleErrorSpy.mock.calls, ...consoleLogSpy.mock.calls]
      .map((args) => args.join(' '))
      .join('\n');
    expect(logged).not.toMatch(/ENOENT/);
  });
});
