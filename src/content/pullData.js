/**
 * src/content/pullData.js
 *
 * Data-pull helpers for the Content Engine. Fetches market metrics from
 * external data sources, normalises them to the canonical data-point schema,
 * and writes them to the cache via cache.js.
 *
 * Each external source has its own function. This file currently implements
 * pullBankOfCanada. CREA, TRREB, StatCan, and Ratehub are future steps.
 *
 * All fetch calls use globalThis.fetch (native Node 18+). Timeout: 10 seconds
 * per request via AbortController.
 */

'use strict';

const {
  readSnapshot,
  writeSnapshot,
  appendPullLog,
  currentWeek,
} = require('./cache');

// ── Constants ─────────────────────────────────────────────────────────────────

const BOC_VALET_BASE = 'https://www.bankofcanada.ca/valet/observations';

// BoC Valet series codes (verified against https://www.bankofcanada.ca/valet/lists/series)
const SERIES_OVERNIGHT = 'B114039';        // Target Rate (policy rate)
const SERIES_5YR_YIELD = 'BD.CDN.5YR.DQ.YLD'; // 5-year GoC benchmark bond yield

// Public-facing BoC source URLs (not API endpoints)
const SOURCE_URL_RATES = 'https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rates/';
const SOURCE_URL_BONDS = 'https://www.bankofcanada.ca/rates/interest-rates/canadian-bonds/';

const FETCH_TIMEOUT_MS = 10_000;

// ── Internal fetch helper ─────────────────────────────────────────────────────

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await globalThis.fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Overnight series fetch (shared by two metrics) ────────────────────────────

/**
 * Fetches the B114039 (Target Rate) series with the 5 most recent observations.
 * Observations are returned newest-first by the Valet API.
 * Used by both parseOvernightRate and parseLatestDecisionDate.
 *
 * @returns {Promise<object[]>} Array of observation objects, newest-first.
 */
async function fetchBocOvernightSeries() {
  const url = `${BOC_VALET_BASE}/${SERIES_OVERNIGHT}/json?recent=5`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching overnight series`);
  const data = await res.json();
  const observations = data.observations;
  if (!observations || observations.length === 0) {
    throw new Error('No observations in overnight rate series');
  }
  return observations;
}

// ── Pure parsers ──────────────────────────────────────────────────────────────

/**
 * Extracts the current overnight rate target from observations.
 *
 * @param {object[]} observations - Newest-first array from B114039 Valet response.
 * @returns {object} Canonical data point for 'boc_overnight_rate'.
 */
function parseOvernightRate(observations) {
  const obs = observations[0];
  const value = parseFloat(obs[SERIES_OVERNIGHT]?.v);
  if (!Number.isFinite(value)) {
    throw new Error('Non-finite value in overnight rate observation');
  }
  return {
    metric:    'boc_overnight_rate',
    value,
    unit:      'percent',
    asOf:      new Date(obs.d + 'T00:00:00.000Z').toISOString(),
    source:    'Bank of Canada',
    sourceUrl: SOURCE_URL_RATES,
    confidence: 'high',
  };
}

/**
 * Derives the last rate-decision date from observations by finding the most
 * recent observation where the rate value changed from the prior observation.
 * Falls back to the most recent observation date if no change is found in the
 * window (rate held at all observed decisions).
 *
 * Depends on fetchBocOvernightSeries: if that fetch fails, this metric also
 * fails — they share the same HTTP call in pullBankOfCanada.
 *
 * value is a UNIX timestamp in seconds (unit: 'unix_seconds') to satisfy the
 * schema's value:number requirement. asOf is the decision date itself.
 *
 * @param {object[]} observations - Newest-first array from B114039 Valet response.
 * @returns {object} Canonical data point for 'boc_last_decision_date'.
 */
function parseLatestDecisionDate(observations) {
  // Walk from most-recent backward; the first date where rate differs from the
  // next observation is the last rate change. Fall back to obs[0].d if no change
  // is found (rate held throughout the observation window).
  let decisionDateStr = observations[0].d;
  for (let i = 0; i < observations.length - 1; i++) {
    const curr = parseFloat(observations[i][SERIES_OVERNIGHT]?.v);
    const prev = parseFloat(observations[i + 1][SERIES_OVERNIGHT]?.v);
    if (curr !== prev) {
      decisionDateStr = observations[i].d;
      break;
    }
  }

  const decisionDate = new Date(decisionDateStr + 'T00:00:00.000Z');
  if (!Number.isFinite(decisionDate.getTime())) {
    throw new Error(`Invalid date in overnight observations: ${decisionDateStr}`);
  }
  return {
    metric:    'boc_last_decision_date',
    value:     Math.floor(decisionDate.getTime() / 1000),
    unit:      'unix_seconds',
    asOf:      decisionDate.toISOString(),
    source:    'Bank of Canada',
    sourceUrl: SOURCE_URL_RATES,
    confidence: 'high',
  };
}

// ── 5-year yield fetch + parse (independent) ──────────────────────────────────

/**
 * Fetches the 5-year Government of Canada benchmark bond yield.
 * @returns {Promise<object>} Canonical data point for 'goc_5yr_yield'.
 */
async function fetch5YrYield() {
  const url = `${BOC_VALET_BASE}/${SERIES_5YR_YIELD}/json?recent=1`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching 5yr yield`);
  const data = await res.json();
  const obs = data.observations?.[0];
  if (!obs) throw new Error('No observations in 5yr yield response');
  const value = parseFloat(obs[SERIES_5YR_YIELD]?.v);
  if (!Number.isFinite(value)) throw new Error('Non-finite value in 5yr yield response');
  return {
    metric:    'goc_5yr_yield',
    value,
    unit:      'percent',
    asOf:      new Date(obs.d + 'T00:00:00.000Z').toISOString(),
    source:    'Bank of Canada',
    sourceUrl: SOURCE_URL_BONDS,
    confidence: 'high',
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetches three Bank of Canada metrics, normalises them to the canonical
 * data-point schema, and writes them to the current-week snapshot in
 * data/market/canada/. Merges with any existing metrics in the snapshot so
 * that metrics from other sources are preserved.
 *
 * Makes exactly two HTTP requests per call:
 *   1. B114039 overnight series (recent=5) — used for boc_overnight_rate and
 *      boc_last_decision_date. If this request fails, both metrics fail.
 *   2. BD.CDN.5YR.DQ.YLD yield series (recent=1) — independent.
 *
 * Per-metric failures are isolated where possible: a partial result is still
 * written and success:true if at least one metric was fetched. All three
 * failing returns success:false and leaves any existing snapshot untouched.
 *
 * Appends one structured entry to data/market/_pullLog.jsonl regardless of
 * outcome.
 *
 * @param {{ baseDir?: string, now?: Date|string }} [opts]
 *   baseDir - override for testing (default: process.cwd())
 *   now     - override the current time for period determination (default: new Date())
 * @returns {Promise<{
 *   success: boolean,
 *   metricsWritten: string[],
 *   metricsFailed: string[],
 *   errors: Array<{metric: string, error: string}>,
 *   pulledAt: string
 * }>}
 */
async function pullBankOfCanada(opts = {}) {
  const now     = opts.now ? new Date(opts.now) : new Date();
  const baseDir = opts.baseDir || process.cwd();
  const pulledAt = new Date().toISOString();

  const period = currentWeek(now);
  const region = 'canada';

  const metricsWritten = [];
  const metricsFailed  = [];
  const errors         = [];
  const newPoints      = [];

  // ── Fetch overnight series (B114039) — shared by two metrics ─────────────────
  let overnightObs = null;
  try {
    overnightObs = await fetchBocOvernightSeries();
  } catch (err) {
    console.warn(`[pullBankOfCanada] overnight series failed: ${err.message}`);
    for (const m of ['boc_overnight_rate', 'boc_last_decision_date']) {
      metricsFailed.push(m);
      errors.push({ metric: m, error: err.message });
    }
  }

  if (overnightObs) {
    try {
      newPoints.push(parseOvernightRate(overnightObs));
      metricsWritten.push('boc_overnight_rate');
    } catch (err) {
      metricsFailed.push('boc_overnight_rate');
      errors.push({ metric: 'boc_overnight_rate', error: err.message });
    }

    try {
      newPoints.push(parseLatestDecisionDate(overnightObs));
      metricsWritten.push('boc_last_decision_date');
    } catch (err) {
      metricsFailed.push('boc_last_decision_date');
      errors.push({ metric: 'boc_last_decision_date', error: err.message });
    }
  }

  // ── Fetch 5yr yield independently ────────────────────────────────────────────
  try {
    newPoints.push(await fetch5YrYield());
    metricsWritten.push('goc_5yr_yield');
  } catch (err) {
    console.warn(`[pullBankOfCanada] goc_5yr_yield failed: ${err.message}`);
    metricsFailed.push('goc_5yr_yield');
    errors.push({ metric: 'goc_5yr_yield', error: err.message });
  }

  const success = metricsWritten.length > 0;

  if (newPoints.length > 0) {
    const existing = await readSnapshot(region, period, { baseDir });
    const preserved = existing.filter(p => !newPoints.some(np => np.metric === p.metric));
    await writeSnapshot(region, period, [...preserved, ...newPoints], { baseDir });
  }

  const result = { success, metricsWritten, metricsFailed, errors, pulledAt };
  await appendPullLog(result, { baseDir });
  return result;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  pullBankOfCanada,
  _internal: {
    fetchBocOvernightSeries,
    fetch5YrYield,
    parseOvernightRate,
    parseLatestDecisionDate,
    SERIES_OVERNIGHT,
    SERIES_5YR_YIELD,
  },
};
