// Loads a per-agent configuration from the agents/ folder.
// Each agent has a JSON file named <agent-id>.json (e.g. agents/sarah-ahmed.json).
// The returned config object is passed into prompt builders and action handlers
// so that all agent-specific identity, tone, and safety rules are injected at runtime.

const fs = require('fs');
const path = require('path');
const { getStorageRoot } = require('./storagePaths');
const { isAgentConfigFilename } = require('./agentDiscovery');

function loadAgent(agentId) {
  const filePath = path.join(getStorageRoot(), `${agentId}.json`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Agent config not found: ${agentId} (looked for ${filePath})`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

// Uses the shared isAgentConfigFilename predicate (regex AND blocklist),
// not just the regex: findAgentByPhone used to apply only the regex, so
// example.json was opened and parsed on every call, harmlessly failing to
// match a phone number rather than being skipped outright like it is
// everywhere else. Adding the blocklist check here is a behaviour change on
// this inbound-SMS routing path, not a pure refactor -- it now skips
// example.json without ever reading it, same as every other discovery site.
function findAgentByPhone(phone) {
  const agentsDir = getStorageRoot();
  const files = fs.readdirSync(agentsDir);
  for (const file of files) {
    if (!isAgentConfigFilename(file)) continue;
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

// The one canonical writer for agents/<id>.json. Every other write to this
// file (routes/onboard.js, routes/dashboard.js, tokenMigration.js) is still
// its own inline tmp-file-then-rename implementation; this function does
// not replace those yet, only handleAuthFailure (src/gmail.js) calls it so
// far.
//
// Read-patch-write, not "caller reads, mutates, and hands back a full
// object": `patch` is merged onto whatever is currently on disk, so a
// caller that only knows about one field (handleAuthFailure only knows
// isActive) cannot accidentally drop every other field on the file --
// including googleRefreshToken, which since f92a834 is AES-256-GCM
// ciphertext that exists nowhere else. Losing it here is a full
// re-authorization for that agent, not a retry.
//
// Synchronous throughout, no await between the read and the write: same
// tmp-file-then-renameSync shape the other three writers already use, so a
// crash mid-write leaves the original file untouched instead of truncated.
function patchAgent(agentId, patch) {
  if (typeof agentId !== 'string' || agentId.trim() === '') {
    throw new Error('patchAgent: agentId must be a non-empty string');
  }
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('patchAgent: patch must be a plain object');
  }

  const filePath = path.join(getStorageRoot(), `${agentId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`patchAgent: agent config not found: ${agentId} (looked for ${filePath})`);
  }

  const current = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const next = { ...current, ...patch };

  // .json.tmp, not .tmp.json: a crash between writeFileSync and renameSync
  // leaves this file on disk. Every discovery site (src/agentDiscovery.js's
  // isAgentConfigFilename, shared by all of them now) rejects both shapes
  // today, so this is no longer the only thing standing between an orphaned
  // temp file and a phantom agent holding a live googleRefreshToken -- it
  // once was, back when src/digest.js still ran its own unanchored
  // `f.endsWith('.json')` sweep that .tmp.json would have slipped through.
  // .json.tmp is kept anyway, to match the one tmp-suffix convention every
  // other atomic writer in this codebase already uses (onboard.js,
  // tokenMigration.js), not because it is the last line of defense anymore.
  const tmpPath = path.join(getStorageRoot(), `${agentId}.json.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, filePath);

  return next;
}

module.exports = { loadAgent, findAgentByPhone, isLeadCategoryActionable, getFollowUpCadence, isInboxCleaningEnabled, patchAgent };
