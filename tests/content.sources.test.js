'use strict';

const fs   = require('node:fs/promises');
const os   = require('node:os');
const path = require('node:path');

const {
  SOURCES,
  UnknownMetricError,
  validateMetricRegistryEntry,
  resolveMetricPolicy,
  checkSourceFreshness,
  checkAllSourcesFreshness,
  _internal: { buildMetricIndex },
} = require('../src/content/sources');

// ── Hermetic setup ────────────────────────────────────────────────────────────

let baseDir;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sources-'));
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function writeLog(lines) {
  const dir = path.join(baseDir, '_market');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, '_pullLog.jsonl'),
    lines.map(l => JSON.stringify(l)).join('\n') + '\n',
    'utf8'
  );
}

// Reference time: 2026-05-15T12:00:00Z
const NOW = '2026-05-15T12:00:00.000Z';
const NOW_MS = new Date(NOW).getTime();

// ── checkSourceFreshness ──────────────────────────────────────────────────────

describe('checkSourceFreshness', () => {
  test('returns never_pulled when log file does not exist', async () => {
    const result = await checkSourceFreshness('bank_of_canada', NOW, { baseDir });
    expect(result.status).toBe('never_pulled');
    expect(result.lastPulledAt).toBeNull();
    expect(result.ageHours).toBeNull();
    expect(result.sourceKey).toBe('bank_of_canada');
    expect(result.name).toBe('Bank of Canada');
  });

  test('returns never_pulled when log file is empty', async () => {
    const dir = path.join(baseDir, '_market');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, '_pullLog.jsonl'), '', 'utf8');

    const result = await checkSourceFreshness('bank_of_canada', NOW, { baseDir });
    expect(result.status).toBe('never_pulled');
  });

  test('returns never_pulled when log exists but no entry matches source metrics', async () => {
    await writeLog([
      { pulledAt: NOW, metricsWritten: ['some_other_metric'], success: true },
    ]);
    const result = await checkSourceFreshness('bank_of_canada', NOW, { baseDir });
    expect(result.status).toBe('never_pulled');
  });

  test('returns never_pulled when all entries have empty metricsWritten', async () => {
    await writeLog([
      { pulledAt: NOW, metricsWritten: [], success: false },
    ]);
    const result = await checkSourceFreshness('bank_of_canada', NOW, { baseDir });
    expect(result.status).toBe('never_pulled');
  });

  test('returns fresh when pulled within the expected interval', async () => {
    // 5h ago -- within the 6h window
    const pulledAt = new Date(NOW_MS - 5 * 60 * 60 * 1000).toISOString();
    await writeLog([
      { pulledAt, metricsWritten: ['boc_overnight_rate', 'boc_last_decision_date', 'goc_5yr_yield'], success: true },
    ]);

    const result = await checkSourceFreshness('bank_of_canada', NOW, { baseDir });
    expect(result.status).toBe('fresh');
    expect(result.lastPulledAt).toBe(pulledAt);
    expect(result.ageHours).toBeCloseTo(5, 2);
  });

  test('returns overdue when pulled outside the expected interval', async () => {
    // 30h ago — outside the 24h window
    const pulledAt = new Date(NOW_MS - 30 * 60 * 60 * 1000).toISOString();
    await writeLog([
      { pulledAt, metricsWritten: ['boc_overnight_rate', 'goc_5yr_yield'], success: true },
    ]);

    const result = await checkSourceFreshness('bank_of_canada', NOW, { baseDir });
    expect(result.status).toBe('overdue');
    expect(result.ageHours).toBeCloseTo(30, 2);
  });

  test('exactly at threshold is fresh (strict greater-than)', async () => {
    // Exactly 6h ago -- not overdue (ageHours must be strictly > threshold)
    const pulledAt = new Date(NOW_MS - 6 * 60 * 60 * 1000).toISOString();
    await writeLog([
      { pulledAt, metricsWritten: ['boc_overnight_rate'], success: true },
    ]);

    const result = await checkSourceFreshness('bank_of_canada', NOW, { baseDir });
    expect(result.status).toBe('fresh');
  });

  test('picks the most recent matching entry from a multi-line log', async () => {
    const older  = new Date(NOW_MS - 48 * 60 * 60 * 1000).toISOString();
    const recent = new Date(NOW_MS - 6 * 60 * 60 * 1000).toISOString();
    await writeLog([
      { pulledAt: older,  metricsWritten: ['boc_overnight_rate'], success: true },
      { pulledAt: recent, metricsWritten: ['goc_5yr_yield'],      success: true },
    ]);

    const result = await checkSourceFreshness('bank_of_canada', NOW, { baseDir });
    expect(result.status).toBe('fresh');
    expect(result.lastPulledAt).toBe(recent);
    expect(result.ageHours).toBeCloseTo(6, 2);
  });

  test('falls back to loggedAt when pulledAt is absent', async () => {
    const loggedAt = new Date(NOW_MS - 5 * 60 * 60 * 1000).toISOString();
    await writeLog([
      { loggedAt, metricsWritten: ['boc_overnight_rate'], success: true },
    ]);

    const result = await checkSourceFreshness('bank_of_canada', NOW, { baseDir });
    expect(result.status).toBe('fresh');
    expect(result.lastPulledAt).toBe(loggedAt);
  });

  test('skips corrupt lines without crashing', async () => {
    const dir = path.join(baseDir, '_market');
    await fs.mkdir(dir, { recursive: true });
    const valid = JSON.stringify({ pulledAt: new Date(NOW_MS - 5 * 60 * 60 * 1000).toISOString(), metricsWritten: ['goc_5yr_yield'], success: true });
    await fs.writeFile(
      path.join(dir, '_pullLog.jsonl'),
      `not-json\n${valid}\n`,
      'utf8'
    );

    const result = await checkSourceFreshness('bank_of_canada', NOW, { baseDir });
    expect(result.status).toBe('fresh');
  });

  test('throws for an unknown sourceKey', async () => {
    await expect(checkSourceFreshness('unknown_source', NOW, { baseDir }))
      .rejects.toThrow(/Unknown source key/);
  });

  test('throws for an invalid now value', async () => {
    await expect(checkSourceFreshness('bank_of_canada', 'not-a-date', { baseDir }))
      .rejects.toThrow(/now must be a valid/);
  });
});

// ── checkAllSourcesFreshness ──────────────────────────────────────────────────

describe('checkAllSourcesFreshness', () => {
  test('returns one result per registered source', async () => {
    const results = await checkAllSourcesFreshness(NOW, { baseDir });
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(Object.keys(SOURCES).length);
    const keys = results.map(r => r.sourceKey);
    expect(keys).toContain('bank_of_canada');
  });

  test('all-fresh scenario: every result has status fresh', async () => {
    const pulledAt = new Date(NOW_MS - 6 * 60 * 60 * 1000).toISOString();
    await writeLog([
      { pulledAt, metricsWritten: ['boc_overnight_rate', 'boc_last_decision_date', 'goc_5yr_yield'], success: true },
    ]);

    const results = await checkAllSourcesFreshness(NOW, { baseDir });
    expect(results.every(r => r.status === 'fresh')).toBe(true);
  });
});

// ── resolveMetricPolicy ───────────────────────────────────────────────────────

describe('resolveMetricPolicy', () => {
  test('boc_overnight_rate: event_driven cadence, 365-day threshold', () => {
    const policy = resolveMetricPolicy('boc_overnight_rate');
    expect(policy.refreshCadence).toBe('event_driven');
    expect(policy.staleThresholdDays).toBe(365);
    expect(policy.source).toBe('bank_of_canada');
  });

  test('boc_last_decision_date: event_driven cadence, 365-day threshold', () => {
    const policy = resolveMetricPolicy('boc_last_decision_date');
    expect(policy.refreshCadence).toBe('event_driven');
    expect(policy.staleThresholdDays).toBe(365);
  });

  test('goc_5yr_yield: daily cadence, 7-day threshold', () => {
    const policy = resolveMetricPolicy('goc_5yr_yield');
    expect(policy.refreshCadence).toBe('daily');
    expect(policy.staleThresholdDays).toBe(7);
  });

  test('throws UnknownMetricError for unregistered metric', () => {
    expect(() => resolveMetricPolicy('nonexistent_metric')).toThrow(UnknownMetricError);
  });

  test('UnknownMetricError carries the metricName property', () => {
    let caught;
    try {
      resolveMetricPolicy('no_such_thing');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnknownMetricError);
    expect(caught.metricName).toBe('no_such_thing');
    expect(caught.name).toBe('UnknownMetricError');
  });
});

// ── validateMetricRegistryEntry ───────────────────────────────────────────────

describe('validateMetricRegistryEntry', () => {
  test('valid entry returns { valid: true }', () => {
    const result = validateMetricRegistryEntry({ refreshCadence: 'daily', staleThresholdDays: 7 });
    expect(result.valid).toBe(true);
  });

  test('invalid cadence returns { valid: false } with an errors array', () => {
    const result = validateMetricRegistryEntry({ refreshCadence: 'hourly', staleThresholdDays: 7 });
    expect(result.valid).toBe(false);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.errors.some(e => /refreshCadence/.test(e))).toBe(true);
  });

  test('zero staleThresholdDays (non-positive) returns { valid: false }', () => {
    const result = validateMetricRegistryEntry({ refreshCadence: 'daily', staleThresholdDays: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /staleThresholdDays/.test(e))).toBe(true);
  });

  test('non-integer staleThresholdDays returns { valid: false }', () => {
    const result = validateMetricRegistryEntry({ refreshCadence: 'event_driven', staleThresholdDays: 3.5 });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /staleThresholdDays/.test(e))).toBe(true);
  });

  test('both fields invalid: errors array contains two entries', () => {
    const result = validateMetricRegistryEntry({ refreshCadence: 'weekly', staleThresholdDays: -1 });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});

// ── buildMetricIndex ──────────────────────────────────────────────────────────

describe('buildMetricIndex', () => {
  test('throws on invalid registry entry (bad cadence)', () => {
    const badSources = {
      test_source: {
        metrics: {
          some_metric: { refreshCadence: 'quarterly', staleThresholdDays: 90 },
        },
      },
    };
    expect(() => buildMetricIndex(badSources)).toThrow(/Invalid registry entry/);
  });

  test('throws on duplicate metric appearing under two different sources', () => {
    const dupSources = {
      source_a: {
        metrics: { shared_metric: { refreshCadence: 'daily', staleThresholdDays: 7 } },
      },
      source_b: {
        metrics: { shared_metric: { refreshCadence: 'event_driven', staleThresholdDays: 30 } },
      },
    };
    expect(() => buildMetricIndex(dupSources)).toThrow(/Duplicate metric/);
  });

  test('valid multi-source input builds a flat index with source annotation', () => {
    const validSources = {
      src_a: {
        metrics: { metric_a: { refreshCadence: 'daily', staleThresholdDays: 7 } },
      },
      src_b: {
        metrics: { metric_b: { refreshCadence: 'event_driven', staleThresholdDays: 365 } },
      },
    };
    const index = buildMetricIndex(validSources);
    expect(index.metric_a.source).toBe('src_a');
    expect(index.metric_b.source).toBe('src_b');
    expect(index.metric_a.staleThresholdDays).toBe(7);
  });
});
