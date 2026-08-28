// src/tokenMigration.js
//
// Core loop for migrating plaintext googleRefreshToken values in existing
// agents/<id>.json files to the enc:v1: format used by src/tokenCrypto.js.
// Idempotent, safe to run more than once - agents already migrated or with
// no token are skipped. Called from scripts/encrypt-existing-tokens.js (CLI)
// and from server.js (automatically at boot, when TOKEN_ENCRYPTION_KEY is set).

'use strict';

const fs = require('fs');
const path = require('path');

const { getStorageRoot } = require('./storagePaths');
const { discoverAgentIds } = require('./routes/dashboard');
const { encryptToken, ENC_PREFIX } = require('./tokenCrypto');

// Same tmp-file-then-rename shape as onboard.js's writeAgentAtomic, just
// parameterized by directory so this can point at a scratch copy in tests.
function writeAgentAtomic(agentId, config, agentsDir) {
  const tmpPath = path.join(agentsDir, `${agentId}.tmp.json`);
  const finalPath = path.join(agentsDir, `${agentId}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n');
  fs.renameSync(tmpPath, finalPath);
}

function migrateExistingTokens() {
  const agentsDir = getStorageRoot();
  const agentIds = discoverAgentIds();

  let migrated = 0;
  let alreadyMigrated = 0;
  let noToken = 0;

  for (const agentId of agentIds) {
    const filePath = path.join(agentsDir, `${agentId}.json`);
    const config = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const token = config.googleRefreshToken;

    if (typeof token !== 'string' || token === '') {
      noToken++;
      continue;
    }

    if (token.startsWith(ENC_PREFIX)) {
      alreadyMigrated++;
      continue;
    }

    config.googleRefreshToken = encryptToken(token);
    writeAgentAtomic(agentId, config, agentsDir);
    migrated++;
    console.log(`[tokenMigration] migrated: ${agentId}`);
  }

  const summary = { migrated, alreadyMigrated, noToken, total: agentIds.length };

  console.log('');
  console.log('=== summary ===');
  console.log(`agents directory:  ${agentsDir}`);
  console.log(`total agents:      ${summary.total}`);
  console.log(`migrated:          ${summary.migrated}`);
  console.log(`already migrated:  ${summary.alreadyMigrated}`);
  console.log(`no token (skipped): ${summary.noToken}`);

  return summary;
}

module.exports = { migrateExistingTokens };
