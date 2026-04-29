// src/index.js
// Orchestrator: poll Gmail for replies, categorize, route, act.
//
// STEP 1 (current): agent discovery + Sheet read + row validation + filtering.
// STEP 2 (future): fetch unread Gmail replies, categorize each via claude.js, log to column L.
// STEP 3 (future): route each categorized reply to its path (1A, 1B, 2, 3, 4) and act.
// STEP 4 (future): handle the 2-hour Path 1B stalled-reminder via column Q.
//
// Run: node src/index.js                    (processes all agents)
//      AGENT_ID=mo-test node src/index.js   (processes only mo-test)

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { loadAgent } = require('./agentConfig');
const email = require('./email');

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const RATE_LIMIT_MS = 60 * 60 * 1000; // 60 minutes per spec

const ALLOWED_STATUSES = new Set([
  'new',
  'in_conversation',
  'awaiting_agent_info',
  'HOT',
  'cold',
  'needs_review',
  'manual_handling',
]);

// Files in agents/ that are NOT real agents.
const AGENT_FILE_BLOCKLIST = new Set(['example.json', '.gitkeep']);

// --------------------------------------------------------------------------
// Agent discovery
// --------------------------------------------------------------------------

// Finds all valid agent config files in agents/.
// If process.env.AGENT_ID is set, returns only that one (useful for debugging).
function discoverAgentIds() {
  if (process.env.AGENT_ID) {
    return [process.env.AGENT_ID];
  }
  const agentsDir = path.join(__dirname, '..', 'agents');
  if (!fs.existsSync(agentsDir)) return [];
  return fs
    .readdirSync(agentsDir)
    .filter((f) => f.endsWith('.json') && !AGENT_FILE_BLOCKLIST.has(f))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

// --------------------------------------------------------------------------
// Validation
// --------------------------------------------------------------------------

// Returns true if the string is a plausible email format.
// Not RFC-compliant (no regex is) but catches obvious garbage.
function isPlausibleEmail(str) {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim();
  if (s.length < 5) return false;
  if (!s.includes('@')) return false;
  const [local, domain] = s.split('@');
  if (!local || !domain) return false;
  if (!domain.includes('.')) return false;
  return true;
}

// Validates a Sheet row. Returns { ok, error }.
//   ok: true  → row is valid
//   ok: false → row is invalid; error is human-readable for column R
function validateRow(row) {
  if (!isPlausibleEmail(row.leadId)) {
    return { ok: false, error: 'Missing or invalid email' };
  }
  if (!row.name || !String(row.name).trim()) {
    return { ok: false, error: 'Missing name' };
  }
  if (!row.phone || !String(row.phone).trim()) {
    return { ok: false, error: 'Missing phone' };
  }
  const status = String(row.status || '').trim();
  if (status && !ALLOWED_STATUSES.has(status)) {
    return { ok: false, error: `Invalid status: ${status}` };
  }
  return { ok: true, error: null };
}

// Returns true if this lead is still inside the per-lead rate limit window.
// (true = SKIP, do not act yet)
function isWithinRateLimit(row, now) {
  if (!row.lastActionTimestamp) return false;
  const last = new Date(row.lastActionTimestamp).getTime();
  if (Number.isNaN(last)) return false; // bad timestamp = ignore
  return now - last < RATE_LIMIT_MS;
}

// Reads the AI Enabled column with a default of true if blank.
function isAiEnabled(row) {
  const v = row.aiEnabled;
  if (v === undefined || v === null || v === '') return true;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (s === 'false' || s === 'no' || s === '0') return false;
  return true;
}

// --------------------------------------------------------------------------
// Per-agent processing
// --------------------------------------------------------------------------

async function processAgent(agentId) {
  console.log(`\n[${agentId}] starting`);

  // Load config
  let agent;
  try {
    agent = loadAgent(agentId);
  } catch (err) {
    console.log(`[${agentId}] ERROR: failed to load config: ${err.message}`);
    return;
  }

  // Kill switch
  if (agent.isActive === false) {
    console.log(`[${agentId}] skipped: isActive=false`);
    return;
  }

  // Sheet read
  let rows;
  try {
    rows = await email.readSheetRows(agent);
  } catch (err) {
    console.log(`[${agentId}] ERROR: failed to read Sheet: ${err.message}`);
    return;
  }
  console.log(`[${agentId}] read ${rows.length} rows`);

  const now = Date.now();
  const stats = {
    valid: 0,
    invalid: 0,
    aiDisabled: 0,
    rateLimited: 0,
    processable: 0,
  };
  const processable = [];

  for (const row of rows) {
    // Validate
    const v = validateRow(row);
    if (!v.ok) {
      stats.invalid++;
      // Write error to column R if it has changed (avoid pointless API churn)
      if (row.validationStatus !== v.error) {
        try {
          await email.updateSheetRow(agent, row.rowIndex, {
            validationStatus: v.error,
          });
          console.log(`[${agentId}] row ${row.rowIndex} invalid: ${v.error} (column R updated)`);
        } catch (err) {
          console.log(`[${agentId}] row ${row.rowIndex} invalid (column R write failed: ${err.message})`);
        }
      } else {
        console.log(`[${agentId}] row ${row.rowIndex} invalid: ${v.error} (column R already set)`);
      }
      continue;
    }

    // Row is valid -- clear column R if it was previously errored
    stats.valid++;
    if (row.validationStatus && row.validationStatus.trim()) {
      try {
        await email.updateSheetRow(agent, row.rowIndex, {
          validationStatus: '',
        });
        console.log(`[${agentId}] row ${row.rowIndex} now valid (column R cleared)`);
      } catch (err) {
        console.log(`[${agentId}] row ${row.rowIndex} now valid (column R clear failed: ${err.message})`);
      }
    }

    // Filter: AI Enabled
    if (!isAiEnabled(row)) {
      stats.aiDisabled++;
      continue;
    }

    // Filter: per-lead rate limit
    if (isWithinRateLimit(row, now)) {
      stats.rateLimited++;
      continue;
    }

    stats.processable++;
    processable.push(row);
  }

  console.log(
    `[${agentId}] summary: valid=${stats.valid} invalid=${stats.invalid} aiDisabled=${stats.aiDisabled} rateLimited=${stats.rateLimited} processable=${stats.processable}`
  );

  if (processable.length > 0) {
    console.log(`[${agentId}] processable leads (would be checked for replies in step 2):`);
    for (const row of processable) {
      console.log(`  - row ${row.rowIndex}: ${row.leadId} (${row.name}) status=${row.status || '(blank)'}`);
    }
  }
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main() {
  const agentIds = discoverAgentIds();
  if (agentIds.length === 0) {
    console.log('No agents found in agents/ directory. Nothing to do.');
    return;
  }
  console.log(`Found ${agentIds.length} agent(s): ${agentIds.join(', ')}`);

  for (const id of agentIds) {
    try {
      await processAgent(id);
    } catch (err) {
      // One agent's failure must not stop others.
      console.error(`[${id}] uncaught error: ${err.message}`);
      if (err.stack) console.error(err.stack);
    }
  }

  console.log('\nOrchestrator cycle complete.');
}

main().catch((err) => {
  console.error('Orchestrator crashed:', err);
  process.exit(1);
});
