'use strict';

// Decision 4: the welcome text is started without awaiting from the OAuth
// callback, and the done page (a separate request) reads its phone number
// back from the session. Nothing in this repo mocks googleapis yet, so
// this file builds that mock to drive GET /oauth/callback end to end.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const express = require('express');
const session = require('express-session');

const mockGetToken = jest.fn();
const mockSetCredentials = jest.fn();
const mockSheetsCreate = jest.fn();
const mockValuesUpdate = jest.fn();
const mockBatchUpdate = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        getToken: (...args) => mockGetToken(...args),
        setCredentials: (...args) => mockSetCredentials(...args),
        generateAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/mock'),
      })),
    },
    sheets: jest.fn().mockReturnValue({
      spreadsheets: {
        create: (...args) => mockSheetsCreate(...args),
        values: { update: (...args) => mockValuesUpdate(...args) },
        batchUpdate: (...args) => mockBatchUpdate(...args),
      },
    }),
  },
}));

jest.mock('../src/email', () => ({
  sendNewEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/welcomeText', () => ({
  sendWelcomeText: jest.fn(),
}));

const { sendWelcomeText } = require('../src/welcomeText');

const SESSION_SECRET = 'test-secret-not-real';
const AGENT_ID = 'sam-agent';
const AGENT_PHONE = '+14165550188';

let tmpDir;

function writeAgentFixture() {
  fs.writeFileSync(
    path.join(tmpDir, `${AGENT_ID}.json`),
    JSON.stringify({
      agentId: AGENT_ID,
      agentName: 'Sam Agent',
      firstName: 'Sam',
      gmailAddress: 'sam@example.com',
      agentPhone: AGENT_PHONE,
      mode: 'shadow',
      operatorId: 'mo',
    }, null, 2)
  );
}

function freshApp() {
  let router;
  jest.isolateModules(() => {
    router = require('../src/routes/onboard');
  });

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: false, cookie: {} }));

  // Test-only route: seeds req.session.oauthState the way GET /oauth/start
  // would, without driving a real Google consent redirect.
  app.post('/test-seed-oauth-state', (req, res) => {
    req.session.oauthState = { nonce: req.body.nonce, agentId: req.body.agentId };
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

function firstCookie(res) {
  const raw = res.headers.get('set-cookie');
  return raw ? raw.split(';')[0] : null;
}

let server;
let baseUrl;
let _origKey;

beforeAll(() => {
  _origKey = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboard-welcomeText-'));
  process.env.STORAGE_ROOT = tmpDir;
});

afterAll(() => {
  if (_origKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
  else process.env.TOKEN_ENCRYPTION_KEY = _origKey;
  delete process.env.STORAGE_ROOT;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  jest.clearAllMocks();
  writeAgentFixture();
  mockGetToken.mockResolvedValue({ tokens: { refresh_token: 'rt-123' } });
  mockSheetsCreate.mockResolvedValue({
    data: { spreadsheetId: 'sheet-abc', sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }] },
  });
  mockValuesUpdate.mockResolvedValue({});
  mockBatchUpdate.mockResolvedValue({});
  sendWelcomeText.mockResolvedValue(undefined);

  server = await startServer(freshApp());
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach((done) => {
  server.close(done);
});

async function seedOauthState(nonce) {
  const res = await fetch(`${baseUrl}/test-seed-oauth-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ nonce, agentId: AGENT_ID }).toString(),
  });
  const cookie = firstCookie(res);
  await res.text();
  return cookie;
}

test('a never-resolving sendWelcomeText does not block the callback: it still redirects to /onboard/done', async () => {
  sendWelcomeText.mockReturnValue(new Promise(() => {})); // never settles
  const cookie = await seedOauthState('nonce-1');

  const res = await fetch(`${baseUrl}/onboard/oauth/callback?code=auth-code&state=nonce-1`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  await res.text();

  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe('/onboard/done');
  expect(sendWelcomeText).toHaveBeenCalledTimes(1);
  expect(sendWelcomeText.mock.calls[0][0].agentPhone).toBe(AGENT_PHONE);
}, 2000);

test('the session carries welcomeTextPhone after a successful callback', async () => {
  const cookie = await seedOauthState('nonce-2');

  const callbackRes = await fetch(`${baseUrl}/onboard/oauth/callback?code=auth-code&state=nonce-2`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  await callbackRes.text();

  const doneRes = await fetch(`${baseUrl}/onboard/done`, { headers: { Cookie: cookie } });
  const body = await doneRes.text();

  expect(body).toContain(
    "We're sending a welcome text to 416-555-0188. If it hasn't arrived in a minute, let Mo know."
  );
});

test('a repeated callback hit with the same (now-consumed) state does not call sendWelcomeText again', async () => {
  const cookie = await seedOauthState('nonce-3');

  const firstRes = await fetch(`${baseUrl}/onboard/oauth/callback?code=auth-code&state=nonce-3`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  await firstRes.text();
  expect(sendWelcomeText).toHaveBeenCalledTimes(1);

  const secondRes = await fetch(`${baseUrl}/onboard/oauth/callback?code=auth-code&state=nonce-3`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  await secondRes.text();

  expect(secondRes.status).toBe(400);
  expect(sendWelcomeText).toHaveBeenCalledTimes(1);
});
