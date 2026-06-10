// src/digest.js
//
// Daily Digest module. Two entry points, one module: per-agent daily brief
// and operator weekly digest. Shares data-gathering helpers across both.
//
// See DAILY_DIGEST_SPEC.md for the authoritative design. Build order in
// spec section 9. This file is build step 3 (skeleton); subsequent steps
// fill in implementations:
//   - Step 4: renderers (renderSMS, renderEmail, renderWeeklyEmail) + tests
//   - Step 5: gatherWindowData + categorizeRowsForDigest + tests
//   - Step 6: scheduler integration in src/index.js
//   - Step 7: failure handling + retry wrapping the sends
//   - Step 8: pollSentFolderForDraftResolution
//   - Step 9: integration test under MOCK_NOW
//   - Step 10: dry-run mode live verification

const fs   = require('fs');
const path = require('path');

const email = require('./email');
const gmail = require('./gmail');
const agentState = require('./agentState');
const twilio = require('./twilio');
const { getFollowUpCadence, loadAgent } = require('./agentConfig');
const { getNowIso, getNowDate } = require('./time');
const { checkAllSourcesFreshness } = require('./content/sources');

// ── Renderer helpers ──────────────────────────────────────────────────────────

function urgentVerbPhrase(category) {
  const map = {
    HOT: 'wants to call you today',
    path1b: 'is waiting on you',
    needs_review: 'needs review',
    operatorEscalated: 'escalated to you',
  };
  return map[category] || 'needs you';
}

// Short context with surrounding parens, for SMS line 2.
function urgentShortContext(urgent) {
  if (urgent.category === 'HOT') {
    return urgent.propertyReference ? `(${urgent.propertyReference})` : '(HOT signal)';
  }
  if (urgent.category === 'path1b') {
    return `(Path 1B ${Math.floor(urgent.hoursAwaiting)}h)`;
  }
  if (urgent.category === 'needs_review') {
    return urgent.propertyReference ? `(${urgent.propertyReference})` : '(needs review)';
  }
  if (urgent.category === 'operatorEscalated') {
    return urgent.propertyReference ? `(${urgent.propertyReference})` : '(escalated)';
  }
  return '';
}

// Raw context without parens, for email row rendering.
function urgentDisplayContext(urgent) {
  if (urgent.category === 'HOT') {
    return urgent.propertyReference || 'HOT signal';
  }
  if (urgent.category === 'path1b') {
    return `Path 1B ${Math.floor(urgent.hoursAwaiting)}h`;
  }
  if (urgent.category === 'needs_review') {
    return urgent.propertyReference || 'needs review';
  }
  if (urgent.category === 'operatorEscalated') {
    return urgent.propertyReference || 'escalated';
  }
  return '';
}

function sheetLink(googleSheetId, rowIndex) {
  return `https://docs.google.com/spreadsheets/d/${googleSheetId}/edit#gid=0&range=A${rowIndex}`;
}

/**
 * Pure function. Builds the primary action link for a digest row, implementing
 * the per-category preferred-link + fallback chain (Decision 1, HTML email spec):
 *
 *   HOT            tel:${phone}          → Gmail thread  → Sheet row
 *   needs_review   Gmail thread          → Sheet row
 *   operatorEscalated  Sheet row         (no fallback)
 *   path1b         Gmail thread          → Sheet row
 *
 * @param {object} rowData  digest row — must carry category, phone, gmailThreadId, rowIndex
 * @param {object} agentConfig  must carry googleSheetId for sheet links
 * @returns {{ label: string, url: string, isFallback: boolean } | null}
 *   Returns null only when no link is constructable (missing all three data points).
 *   isFallback=false means the preferred link for the category was used.
 *   isFallback=true  means a fallback link was substituted.
 */
function buildActionLink(rowData, agentConfig) {
  const category  = rowData.category || 'HOT';
  const firstName = rowData.firstName || '';
  const gid       = agentConfig && agentConfig.googleSheetId;

  // Normalise phone: strip all non-digit characters except a leading '+'
  const rawPhone = String(rowData.phone || '');
  const normalised = rawPhone.startsWith('+')
    ? '+' + rawPhone.slice(1).replace(/\D/g, '')
    : rawPhone.replace(/\D/g, '');
  const hasPhone = normalised.length > 0;

  const rawThread = rowData.gmailThreadId || '';
  const hasThread = rawThread.length > 0;
  const threadUrl = hasThread
    ? `https://mail.google.com/mail/u/0/#inbox/${rawThread}`
    : null;

  const hasSheet = !!(gid && rowData.rowIndex != null);
  const sheetUrl = hasSheet ? sheetLink(gid, rowData.rowIndex) : null;

  if (category === 'HOT') {
    if (hasPhone)  return { label: `Call ${firstName}`, url: `tel:${normalised}`, isFallback: false };
    if (hasThread) return { label: 'Open thread',       url: threadUrl,           isFallback: true };
    if (hasSheet)  return { label: 'Open row',          url: sheetUrl,            isFallback: true };
    return null;
  }

  if (category === 'needs_review' || category === 'path1b') {
    if (hasThread) return { label: 'Open thread', url: threadUrl, isFallback: false };
    if (hasSheet)  return { label: 'Open row',    url: sheetUrl,  isFallback: true };
    return null;
  }

  if (category === 'operatorEscalated') {
    if (hasSheet) return { label: 'Open row', url: sheetUrl, isFallback: false };
    return null;
  }

  return null;
}

function formatDailyDate(now, timezone) {
  const tz = timezone || 'America/Toronto';
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz }).format(now);
  const month = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: tz }).format(now);
  const day = new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: tz }).format(now);
  return `${weekday}, ${month} ${day}`;
}

function formatWeeklyDate(isoStr, timezone) {
  const tz = timezone || 'America/Toronto';
  const date = new Date(isoStr);
  const month = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: tz }).format(date);
  const day = new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: tz }).format(date);
  return `${month} ${day}`;
}

function buildOpenerLine(systemHandled, hasUrgent, urgentCount = 0) {
  const intaken = systemHandled.intaken || 0;
  const followUpsFired = systemHandled.followUpsFired || 0;
  const noiseFiltered = systemHandled.noiseFiltered || 0;
  const total = intaken + followUpsFired + noiseFiltered;
  if (total === 0 && hasUrgent) {
    const noun = urgentCount === 1 ? 'lead' : 'leads';
    const verb = urgentCount === 1 ? 'needs' : 'need';
    return `${urgentCount} ${noun} ${verb} you this morning.`;
  }
  const base = `Handled ${total} leads overnight: ${intaken} new, ${followUpsFired} follow-ups, ${noiseFiltered} filtered.`;
  return hasUrgent ? base : `${base} 0 need you today.`;
}

// Churn threshold description rendered at the bottom of every churn section.
const CHURN_CRITERIA = 'Criteria: needs_review unanswered >48h (High), no Sheet interaction >14d (High), pre-flight skips +50% WoW (Medium), aiEnabled toggled ≥3 rows (Medium), CALLED >5x (Low).';

// Renderer-owned label map for weekly aggregate section. Key order = render order.
// Absent keys are skipped (fields not yet computable are simply omitted from the object).
const WEEKLY_AGGREGATE_LABELS = {
  totalLeadsHandled:   'Leads handled',
  totalTouchesFired:   'Touches fired',
  totalFiltered:       'Filtered',
  totalEscalations:    'Escalations',
  totalPath1bRoundtrips: 'Path 1B round-trips completed',
  totalPreflightSkips: 'Pre-flight skips (agents doing it manually)',
};

// Renderer-owned label map for Path B systemHandled section. Key order = render order.
// Only keys present in the data object will produce a line (absent keys are silently skipped).
const SYSTEM_HANDLED_LABELS = {
  intaken: 'Leads intaken',
  followUpsFired: 'Follow-ups fired',
  preflightSkips: 'Pre-flight skips this week',
  soiFiltered: 'SOI rows excluded',
};

// Design tokens for HTML email rendering (Decision 4). All visual choices live
// here. Branding update = change tokens, nothing else.
const STYLE_TOKENS = {
  buttonBackground:   '#1a1a1a',
  buttonTextColor:    '#ffffff',
  buttonBorderRadius: '6px',
  buttonPadding:      '12px 20px',
  buttonFontWeight:   '600',
  containerMaxWidth:  '560px',
  containerPadding:   '24px',
  fontStack:          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  bodyTextColor:      '#1a1a1a',
  mutedTextColor:     '#666666',
  sectionDividerColor: '#e0e0e0',
  bodyBackground:     '#ffffff',
  fontSize:           '16px',
  lineHeight:         '1.5',
};

// ── Categorization helpers ────────────────────────────────────────────────────

function parseISO(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function hoursBetween(later, earlier) {
  return Math.floor((later.getTime() - earlier.getTime()) / (1000 * 60 * 60));
}

function daysBetween(later, earlier) {
  return Math.floor((later.getTime() - earlier.getTime()) / (1000 * 60 * 60 * 24));
}

function isFalseFlag(value) {
  return String(value == null ? '' : value).trim().toUpperCase() === 'FALSE';
}

// ── Column L parsing helpers ──────────────────────────────────────────────────

// Returns the Date of the timestamp on the first column L line, or null.
function parseColumnLFirstLineTimestamp(conversationHistory) {
  if (!conversationHistory || !String(conversationHistory).trim()) return null;
  const firstLine = String(conversationHistory).split('\n')[0];
  const m = firstLine.match(/^\[([^\]]+)\]/);
  if (!m) return null;
  return parseISO(m[1]);
}

// Returns the trimmed property reference from the first column L line, or null.
function parseColumnLPropertyReference(conversationHistory) {
  if (!conversationHistory) return null;
  const firstLine = String(conversationHistory).split('\n')[0];
  const m = firstLine.match(/Heuristic intake \(([^)]+)\):/);
  if (!m) return null;
  const segments = m[1].split(', ');
  const seg = segments.find(s => s.startsWith('property: '));
  if (!seg) return null;
  const val = seg.slice('property: '.length).trim();
  return val || null;
}

// Returns the most recent in-window follow-up fire, or null.
function findInWindowFollowUpFire(conversationHistory, startMs, endMs, mode) {
  if (!conversationHistory) return null;
  const lines = String(conversationHistory).split('\n');
  const candidates = [];
  for (const line of lines) {
    const m = line.match(/^\[([^\]]+)\] Follow-up Day (\d+) sent/);
    if (!m) continue;
    const ts = parseISO(m[1]);
    if (!ts) continue;
    const t = ts.getTime();
    if (t >= startMs && t <= endMs) {
      candidates.push({ timestamp: m[1], touchDay: parseInt(m[2], 10), t });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.t - a.t);
  return { timestamp: candidates[0].timestamp, touchDay: candidates[0].touchDay, mode };
}

// ── Row annotation helpers ────────────────────────────────────────────────────

function splitName(rawName) {
  if (!rawName) return { firstName: '', lastInitial: '' };
  const trimmed = String(rawName).trim();
  if (!trimmed) return { firstName: '', lastInitial: '' };
  const tokens = trimmed.split(/\s+/).filter(t => t.length > 0);
  if (tokens.length === 0) return { firstName: '', lastInitial: '' };
  if (tokens.length === 1) return { firstName: tokens[0], lastInitial: '' };
  return { firstName: tokens[0], lastInitial: tokens[tokens.length - 1].charAt(0).toUpperCase() };
}

function computeNextTouch(row, cadence) {
  if (row.status !== 'awaiting_response') return { nextTouchEligibleAt: null, nextTouchDay: null };
  const touchIndex = parseInt(String(row.followUpCount || '0'), 10);
  if (Number.isNaN(touchIndex) || touchIndex < 0) return { nextTouchEligibleAt: null, nextTouchDay: null };
  if (touchIndex >= cadence.length) return { nextTouchEligibleAt: null, nextTouchDay: null };
  const nextTouchDay = cadence[touchIndex];
  const refTimestamp = row.lastFollowUpDate || row.lastActionTimestamp;
  if (!refTimestamp) return { nextTouchEligibleAt: null, nextTouchDay: null };
  const refDate = parseISO(refTimestamp);
  if (!refDate) return { nextTouchEligibleAt: null, nextTouchDay: null };
  const eligibleMs = refDate.getTime() + nextTouchDay * 24 * 60 * 60 * 1000;
  return { nextTouchEligibleAt: new Date(eligibleMs).toISOString(), nextTouchDay };
}

function annotateRow(row, cadence, mode, startMs, endMs) {
  const { firstName, lastInitial } = splitName(row.name);
  const propertyReference = parseColumnLPropertyReference(row.conversationHistory);

  let createdAt = parseColumnLFirstLineTimestamp(row.conversationHistory);
  if (!createdAt && row.dateAdded) {
    const m = String(row.dateAdded).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const d = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
      if (Number.isFinite(d.getTime())) createdAt = d;
    }
  }
  const createdInWindow = createdAt !== null
    && createdAt !== undefined
    && createdAt.getTime() >= startMs
    && createdAt.getTime() <= endMs;

  const { nextTouchEligibleAt, nextTouchDay } = computeNextTouch(row, cadence);
  const lastFollowUpFire = findInWindowFollowUpFire(row.conversationHistory, startMs, endMs, mode);

  return {
    ...row,
    firstName,
    lastInitial,
    propertyReference,
    createdInWindow,
    nextTouchEligibleAt,
    nextTouchDay,
    lastFollowUpFire,
  };
}

// ── Send helpers (retry + error log) ─────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function _sendWithRetry(sendFn, label) {
  const delays = [10000, 60000];
  let attempts = 0;
  let lastError = null;
  for (let i = 0; i <= delays.length; i++) {
    attempts++;
    try {
      await sendFn();
      return { ok: true, attempts, lastError: null };
    } catch (err) {
      lastError = err;
      if (i < delays.length) {
        console.log(`[digest:${label}] attempt ${attempts} failed: ${err.message}, retrying in ${delays[i]}ms`);
        await sleep(delays[i]);
      }
    }
  }
  console.log(`[digest:${label}] exhausted after 3 attempts. last error: ${lastError.message}`);
  return { ok: false, attempts: 3, lastError };
}

function _appendDigestErrorLog(filepath, label, error) {
  try {
    const line = `[${getNowIso()}] ${label} exhausted: ${error.message}\n`;
    fs.appendFileSync(filepath, line, 'utf8');
  } catch (err) {
    console.log(`[digest] failed to append to ${filepath}: ${err.message}`);
  }
}

// ── Entry points ──────────────────────────────────────────────────────────────

/**
 * Entry point: per-agent daily brief.
 * Computes the trailing-24h coverage window from getNow() (per spec section 7.5,
 * MOCK_NOW is the canonical time-injection primitive — entry points compute their
 * own windows rather than accepting them, so there is one source of truth for
 * "what time is it"). Gathers window data, categorizes rows, renders SMS + email,
 * sends both via agent's Gmail OAuth + Twilio. See spec sections 3, 4, 7.1, 7.2.
 *
 * @param {object} agentConfig
 * @returns {Promise<{smsSent: boolean, emailSent: boolean, sections: object}>}
 */
async function runDailyDigestForAgent(agentConfig, options = {}) {
  const dryRun = options.dryRun === true;

  if (agentConfig.isActive === false) {
    console.log(`[${agentConfig.agentId}] daily digest: skipped (inactive)`);
    return { skipped: 'inactive' };
  }

  const endIso   = getNowIso();
  const endMs    = new Date(endIso).getTime();
  const startIso = new Date(endMs - 24 * 60 * 60 * 1000).toISOString();

  const gathered = await gatherWindowData(agentConfig, startIso, endIso);
  const { rows, stateCounters, reliability } = gathered;

  const now        = getNowDate();
  const categories = categorizeRowsForDigest(rows, now);

  const systemHandled = stateCounters.systemHandled;
  const sections = {
    ...categories,
    systemHandled,
    reliability,
  };

  const topUrgent = categories.urgent.length > 0 ? categories.urgent[0] : null;
  const smsStats  = {
    intaken:       systemHandled.intaken       || 0,
    followUpsFired: systemHandled.followUpsFired || 0,
    noiseFiltered: systemHandled.noiseFiltered  || 0,
    urgentCount:   categories.urgent.length,
  };

  const smsBody         = renderSMS(smsStats, topUrgent);
  const { subject, body: emailBody } = renderEmail(sections, agentConfig, now);
  const { html: emailHtml } = renderEmailHtml(sections, agentConfig, now);

  const errors = [];
  let smsResult;
  let emailResult;

  // digestSmsEnabled: absent/null/'' treated as true (mirrors isAiEnabled absent-as-true)
  const rawSmsFlag = agentConfig.digestSmsEnabled;
  const smsEnabled = (rawSmsFlag === undefined || rawSmsFlag === null || rawSmsFlag === '')
    ? true
    : (typeof rawSmsFlag === 'boolean' ? rawSmsFlag : String(rawSmsFlag).trim().toLowerCase() !== 'false');

  // SMS send
  if (!smsEnabled) {
    smsResult = 'skipped';
  } else if (dryRun && !agentConfig.operatorPhone) {
    console.log(`[${agentConfig.agentId}] daily digest dry-run: no operatorPhone, skipping SMS`);
    smsResult = 'skipped';
  } else {
    const smsTarget = dryRun
      ? { ...agentConfig, agentPhone: agentConfig.operatorPhone }
      : agentConfig;
    const smsRetry = await _sendWithRetry(() => twilio.sendSMS(smsTarget, smsBody), 'daily-sms');
    if (smsRetry.ok) {
      smsResult = 'sent';
    } else {
      smsResult = 'failed';
      errors.push({ channel: 'sms', message: smsRetry.lastError.message });
      _appendDigestErrorLog(
        path.join(__dirname, '..', 'agents', `${agentConfig.agentId}.digest-errors.log`),
        'daily-sms',
        smsRetry.lastError
      );
    }
  }

  // Email send (always attempts regardless of SMS outcome)
  let emailTo;
  if (dryRun) {
    emailTo = agentConfig.escalationEmail || null;
    if (!emailTo) {
      console.log(`[${agentConfig.agentId}] daily digest dry-run: no escalationEmail, skipping email`);
    }
  } else {
    emailTo = agentConfig.agentEmail || agentConfig.gmailAddress || null;
  }

  if (!emailTo) {
    emailResult = 'failed';
    errors.push({ channel: 'email', message: 'no recipient address' });
  } else {
    const emailRetry = await _sendWithRetry(
      () => email.sendNewEmail(agentConfig, { to: emailTo, subject, body: emailBody, html: emailHtml }),
      'daily-email'
    );
    if (emailRetry.ok) {
      emailResult = 'sent';
    } else {
      emailResult = 'failed';
      errors.push({ channel: 'email', message: emailRetry.lastError.message });
      _appendDigestErrorLog(
        path.join(__dirname, '..', 'agents', `${agentConfig.agentId}.digest-errors.log`),
        'daily-email',
        emailRetry.lastError
      );
    }
  }

  return { smsResult, emailResult, errors };
}

/**
 * Entry point: operator weekly digest.
 * Computes the trailing-7d coverage window from getNow(). Aggregates across all
 * supplied agentConfigs. Sends a single email to operatorConfig.email via the
 * operator's own Gmail OAuth. Includes Shadow Mode catch detection via
 * pollSentFolderForDraftResolution. See spec section 5.
 *
 * @param {object} operatorConfig
 * @param {object[]} agentConfigs
 * @returns {Promise<{emailSent: boolean, sections: object}>}
 */
async function runWeeklyDigestForOperator(operatorConfig, options = {}) {
  const dryRun = options.dryRun === true;
  const _pollFn = (typeof options.pollFn === 'function') ? options.pollFn : pollSentFolderForDraftResolution;

  const endIso = getNowIso();
  const endMs  = new Date(endIso).getTime();
  const MS_7D  = 7 * 24 * 60 * 60 * 1000;
  const startIso = new Date(endMs - MS_7D).toISOString();
  const startMs  = new Date(startIso).getTime();

  // Discover all agent IDs (mirrors discoverAgentIds in src/index.js; not imported to avoid circular)
  const AGENT_BLOCKLIST = new Set(['example.json', '.gitkeep']);
  const agentsDir = path.join(__dirname, '..', 'agents');
  let allAgentIds = [];
  if (fs.existsSync(agentsDir)) {
    allAgentIds = fs.readdirSync(agentsDir)
      .filter(f => f.endsWith('.json') && !AGENT_BLOCKLIST.has(f))
      .map(f => f.replace(/\.json$/, ''))
      .sort();
  }

  // Load active agents
  const activeAgents = [];
  for (const agentId of allAgentIds) {
    let cfg;
    try {
      cfg = loadAgent(agentId);
    } catch (err) {
      console.warn(`[operator:${operatorConfig.operatorId}] skipping ${agentId}: ${err.message}`);
      continue;
    }
    if (cfg.isActive !== true) continue;
    activeAgents.push(cfg);
  }

  // Gather window data for each active agent
  const gatheredByAgent = {};
  for (const agentCfg of activeAgents) {
    try {
      gatheredByAgent[agentCfg.agentId] = await gatherWindowData(agentCfg, startIso, endIso);
    } catch (err) {
      console.error(`[operator:${operatorConfig.operatorId}] gather failed for ${agentCfg.agentId}: ${err.message}`);
    }
  }

  // Aggregate totals across active agents
  let totalLeadsHandled  = 0;
  let totalTouchesFired  = 0;
  let totalFiltered      = 0;
  let totalPreflightSkips = 0;

  for (const agentCfg of activeAgents) {
    const gathered = gatheredByAgent[agentCfg.agentId];
    if (!gathered) continue;
    const sh = gathered.stateCounters.systemHandled;
    totalLeadsHandled  += sh.intaken        || 0;
    totalTouchesFired  += (sh.intaken || 0) + (sh.followUpsFired || 0);
    totalFiltered      += sh.noiseFiltered  || 0;
    totalPreflightSkips += sh.preflightSkips || 0;
  }

  // Only include fields that have real data; omit unavailable ones (avgResponseTime, warmToTour, etc.)
  const aggregate = {
    totalLeadsHandled,
    totalTouchesFired,
    totalFiltered,
    totalPreflightSkips,
  };

  // Per-agent summaries
  const nowDate = getNowDate();
  const perAgent = activeAgents.map(agentCfg => {
    const gathered = gatheredByAgent[agentCfg.agentId];
    const sh = gathered ? gathered.stateCounters.systemHandled : {};
    const cats = gathered ? categorizeRowsForDigest(gathered.rows, nowDate) : { urgent: [] };
    return {
      agentId: agentCfg.agentId,
      agentName: agentCfg.agentName || agentCfg.agentId,
      intaken:            sh.intaken        || 0,
      followUpsFired:     sh.followUpsFired  || 0,
      noiseFiltered:      sh.noiseFiltered   || 0,
      urgentCount:        cats.urgent.length,
      weeklyPreflightSkips: sh.preflightSkips || 0,
    };
  });

  // Churn risk: compute what we can from available data
  const MS_48H = 48 * 60 * 60 * 1000;
  const churnRisk = [];
  for (const agentCfg of activeAgents) {
    const gathered = gatheredByAgent[agentCfg.agentId];
    if (!gathered) continue;
    const reasons = [];
    for (const row of gathered.rows) {
      if (row.status === 'needs_review' && row.lastActionTimestamp) {
        if (nowDate.getTime() - new Date(row.lastActionTimestamp).getTime() > MS_48H) {
          reasons.push('needs_review unanswered >48h');
          break;
        }
      }
    }
    if (reasons.length > 0) {
      churnRisk.push({
        agentId: agentCfg.agentId,
        agentName: agentCfg.agentName || agentCfg.agentId,
        reasons,
      });
    }
  }

  // Recently deactivated agents (scan all discovered, not just active)
  const recentlyDeactivated = [];
  for (const agentId of allAgentIds) {
    let stateObj;
    try {
      stateObj = agentState.getState(agentId);
    } catch {
      continue;
    }
    if (!stateObj.deactivatedAt) continue;
    const deactivatedMs = new Date(stateObj.deactivatedAt).getTime();
    if (deactivatedMs >= startMs && deactivatedMs <= endMs) {
      let agentName = agentId;
      try {
        const cfg = loadAgent(agentId);
        agentName = cfg.agentName || agentId;
      } catch {
        // fallback to agentId
      }
      recentlyDeactivated.push({ agentId, agentName, deactivatedAt: stateObj.deactivatedAt });
    }
  }

  // Shadow Mode catch detection (one agent at a time, 30s timeout per agent)
  const shadowCatches = { sentAsIs: 0, editedThenSent: 0, rejected: 0 };
  let shadowAgentsCovered = 0;
  let shadowAgentsTimedOut = 0;

  for (const agentCfg of activeAgents) {
    const result = await _pollFn(agentCfg, startIso, endIso);
    if (result === null) {
      shadowAgentsTimedOut++;
      continue;
    }
    shadowAgentsCovered++;
    shadowCatches.sentAsIs      += result.sentAsIs;
    shadowCatches.editedThenSent += result.editedThenSent;
    shadowCatches.rejected       += result.rejected;
  }

  let dataFreshness;
  try {
    dataFreshness = await checkAllSourcesFreshness(nowDate);
  } catch (err) {
    dataFreshness = [{
      sourceKey: '_check_error',
      name: 'Data freshness check',
      status: 'check_failed',
      checkError: err.message,
    }];
  }

  const weeklySections = {
    windowStart: startIso,
    windowEnd:   endIso,
    aggregate,
    perAgent,
    churnRisk,
    recentlyDeactivated,
    shadowCatches,
    shadowAgentsCovered,
    shadowAgentsTimedOut,
    dataFreshness,
  };

  const { subject, body } = renderWeeklyEmail(weeklySections, operatorConfig, nowDate);
  const { html: weeklyHtml } = renderWeeklyEmailHtml(weeklySections, operatorConfig, nowDate);

  const errors = [];
  let emailResult;

  const emailTo = dryRun
    ? (operatorConfig.dryRunEmail || operatorConfig.operatorEmail)
    : operatorConfig.operatorEmail;

  const emailRetry = await _sendWithRetry(
    () => email.sendNewEmail(operatorConfig, { to: emailTo, subject, body, html: weeklyHtml }),
    'weekly-email'
  );
  if (emailRetry.ok) {
    emailResult = 'sent';
    // Reset preflight skips for each active agent after successful send
    for (const agentCfg of activeAgents) {
      try {
        agentState.resetWeeklyPreflightSkips(agentCfg.agentId);
      } catch (err) {
        console.warn(`[operator:${operatorConfig.operatorId}] preflight reset failed for ${agentCfg.agentId}: ${err.message}`);
      }
    }
  } else {
    emailResult = 'failed';
    errors.push({ channel: 'email', message: emailRetry.lastError.message });
    _appendDigestErrorLog(
      path.join(__dirname, '..', 'operators', `${operatorConfig.operatorId}.digest-errors.log`),
      'weekly-email',
      emailRetry.lastError
    );
    const operatorPhone = operatorConfig.operatorPhone;
    if (!operatorPhone) {
      console.log('[digest:weekly-email] no operatorPhone configured, skipping SMS fallback');
    } else {
      const fallbackBody = `Weekly digest email to ${operatorConfig.operatorEmail} failed after retries. Check operators/${operatorConfig.operatorId}.digest-errors.log`;
      const operatorTwilioShim = { agentId: `operator:${operatorConfig.operatorId}`, agentPhone: operatorPhone };
      try {
        await twilio.sendSMS(operatorTwilioShim, fallbackBody);
      } catch (err) {
        console.log(`[digest:weekly-email] operator SMS fallback failed: ${err.message}`);
      }
    }
  }

  return { emailResult, activeAgentCount: activeAgents.length, errors };
}

/**
 * Pulls Sheet rows from a single agent that were created or touched within the
 * window. Filtering is by lastActionTimestamp, row creation timestamp (column L
 * first entry), and status-change events. Also pulls counters from agent state
 * (weeklyPreflightSkips) and structured logs (reliability counts). See spec 7.4.
 *
 * @param {object} agentConfig
 * @param {string} startIso  inclusive lower bound
 * @param {string} endIso    exclusive upper bound
 * @returns {Promise<{rows: object[], stateCounters: object, reliability: object}>}
 */
async function gatherWindowData(agentConfig, startIso, endIso) {
  const rawRows = await email.readSheetRows(agentConfig);
  const cadence = getFollowUpCadence(agentConfig);
  const mode = agentConfig.mode || 'live';
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  const soiCount = rawRows.filter(r => String(r.leadCategory || '').trim().toLowerCase() === 'soi').length;
  const actionable = rawRows.filter(r => String(r.leadCategory || '').trim().toLowerCase() !== 'soi');
  const rows = actionable.map(row => annotateRow(row, cadence, mode, startMs, endMs));
  const state = agentState.getState(agentConfig.agentId);
  const preflightSkips = state.weeklyPreflightSkips || 0;
  const intaken = rows.filter(r => r.createdInWindow === true).length;
  const followUpsFired = rows.filter(r => r.lastFollowUpFire !== null).length;
  const systemHandled = { intaken, followUpsFired, preflightSkips };
  if (soiCount > 0) systemHandled.soiFiltered = soiCount;
  return {
    rows,
    stateCounters: { systemHandled },
    reliability: { errors: 0, retries: 0, threadingSkipped: 0 },
  };
}

/**
 * Pure function. Takes annotated rows from gatherWindowData and bucketizes them
 * into the sections renderers consume. A row may appear in multiple sections
 * (e.g. a HOT lead is in both urgent and hotLeads). systemHandled and
 * reliability counters are composed at the entry-point layer from
 * gatherWindowData's stateCounters/reliability output, not here.
 * See spec 4.1 (daily section list) and 3.4 (urgent definition).
 *
 * Annotated row shape (produced by gatherWindowData, step 5a):
 *   firstName: string, lastInitial: string,
 *   propertyReference: string|null,
 *   createdInWindow: boolean,          // true if the row's first column L entry timestamp falls within [endIso-24h, endIso]; set by gatherWindowData
 *   nextTouchEligibleAt: string|null,  nextTouchDay: number|null,
 *   lastFollowUpFire: {touchDay, timestamp, mode}|null
 *
 * @param {object[]} rows  annotated rows from gatherWindowData
 * @param {Date} now
 * @returns {{
 *   urgent: object[],
 *   hotLeads: object[],
 *   newToReview: object[],
 *   followUpsDue: object[],
 *   followUpsFiredOvernight: object[],
 * }}
 */
function categorizeRowsForDigest(rows, now) {
  const MS_24H = 24 * 60 * 60 * 1000;
  const MS_7D  = 7 * 24 * 60 * 60 * 1000;

  const urgent = [];
  const hotLeads = [];
  const newToReview = [];
  const followUpsDue = [];
  const followUpsFiredOvernight = [];

  // Priority order for category collision: HOT > needs_review > operatorEscalated > path1b
  const PRIORITY = { HOT: 3, needs_review: 2, operatorEscalated: 1, path1b: 0 };

  for (const row of rows) {
    const lastActionDate = parseISO(row.lastActionTimestamp);

    // ── urgent ────────────────────────────────────────────────────────────────
    let urgentCategory = null;
    let urgentTrigger = null;

    if (row.status === 'HOT') {
      urgentCategory = 'HOT';
      urgentTrigger = row.lastActionTimestamp;
    }

    if (row.status === 'needs_review') {
      const p = PRIORITY.needs_review;
      if (urgentCategory === null || p > PRIORITY[urgentCategory]) {
        urgentCategory = 'needs_review';
        urgentTrigger = row.lastActionTimestamp;
      }
    }

    {
      const opDate = parseISO(row.operatorEscalated);
      if (opDate && (now.getTime() - opDate.getTime()) <= MS_7D) {
        const p = PRIORITY.operatorEscalated;
        if (urgentCategory === null || p > PRIORITY[urgentCategory]) {
          urgentCategory = 'operatorEscalated';
          urgentTrigger = row.operatorEscalated;
        }
      }
    }

    if (row.status === 'awaiting_agent' && lastActionDate) {
      if (now.getTime() - lastActionDate.getTime() > MS_24H) {
        const p = PRIORITY.path1b;
        if (urgentCategory === null || p > PRIORITY[urgentCategory]) {
          urgentCategory = 'path1b';
          urgentTrigger = row.lastActionTimestamp;
        }
      }
    }

    if (urgentCategory !== null) {
      urgent.push({
        firstName: row.firstName,
        lastInitial: row.lastInitial,
        category: urgentCategory,
        propertyReference: row.propertyReference || null,
        hoursAwaiting: urgentCategory === 'path1b' && lastActionDate
          ? hoursBetween(now, lastActionDate)
          : null,
        rowIndex: row.rowIndex,
        phone: row.phone || null,
        gmailThreadId: row.gmailThreadId || null,
        leadId: row.leadId || null,
        _triggerTimestamp: urgentTrigger,
      });
    }

    // ── hotLeads ──────────────────────────────────────────────────────────────
    if (row.status === 'HOT') {
      hotLeads.push({
        firstName: row.firstName,
        lastInitial: row.lastInitial,
        propertyReference: row.propertyReference || null,
        daysAgo: lastActionDate ? daysBetween(now, lastActionDate) : 0,
        whyHot: '',
        rowIndex: row.rowIndex,
        phone: row.phone || null,
        gmailThreadId: row.gmailThreadId || null,
        leadId: row.leadId || null,
        _lastActionTimestamp: row.lastActionTimestamp,
      });
    }

    // ── newToReview ───────────────────────────────────────────────────────────
    if (row.status === 'new' && isFalseFlag(row.aiEnabled) && row.createdInWindow === true) {
      newToReview.push({
        firstName: row.firstName,
        lastInitial: row.lastInitial,
        sourceEmailSubject: row.originalMessage || '',
        whyFlagged: '',
        rowIndex: row.rowIndex,
      });
    }

    // ── followUpsDue ──────────────────────────────────────────────────────────
    if (
      row.status === 'awaiting_response' &&
      !isFalseFlag(row.aiEnabled) &&
      row.nextTouchEligibleAt !== null && row.nextTouchEligibleAt !== undefined
    ) {
      const eligibleAt = parseISO(row.nextTouchEligibleAt);
      if (eligibleAt) {
        const msUntil = eligibleAt.getTime() - now.getTime();
        if (msUntil > 0 && msUntil <= MS_24H) {
          const lastTouchDate = parseISO(row.lastFollowUpDate) || parseISO(row.lastActionTimestamp);
          followUpsDue.push({
            firstName: row.firstName,
            lastInitial: row.lastInitial,
            touchDay: row.nextTouchDay || 0,
            daysSinceLastTouch: lastTouchDate ? daysBetween(now, lastTouchDate) : 0,
            propertyReference: row.propertyReference || null,
            rowIndex: row.rowIndex,
            _nextTouchEligibleAt: row.nextTouchEligibleAt,
          });
        }
      }
    }

    // ── followUpsFiredOvernight ───────────────────────────────────────────────
    if (row.lastFollowUpFire !== null && row.lastFollowUpFire !== undefined) {
      followUpsFiredOvernight.push({
        firstName: row.firstName,
        lastInitial: row.lastInitial,
        touchDay: row.lastFollowUpFire.touchDay,
        mode: row.lastFollowUpFire.mode,
        rowIndex: row.rowIndex,
        _fireTimestamp: row.lastFollowUpFire.timestamp,
      });
    }
  }

  // ── Sort ──────────────────────────────────────────────────────────────────
  urgent.sort((a, b) => {
    const ta = parseISO(a._triggerTimestamp);
    const tb = parseISO(b._triggerTimestamp);
    return (tb ? tb.getTime() : 0) - (ta ? ta.getTime() : 0);
  });
  // Strip sort key before returning
  urgent.forEach(r => delete r._triggerTimestamp);

  hotLeads.sort((a, b) => {
    const ta = parseISO(a._lastActionTimestamp);
    const tb = parseISO(b._lastActionTimestamp);
    return (tb ? tb.getTime() : 0) - (ta ? ta.getTime() : 0);
  });
  hotLeads.forEach(r => delete r._lastActionTimestamp);

  followUpsDue.sort((a, b) => {
    const ta = parseISO(a._nextTouchEligibleAt);
    const tb = parseISO(b._nextTouchEligibleAt);
    return (ta ? ta.getTime() : 0) - (tb ? tb.getTime() : 0);
  });
  followUpsDue.forEach(r => delete r._nextTouchEligibleAt);

  followUpsFiredOvernight.sort((a, b) => {
    const ta = parseISO(a._fireTimestamp);
    const tb = parseISO(b._fireTimestamp);
    return (tb ? tb.getTime() : 0) - (ta ? ta.getTime() : 0);
  });
  followUpsFiredOvernight.forEach(r => delete r._fireTimestamp);

  return { urgent, hotLeads, newToReview, followUpsDue, followUpsFiredOvernight };
}

/**
 * Pure function. Produces the three-line SMS string per spec section 3.1.
 * Line 1 always renders (the "Handled N overnight" framing — never quiet).
 * Line 2 omitted if no urgent items. Line 3 always renders.
 *
 * @param {{intaken: number, followUpsFired: number, noiseFiltered: number, urgentCount: number}} stats
 * @param {object|null} urgent  the top urgent item, or null if none
 * @returns {string}
 */
function renderSMS(stats, urgent) {
  const line1base = buildOpenerLine(
    { intaken: stats.intaken, followUpsFired: stats.followUpsFired, noiseFiltered: stats.noiseFiltered },
    urgent !== null,
    stats.urgentCount,
  );

  if (urgent === null) {
    return `${line1base}\nFull brief in your inbox.`;
  }

  const ctx = urgentShortContext(urgent);
  const verb = urgentVerbPhrase(urgent.category);
  const line2base = `🔥 ${urgent.firstName} ${urgent.lastInitial} ${ctx} ${verb}`;
  const line2 = stats.urgentCount > 1
    ? `${line2base} + ${stats.urgentCount - 1} more.`
    : `${line2base}.`;

  return `${line1base}\n${line2}\nFull brief in your inbox.`;
}

/**
 * Pure function. Produces the plaintext email body per spec section 4.1.
 * Empty sections are omitted except "What the system handled" (always renders).
 * Section ordering is fixed.
 *
 * @param {object} sections  the shape returned by categorizeRowsForDigest
 * @param {object} agentConfig  for name, timezone, sheet id (deep links)
 * @param {Date} now  used for date formatting in the subject line
 * @returns {{subject: string, body: string}}
 */
function renderEmail(sections, agentConfig, now) {
  const { urgent, hotLeads, newToReview, followUpsDue, followUpsFiredOvernight, systemHandled, reliability } = sections;
  const timezone = agentConfig.timezone || 'America/Toronto';
  const gid = agentConfig.googleSheetId;

  const subject = urgent.length > 0
    ? `Your morning brief — ${urgent[0].firstName} needs you today`
    : `Your morning brief — ${formatDailyDate(now, timezone)}`;

  const parts = [];

  if (urgent.length === 0) {
    parts.push(buildOpenerLine(systemHandled, false, 0));
  }

  const CONTEXT_FALLBACKS = new Set(['HOT signal', 'needs review', 'escalated']);
  if (urgent.length > 0) {
    const rows = urgent.map(u => {
      const verb = urgentVerbPhrase(u.category);
      const ctx = urgentDisplayContext(u);
      const dropCtx = u.propertyReference == null && CONTEXT_FALLBACKS.has(ctx);
      let line = dropCtx
        ? `${u.firstName} ${u.lastInitial} — ${verb}`
        : `${u.firstName} ${u.lastInitial} — ${verb} — ${ctx}`;
      const link = buildActionLink(u, agentConfig);
      if (link) line += `\n→ ${link.label}: ${link.url}`;
      return line;
    });
    parts.push(`— Needs you today —\n\n${rows.join('\n')}`);
  }

  const urgentRowIndexes = new Set(urgent.filter(u => u.rowIndex != null).map(u => u.rowIndex));
  const deduplicatedHotLeads = hotLeads.filter(r => !urgentRowIndexes.has(r.rowIndex));
  if (deduplicatedHotLeads.length > 0) {
    const rows = deduplicatedHotLeads.map(r => {
      let line = `${r.firstName} ${r.lastInitial} — ${r.propertyReference || '(property not captured)'} — last touch ${r.daysAgo}d ago`;
      const link = buildActionLink({ ...r, category: 'HOT' }, agentConfig);
      if (link) line += `\n→ ${link.label}: ${link.url}`;
      return line;
    });
    parts.push(`— Hot leads to call today —\n\n${rows.join('\n')}`);
  }

  if (newToReview.length > 0) {
    const rows = newToReview.map(r =>
      `${r.firstName} ${r.lastInitial} — ${r.sourceEmailSubject} — ${r.whyFlagged}`
    );
    parts.push(`— Possible new leads to review —\n\n${rows.join('\n')}`);
  }

  if (followUpsDue.length > 0) {
    const rows = followUpsDue.map(r => {
      let line = `${r.firstName} ${r.lastInitial} — Day ${r.touchDay} — ${r.daysSinceLastTouch}d since last touch — ${r.propertyReference}`;
      if (gid && r.rowIndex != null) line += ` (${sheetLink(gid, r.rowIndex)})`;
      return line;
    });
    parts.push(`— Follow-ups due today —\n\n${rows.join('\n')}`);
  }

  if (followUpsFiredOvernight.length > 0) {
    const allLive = followUpsFiredOvernight.every(r => r.mode === 'live');
    const header = allLive
      ? '— Follow-ups sent overnight —'
      : '— Follow-ups fired overnight (shadow drafts) —';
    const rows = followUpsFiredOvernight.map(r =>
      `${r.firstName} ${r.lastInitial} — Day ${r.touchDay} — ${r.mode === 'live' ? 'sent' : 'draft in inbox'}`
    );
    parts.push(`${header}\n\n${rows.join('\n')}`);
  }

  {
    const sh = systemHandled;
    const lines = Object.entries(SYSTEM_HANDLED_LABELS)
      .filter(([key]) => key in sh)
      .map(([key, label]) => `${label}: ${sh[key]}`);
    parts.push(`— What the system handled —\n\n${lines.join('\n')}`);
  }

  {
    const r = reliability;
    if (r.errors + r.retries + r.threadingSkipped > 0) {
      const lines = [
        `Errors: ${r.errors}`,
        `Retries: ${r.retries}`,
        `Threading-skipped follow-ups: ${r.threadingSkipped}`,
      ];
      parts.push(`— Reliability —\n\n${lines.join('\n')}`);
    }
  }

  return { subject, body: parts.join('\n\n') };
}

/**
 * Pure function. Produces the HTML email body for the daily digest per the
 * HTML email spec (Decisions 1-10). Same section ordering and input shape as
 * renderEmail. All styles inline (Gmail strips <style> blocks). All visual
 * values sourced from STYLE_TOKENS — no hardcoded colours or sizes in templates.
 *
 * Each urgent/hotLeads row renders as:
 *   <div> row text </div>
 *   <div> <a styled-button> action label </a> </div>   ← omitted when buildActionLink returns null
 *
 * "What the system handled" section uses mutedTextColor; no action buttons.
 * Opener line suppressed when urgent.length > 0 (same policy as renderEmail).
 *
 * @param {object} sections  same shape as renderEmail input
 * @param {object} agentConfig
 * @param {Date} now
 * @returns {{ subject: string, html: string }}
 */
function renderEmailHtml(sections, agentConfig, now) {
  const { urgent, hotLeads, newToReview, followUpsDue, followUpsFiredOvernight, systemHandled, reliability } = sections;
  const timezone = agentConfig.timezone || 'America/Toronto';

  const subject = urgent.length > 0
    ? `Your morning brief — ${urgent[0].firstName} needs you today`
    : `Your morning brief — ${formatDailyDate(now, timezone)}`;

  const T = STYLE_TOKENS;
  const parts = [];

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function button(link) {
    if (!link) return '';
    return (
      `<div style="margin-top:8px;">` +
      `<a href="${esc(link.url)}" ` +
      `style="display:inline-block;padding:${T.buttonPadding};background:${T.buttonBackground};` +
      `color:${T.buttonTextColor};border-radius:${T.buttonBorderRadius};` +
      `font-weight:${T.buttonFontWeight};text-decoration:none;` +
      `font-family:${T.fontStack};font-size:${T.fontSize};">` +
      `${esc(link.label)}</a>` +
      `</div>`
    );
  }

  function sectionHeader(title) {
    return (
      `<div style="margin-top:24px;margin-bottom:12px;padding-bottom:8px;` +
      `border-bottom:1px solid ${T.sectionDividerColor};` +
      `font-weight:${T.buttonFontWeight};color:${T.bodyTextColor};">` +
      `${esc(title)}</div>`
    );
  }

  // Opener (suppressed when urgent rows exist — section headers carry the tone)
  if (urgent.length === 0) {
    parts.push(`<p style="margin:0 0 16px 0;">${esc(buildOpenerLine(systemHandled, false, 0))}</p>`);
  }

  // Urgent section
  const CONTEXT_FALLBACKS_HTML = new Set(['HOT signal', 'needs review', 'escalated']);
  if (urgent.length > 0) {
    parts.push(sectionHeader('Needs you today'));
    for (const u of urgent) {
      const verb = urgentVerbPhrase(u.category);
      const ctx  = urgentDisplayContext(u);
      const dropCtx = u.propertyReference == null && CONTEXT_FALLBACKS_HTML.has(ctx);
      const rowText = dropCtx
        ? `${u.firstName} ${u.lastInitial} — ${verb}`
        : `${u.firstName} ${u.lastInitial} — ${verb} — ${ctx}`;
      const link = buildActionLink(u, agentConfig);
      parts.push(
        `<div style="margin-bottom:16px;">` +
        `<div>${esc(rowText)}</div>` +
        button(link) +
        `</div>`
      );
    }
  }

  // Hot leads section (deduped against urgent, same logic as renderEmail)
  const urgentRowIndexes = new Set(urgent.filter(u => u.rowIndex != null).map(u => u.rowIndex));
  const deduplicatedHotLeads = hotLeads.filter(r => !urgentRowIndexes.has(r.rowIndex));
  if (deduplicatedHotLeads.length > 0) {
    parts.push(sectionHeader('Hot leads to call today'));
    for (const r of deduplicatedHotLeads) {
      const propRef  = r.propertyReference || '(property not captured)';
      const rowText  = `${r.firstName} ${r.lastInitial} — ${propRef} — last touch ${r.daysAgo}d ago`;
      const link     = buildActionLink({ ...r, category: 'HOT' }, agentConfig);
      parts.push(
        `<div style="margin-bottom:16px;">` +
        `<div>${esc(rowText)}</div>` +
        button(link) +
        `</div>`
      );
    }
  }

  // Possible new leads to review (no buttons — agent reviews manually)
  if (newToReview.length > 0) {
    parts.push(sectionHeader('Possible new leads to review'));
    for (const r of newToReview) {
      parts.push(
        `<div style="margin-bottom:8px;">${esc(`${r.firstName} ${r.lastInitial} — ${r.sourceEmailSubject}`)}</div>`
      );
    }
  }

  // Follow-ups due today (no buttons)
  if (followUpsDue.length > 0) {
    parts.push(sectionHeader('Follow-ups due today'));
    for (const r of followUpsDue) {
      parts.push(
        `<div style="margin-bottom:8px;">${esc(`${r.firstName} ${r.lastInitial} — Day ${r.touchDay} — ${r.daysSinceLastTouch}d since last touch`)}</div>`
      );
    }
  }

  // Follow-ups fired overnight (no buttons)
  if (followUpsFiredOvernight.length > 0) {
    const allLive = followUpsFiredOvernight.every(r => r.mode === 'live');
    const hdr = allLive ? 'Follow-ups sent overnight' : 'Follow-ups fired overnight (shadow drafts)';
    parts.push(sectionHeader(hdr));
    for (const r of followUpsFiredOvernight) {
      const status = r.mode === 'live' ? 'sent' : 'draft in inbox';
      parts.push(
        `<div style="margin-bottom:8px;">${esc(`${r.firstName} ${r.lastInitial} — Day ${r.touchDay} — ${status}`)}</div>`
      );
    }
  }

  // What the system handled (always renders, muted text, no buttons)
  {
    const sh = systemHandled;
    const lines = Object.entries(SYSTEM_HANDLED_LABELS)
      .filter(([key]) => key in sh)
      .map(([key, label]) => `<div>${esc(`${label}: ${sh[key]}`)}</div>`)
      .join('');
    parts.push(
      sectionHeader('What the system handled') +
      `<div style="color:${T.mutedTextColor};font-size:${T.fontSize};">${lines}</div>`
    );
  }

  // Reliability (only when non-zero)
  {
    const r = reliability;
    if (r.errors + r.retries + r.threadingSkipped > 0) {
      const lines = [
        `<div>${esc(`Errors: ${r.errors}`)}</div>`,
        `<div>${esc(`Retries: ${r.retries}`)}</div>`,
        `<div>${esc(`Threading-skipped follow-ups: ${r.threadingSkipped}`)}</div>`,
      ].join('');
      parts.push(
        sectionHeader('Reliability') +
        `<div style="color:${T.mutedTextColor};">${lines}</div>`
      );
    }
  }

  const html =
    `<!DOCTYPE html>\n` +
    `<html>\n` +
    `<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>\n` +
    `<body style="margin:0;padding:0;background-color:${T.bodyBackground};">\n` +
    `<div style="max-width:${T.containerMaxWidth};margin:0 auto;padding:${T.containerPadding};` +
    `font-family:${T.fontStack};font-size:${T.fontSize};line-height:${T.lineHeight};color:${T.bodyTextColor};">\n` +
    parts.join('\n') + '\n' +
    `</div>\n` +
    `</body>\n` +
    `</html>`;

  return { subject, html };
}


// ── Shadow Mode catch helpers ─────────────────────────────────────────────────

function secondsFromIso(iso) {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function parseShadowDraftBody(rawBody) {
  const leadEmailMatch = rawBody.match(/reply at (\S+)/i);
  if (!leadEmailMatch) return null;
  const leadEmail = leadEmailMatch[1].replace(/\.$/, '').trim();

  const sepIdx = rawBody.indexOf('\n---\n');
  if (sepIdx === -1) return null;
  const draftBody = rawBody.slice(sepIdx + 5).trim();

  return { leadEmail, draftBody };
}

function computeJaccardOverlap(draftBody, sentBody, agentConfig) {
  function normalize(text) {
    // Strip quoted-reply text: lines starting with ">" and "On ... wrote:" onward
    let lines = text.split('\n').filter(line => !line.trimStart().startsWith('>'));
    text = lines.join('\n');
    const onWroteMatch = text.match(/on .{1,80} wrote:/i);
    if (onWroteMatch) text = text.slice(0, onWroteMatch.index);

    // Strip greeting: first non-empty line if it starts with Hi/Hello/Hey
    lines = text.split('\n');
    const firstIdx = lines.findIndex(l => l.trim() !== '');
    if (firstIdx >= 0 && /^(hi|hello|hey)\b/i.test(lines[firstIdx])) {
      lines.splice(firstIdx, 1);
      text = lines.join('\n');
    }

    // Strip sign-off from last occurrence of agentSignature
    const sig = agentConfig && agentConfig.agentSignature && agentConfig.agentSignature.trim();
    if (sig) {
      const idx = text.toLowerCase().lastIndexOf(sig.toLowerCase());
      if (idx >= 0) text = text.slice(0, idx);
    }

    return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
  }

  const tokensA = normalize(draftBody);
  const tokensB = normalize(sentBody);

  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Detects Shadow Mode catches for a single agent in the given time window.
 * Searches the agent's Gmail for self-sent [SHADOW DRAFT] emails, then checks
 * whether the agent sent a follow-up email to each lead within 48h. Classifies
 * each draft as sentAsIs, editedThenSent, or rejected using Jaccard similarity.
 * Returns null on timeout or any unexpected error (caller omits the agent from
 * the aggregate). See spec section 5.2.
 *
 * @param {object} agentConfig
 * @param {string} startIso
 * @param {string} endIso
 * @returns {Promise<{sentAsIs: number, editedThenSent: number, rejected: number} | null>}
 */
async function pollSentFolderForDraftResolution(agentConfig, startIso, endIso) {
  try {
    const timeoutMs = 30000;
    const startMs = Date.now();
    const checkTimeout = () => {
      if (Date.now() - startMs > timeoutMs) {
        throw new Error('shadow-catch-timeout');
      }
    };

    const shadowQuery = `from:${agentConfig.gmailAddress} to:${agentConfig.gmailAddress} subject:"[SHADOW DRAFT]" after:${secondsFromIso(startIso)} before:${secondsFromIso(endIso)}`;
    const draftIds = await gmail.searchMessages(agentConfig, shadowQuery, 200);
    checkTimeout();

    const counts = { sentAsIs: 0, editedThenSent: 0, rejected: 0 };

    for (const draftId of draftIds) {
      checkTimeout();
      const draftMsg = await gmail.fetchMessage(agentConfig, draftId);
      const parsed = parseShadowDraftBody(draftMsg.body);
      if (!parsed) continue;

      const draftTimestampMs = draftMsg.internalDate;
      const windowEndMs = draftTimestampMs + 48 * 60 * 60 * 1000;
      const sentQuery = `from:${agentConfig.gmailAddress} to:${parsed.leadEmail} after:${Math.floor(draftTimestampMs / 1000)} before:${Math.floor(windowEndMs / 1000)}`;
      const sentIds = await gmail.searchMessages(agentConfig, sentQuery, 10);
      checkTimeout();

      if (sentIds.length === 0) {
        counts.rejected++;
        continue;
      }

      const sentMsgs = [];
      for (const sid of sentIds) {
        checkTimeout();
        sentMsgs.push(await gmail.fetchMessage(agentConfig, sid));
      }
      sentMsgs.sort((a, b) => a.internalDate - b.internalDate);
      const firstSent = sentMsgs[0];

      const jaccard = computeJaccardOverlap(parsed.draftBody, firstSent.body, agentConfig);
      if (jaccard >= 0.95) counts.sentAsIs++;
      else if (jaccard >= 0.30) counts.editedThenSent++;
      else counts.rejected++;
    }

    return counts;
  } catch (err) {
    if (err.message === 'shadow-catch-timeout') {
      console.warn(`[digest] shadow-catch polling timed out for ${agentConfig.agentId}`);
    } else {
      console.error(`[digest] shadow-catch error for ${agentConfig.agentId}: ${err.message}`);
    }
    return null;
  }
}

// ── Weekly email renderer (operator-facing) ───────────────────────────────────

function renderWeeklyEmail(weeklySections, operatorConfig, now) {
  const timezone  = operatorConfig.timezone || 'America/Toronto';
  const startLabel = formatWeeklyDate(weeklySections.windowStart, timezone);
  const endLabel   = formatWeeklyDate(weeklySections.windowEnd,   timezone);
  const subject    = `Weekly digest — ${startLabel} to ${endLabel}`;

  const {
    aggregate,
    perAgent,
    churnRisk,
    recentlyDeactivated,
    shadowCatches = {},
    shadowAgentsCovered = 0,
    shadowAgentsTimedOut = 0,
  } = weeklySections;
  const totalLeads = aggregate.totalLeadsHandled || 0;
  const agentCount = perAgent.length;
  const parts      = [];

  parts.push(
    `${totalLeads} leads handled across ${agentCount} active agent${agentCount !== 1 ? 's' : ''} this week.`
  );

  {
    const lines = Object.entries(WEEKLY_AGGREGATE_LABELS)
      .filter(([key]) => key in aggregate)
      .map(([key, label]) => `${label}: ${aggregate[key]}`);
    if (lines.length > 0) {
      parts.push(`— Aggregate stats —\n\n${lines.join('\n')}`);
    }
  }

  {
    const hasShadowData = shadowAgentsCovered > 0 || shadowAgentsTimedOut > 0;
    if (hasShadowData) {
      const plural = n => (n === 1 ? '' : 's');
      let shadowText;
      if (shadowAgentsCovered === 0) {
        shadowText = `Shadow Mode catches: unavailable this week (Gmail polling timed out for ${shadowAgentsTimedOut} agent${plural(shadowAgentsTimedOut)}).`;
      } else {
        shadowText = [
          `Drafts sent as-is by agent: ${shadowCatches.sentAsIs}`,
          `Drafts edited then sent: ${shadowCatches.editedThenSent}`,
          `Drafts rejected: ${shadowCatches.rejected}`,
        ].join('\n');
        if (shadowAgentsTimedOut > 0) {
          shadowText += `\n(Counts exclude ${shadowAgentsTimedOut} agent${plural(shadowAgentsTimedOut)} where Gmail polling timed out.)`;
        }
        shadowText += '\nThis is the number that justifies $500/month long-term.';
      }
      parts.push(`— Shadow Mode catches —\n\n${shadowText}`);
    }
  }

  if (churnRisk && churnRisk.length > 0) {
    const lines = churnRisk.map(a => `${a.agentName} (${a.agentId}): ${a.reasons.join(', ')}`);
    parts.push(`— Churn risk —\n\n${lines.join('\n')}`);
  }

  if (recentlyDeactivated && recentlyDeactivated.length > 0) {
    const MS_DAY = 24 * 60 * 60 * 1000;
    const lines = recentlyDeactivated.map(a => {
      const daysAgo = Math.floor((now.getTime() - new Date(a.deactivatedAt).getTime()) / MS_DAY);
      const rel = daysAgo === 0 ? 'today' : daysAgo === 1 ? '1 day ago' : `${daysAgo} days ago`;
      return `${a.agentName} (${a.agentId}) — deactivated ${rel}`;
    });
    parts.push(`— Agents recently deactivated —\n\n${lines.join('\n')}`);
  }

  {
    const dataFreshness = weeklySections.dataFreshness || [];
    if (dataFreshness.length > 0) {
      const notFresh = dataFreshness.filter(s => s.status !== 'fresh');
      if (notFresh.length === 0) {
        parts.push('Data layer: all sources current.');
      } else {
        const lines = notFresh.map(s => {
          if (s.status === 'never_pulled') return `${s.name}: never pulled`;
          if (s.status === 'check_failed') return `${s.name} failed: ${s.checkError}`;
          return `${s.name}: overdue — last pulled ${Math.round(s.ageHours)}h ago`;
        });
        parts.push(`— Data layer —\n\n${lines.join('\n')}`);
      }
    }
  }

  if (perAgent && perAgent.length > 0) {
    const blocks = perAgent.map(a => [
      `${a.agentName} (${a.agentId})`,
      `  Leads intaken: ${a.intaken}`,
      `  Follow-ups fired: ${a.followUpsFired}`,
      `  Filtered: ${a.noiseFiltered}`,
      `  Urgent items: ${a.urgentCount}`,
      `  Pre-flight skips this week: ${a.weeklyPreflightSkips}`,
    ].join('\n'));
    parts.push(`— Per-agent breakdown —\n\n${blocks.join('\n\n')}`);
  }

  parts.push('Pre-flight skip counters reset after this digest.');

  return { subject, body: parts.join('\n\n') };
}

/**
 * Pure function. Produces the HTML email body for the operator weekly digest,
 * mirroring the daily HTML renderer pattern (same STYLE_TOKENS, same section
 * header style, same 560px centered container). No per-lead rows so no action
 * buttons — all content is aggregate statistics in muted text.
 *
 * @param {object} weeklySections  same shape as renderWeeklyEmail input
 * @param {object} operatorConfig
 * @param {Date} now
 * @returns {{ subject: string, html: string }}
 */
function renderWeeklyEmailHtml(weeklySections, operatorConfig, now) {
  const timezone   = operatorConfig.timezone || 'America/Toronto';
  const startLabel = formatWeeklyDate(weeklySections.windowStart, timezone);
  const endLabel   = formatWeeklyDate(weeklySections.windowEnd,   timezone);
  const subject    = `Weekly digest — ${startLabel} to ${endLabel}`;

  const {
    aggregate,
    perAgent,
    churnRisk,
    recentlyDeactivated,
    shadowCatches = {},
    shadowAgentsCovered = 0,
    shadowAgentsTimedOut = 0,
  } = weeklySections;
  const totalLeads = aggregate.totalLeadsHandled || 0;
  const agentCount = perAgent.length;

  const T = STYLE_TOKENS;
  const parts = [];

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sectionHeader(title) {
    return (
      `<div style="margin-top:24px;margin-bottom:12px;padding-bottom:8px;` +
      `border-bottom:1px solid ${T.sectionDividerColor};` +
      `font-weight:${T.buttonFontWeight};color:${T.bodyTextColor};">` +
      `${esc(title)}</div>`
    );
  }

  function statLines(lines) {
    return (
      `<div style="color:${T.mutedTextColor};font-size:${T.fontSize};">` +
      lines.map(l => `<div>${esc(l)}</div>`).join('') +
      `</div>`
    );
  }

  // Opener
  parts.push(
    `<p style="margin:0 0 16px 0;">${esc(`${totalLeads} leads handled across ${agentCount} active agent${agentCount !== 1 ? 's' : ''} this week.`)}</p>`
  );

  // Aggregate stats
  {
    const lines = Object.entries(WEEKLY_AGGREGATE_LABELS)
      .filter(([key]) => key in aggregate)
      .map(([key, label]) => `${label}: ${aggregate[key]}`);
    if (lines.length > 0) {
      parts.push(sectionHeader('Aggregate stats') + statLines(lines));
    }
  }

  // Shadow Mode catches
  {
    const hasShadowData = shadowAgentsCovered > 0 || shadowAgentsTimedOut > 0;
    if (hasShadowData) {
      const plural = n => (n === 1 ? '' : 's');
      let shadowLines;
      if (shadowAgentsCovered === 0) {
        shadowLines = [`Shadow Mode catches: unavailable this week (Gmail polling timed out for ${shadowAgentsTimedOut} agent${plural(shadowAgentsTimedOut)}).`];
      } else {
        shadowLines = [
          `Drafts sent as-is by agent: ${shadowCatches.sentAsIs}`,
          `Drafts edited then sent: ${shadowCatches.editedThenSent}`,
          `Drafts rejected: ${shadowCatches.rejected}`,
        ];
        if (shadowAgentsTimedOut > 0) {
          shadowLines.push(`Counts exclude ${shadowAgentsTimedOut} agent${plural(shadowAgentsTimedOut)} where Gmail polling timed out.`);
        }
        shadowLines.push('This is the number that justifies $500/month long-term.');
      }
      parts.push(sectionHeader('Shadow Mode catches') + statLines(shadowLines));
    }
  }

  // Churn risk
  if (churnRisk && churnRisk.length > 0) {
    const lines = churnRisk.map(a => `${a.agentName} (${a.agentId}): ${a.reasons.join(', ')}`);
    parts.push(sectionHeader('Churn risk') + statLines(lines));
  }

  // Recently deactivated
  if (recentlyDeactivated && recentlyDeactivated.length > 0) {
    const MS_DAY = 24 * 60 * 60 * 1000;
    const lines = recentlyDeactivated.map(a => {
      const daysAgo = Math.floor((now.getTime() - new Date(a.deactivatedAt).getTime()) / MS_DAY);
      const rel = daysAgo === 0 ? 'today' : daysAgo === 1 ? '1 day ago' : `${daysAgo} days ago`;
      return `${a.agentName} (${a.agentId}) — deactivated ${rel}`;
    });
    parts.push(sectionHeader('Agents recently deactivated') + statLines(lines));
  }

  // Data layer
  {
    const dataFreshness = weeklySections.dataFreshness || [];
    if (dataFreshness.length > 0) {
      const notFresh = dataFreshness.filter(s => s.status !== 'fresh');
      if (notFresh.length === 0) {
        parts.push(`<p style="margin:16px 0 0 0;color:${T.mutedTextColor};font-size:${T.fontSize};">${esc('Data layer: all sources current.')}</p>`);
      } else {
        const lines = notFresh.map(s => {
          if (s.status === 'never_pulled') return `${s.name}: never pulled`;
          if (s.status === 'check_failed') return `${s.name} failed: ${s.checkError}`;
          return `${s.name}: overdue — last pulled ${Math.round(s.ageHours)}h ago`;
        });
        parts.push(sectionHeader('Data layer') + statLines(lines));
      }
    }
  }

  // Per-agent breakdown
  if (perAgent && perAgent.length > 0) {
    parts.push(sectionHeader('Per-agent breakdown'));
    for (const a of perAgent) {
      const agentLines = [
        `Leads intaken: ${a.intaken}`,
        `Follow-ups fired: ${a.followUpsFired}`,
        `Filtered: ${a.noiseFiltered}`,
        `Urgent items: ${a.urgentCount}`,
        `Pre-flight skips this week: ${a.weeklyPreflightSkips}`,
      ];
      parts.push(
        `<div style="margin-bottom:16px;">` +
        `<div style="font-weight:${T.buttonFontWeight};margin-bottom:4px;">${esc(`${a.agentName} (${a.agentId})`)}</div>` +
        statLines(agentLines) +
        `</div>`
      );
    }
  }

  // Footer
  parts.push(`<p style="margin:16px 0 0 0;color:${T.mutedTextColor};font-size:${T.fontSize};">${esc('Pre-flight skip counters reset after this digest.')}</p>`);

  const html =
    `<!DOCTYPE html>\n` +
    `<html>\n` +
    `<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>\n` +
    `<body style="margin:0;padding:0;background-color:${T.bodyBackground};">\n` +
    `<div style="max-width:${T.containerMaxWidth};margin:0 auto;padding:${T.containerPadding};` +
    `font-family:${T.fontStack};font-size:${T.fontSize};line-height:${T.lineHeight};color:${T.bodyTextColor};">\n` +
    parts.join('\n') + '\n' +
    `</div>\n` +
    `</body>\n` +
    `</html>`;

  return { subject, html };
}

/**
 * Idempotency + time-of-day gate for the per-agent daily digest. Returns true
 * if (a) the agent's configured digest time falls within the current cycle
 * window in the agent's local timezone, AND (b) agentState.lastDailyDigestRun
 * is not within the last 12h. See spec section 7.2.
 *
 * @param {object} agentConfig
 * @param {Date} now
 * @param {object} agentState
 * @returns {boolean}
 */
function shouldRunDailyDigest(agentConfig, now, agentState) {
  const digestTime = (agentConfig.digestTime && String(agentConfig.digestTime).trim()) || '07:00';
  const timezone = (agentConfig.timezone && String(agentConfig.timezone).trim()) || 'America/Toronto';

  const colonIdx = digestTime.indexOf(':');
  const hh = parseInt(digestTime.slice(0, colonIdx), 10);
  const mm = parseInt(digestTime.slice(colonIdx + 1), 10);

  // Get today's local date in the target timezone
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year  = parseInt(dateParts.find(p => p.type === 'year').value,  10);
  const month = parseInt(dateParts.find(p => p.type === 'month').value, 10);
  const day   = parseInt(dateParts.find(p => p.type === 'day').value,   10);

  // Compute UTC offset using noon UTC (avoids DST transitions which occur at ~2am)
  const noonUTC   = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const noonParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(noonUTC);
  const noonLocalHour = parseInt(noonParts.find(p => p.type === 'hour').value,   10) % 24;
  const noonLocalMin  = parseInt(noonParts.find(p => p.type === 'minute').value, 10);

  // offsetMs = how far UTC is ahead of local (positive for west of UTC)
  const offsetMs = (12 * 60 - (noonLocalHour * 60 + noonLocalMin)) * 60 * 1000;

  // Scheduled fire moment in UTC: local HH:MM on today's local date
  const scheduledFireMs = Date.UTC(year, month - 1, day, hh, mm, 0) + offsetMs;

  const MS_1H  = 60 * 60 * 1000;
  const MS_12H = 12 * 60 * 60 * 1000;
  const nowMs  = now.getTime();
  const delta  = nowMs - scheduledFireMs;

  // Condition (a): within the 1h grace window
  if (delta < 0 || delta > MS_1H) return false;

  // Condition (b): not already run within the last 12h
  const lastRun = agentState && agentState.lastDailyDigestRun;
  if (lastRun) {
    if (nowMs - new Date(lastRun).getTime() <= MS_12H) return false;
  }

  return true;
}

/**
 * Idempotency + time-of-day gate for the operator weekly digest. Same as
 * shouldRunDailyDigest but additionally requires day-of-week === Sunday in
 * the operator's local timezone, and the 12h guard uses lastWeeklyDigestRun.
 *
 * @param {object} operatorConfig
 * @param {Date} now
 * @param {object} operatorState
 * @returns {boolean}
 */
function shouldRunWeeklyDigest(operatorConfig, now, operatorState) {
  const timezone = (operatorConfig.timezone && String(operatorConfig.timezone).trim()) || 'America/Toronto';

  // (a) Must be Sunday in operator's local timezone
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
  }).format(now);
  if (weekday !== 'Sunday') return false;

  const digestTime = (operatorConfig.digestTime && String(operatorConfig.digestTime).trim()) || '08:00';
  const colonIdx = digestTime.indexOf(':');
  const hh = parseInt(digestTime.slice(0, colonIdx), 10);
  const mm = parseInt(digestTime.slice(colonIdx + 1), 10);

  // Get today's local date in the target timezone
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year  = parseInt(dateParts.find(p => p.type === 'year').value,  10);
  const month = parseInt(dateParts.find(p => p.type === 'month').value, 10);
  const day   = parseInt(dateParts.find(p => p.type === 'day').value,   10);

  // Compute UTC offset using noon UTC (avoids DST transitions which occur at ~2am)
  const noonUTC   = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const noonParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(noonUTC);
  const noonLocalHour = parseInt(noonParts.find(p => p.type === 'hour').value,   10) % 24;
  const noonLocalMin  = parseInt(noonParts.find(p => p.type === 'minute').value, 10);
  const offsetMs = (12 * 60 - (noonLocalHour * 60 + noonLocalMin)) * 60 * 1000;

  const scheduledFireMs = Date.UTC(year, month - 1, day, hh, mm, 0) + offsetMs;

  const MS_1H  = 60 * 60 * 1000;
  const MS_6D  = 6 * 24 * 60 * 60 * 1000;
  const nowMs  = now.getTime();
  const delta  = nowMs - scheduledFireMs;

  // (b) Within 1h grace window
  if (delta < 0 || delta > MS_1H) return false;

  // (c) 6-day idempotency guard
  const lastRun = operatorState && operatorState.lastWeeklyDigestRun;
  if (lastRun) {
    if (nowMs - new Date(lastRun).getTime() <= MS_6D) return false;
  }

  return true;
}

module.exports = {
  runDailyDigestForAgent,
  runWeeklyDigestForOperator,
  // internal helpers exposed for unit testing
  gatherWindowData,
  categorizeRowsForDigest,
  buildActionLink,
  renderSMS,
  renderEmail,
  renderEmailHtml,
  renderWeeklyEmail,
  renderWeeklyEmailHtml,
  pollSentFolderForDraftResolution,
  shouldRunDailyDigest,
  shouldRunWeeklyDigest,
  _internal: {
    splitName,
    parseColumnLFirstLineTimestamp,
    parseColumnLPropertyReference,
    computeNextTouch,
    findInWindowFollowUpFire,
    annotateRow,
    _sendWithRetry,
    _appendDigestErrorLog,
    secondsFromIso,
    parseShadowDraftBody,
    computeJaccardOverlap,
    STYLE_TOKENS,
  },
};
