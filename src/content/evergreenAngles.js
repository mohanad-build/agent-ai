'use strict';

const fs   = require('node:fs/promises');
const path = require('node:path');

const claude  = require('../claude');
const { MODELS } = claude;
const { currentWeek } = require('./cache');
const { TOPIC_BANK, selectWeeklyTopics, bankVersion } = require('./topicBank');
const { getStorageRoot } = require('../storagePaths');
const { VALID_THEME_TAGS } = require('./_shared');
const { _internal: anglesInternal } = require('./angles');

const { validateWeekIso, weekStartIso } = anglesInternal;

// ── Error class ───────────────────────────────────────────────────────────────

class EvergreenAngleGenerationError extends Error {
  constructor(message, { cause, rejectedCount, validCount } = {}) {
    super(message);
    this.name = 'EvergreenAngleGenerationError';
    if (cause !== undefined) this.cause = cause;
    if (rejectedCount !== undefined) this.rejectedCount = rejectedCount;
    if (validCount !== undefined) this.validCount = validCount;
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_AUDIENCE_FOCUS = new Set(['buyers', 'sellers', 'both']);

const VALID_BEST_SUITED_FOR = new Set(['reel', 'blog']);

const EVERGREEN_ANGLE_ID_RE = /^angle-evg-\d{4}-W(0[1-9]|[1-4]\d|5[0-3])-\d{3}$/;

const DEFAULT_SLOT_COUNT = 3;

// ── Evergreen angles file path ────────────────────────────────────────────────

function evergreenAnglesFilePath(baseDir, weekIso) {
  return path.join(baseDir, '_evergreen', '_angles', `${weekIso}.json`);
}

// ── readEvergreenAngles ───────────────────────────────────────────────────────

async function readEvergreenAngles(weekIso, opts = {}) {
  validateWeekIso(weekIso);
  const baseDir = opts.baseDir || getStorageRoot();
  const filePath = evergreenAnglesFilePath(baseDir, weekIso);
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  // Propagate JSON parse errors (corruption-loud), same contract as readWeeklyAngles.
  return JSON.parse(raw);
}

// ── validateEvergreenAngle ────────────────────────────────────────────────────
//
// The evergreen-origin counterpart to angles.js's validateAngle. Deliberately
// STRICT about the sourceless contract (sourceFooter must be null, dataPoints
// must be empty, forbidsRateAdvice must be false): an evergreen angle that
// carries a source or a rate stance is market-shaped and must be rejected
// rather than silently accepted.

function validateEvergreenAngle(angle) {
  const errors = [];

  if (angle == null || typeof angle !== 'object') {
    return { valid: false, errors: ['angle must be a non-null object'] };
  }

  if (angle.origin !== 'evergreen') {
    errors.push('origin: must be "evergreen"');
  }

  if (typeof angle.id !== 'string' || !EVERGREEN_ANGLE_ID_RE.test(angle.id)) {
    errors.push('id: must match angle-evg-YYYY-WNN-NNN format');
  }

  if (typeof angle.weekStartIso !== 'string' || angle.weekStartIso.trim() === '') {
    errors.push('weekStartIso: required non-empty string');
  }

  if (typeof angle.headline !== 'string' || angle.headline.trim() === '') {
    errors.push('headline: required non-empty string');
  }

  if (typeof angle.thesis !== 'string' || angle.thesis.trim() === '') {
    errors.push('thesis: required non-empty string');
  }

  if (angle.sourceFooter !== null) {
    errors.push('sourceFooter: must be null for an evergreen angle');
  }

  if (!Array.isArray(angle.dataPoints) || angle.dataPoints.length !== 0) {
    errors.push('dataPoints: must be an empty array for an evergreen angle');
  }

  if (!VALID_THEME_TAGS.has(angle.themeTag)) {
    errors.push(`themeTag: must be one of ${[...VALID_THEME_TAGS].join(', ')}`);
  }

  if (!VALID_AUDIENCE_FOCUS.has(angle.audienceFocus)) {
    errors.push(`audienceFocus: must be one of ${[...VALID_AUDIENCE_FOCUS].join(', ')}`);
  }

  if (!Array.isArray(angle.bestSuitedFor) || angle.bestSuitedFor.length === 0) {
    errors.push('bestSuitedFor: required non-empty array');
  } else {
    for (let i = 0; i < angle.bestSuitedFor.length; i++) {
      if (!VALID_BEST_SUITED_FOR.has(angle.bestSuitedFor[i])) {
        errors.push(`bestSuitedFor[${i}]: must be one of ${[...VALID_BEST_SUITED_FOR].join(', ')}`);
      }
    }
  }

  if (typeof angle.surpriseScore !== 'number' || angle.surpriseScore < 0 || angle.surpriseScore > 1) {
    errors.push('surpriseScore: must be a number between 0 and 1 inclusive');
  }

  if (typeof angle.longFormSuitable !== 'boolean') {
    errors.push('longFormSuitable: must be a boolean');
  }

  if (angle.forbidsRateAdvice !== false) {
    errors.push('forbidsRateAdvice: must be false for an evergreen angle');
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ── buildEvergreenAngleGenerationPrompt ───────────────────────────────────────

const SYSTEM_PROMPT = `You expand real estate micro topic "takes" into publish ready headline and thesis pairs for a Canadian real estate agent's short form content.

Return ONLY valid JSON in this exact shape:

{
  "angles": {
    "<seedId>": { "headline": "...", "thesis": "..." },
    ...
  }
}

One entry per input seedId. No preamble. No markdown fences. No explanation outside the JSON object.

RULES:
- headline is a tight hook, not a full sentence. A trailing period is not required.
- thesis is one to two sentences restating the take's claim in the agent's professional voice.
- Introduce NO new facts, NO statistics, NO numbers, and NO rate advice.
- Do not use em-dashes or en-dashes anywhere in string values, use commas or periods instead.
- Do not invent sources or citations.
- The take is ground truth. Expand it. Do not contradict it.`;

function buildEvergreenAngleGenerationPrompt(slots) {
  const items = slots.map(slot => ({
    seedId:        slot.seed.id,
    topicId:       slot.topicId,
    take:          slot.seed.take,
    audienceFocus: slot.seed.audienceFocus,
    bestSuitedFor: slot.seed.bestSuitedFor,
    themeTag:      slot.entry.themeTag,
  }));

  const user =
    `Expand these evergreen content seeds into headline and thesis pairs.\n\n` +
    JSON.stringify(items, null, 2);

  return { system: SYSTEM_PROMPT, user };
}

// ── generateEvergreenAngles ───────────────────────────────────────────────────

async function generateEvergreenAngles(opts = {}) {
  const now     = opts.now     ? (opts.now instanceof Date ? opts.now : new Date(opts.now)) : new Date();
  const baseDir = opts.baseDir || getStorageRoot();
  const callRaw = opts.callRaw || claude.callRaw;

  // Resolve and validate weekIso (identical to generateWeeklyAngles).
  let weekIso;
  if (opts.weekIso !== undefined) {
    validateWeekIso(opts.weekIso);
    weekIso = opts.weekIso;
  } else {
    weekIso = currentWeek(now);
  }

  const filePath = evergreenAnglesFilePath(baseDir, weekIso);

  // No data slice and no metric-count gate here (DIVERGENCE from market):
  // evergreen content has no upstream data dependency, so there is nothing
  // to be insufficient.

  const count = opts.count != null ? opts.count : DEFAULT_SLOT_COUNT;
  const slots = selectWeeklyTopics(weekIso, count, { entries: TOPIC_BANK });
  if (slots.length === 0) {
    throw new EvergreenAngleGenerationError(
      'no topics selected for week (bank/season misconfiguration)',
      { weekIso }
    );
  }

  const bankVer = bankVersion();

  // Idempotency check (DIVERGENCE from market: keyed on bankVersion rather than
  // dataSliceFingerprint, since evergreen has no data slice to fingerprint. The
  // topic bank content itself is the only thing that can make a cached menu
  // stale).
  if (opts.force !== true) {
    let existing = null;
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      existing = JSON.parse(raw);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (existing && existing.bankVersion === bankVer) {
      return {
        angles:       existing.angles,
        weekIso,
        generatedAt:  existing.generatedAt,
        bankVersion:  bankVer,
        regenerated:  false,
      };
    }
  }

  // Build prompt
  const { system, user } = buildEvergreenAngleGenerationPrompt(slots);

  // Two-attempt generation loop (outer: too-few-valid-angles; inner: parse failures).
  // Cloned from generateWeeklyAngles's retry shape.
  let lastRejectedCount = 0;

  for (let outerAttempt = 1; outerAttempt <= 2; outerAttempt++) {
    // Parse with one retry
    let parsed = null;
    let parseError = null;

    for (let parseAttempt = 1; parseAttempt <= 2; parseAttempt++) {
      let raw;
      try {
        // maxTokens 2048 (smaller than market's 4096, DIVERGENCE: output here is
        // only headline/thesis pairs, not full angle objects with dataPoints).
        raw = await callRaw({ system, user, model: MODELS.SONNET, maxTokens: 2048 });
      } catch (err) {
        throw err;
      }

      let cleaned = raw.trim();
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

      try {
        parsed = JSON.parse(cleaned);
        parseError = null;
        break;
      } catch (err) {
        parseError = err;
        if (parseAttempt === 1) continue;
        throw new EvergreenAngleGenerationError(
          'Claude response could not be parsed as JSON after 2 attempts',
          { cause: err }
        );
      }
    }

    if (parsed === null) {
      throw new EvergreenAngleGenerationError(
        'Claude response could not be parsed as JSON after 2 attempts',
        { cause: parseError }
      );
    }

    // Assemble angles: one per slot, in slot order, dropping any slot whose
    // seedId is missing from the response or whose headline/thesis are empty.
    const parsedAngles = (parsed.angles && typeof parsed.angles === 'object') ? parsed.angles : {};

    const assembled = [];
    for (const slot of slots) {
      const pair = parsedAngles[slot.seed.id];
      const headline = pair && typeof pair.headline === 'string' ? pair.headline.trim() : '';
      const thesis   = pair && typeof pair.thesis   === 'string' ? pair.thesis.trim()   : '';
      if (headline === '' || thesis === '') continue;

      assembled.push({
        origin:            'evergreen',
        weekStartIso:      weekStartIso(weekIso),
        headline,
        thesis,
        dataPoints:        [],
        themeTag:          slot.entry.themeTag,
        audienceFocus:     slot.seed.audienceFocus,
        bestSuitedFor:      slot.seed.bestSuitedFor,
        surpriseScore:     slot.seed.baseInterest,
        longFormSuitable:  slot.seed.longFormSuitable,
        sourceFooter:      null,
        forbidsRateAdvice: false,
      });
    }

    // Validate every assembled angle (still without an id, so id shape cannot
    // yet pass) against everything but the id field, by validating a copy that
    // carries a placeholder id, then assign contiguous ids ONLY to survivors so
    // a dropped angle never leaves a gap in the NNN sequence, then re-validate
    // the final object (this also proves the id shape itself is correct).
    const rejectedReasons = [];
    const preValidated = [];
    for (const angle of assembled) {
      const probe = { ...angle, id: `angle-evg-${weekIso}-000` };
      const result = validateEvergreenAngle(probe);
      if (result.valid) {
        preValidated.push(angle);
      } else {
        rejectedReasons.push(...result.errors);
      }
    }

    const validAngles = [];
    for (let i = 0; i < preValidated.length; i++) {
      const id = `angle-evg-${weekIso}-${String(i + 1).padStart(3, '0')}`;
      const finalAngle = { ...preValidated[i], id };
      const result = validateEvergreenAngle(finalAngle);
      if (result.valid) {
        validAngles.push(finalAngle);
      } else {
        rejectedReasons.push(...result.errors);
      }
    }

    const rejectedCount = (slots.length - validAngles.length);
    lastRejectedCount = rejectedCount;

    if (rejectedCount > 0) {
      console.warn(
        `[evergreenAngles] ${rejectedCount} slot(s) rejected. ` +
        `Reasons: ${[...new Set(rejectedReasons)].join('; ')}`
      );
    }

    // Terminal floor: >= 1 valid angle (DIVERGENCE from market's >= 2). A single
    // evergreen angle is still a usable swap-menu entry, and the slot-based mix
    // (commit 7) needs only one evergreen candidate per week to function.
    if (validAngles.length >= 1) {
      const generatedAt = new Date().toISOString();
      const menu = {
        weekIso,
        generatedAt,
        modelUsed:   MODELS.SONNET,
        bankVersion: bankVer,
        angles:      validAngles,
      };

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const tmp = filePath + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(menu, null, 2), 'utf8');
      await fs.rename(tmp, filePath);

      return {
        angles:       validAngles,
        weekIso,
        generatedAt,
        bankVersion: bankVer,
        regenerated:  true,
      };
    }

    // Not enough valid angles -- retry once
    if (outerAttempt === 1) {
      console.warn(
        `[evergreenAngles] 0 valid angle(s) after attempt ${outerAttempt}; retrying.`
      );
      continue;
    }
  }

  throw new EvergreenAngleGenerationError(
    'fewer than 1 valid evergreen angle after 2 attempts',
    { rejectedCount: lastRejectedCount, validCount: 0 }
  );
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  generateEvergreenAngles,
  readEvergreenAngles,
  EvergreenAngleGenerationError,
  EVERGREEN_ANGLE_ID_RE,
  evergreenAnglesFilePath,
  _internal: {
    validateEvergreenAngle,
    buildEvergreenAngleGenerationPrompt,
  },
};
