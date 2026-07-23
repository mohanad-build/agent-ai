// Loads a per-agent configuration from the agents/ folder.
// Each agent has a JSON file named <agent-id>.json (e.g. agents/sarah-ahmed.json).
// The returned config object is passed into prompt builders and action handlers
// so that all agent-specific identity, tone, and safety rules are injected at runtime.

const fs = require('fs');
const path = require('path');
const { getStorageRoot } = require('./storagePaths');

function loadAgent(agentId) {
  const filePath = path.join(getStorageRoot(), `${agentId}.json`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Agent config not found: ${agentId} (looked for ${filePath})`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function findAgentByPhone(phone) {
  const agentsDir = getStorageRoot();
  const files = fs.readdirSync(agentsDir);
  for (const file of files) {
    if (!/^[a-z0-9-]+\.json$/.test(file)) continue;
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

// Returns the follow-up cadence for an agent as an array of positive integers
// representing days between touches (e.g. [3, 7, 14] means Day 3, Day 7, Day 14).
// Validates agent.followUpCadence; falls back to the default on invalid config.
const DEFAULT_FOLLOW_UP_CADENCE = [3, 7, 14];

function getFollowUpCadence(agent) {
  const raw = agent.followUpCadence;
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_FOLLOW_UP_CADENCE;
  }
  const valid = raw.every((d) => Number.isInteger(d) && d > 0);
  if (!valid) {
    console.warn(
      `[${agent.agentId}] getFollowUpCadence: invalid followUpCadence ${JSON.stringify(raw)}, using default [3,7,14]`
    );
    return DEFAULT_FOLLOW_UP_CADENCE;
  }
  return raw;
}

// Absent-as-FALSE, deliberately inverse to isAiEnabled and
// digestSmsEnabled, which are absent-as-true. Archiving moves an agent's
// mail out of their inbox, so it must never be on by omission. String
// handling is explicit because agent JSON is hand-authored and a bare
// truthy check reads the string 'false' as true.
function isInboxCleaningEnabled(agentConfig) {
  const v = agentConfig.inboxCleaningEnabled;
  if (v === undefined || v === null || v === '') return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s === 'true' || s === 'yes' || s === '1';
  }
  return false;
}

module.exports = { loadAgent, findAgentByPhone, isLeadCategoryActionable, getFollowUpCadence, isInboxCleaningEnabled };
