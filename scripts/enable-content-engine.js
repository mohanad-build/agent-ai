'use strict';

const { loadAgent } = require('../src/agentConfig');
const {
  readContentProfile,
  writeContentProfile,
  setContentEngineEnabled,
  buildDefaultContentProfile,
} = require('../src/content/profile');

const VALID_PRIMARY_FOCUS   = new Set(['buyers', 'sellers', 'both']);
const VALID_CONTENT_VOLUMES = new Set(['max', 'balanced', 'minimum']);
const VALID_ENGINE_MODES    = new Set(['shadow', 'live']);

async function enableContentEngine(agentId, opts = {}) {
  if (!agentId) throw new Error('agentId is required');

  loadAgent(agentId);

  const baseDirOpts = opts.baseDir ? { baseDir: opts.baseDir } : {};
  const profile = readContentProfile(agentId, baseDirOpts);

  if (profile === null) {
    const { primaryFocus, contentVolume, contentEngineMode } = opts;
    if (!primaryFocus || !contentVolume || !contentEngineMode) {
      throw new Error('Profile does not exist. Provide primaryFocus, contentVolume, contentEngineMode to create.');
    }
    if (!VALID_PRIMARY_FOCUS.has(primaryFocus)) {
      throw new Error(`primaryFocus must be one of: ${[...VALID_PRIMARY_FOCUS].join(', ')}`);
    }
    if (!VALID_CONTENT_VOLUMES.has(contentVolume)) {
      throw new Error(`contentVolume must be one of: ${[...VALID_CONTENT_VOLUMES].join(', ')}`);
    }
    if (!VALID_ENGINE_MODES.has(contentEngineMode)) {
      throw new Error(`contentEngineMode must be one of: ${[...VALID_ENGINE_MODES].join(', ')}`);
    }
    const newProfile = buildDefaultContentProfile(agentId, {
      contentEngineEnabled: true,
      primaryFocus,
      contentVolume,
      contentEngineMode,
    });
    writeContentProfile(agentId, newProfile, baseDirOpts);
    return { action: 'created', enabled: true };
  }

  if (profile.contentEngineEnabled === true) {
    return { action: 'noop-already-enabled', enabled: true };
  }

  setContentEngineEnabled(agentId, true, baseDirOpts);
  return { action: 're-enabled', enabled: true };
}

module.exports = { enableContentEngine };

if (require.main === module) {
  const agentId = process.argv[2];
  if (!agentId) {
    console.error('Usage: node scripts/enable-content-engine.js <agent-id>');
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
    let profile;
    try {
      profile = readContentProfile(agentId);
    } catch (err) {
      console.error(`Error reading content profile: ${err.message}`);
      process.exit(1);
    }

    let primaryFocus, contentVolume, contentEngineMode;

    if (profile === null) {
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      const promptValidated = (question, choices, defaultVal) =>
        new Promise((resolve, reject) => {
          let attempts = 0;
          const ask = () => {
            rl.question(question, (raw) => {
              attempts++;
              const val = raw.trim() || defaultVal;
              if (choices.has(val)) {
                resolve(val);
              } else if (attempts >= 3) {
                reject(new Error(`Invalid value '${val}'. Expected one of: ${[...choices].join(', ')}`));
              } else {
                console.error(`Invalid input. Expected one of: ${[...choices].join(', ')}`);
                ask();
              }
            });
          };
          ask();
        });

      try {
        primaryFocus     = await promptValidated('Primary focus (buyers/sellers/both) [both]: ', VALID_PRIMARY_FOCUS, 'both');
        contentVolume    = await promptValidated('Content volume (max/balanced/minimum) [max]: ', VALID_CONTENT_VOLUMES, 'max');
        contentEngineMode = await promptValidated('Mode (shadow/live) [shadow]: ', VALID_ENGINE_MODES, 'shadow');
        rl.close();
      } catch (err) {
        rl.close();
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    }

    try {
      const opts = profile === null ? { primaryFocus, contentVolume, contentEngineMode } : {};
      const result = await enableContentEngine(agentId, opts);
      const messages = {
        'created':              `Content Engine created and enabled for agent '${agentId}'.`,
        'noop-already-enabled': `Content Engine is already enabled for agent '${agentId}'. No changes made.`,
        're-enabled':           `Content Engine re-enabled for agent '${agentId}'.`,
      };
      console.log(messages[result.action] || `Done: ${result.action}`);
      process.exit(0);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  })();
}
