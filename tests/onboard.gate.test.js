'use strict';

// 7.25.1: the onboarding passcode gate. GET /onboard/, POST /onboard/, and
// GET /onboard/oauth/start now require req.session.onboardAccess === true,
// granted only by POST /onboard/access with the right ONBOARD_PASSCODE.
// /onboard/oauth/callback and /onboard/done stay ungated (see the comment
// above requireOnboardAccess in src/routes/onboard.js for why).

const http = require('http');
const express = require('express');
const session = require('express-session');

const SESSION_SECRET = 'test-secret-not-real';

function firstCookie(res) {
  const raw = res.headers.get('set-cookie');
  return raw ? raw.split(';')[0] : null;
}

// A fresh require of onboard.js per test, via jest.isolateModules, so the
// module-scoped onboardAccessLimiter's request count (keyed by IP - every
// request in this file comes from 127.0.0.1) never carries over between
// tests. Without this, the rate-limit test (8) would be at the mercy of
// however many POSTs earlier tests in this file happened to make.
function freshApp() {
  let router;
  jest.isolateModules(() => {
    router = require('../src/routes/onboard');
  });

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: false, cookie: {} }));

  // Test-only route: establishes a real pre-existing session/cookie without
  // going through the real gate, so "the cookie the browser had before"
  // (tests 2 and 4) is an actual session, not just an absent one.
  app.post('/test-seed-session', (req, res) => {
    req.session.seeded = true;
    res.status(200).send('seeded');
  });

  app.use('/onboard', router);
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

async function seedSession(baseUrl) {
  const res = await fetch(`${baseUrl}/test-seed-session`, { method: 'POST' });
  const cookie = firstCookie(res);
  await res.text();
  return cookie;
}

async function submitPasscode(baseUrl, passcode, cookie) {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${baseUrl}/onboard/access`, {
    method: 'POST',
    headers,
    body: new URLSearchParams(passcode === undefined ? {} : { passcode }).toString(),
    redirect: 'manual',
  });
  await res.text();
  return res;
}

describe('onboarding passcode gate (7.25.1)', () => {
  let server;
  let baseUrl;
  let savedPasscode;

  beforeEach(async () => {
    savedPasscode = process.env.ONBOARD_PASSCODE;
    server = await startServer(freshApp());
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    await stopServer(server);
    if (savedPasscode === undefined) {
      delete process.env.ONBOARD_PASSCODE;
    } else {
      process.env.ONBOARD_PASSCODE = savedPasscode;
    }
  });

  // (1) Before this commit, none of these three routes had any gate at all:
  // GET /onboard/ and GET /onboard/oauth/start returned their normal
  // response directly, and POST /onboard/ proceeded straight to writing an
  // agent file, instead of any of them 302-ing to /onboard/access.
  test('(1) no access: GET /, POST /, and GET /oauth/start all redirect to /onboard/access', async () => {
    const getRes = await fetch(`${baseUrl}/onboard/`, { redirect: 'manual' });
    await getRes.text();
    expect(getRes.status).toBe(302);
    expect(getRes.headers.get('location')).toBe('/onboard/access');

    const postRes = await fetch(`${baseUrl}/onboard/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ firstName: 'A', lastName: 'B', agentPhone: '+15551234567' }).toString(),
      redirect: 'manual',
    });
    await postRes.text();
    expect(postRes.status).toBe(302);
    expect(postRes.headers.get('location')).toBe('/onboard/access');

    const startRes = await fetch(`${baseUrl}/onboard/oauth/start?agentId=whatever`, { redirect: 'manual' });
    await startRes.text();
    expect(startRes.status).toBe(302);
    expect(startRes.headers.get('location')).toBe('/onboard/access');
  });

  // (2) Would fail against old code two ways: POST /onboard/access did not
  // exist at all (404, not a redirect to ?error=1), and there was no
  // req.session.onboardAccess check on GET /onboard/ for a subsequent
  // request to fail against - it would have returned 200 either way.
  test('(2) wrong passcode: redirects to ?error=1, and access is still denied afterward', async () => {
    process.env.ONBOARD_PASSCODE = 'right-passcode';
    const cookie = await seedSession(baseUrl);

    const res = await submitPasscode(baseUrl, 'wrong-passcode', cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/onboard/access?error=1');

    const followUp = await fetch(`${baseUrl}/onboard/`, { headers: { Cookie: cookie }, redirect: 'manual' });
    await followUp.text();
    expect(followUp.status).toBe(302);
    expect(followUp.headers.get('location')).toBe('/onboard/access');
  });

  // (3) Would fail against old code: POST /onboard/access did not exist
  // (404 instead of a 302 to /onboard/), so there would be no "new cookie"
  // to follow up with in the first place.
  test('(3) right passcode: redirects to /onboard, and the new cookie opens the form', async () => {
    process.env.ONBOARD_PASSCODE = 'right-passcode';

    const res = await submitPasscode(baseUrl, 'right-passcode');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/onboard');
    const cookie = firstCookie(res);
    expect(cookie).toBeTruthy();

    const followUp = await fetch(`${baseUrl}/onboard/`, { headers: { Cookie: cookie } });
    const body = await followUp.text();
    expect(followUp.status).toBe(200);
    expect(body).toContain('Connect your inbox');
  });

  // (4) Would fail under mutation (m3): skipping req.session.regenerate and
  // setting onboardAccess on the existing session would leave the
  // pre-existing session id unchanged across the grant.
  test('(4) session rotation: the granted cookie differs from the pre-existing one', async () => {
    process.env.ONBOARD_PASSCODE = 'right-passcode';
    const preExistingCookie = await seedSession(baseUrl);

    const res = await submitPasscode(baseUrl, 'right-passcode', preExistingCookie);
    expect(res.status).toBe(302);
    const grantedCookie = firstCookie(res);

    expect(grantedCookie).toBeTruthy();
    expect(grantedCookie).not.toBe(preExistingCookie);
  });

  // (5) Would fail if the not_configured check (mutation m2 removes exactly
  // this) were absent. The plain submissions alone would not catch that
  // removal, since the surviving "!submitted" guard already blocks an
  // empty body on its own - so this also submits two adversarial values
  // that only the not_configured check stops: safeCompare(a, b) hashes
  // String(a) and String(b), so with ONBOARD_PASSCODE unset (undefined),
  // submitting the literal string "undefined" would satisfy a bare
  // safeCompare; with it set to "   ", submitting "   " back would too.
  test('(5) fail closed: unset or whitespace-only ONBOARD_PASSCODE grants nothing', async () => {
    delete process.env.ONBOARD_PASSCODE;
    const unsetRes = await submitPasscode(baseUrl, 'anything');
    expect(unsetRes.status).toBe(302);
    expect(unsetRes.headers.get('location')).toBe('/onboard/access?error=1');

    const undefinedStringRes = await submitPasscode(baseUrl, 'undefined');
    expect(undefinedStringRes.status).toBe(302);
    expect(undefinedStringRes.headers.get('location')).toBe('/onboard/access?error=1');

    process.env.ONBOARD_PASSCODE = '   ';
    const emptyRes = await submitPasscode(baseUrl, '');
    expect(emptyRes.status).toBe(302);
    expect(emptyRes.headers.get('location')).toBe('/onboard/access?error=1');

    const matchingWhitespaceRes = await submitPasscode(baseUrl, '   ');
    expect(matchingWhitespaceRes.status).toBe(302);
    expect(matchingWhitespaceRes.headers.get('location')).toBe('/onboard/access?error=1');
  });

  // (6) Would fail against a naive `submitted === process.env.ONBOARD_PASSCODE`
  // comparison without the not_configured fail-closed check first: '' === ''
  // is true, which would grant access on a blank passcode nobody set on
  // purpose.
  test('(6) the empty-string trap: ONBOARD_PASSCODE="" and passcode="" grants nothing', async () => {
    process.env.ONBOARD_PASSCODE = '';
    const res = await submitPasscode(baseUrl, '');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/onboard/access?error=1');
  });

  // (7) Would fail if requireOnboardAccess were (wrongly) applied to these
  // two routes as well: /oauth/callback would 302 to /onboard/access
  // instead of reaching its own code/state validation (400 here, since
  // neither is present), and /onboard/done would 302 instead of rendering
  // its existing no-session-data page (200, per 7342384).
  test('(7) callback and done stay ungated', async () => {
    const callbackRes = await fetch(`${baseUrl}/onboard/oauth/callback`, { redirect: 'manual' });
    await callbackRes.text();
    expect(callbackRes.status).not.toBe(302);

    const doneRes = await fetch(`${baseUrl}/onboard/done`, { redirect: 'manual' });
    await doneRes.text();
    expect(doneRes.status).toBe(200);
  });

  // (8) Would fail if onboardAccessLimiter were never wired to POST
  // /onboard/access: a 6th submission within the window would get the same
  // 302 every earlier one got, instead of a 429.
  test('(8) rate limit: the 6th POST /onboard/access within the window is rejected', async () => {
    process.env.ONBOARD_PASSCODE = 'right-passcode';
    for (let i = 0; i < 5; i++) {
      const res = await submitPasscode(baseUrl, 'wrong-passcode');
      expect(res.status).toBe(302);
    }
    const sixth = await submitPasscode(baseUrl, 'wrong-passcode');
    expect(sixth.status).toBe(429);
  });

  // (9) Would fail if the bad-passcode log line interpolated the submitted
  // value or the real passcode into the message, instead of the fixed
  // "reason=bad_passcode" string.
  test('(9) the bad-passcode log line contains neither the submitted value nor the real passcode', async () => {
    process.env.ONBOARD_PASSCODE = 'super-secret-real-passcode';
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await submitPasscode(baseUrl, 'guessed-wrong-value');
      const logLines = logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(logLines).toContain('[onboard-gate] failure reason=bad_passcode');
      expect(logLines).not.toContain('guessed-wrong-value');
      expect(logLines).not.toContain('super-secret-real-passcode');
    } finally {
      logSpy.mockRestore();
    }
  });
});
