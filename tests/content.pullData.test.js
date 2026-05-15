'use strict';

const fs   = require('node:fs/promises');
const os   = require('node:os');
const path = require('node:path');

const { pullBankOfCanada, _internal } = require('../src/content/pullData');
const { parseOvernightRate, parseLatestDecisionDate } = _internal;
const { readSnapshot, writeSnapshot, currentWeek } = require('../src/content/cache');

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Multi-observation overnight series (B114039) — newest-first, with a rate change.
// Used for both boc_overnight_rate and boc_last_decision_date.
const OVERNIGHT_FIXTURE = {
  observations: [
    { d: '2026-05-08', B114039: { v: '2.5000' } }, // latest — rate changed
    { d: '2026-03-12', B114039: { v: '2.7500' } }, // prior
    { d: '2026-01-29', B114039: { v: '3.0000' } },
  ],
};

// 5-year GoC bond yield (BD.CDN.5YR.DQ.YLD)
const YIELD_FIXTURE = {
  observations: [{ d: '2026-05-14', 'BD.CDN.5YR.DQ.YLD': { v: '3.2500' } }],
};

function okJson(payload) {
  return { ok: true, status: 200, json: () => Promise.resolve(payload) };
}
function errorResponse(status) {
  return { ok: false, status, json: () => Promise.resolve({}) };
}

// Two fetch calls per successful run: overnight series → yield
function mockAllSuccess() {
  globalThis.fetch
    .mockResolvedValueOnce(okJson(OVERNIGHT_FIXTURE))
    .mockResolvedValueOnce(okJson(YIELD_FIXTURE));
}

// ── Hermetic setup ────────────────────────────────────────────────────────────

let baseDir;
let originalFetch;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulldata-'));
  originalFetch = globalThis.fetch;
  globalThis.fetch = jest.fn();
});

afterEach(async () => {
  if (originalFetch === undefined) {
    delete globalThis.fetch;
  } else {
    globalThis.fetch = originalFetch;
  }
  await fs.rm(baseDir, { recursive: true, force: true });
  jest.clearAllMocks();
});

const NOW = '2026-05-15T12:00:00.000Z'; // in week 2026-W20

// ── parseOvernightRate (pure parser) ─────────────────────────────────────────

describe('parseOvernightRate', () => {
  test('extracts most recent value from observations', () => {
    const point = parseOvernightRate(OVERNIGHT_FIXTURE.observations);
    expect(point.metric).toBe('boc_overnight_rate');
    expect(point.value).toBe(2.5);
    expect(point.unit).toBe('percent');
  });

  test('asOf is the date of the most recent observation', () => {
    const point = parseOvernightRate(OVERNIGHT_FIXTURE.observations);
    expect(point.asOf).toBe('2026-05-08T00:00:00.000Z');
  });

  test('throws when value is non-finite', () => {
    const badObs = [{ d: '2026-05-08', B114039: { v: 'N/A' } }];
    expect(() => parseOvernightRate(badObs)).toThrow(/non-finite/i);
  });
});

// ── parseLatestDecisionDate (pure parser) ─────────────────────────────────────

describe('parseLatestDecisionDate', () => {
  test('returns date of the most recent rate change in multi-observation response', () => {
    // obs[0]=2.50 vs obs[1]=2.75 → changed at obs[0].d = 2026-05-08
    const point = parseLatestDecisionDate(OVERNIGHT_FIXTURE.observations);
    expect(point.metric).toBe('boc_last_decision_date');
    expect(point.asOf).toBe('2026-05-08T00:00:00.000Z');
    expect(point.unit).toBe('unix_seconds');
    expect(point.value).toBe(Math.floor(new Date('2026-05-08T00:00:00.000Z').getTime() / 1000));
  });

  test('change is found at a non-first observation', () => {
    // First two are equal; change is at obs[1] vs obs[2]
    const obs = [
      { d: '2026-05-08', B114039: { v: '2.5000' } }, // same as next
      { d: '2026-03-12', B114039: { v: '2.5000' } }, // same
      { d: '2026-01-29', B114039: { v: '2.7500' } }, // changed here
    ];
    const point = parseLatestDecisionDate(obs);
    // Most recent change was obs[1].d (2026-03-12) because obs[0] == obs[1] but obs[1] != obs[2]
    // Wait: iterating i=0: curr=2.5, prev=2.5 → no change
    //        i=1: curr=2.5, prev=2.75 → change! → decisionDateStr = obs[1].d = 2026-03-12
    expect(point.asOf).toBe('2026-03-12T00:00:00.000Z');
  });

  test('falls back to most recent observation date when no rate change found in window', () => {
    const heldObs = [
      { d: '2026-05-08', B114039: { v: '2.5000' } },
      { d: '2026-03-12', B114039: { v: '2.5000' } },
      { d: '2026-01-29', B114039: { v: '2.5000' } },
    ];
    const point = parseLatestDecisionDate(heldObs);
    // No change found; falls back to obs[0].d
    expect(point.asOf).toBe('2026-05-08T00:00:00.000Z');
  });

  test('works with a single observation (no prior to compare)', () => {
    const singleObs = [{ d: '2026-05-08', B114039: { v: '2.5000' } }];
    const point = parseLatestDecisionDate(singleObs);
    expect(point.asOf).toBe('2026-05-08T00:00:00.000Z');
  });
});

// ── pullBankOfCanada — successful pull ────────────────────────────────────────

describe('pullBankOfCanada — successful pull', () => {
  let result;
  let snapshot;

  beforeEach(async () => {
    mockAllSuccess();
    result = await pullBankOfCanada({ baseDir, now: NOW });
    snapshot = await readSnapshot('canada', '2026-W20', { baseDir });
  });

  test('makes exactly two fetch calls (overnight series + yield)', () => {
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  test('writes all three metrics to the current-week snapshot', () => {
    expect(snapshot).toHaveLength(3);
    expect(snapshot.map(p => p.metric).sort()).toEqual([
      'boc_last_decision_date',
      'boc_overnight_rate',
      'goc_5yr_yield',
    ]);
  });

  test('every written metric schema-validates', () => {
    for (const p of snapshot) {
      expect(typeof p.metric).toBe('string');
      expect(Number.isFinite(p.value)).toBe(true);
      expect(typeof p.unit).toBe('string');
      expect(typeof p.asOf).toBe('string');
      expect(p.sourceUrl).toMatch(/^https:\/\/.*bankofcanada\.ca/);
    }
  });

  test('success: true, metricsWritten contains all three names', () => {
    expect(result.success).toBe(true);
    expect(result.metricsWritten.sort()).toEqual([
      'boc_last_decision_date',
      'boc_overnight_rate',
      'goc_5yr_yield',
    ]);
  });

  test('metricsFailed: [] and errors: []', () => {
    expect(result.metricsFailed).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test('pull log gets one entry appended', async () => {
    const raw = await fs.readFile(path.join(baseDir, 'data', 'market', '_pullLog.jsonl'), 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).success).toBe(true);
  });

  test('asOf for each metric reflects the data date, not the pull time', () => {
    const overnight = snapshot.find(p => p.metric === 'boc_overnight_rate');
    const yield5yr  = snapshot.find(p => p.metric === 'goc_5yr_yield');
    const decision  = snapshot.find(p => p.metric === 'boc_last_decision_date');

    expect(overnight.asOf).toBe('2026-05-08T00:00:00.000Z'); // fixture obs date
    expect(yield5yr.asOf).toBe('2026-05-14T00:00:00.000Z');  // fixture obs date
    expect(decision.asOf).toBe('2026-05-08T00:00:00.000Z');  // last rate change date

    expect(overnight.asOf).not.toBe(result.pulledAt);
  });

  test('sourceUrl for each metric starts with https:// and contains bankofcanada.ca', () => {
    for (const p of snapshot) {
      expect(p.sourceUrl).toMatch(/^https:\/\/.*bankofcanada\.ca/);
    }
  });
});

// ── pullBankOfCanada — partial failures ───────────────────────────────────────

describe('pullBankOfCanada — partial failures', () => {
  test('bond yield 500 → overnight metrics written, metricsFailed: [goc_5yr_yield], success: true', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(okJson(OVERNIGHT_FIXTURE)) // overnight: ok
      .mockResolvedValueOnce(errorResponse(500));        // yield: 500

    const result = await pullBankOfCanada({ baseDir, now: NOW });

    expect(result.success).toBe(true);
    expect(result.metricsWritten.sort()).toEqual(['boc_last_decision_date', 'boc_overnight_rate']);
    expect(result.metricsFailed).toEqual(['goc_5yr_yield']);

    const snapshot = await readSnapshot('canada', '2026-W20', { baseDir });
    expect(snapshot).toHaveLength(2);
    expect(snapshot.map(p => p.metric)).not.toContain('goc_5yr_yield');
  });

  test('overnight series malformed JSON → both BoC metrics fail, yield still written', async () => {
    globalThis.fetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('Unexpected token')) })
      .mockResolvedValueOnce(okJson(YIELD_FIXTURE));

    const result = await pullBankOfCanada({ baseDir, now: NOW });

    expect(result.success).toBe(true);
    expect(result.metricsWritten).toEqual(['goc_5yr_yield']);
    expect(result.metricsFailed.sort()).toEqual(['boc_last_decision_date', 'boc_overnight_rate']);
    expect(result.errors).toHaveLength(2);

    const snapshot = await readSnapshot('canada', '2026-W20', { baseDir });
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].metric).toBe('goc_5yr_yield');
  });

  test('overnight series times out (AbortError) → both BoC metrics fail, yield written', async () => {
    const abortErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    globalThis.fetch
      .mockRejectedValueOnce(abortErr)
      .mockResolvedValueOnce(okJson(YIELD_FIXTURE));

    const result = await pullBankOfCanada({ baseDir, now: NOW });

    expect(result.success).toBe(true);
    expect(result.metricsWritten).toEqual(['goc_5yr_yield']);
    expect(result.metricsFailed.sort()).toEqual(['boc_last_decision_date', 'boc_overnight_rate']);
  });
});

// ── pullBankOfCanada — total failure ──────────────────────────────────────────

describe('pullBankOfCanada — total failure', () => {
  test('both fetches return 5xx → success: false, no snapshot written', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(errorResponse(503));

    const result = await pullBankOfCanada({ baseDir, now: NOW });

    expect(result.success).toBe(false);
    expect(result.metricsWritten).toEqual([]);
    expect(result.metricsFailed).toHaveLength(3);
    expect(result.errors).toHaveLength(3);

    const snapshot = await readSnapshot('canada', '2026-W20', { baseDir });
    expect(snapshot).toEqual([]);
  });

  test('pull log records failure with errors array populated', async () => {
    globalThis.fetch.mockResolvedValue(errorResponse(503));

    await pullBankOfCanada({ baseDir, now: NOW });

    const raw = await fs.readFile(path.join(baseDir, 'data', 'market', '_pullLog.jsonl'), 'utf8');
    const entry = JSON.parse(raw.trim());
    expect(entry.success).toBe(false);
    expect(entry.errors).toHaveLength(3);
  });

  test('total failure does NOT erase a pre-existing snapshot', async () => {
    const period = currentWeek(NOW);
    const existingPoint = {
      metric: 'boc_overnight_rate', value: 3.0, unit: 'percent',
      asOf: '2026-05-01T00:00:00.000Z', source: 'Bank of Canada',
      sourceUrl: 'https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rates/',
      refreshCadence: 'event_driven', staleThresholdDays: 90, confidence: 'high',
    };
    await writeSnapshot('canada', period, [existingPoint], { baseDir });

    globalThis.fetch.mockResolvedValue(errorResponse(503));
    await pullBankOfCanada({ baseDir, now: NOW });

    const snapshot = await readSnapshot('canada', period, { baseDir });
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].value).toBe(3.0);
  });
});

// ── pullBankOfCanada — merge with existing snapshot ───────────────────────────

describe('pullBankOfCanada — merges with existing snapshot', () => {
  test('pre-existing non-BoC metric preserved alongside new BoC metrics', async () => {
    const period = currentWeek(NOW);
    const trrebPoint = {
      metric: 'trreb_avg_price', value: 1150000, unit: 'CAD',
      asOf: '2026-05-01T00:00:00.000Z', source: 'TRREB',
      sourceUrl: 'https://trreb.ca/stats',
      refreshCadence: 'monthly', staleThresholdDays: 35, confidence: 'medium',
    };
    await writeSnapshot('canada', period, [trrebPoint], { baseDir });

    mockAllSuccess();
    await pullBankOfCanada({ baseDir, now: NOW });

    const snapshot = await readSnapshot('canada', period, { baseDir });
    expect(snapshot).toHaveLength(4);
    const metrics = snapshot.map(p => p.metric);
    expect(metrics).toContain('trreb_avg_price');
    expect(metrics).toContain('boc_overnight_rate');

    const preserved = snapshot.find(p => p.metric === 'trreb_avg_price');
    expect(preserved.value).toBe(1150000);
    expect(preserved.source).toBe('TRREB');
  });
});

// ── pullBankOfCanada — opts.now period determination ─────────────────────────

describe('pullBankOfCanada — opts.now for period determination', () => {
  test("opts.now '2026-05-15T12:00:00Z' → snapshot written to canada/2026-W20.json", async () => {
    mockAllSuccess();
    await pullBankOfCanada({ baseDir, now: '2026-05-15T12:00:00Z' });
    const snapshot = await readSnapshot('canada', '2026-W20', { baseDir });
    expect(snapshot.length).toBeGreaterThan(0);
  });

  test("opts.now '2026-12-30T12:00:00Z' → snapshot written to canada/2026-W53.json", async () => {
    mockAllSuccess();
    await pullBankOfCanada({ baseDir, now: '2026-12-30T12:00:00Z' });
    const snapshot = await readSnapshot('canada', '2026-W53', { baseDir });
    expect(snapshot.length).toBeGreaterThan(0);
  });
});
