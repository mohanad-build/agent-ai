'use strict';

const { loadAgent } = require('../src/agentConfig');
const {
  readContentProfile,
  setContentEngineEnabled,
} = require('../src/content/profile');

async function disableContentEngine(agentId, opts = {}) {
  if (!agentId) throw new Error('agentId is required');

  loadAgent(agentId);

  const baseDirOpts = opts.baseDir ? { baseDir: opts.baseDir } : {};
  const profile = readContentProfile(agentId, baseDirOpts);

  if (profile === null) {
    throw new Error('Agent has no Content Engine profile. Nothing to disable.');
  }

  if (profile.contentEngineEnabled === false) {
    return { action: 'noop-already-disabled', enabled: false };
  }

  setContentEngineEnabled(agentId, false, baseDirOpts);
  return { action: 'disabled', enabled: false };
}

module.exports = { disableContentEngine };

if (require.main === module) {
  const agentId = process.argv[2];
  if (!agentId) {
    console.error('Usage: node scripts/disable-content-engine.js <agent-id>');
    process.exit(1);
  }

  try {
    loadAgent(agentId);
  } catch (_) {
    const fs   = require('fs');
    const path = require('path');
    const AGENTS_DIR = path.join(__dirname, '..', 'agents');
    const BLOCKLIST  = new Set(['example.json', '.gitkeep']);
    let validIds = [];
    if (fs.existsSync(AGENTS_DIR)) {
      validIds = fs
        .readdirSync(AGENTS_DIR)
        .filter(f =>
          f.endsWith('.json') &&
          !f.endsWith('.state.json') &&
          !f.endsWith('.contentProfile.json') &&
          !f.endsWith('.contentState.json') &&
          !BLOCKLIST.has(f)
        )
        .map(f => f.replace(/\.json$/, ''))
        .sort();
    }
    console.error(`Agent '${agentId}' not found. Valid agent IDs: ${validIds.join(', ')}`);
    process.exit(1);
  }

  (async () => {
    try {
      const result = await disableContentEngine(agentId, {});
      const messages = {
        'noop-already-disabled': `Content Engine is already disabled for agent '${agentId}'. No changes made.`,
        'disabled':              `Content Engine disabled for agent '${agentId}'.`,
      };
      console.log(messages[result.action] || `Done: ${result.action}`);
      process.exit(0);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  })();
}
