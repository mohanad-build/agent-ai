'use strict';

// CASA 6.5.1: a login previously left no trace in the logs at all. This
// proves a full password + MFA login now writes one inspectable audit
// line, and, the assertion that actually matters, that nothing else the
// request writes leaks the password, the MFA code, the phone number, or
// the session id.
//
// Also covers session id rotation at every privilege change (post-LOV
// hardening): req.session.regenerate() in the MFA-disabled /login branch,
// the MFA /login branch (ahead of the pendingMfa write), and the /verify
// success branch.

jest.mock('../src/twilio', () => ({
  sendSMSTo: jest.fn(),
}));

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');

const twilioModule = require('../src/twilio');
const dashboardRouter = require('../src/routes/dashboard');

const TEST_PASSWORD = 'correct-horse-battery-staple-test-only';
const TEST_PHONE = '+15551234567';

function buildServer(sessionIds, router = dashboardRouter) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(session({ secret: 'test-secret-not-real', resave: false, saveUninitialized: false, cookie: {} }));
  app.use((req, res, next) => {
    sessionIds.push(req.sessionID);
    next();
  });
  app.use('/dashboard', router);
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
// without needing to verify the signature, matching
// tests/dashboard.sessionTimeout.test.js's helper of the same name.
function sidFromCookie(cookie) {
  const raw = decodeURIComponent(cookie.split('=')[1]);
  const withoutPrefix = raw.slice(2); // strip "s:"
  return withoutPrefix.slice(0, withoutPrefix.lastIndexOf('.'));
}

describe('login audit logging (CASA 6.5.1)', () => {
  let logSpy;
  let errorSpy;
  let warnSpy;
  let sessionIds;
  let tmpDir;
  let savedStorageRoot;

  beforeEach(() => {
    delete process.env.MFA_ENABLED; // must not be 'false' - this test drives the real MFA path
    process.env.DASHBOARD_PASSWORD = TEST_PASSWORD;
    process.env.DASHBOARD_MFA_PHONE = TEST_PHONE;
    twilioModule.sendSMSTo.mockReset();
    twilioModule.sendSMSTo.mockResolvedValue({ sid: 'SM_fake' });
    sessionIds = [];
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // GET /dashboard (used below to prove which cookie authenticates) calls
    // discoverAgentIds() against STORAGE_ROOT. Isolated to an empty tmp dir,
    // same convention as tests/dashboard.sessionTimeout.test.js, so it
    // renders with zero agent cards instead of reading real repo files.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-loginAudit-test-'));
    savedStorageRoot = process.env.STORAGE_ROOT;
    process.env.STORAGE_ROOT = tmpDir;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (savedStorageRoot === undefined) {
      delete process.env.STORAGE_ROOT;
    } else {
      process.env.STORAGE_ROOT = savedStorageRoot;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('emits the success audit line and leaks no credential material anywhere in console output', async () => {
    const server = await startServer(buildServer(sessionIds));
    try {
      const port = server.address().port;

      const loginRes = await fetch(`http://127.0.0.1:${port}/dashboard/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password: TEST_PASSWORD }).toString(),
        redirect: 'manual',
      });
      expect(loginRes.status).toBe(302);
      expect(loginRes.headers.get('location')).toBe('/dashboard/verify');
      const cookie = firstCookie(loginRes);

      expect(twilioModule.sendSMSTo).toHaveBeenCalledTimes(1);
      const [toNumber, smsBody] = twilioModule.sendSMSTo.mock.calls[0];
      expect(toNumber).toBe(TEST_PHONE);
      const mfaCode = smsBody.match(/(\d{6})/)[1];

      const verifyRes = await fetch(`http://127.0.0.1:${port}/dashboard/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
        body: new URLSearchParams({ code: mfaCode }).toString(),
        redirect: 'manual',
      });
      expect(verifyRes.status).toBe(302);
      expect(verifyRes.headers.get('location')).toBe('/dashboard');

      const logLines = logSpy.mock.calls.map((args) => args.join(' '));
      const successLine = logLines.find((line) => line.includes('[auth] login success'));
      expect(successLine).toBeDefined();
      expect(successLine).toContain('principal=operator');

      const allOutput = [...logSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls]
        .map((args) => args.join(' '))
        .join('\n');

      // The assertion that matters: none of the actual secrets leaked.
      expect(allOutput).not.toContain(TEST_PASSWORD);
      expect(allOutput).not.toContain(mfaCode);
      expect(allOutput).not.toContain(TEST_PHONE);
      for (const sid of sessionIds) {
        expect(allOutput).not.toContain(sid);
      }
    } finally {
      await stopServer(server);
    }
  });

  it('session id rotation (MFA path): the verified session id differs from the pending one', async () => {
    const server = await startServer(buildServer(sessionIds));
    try {
      const port = server.address().port;

      const loginRes = await fetch(`http://127.0.0.1:${port}/dashboard/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password: TEST_PASSWORD }).toString(),
        redirect: 'manual',
      });
      expect(loginRes.status).toBe(302);
      const pendingCookie = firstCookie(loginRes);
      const pendingSid = sidFromCookie(pendingCookie);

      const mfaCode = twilioModule.sendSMSTo.mock.calls[0][1].match(/(\d{6})/)[1];

      const verifyRes = await fetch(`http://127.0.0.1:${port}/dashboard/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: pendingCookie },
        body: new URLSearchParams({ code: mfaCode }).toString(),
        redirect: 'manual',
      });
      expect(verifyRes.status).toBe(302);
      const verifiedCookie = firstCookie(verifyRes);
      const verifiedSid = sidFromCookie(verifiedCookie);

      expect(verifiedSid).not.toBe(pendingSid);
    } finally {
      await stopServer(server);
    }
  });

  it('session id rotation (MFA path, load-bearing): the pre-verify cookie no longer authenticates, the post-verify cookie does', async () => {
    const server = await startServer(buildServer(sessionIds));
    try {
      const port = server.address().port;

      const loginRes = await fetch(`http://127.0.0.1:${port}/dashboard/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password: TEST_PASSWORD }).toString(),
        redirect: 'manual',
      });
      const pendingCookie = firstCookie(loginRes);

      const mfaCode = twilioModule.sendSMSTo.mock.calls[0][1].match(/(\d{6})/)[1];

      const verifyRes = await fetch(`http://127.0.0.1:${port}/dashboard/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: pendingCookie },
        body: new URLSearchParams({ code: mfaCode }).toString(),
        redirect: 'manual',
      });
      const verifiedCookie = firstCookie(verifyRes);

      // The PENDING cookie, replayed after a successful verify, must be
      // treated as unauthenticated - its session id was superseded by
      // regenerate() before `authenticated` was ever written to it.
      const staleRes = await fetch(`http://127.0.0.1:${port}/dashboard`, {
        headers: { Cookie: pendingCookie },
        redirect: 'manual',
      });
      expect(staleRes.status).toBe(302);
      expect(staleRes.headers.get('location')).toBe('/dashboard/login');

      // The NEW cookie must be accepted, so this test cannot pass because
      // nothing here actually authenticates.
      const freshRes = await fetch(`http://127.0.0.1:${port}/dashboard`, {
        headers: { Cookie: verifiedCookie },
        redirect: 'manual',
      });
      expect(freshRes.status).toBe(200);
    } finally {
      await stopServer(server);
    }
  });

  it('session id rotation (MFA_ENABLED=false path): the issued session id authenticates directly, no MFA step', async () => {
    process.env.MFA_ENABLED = 'false';
    const server = await startServer(buildServer(sessionIds));
    try {
      const port = server.address().port;

      const loginRes = await fetch(`http://127.0.0.1:${port}/dashboard/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password: TEST_PASSWORD }).toString(),
        redirect: 'manual',
      });
      expect(loginRes.status).toBe(302);
      expect(loginRes.headers.get('location')).toBe('/dashboard');
      expect(twilioModule.sendSMSTo).not.toHaveBeenCalled();
      const cookie = firstCookie(loginRes);
      expect(cookie).not.toBeNull();

      const dashRes = await fetch(`http://127.0.0.1:${port}/dashboard`, {
        headers: { Cookie: cookie },
        redirect: 'manual',
      });
      expect(dashRes.status).toBe(200);
    } finally {
      await stopServer(server);
    }
  });

  it('session id rotation error path: a failed regenerate logs session_regenerate_failed, redirects to error, emits no success line, and does not authenticate', async () => {
    // Spies on Session.prototype.regenerate - the exact API surface
    // src/routes/dashboard.js calls (req.session.regenerate(cb)) - rather
    // than the store's destroy() (which the default Store.prototype.
    // regenerate calls internally). This isolates "regenerate itself
    // fails" from any particular store implementation.
    const regenerateSpy = jest.spyOn(session.Session.prototype, 'regenerate')
      .mockImplementation(function regenerate(cb) {
        cb(new Error('regenerate boom (test-injected)'));
      });

    const server = await startServer(buildServer(sessionIds));
    try {
      const port = server.address().port;

      const loginRes = await fetch(`http://127.0.0.1:${port}/dashboard/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password: TEST_PASSWORD }).toString(),
        redirect: 'manual',
      });
      expect(loginRes.status).toBe(302);
      expect(loginRes.headers.get('location')).toBe('/dashboard/login?error=1');
      expect(twilioModule.sendSMSTo).not.toHaveBeenCalled();

      const logLines = logSpy.mock.calls.map((args) => args.join(' '));
      const failureLine = logLines.find((line) => line.includes('session_regenerate_failed'));
      expect(failureLine).toBeDefined();
      expect(failureLine).toContain('[auth] login failure');
      expect(logLines.some((line) => line.includes('[auth] login success'))).toBe(false);

      // Nothing was ever written to the session on this branch (the early
      // return happens before any `req.session.*` assignment), so
      // whatever cookie (if any) the client holds must not authenticate.
      const cookie = firstCookie(loginRes);
      const dashRes = await fetch(`http://127.0.0.1:${port}/dashboard`, {
        headers: cookie ? { Cookie: cookie } : {},
        redirect: 'manual',
      });
      expect(dashRes.status).toBe(302);
      expect(dashRes.headers.get('location')).toBe('/dashboard/login');
    } finally {
      await stopServer(server);
      regenerateSpy.mockRestore();
    }
  });

  it('session id rotation (MFA path, re-login): a second /login on the pending cookie issues a new session id, and the first pending cookie cannot verify into it', async () => {
    // This scenario needs two /login POSTs on top of what every earlier
    // test in this file has already sent through loginLimiter (max 5 per
    // 15 min, keyed on this test process's single IP) - dashboardRouter is
    // required once at file scope, so that counter is shared and already
    // exhausted by this point. jest.isolateModules gives this test its own
    // fresh module instance (and so its own unshared loginLimiter counter),
    // without touching the limiter's configuration or behavior itself.
    let freshTwilio;
    let freshDashboardRouter;
    jest.isolateModules(() => {
      freshTwilio = require('../src/twilio');
      freshDashboardRouter = require('../src/routes/dashboard');
    });
    freshTwilio.sendSMSTo.mockResolvedValue({ sid: 'SM_fake' });

    const server = await startServer(buildServer(sessionIds, freshDashboardRouter));
    try {
      const port = server.address().port;

      const firstLoginRes = await fetch(`http://127.0.0.1:${port}/dashboard/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password: TEST_PASSWORD }).toString(),
        redirect: 'manual',
      });
      expect(firstLoginRes.status).toBe(302);
      const firstPendingCookie = firstCookie(firstLoginRes);
      const firstPendingSid = sidFromCookie(firstPendingCookie);

      // Second attempt, sending the first attempt's still-pending cookie -
      // e.g. the user re-submits the password form without ever completing
      // MFA on the first attempt.
      const secondLoginRes = await fetch(`http://127.0.0.1:${port}/dashboard/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: firstPendingCookie },
        body: new URLSearchParams({ password: TEST_PASSWORD }).toString(),
        redirect: 'manual',
      });
      expect(secondLoginRes.status).toBe(302);
      const secondPendingCookie = firstCookie(secondLoginRes);
      const secondPendingSid = sidFromCookie(secondPendingCookie);

      expect(secondPendingSid).not.toBe(firstPendingSid);

      // The second attempt's code is readable from the mocked SMS call, so
      // this can replay the FIRST (superseded) pending cookie against
      // /verify using the SECOND attempt's real code, not a guessed one.
      expect(freshTwilio.sendSMSTo).toHaveBeenCalledTimes(2);
      const secondMfaCode = freshTwilio.sendSMSTo.mock.calls[1][1].match(/(\d{6})/)[1];

      const verifyWithStaleCookieRes = await fetch(`http://127.0.0.1:${port}/dashboard/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: firstPendingCookie },
        body: new URLSearchParams({ code: secondMfaCode }).toString(),
        redirect: 'manual',
      });
      expect(verifyWithStaleCookieRes.status).toBe(302);
      expect(verifyWithStaleCookieRes.headers.get('location')).toBe('/dashboard/login');

      // Confirm non-authentication concretely, not just by redirect target:
      // whatever cookie resulted from that /verify call must not open
      // GET /dashboard.
      const resultingCookie = firstCookie(verifyWithStaleCookieRes) || firstPendingCookie;
      const dashRes = await fetch(`http://127.0.0.1:${port}/dashboard`, {
        headers: { Cookie: resultingCookie },
        redirect: 'manual',
      });
      expect(dashRes.status).toBe(302);
      expect(dashRes.headers.get('location')).toBe('/dashboard/login');
    } finally {
      await stopServer(server);
    }
  });
});
