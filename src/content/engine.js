'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const { getNowDate, getNowIso }             = require('../time');
const { getStorageRoot }                    = require('../storagePaths');
const { currentWeek }                       = require('./cache');
const { readWeeklyAngles }                  = require('./angles');
const { readEvergreenAngles }               = require('./evergreenAngles');
const { readContentProfile }                = require('./profile');
const { readContentState, initBatch, buildAgentHistory, recordBatchSent } = require('./state');
const { selectDefaults }                    = require('./selectDefaults');
const { renderReelScript }                  = require('./renderReelScript');
const { renderInstagramCaption }            = require('./renderInstagramCaption');
const { renderBlogPost }                    = require('./renderBlogPost');
const { composeReviewEmail }                = require('./reviewEmail');
const { sendNewEmail }                      = require('../email');

// ── Skip-condition error (discriminated throw from gatherInputs) ──────────────

class SkipError extends Error {
  constructor(reason, extra = {}) {
    super(reason);
    this.name  = 'SkipError';
    this.reason = reason;
    Object.assign(this, extra);
  }
}

// ── Sleep helper ──────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Send helpers (retry + error log) ─────────────────────────────────────────

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
        console.log(`[content-engine:${label}] attempt ${attempts} failed: ${err.message}, retrying in ${delays[i]}ms`);
        await sleep(delays[i]);
      }
    }
  }
  console.log(`[content-engine:${label}] exhausted after 3 attempts. last error: ${lastError.message}`);
  return { ok: false, attempts: 3, lastError };
}

function _appendErrorLog(agentId, label, error) {
  const filepath = path.join(
    getStorageRoot(),
    `${agentId}.content-engine-errors.log`
  );
  try {
    const validationSuffix = (Array.isArray(error.validationErrors) && error.validationErrors.length > 0)
      ? ` | validationErrors: ${JSON.stringify(error.validationErrors)}`
      : '';
    const line = `[${getNowIso()}] ${label} exhausted: ${error.message}${validationSuffix}\n`;
    fs.appendFileSync(filepath, line, 'utf8');
  } catch (err) {
    console.log(`[content-engine] failed to append to ${filepath}: ${err.message}`);
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function assignPieceIds(picks) {
  const { reelDefaults, blogDefault } = picks;
  const assignments = [];
  if (reelDefaults[0]) {
    assignments.push({ pieceId: 'reel-001', type: 'reel', angle: reelDefaults[0] });
  }
  if (reelDefaults[1]) {
    assignments.push({ pieceId: 'reel-002', type: 'reel', angle: reelDefaults[1] });
  }
  if (blogDefault) {
    assignments.push({ pieceId: 'blog-001', type: 'blog', angle: blogDefault });
  }
  return assignments;
}

async function renderPiece(assignment, contentProfile) {
  if (assignment.type === 'reel') {
    const script = await renderReelScript({
      angle: assignment.angle,
      contentProfile,
    });
    const caption = await renderInstagramCaption({
      angle: assignment.angle,
      contentProfile,
      reelScript: script.text,
    });
    return {
      id: assignment.pieceId,
      type: 'reel',
      angle: assignment.angle,
      reel: { script, caption },
    };
  }
  const blog = await renderBlogPost({
    angle: assignment.angle,
    contentProfile,
  });
  return {
    id: assignment.pieceId,
    type: 'blog',
    angle: assignment.angle,
    blog,
  };
}

function assembleBatchObject({ agentConfig, weekIso, renderedPieces, picks, headsUp }) {
  return {
    agentProfile: {
      firstName: agentConfig.firstName || agentConfig.agentId,
    },
    weekIso,
    pieces: renderedPieces,
    otherAngles: picks.remaining.map(a => ({
      id: a.id,
      headline: a.headline,
      themeTag: a.themeTag,
    })),
    headsUp,
  };
}

async function gatherInputs(agentConfig, now) {
  const contentProfile = readContentProfile(agentConfig.agentId);
  if (!contentProfile.contentEngineEnabled) {
    throw new SkipError('disabled');
  }

  const weekIso = currentWeek(now ?? getNowDate());

  // Read both menus independently. A menu is "absent" if its reader returns
  // null or throws (missing/unreadable) -- this preserves the pre-evergreen
  // semantics per menu. 'no-angles' fires only when BOTH are absent.
  let marketMenu = null;
  try {
    marketMenu = await readWeeklyAngles(weekIso);
  } catch (err) {
    marketMenu = null;
  }

  let evergreenMenu = null;
  try {
    evergreenMenu = await readEvergreenAngles(weekIso);
  } catch (err) {
    evergreenMenu = null;
  }

  const marketAngles    = (marketMenu    && Array.isArray(marketMenu.angles))    ? marketMenu.angles    : [];
  const evergreenAngles = (evergreenMenu && Array.isArray(evergreenMenu.angles)) ? evergreenMenu.angles : [];

  if (marketMenu === null && evergreenMenu === null) {
    throw new SkipError('no-angles', { batchWeekIso: weekIso });
  }

  // Preserve the existing weeklyAngles object shape for downstream consumers,
  // but back its .angles with the concatenated market + evergreen list. Market
  // angles lead (commit 7 refines slot-based origin mix; commit 6 only merges).
  const weeklyAngles = {
    weekIso,
    angles: [...marketAngles, ...evergreenAngles],
  };

  const contentState = readContentState(agentConfig.agentId);
  const agentHistory = buildAgentHistory(agentConfig.agentId);

  if (contentState.batches[weekIso] && contentState.batches[weekIso].sentAt) {
    throw new SkipError('already-sent', { batchWeekIso: weekIso });
  }

  return { contentProfile, contentState, agentHistory, weekIso, weeklyAngles };
}

// ── Time gate ─────────────────────────────────────────────────────────────────

function shouldRunContentEngine(agentConfig, contentProfile, now, contentState) {
  const timezone = (agentConfig.timezone && String(agentConfig.timezone).trim()) || 'America/Toronto';

  // (a) Must be Monday in agent's local timezone
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
  }).format(now);
  if (weekday !== 'Monday') return false;

  const deliveryTime = (contentProfile.deliveryTime && String(contentProfile.deliveryTime).trim()) || '07:00';
  const colonIdx = deliveryTime.indexOf(':');
  const hh = parseInt(deliveryTime.slice(0, colonIdx), 10);
  const mm = parseInt(deliveryTime.slice(colonIdx + 1), 10);

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
  const lastRun = contentState && contentState.lastContentBatchSent;
  if (lastRun) {
    if (nowMs - new Date(lastRun).getTime() <= MS_6D) return false;
  }

  return true;
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function runContentEngineForAgent(agentConfig, options = {}) {
  const now = options.now ?? getNowDate();
  const operatorConfig = options.operatorConfig;
  if (!operatorConfig || typeof operatorConfig !== 'object') {
    throw new TypeError('runContentEngineForAgent requires options.operatorConfig');
  }
  if (agentConfig.isActive === false) {
    console.log(`[${agentConfig.agentId}] content engine: skipped (inactive)`);
    return { skipped: 'inactive' };
  }

  let inputs;
  try {
    inputs = await gatherInputs(agentConfig, now);
  } catch (err) {
    if (err instanceof SkipError) {
      if (err.reason === 'disabled') {
        console.log(`[${agentConfig.agentId}] content engine: skipped (disabled)`);
        return { skipped: 'disabled' };
      }
      if (err.reason === 'no-angles') {
        _appendErrorLog(agentConfig.agentId, 'angles-missing', err.cause || err);
        console.log(`[${agentConfig.agentId}] content engine: angles missing for ${err.batchWeekIso}, skipping`);
        return { skipped: 'no-angles', batchWeekIso: err.batchWeekIso };
      }
      if (err.reason === 'already-sent') {
        console.log(`[${agentConfig.agentId}] content engine: batch already sent for ${err.batchWeekIso}`);
        return { skipped: 'already-sent', batchWeekIso: err.batchWeekIso };
      }
    }
    throw err;
  }

  const { contentProfile, weekIso, weeklyAngles, agentHistory } = inputs;

  const picks = selectDefaults(weeklyAngles.angles, contentProfile, agentHistory);

  const pieceAssignments = assignPieceIds(picks);
  if (pieceAssignments.length === 0) {
    return {
      skipped: 'all-failed',
      ok: false,
      sent: false,
      batchWeekIso: weekIso,
      pieceResults: [],
      errors: [],
    };
  }

  const pieceResults  = [];
  const renderedPieces = [];
  const headsUp       = [];

  for (const assignment of pieceAssignments) {
    try {
      const piece = await renderPiece(assignment, contentProfile);
      renderedPieces.push(piece);
      pieceResults.push({
        pieceId: assignment.pieceId,
        type: assignment.type,
        status: 'ok',
        error: null,
        angleId: assignment.angle.id,
      });
    } catch (err) {
      pieceResults.push({
        pieceId: assignment.pieceId,
        type: assignment.type,
        status: 'failed',
        error: err.message,
        angleId: assignment.angle.id,
      });
      const what = assignment.type === 'reel' ? 'Reel' : 'Blog post';
      const num  = parseInt(assignment.pieceId.split('-')[1], 10);
      headsUp.push(`Couldn't generate ${what} #${num} this week.`);
      _appendErrorLog(agentConfig.agentId, `render-${assignment.pieceId}`, err);
    }
  }

  if (renderedPieces.length === 0) {
    _appendErrorLog(agentConfig.agentId, 'all-pieces-failed', new Error('All renderers failed'));
    return {
      skipped: 'all-failed',
      ok: false,
      sent: false,
      batchWeekIso: weekIso,
      pieceResults,
      errors: [],
    };
  }

  const piecesForState = renderedPieces.map(p => ({
    id: p.id,
    angleId: p.angle.id,
    themeTag: p.angle.themeTag,
    forbidsRateAdvice: p.angle.forbidsRateAdvice === true,
    initialVersion: {
      text: p.type === 'reel'
        ? p.reel.script.text + '\n\n---\n\n' + p.reel.caption.text
        : p.blog.text,
      generatedAt: p.type === 'reel'
        ? p.reel.script.generatedAt
        : p.blog.generatedAt,
      claudeCallId: null,
    },
  }));

  const availableAngles = weeklyAngles.angles;

  try {
    initBatch(agentConfig.agentId, weekIso, { pieces: piecesForState, availableAngles });
  } catch (err) {
    _appendErrorLog(agentConfig.agentId, 'state-init', err);
  }

  const batch = assembleBatchObject({ agentConfig, weekIso, renderedPieces, picks, headsUp });
  const { subject, text, html } = composeReviewEmail(batch);

  const dryRun = options.dryRun === true;
  const contentEngineMode = contentProfile.contentEngineMode || 'shadow';

  let to, cc;
  if (dryRun) {
    to = [operatorConfig.operatorEmail || agentConfig.escalationEmail];
    cc = undefined;
  } else if (contentEngineMode === 'shadow') {
    to = [agentConfig.gmailAddress];
    cc = [operatorConfig.operatorEmail || agentConfig.escalationEmail];
  } else {
    to = [agentConfig.gmailAddress];
    cc = undefined;
  }

  const sendFn = async () => {
    await sendNewEmail(agentConfig, {
      to: to.join(','),
      cc: cc ? cc.join(',') : undefined,
      subject,
      body: text,
      html,
    });
  };

  const sendResult = await _sendWithRetry(sendFn, 'content-batch');

  if (sendResult.ok) {
    if (!dryRun) {
      const sentAt = now.toISOString();
      await recordBatchSent(agentConfig.agentId, weekIso, sentAt);
    }
    console.log(`[${agentConfig.agentId}] content engine: batch sent for ${weekIso}`);
    return {
      ok: true,
      sent: true,
      batchWeekIso: weekIso,
      pieceResults,
      errors: [],
    };
  }

  _appendErrorLog(agentConfig.agentId, 'send-email', sendResult.lastError);
  return {
    ok: false,
    sent: false,
    batchWeekIso: weekIso,
    pieceResults,
    errors: [{ phase: 'send-email', message: sendResult.lastError.message }],
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  runContentEngineForAgent,
  shouldRunContentEngine,
  _internal: {
    gatherInputs,
    assignPieceIds,
    renderPiece,
    assembleBatchObject,
    _sendWithRetry,
    _appendErrorLog,
  },
};
