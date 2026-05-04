// src/index.js
// Orchestrator: poll Gmail for replies, categorize, route, act.
//
// STEP 1 (current): agent discovery + Sheet read + row validation + filtering.
// STEP 2 (current): fetch unread Gmail replies, categorize each via claude.js, log to column L.
// STEP 3 (current): route each categorized reply to its path (1A, 1B, 2, 3, 4) and act.
// STEP 4 (future): handle the 2-hour Path 1B stalled-reminder via column Q.
//
// Run: node src/index.js                    (processes all agents)
//      AGENT_ID=mo-test node src/index.js   (processes only mo-test)

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { loadAgent } = require('./agentConfig');
const email = require('./email');
const claude = require('./claude');
const prompts = require('./prompts');
const {
  pathHotSignal,
  pathStopSignal,
  pathAskAgent,
  pathAnswerGeneral,
  pathNeedsReview,
} = require('./paths');

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const RATE_LIMIT_MS = 60 * 60 * 1000; // 60 minutes per spec
const CONFIDENCE_THRESHOLD = 0.7; // Below this, force category to needs_review

const ALLOWED_STATUSES = new Set([
  'new',
  'in_conversation',
  'awaiting_agent_info',
  'awaiting_agent',
  'warm',
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
// Path dispatch
// --------------------------------------------------------------------------

// Routes a categorized reply to the correct path function.
// Both 'answer_general' and 'conversation_continue' map to pathAnswerGeneral.
// Unknown categories fall through to pathNeedsReview as a safe default.
async function executePath(agent, row, msg, cat) {
  switch (cat.category) {
    case 'hot_signal':
      return await pathHotSignal(agent, row, msg, cat);
    case 'stop_signal':
      return await pathStopSignal(agent, row, msg, cat);
    case 'answer_property_specific':
      return await pathAskAgent(agent, row, msg, cat);
    case 'answer_general':
    case 'conversation_continue':
      return await pathAnswerGeneral(agent, row, msg, cat);
    case 'needs_review':
      return await pathNeedsReview(agent, row, msg, cat);
    default:
      console.warn(`[${agent.agentId}] unknown category "${cat.category}", routing to needs_review`);
      return await pathNeedsReview(agent, row, msg, cat);
  }
}

// --------------------------------------------------------------------------
// Reply matching + categorization
// --------------------------------------------------------------------------

// Extracts the bare email address from a "From" header value.
// Input examples: "Sarah Chen <sarah@example.com>" or "sarah@example.com"
// Returns lowercase email for case-insensitive matching, or null if unparseable.
function extractEmailAddress(fromHeader) {
  if (!fromHeader || typeof fromHeader !== 'string') return null;
  const angleMatch = fromHeader.match(/<([^>]+)>/);
  if (angleMatch && angleMatch[1]) return angleMatch[1].trim().toLowerCase();
  const trimmed = fromHeader.trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  return null;
}

// Categorizes a single reply via Claude, applies the confidence-threshold
// downgrade rule, and returns { category, confidence, reasoning, downgraded }.
// Throws on Claude API failure (caller decides what to do).
async function categorizeReply(agentConfig, replySnippet) {
  const prompt = prompts.buildCategorizationPrompt(agentConfig, replySnippet);
  const result = await claude.categorize(prompt);
  const confidence = typeof result.confidence === 'number' ? result.confidence : 0;
  const downgraded = confidence < CONFIDENCE_THRESHOLD && result.category !== 'needs_review';
  return {
    category: downgraded ? 'needs_review' : result.category,
    confidence,
    reasoning: result.reasoning || '',
    downgraded,
    originalCategory: result.category,
  };
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

  if (processable.length === 0) {
    console.log(`[${agentId}] no processable leads, skipping reply fetch`);
    return;
  }

  // Build a quick lookup: lowercased lead email → row.
  const leadIndex = new Map();
  for (const row of processable) {
    const key = String(row.leadId).trim().toLowerCase();
    if (leadIndex.has(key)) {
      console.warn(`[${agent.agentId}] duplicate Lead ID ${key} found at row ${leadIndex.get(key).rowIndex} and row ${row.rowIndex}, last-write wins`);
    }
    leadIndex.set(key, row);
  }

  // Fetch unread replies from Gmail.
  let unreadMessages;
  try {
    unreadMessages = await email.fetchUnreadReplies(agent);
  } catch (err) {
    console.log(`[${agentId}] ERROR: failed to fetch unread replies: ${err.message}`);
    return;
  }
  console.log(`[${agentId}] fetched ${unreadMessages.length} unread message(s) in last 24h`);

  const replyStats = {
    unmatched: 0,
    selfSent: 0,
    matched: 0,
    categorized: 0,
    downgraded: 0,
    failed: 0,
  };

  const agentEmail = String(agent.gmailAddress || '').trim().toLowerCase();

  for (const msg of unreadMessages) {
    const senderEmail = extractEmailAddress(msg.from);

    // Skip messages from the agent themselves (sent items can show up in unread queries).
    if (senderEmail && senderEmail === agentEmail) {
      replyStats.selfSent++;
      continue;
    }

    // Match sender to a processable lead.
    const row = senderEmail ? leadIndex.get(senderEmail) : null;
    if (!row) {
      replyStats.unmatched++;
      console.log(`[${agentId}] unmatched sender: ${msg.from} (left unread for agent visibility)`);
      continue;
    }

    replyStats.matched++;

    // Categorize via Claude.
    let cat;
    try {
      cat = await categorizeReply(agent, msg.snippet);
    } catch (err) {
      replyStats.failed++;
      console.log(`[${agentId}] row ${row.rowIndex} categorization FAILED for ${senderEmail}: ${err.message} (left unread, will retry next cycle)`);
      continue;
    }

    replyStats.categorized++;
    if (cat.downgraded) replyStats.downgraded++;

    const downgradeNote = cat.downgraded
      ? ` (downgraded from ${cat.originalCategory} due to confidence ${cat.confidence.toFixed(2)} < ${CONFIDENCE_THRESHOLD})`
      : '';
    const logEntry = `Reply categorized: ${cat.category} (confidence ${cat.confidence.toFixed(2)})${downgradeNote}. Reasoning: ${cat.reasoning} | Snippet: ${msg.snippet.slice(0, 200)}`;

    // ORDER A: log to column L, execute path, then mark as read only on success.
    // If column L write fails, leave unread to retry next cycle.
    // If path fails, leave unread so the message is not silently dropped.
    try {
      await email.appendToConversationHistory(agent, row.rowIndex, logEntry);
    } catch (err) {
      console.log(`[${agentId}] row ${row.rowIndex} column L write FAILED: ${err.message} (left unread, will retry next cycle)`);
      continue;
    }

    const result = await executePath(agent, row, msg, cat);

    if (result.ok) {
      try {
        await email.markRead(agent, msg.messageId);
      } catch (err) {
        console.log(`[${agentId}] row ${row.rowIndex} markRead FAILED: ${err.message} (column L was written; next cycle may double-log)`);
      }
    } else {
      console.warn(`[${agentId}] row ${row.rowIndex} path failed for ${cat.category}, leaving unread for retry. errors: ${JSON.stringify(result.errors)}`);
    }

    console.log(`[${agentId}] row ${row.rowIndex} ${senderEmail} -> ${cat.category}${downgradeNote} -> ok=${result.ok}${result.skipped && result.skipped.length > 0 ? ' (skipped)' : ''}`);
  }

  console.log(
    `[${agentId}] reply summary: matched=${replyStats.matched} categorized=${replyStats.categorized} downgraded=${replyStats.downgraded} failed=${replyStats.failed} unmatched=${replyStats.unmatched} selfSent=${replyStats.selfSent}`
  );
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
