'use strict';

const fs   = require('node:fs/promises');
const path = require('node:path');

// ── Error class ───────────────────────────────────────────────────────────────

class UnknownMetricError extends Error {
  constructor(metricName) {
    super(`Unknown metric: '${metricName}'`);
    this.name = 'UnknownMetricError';
    this.metricName = metricName;
  }
}

// ── Registry ──────────────────────────────────────────────────────────────────

const SOURCES = {
  bank_of_canada: {
    name: 'Bank of Canada',
    homepageUrl: 'https://www.bankofcanada.ca',
    expectedPullIntervalHours: 6,
    metrics: {
      boc_overnight_rate: {
        refreshCadence:     'event_driven',
        staleThresholdDays: 365,
      },
      boc_last_decision_date: {
        refreshCadence:     'event_driven',
        staleThresholdDays: 365,
      },
      goc_5yr_yield: {
        refreshCadence:     'daily',
        staleThresholdDays: 7,
      },
    },
  },
};

// ── Per-metric entry validation ───────────────────────────────────────────────

const VALID_CADENCES = new Set(['event_driven', 'daily']);

function validateMetricRegistryEntry(entry) {
  const errors = [];

  if (!VALID_CADENCES.has(entry.refreshCadence)) {
    errors.push(
      `refreshCadence: must be one of ${[...VALID_CADENCES].join(', ')}, got '${entry.refreshCadence}'`
    );
  }

  if (!Number.isInteger(entry.staleThresholdDays) || entry.staleThresholdDays < 1) {
    errors.push(
      `staleThresholdDays: must be a positive integer, got ${entry.staleThresholdDays}`
    );
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ── Flat index build with load-time validation and duplicate guard ─────────────

function buildMetricIndex(sources) {
  const index = {};
  for (const [sourceKey, source] of Object.entries(sources)) {
    for (const [metricName, entry] of Object.entries(source.metrics)) {
      if (Object.prototype.hasOwnProperty.call(index, metricName)) {
        throw new Error(
          `Duplicate metric in registry: '${metricName}' appears under both '${index[metricName].source}' and '${sourceKey}'`
        );
      }
      const validation = validateMetricRegistryEntry(entry);
      if (!validation.valid) {
        throw new Error(
          `Invalid registry entry for metric '${metricName}' under source '${sourceKey}': ${validation.errors.join('; ')}`
        );
      }
      index[metricName] = { ...entry, source: sourceKey };
    }
  }
  return index;
}

const METRIC_INDEX = buildMetricIndex(SOURCES);

// ── Policy resolver ───────────────────────────────────────────────────────────

function resolveMetricPolicy(metricName) {
  const policy = METRIC_INDEX[metricName];
  if (!policy) throw new UnknownMetricError(metricName);
  return policy;
}

// ── Source freshness check ────────────────────────────────────────────────────

async function checkSourceFreshness(sourceKey, now, opts = {}) {
  const source = SOURCES[sourceKey];
  if (!source) throw new Error(`Unknown source key: ${sourceKey}`);

  const nowMs = (now instanceof Date) ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) {
    throw new Error('checkSourceFreshness: now must be a valid Date or ISO string');
  }

  const baseDir = opts.baseDir || process.cwd();
  const logPath = path.join(baseDir, 'data', 'market', '_pullLog.jsonl');

  const neverPulled = {
    sourceKey,
    name: source.name,
    status: 'never_pulled',
    lastPulledAt: null,
    ageHours: null,
  };

  let raw;
  try {
    raw = await fs.readFile(logPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return neverPulled;
    throw err;
  }

  const lines = raw.trim().split('\n').filter(l => l.trim() !== '');
  if (lines.length === 0) return neverPulled;

  const metricKeys = Object.keys(source.metrics);
  let lastPulledAt = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const written = Array.isArray(entry.metricsWritten) ? entry.metricsWritten : [];
    if (metricKeys.some(m => written.includes(m))) {
      lastPulledAt = entry.pulledAt || entry.loggedAt || null;
      break;
    }
  }

  if (!lastPulledAt) return neverPulled;

  const pulledMs = new Date(lastPulledAt).getTime();
  if (!Number.isFinite(pulledMs)) return neverPulled;

  const ageHours = (nowMs - pulledMs) / (1000 * 60 * 60);
  const status = ageHours > source.expectedPullIntervalHours ? 'overdue' : 'fresh';

  return { sourceKey, name: source.name, status, lastPulledAt, ageHours };
}

async function checkAllSourcesFreshness(now, opts = {}) {
  return Promise.all(Object.keys(SOURCES).map(key => checkSourceFreshness(key, now, opts)));
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  SOURCES,
  METRIC_INDEX,
  UnknownMetricError,
  validateMetricRegistryEntry,
  resolveMetricPolicy,
  checkSourceFreshness,
  checkAllSourcesFreshness,
  _internal: { buildMetricIndex },
};
