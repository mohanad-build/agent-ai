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

module.exports = { loadAgent };
