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

// Imports added in later build steps as implementations land.

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
  const { intaken, followUpsFired, noiseFiltered } = systemHandled;
  const total = intaken + followUpsFired + noiseFiltered;
  const base = `Handled ${total} leads overnight: ${intaken} new, ${followUpsFired} follow-ups, ${noiseFiltered} filtered.`;
  return hasUrgent ? base : `${base} 0 need you today.`;
}

// Churn threshold description rendered at the bottom of every churn section.
const CHURN_CRITERIA = 'Criteria: needs_review unanswered >48h (High), no Sheet interaction >14d (High), pre-flight skips +50% WoW (Medium), aiEnabled toggled ≥3 rows (Medium), CALLED >5x (Low).';

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
async function runDailyDigestForAgent(agentConfig) {
  throw new Error('not implemented');
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
  throw new Error('not implemented');
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
    if (row.status === 'new' && isFalseFlag(row.aiEnabled)) {
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
    const lines = [
      `Leads intaken: ${sh.intaken}`,
      `Noise filtered: ${sh.noiseFiltered}`,
      `Business correspondence ignored: ${sh.businessIgnored}`,
      `HOT alerts sent: ${sh.hotAlerts}`,
      `Needs-review escalations: ${sh.needsReview}`,
      `Path 1B SMS round-trips completed: ${sh.path1bRoundTrips}`,
      `Follow-ups fired: ${sh.followUpsFired}`,
      `Pre-flight skips (you did it manually): ${sh.preflightSkips}`,
    ];
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
  throw new Error('not implemented');
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
};
