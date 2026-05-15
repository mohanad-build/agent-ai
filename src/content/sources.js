'use strict';

const fs   = require('node:fs/promises');
const path = require('node:path');

// ── Registry ──────────────────────────────────────────────────────────────────

const SOURCES = {
  bank_of_canada: {
    name: 'Bank of Canada',
    expectedPullIntervalHours: 24,
    metrics: ['boc_overnight_rate', 'boc_last_decision_date', 'goc_5yr_yield'],
  },
};

// ── Freshness check ───────────────────────────────────────────────────────────

/**
 * Reads _pullLog.jsonl and returns the freshness status of a single data source.
 * Scans lines newest-first for the most recent entry that wrote at least one of
 * the source's metrics.
 *
 * @param {string} sourceKey - Key in SOURCES registry.
 * @param {Date|string} now
 * @param {{ baseDir?: string }} [opts]
 * @returns {Promise<{
 *   sourceKey: string,
 *   name: string,
 *   status: 'fresh' | 'overdue' | 'never_pulled',
 *   lastPulledAt: string | null,
 *   ageHours: number | null
 * }>}
 */
async function checkSourceFreshness(sourceKey, now, opts = {}) {
  const source = SOURCES[sourceKey];
  if (!source) throw new Error(`Unknown source key: ${sourceKey}`);

  const nowMs = (now instanceof Date) ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) {
    throw new Error('checkSourceFreshness: now must be a valid Date or ISO string');
  }

  const baseDir = opts.baseDir || process.cwd();
  const logPath = path.join(baseDir, 'data', 'market', '_pullLog.jsonl');

  const neverPulled = { sourceKey, name: source.name, status: 'never_pulled', lastPulledAt: null, ageHours: null };

  let raw;
  try {
    raw = await fs.readFile(logPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return neverPulled;
    throw err;
  }

  const lines = raw.trim().split('\n').filter(l => l.trim() !== '');
  if (lines.length === 0) return neverPulled;

  // Walk newest-first (last line = most recent append)
  let lastPulledAt = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const written = Array.isArray(entry.metricsWritten) ? entry.metricsWritten : [];
    if (source.metrics.some(m => written.includes(m))) {
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

/**
 * Checks freshness for all registered sources and returns an array of results.
 *
 * @param {Date|string} now
 * @param {{ baseDir?: string }} [opts]
 * @returns {Promise<Array>}
 */
async function checkAllSourcesFreshness(now, opts = {}) {
  return Promise.all(Object.keys(SOURCES).map(key => checkSourceFreshness(key, now, opts)));
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { SOURCES, checkSourceFreshness, checkAllSourcesFreshness };
