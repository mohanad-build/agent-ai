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

const email = require('./email');
const agentState = require('./agentState');
const twilio = require('./twilio');
const { getFollowUpCadence } = require('./agentConfig');
const { getNowIso, getNowDate } = require('./time');

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

function buildOpenerLine(systemHandled, hasUrgent) {
  const intaken = systemHandled.intaken || 0;
  const followUpsFired = systemHandled.followUpsFired || 0;
  const noiseFiltered = systemHandled.noiseFiltered || 0;
  const total = intaken + followUpsFired + noiseFiltered;
  const base = `Handled ${total} leads overnight: ${intaken} new, ${followUpsFired} follow-ups, ${noiseFiltered} filtered.`;
  return hasUrgent ? base : `${base} 0 need you today.`;
}

// Churn threshold description rendered at the bottom of every churn section.
const CHURN_CRITERIA = 'Criteria: needs_review unanswered >48h (High), no Sheet interaction >14d (High), pre-flight skips +50% WoW (Medium), aiEnabled toggled ≥3 rows (Medium), CALLED >5x (Low).';

// Renderer-owned label map for Path B systemHandled section. Key order = render order.
// Only keys present in the data object will produce a line (absent keys are silently skipped).
const SYSTEM_HANDLED_LABELS = {
  intaken: 'Leads intaken',
  followUpsFired: 'Follow-ups fired',
  preflightSkips: 'Pre-flight skips this week',
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
    try {
      await twilio.sendSMS(smsTarget, smsBody);
      smsResult = 'sent';
    } catch (err) {
      console.error(`[${agentConfig.agentId}] daily digest SMS failed: ${err.message}`);
      smsResult = 'failed';
      errors.push({ channel: 'sms', message: err.message });
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
    emailTo = agentConfig.agentEmail || null;
  }

  if (!emailTo) {
    emailResult = 'failed';
    errors.push({ channel: 'email', message: 'no recipient address' });
  } else {
    try {
      await email.sendNewEmail(agentConfig, { to: emailTo, subject, body: emailBody });
      emailResult = 'sent';
    } catch (err) {
      console.error(`[${agentConfig.agentId}] daily digest email failed: ${err.message}`);
      emailResult = 'failed';
      errors.push({ channel: 'email', message: err.message });
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
async function runWeeklyDigestForOperator(operatorConfig, agentConfigs) {
  throw new Error('not implemented');
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
  const rows = rawRows.map(row => annotateRow(row, cadence, mode, startMs, endMs));
  const state = agentState.getState(agentConfig.agentId);
  const preflightSkips = state.weeklyPreflightSkips || 0;
  const intaken = rows.filter(r => r.createdInWindow === true).length;
  const followUpsFired = rows.filter(r => r.lastFollowUpFire !== null).length;
  return {
    rows,
    stateCounters: { systemHandled: { intaken, followUpsFired, preflightSkips } },
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
  );

  if (urgent === null) {
    return `${line1base}\nFull brief in your inbox.`;
  }

  const ctx = urgentShortContext(urgent);
  const verb = urgentVerbPhrase(urgent.category);
  const line2base = `🔥 ${urgent.firstName} ${urgent.lastInitial} ${ctx} ${verb}`;
  const line2 = stats.urgentCount > 1
    ? `${line2base} + ${stats.urgentCount - 1} more need you.`
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

  parts.push(buildOpenerLine(systemHandled, urgent.length > 0));

  if (urgent.length > 0) {
    const rows = urgent.map(u => {
      const verb = urgentVerbPhrase(u.category);
      const ctx = urgentDisplayContext(u);
      let line = `${u.firstName} ${u.lastInitial} — ${verb} — ${ctx}`;
      if (gid && u.rowIndex != null) line += ` (${sheetLink(gid, u.rowIndex)})`;
      return line;
    });
    parts.push(`— Needs you today —\n\n${rows.join('\n')}`);
  }

  if (hotLeads.length > 0) {
    const rows = hotLeads.map(r => {
      let line = `${r.firstName} ${r.lastInitial} — ${r.propertyReference} — last touch ${r.daysAgo}d ago — ${r.whyHot}`;
      if (gid && r.rowIndex != null) line += ` (${sheetLink(gid, r.rowIndex)})`;
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
 * Pure function. Produces the operator weekly email body per spec section 5.1.
 * aggregateStats.operatorTimezone is used for date formatting; defaults to
 * America/Toronto if absent.
 *
 * @param {object} aggregateStats  cross-agent rollup (includes windowStart, windowEnd, operatorTimezone)
 * @param {object[]} perAgentSections  one per agent
 * @param {object[]} agentConfigs
 * @param {Date} now  reserved for future use
 * @returns {{subject: string, body: string}}
 */
function renderWeeklyEmail(aggregateStats, perAgentSections, agentConfigs, now) {
  const operatorTz = aggregateStats.operatorTimezone || 'America/Toronto';
  const startLabel = formatWeeklyDate(aggregateStats.windowStart, operatorTz);
  const endLabel = formatWeeklyDate(aggregateStats.windowEnd, operatorTz);
  const subject = `Weekly digest — ${startLabel} to ${endLabel}`;

  const parts = [];

  {
    const s = aggregateStats;
    const lines = [
      `Leads handled across all agents: ${s.leadsHandled}`,
      `Average response time (lead reply → system action): ${s.avgResponseTime}`,
    ];
    if (s.warmToTourRate !== null && s.warmToTourRate !== undefined) {
      lines.push(`Warm-to-tour conversion rate: ${s.warmToTourRate}`);
    }
    lines.push(
      `Total touches fired: ${s.touchesFired}`,
      `Total filtered: ${s.filtered}`,
      `Total escalations: ${s.escalations}`,
      `Total Path 1B round-trips completed: ${s.path1bRoundTrips}`,
      `Total pre-flight skips (agents doing it manually): ${s.preflightSkips}`,
    );
    parts.push(`— Aggregate stats —\n\n${lines.join('\n')}`);
  }

  {
    const sc = aggregateStats.shadowCatches;
    const lines = [
      `Drafts sent as-is by agent: ${sc.sentAsIs}`,
      `Drafts edited then sent: ${sc.editedThenSent}`,
      `Drafts rejected: ${sc.rejected}`,
    ];
    parts.push(`— Shadow Mode catches —\n\n${lines.join('\n')}`);
  }

  {
    const agentBlocks = perAgentSections.map(a => [
      `${a.agentName} [${a.mode}]`,
      `  Leads handled: ${a.leadsHandled}`,
      `  Response time: ${a.responseTime}`,
      `  Pre-flight skips: ${a.preflightSkips}`,
      `  Last Sheet interaction: ${a.lastSheetInteraction}`,
    ].join('\n'));
    parts.push(`— Per-agent breakdown —\n\n${agentBlocks.join('\n\n')}`);
  }

  {
    const flagged = perAgentSections.filter(a => a.flaggedReasons && a.flaggedReasons.length > 0);
    const churnLines = [];
    if (flagged.length === 0) {
      churnLines.push('All agents engaged this week.');
    } else {
      for (const a of flagged) {
        for (const reason of a.flaggedReasons) {
          churnLines.push(`${a.agentName} — ${reason}`);
        }
      }
    }
    churnLines.push('');
    churnLines.push(CHURN_CRITERIA);
    parts.push(`— Churn risk signals —\n\n${churnLines.join('\n')}`);
  }

  {
    const r = aggregateStats.reliability;
    if (r.errors + r.retries + r.threadingSkipped > 0) {
      const lines = [
        `Errors: ${r.errors}`,
        `Retries: ${r.retries}`,
        `Threading-skipped follow-ups: ${r.threadingSkipped}`,
      ];
      parts.push(`— Reliability —\n\n${lines.join('\n')}`);
    }
  }

  {
    const items = aggregateStats.humanItems || [];
    if (items.length > 0) {
      parts.push(`— Things that need a human —\n\n${items.join('\n')}`);
    }
  }

  return { subject, body: parts.join('\n\n') };
}

/**
 * Weekly-only helper. For each draftMetadata entry, checks the agent's Sent
 * folder for a message in the same Gmail thread within 48h of the draft. If
 * found and token-overlap >= 30% (Jaccard), classifies as "sent as-is" or
 * "edited then sent." See spec section 5.2.
 *
 * @param {object} agentConfig
 * @param {object[]} draftMetadata  rows with shadow drafts in the window
 * @returns {Promise<{sentAsIs: number, editedThenSent: number, rejected: number}>}
 */
async function pollSentFolderForDraftResolution(agentConfig, draftMetadata) {
  throw new Error('not implemented');
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
  throw new Error('not implemented');
}

module.exports = {
  runDailyDigestForAgent,
  runWeeklyDigestForOperator,
  // internal helpers exposed for unit testing
  gatherWindowData,
  categorizeRowsForDigest,
  renderSMS,
  renderEmail,
  renderWeeklyEmail,
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
  },
};
