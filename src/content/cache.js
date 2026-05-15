/**
 * src/content/cache.js
 *
 * Read/write helpers for data/market/ snapshot files, hand-rolled schema
 * validation against the canonical data point schema, staleness check,
 * fresh-point convenience reader, and structured pull-log appender.
 *
 * All I/O functions accept opts.baseDir so tests can redirect to a temp
 * directory without touching the real data/market/ tree.
 *
 * No external dependencies. No console output. Pure utility.
 */

'use strict';

const fs   = require('node:fs/promises');
const path = require('node:path');

// ── Constants ─────────────────────────────────────────────────────────────────

const ALLOWED_REGIONS = new Set(['canada', 'toronto']);

const ALLOWED_CADENCES = new Set(['daily', 'weekly', 'monthly', 'quarterly', 'event_driven']);

const ALLOWED_CONFIDENCES = new Set(['high', 'medium', 'low']);

// Accepts YYYY-MM (monthly) or YYYY-WNN (ISO week, e.g. 2026-W20)
const PERIOD_RE = /^\d{4}-(\d{2}|W\d{2})$/;

// ── Schema validation ─────────────────────────────────────────────────────────

/**
 * Validates a single data point against the canonical schema.
 *
 * @param {object} point - The data point to validate.
 * @returns {{ valid: true } | { valid: false, error: string }}
 */
function validateDataPoint(point) {
  if (point == null || typeof point !== 'object') {
    return { valid: false, error: 'data point must be a non-null object' };
  }

  // metric
  if (typeof point.metric !== 'string' || point.metric.trim() === '') {
    return { valid: false, error: 'metric: required non-empty string' };
  }

  // value
  if (typeof point.value !== 'number') {
    return { valid: false, error: 'value: required number' };
  }
  if (!Number.isFinite(point.value)) {
    return { valid: false, error: 'value: must be a finite number' };
  }

  // unit
  if (typeof point.unit !== 'string' || point.unit.trim() === '') {
    return { valid: false, error: 'unit: required non-empty string' };
  }

  // asOf
  if (typeof point.asOf !== 'string' || point.asOf.trim() === '') {
    return { valid: false, error: 'asOf: required non-empty string' };
  }
  if (Number.isNaN(new Date(point.asOf).getTime())) {
    return { valid: false, error: 'asOf: must be a valid ISO 8601 timestamp' };
  }

  // source
  if (typeof point.source !== 'string' || point.source.trim() === '') {
    return { valid: false, error: 'source: required non-empty string' };
  }

  // sourceUrl
  if (typeof point.sourceUrl !== 'string' || point.sourceUrl.trim() === '') {
    return { valid: false, error: 'sourceUrl: required non-empty string' };
  }
  if (!point.sourceUrl.startsWith('http')) {
    return { valid: false, error: 'sourceUrl: must start with http' };
  }

  // refreshCadence
  if (!ALLOWED_CADENCES.has(point.refreshCadence)) {
    return { valid: false, error: `refreshCadence: must be one of ${[...ALLOWED_CADENCES].join(', ')}` };
  }

  // staleThresholdDays
  if (typeof point.staleThresholdDays !== 'number') {
    return { valid: false, error: 'staleThresholdDays: required number' };
  }
  if (
    !Number.isInteger(point.staleThresholdDays) ||
    point.staleThresholdDays < 1
  ) {
    return { valid: false, error: 'staleThresholdDays: must be a positive integer' };
  }

  // confidence
  if (!ALLOWED_CONFIDENCES.has(point.confidence)) {
    return { valid: false, error: `confidence: must be one of ${[...ALLOWED_CONFIDENCES].join(', ')}` };
  }

  return { valid: true };
}

// ── Path helpers ──────────────────────────────────────────────────────────────

function validateRegion(region) {
  if (!ALLOWED_REGIONS.has(region)) {
    throw new Error(`region: must be one of ${[...ALLOWED_REGIONS].join(', ')}; got '${region}'`);
  }
}

function validatePeriod(period) {
  if (!PERIOD_RE.test(period)) {
    throw new Error(`period: must be YYYY-MM or YYYY-WNN format; got '${period}'`);
  }
}

function snapshotPath(baseDir, region, period) {
  return path.join(baseDir, 'data', 'market', region, `${period}.json`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Reads a snapshot file and returns the parsed array of data points.
 *
 * @param {string} region - 'canada' | 'toronto'
 * @param {string} period - 'YYYY-MM' or 'YYYY-WNN'
 * @param {{ baseDir?: string }} [opts]
 * @returns {Promise<object[]>} Parsed array, or [] if the file does not exist.
 */
async function readSnapshot(region, period, opts = {}) {
  validateRegion(region);
  validatePeriod(period);
  const baseDir = opts.baseDir || process.cwd();
  const filePath = snapshotPath(baseDir, region, period);
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return JSON.parse(raw);
}

/**
 * Validates and writes an array of data points to a snapshot file atomically.
 *
 * @param {string} region - 'canada' | 'toronto'
 * @param {string} period - 'YYYY-MM' or 'YYYY-WNN'
 * @param {object[]} dataPoints - Array of validated data points to write.
 * @param {{ baseDir?: string }} [opts]
 * @returns {Promise<void>}
 */
async function writeSnapshot(region, period, dataPoints, opts = {}) {
  validateRegion(region);
  validatePeriod(period);
  const baseDir = opts.baseDir || process.cwd();

  for (let i = 0; i < dataPoints.length; i++) {
    const result = validateDataPoint(dataPoints[i]);
    if (!result.valid) {
      throw new Error(`dataPoints[${i}]: ${result.error}`);
    }
  }

  const filePath = snapshotPath(baseDir, region, period);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(dataPoints, null, 2), 'utf8');
  await fs.rename(tmp, filePath);
}

/**
 * Returns true if a data point is stale relative to now.
 * Exactly at the threshold is NOT stale (strict greater-than comparison).
 *
 * @param {object} dataPoint - Must have asOf (ISO string) and staleThresholdDays (number).
 * @param {Date|string} now - Reference time as a Date object or ISO string.
 * @returns {boolean}
 */
function isStale(dataPoint, now) {
  const nowMs = (now instanceof Date) ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) {
    throw new Error('isStale: now must be a valid Date or ISO string');
  }
  const asOfMs = new Date(dataPoint.asOf).getTime();
  const elapsedDays = (nowMs - asOfMs) / (1000 * 60 * 60 * 24);
  return elapsedDays > dataPoint.staleThresholdDays;
}

/**
 * Reads a snapshot, finds the matching metric, and returns it if fresh.
 * Returns null if the file is missing, the metric is absent, or the point is stale.
 * Never throws on missing data — only on invalid input arguments.
 *
 * @param {string} region
 * @param {string} period
 * @param {string} metric
 * @param {Date|string} now
 * @param {{ baseDir?: string }} [opts]
 * @returns {Promise<object|null>}
 */
async function getFreshPoint(region, period, metric, now, opts = {}) {
  validateRegion(region);
  validatePeriod(period);
  const points = await readSnapshot(region, period, opts);
  const point = points.find(p => p.metric === metric);
  if (!point) return null;
  if (isStale(point, now)) return null;
  return point;
}

/**
 * Appends one structured log entry as a JSONL line to data/market/_pullLog.jsonl.
 * Adds a loggedAt field if not already present. Creates the file and parent
 * directory if they do not exist.
 *
 * @param {object} entry - Arbitrary log object.
 * @param {{ baseDir?: string }} [opts]
 * @returns {Promise<void>}
 */
async function appendPullLog(entry, opts = {}) {
  const baseDir = opts.baseDir || process.cwd();
  const dir = path.join(baseDir, 'data', 'market');
  await fs.mkdir(dir, { recursive: true });

  const record = { ...entry };
  if (record.loggedAt === undefined) {
    record.loggedAt = new Date().toISOString();
  }

  const logPath = path.join(dir, '_pullLog.jsonl');
  await fs.appendFile(logPath, JSON.stringify(record) + '\n', 'utf8');
}

/**
 * Returns the ISO 8601 week period string ('YYYY-WNN') for the week containing now.
 * Uses the ISO week-year, which may differ from the calendar year at year boundaries:
 *   - Jan 1-3 can fall in week 52/53 of the prior year
 *   - Dec 29-31 can fall in week 1 of the next year
 * Uses UTC date components for consistency with asOf timestamps.
 *
 * @param {Date|string} now
 * @returns {string} e.g. '2026-W20'
 */
function currentWeek(now) {
  const date = (now instanceof Date) ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('currentWeek: now must be a valid Date or ISO string');
  }

  // Work in UTC: extract the calendar date only
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

  // Shift to this week's Thursday (Mon=0…Sun=6 → +3 puts Mon on Thu, Sun on +3 from prior Mon)
  const dayOfWeek = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dayOfWeek + 3);

  // The ISO week-year is the year of that Thursday
  const isoYear = d.getUTCFullYear();

  // Week 1 is the week whose Thursday is closest to Jan 4 (i.e. contains Jan 4)
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Day = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(Date.UTC(isoYear, 0, 4 - jan4Day));

  const weekNum = Math.round((d.getTime() - week1Monday.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Returns the calendar month period string ('YYYY-MM') for the month containing now.
 * Uses UTC components to avoid timezone edge issues (e.g. May 31 23:00 EST = Jun 1 UTC → '06').
 *
 * @param {Date|string} now
 * @returns {string} e.g. '2026-05'
 */
function currentMonth(now) {
  const date = (now instanceof Date) ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('currentMonth: now must be a valid Date or ISO string');
  }
  const year  = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  validateDataPoint,
  readSnapshot,
  writeSnapshot,
  isStale,
  getFreshPoint,
  appendPullLog,
  currentWeek,
  currentMonth,
};
