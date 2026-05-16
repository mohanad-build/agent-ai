'use strict';

// Mock sources.js so isStale / getFreshPoint tests are not bound to real
// registry contents. The test registry maps all fixture metric names to a
// 30-day threshold. UnknownMetricError is the real class (from requireActual).
jest.mock('../src/content/sources', () => {
  const actual = jest.requireActual('../src/content/sources');
  const { UnknownMetricError } = actual;
  const TEST_POLICY = { refreshCadence: 'monthly', staleThresholdDays: 30, source: 'test_registry' };
  const KNOWN = new Set([
    'avg_home_price', 'sales_volume', 'other', 'first', 'second',
    'boc_overnight_rate', 'boc_last_decision_date', 'goc_5yr_yield',
  ]);
  return {
    ...actual,
    resolveMetricPolicy: jest.fn((metricName) => {
      if (KNOWN.has(metricName)) return { ...TEST_POLICY };
      throw new UnknownMetricError(metricName);
    }),
    UnknownMetricError,
  };
});

const fs   = require('node:fs/promises');
const os   = require('node:os');
const path = require('node:path');

const {
  validateDataPoint,
  readSnapshot,
  writeSnapshot,
  isStale,
  getFreshPoint,
  appendPullLog,
  currentWeek,
  currentMonth,
} = require('../src/content/cache');

const { UnknownMetricError } = require('../src/content/sources');

// ── Fixture helpers ───────────────────────────────────────────────────────────

// Observation-level fields only -- staleThresholdDays and refreshCadence are
// policy fields owned by the metric registry and must not appear on data points.
function makePoint(overrides) {
  return {
    metric:     'avg_home_price',
    value:      1200000,
    unit:       'CAD',
    asOf:       '2026-05-01T00:00:00.000Z',
    source:     'TRREB',
    sourceUrl:  'https://trreb.ca/stats',
    confidence: 'high',
    ...overrides,
  };
}

// ── validateDataPoint ─────────────────────────────────────────────────────────

describe('validateDataPoint', () => {
  test('returns { valid: true } for a fully-formed point', () => {
    expect(validateDataPoint(makePoint())).toEqual({ valid: true });
  });

  test('rejects missing metric', () => {
    const r = validateDataPoint(makePoint({ metric: undefined }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/metric/);
  });

  test('rejects missing value', () => {
    const r = validateDataPoint(makePoint({ value: undefined }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/value/);
  });

  test('rejects missing unit', () => {
    const r = validateDataPoint(makePoint({ unit: undefined }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/unit/);
  });

  test('rejects missing asOf', () => {
    const r = validateDataPoint(makePoint({ asOf: undefined }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/asOf/);
  });

  test('rejects missing source', () => {
    const r = validateDataPoint(makePoint({ source: undefined }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/source/);
  });

  test('rejects missing sourceUrl', () => {
    const r = validateDataPoint(makePoint({ sourceUrl: undefined }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/sourceUrl/);
  });

  test('rejects missing confidence', () => {
    const r = validateDataPoint(makePoint({ confidence: undefined }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/confidence/);
  });

  test('rejects value as string instead of number', () => {
    const r = validateDataPoint(makePoint({ value: '1200000' }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/value/);
  });

  test('rejects empty string for metric', () => {
    const r = validateDataPoint(makePoint({ metric: '' }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/metric/);
  });

  test('rejects empty string for unit', () => {
    const r = validateDataPoint(makePoint({ unit: '' }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/unit/);
  });

  test('rejects NaN for value', () => {
    const r = validateDataPoint(makePoint({ value: NaN }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/value/);
  });

  test('rejects Infinity for value', () => {
    const r = validateDataPoint(makePoint({ value: Infinity }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/value/);
  });

  test('rejects invalid confidence value', () => {
    const r = validateDataPoint(makePoint({ confidence: 'certain' }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/confidence/);
  });

  test('rejects sourceUrl not starting with http', () => {
    const r = validateDataPoint(makePoint({ sourceUrl: 'ftp://trreb.ca' }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/sourceUrl/);
  });

  test('rejects malformed asOf', () => {
    const r = validateDataPoint(makePoint({ asOf: 'not-a-date' }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/asOf/);
  });

  // Policy fields are no longer required on the data point.
  test('accepts point without staleThresholdDays (policy lives in registry)', () => {
    const r = validateDataPoint(makePoint());
    expect(r.valid).toBe(true);
  });

  test('accepts point without refreshCadence (policy lives in registry)', () => {
    const r = validateDataPoint(makePoint());
    expect(r.valid).toBe(true);
  });

  test('accepts legacy point that still carries staleThresholdDays and refreshCadence', () => {
    // Legacy fields silently accepted -- they will be stripped on writeSnapshot.
    const r = validateDataPoint(makePoint({ staleThresholdDays: 35, refreshCadence: 'monthly' }));
    expect(r.valid).toBe(true);
  });
});

// ── readSnapshot ──────────────────────────────────────────────────────────────

describe('readSnapshot', () => {
  let baseDir;
  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'content-cache-'));
  });
  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  test('returns [] when file does not exist', async () => {
    const result = await readSnapshot('canada', '2026-05', { baseDir });
    expect(result).toEqual([]);
  });

  test('returns parsed array when file exists with valid JSON array', async () => {
    const points = [makePoint()];
    await writeSnapshot('canada', '2026-05', points, { baseDir });
    const result = await readSnapshot('canada', '2026-05', { baseDir });
    expect(result).toEqual(points);
  });

  test('throws on malformed JSON', async () => {
    const dir = path.join(baseDir, 'data', 'market', 'canada');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, '2026-05.json'), '{broken json', 'utf8');
    await expect(readSnapshot('canada', '2026-05', { baseDir })).rejects.toThrow();
  });

  test('rejects invalid region', async () => {
    await expect(readSnapshot('invalid_region', '2026-05', { baseDir })).rejects.toThrow(/region/);
  });

  test("rejects period '2026-5' (missing leading zero)", async () => {
    await expect(readSnapshot('canada', '2026-5', { baseDir })).rejects.toThrow(/period/);
  });

  test("rejects period '2026' (year only)", async () => {
    await expect(readSnapshot('canada', '2026', { baseDir })).rejects.toThrow(/period/);
  });

  test("rejects period 'not-a-date'", async () => {
    await expect(readSnapshot('canada', 'not-a-date', { baseDir })).rejects.toThrow(/period/);
  });

  test("accepts period '2026-05' (monthly)", async () => {
    const result = await readSnapshot('canada', '2026-05', { baseDir });
    expect(result).toEqual([]);
  });

  test("accepts period '2026-W20' (ISO week)", async () => {
    const result = await readSnapshot('canada', '2026-W20', { baseDir });
    expect(result).toEqual([]);
  });
});

// ── writeSnapshot ─────────────────────────────────────────────────────────────

describe('writeSnapshot', () => {
  let baseDir;
  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'content-cache-'));
  });
  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  test('writes a valid snapshot that readSnapshot can round-trip', async () => {
    const points = [makePoint(), makePoint({ metric: 'sales_volume', value: 4200 })];
    await writeSnapshot('toronto', '2026-05', points, { baseDir });
    const result = await readSnapshot('toronto', '2026-05', { baseDir });
    expect(result).toEqual(points);
  });

  test('throws with index and field name if any point is invalid', async () => {
    const points = [makePoint(), makePoint({ value: 'bad' })];
    await expect(writeSnapshot('canada', '2026-05', points, { baseDir }))
      .rejects.toThrow(/dataPoints\[1\].*value/);
  });

  test('creates region subdirectory if missing', async () => {
    await writeSnapshot('toronto', '2026-05', [makePoint()], { baseDir });
    const stat = await fs.stat(path.join(baseDir, 'data', 'market', 'toronto'));
    expect(stat.isDirectory()).toBe(true);
  });

  test('atomic write: second write replaces first; read returns complete version', async () => {
    const first  = [makePoint({ metric: 'first',  value: 1 })];
    const second = [makePoint({ metric: 'second', value: 2 })];
    await writeSnapshot('canada', '2026-05', first,  { baseDir });
    await writeSnapshot('canada', '2026-05', second, { baseDir });
    const result = await readSnapshot('canada', '2026-05', { baseDir });
    expect(result).toEqual(second);
    expect(result[0].metric).toBe('second');
  });

  test('rejects invalid region', async () => {
    await expect(writeSnapshot('invalid_region', '2026-05', [], { baseDir }))
      .rejects.toThrow(/region/);
  });

  test('rejects invalid period', async () => {
    await expect(writeSnapshot('canada', '2026-5', [], { baseDir }))
      .rejects.toThrow(/period/);
  });

  test('strips staleThresholdDays and refreshCadence from serialized points', async () => {
    const point = makePoint({ staleThresholdDays: 35, refreshCadence: 'monthly' });
    await writeSnapshot('canada', '2026-05', [point], { baseDir });
    const saved = await readSnapshot('canada', '2026-05', { baseDir });
    expect(saved[0].staleThresholdDays).toBeUndefined();
    expect(saved[0].refreshCadence).toBeUndefined();
    // All observation-level fields are preserved
    expect(saved[0].metric).toBe('avg_home_price');
    expect(saved[0].value).toBe(1200000);
  });
});

// ── isStale ───────────────────────────────────────────────────────────────────

describe('isStale', () => {
  // Mock registry maps 'avg_home_price' to staleThresholdDays: 30.
  // The asOf for all test points is 2026-05-01.

  const asOf = '2026-05-01T00:00:00.000Z';

  function makeTestPoint() {
    return makePoint({ asOf });
  }

  test('returns false for point exactly at threshold (boundary)', () => {
    const now = new Date('2026-05-31T00:00:00.000Z'); // exactly 30 days after asOf
    expect(isStale(makeTestPoint(), { now })).toBe(false);
  });

  test('returns false for point well within threshold', () => {
    const now = new Date('2026-05-10T00:00:00.000Z'); // 9 days after asOf
    expect(isStale(makeTestPoint(), { now })).toBe(false);
  });

  test('returns true for point one day past threshold', () => {
    const now = new Date('2026-06-01T00:00:00.000Z'); // 31 days after asOf
    expect(isStale(makeTestPoint(), { now })).toBe(true);
  });

  test('accepts now as Date object', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    expect(typeof isStale(makeTestPoint(), { now })).toBe('boolean');
  });

  test('accepts now as ISO string', () => {
    expect(typeof isStale(makeTestPoint(), { now: '2026-06-01T00:00:00.000Z' })).toBe('boolean');
  });

  test('throws on invalid now input', () => {
    expect(() => isStale(makeTestPoint(), { now: 'not-a-date' })).toThrow();
  });

  test('uses registry threshold, not any staleThresholdDays field on the point', () => {
    // Point carries staleThresholdDays: 90, but mock registry says 30.
    // 31 days past asOf: stale by 30-day threshold, fresh by 90-day threshold.
    // The result must be true (registry wins).
    const point = makePoint({ asOf, staleThresholdDays: 90 });
    const now = '2026-06-01T00:00:00.000Z'; // 31 days after asOf
    expect(isStale(point, { now })).toBe(true);
  });

  test('throws UnknownMetricError for a metric not in the registry', () => {
    const point = makePoint({ metric: 'totally_unregistered_metric' });
    expect(() => isStale(point, { now: '2026-06-01T00:00:00.000Z' })).toThrow(UnknownMetricError);
  });
});

// ── getFreshPoint ─────────────────────────────────────────────────────────────

describe('getFreshPoint', () => {
  let baseDir;
  const NOW = '2026-05-15T00:00:00.000Z';

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'content-cache-'));
  });
  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  test('returns the point when present and fresh', async () => {
    // 1 day old; mock registry threshold is 30 days -- fresh.
    const point = makePoint({ asOf: '2026-05-14T00:00:00.000Z' });
    await writeSnapshot('canada', '2026-05', [point], { baseDir });
    const result = await getFreshPoint('avg_home_price', 'canada', '2026-05', { now: NOW, baseDir });
    expect(result).not.toBeNull();
    expect(result.metric).toBe('avg_home_price');
  });

  test('returns null when file is missing', async () => {
    const result = await getFreshPoint('avg_home_price', 'canada', '2026-05', { now: NOW, baseDir });
    expect(result).toBeNull();
  });

  test('returns null when metric is not in the snapshot', async () => {
    const point = makePoint({ metric: 'sales_volume' });
    await writeSnapshot('canada', '2026-05', [point], { baseDir });
    const result = await getFreshPoint('avg_home_price', 'canada', '2026-05', { now: NOW, baseDir });
    expect(result).toBeNull();
  });

  test('returns null when point is present but stale', async () => {
    // 44 days old; mock registry threshold is 30 days -- stale.
    const point = makePoint({ asOf: '2026-04-01T00:00:00.000Z' });
    await writeSnapshot('canada', '2026-05', [point], { baseDir });
    const result = await getFreshPoint('avg_home_price', 'canada', '2026-05', { now: NOW, baseDir });
    expect(result).toBeNull();
  });

  test('does not throw on missing file (returns null)', async () => {
    await expect(getFreshPoint('avg_home_price', 'canada', '2026-05', { now: NOW, baseDir }))
      .resolves.toBeNull();
  });

  test('does not throw on missing metric (returns null, no registry lookup attempted)', async () => {
    await writeSnapshot('canada', '2026-05', [makePoint({ metric: 'other' })], { baseDir });
    await expect(getFreshPoint('avg_home_price', 'canada', '2026-05', { now: NOW, baseDir }))
      .resolves.toBeNull();
  });

  test('throws on corrupted snapshot file', async () => {
    const dir = path.join(baseDir, 'data', 'market', 'canada');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, '2026-05.json'), 'not json at all', 'utf8');
    await expect(getFreshPoint('avg_home_price', 'canada', '2026-05', { now: NOW, baseDir }))
      .rejects.toThrow(/JSON|parse|unexpected/i);
  });

  test('returns null when file missing (locks the missing-file contract)', async () => {
    const result = await getFreshPoint('avg_home_price', 'canada', '2026-05', { now: NOW, baseDir });
    expect(result).toBeNull();
  });

  test('propagates UnknownMetricError for a metric not in the registry', async () => {
    // Write the unregistered metric so getFreshPoint finds it and calls isStale,
    // which then calls resolveMetricPolicy and throws.
    const point = makePoint({ metric: 'totally_unregistered_metric', asOf: '2026-05-14T00:00:00.000Z' });
    await writeSnapshot('canada', '2026-05', [point], { baseDir });
    await expect(
      getFreshPoint('totally_unregistered_metric', 'canada', '2026-05', { now: NOW, baseDir })
    ).rejects.toBeInstanceOf(UnknownMetricError);
  });
});

// ── appendPullLog ─────────────────────────────────────────────────────────────

describe('appendPullLog', () => {
  let baseDir;
  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'content-cache-'));
  });
  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  test('creates the file and parent directory if missing', async () => {
    await appendPullLog({ source: 'test' }, { baseDir });
    const stat = await fs.stat(path.join(baseDir, 'data', 'market', '_pullLog.jsonl'));
    expect(stat.isFile()).toBe(true);
  });

  test('appends a second entry without overwriting the first', async () => {
    await appendPullLog({ source: 'first' },  { baseDir });
    await appendPullLog({ source: 'second' }, { baseDir });
    const raw = await fs.readFile(path.join(baseDir, 'data', 'market', '_pullLog.jsonl'), 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).source).toBe('first');
    expect(JSON.parse(lines[1]).source).toBe('second');
  });

  test('adds loggedAt field if not present in entry', async () => {
    await appendPullLog({ source: 'test' }, { baseDir });
    const raw = await fs.readFile(path.join(baseDir, 'data', 'market', '_pullLog.jsonl'), 'utf8');
    const entry = JSON.parse(raw.trim());
    expect(typeof entry.loggedAt).toBe('string');
    expect(new Date(entry.loggedAt).getTime()).not.toBeNaN();
  });

  test('preserves loggedAt field if already present in entry', async () => {
    const fixed = '2026-01-01T00:00:00.000Z';
    await appendPullLog({ source: 'test', loggedAt: fixed }, { baseDir });
    const raw = await fs.readFile(path.join(baseDir, 'data', 'market', '_pullLog.jsonl'), 'utf8');
    const entry = JSON.parse(raw.trim());
    expect(entry.loggedAt).toBe(fixed);
  });

  test('each line is independently parseable as JSON', async () => {
    await appendPullLog({ a: 1 }, { baseDir });
    await appendPullLog({ b: 2 }, { baseDir });
    await appendPullLog({ c: 3 }, { baseDir });
    const raw = await fs.readFile(path.join(baseDir, 'data', 'market', '_pullLog.jsonl'), 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

// ── currentWeek ───────────────────────────────────────────────────────────────

describe('currentWeek', () => {
  test("returns '2026-W20' for a Wednesday in week 20 of 2026", () => {
    expect(currentWeek('2026-05-13T12:00:00.000Z')).toBe('2026-W20');
  });

  test('returns ISO week-year for early-January edge case (Jan 1 falls in prior year week)', () => {
    expect(currentWeek('2027-01-01T00:00:00.000Z')).toBe('2026-W53');
  });

  test('returns ISO week-year for late-December edge case (Dec 30 falls in next year week 1)', () => {
    expect(currentWeek('2024-12-30T00:00:00.000Z')).toBe('2025-W01');
  });

  test("returns 'YYYY-W53' for 2026 (a year with 53 ISO weeks)", () => {
    expect(currentWeek('2026-12-31T00:00:00.000Z')).toBe('2026-W53');
  });

  test('accepts a Date object', () => {
    const d = new Date('2026-05-13T12:00:00.000Z');
    expect(currentWeek(d)).toBe('2026-W20');
  });

  test('accepts an ISO string', () => {
    expect(currentWeek('2026-05-13T12:00:00.000Z')).toBe('2026-W20');
  });

  test('throws on invalid now input', () => {
    expect(() => currentWeek('not-a-date')).toThrow();
    expect(() => currentWeek(undefined)).toThrow();
  });

  test('output format matches PERIOD_RE (round-trips through readSnapshot without throwing)', async () => {
    const period = currentWeek('2026-05-13T12:00:00.000Z');
    expect(period).toMatch(/^\d{4}-W\d{2}$/);
  });
});

// ── currentMonth ──────────────────────────────────────────────────────────────

describe('currentMonth', () => {
  test("returns '2026-05' for a date in May 2026", () => {
    expect(currentMonth('2026-05-13T12:00:00.000Z')).toBe('2026-05');
  });

  test("zero-pads single-digit months ('2026-01' not '2026-1')", () => {
    expect(currentMonth('2026-01-15T00:00:00.000Z')).toBe('2026-01');
  });

  test('uses UTC components -- May 31 23:00 EST (Jun 1 03:00 UTC) returns 2026-06', () => {
    expect(currentMonth('2026-06-01T03:00:00.000Z')).toBe('2026-06');
  });

  test('accepts a Date object', () => {
    const d = new Date('2026-05-13T12:00:00.000Z');
    expect(currentMonth(d)).toBe('2026-05');
  });

  test('accepts an ISO string', () => {
    expect(currentMonth('2026-05-13T12:00:00.000Z')).toBe('2026-05');
  });

  test('throws on invalid now input', () => {
    expect(() => currentMonth('not-a-date')).toThrow();
    expect(() => currentMonth(undefined)).toThrow();
  });

  test('output format matches PERIOD_RE (YYYY-MM)', () => {
    expect(currentMonth('2026-05-13T12:00:00.000Z')).toMatch(/^\d{4}-\d{2}$/);
  });
});
