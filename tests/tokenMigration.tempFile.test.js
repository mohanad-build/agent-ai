'use strict';

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const { migrateExistingTokens } = require('../src/tokenMigration');
const { _internal: digestInternal } = require('../src/digest');
const { AGENT_ID_REGEX: indexRegex }     = require('../src/index');
const { AGENT_ID_REGEX: dashboardRegex } = require('../src/routes/dashboard');
const { DIGEST_AGENT_ID_REGEX: digestRegex } = digestInternal;

let tmpDir;

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

test('the temp file writeAgentAtomic writes cannot be discovered as an agent by any of the three discovery filters', () => {
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

  expect(indexRegex.test(tmpBasename)).toBe(false);
  expect(dashboardRegex.test(tmpBasename)).toBe(false);
  expect(digestRegex.test(tmpBasename)).toBe(false);

  // Pins the specific shape, not just "some shape the filters happen to
  // reject": once digest.js's filter is anchored, BOTH .json.tmp and the
  // legacy .tmp.json are already rejected by all three filters above, so
  // those assertions alone can no longer distinguish a regression back to
  // .tmp.json from the fixed .json.tmp. This is the assertion that actually
  // catches that regression.
  expect(tmpBasename).toBe('agent-a.json.tmp');

  // Sanity: the real file was actually migrated.
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, 'agent-a.json'), 'utf8'));
  expect(onDisk.googleRefreshToken.startsWith('enc:v1:')).toBe(true);
});
