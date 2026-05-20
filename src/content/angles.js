'use strict';

const crypto = require('node:crypto');
const fs     = require('node:fs/promises');
const path   = require('node:path');

const claude  = require('../claude');
const { resolveMetricPolicy, UnknownMetricError } = require('./sources');
const { currentWeek } = require('./cache');

const { MODELS } = claude;

// ── Error class ───────────────────────────────────────────────────────────────

class AngleGenerationError extends Error {
  constructor(message, { cause, rejectedCount, validCount } = {}) {
    super(message);
    this.name = 'AngleGenerationError';
    if (cause !== undefined) this.cause = cause;
    if (rejectedCount !== undefined) this.rejectedCount = rejectedCount;
    if (validCount !== undefined) this.validCount = validCount;
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_THEME_TAGS = new Set([
  'rates', 'supply', 'prices', 'sales_volume',
  'buyer_psychology', 'seller_psychology', 'regulation', 'economy',
]);

const VALID_AUDIENCE_FOCUS = new Set(['buyers', 'sellers', 'both']);

const VALID_BEST_SUITED_FOR = new Set(['reel', 'blog']);

const ANGLE_ID_RE = /^angle-\d{4}-W(0[1-9]|[1-4]\d|5[0-3])-\d{3}$/;

const WEEK_ISO_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;

// ── validateWeekIso ───────────────────────────────────────────────────────────

function validateWeekIso(weekIso) {
  if (!WEEK_ISO_RE.test(weekIso)) {
    throw new Error(`validateWeekIso: malformed weekIso "${weekIso}"`);
  }
}

// ── validateAngle ─────────────────────────────────────────────────────────────

function validateAngle(angle) {
  const errors = [];

  if (angle == null || typeof angle !== 'object') {
    return { valid: false, errors: ['angle must be a non-null object'] };
  }

  // id
  if (typeof angle.id !== 'string' || !ANGLE_ID_RE.test(angle.id)) {
    errors.push('id: must match angle-YYYY-WNN-NNN format');
  }

  // weekStartIso
  if (typeof angle.weekStartIso !== 'string' || angle.weekStartIso.trim() === '') {
    errors.push('weekStartIso: required non-empty string');
  }

  // headline
  if (typeof angle.headline !== 'string' || angle.headline.trim() === '') {
    errors.push('headline: required non-empty string');
  }

  // thesis
  if (typeof angle.thesis !== 'string' || angle.thesis.trim() === '') {
    errors.push('thesis: required non-empty string');
  }

  // dataPoints
  if (!Array.isArray(angle.dataPoints) || angle.dataPoints.length === 0) {
    errors.push('dataPoints: required non-empty array');
  } else {
    for (let i = 0; i < angle.dataPoints.length; i++) {
      const dp = angle.dataPoints[i];
      if (dp == null || typeof dp !== 'object') {
        errors.push(`dataPoints[${i}]: must be an object`);
        continue;
      }
      if (typeof dp.metric !== 'string' || dp.metric.trim() === '') {
        errors.push(`dataPoints[${i}].metric: required non-empty string`);
      } else {
        try {
          resolveMetricPolicy(dp.metric);
        } catch (err) {
          if (err instanceof UnknownMetricError) {
            errors.push(`dataPoints[${i}].metric: unknown metric '${dp.metric}'`);
          } else {
            throw err;
          }
        }
      }
      if (typeof dp.asOf !== 'string' || dp.asOf.trim() === '') {
        errors.push(`dataPoints[${i}].asOf: required non-empty string`);
      }
    }
  }

  // themeTag
  if (!VALID_THEME_TAGS.has(angle.themeTag)) {
    errors.push(`themeTag: must be one of ${[...VALID_THEME_TAGS].join(', ')}`);
  }

  // audienceFocus
  if (!VALID_AUDIENCE_FOCUS.has(angle.audienceFocus)) {
    errors.push(`audienceFocus: must be one of ${[...VALID_AUDIENCE_FOCUS].join(', ')}`);
  }

  // bestSuitedFor
  if (!Array.isArray(angle.bestSuitedFor) || angle.bestSuitedFor.length === 0) {
    errors.push('bestSuitedFor: required non-empty array');
  } else {
    for (let i = 0; i < angle.bestSuitedFor.length; i++) {
      if (!VALID_BEST_SUITED_FOR.has(angle.bestSuitedFor[i])) {
        errors.push(`bestSuitedFor[${i}]: must be one of ${[...VALID_BEST_SUITED_FOR].join(', ')}`);
      }
    }
  }

  // surpriseScore
  if (typeof angle.surpriseScore !== 'number' || angle.surpriseScore < 0 || angle.surpriseScore > 1) {
    errors.push('surpriseScore: must be a number between 0 and 1 inclusive');
  }

  // longFormSuitable
  if (typeof angle.longFormSuitable !== 'boolean') {
    errors.push('longFormSuitable: must be a boolean');
  }

  // forbidsRateAdvice
  if (typeof angle.forbidsRateAdvice !== 'boolean') {
    errors.push('forbidsRateAdvice: must be a boolean');
  }

  // sourceFooter
  if (typeof angle.sourceFooter !== 'string' || angle.sourceFooter.trim() === '') {
    errors.push('sourceFooter: required non-empty string');
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ── hashDataSlice ─────────────────────────────────────────────────────────────

function stableStringify(val) {
  if (val === null || typeof val !== 'object' || Array.isArray(val)) {
    return JSON.stringify(val);
  }
  const keys = Object.keys(val).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(val[k])).join(',') + '}';
}

function hashDataSlice(slice) {
  // Exclude generatedAt so the hash is stable across repeated calls for same data.
  const { generatedAt: _omit, ...rest } = slice;
  return crypto.createHash('sha256').update(stableStringify(rest)).digest('hex').slice(0, 16);
}

// ── Week-start ISO helper ─────────────────────────────────────────────────────

function weekStartIso(weekIso) {
  // Parse YYYY-WNN into the Monday date in UTC.
  const [yearStr, weekStr] = weekIso.split('-W');
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);

  // Jan 4 is always in week 1. Find week-1 Monday.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = (jan4.getUTCDay() + 6) % 7; // 0=Mon
  const week1Monday = new Date(jan4.getTime() - jan4Day * 86400000);

  const monday = new Date(week1Monday.getTime() + (week - 1) * 7 * 86400000);
  return monday.toISOString().replace(/\.\d{3}Z$/, '.000Z').replace('T00:00:00.000Z', 'T00:00:00Z');
}

// ── gatherDataSlice ───────────────────────────────────────────────────────────

async function gatherDataSlice({ weekIso, now, baseDir }) {
  const nowDate = (now instanceof Date) ? now : new Date(now);
  const nowMs   = nowDate.getTime();
  const windowEndIso   = nowDate.toISOString();
  const windowStartMs  = nowMs - 14 * 24 * 60 * 60 * 1000;
  const windowStartIso = new Date(windowStartMs).toISOString();
  const generatedAt    = windowEndIso;

  const regions = ['canada', 'toronto'];
  // metric name -> { observations: [], source, sourceUrl, unit, policy }
  const metricMap = {};

  // Walk snapshot files for each region
  for (const region of regions) {
    const regionDir = path.join(baseDir, 'data', 'market', region);
    let entries;
    try {
      entries = await fs.readdir(regionDir);
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }

    // Collect all json files (monthly YYYY-MM.json and weekly YYYY-WNN.json)
    const jsonFiles = entries.filter(f => f.endsWith('.json'));

    for (const file of jsonFiles) {
      const filePath = path.join(regionDir, file);
      let raw;
      try {
        raw = await fs.readFile(filePath, 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT') continue;
        throw err;
      }
      // Propagate JSON parse errors (corruption-loud)
      const points = JSON.parse(raw);

      for (const point of points) {
        const metricName = point.metric;
        if (!metricName) continue;

        // Look up policy; skip silently if unregistered (open-world)
        let policy;
        try {
          policy = resolveMetricPolicy(metricName);
        } catch (err) {
          if (err instanceof UnknownMetricError) continue;
          throw err;
        }

        if (!metricMap[metricName]) {
          metricMap[metricName] = {
            source: point.source,
            sourceUrl: point.sourceUrl,
            unit: point.unit,
            policy,
            observations: [],
          };
        }

        // Store all observations with their timestamp for later windowing
        metricMap[metricName].observations.push({
          value:      point.value,
          asOf:       point.asOf,
          confidence: point.confidence,
          source:     point.source,
          sourceUrl:  point.sourceUrl,
          unit:       point.unit,
        });
      }
    }
  }

  // Build final slice metrics
  const metrics = {};

  for (const [metricName, info] of Object.entries(metricMap)) {
    const { policy } = info;
    const allObs = info.observations;

    // Sort all observations by asOf ascending
    allObs.sort((a, b) => new Date(a.asOf).getTime() - new Date(b.asOf).getTime());

    // In-window observations
    const inWindow = allObs.filter(o => {
      const t = new Date(o.asOf).getTime();
      return t >= windowStartMs && t <= nowMs;
    });

    // Most recent observation overall (may be outside window for event-driven)
    let mostRecent = null;
    if (inWindow.length > 0) {
      mostRecent = inWindow[inWindow.length - 1];
    } else if (policy.refreshCadence === 'event_driven' && allObs.length > 0) {
      // Pull the most recent overall for event-driven metrics even if outside 14d window
      mostRecent = allObs[allObs.length - 1];
    }

    if (!mostRecent) continue;

    let obsToInclude;
    if (policy.refreshCadence === 'event_driven') {
      const stalenessWindowMs = policy.staleThresholdDays * 86400000;
      const stalenessStartMs = nowMs - stalenessWindowMs;
      const withinStaleness = allObs.filter(o => new Date(o.asOf).getTime() >= stalenessStartMs);
      obsToInclude = withinStaleness.length > 0 ? withinStaleness : [mostRecent];
    } else {
      obsToInclude = inWindow;
    }
    obsToInclude = obsToInclude.slice().sort((a, b) => new Date(a.asOf).getTime() - new Date(b.asOf).getTime());

    const currentValue = mostRecent.value;
    const currentAsOf  = mostRecent.asOf;

    // Update source metadata from most recent observation
    const latestSource    = mostRecent.source    || info.source;
    const latestSourceUrl = mostRecent.sourceUrl || info.sourceUrl;
    const latestUnit      = mostRecent.unit       || info.unit;

    let delta7d  = null;
    let delta14d = null;
    let note     = null;

    if (policy.refreshCadence === 'daily') {
      // Find closest observation to now - 7d / now - 14d.
      // Exclude the current observation so a single-point window produces null.
      const refCandidates = inWindow.filter(o => o.asOf !== currentAsOf);
      const target7d  = nowMs - 7  * 24 * 60 * 60 * 1000;
      const target14d = nowMs - 14 * 24 * 60 * 60 * 1000;

      const closest7d  = findClosestObservation(refCandidates, target7d);
      const closest14d = findClosestObservation(refCandidates, target14d);

      if (closest7d !== null)  delta7d  = currentValue - closest7d.value;
      if (closest14d !== null) delta14d = currentValue - closest14d.value;
    } else {
      // event_driven: deltas always null, build note
      const asOfMs  = new Date(currentAsOf).getTime();
      const daysAgo = Math.round((nowMs - asOfMs) / (24 * 60 * 60 * 1000));
      const dateStr = new Date(currentAsOf).toISOString().slice(0, 10);
      note = `Event-driven metric; last change ${dateStr} (${daysAgo} days ago). Treat duration of stability as story signal.`;
    }

    metrics[metricName] = {
      source:          latestSource,
      sourceUrl:       latestSourceUrl,
      unit:            latestUnit,
      refreshCadence:  policy.refreshCadence,
      observations:    obsToInclude.map(o => ({
        value:      o.value,
        asOf:       o.asOf,
        confidence: o.confidence,
      })),
      currentValue,
      currentAsOf,
      delta7d,
      delta14d,
      note,
    };
  }

  return {
    generatedAt,
    weekIso,
    windowStartIso,
    windowEndIso,
    metrics,
  };
}

function findClosestObservation(observations, targetMs) {
  if (!observations || observations.length === 0) return null;
  let best = null;
  let bestDist = Infinity;
  for (const obs of observations) {
    const t = new Date(obs.asOf).getTime();
    const dist = Math.abs(t - targetMs);
    if (dist < bestDist) {
      bestDist = dist;
      best = obs;
    }
  }
  return best;
}

// ── buildAngleGenerationPrompt ────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior business journalist covering Canadian real estate and personal finance.

Your job is to identify 5-8 candidate content angles from a 14-day window of market data. Each angle should be a specific, story-driven framing, not a generic restatement of the data.

CALIBRATION ON SURPRISE SCORES:
Be ruthless. Most weeks have 1-2 angles above 0.7 surpriseScore and the rest below.

Score anchors with examples:
- 0.85-1.00: Genuinely unusual findings. A cross-source contradiction (policy rate held while bond yield falls 35+ bps in the same window). A milestone event (first rate cut after a long hold). A reversal that breaks a clear prior trend. Cite the specific pattern in your thesis.
- 0.70-0.85: A move large enough to be worth a story but not unprecedented. A 25-30bps yield move in two weeks. A rate cut that was expected but still confirms a direction. Strong but not anomalous. Requires that SOMETHING HAPPENED in the window of meaningful magnitude. Cross-source framing on a small move (e.g., "yields creep up while BoC stays frozen" with a 4bps shift) does NOT belong here; the framing is interesting but the magnitude is routine. Score it in the 0.40-0.55 band based on magnitude, not framing.
- 0.50-0.70: Routine but worth noting. A 10-20bps yield move. A duration-of-stability angle when the duration is unusual (e.g., 200 days without a rate move). Duration-of-stability is framing, not news. A rate that has held for 200 days has by definition not moved in the window; that is the opposite of an event. The unusualness of the hold is a real story-framing signal worth a 0.55-0.65 score, but it is NOT a 0.70+ angle because nothing happened. The 0.70+ band requires that something happened in the window with meaningful magnitude. If you are tempted to score a duration-of-stability angle above 0.65, you are conflating interesting framing with newsworthy event.
- Below 0.50: Routine weekly drift. A 4-8bps yield move. A hold extending into another week with no other signal.

Do not cluster scores in a narrow band. If three angles all score 0.65-0.75, you have probably failed to discriminate. Force yourself to push the strongest angle higher and the weakest lower until the distribution reflects real differences in story strength.

QUALITY OVER QUANTITY:
If the week genuinely has fewer than 5 strong angles, return 3 strong angles rather than padding with 5 weak ones. If it has fewer than 3, return 2. Floor is 2. Do not pad.

EVENT-DRIVEN METRICS:
Some metrics (e.g., boc_overnight_rate, boc_last_decision_date) have refreshCadence "event_driven". Their asOf dates may be many months old; this is normal. Time-since-last-event is itself a story signal. The "note" field on these metrics tells you how old the most recent value is.

CONSTRAINTS:
- Do not invent statistics. Every dataPoint reference must use a metric name present in the input slice.
- Do not invent historical comparisons. Phrases like "lowest since [year]", "first time since [event]", "in recent memory" are FORBIDDEN unless the input slice contains observations from that comparison period.
- Do not characterize policy direction with named cycles. Phrases like "easing cycle", "tightening cycle", "post-pandemic tightening", "unwinding" are FORBIDDEN unless the slice contains at least 4 observations of the relevant metric showing the named direction.
- Do not reference levels you cannot ground in the slice. Phrases like "neutral range", "midpoint of", "below the neutral rate" are FORBIDDEN because the slice does not define these reference points.
- Do not describe market behavior that did not occur in the data. If observations show 2.95 on May 14 and 2.85 on May 17, do NOT write "the yield briefly converged" or "closed slightly above" without observations at those intermediate points.
- Every thesis claim must be auditable against a specific dataPoint. If you cannot point to the observation that supports a sentence, delete the sentence.
- Do not attribute quotes to real people (bank economists, journalists, analysts).
- forbidsRateAdvice: true on any angle that touches mortgage rates, BoC rates, or borrowing decisions.
- Build sourceFooter as a clean citation list of the form "<Source Name> (<Month Day Year of asOf>), ...". One entry per unique source in dataPoints. Do NOT prefix with "Sources:" — the label is added by downstream renderers and the review email.

OUTPUT FORMAT:
Return ONLY valid JSON in this exact shape:

{
  "angles": [
    {
      "id": "angle-<weekIso>-001",
      "weekStartIso": "<ISO of Monday of weekIso>",
      "headline": "...",
      "thesis": "...",
      "dataPoints": [{"metric": "...", "asOf": "..."}],
      "themeTag": "rates|supply|prices|sales_volume|buyer_psychology|seller_psychology|regulation|economy",
      "audienceFocus": "buyers|sellers|both",
      "bestSuitedFor": ["reel"|"blog", ...],
      "surpriseScore": 0.0 to 1.0,
      "longFormSuitable": true|false,
      "forbidsRateAdvice": true|false,
      "sourceFooter": "..."
    }
  ]
}

No preamble. No markdown fences. No em-dashes anywhere in string values (use commas or periods). No explanation outside the JSON object.

THEME TAG GUIDANCE:
- rates: anything about BoC rates, mortgage rates, bond yields
- supply: housing supply, inventory, new construction, building permits
- prices: HPI movements, sale prices, valuation
- sales_volume: transaction counts, market activity
- buyer_psychology: buyer behavior, FOMO, hesitation, demand shifts
- seller_psychology: seller behavior, listing decisions, price reductions
- regulation: policy changes, government interventions, tax changes
- economy: CPI, employment, GDP, broader economic signals

AUDIENCE FOCUS GUIDANCE:
Pick one of buyers, sellers, or both. "Both" is the wrong default. Use it only when the angle genuinely affects buyers and sellers in roughly equal proportion AND in directionally consistent ways.

- "buyers": falling rates, expanding affordability, increased inventory, falling prices, easier qualification. Even if sellers care about these too, the angle's narrative serves a buyer's decision.
- "sellers": rising rates that cool demand, falling listings volume, market-shift signals affecting list-price strategy, time-on-market increases. The narrative serves a seller's decision.
- "both": macro structural angles (yield curve inversions, BoC policy direction itself as a topic, regulatory shifts). Reserve for cases where collapsing to one side would meaningfully distort the angle.

If you are about to write "both" because the data is ambiguous about who cares more, you are hedging. Pick one.

BEST SUITED FOR GUIDANCE:
Pick a single format unless the angle genuinely works in both with no significant rewrite.

- ["reel"]: hook-driven, single statistic that flips a viewer's frame, works in 30 seconds. Examples: "37 basis points in two weeks," "200 days without a move," "rate cut on a Tuesday." Strong reel-only angles use punchy headlines and don't need multi-source synthesis.
- ["blog"]: requires 400-800 words of context, multi-source synthesis, multi-step reasoning the audience must follow. Examples: cross-source contradictions where the reader needs to understand why both signals matter, complex regulatory analyses, multi-metric trend syntheses.
- ["reel", "blog"]: ONLY when the same data point sustains both a 30-second hook AND 600 words of context without one feeling like a stretch.

If you are tagging an angle ["reel", "blog"] because you are not sure which is better, you are hedging. Pick the stronger one.

LONG FORM SUITABLE:
- true when the angle has enough depth and context to sustain a 600-800 word blog post
- false for punchy, single-point angles that thin out in long form
- This is independent of bestSuitedFor. An angle can be bestSuitedFor: ["reel", "blog"] and still longFormSuitable: false (it would render thinly as a blog). longFormSuitable specifically gates blog default-pick in step 5c.`;

function buildAngleGenerationPrompt(slice) {
  const user =
    `Generate weekly angles for ISO week ${slice.weekIso}.\n\n` +
    `Data slice (last 14 days):\n\n` +
    JSON.stringify(slice, null, 2);

  return { system: SYSTEM_PROMPT, user };
}

// ── Angles file path ──────────────────────────────────────────────────────────

function anglesFilePath(baseDir, weekIso) {
  return path.join(baseDir, 'data', 'market', '_angles', `${weekIso}.json`);
}

// ── readWeeklyAngles ──────────────────────────────────────────────────────────

async function readWeeklyAngles(weekIso, opts = {}) {
  validateWeekIso(weekIso);
  const baseDir = opts.baseDir || process.cwd();
  const filePath = anglesFilePath(baseDir, weekIso);
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  // Propagate JSON parse errors (corruption-loud)
  return JSON.parse(raw);
}

// ── generateWeeklyAngles ──────────────────────────────────────────────────────

async function generateWeeklyAngles(opts = {}) {
  const now     = opts.now     ? (opts.now instanceof Date ? opts.now : new Date(opts.now)) : new Date();
  const baseDir = opts.baseDir || process.cwd();
  const callRaw = opts.callRaw || claude.callRaw;

  // Resolve and validate weekIso
  let weekIso;
  if (opts.weekIso !== undefined) {
    validateWeekIso(opts.weekIso);
    weekIso = opts.weekIso;
  } else {
    weekIso = currentWeek(now);
  }

  const filePath = anglesFilePath(baseDir, weekIso);

  // Build data slice
  const slice = await gatherDataSlice({ weekIso, now, baseDir });
  const dataSliceFingerprint = hashDataSlice(slice);

  // Idempotency check
  if (opts.force !== true) {
    let existing = null;
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      existing = JSON.parse(raw);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (existing && existing.dataSliceFingerprint === dataSliceFingerprint) {
      return {
        angles:               existing.angles,
        weekIso,
        generatedAt:          existing.generatedAt,
        dataSliceFingerprint,
        regenerated:          false,
      };
    }
  }

  // Build prompt
  const { system, user } = buildAngleGenerationPrompt(slice);

  // Two-attempt generation loop (outer: too-few-valid-angles; inner: parse failures)
  let lastRejectedCount = 0;
  let lastRejectionReasons = [];

  for (let outerAttempt = 1; outerAttempt <= 2; outerAttempt++) {
    // Parse with one retry
    let parsed = null;
    let parseError = null;

    for (let parseAttempt = 1; parseAttempt <= 2; parseAttempt++) {
      let raw;
      try {
        raw = await callRaw({ system, user, model: MODELS.SONNET, maxTokens: 4096 });
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
        throw new AngleGenerationError(
          'Claude response could not be parsed as JSON after 2 attempts',
          { cause: err }
        );
      }
    }

    if (parsed === null) {
      throw new AngleGenerationError(
        'Claude response could not be parsed as JSON after 2 attempts',
        { cause: parseError }
      );
    }

    // Validate angles
    const rawAngles = Array.isArray(parsed.angles) ? parsed.angles : [];
    const validAngles = [];
    const rejectedIds = [];
    lastRejectionReasons = [];

    for (const angle of rawAngles) {
      const result = validateAngle(angle);
      if (result.valid) {
        validAngles.push(angle);
      } else {
        rejectedIds.push(angle.id || '(no id)');
        lastRejectionReasons.push(...result.errors);
      }
    }

    lastRejectedCount = rejectedIds.length;

    if (rejectedIds.length > 0) {
      console.warn(
        `[angles] ${rejectedIds.length} angle(s) rejected: ${rejectedIds.join(', ')}. ` +
        `Reasons: ${[...new Set(lastRejectionReasons)].join('; ')}`
      );
    }

    if (validAngles.length >= 2) {
      // Persist atomically
      const generatedAt = new Date().toISOString();
      const menu = {
        weekIso,
        generatedAt,
        modelUsed: MODELS.SONNET,
        dataSliceFingerprint,
        angles: validAngles,
      };

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const tmp = filePath + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(menu, null, 2), 'utf8');
      await fs.rename(tmp, filePath);

      return {
        angles: validAngles,
        weekIso,
        generatedAt,
        dataSliceFingerprint,
        regenerated: true,
      };
    }

    // Not enough valid angles -- retry once
    if (outerAttempt === 1) {
      console.warn(
        `[angles] Only ${validAngles.length} valid angle(s) after attempt ${outerAttempt}; retrying.`
      );
      continue;
    }
  }

  throw new AngleGenerationError(
    `Angle generation produced fewer than 2 valid angles after 2 attempts`,
    {
      validCount:    0,
      rejectedCount: lastRejectedCount,
    }
  );
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  generateWeeklyAngles,
  readWeeklyAngles,
  AngleGenerationError,
  _internal: {
    gatherDataSlice,
    buildAngleGenerationPrompt,
    validateAngle,
    hashDataSlice,
    validateWeekIso,
  },
};
