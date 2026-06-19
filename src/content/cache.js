'use strict';

const fs   = require('node:fs/promises');
const path = require('node:path');

const { resolveMetricPolicy } = require('./sources');
const { getStorageRoot }     = require('../storagePaths');

// ── Constants ─────────────────────────────────────────────────────────────────

const ALLOWED_REGIONS    = new Set(['canada', 'toronto']);
const ALLOWED_CONFIDENCES = new Set(['high', 'medium', 'low']);

// Accepts YYYY-MM (monthly) or YYYY-WNN (ISO week, e.g. 2026-W20)
const PERIOD_RE = /^\d{4}-(\d{2}|W\d{2})$/;

// ── Schema validation ─────────────────────────────────────────────────────────

/**
 * Validates the observation-level fields of a data point.
 *
 * staleThresholdDays and refreshCadence are NO longer required here -- they
 * are policy fields owned by the metric registry (sources.js). If a legacy
 * snapshot point still carries those fields they are silently accepted and
 * stripped at write time by writeSnapshot.
 */
function validateDataPoint(point) {
  if (point == null || typeof point !== 'object') {
    return { valid: false, error: 'data point must be a non-null object' };
  }

  if (typeof point.metric !== 'string' || point.metric.trim() === '') {
    return { valid: false, error: 'metric: required non-empty string' };
  }

  if (typeof point.value !== 'number') {
    return { valid: false, error: 'value: required number' };
  }
  if (!Number.isFinite(point.value)) {
    return { valid: false, error: 'value: must be a finite number' };
  }

  if (typeof point.unit !== 'string' || point.unit.trim() === '') {
    return { valid: false, error: 'unit: required non-empty string' };
  }

  if (typeof point.asOf !== 'string' || point.asOf.trim() === '') {
    return { valid: false, error: 'asOf: required non-empty string' };
  }
  if (Number.isNaN(new Date(point.asOf).getTime())) {
    return { valid: false, error: 'asOf: must be a valid ISO 8601 timestamp' };
  }

  if (typeof point.source !== 'string' || point.source.trim() === '') {
    return { valid: false, error: 'source: required non-empty string' };
  }

  if (typeof point.sourceUrl !== 'string' || point.sourceUrl.trim() === '') {
    return { valid: false, error: 'sourceUrl: required non-empty string' };
  }
  if (!point.sourceUrl.startsWith('http')) {
    return { valid: false, error: 'sourceUrl: must start with http' };
  }

  if (!ALLOWED_CONFIDENCES.has(point.confidence)) {
    return {
      valid: false,
      error: `confidence: must be one of ${[...ALLOWED_CONFIDENCES].join(', ')}`,
    };
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
  return path.join(baseDir, '_market', region, `${period}.json`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Reads a snapshot file and returns the parsed array of data points.
 */
async function readSnapshot(region, period, opts = {}) {
  validateRegion(region);
  validatePeriod(period);
  const baseDir = opts.baseDir || getStorageRoot();
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
 * staleThresholdDays and refreshCadence are stripped from each point before
 * serializing -- policy lives in the registry, not in snapshot files. Legacy
 * points that carry those fields are accepted (validation does not require
 * them) but the fields are dropped on the way out.
 */
async function writeSnapshot(region, period, dataPoints, opts = {}) {
  validateRegion(region);
  validatePeriod(period);
  const baseDir = opts.baseDir || getStorageRoot();

  for (let i = 0; i < dataPoints.length; i++) {
    const result = validateDataPoint(dataPoints[i]);
    if (!result.valid) {
      throw new Error(`dataPoints[${i}]: ${result.error}`);
    }
  }

  // Strip policy fields before serializing -- they belong in sources.js, not snapshots.
  const cleaned = dataPoints.map(({ staleThresholdDays, refreshCadence, ...rest }) => rest);

  const filePath = snapshotPath(baseDir, region, period);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(cleaned, null, 2), 'utf8');
  await fs.rename(tmp, filePath);
}

/**
 * Returns true if a data point is stale relative to now.
 * Staleness threshold is resolved from the metric registry via sources.js.
 * Propagates UnknownMetricError if the metric is not registered.
 * Exactly at the threshold is NOT stale (strict greater-than).
 *
 * @param {object} dataPoint - Must have metric (string) and asOf (ISO string).
 * @param {{ now: Date|string }} opts
 * @returns {boolean}
 */
function isStale(dataPoint, opts = {}) {
  const now = opts.now;
  const nowMs = (now instanceof Date) ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) {
    throw new Error('isStale: now must be a valid Date or ISO string');
  }
  const { staleThresholdDays } = resolveMetricPolicy(dataPoint.metric);
  const asOfMs = new Date(dataPoint.asOf).getTime();
  const elapsedDays = (nowMs - asOfMs) / (1000 * 60 * 60 * 24);
  return elapsedDays > staleThresholdDays;
}

/**
 * Reads a snapshot, finds the matching metric, and returns it if fresh.
 * Returns null if the file is missing, the metric is absent, or the point is stale.
 * Propagates UnknownMetricError if the metric is not in the registry.
 * Propagates JSON parse errors on corrupted files.
 *
 * @param {string} metric
 * @param {string} region
 * @param {string} period
 * @param {{ now: Date|string, baseDir?: string }} opts
 * @returns {Promise<object|null>}
 */
async function getFreshPoint(metric, region, period, opts = {}) {
  validateRegion(region);
  validatePeriod(period);
  const points = await readSnapshot(region, period, opts);
  const point = points.find(p => p.metric === metric);
  if (!point) return null;
  if (isStale(point, { now: opts.now })) return null;
  return point;
}

/**
 * Appends one structured log entry as a JSONL line to _market/_pullLog.jsonl.
 */
async function appendPullLog(entry, opts = {}) {
  const baseDir = opts.baseDir || getStorageRoot();
  const dir = path.join(baseDir, '_market');
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
 */
function currentWeek(now) {
  const date = (now instanceof Date) ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('currentWeek: now must be a valid Date or ISO string');
  }

  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

  const dayOfWeek = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayOfWeek + 3);

  const isoYear = d.getUTCFullYear();

  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Day = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(Date.UTC(isoYear, 0, 4 - jan4Day));

  const weekNum = Math.round((d.getTime() - week1Monday.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Returns the calendar month period string ('YYYY-MM') for the month containing now.
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
