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

const { loadAgent, isLeadCategoryActionable } = require('./agentConfig');
const { runLeadIntake, transitionToIntaken } = require('./leadIntake');
const { getNow, getNowIso, getNowDate } = require('./time');
const followUp = require('./followUp');
const agentState = require('./agentState');
const { shouldRunDailyDigest, runDailyDigestForAgent, shouldRunWeeklyDigest, runWeeklyDigestForOperator } = require('./digest');
const { runContentEngineForAgent, shouldRunContentEngine } = require('./content/engine');
const { readContentProfile, isContentEngineEnabled } = require('./content/profile');
const { generateWeeklyAngles, shouldRunAngleGeneration } = require('./content/angles');
const { generateEvergreenAngles, evergreenAnglesFilePath } = require('./content/evergreenAngles');
const { pullBankOfCanada, shouldRunDataPull } = require('./content/pullData');
const { currentWeek } = require('./content/cache');
const { readContentState } = require('./content/state');
const operatorState = require('./operatorState');
const { loadOperator, discoverOperatorIds, validateAgentOperatorMappings } = require('./operatorConfig');
const { getStorageRoot } = require('./storagePaths');
const email = require('./email');
const claude = require('./claude');
const prompts = require('./prompts');
const twilio = require('./twilio');
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

const RATE_LIMIT_MS = 60 * 60 * 1000;        // 60 minutes per spec
const STALE_REMINDER_MS = 2 * 60 * 60 * 1000;    // 2 hours: send reminder SMS to agent
const STALE_ESCALATION_MS = 24 * 60 * 60 * 1000; // 24 hours: escalate to operator
const CONFIDENCE_THRESHOLD = 0.7; // Below this, force category to needs_review

const ALLOWED_STATUSES = new Set([
  'new',
  'in_conversation',
  'awaiting_agent_info',
  'awaiting_agent',
  'awaiting_response',
  'warm',
  'HOT',
  'cold',
  'needs_review',
  'manual_handling',
]);

// Files in agents/ that are NOT real agents.
const AGENT_FILE_BLOCKLIST = new Set(['example.json', '.gitkeep']);
const AGENT_ID_REGEX = /^[a-z0-9-]+\.json$/;

// --------------------------------------------------------------------------
// Agent discovery
// --------------------------------------------------------------------------

// Finds all valid agent config files in agents/.
// If process.env.AGENT_ID is set, returns only that one (useful for debugging).
function discoverAgentIds() {
  if (process.env.AGENT_ID) {
    return [process.env.AGENT_ID];
  }
  const agentsDir = getStorageRoot();
  if (!fs.existsSync(agentsDir)) return [];
  return fs
    .readdirSync(agentsDir)
    .filter((f) => AGENT_ID_REGEX.test(f) && !AGENT_FILE_BLOCKLIST.has(f))
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

  // Lead Intake Tier 2: classify unstructured inbox emails before processing replies
  try {
    const intakeStats = await runLeadIntake(agent);
    console.log(
      `[${agentId}] Lead Intake: candidates=${intakeStats.candidates} leads=${intakeStats.leads} noise=${intakeStats.noise} businessCorrespondence=${intakeStats.businessCorrespondence} errors=${intakeStats.errors}`
    );
  } catch (err) {
    console.error(`[${agentId}] Lead Intake failed: ${err.message}`);
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

  const now = getNow();
  const stats = {
    valid: 0,
    invalid: 0,
    aiDisabled: 0,
    soiFiltered: 0,
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

    // Filter: SOI protection
    if (!isLeadCategoryActionable(row)) {
      stats.soiFiltered++;
      try {
        await email.appendToConversationHistory(agent, row.rowIndex, 'Skipped (SOI): leadCategory=soi');
      } catch (err) {
        console.log(`[${agentId}] row ${row.rowIndex} SOI skip log failed: ${err.message}`);
      }
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
    `[${agentId}] summary: valid=${stats.valid} invalid=${stats.invalid} aiDisabled=${stats.aiDisabled} soiFiltered=${stats.soiFiltered} rateLimited=${stats.rateLimited} processable=${stats.processable}`
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
      // Transition first-touch-pending -> intaken if applicable.
      // No-op for non-first-touch messages (Gmail tolerates removing absent labels).
      await transitionToIntaken(agent, msg.messageId);
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
// Step 4: stale Path 1B question handling
// --------------------------------------------------------------------------

// Sends an escalation email to the operator when a Path 1B question has been
// unanswered for over 24 hours.
async function sendOperatorEscalationEmail(agent, row) {
  const subject = `[agent-ai] Stale Path 1B question for ${row.name}`;
  const body = [
    `Heads up - this lead has had a pending property question for over 24 hours and the agent has not responded.`,
    '',
    `Lead: ${row.name} (${row.leadId}, ${row.phone || 'no phone on file'})`,
    `Agent: ${agent.agentName} (${agent.agentPhone})`,
    `Question: "${row.pendingQuestion}"`,
    `Question received: ${row.lastActionTimestamp}`,
    `Reminder SMS sent: ${row.reminderSent || 'no reminder fired'}`,
    '',
    'You may want to reach out to the agent directly.',
    '',
    '- agent-ai system',
  ].join('\n');
  await email.sendNewEmail(agent, {
    to: agent.escalationEmail,
    subject,
    body,
  });
}

// Scans all Sheet rows for 'awaiting_agent' leads whose lastActionTimestamp is
// stale. Two independent branches per row:
//   Branch A (2h):  send a reminder SMS to the agent if not yet sent.
//   Branch B (24h): escalate to the operator if not yet escalated.
// Both branches may fire for the same row in the same pass if it is old enough.
async function checkStaleQuestions(agent) {
  if (agent.isActive === false) {
    console.log(`[${agent.agentId}] stale check: skipped (inactive)`);
    return { skipped: 'inactive', remindersSent: 0, escalationsSent: 0, errors: [] };
  }
  const rows = await email.readSheetRows(agent);
  let remindersSent = 0;
  let escalationsSent = 0;
  const errors = [];

  for (const row of rows) {
    if (row.status !== 'awaiting_agent') continue;
    const last = new Date(row.lastActionTimestamp).getTime();
    if (Number.isNaN(last)) continue;
    const elapsed = getNow() - last;

    // Branch A: 2-hour reminder SMS
    if (elapsed >= STALE_REMINDER_MS && !row.reminderSent) {
      try {
        await twilio.sendSMS(agent, twilio.TEMPLATES.path1BReminder({ leadName: row.name }));
        const ts = getNowIso();
        await email.updateSheetRow(agent, row.rowIndex, { reminderSent: ts });
        await email.appendToConversationHistory(agent, row.rowIndex, `[${ts}] 2hr reminder SMS sent to agent`);
        remindersSent++;
      } catch (e) {
        errors.push({ rowIndex: row.rowIndex, branch: 'reminder', message: e.message });
        console.warn(`[${agent.agentId}] row ${row.rowIndex}: reminder failed: ${e.message}`);
      }
    }

    // Branch B: 24-hour operator escalation
    if (elapsed >= STALE_ESCALATION_MS && !row.operatorEscalated) {
      try {
        await sendOperatorEscalationEmail(agent, row);
        const ts = getNowIso();
        await email.updateSheetRow(agent, row.rowIndex, { operatorEscalated: ts });
        await email.appendToConversationHistory(agent, row.rowIndex, `[${ts}] 24hr escalation email sent to operator`);
        escalationsSent++;
      } catch (e) {
        errors.push({ rowIndex: row.rowIndex, branch: 'escalation', message: e.message });
        console.warn(`[${agent.agentId}] row ${row.rowIndex}: escalation failed: ${e.message}`);
      }
    }
  }

  return { remindersSent, escalationsSent, errors };
}

// --------------------------------------------------------------------------
// Daily digest
// --------------------------------------------------------------------------

async function maybeRunDailyDigest(agent, opts = {}) {
  try {
    const state = agentState.getState(agent.agentId);
    if (!opts.force && !shouldRunDailyDigest(agent, getNowDate(), state)) {
      console.log(`[${agent.agentId}] daily digest: not due`);
      return;
    }
    const result = await runDailyDigestForAgent(agent);
    if (result.skipped !== 'inactive' && (result.smsResult === 'sent' || result.emailResult === 'sent')) {
      agentState.recordDailyDigestRun(agent.agentId, getNowIso());
    }
    const smsLabel   = result.smsResult   || 'n/a';
    const emailLabel = result.emailResult || 'n/a';
    console.log(`[${agent.agentId}] daily digest: sms=${smsLabel} email=${emailLabel}`);
  } catch (err) {
    console.error(`[${agent.agentId}] daily digest failed: ${err.message}`);
  }
}

// --------------------------------------------------------------------------
// Angle generation (Sunday-gated, runs before the content engine)
// --------------------------------------------------------------------------

async function maybeRunAngleGeneration(agent, now = new Date()) {
  try {
    const enabled = await isContentEngineEnabled(agent.agentId);
    if (!enabled) {
      console.log(`[${agent.agentId}] angle generation: skipped (disabled)`);
      return;
    }
    const tz = agent.timezone || 'America/Toronto';
    const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(now);
    if (day !== 'Sunday') {
      console.log(`[${agent.agentId}] angle generation: skipped (not Sunday in ${tz})`);
      return;
    }
    const result = await generateWeeklyAngles({ now });
    console.log(`[${agent.agentId}] angles ${result.regenerated ? 'generated' : 'unchanged'} for ${result.weekIso}`);
  } catch (err) {
    console.error(`[${agent.agentId}] angle generation failed: ${err.message}`);
  }
}

// --------------------------------------------------------------------------
// Content engine
// --------------------------------------------------------------------------

async function maybeRunContentEngine(agent) {
  try {
    const enabled = await isContentEngineEnabled(agent.agentId);
    if (!enabled) {
      console.log(`[${agent.agentId}] content engine: skipped (disabled)`);
      return;
    }
  } catch (err) {
    console.error(`[${agent.agentId}] content engine: profile check failed: ${err.message}`);
    return;
  }

  try {
    const contentProfile = readContentProfile(agent.agentId);
    if (contentProfile === null) {
      console.log(`[${agent.agentId}] content engine: no profile, skipping`);
      return;
    }

    const contentState = readContentState(agent.agentId);
    const now = getNowDate();

    if (!shouldRunContentEngine(agent, contentProfile, now, contentState)) {
      console.log(`[${agent.agentId}] content engine: skipped (time gate)`);
      return;
    }

    if (!agent.operatorId) {
      console.error(`[${agent.agentId}] content engine: agent missing operatorId, skipping`);
      return;
    }
    let operatorConfig;
    try {
      operatorConfig = loadOperator(agent.operatorId);
    } catch (err) {
      console.error(`[${agent.agentId}] content engine error:`, err.message);
      const logPath = path.join(getStorageRoot(), '_operators', `${agent.operatorId}.config-errors.log`);
      try {
        fs.appendFileSync(logPath, `[${getNowIso()}] [${agent.agentId}] loadOperator failed: ${err.message}\n`);
      } catch (_) { /* best effort */ }
      return;
    }
    await runContentEngineForAgent(agent, { operatorConfig });
  } catch (err) {
    console.error(`[${agent.agentId}] content engine error:`, err.message);
  }
}

// --------------------------------------------------------------------------
// Upstream error observability
// --------------------------------------------------------------------------

function appendUpstreamErrorLog(stage, message) {
  try {
    const logPath = path.join(getStorageRoot(), '_market', '_errors.log');
    const dir = path.dirname(logPath);
    fs.mkdirSync(dir, { recursive: true });
    const line = `[${new Date().toISOString()}] [${stage}] ${message}\n`;
    fs.appendFileSync(logPath, line);
  } catch (logErr) {
    console.error(`[scheduler] upstream log append failed: ${logErr.message}`);
  }
}

// --------------------------------------------------------------------------
// Scheduled data pull (operator-scoped, every 6h in America/Toronto)
// --------------------------------------------------------------------------

async function maybeRunDataPull() {
  try {
    const opState = operatorState.getState('mo');
    const now = getNowDate();
    if (!shouldRunDataPull(now, opState)) return;
    console.log('[scheduler] data-pull: starting');
    const result = await pullBankOfCanada();
    if (result.success) {
      console.log(`[scheduler] data-pull: success metricsWritten=${result.metricsWritten.length}`);
      operatorState.setState('mo', { ...opState, lastDataPullAt: getNowIso() });
    } else {
      const errMsg = result.errors.length > 0
        ? result.errors.map(e => e.error).join('; ')
        : 'all metrics failed';
      appendUpstreamErrorLog('data-pull', `failed: ${errMsg}`);
      console.error(`[scheduler] data-pull: failed err=${errMsg}`);
    }
  } catch (err) {
    appendUpstreamErrorLog('data-pull', `exception: ${err.message}`);
    console.error(`[scheduler] data-pull: failed err=${err.message}`);
  }
}

// --------------------------------------------------------------------------
// Scheduled angle generation (operator-scoped, Sunday 04:00 America/Toronto)
// --------------------------------------------------------------------------

async function maybeRunWeeklyAngleGenerationJob() {
  try {
    const now = getNowDate();
    if (!shouldRunAngleGeneration(now)) return;
    const weekIso = currentWeek(now);
    const anglePath = path.join(getStorageRoot(), '_market', '_angles', `${weekIso}.json`);
    if (fs.existsSync(anglePath)) {
      console.log(`[scheduler] angle-gen: skipped (already exists for week ${weekIso})`);
      return;
    }
    console.log(`[scheduler] angle-gen: starting week=${weekIso}`);
    const result = await generateWeeklyAngles({ appendUpstreamErrorLog });
    const topScore = result.angles.length > 0
      ? Math.max(...result.angles.map(a => a.surpriseScore))
      : 0;
    console.log(`[scheduler] angle-gen: success week=${result.weekIso} angles=${result.angles.length} topScore=${topScore}`);
  } catch (err) {
    appendUpstreamErrorLog('angle-gen', `exception: ${err.message}`);
    console.error(`[scheduler] angle-gen: failed err=${err.message}`);
  }
}

// --------------------------------------------------------------------------
// Scheduled evergreen angle generation (operator-scoped, Sunday 04:00 America/Toronto)
// --------------------------------------------------------------------------

async function maybeRunWeeklyEvergreenAngleGenerationJob() {
  try {
    const now = getNowDate();
    if (!shouldRunAngleGeneration(now)) return;
    const weekIso = currentWeek(now);
    const evergreenPath = evergreenAnglesFilePath(getStorageRoot(), weekIso);
    if (fs.existsSync(evergreenPath)) {
      console.log(`[scheduler] evergreen-angle-gen: skipped (already exists for week ${weekIso})`);
      return;
    }
    console.log(`[scheduler] evergreen-angle-gen: starting week=${weekIso}`);
    const result = await generateEvergreenAngles({});
    console.log(`[scheduler] evergreen-angle-gen: success week=${result.weekIso} angles=${result.angles.length}`);
  } catch (err) {
    appendUpstreamErrorLog('evergreen-angle-gen', `exception: ${err.message}`);
    console.error(`[scheduler] evergreen-angle-gen: failed err=${err.message}`);
  }
}

// --------------------------------------------------------------------------
// Weekly digest (operator-scoped, runs once per cycle after all agents)
// --------------------------------------------------------------------------

async function maybeRunWeeklyDigest() {
  const operatorIds = discoverOperatorIds();
  for (const operatorId of operatorIds) {
    try {
      const operator = loadOperator(operatorId);
      const state    = operatorState.getState(operatorId);
      if (!shouldRunWeeklyDigest(operator, getNowDate(), state)) {
        console.log(`[operator:${operatorId}] weekly digest: not due`);
        continue;
      }
      const result = await runWeeklyDigestForOperator(operator);
      if (result.emailResult === 'sent') {
        operatorState.recordWeeklyDigestRun(operatorId, getNowIso());
      }
      console.log(`[operator:${operatorId}] weekly digest: email=${result.emailResult} agents=${result.activeAgentCount}`);
    } catch (err) {
      console.error(`[operator:${operatorId}] weekly digest failed: ${err.message}`);
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

  const { orphans: mappingOrphans } = validateAgentOperatorMappings();
  for (const { agentId, operatorId } of mappingOrphans) {
    console.warn(`[startup] agent ${agentId} references missing operator config: operatorId=${operatorId}`);
  }

  const allAgentConfigs = [];
  for (const id of agentIds) {
    try {
      // Guard: skip agents with no Google authorization before any processing
      let guardCfg;
      try { guardCfg = loadAgent(id); } catch (_) { /* loadAgent errors handled inside processAgent */ }
      if (guardCfg && !guardCfg.googleRefreshToken) {
        console.log(`[${id}] skipped: no Google authorization (refreshToken empty)`);
        continue;
      }

      const hasSheet = guardCfg && typeof guardCfg.googleSheetId === 'string' && guardCfg.googleSheetId.trim() !== '';

      if (hasSheet) {
        await processAgent(id);
      }
      const agent = loadAgent(id);
      allAgentConfigs.push(agent);

      if (!hasSheet) {
        console.log(`[${id}] skipped Sheet-dependent processing: no googleSheetId`);
        continue;
      }

      const staleResult = await checkStaleQuestions(agent);
      console.log(`[${id}] stale check: reminders=${staleResult.remindersSent} escalations=${staleResult.escalationsSent} errors=${staleResult.errors.length}`);
      try {
        const followUpResult = await followUp.runFollowUps(agent);
        console.log(`[${id}] follow-ups: eligible=${followUpResult.eligible} fired=${followUpResult.fired} threadingSkipped=${followUpResult.threadingMismatchSkipped} errors=${followUpResult.errors}`);
      } catch (fuErr) {
        console.error(`[${id}] follow-up run failed: ${fuErr.message}`);
      }
      await maybeRunDailyDigest(agent);
      await maybeRunAngleGeneration(agent);
      await maybeRunContentEngine(agent);
    } catch (err) {
      // One agent's failure must not stop others.
      console.error(`[${id}] uncaught error: ${err.message}`);
      if (err.stack) console.error(err.stack);
    }
  }

  try {
    const { runActionHandler } = require('./content/actionHandler');
    await runActionHandler(allAgentConfigs);
  } catch (err) {
    console.error(`[actionHandler] unhandled error: ${err.message}`);
  }

  await maybeRunDataPull();
  await maybeRunWeeklyAngleGenerationJob();
  await maybeRunWeeklyEvergreenAngleGenerationJob();
  await maybeRunWeeklyDigest();

  console.log('\nOrchestrator cycle complete.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Orchestrator crashed:', err);
    process.exit(1);
  });
}

module.exports = { processAgent, checkStaleQuestions, maybeRunAngleGeneration, maybeRunContentEngine, maybeRunDailyDigest, maybeRunDataPull, maybeRunWeeklyAngleGenerationJob, maybeRunWeeklyEvergreenAngleGenerationJob, appendUpstreamErrorLog, runCycle: main, discoverAgentIds, AGENT_ID_REGEX };
