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
 * Pure function. Takes rows from gatherWindowData and bucketizes them into the
 * sections the renderers expect. Each row may appear in multiple sections
 * (e.g. a HOT lead is both "urgent" and "hotLeads"). See spec 4.1 for the
 * canonical daily section list and 5.1 for the weekly section list.
 *
 * @param {object[]} rows
 * @param {Date} now
 * @returns {{
 *   urgent: object[],
 *   hotLeads: object[],
 *   newToReview: object[],
 *   followUpsDue: object[],
 *   followUpsFiredOvernight: object[],
 *   systemHandled: {intaken: number, noiseFiltered: number, businessIgnored: number, hotAlerts: number, needsReview: number, path1bRoundTrips: number, followUpsFired: number, preflightSkips: number},
 *   reliability: {errors: number, retries: number, threadingSkipped: number}
 * }}
 */
function categorizeRowsForDigest(rows, now) {
  throw new Error('not implemented');
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
  throw new Error('not implemented');
}

/**
 * Pure function. Produces the plaintext email body per spec section 4.1.
 * Empty sections are omitted except "What the system handled" (always renders).
 * Section ordering is fixed.
 *
 * @param {object} sections  the shape returned by categorizeRowsForDigest
 * @param {object} agentConfig  for name, timezone, sheet id (deep links)
 * @returns {{subject: string, body: string}}
 */
function renderEmail(sections, agentConfig) {
  throw new Error('not implemented');
}

/**
 * Pure function. Produces the operator weekly email body per spec section 5.1.
 *
 * @param {object} aggregateStats  cross-agent rollup
 * @param {object[]} perAgentSections  one per agent
 * @param {object[]} agentConfigs
 * @returns {{subject: string, body: string}}
 */
function renderWeeklyEmail(aggregateStats, perAgentSections, agentConfigs) {
  throw new Error('not implemented');
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
