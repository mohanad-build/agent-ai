'use strict';

// 7.25.1: GET /onboard/done (src/routes/onboard.js:494-517) used to read the
// agent id straight from req.query.agentId, so anyone who guessed an agentId
// could see that agent's gmailAddress and Google Sheet link. It now reads
// only req.session.onboardedAgentId, set by the OAuth callback success path
// on this same browser's session, never from the URL.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const express = require('express');
const session = require('express-session');
const router = require('../src/routes/onboard');

const SESSION_SECRET = 'test-secret-not-real';

const FIXTURE_A = {
  agentId: 'fixture-alpha',
  agentName: 'Alpha One',
  gmailAddress: 'alpha@fixturemail.test',
  googleSheetId: 'sheet-alpha-123',
};

const FIXTURE_B = {
  agentId: 'fixture-beta',
  agentName: 'Beta Two',
  gmailAddress: 'beta@fixturemail.test',
  googleSheetId: 'sheet-beta-456',
};

let tmpDir;
let server;
let baseUrl;

function writeFixture(fixture) {
  fs.writeFileSync(
    path.join(tmpDir, `${fixture.agentId}.json`),
    JSON.stringify(fixture, null, 2) + '\n'
  );
}

function buildApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
  }));

  // Test-only session seeding route, mounted ahead of the real router.
  // Stands in for the callback success path's req.session.onboardedAgentId
  // assignment (src/routes/onboard.js) without adding a test hook to
  // production code.
  app.post('/test-seed-session', (req, res) => {
    req.session.onboardedAgentId = req.body.onboardedAgentId;
    res.status(200).send('seeded');
  });

  app.use('/onboard', router);
  return app;
}

function firstCookie(res) {
  const raw = res.headers.get('set-cookie');
  return raw ? raw.split(';')[0] : null;
}

async function seedSession(onboardedAgentId) {
  const res = await fetch(`${baseUrl}/test-seed-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ onboardedAgentId }).toString(),
  });
  const cookie = firstCookie(res);
  await res.text();
  return cookie;
}

beforeAll((done) => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboard-done-session-'));
  process.env.STORAGE_ROOT = tmpDir;
  writeFixture(FIXTURE_A);
  writeFixture(FIXTURE_B);

  server = http.createServer(buildApp());
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

// Would fail against the old query-param code: it read req.query.agentId
// directly, so this exact URL would have rendered fixture-alpha's address
// and Sheet link with no session at all.
test('(a) no session: guessing agentId in the query leaks nothing', async () => {
  const res = await fetch(`${baseUrl}/onboard/done?agentId=${FIXTURE_A.agentId}`);
  const body = await res.text();
  expect(res.status).toBe(200);
  expect(body).not.toContain(FIXTURE_A.gmailAddress);
  expect(body).not.toContain(FIXTURE_A.googleSheetId);
});

// Would fail against the old query-param code: with no agentId in the query,
// the old handler's `if (agentId && isValidAgentId(agentId))` guard never
// fires, so it would render the generic page instead of fixture-alpha's details.
test('(b) session seeded for fixture-alpha: shows its address and first name', async () => {
  const cookie = await seedSession(FIXTURE_A.agentId);
  const res = await fetch(`${baseUrl}/onboard/done`, { headers: { Cookie: cookie } });
  const body = await res.text();
  expect(res.status).toBe(200);
  expect(body).toContain(FIXTURE_A.gmailAddress);
  expect(body).toContain('Alpha');
});

// Would fail against the old query-param code: it trusted req.query.agentId
// over anything else, so this exact request would have rendered
// fixture-beta's address instead of the session's fixture-alpha.
test('(c) session for fixture-alpha, query names fixture-beta: session wins, beta never appears', async () => {
  const cookie = await seedSession(FIXTURE_A.agentId);
  const res = await fetch(`${baseUrl}/onboard/done?agentId=${FIXTURE_B.agentId}`, {
    headers: { Cookie: cookie },
  });
  const body = await res.text();
  expect(res.status).toBe(200);
  expect(body).toContain(FIXTURE_A.gmailAddress);
  expect(body).not.toContain(FIXTURE_B.gmailAddress);
  expect(body).not.toContain(FIXTURE_B.googleSheetId);
});

// Would fail against the old query-param code: it would have trusted the
// query's fixture-alpha id and rendered alpha's details, since it never
// looked at the session at all.
test('(d) session id fails isValidAgentId: generic page, no crash, query is still ignored', async () => {
  const cookie = await seedSession('../x');
  const res = await fetch(`${baseUrl}/onboard/done?agentId=${FIXTURE_A.agentId}`, {
    headers: { Cookie: cookie },
  });
  const body = await res.text();
  expect(res.status).toBe(200);
  expect(body).not.toContain(FIXTURE_A.gmailAddress);
  expect(body).not.toContain(FIXTURE_A.googleSheetId);
  expect(body).not.toContain(FIXTURE_B.gmailAddress);
});
