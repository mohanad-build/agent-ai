'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const mockTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-sheeterror-'));
fs.writeFileSync(path.join(mockTmpDir, 'agent-x.json'), '{}');

jest.mock('../src/storagePaths', () => ({
  getStorageRoot: () => mockTmpDir,
}));

jest.mock('../src/agentConfig', () => ({
  loadAgent: jest.fn(() => ({
    agentId: 'agent-x',
    mode: 'shadow',
    isActive: true,
    googleRefreshToken: 'refresh-token',
    googleSheetId: 'sheet-id',
  })),
}));

jest.mock('../src/agentState', () => ({
  getState: jest.fn(() => ({})),
}));

const mockReadSheetRows = jest.fn();
jest.mock('../src/email', () => ({
  readSheetRows: (...args) => mockReadSheetRows(...args),
}));

const { SheetAccessError } = require('../src/gmail');

const express = require('express');
const router = require('../src/routes/dashboard');

function buildServer() {
  const app = express();
  app.use((req, res, next) => {
    req.session = { authenticated: true };
    next();
  });
  app.use('/dashboard', router);
  return app;
}

let server;
let baseUrl;

beforeAll((done) => {
  const app = buildServer();
  server = http.createServer(app);
  server.listen(0, () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterAll((done) => {
  server.close(done);
  fs.rmSync(mockTmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  mockReadSheetRows.mockReset();
});

test('1. overview card, SheetAccessError(403) -> pill-err badge "Sheet access denied"', async () => {
  mockReadSheetRows.mockRejectedValue(new SheetAccessError(403, 'agent-x'));
  const res = await fetch(`${baseUrl}/dashboard/`);
  const html = await res.text();
  expect(html).toMatch(/<span class="pill pill-err">Sheet access denied<\/span>/);
});

test('2. overview card, SheetAccessError(404) -> pill-err badge "Sheet not found"', async () => {
  mockReadSheetRows.mockRejectedValue(new SheetAccessError(404, 'agent-x'));
  const res = await fetch(`${baseUrl}/dashboard/`);
  const html = await res.text();
  expect(html).toMatch(/<span class="pill pill-err">Sheet not found<\/span>/);
});

test('3. overview card, GENERIC error -> no sheet pill-err badge, card still renders', async () => {
  mockReadSheetRows.mockRejectedValue(new Error('boom'));
  const res = await fetch(`${baseUrl}/dashboard/`);
  const html = await res.text();
  expect(html).not.toMatch(/Sheet not found/);
  expect(html).not.toMatch(/Sheet access denied/);
  expect(html).toMatch(/<span class="stat-label">Total<\/span><span class="stat-value">0<\/span>/);
});

test('4. overview card, resolves rows -> no sheet badge', async () => {
  mockReadSheetRows.mockResolvedValue([]);
  const res = await fetch(`${baseUrl}/dashboard/`);
  const html = await res.text();
  expect(html).not.toMatch(/Sheet not found/);
  expect(html).not.toMatch(/Sheet access denied/);
});

test('5. leads table, SheetAccessError(404) -> err-banner block with 404 wording, above the table', async () => {
  mockReadSheetRows.mockRejectedValue(new SheetAccessError(404, 'agent-x'));
  const res = await fetch(`${baseUrl}/dashboard/agent/agent-x/leads`);
  const html = await res.text();
  expect(html).toMatch(/<p class="err-banner">This agent's Google Sheet could not be found \(HTTP 404\)/);
  const bannerIdx = html.indexOf('<p class="err-banner">');
  const tableIdx = html.indexOf('<table class="leads-table">');
  expect(bannerIdx).toBeGreaterThan(-1);
  expect(tableIdx).toBeGreaterThan(-1);
  expect(bannerIdx).toBeLessThan(tableIdx);
});

test('6. leads table, generic error -> no err-banner sheet block, "No rows found."', async () => {
  mockReadSheetRows.mockRejectedValue(new Error('boom'));
  const res = await fetch(`${baseUrl}/dashboard/agent/agent-x/leads`);
  const html = await res.text();
  expect(html).not.toMatch(/<p class="err-banner">/);
  expect(html).toMatch(/No rows found\./);
});
