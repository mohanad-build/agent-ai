'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const http = require('http');

const express = require('express');
const router  = require('../src/routes/onboard');
const { _internal: digestInternal } = require('../src/digest');
const { AGENT_ID_REGEX: indexRegex }     = require('../src/index');
const { AGENT_ID_REGEX: dashboardRegex } = require('../src/routes/dashboard');
const { DIGEST_AGENT_ID_REGEX: digestRegex } = digestInternal;

let tmpDir;
let server;
let baseUrl;

beforeAll((done) => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboard-tempFile-'));
  process.env.STORAGE_ROOT = tmpDir;

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
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

// POST /onboard/ (src/routes/onboard.js:256-312) builds a brand-new agent
// config in-process and calls writeAgentAtomic -- no OAuth, no external
// Google calls on this path, so it is driveable end to end like any other
// route in this codebase's existing Express-router test convention.
test('the temp file writeAgentAtomic writes cannot be discovered as an agent by any of the three discovery filters', async () => {
  const writeSpy = jest.spyOn(fs, 'writeFileSync');
  let tmpBasename;
  let agentId;
  try {
    const res = await fetch(`${baseUrl}/onboard/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        firstName: 'Temp',
        lastName: 'File-Test',
        agentPhone: '+15551234567',
      }).toString(),
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    agentId = new URL(location, baseUrl).searchParams.get('agentId');
    expect(agentId).toBeTruthy();

    const realPath = path.join(tmpDir, `${agentId}.json`);
    const tmpCall = writeSpy.mock.calls.find((call) => call[0] !== realPath && String(call[0]).includes(agentId));
    expect(tmpCall).toBeDefined();
    tmpBasename = path.basename(tmpCall[0]);
  } finally {
    writeSpy.mockRestore();
  }

  expect(indexRegex.test(tmpBasename)).toBe(false);
  expect(dashboardRegex.test(tmpBasename)).toBe(false);
  expect(digestRegex.test(tmpBasename)).toBe(false);

  // Pins the specific shape, not just "some shape the filters happen to
  // reject": once digest.js's filter is anchored, BOTH .json.tmp and the
  // legacy .tmp.json are already rejected by all three filters above, so
  // those assertions alone can no longer distinguish a regression back to
  // .tmp.json from the fixed .json.tmp. This is the assertion that actually
  // catches that regression.
  expect(tmpBasename).toBe(`${agentId}.json.tmp`);

  // Sanity: the real file landed correctly and is itself discoverable.
  expect(fs.existsSync(path.join(tmpDir, `${agentId}.json`))).toBe(true);
  expect(indexRegex.test(`${agentId}.json`)).toBe(true);
});
