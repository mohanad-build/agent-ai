// src/operatorConfig.js
//
// Loads operator configs from STORAGE_ROOT/_operators/<operatorId>.json.
// Mirrors the loadAgent pattern in src/agentConfig.js, scoped to operators.

const fs   = require('fs');
const path = require('path');

const { getStorageRoot } = require('./storagePaths');

function loadOperator(operatorId) {
  const filePath = path.join(getStorageRoot(), '_operators', `${operatorId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Operator config not found: ${operatorId} (looked for ${filePath})`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function discoverOperatorIds() {
  const dir = path.join(getStorageRoot(), '_operators');
  if (!fs.existsSync(dir)) return [];
  // Include *.json, exclude *.state.json (state files share the same directory).
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.json') && !f.endsWith('.state.json'))
    .map(f => f.replace(/\.json$/, ''))
    .sort();
}

// Checks that every agent with an operatorId field has a corresponding operator
// config file in operatorsDir. Agents without an operatorId field are skipped -
// they are already guarded by the operatorId check in maybeRunContentEngine.
//
// Returns { ok, orphans: [{agentId, operatorId}], missingOperators: [operatorId] }
function validateAgentOperatorMappings(agentsDir, operatorsDir) {
  // Default agentsDir matches agentConfig.js's Pattern A resolution (__dirname/../agents/)
  // so both resolve to the same path on Railway. When agentConfig.js migrates to Pattern B,
  // update both defaults together.
  const aDir = agentsDir   || path.join(__dirname, '..', 'agents');
  const oDir = operatorsDir || path.join(getStorageRoot(), '_operators');

  const orphans = [];
  const missingOperatorSet = new Set();

  if (!fs.existsSync(aDir)) {
    return { ok: true, orphans: [], missingOperators: [] };
  }

  const agentFiles = fs
    .readdirSync(aDir)
    .filter(f => f.endsWith('.json') && !f.endsWith('.state.json'));

  for (const file of agentFiles) {
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(path.join(aDir, file), 'utf8'));
    } catch (_) {
      continue;
    }
    if (!cfg.operatorId) continue;
    const operatorFile = path.join(oDir, `${cfg.operatorId}.json`);
    if (!fs.existsSync(operatorFile)) {
      const agentId = cfg.agentId || file.replace(/\.json$/, '');
      orphans.push({ agentId, operatorId: cfg.operatorId });
      missingOperatorSet.add(cfg.operatorId);
    }
  }

  return {
    ok: orphans.length === 0,
    orphans,
    missingOperators: [...missingOperatorSet].sort(),
  };
}

module.exports = { loadOperator, discoverOperatorIds, validateAgentOperatorMappings };
