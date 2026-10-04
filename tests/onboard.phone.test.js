'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const http = require('http');

const express = require('express');
const session = require('express-session');
const router  = require('../src/routes/onboard');

let tmpDir;
let server;
let baseUrl;

beforeAll((done) => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboard-phone-'));
  process.env.STORAGE_ROOT = tmpDir;

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(session({ secret: 'test-secret-not-real', resave: false, saveUninitialized: false, cookie: {} }));
  // Same pre-granted-access convention as tests/onboard.tempFile.test.js:
  // this file is about phone validation, not the passcode gate.
  app.use((req, res, next) => {
    req.session.onboardAccess = true;
    next();
  });
  app.use('/onboard', router);

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

function listDir() {
  return fs.readdirSync(tmpDir).sort();
}

test('refuses a bad phone (invalid exchange) and writes nothing', async () => {
  const before = listDir();
  const res = await fetch(`${baseUrl}/onboard/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      firstName: 'Bad',
      lastName: 'Exchange',
      agentPhone: '416-155-0123',
    }).toString(),
    redirect: 'manual',
  });
  const body = await res.text();

  expect(res.status).toBe(400);
  expect(body).toContain(
    "That number doesn't look right. Enter your 10-digit mobile number, like 416-555-0123."
  );
  expect(listDir()).toEqual(before);
});

test('refuses an empty phone and writes nothing', async () => {
  const before = listDir();
  const res = await fetch(`${baseUrl}/onboard/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      firstName: 'Empty',
      lastName: 'Phone',
      agentPhone: '',
    }).toString(),
    redirect: 'manual',
  });
  const body = await res.text();

  expect(res.status).toBe(400);
  expect(body).toContain(
    "That number doesn't look right. Enter your 10-digit mobile number, like 416-555-0123."
  );
  expect(listDir()).toEqual(before);
});

test('accepts a valid phone, normalizes it, and does not write operatorPhone', async () => {
  const res = await fetch(`${baseUrl}/onboard/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      firstName: 'Good',
      lastName: 'Number',
      agentPhone: '416-555-0188',
    }).toString(),
    redirect: 'manual',
  });
  await res.text();

  expect(res.status).toBe(302);
  const location = res.headers.get('location');
  const agentId = new URL(location, baseUrl).searchParams.get('agentId');
  expect(agentId).toBeTruthy();

  const config = JSON.parse(fs.readFileSync(path.join(tmpDir, `${agentId}.json`), 'utf8'));
  expect(config.agentPhone).toBe('+14165550188');
  expect(config.operatorPhone).toBeUndefined();
});

test('on refusal, re-renders the form with typed values HTML-escaped', async () => {
  const res = await fetch(`${baseUrl}/onboard/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      firstName: '"><b>x</b>',
      lastName: 'Escaping',
      agentPhone: 'not-a-phone',
    }).toString(),
    redirect: 'manual',
  });
  const body = await res.text();

  expect(res.status).toBe(400);
  expect(body).not.toContain('<b>x</b>');
  expect(body).toContain('&quot;&gt;&lt;b&gt;x&lt;/b&gt;');
});

test('a hand-built request posting usesEmojis twice still gets the 400 form back, not a 500', async () => {
  const params = new URLSearchParams();
  params.append('firstName', 'Dup');
  params.append('lastName', 'Field');
  params.append('agentPhone', 'not-a-phone');
  params.append('usesEmojis', 'yes');
  params.append('usesEmojis', 'no');

  const res = await fetch(`${baseUrl}/onboard/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    redirect: 'manual',
  });
  const body = await res.text();

  expect(res.status).toBe(400);
  expect(body).toContain(
    "That number doesn't look right. Enter your 10-digit mobile number, like 416-555-0123."
  );
});
