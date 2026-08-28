// scripts/encrypt-existing-tokens.js
//
// One-time migration: encrypts any plaintext googleRefreshToken values in
// existing agents/<id>.json files to the enc:v1: format used by
// src/tokenCrypto.js. Idempotent, safe to run more than once - agents
// already migrated or with no token are skipped.
//
// The actual migration loop lives in src/tokenMigration.js so it can also
// run automatically at server boot (src/server.js). This file is the thin
// CLI wrapper.
//
// Usage: node scripts/encrypt-existing-tokens.js
// STORAGE_ROOT (or .env's STORAGE_ROOT) controls which agents directory
// this runs against, same as the rest of the app.

require('dotenv').config();
const { migrateExistingTokens } = require('../src/tokenMigration');

if (require.main === module) {
  migrateExistingTokens();
}

module.exports = { migrateExistingTokens };
