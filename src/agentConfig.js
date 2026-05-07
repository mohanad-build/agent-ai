// Loads a per-agent configuration from the agents/ folder.
// Each agent has a JSON file named <agent-id>.json (e.g. agents/sarah-ahmed.json).
// The returned config object is passed into prompt builders and action handlers
// so that all agent-specific identity, tone, and safety rules are injected at runtime.

const fs = require('fs');
const path = require('path');

function loadAgent(agentId) {
  const filePath = path.resolve(__dirname, '..', 'agents', `${agentId}.json`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Agent config not found: ${agentId} (looked for ${filePath})`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function findAgentByPhone(phone) {
  const agentsDir = path.join(__dirname, '..', 'agents');
  const files = fs.readdirSync(agentsDir);
  for (const file of files) {
    if (!file.endsWith('.json') || file.endsWith('.state.json')) continue;
    const filePath = path.join(agentsDir, file);
    let config;
    try {
      config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.warn(`findAgentByPhone: skipping ${file} (parse error: ${err.message})`);
      continue;
    }
    if (config.agentPhone === phone) return config;
  }
  return null;
}

// Returns false if the row is an SOI contact that must not be auto-processed.
// Anything other than exactly 'soi' (case-insensitive) is action-eligible.
function isLeadCategoryActionable(row) {
  if (!row || !row.leadCategory) return true;
  return row.leadCategory.trim().toLowerCase() !== 'soi';
}

module.exports = { loadAgent, findAgentByPhone, isLeadCategoryActionable };
