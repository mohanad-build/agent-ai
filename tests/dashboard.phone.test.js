'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const http = require('http');

const express = require('express');

jest.mock('../src/welcomeText', () => ({
  sendWelcomeText: jest.fn().mockResolvedValue(undefined),
}));
const { sendWelcomeText } = require('../src/welcomeText');

let tmpDir;
let server;
let baseUrl;
let agentFilePath;

// A stateless session, same convention as
// tests/dashboard.requireAgentAccess.test.js: req.session is rebuilt from a
// header on every request rather than going through express-session, so the
// csrfToken here must already match what the POST body submits as _csrf.
const SESSION = JSON.stringify({
  authenticated: true,
  authenticatedAt: Date.now(),
  lastSeenAt: Date.now(),
  principal: { type: 'operator', allowedAgents: '*' },
  csrfToken: 'test-csrf-token',
});

beforeAll((done) => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-phone-'));
  process.env.STORAGE_ROOT = tmpDir;

  const dashboardRouter = require('../src/routes/dashboard');

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = JSON.parse(req.headers['x-test-session'] || 'null') || {};
    next();
  });
  app.use('/dashboard', dashboardRouter);

  server = http.createServer(app);
  server.listen(0, () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterAll((done) => {
  server.close(() => {
    delete process.env.STORAGE_ROOT;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    done();
  });
});

function writeAgentFixture() {
  agentFilePath = path.join(tmpDir, 'agent-a.json');
  fs.writeFileSync(agentFilePath, JSON.stringify({
    agentId: 'agent-a',
    mode: 'shadow',
    isActive: true,
    agentPhone: '+14165550100',
    escalationEmail: 'agent@example.com',
    googleRefreshToken: '',
    googleSheetId: '',
  }, null, 2));
}

test('refuses a bad phone (invalid area code) and writes nothing', async () => {
  writeAgentFixture();
  const before = fs.readFileSync(agentFilePath, 'utf8');

  const res = await fetch(`${baseUrl}/dashboard/agent/agent-a/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-test-session': SESSION },
    body: new URLSearchParams({
      _csrf: 'test-csrf-token',
      mode: 'shadow',
      isActive: 'true',
      agentPhone: '0165550123',
      escalationEmail: 'agent@example.com',
    }).toString(),
    redirect: 'manual',
  });
  const body = await res.text();

  expect(res.status).toBe(400);
  expect(body).toBe(
    "That number doesn't look right. Enter your 10-digit mobile number, like 416-555-0123."
  );
  expect(fs.readFileSync(agentFilePath, 'utf8')).toBe(before);
});

test('accepts a valid phone and normalizes it', async () => {
  writeAgentFixture();

  const res = await fetch(`${baseUrl}/dashboard/agent/agent-a/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-test-session': SESSION },
    body: new URLSearchParams({
      _csrf: 'test-csrf-token',
      mode: 'shadow',
      isActive: 'true',
      agentPhone: '416-555-0177',
      escalationEmail: 'agent@example.com',
    }).toString(),
    redirect: 'manual',
  });
  await res.text();

  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe('/dashboard/agent/agent-a/edit?saved=1');

  const config = JSON.parse(fs.readFileSync(agentFilePath, 'utf8'));
  expect(config.agentPhone).toBe('+14165550177');
});

test('submitting the same number in a different format does not start a welcome text', async () => {
  writeAgentFixture(); // agentPhone: '+14165550100'
  sendWelcomeText.mockClear();

  const res = await fetch(`${baseUrl}/dashboard/agent/agent-a/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-test-session': SESSION },
    body: new URLSearchParams({
      _csrf: 'test-csrf-token',
      mode: 'shadow',
      isActive: 'true',
      agentPhone: '416-555-0100', // normalizes to the same +14165550100
      escalationEmail: 'agent@example.com',
    }).toString(),
    redirect: 'manual',
  });
  await res.text();

  expect(res.status).toBe(302);
  expect(sendWelcomeText).not.toHaveBeenCalled();
});

test('a changed number starts a welcome text; a never-resolving send does not block the redirect', async () => {
  writeAgentFixture(); // agentPhone: '+14165550100'
  sendWelcomeText.mockClear();
  sendWelcomeText.mockReturnValue(new Promise(() => {})); // never settles

  const res = await fetch(`${baseUrl}/dashboard/agent/agent-a/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-test-session': SESSION },
    body: new URLSearchParams({
      _csrf: 'test-csrf-token',
      mode: 'shadow',
      isActive: 'true',
      agentPhone: '416-555-0199',
      escalationEmail: 'agent@example.com',
    }).toString(),
    redirect: 'manual',
  });
  await res.text();

  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe('/dashboard/agent/agent-a/edit?saved=1');
  expect(sendWelcomeText).toHaveBeenCalledTimes(1);
  expect(sendWelcomeText.mock.calls[0][0].agentPhone).toBe('+14165550199');

  sendWelcomeText.mockResolvedValue(undefined); // restore for later tests
}, 2000);
