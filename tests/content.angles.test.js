'use strict';

// Factory mock: preserves real error classes, wraps resolveMetricPolicy as jest.fn().
jest.mock('../src/content/sources', () => {
  const actual = jest.requireActual('../src/content/sources');
  const { UnknownMetricError } = actual;
  const KNOWN = new Set([
    'boc_overnight_rate', 'boc_last_decision_date', 'goc_5yr_yield',
    'avg_home_price', 'sales_volume',
  ]);
  const DAILY_POLICY   = { refreshCadence: 'daily',        staleThresholdDays: 7,   source: 'test' };
  const EVENT_POLICY   = { refreshCadence: 'event_driven', staleThresholdDays: 365, source: 'test' };
  return {
    ...actual,
    resolveMetricPolicy: jest.fn((name) => {
      if (name === 'boc_overnight_rate' || name === 'boc_last_decision_date') return { ...EVENT_POLICY };
      if (KNOWN.has(name)) return { ...DAILY_POLICY };
      throw new UnknownMetricError(name);
    }),
    UnknownMetricError,
  };
});

const fs   = require('node:fs');
const fsp  = require('node:fs/promises');
const os   = require('node:os');
const path = require('node:path');

const { UnknownMetricError } = require('../src/content/sources');

const {
  generateWeeklyAngles,
  readWeeklyAngles,
  shouldRunAngleGeneration,
  AngleGenerationError,
  InsufficientDataError,
  _internal,
} = require('../src/content/angles');

const {
  gatherDataSlice,
  buildAngleGenerationPrompt,
  validateAngle,
  hashDataSlice,
  validateWeekIso,
} = _internal;

// ── Fixture helpers ───────────────────────────────────────────────────────────

function validAngle(overrides = {}) {
  return {
    id:               'angle-2026-W20-001',
    weekStartIso:     '2026-05-11T00:00:00Z',
    headline:         'Bond yields soften while BoC holds steady',
    thesis:           'Five-year GoC yields fell 12bp in two weeks even as the BoC held its overnight rate, signalling bond markets may be pricing in cuts the central bank has not yet announced.',
    dataPoints:       [{ metric: 'goc_5yr_yield', asOf: '2026-05-14T00:00:00.000Z' }],
    themeTag:         'rates',
    audienceFocus:    'both',
    bestSuitedFor:    ['blog'],
    surpriseScore:    0.72,
    longFormSuitable: true,
    forbidsRateAdvice: true,
    sourceFooter:     'Bank of Canada (May 14 2026)',
    ...overrides,
  };
}

function validMenuJson(weekIso = '2026-W20', overrides = {}) {
  return JSON.stringify({
    weekIso,
    generatedAt:          '2026-05-17T10:00:00.000Z',
    modelUsed:            'claude-sonnet-4-6',
    dataSliceFingerprint: 'abc123def456abcd',
    angles:               [validAngle(), validAngle({ id: 'angle-2026-W20-002', headline: 'Second angle' })],
    ...overrides,
  }, null, 2);
}

function makeCallRaw(responses) {
  let i = 0;
  return jest.fn(async () => {
    if (i >= responses.length) return responses[responses.length - 1];
    return responses[i++];
  });
}

async function writeTmpSnapshot(tmpDir, region, filename, points) {
  const dir = path.join(tmpDir, '_market', region);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(points, null, 2));
}

// ── validateWeekIso ───────────────────────────────────────────────────────────

describe('validateWeekIso', () => {
  test('accepts 2026-W01', () => expect(() => validateWeekIso('2026-W01')).not.toThrow());
  test('accepts 2026-W20', () => expect(() => validateWeekIso('2026-W20')).not.toThrow());
  test('accepts 2026-W53', () => expect(() => validateWeekIso('2026-W53')).not.toThrow());

  test('rejects 2026-W00', () => {
    expect(() => validateWeekIso('2026-W00')).toThrow(/malformed weekIso/);
  });
  test('rejects 2026-W54', () => {
    expect(() => validateWeekIso('2026-W54')).toThrow(/malformed weekIso/);
  });
  test('rejects 2026-W1 (no zero padding)', () => {
    expect(() => validateWeekIso('2026-W1')).toThrow(/malformed weekIso/);
  });
  test('rejects 2026-20 (missing W prefix)', () => {
    expect(() => validateWeekIso('2026-20')).toThrow(/malformed weekIso/);
  });
  test('rejects empty string', () => {
    expect(() => validateWeekIso('')).toThrow(/malformed weekIso/);
  });
  test('rejects totally malformed string', () => {
    expect(() => validateWeekIso('not-a-week')).toThrow(/malformed weekIso/);
  });
});

// ── validateAngle ─────────────────────────────────────────────────────────────

describe('validateAngle', () => {
  test('valid full angle returns { valid: true }', () => {
    expect(validateAngle(validAngle())).toEqual({ valid: true });
  });

  test('missing headline returns invalid', () => {
    const r = validateAngle(validAngle({ headline: '' }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/headline/);
  });

  test('missing thesis returns invalid', () => {
    const r = validateAngle(validAngle({ thesis: '' }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/thesis/);
  });

  test('missing weekStartIso returns invalid', () => {
    const r = validateAngle(validAngle({ weekStartIso: '' }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/weekStartIso/);
  });

  test('wrong themeTag returns invalid', () => {
    const r = validateAngle(validAngle({ themeTag: 'mortgages' }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/themeTag/);
  });

  test('wrong audienceFocus returns invalid', () => {
    const r = validateAngle(validAngle({ audienceFocus: 'everyone' }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/audienceFocus/);
  });

  test('empty bestSuitedFor array returns invalid', () => {
    const r = validateAngle(validAngle({ bestSuitedFor: [] }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/bestSuitedFor/);
  });

  test('bestSuitedFor with unknown value returns invalid', () => {
    const r = validateAngle(validAngle({ bestSuitedFor: ['podcast'] }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/bestSuitedFor/);
  });

  test('surpriseScore below 0 returns invalid', () => {
    const r = validateAngle(validAngle({ surpriseScore: -0.1 }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/surpriseScore/);
  });

  test('surpriseScore above 1 returns invalid', () => {
    const r = validateAngle(validAngle({ surpriseScore: 1.1 }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/surpriseScore/);
  });

  test('dataPoints empty array returns invalid', () => {
    const r = validateAngle(validAngle({ dataPoints: [] }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/dataPoints/);
  });

  test('dataPoints with unregistered metric returns invalid (not thrown)', () => {
    const r = validateAngle(validAngle({ dataPoints: [{ metric: 'unknown_metric_xyz', asOf: '2026-05-01T00:00:00Z' }] }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/unknown metric/);
  });

  test('malformed id returns invalid', () => {
    const r = validateAngle(validAngle({ id: 'bad-id' }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/id/);
  });

  test('extra unknown fields are permitted (returns valid)', () => {
    const a = validAngle();
    a.extraUnknownField = 'whatever';
    expect(validateAngle(a)).toEqual({ valid: true });
  });

  test('multiple errors accumulate', () => {
    const r = validateAngle(validAngle({ headline: '', thesis: '', themeTag: 'bad' }));
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ── hashDataSlice ─────────────────────────────────────────────────────────────

describe('hashDataSlice', () => {
  const baseSlice = {
    generatedAt:     '2026-05-17T10:00:00Z',
    weekIso:         '2026-W20',
    windowStartIso:  '2026-05-03T10:00:00Z',
    windowEndIso:    '2026-05-17T10:00:00Z',
    metrics:         { goc_5yr_yield: { currentValue: 3.22 } },
  };

  test('same slice content produces same hash', () => {
    expect(hashDataSlice(baseSlice)).toBe(hashDataSlice({ ...baseSlice }));
  });

  test('different slice content produces different hash', () => {
    const different = { ...baseSlice, metrics: { goc_5yr_yield: { currentValue: 3.50 } } };
    expect(hashDataSlice(baseSlice)).not.toBe(hashDataSlice(different));
  });

  test('changing generatedAt alone produces same hash', () => {
    const other = { ...baseSlice, generatedAt: '2099-01-01T00:00:00Z' };
    expect(hashDataSlice(baseSlice)).toBe(hashDataSlice(other));
  });
});

// ── gatherDataSlice ───────────────────────────────────────────────────────────

describe('gatherDataSlice', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'angles-gather-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const NOW = new Date('2026-05-17T12:00:00Z');

  test('empty data dirs produce metrics: {}', async () => {
    const slice = await gatherDataSlice({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir });
    expect(slice.metrics).toEqual({});
  });

  test('single daily metric in window produces correct currentValue', async () => {
    await writeTmpSnapshot(tmpDir, 'canada', '2026-W20.json', [{
      metric: 'goc_5yr_yield', value: 3.22, unit: 'percent',
      asOf: '2026-05-14T00:00:00.000Z', source: 'Bank of Canada',
      sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
    }]);
    const slice = await gatherDataSlice({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir });
    expect(slice.metrics['goc_5yr_yield'].currentValue).toBe(3.22);
    expect(slice.metrics['goc_5yr_yield'].delta7d).toBeNull(); // only one obs, no 7d reference
  });

  test('daily metric with two observations computes delta7d', async () => {
    const now = new Date('2026-05-17T00:00:00Z');
    await writeTmpSnapshot(tmpDir, 'canada', '2026-05.json', [
      {
        metric: 'goc_5yr_yield', value: 3.30, unit: 'percent',
        asOf: '2026-05-10T00:00:00.000Z', source: 'Bank of Canada',
        sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
      },
      {
        metric: 'goc_5yr_yield', value: 3.22, unit: 'percent',
        asOf: '2026-05-17T00:00:00.000Z', source: 'Bank of Canada',
        sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
      },
    ]);
    const slice = await gatherDataSlice({ weekIso: '2026-W20', now, baseDir: tmpDir });
    const m = slice.metrics['goc_5yr_yield'];
    expect(m.currentValue).toBe(3.22);
    // delta7d = 3.22 - 3.30 = -0.08 (approx)
    expect(m.delta7d).toBeCloseTo(-0.08, 5);
  });

  test('event-driven metric in window produces delta7d: null and note string', async () => {
    await writeTmpSnapshot(tmpDir, 'canada', '2026-W20.json', [{
      metric: 'boc_overnight_rate', value: 2.25, unit: 'percent',
      asOf: '2025-10-30T00:00:00.000Z', source: 'Bank of Canada',
      sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
    }]);
    const slice = await gatherDataSlice({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir });
    const m = slice.metrics['boc_overnight_rate'];
    expect(m.delta7d).toBeNull();
    expect(m.delta14d).toBeNull();
    expect(typeof m.note).toBe('string');
    expect(m.note).toMatch(/Event-driven metric/);
  });

  test('event-driven metric outside 14d window is still pulled, note reflects actual age', async () => {
    // asOf is 200 days before NOW -- well outside 14d window
    const asOf = new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString();
    await writeTmpSnapshot(tmpDir, 'canada', '2025-W20.json', [{
      metric: 'boc_overnight_rate', value: 2.25, unit: 'percent',
      asOf, source: 'Bank of Canada',
      sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
    }]);
    const slice = await gatherDataSlice({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir });
    const m = slice.metrics['boc_overnight_rate'];
    expect(m).not.toBeUndefined();
    expect(m.note).toMatch(/200 days ago/);
  });

  test('unregistered metric in snapshot is silently skipped', async () => {
    await writeTmpSnapshot(tmpDir, 'canada', '2026-W20.json', [{
      metric: 'totally_unknown_metric', value: 99, unit: 'units',
      asOf: '2026-05-14T00:00:00.000Z', source: 'Nowhere',
      sourceUrl: 'https://example.com', confidence: 'high',
    }]);
    const slice = await gatherDataSlice({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir });
    expect(slice.metrics['totally_unknown_metric']).toBeUndefined();
  });

  test('both canada/ and toronto/ directories are read', async () => {
    await writeTmpSnapshot(tmpDir, 'canada', '2026-W20.json', [{
      metric: 'goc_5yr_yield', value: 3.22, unit: 'percent',
      asOf: '2026-05-14T00:00:00.000Z', source: 'Bank of Canada',
      sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
    }]);
    await writeTmpSnapshot(tmpDir, 'toronto', '2026-W20.json', [{
      metric: 'avg_home_price', value: 1100000, unit: 'CAD',
      asOf: '2026-05-14T00:00:00.000Z', source: 'TRREB',
      sourceUrl: 'https://trreb.ca', confidence: 'high',
    }]);
    const slice = await gatherDataSlice({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir });
    expect(slice.metrics['goc_5yr_yield']).toBeDefined();
    expect(slice.metrics['avg_home_price']).toBeDefined();
  });

  test('monthly and weekly snapshot files are both read', async () => {
    // Monthly file
    await writeTmpSnapshot(tmpDir, 'canada', '2026-05.json', [{
      metric: 'goc_5yr_yield', value: 3.30, unit: 'percent',
      asOf: '2026-05-10T00:00:00.000Z', source: 'Bank of Canada',
      sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
    }]);
    // Weekly file
    await writeTmpSnapshot(tmpDir, 'canada', '2026-W20.json', [{
      metric: 'avg_home_price', value: 1100000, unit: 'CAD',
      asOf: '2026-05-14T00:00:00.000Z', source: 'TRREB',
      sourceUrl: 'https://trreb.ca', confidence: 'high',
    }]);
    const slice = await gatherDataSlice({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir });
    expect(slice.metrics['goc_5yr_yield']).toBeDefined();
    expect(slice.metrics['avg_home_price']).toBeDefined();
  });

  test('corrupted snapshot propagates JSON parse error', async () => {
    const dir = path.join(tmpDir, '_market', 'canada');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '2026-W20.json'), '{corrupt json{{');
    await expect(
      gatherDataSlice({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir })
    ).rejects.toThrow();
  });

  test('windowStartIso is 14 days before now', async () => {
    const slice = await gatherDataSlice({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir });
    const startMs = new Date(slice.windowStartIso).getTime();
    const expectedMs = NOW.getTime() - 14 * 24 * 60 * 60 * 1000;
    expect(startMs).toBe(expectedMs);
  });

  test('windowEndIso matches now', async () => {
    const slice = await gatherDataSlice({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir });
    expect(new Date(slice.windowEndIso).getTime()).toBe(NOW.getTime());
  });

  test('event-driven metric includes pre-window observations within staleThresholdDays, sorted ascending', async () => {
    await writeTmpSnapshot(tmpDir, 'canada', 'history.json', [
      {
        metric: 'boc_overnight_rate', value: 2.50, unit: 'percent',
        asOf: '2025-10-30T00:00:00.000Z', source: 'Bank of Canada',
        sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
      },
      {
        metric: 'boc_overnight_rate', value: 2.25, unit: 'percent',
        asOf: '2026-05-14T00:00:00.000Z', source: 'Bank of Canada',
        sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
      },
    ]);
    const slice = await gatherDataSlice({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir });
    const m = slice.metrics['boc_overnight_rate'];
    expect(m).toBeDefined();
    expect(m.observations).toHaveLength(2);
    expect(m.observations[0].asOf).toBe('2025-10-30T00:00:00.000Z');
    expect(m.observations[1].asOf).toBe('2026-05-14T00:00:00.000Z');
    expect(m.currentValue).toBe(2.25);
    expect(m.currentAsOf).toBe('2026-05-14T00:00:00.000Z');
    expect(m.delta7d).toBeNull();
    expect(m.delta14d).toBeNull();
    expect(m.note).toMatch(/2026-05-14/);
  });

  test('event-driven metric with observation older than staleThresholdDays falls back to mostRecent', async () => {
    await writeTmpSnapshot(tmpDir, 'canada', 'history.json', [{
      metric: 'boc_overnight_rate', value: 3.00, unit: 'percent',
      asOf: '2024-01-01T00:00:00.000Z', source: 'Bank of Canada',
      sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
    }]);
    const slice = await gatherDataSlice({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir });
    const m = slice.metrics['boc_overnight_rate'];
    expect(m).toBeDefined();
    expect(m.observations).toHaveLength(1);
    expect(m.observations[0].asOf).toBe('2024-01-01T00:00:00.000Z');
    expect(m.currentValue).toBe(3.00);
    expect(m.currentAsOf).toBe('2024-01-01T00:00:00.000Z');
    expect(m.note).toMatch(/days ago/);
  });

  test('event-driven metric with multiple pre-window observations within staleness includes all, sorted ascending', async () => {
    await writeTmpSnapshot(tmpDir, 'canada', 'history.json', [
      {
        metric: 'boc_overnight_rate', value: 3.00, unit: 'percent',
        asOf: '2025-09-04T00:00:00.000Z', source: 'Bank of Canada',
        sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
      },
      {
        metric: 'boc_overnight_rate', value: 2.75, unit: 'percent',
        asOf: '2025-10-30T00:00:00.000Z', source: 'Bank of Canada',
        sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
      },
      {
        metric: 'boc_overnight_rate', value: 2.50, unit: 'percent',
        asOf: '2025-12-11T00:00:00.000Z', source: 'Bank of Canada',
        sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
      },
    ]);
    const slice = await gatherDataSlice({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir });
    const m = slice.metrics['boc_overnight_rate'];
    expect(m).toBeDefined();
    expect(m.observations).toHaveLength(3);
    expect(m.observations[0].asOf).toBe('2025-09-04T00:00:00.000Z');
    expect(m.observations[1].asOf).toBe('2025-10-30T00:00:00.000Z');
    expect(m.observations[2].asOf).toBe('2025-12-11T00:00:00.000Z');
    expect(m.currentValue).toBe(2.50);
    expect(m.currentAsOf).toBe('2025-12-11T00:00:00.000Z');
    expect(m.note).toMatch(/2025-12-11/);
  });

  test('daily metric excludes pre-window observations (regression: staleness window must not affect daily metrics)', async () => {
    await writeTmpSnapshot(tmpDir, 'canada', 'history.json', [
      {
        metric: 'goc_5yr_yield', value: 3.10, unit: 'percent',
        asOf: '2026-04-15T00:00:00.000Z', source: 'Bank of Canada',
        sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
      },
      {
        metric: 'goc_5yr_yield', value: 3.22, unit: 'percent',
        asOf: '2026-05-10T12:00:00.000Z', source: 'Bank of Canada',
        sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
      },
      {
        metric: 'goc_5yr_yield', value: 3.35, unit: 'percent',
        asOf: '2026-05-17T12:00:00.000Z', source: 'Bank of Canada',
        sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
      },
    ]);
    const slice = await gatherDataSlice({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir });
    const m = slice.metrics['goc_5yr_yield'];
    expect(m).toBeDefined();
    expect(m.observations).toHaveLength(2);
    expect(m.currentValue).toBe(3.35);
    const obsAsOfs = m.observations.map(o => o.asOf);
    expect(obsAsOfs).not.toContain('2026-04-15T00:00:00.000Z');
    expect(obsAsOfs).toContain('2026-05-10T12:00:00.000Z');
    expect(obsAsOfs).toContain('2026-05-17T12:00:00.000Z');
  });
});

// ── generateWeeklyAngles ──────────────────────────────────────────────────────

describe('generateWeeklyAngles', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'angles-gen-'));
    // Provide fixture data so the defensive data-presence check in generateWeeklyAngles passes.
    const dir = path.join(tmpDir, '_market', 'canada');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'fixture.json'), JSON.stringify([
      { metric: 'goc_5yr_yield',         value: 3.22, unit: 'percent', asOf: '2026-05-14T00:00:00.000Z', source: 'Bank of Canada', sourceUrl: 'https://bankofcanada.ca', confidence: 'high' },
      { metric: 'boc_overnight_rate',    value: 2.75, unit: 'percent', asOf: '2026-01-01T00:00:00.000Z', source: 'Bank of Canada', sourceUrl: 'https://bankofcanada.ca', confidence: 'high' },
      { metric: 'boc_last_decision_date', value: '2026-01-29', unit: 'date',    asOf: '2026-01-29T00:00:00.000Z', source: 'Bank of Canada', sourceUrl: 'https://bankofcanada.ca', confidence: 'high' },
    ]));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const NOW = new Date('2026-05-17T12:00:00Z');

  function anglesResponse(angles) {
    return JSON.stringify({ angles });
  }

  const TWO_VALID_ANGLES = [
    validAngle({ id: 'angle-2026-W20-001' }),
    validAngle({ id: 'angle-2026-W20-002', headline: 'Second angle' }),
  ];

  test('happy path: returns angles, writes file, regenerated: true', async () => {
    const callRaw = makeCallRaw([anglesResponse(TWO_VALID_ANGLES)]);
    const result = await generateWeeklyAngles({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir, callRaw });
    expect(result.regenerated).toBe(true);
    expect(result.weekIso).toBe('2026-W20');
    expect(result.angles.length).toBe(2);
    expect(typeof result.dataSliceFingerprint).toBe('string');
    // File on disk
    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, '_market', '_angles', '2026-W20.json'), 'utf8'));
    expect(onDisk.angles.length).toBe(2);
    expect(onDisk.modelUsed).toBe('claude-sonnet-4-6');
  });

  test('idempotency: second call with same data slice returns cached, regenerated: false, Claude not called', async () => {
    const callRaw = makeCallRaw([anglesResponse(TWO_VALID_ANGLES)]);
    // First call
    const first = await generateWeeklyAngles({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir, callRaw });
    expect(first.regenerated).toBe(true);
    const callCount = callRaw.mock.calls.length;

    // Second call -- same data, same fingerprint
    const second = await generateWeeklyAngles({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir, callRaw });
    expect(second.regenerated).toBe(false);
    expect(callRaw.mock.calls.length).toBe(callCount); // no additional Claude calls
  });

  test('opts.force: true bypasses idempotency, Claude called again', async () => {
    const callRaw = makeCallRaw([
      anglesResponse(TWO_VALID_ANGLES),
      anglesResponse(TWO_VALID_ANGLES),
    ]);
    await generateWeeklyAngles({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir, callRaw });
    const result = await generateWeeklyAngles({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir, callRaw, force: true });
    expect(result.regenerated).toBe(true);
    expect(callRaw.mock.calls.length).toBe(2);
  });

  test('Claude returns malformed JSON then valid: succeeds, Claude called twice', async () => {
    const callRaw = makeCallRaw(['not-json', anglesResponse(TWO_VALID_ANGLES)]);
    const result = await generateWeeklyAngles({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir, callRaw });
    expect(result.angles.length).toBe(2);
    expect(callRaw.mock.calls.length).toBe(2);
  });

  test('Claude returns malformed JSON twice: throws AngleGenerationError', async () => {
    const callRaw = makeCallRaw(['not-json', 'also-not-json']);
    await expect(
      generateWeeklyAngles({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir, callRaw })
    ).rejects.toThrow(AngleGenerationError);
  });

  test('Claude returns only 1 valid angle then 3 valid: succeeds', async () => {
    const oneValid = [validAngle({ id: 'angle-2026-W20-001' })];
    const threeValid = [
      validAngle({ id: 'angle-2026-W20-001' }),
      validAngle({ id: 'angle-2026-W20-002', headline: 'Second' }),
      validAngle({ id: 'angle-2026-W20-003', headline: 'Third' }),
    ];
    const callRaw = makeCallRaw([anglesResponse(oneValid), anglesResponse(threeValid)]);
    const result = await generateWeeklyAngles({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir, callRaw });
    expect(result.angles.length).toBe(3);
  });

  test('Claude returns only 1 valid angle twice: throws AngleGenerationError', async () => {
    const oneValid = [validAngle({ id: 'angle-2026-W20-001' })];
    const callRaw = makeCallRaw([anglesResponse(oneValid), anglesResponse(oneValid)]);
    await expect(
      generateWeeklyAngles({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir, callRaw })
    ).rejects.toThrow(AngleGenerationError);
  });

  test('invalid angles are filtered, valid ones retained', async () => {
    const mixed = [
      validAngle({ id: 'angle-2026-W20-001' }),
      validAngle({ id: 'angle-2026-W20-002', headline: '' }), // invalid: empty headline
      validAngle({ id: 'angle-2026-W20-003', headline: 'Third' }),
    ];
    const callRaw = makeCallRaw([anglesResponse(mixed)]);
    const result = await generateWeeklyAngles({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir, callRaw });
    expect(result.angles.length).toBe(2);
    expect(result.angles.every(a => a.headline.trim() !== '')).toBe(true);
  });

  test('file persisted atomically: .tmp file does not remain after write', async () => {
    const callRaw = makeCallRaw([anglesResponse(TWO_VALID_ANGLES)]);
    await generateWeeklyAngles({ weekIso: '2026-W20', now: NOW, baseDir: tmpDir, callRaw });
    const anglesDir = path.join(tmpDir, '_market', '_angles');
    const files = fs.readdirSync(anglesDir);
    expect(files.some(f => f.endsWith('.tmp'))).toBe(false);
    expect(files).toContain('2026-W20.json');
  });

  test('malformed opts.weekIso throws before any Claude call', async () => {
    const callRaw = jest.fn();
    await expect(
      generateWeeklyAngles({ weekIso: 'bad-week', now: NOW, baseDir: tmpDir, callRaw })
    ).rejects.toThrow(/malformed weekIso/);
    expect(callRaw).not.toHaveBeenCalled();
  });
});

// ── readWeeklyAngles ──────────────────────────────────────────────────────────

describe('readWeeklyAngles', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'angles-read-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns null when file does not exist', async () => {
    const result = await readWeeklyAngles('2026-W20', { baseDir: tmpDir });
    expect(result).toBeNull();
  });

  test('returns parsed object when file exists', async () => {
    const dir = path.join(tmpDir, '_market', '_angles');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '2026-W20.json'), validMenuJson(), 'utf8');
    const result = await readWeeklyAngles('2026-W20', { baseDir: tmpDir });
    expect(result.weekIso).toBe('2026-W20');
    expect(result.angles.length).toBe(2);
  });

  test('throws on JSON parse failure (corruption-loud)', async () => {
    const dir = path.join(tmpDir, '_market', '_angles');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '2026-W20.json'), '{corrupt{{', 'utf8');
    await expect(readWeeklyAngles('2026-W20', { baseDir: tmpDir })).rejects.toThrow();
  });

  test('throws on malformed weekIso', async () => {
    await expect(readWeeklyAngles('2026-W00', { baseDir: tmpDir })).rejects.toThrow(/malformed weekIso/);
  });
});

// ── shouldRunAngleGeneration — time gate ──────────────────────────────────────
//
// 2026-06-21 is a Sunday in summer (EDT = UTC-4).
// Target: Sunday 04:00-04:05 America/Toronto (5-minute grace window).

describe('shouldRunAngleGeneration — time gate', () => {
  test('returns true at Sunday 04:00 Toronto', () => {
    // 04:00 EDT = 08:00 UTC
    expect(shouldRunAngleGeneration(new Date('2026-06-21T08:00:00Z'))).toBe(true);
  });

  test('returns true at Sunday 04:04 Toronto (inside 5-minute grace window)', () => {
    expect(shouldRunAngleGeneration(new Date('2026-06-21T08:04:00Z'))).toBe(true);
  });

  test('returns false at Sunday 04:06 Toronto (outside 5-minute grace window)', () => {
    expect(shouldRunAngleGeneration(new Date('2026-06-21T08:06:00Z'))).toBe(false);
  });

  test('returns false at Saturday 04:00 Toronto (wrong day)', () => {
    // 2026-06-20 is Saturday; 04:00 EDT = 08:00 UTC
    expect(shouldRunAngleGeneration(new Date('2026-06-20T08:00:00Z'))).toBe(false);
  });

  test('returns false at Sunday 03:00 Toronto (wrong hour)', () => {
    // 03:00 EDT = 07:00 UTC
    expect(shouldRunAngleGeneration(new Date('2026-06-21T07:00:00Z'))).toBe(false);
  });
});

// ── defensive data-presence check ────────────────────────────────────────────

describe('defensive data-presence check', () => {
  let tmpDir;
  const NOW_D = new Date('2026-06-25T12:00:00Z');
  const WEEK = '2026-W26';

  function w26Angle(overrides = {}) {
    return validAngle({
      id: 'angle-2026-W26-001',
      weekStartIso: '2026-06-22T00:00:00Z',
      ...overrides,
    });
  }

  function w26AnglesResponse(count = 2) {
    const angles = [];
    for (let i = 1; i <= count; i++) {
      const pad = String(i).padStart(3, '0');
      angles.push(w26Angle({ id: `angle-2026-W26-${pad}`, headline: `Angle ${i}` }));
    }
    return JSON.stringify({ angles });
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'angles-defensive-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  test('throws InsufficientDataError on zero metrics', async () => {
    const callRaw = jest.fn();
    const err = await generateWeeklyAngles({ weekIso: WEEK, now: NOW_D, baseDir: tmpDir, callRaw })
      .catch(e => e);
    expect(err).toBeInstanceOf(InsufficientDataError);
    expect(err.detail.fresh).toBe(0);
    expect(err.detail.expected).toBe(3);
    expect(err.detail.weekIso).toBe(WEEK);
    expect(callRaw).not.toHaveBeenCalled();
  });

  test('proceeds with degraded data (1 of 3), calls injected log helper', async () => {
    await writeTmpSnapshot(tmpDir, 'canada', '2026-06.json', [{
      metric: 'goc_5yr_yield', value: 3.22, unit: 'percent',
      asOf: '2026-06-20T00:00:00.000Z', source: 'Bank of Canada',
      sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
    }]);
    const callRaw = jest.fn().mockResolvedValue(w26AnglesResponse(2));
    const logHelper = jest.fn();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await generateWeeklyAngles({
      weekIso: WEEK, now: NOW_D, baseDir: tmpDir, callRaw,
      appendUpstreamErrorLog: logHelper,
    });

    expect(result.angles.length).toBeGreaterThanOrEqual(2);
    expect(logHelper).toHaveBeenCalledWith('angle-gen-degraded', expect.stringContaining('1 of 3'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('1 of 3'));
  });

  test('proceeds with degraded data (2 of 3) without injected helper, only console.warn fires', async () => {
    await writeTmpSnapshot(tmpDir, 'canada', '2026-06.json', [
      {
        metric: 'goc_5yr_yield', value: 3.22, unit: 'percent',
        asOf: '2026-06-20T00:00:00.000Z', source: 'Bank of Canada',
        sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
      },
      {
        metric: 'boc_overnight_rate', value: 2.75, unit: 'percent',
        asOf: '2026-05-01T00:00:00.000Z', source: 'Bank of Canada',
        sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
      },
    ]);
    const callRaw = jest.fn().mockResolvedValue(w26AnglesResponse(2));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await generateWeeklyAngles({ weekIso: WEEK, now: NOW_D, baseDir: tmpDir, callRaw });

    expect(result.angles.length).toBeGreaterThanOrEqual(2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('2 of 3'));
  });

  test('full 3-metric count proceeds normally, no degraded-data warn or log call', async () => {
    await writeTmpSnapshot(tmpDir, 'canada', '2026-06.json', [
      {
        metric: 'goc_5yr_yield', value: 3.22, unit: 'percent',
        asOf: '2026-06-20T00:00:00.000Z', source: 'Bank of Canada',
        sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
      },
      {
        metric: 'boc_overnight_rate', value: 2.75, unit: 'percent',
        asOf: '2026-05-01T00:00:00.000Z', source: 'Bank of Canada',
        sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
      },
      {
        metric: 'boc_last_decision_date', value: '2026-05-01', unit: 'date',
        asOf: '2026-05-01T00:00:00.000Z', source: 'Bank of Canada',
        sourceUrl: 'https://bankofcanada.ca', confidence: 'high',
      },
    ]);
    const callRaw = jest.fn().mockResolvedValue(w26AnglesResponse(2));
    const logHelper = jest.fn();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await generateWeeklyAngles({
      weekIso: WEEK, now: NOW_D, baseDir: tmpDir, callRaw,
      appendUpstreamErrorLog: logHelper,
    });

    expect(result.angles.length).toBeGreaterThanOrEqual(2);
    expect(logHelper).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('degraded'));
  });

  test('InsufficientDataError is exported from angles module', () => {
    const mod = require('../src/content/angles');
    expect(typeof mod.InsufficientDataError).toBe('function');
    const e = new mod.InsufficientDataError('test', { fresh: 0, expected: 3 });
    expect(e.name).toBe('InsufficientDataError');
    expect(e.detail).toEqual({ fresh: 0, expected: 3 });
  });
});
