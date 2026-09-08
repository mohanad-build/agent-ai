'use strict';

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const { migrateExistingTokens } = require('../src/tokenMigration');
const { AGENT_ID_REGEX } = require('../src/agentDiscovery');

let tmpDir;

// AGENT_ID is cleared globally before every test (tests/setup/clearAgentIdEnv.js
// via jest.config.js's setupFilesAfterEnv). tokenMigration.js now honours it
// (src/agentDiscovery.js), unlike before this commit, and .env sets
// AGENT_ID=mo-test for local dev, so this test would otherwise silently
// migrate the wrong agent instead of the temp dir it just created.
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenMigration-tempFile-'));
  process.env.STORAGE_ROOT = tmpDir;
  process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
});

afterEach(() => {
  delete process.env.STORAGE_ROOT;
  delete process.env.TOKEN_ENCRYPTION_KEY;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('the temp file writeAgentAtomic writes cannot be discovered as an agent', () => {
  fs.writeFileSync(
    path.join(tmpDir, 'agent-a.json'),
    JSON.stringify({ agentId: 'agent-a', isActive: true, googleRefreshToken: '1//plaintext-refresh-token' })
  );

  const writeSpy = jest.spyOn(fs, 'writeFileSync');
  let tmpBasename;
  try {
    const summary = migrateExistingTokens();
    expect(summary.migrated).toBe(1);

    const realPath = path.join(tmpDir, 'agent-a.json');
    const tmpCall = writeSpy.mock.calls.find((call) => call[0] !== realPath);
    expect(tmpCall).toBeDefined();
    tmpBasename = path.basename(tmpCall[0]);
  } finally {
    writeSpy.mockRestore();
  }

  expect(AGENT_ID_REGEX.test(tmpBasename)).toBe(false);

  // Pins the specific shape, not just "some shape the filter happens to
  // reject": BOTH .json.tmp and the legacy .tmp.json are already rejected,
  // so that assertion alone can no longer distinguish a regression back to
  // .tmp.json from the fixed .json.tmp. This is the assertion that actually
  // catches that regression.
  expect(tmpBasename).toBe('agent-a.json.tmp');

  // Sanity: the real file was actually migrated.
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, 'agent-a.json'), 'utf8'));
  expect(onDisk.googleRefreshToken.startsWith('enc:v1:')).toBe(true);
});
