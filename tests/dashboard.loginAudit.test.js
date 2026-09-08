'use strict';

// CASA 6.5.1: a login previously left no trace in the logs at all. This
// proves a full password + MFA login now writes one inspectable audit
// line, and, the assertion that actually matters, that nothing else the
// request writes leaks the password, the MFA code, the phone number, or
// the session id.

jest.mock('../src/twilio', () => ({
  sendSMSTo: jest.fn(),
}));

const http = require('http');
const express = require('express');
const session = require('express-session');

const twilioModule = require('../src/twilio');
const dashboardRouter = require('../src/routes/dashboard');

const TEST_PASSWORD = 'correct-horse-battery-staple-test-only';
const TEST_PHONE = '+15551234567';

function buildServer(sessionIds) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(session({ secret: 'test-secret-not-real', resave: false, saveUninitialized: false, cookie: {} }));
  app.use((req, res, next) => {
    sessionIds.push(req.sessionID);
    next();
  });
  app.use('/dashboard', dashboardRouter);
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

describe('login audit logging (CASA 6.5.1)', () => {
  let logSpy;
  let errorSpy;
  let warnSpy;
  let sessionIds;

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
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
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
});
