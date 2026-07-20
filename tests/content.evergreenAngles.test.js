'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { TOPIC_BANK, selectWeeklyTopics } = require('../src/content/topicBank');

const {
  generateEvergreenAngles,
  readEvergreenAngles,
  EvergreenAngleGenerationError,
  EVERGREEN_ANGLE_ID_RE,
  _internal,
} = require('../src/content/evergreenAngles');

const { validateEvergreenAngle } = _internal;

// ── Fixture helpers ───────────────────────────────────────────────────────────

const WEEK_ISO = '2026-W20';
const NOW = new Date('2026-05-17T12:00:00Z');

// Ground the mock response in the ACTUAL slots selectWeeklyTopics returns for
// this weekIso, rather than assumed seedIds. Measured once, printed below.
const SELECTED_SLOTS = selectWeeklyTopics(WEEK_ISO, 3, { entries: TOPIC_BANK });
const SELECTED_SEED_IDS = SELECTED_SLOTS.map(s => s.seedId);

// eslint-disable-next-line no-console
console.log('[measure-before-assert] selectWeeklyTopics seedIds for 2026-W20:', SELECTED_SEED_IDS);

function headlineThesisFor(seedId) {
  return {
    headline: `Hook for ${seedId}`,
    thesis:   `Thesis restating the take for ${seedId} in the agent's voice.`,
  };
}

function validEvergreenResponse(seedIds = SELECTED_SEED_IDS) {
  const angles = {};
  for (const seedId of seedIds) {
    angles[seedId] = headlineThesisFor(seedId);
  }
  return JSON.stringify({ angles });
}

function makeCallRaw(responses) {
  let i = 0;
  return jest.fn(async () => {
    if (i >= responses.length) return responses[responses.length - 1];
    return responses[i++];
  });
}

describe('generateEvergreenAngles', () => {
  let tmpDir;

  beforeEach(() => {
    // Bare tmpdir, no fixture snapshot seeding: evergreen has no data gate.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evergreen-angles-gen-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('measure: selected slots for 2026-W20 match the real bank output', () => {
    // Documents the grounding fixture so future readers see what was measured.
    expect(SELECTED_SEED_IDS).toEqual(['last-minute-walkthrough', 'fomo-escalation', 'declutter-first']);
  });

  test('happy path: returns angles, writes file, regenerated true', async () => {
    const callRaw = makeCallRaw([validEvergreenResponse()]);
    const result = await generateEvergreenAngles({ weekIso: WEEK_ISO, now: NOW, baseDir: tmpDir, callRaw });

    // eslint-disable-next-line no-console
    console.log('[measure-before-assert] happy path angles:', result.angles.map(a => ({
      id: a.id,
      origin: a.origin,
      surpriseScore: a.surpriseScore,
      themeTag: a.themeTag,
      audienceFocus: a.audienceFocus,
      sourceFooter: a.sourceFooter,
      dataPoints: a.dataPoints,
      forbidsRateAdvice: a.forbidsRateAdvice,
    })));

    expect(result.regenerated).toBe(true);
    expect(result.weekIso).toBe(WEEK_ISO);
    expect(result.angles.length).toBe(3);
    expect(typeof result.bankVersion).toBe('string');

    const onDiskPath = path.join(tmpDir, '_evergreen', '_angles', `${WEEK_ISO}.json`);
    const onDisk = JSON.parse(fs.readFileSync(onDiskPath, 'utf8'));
    expect(onDisk.angles.length).toBe(3);
    expect(typeof onDisk.bankVersion).toBe('string');
    expect(onDisk.modelUsed).toBe('claude-sonnet-4-6');
  });

  test('evergreen contract: every returned angle matches the sourceless, rate-free shape', async () => {
    const callRaw = makeCallRaw([validEvergreenResponse()]);
    const result = await generateEvergreenAngles({ weekIso: WEEK_ISO, now: NOW, baseDir: tmpDir, callRaw });

    const bySeedIndex = SELECTED_SLOTS;
    expect(result.angles.length).toBe(bySeedIndex.length);

    result.angles.forEach((angle, i) => {
      const slot = bySeedIndex[i];
      expect(angle.origin).toBe('evergreen');
      expect(angle.sourceFooter).toBeNull();
      expect(angle.dataPoints).toEqual([]);
      expect(angle.forbidsRateAdvice).toBe(false);
      expect(angle.id).toMatch(EVERGREEN_ANGLE_ID_RE);
      expect(angle.surpriseScore).toBe(slot.seed.baseInterest);
      expect(angle.themeTag).toBe(slot.entry.themeTag);
      expect(angle.audienceFocus).toBe(slot.seed.audienceFocus);
      expect(angle.bestSuitedFor).toEqual(slot.seed.bestSuitedFor);
      expect(angle.longFormSuitable).toBe(slot.seed.longFormSuitable);
    });
  });

  test('id contiguity: a dropped slot does not leave a gap in the NNN sequence', async () => {
    const seedIds = SELECTED_SEED_IDS;
    const angles = {};
    // Drop the middle seed's pair entirely.
    angles[seedIds[0]] = headlineThesisFor(seedIds[0]);
    angles[seedIds[2]] = headlineThesisFor(seedIds[2]);
    const response = JSON.stringify({ angles });

    const callRaw = makeCallRaw([response]);
    const result = await generateEvergreenAngles({ weekIso: WEEK_ISO, now: NOW, baseDir: tmpDir, callRaw });

    expect(result.angles.length).toBe(2);
    const ids = result.angles.map(a => a.id).sort();
    expect(ids).toEqual([
      `angle-evg-${WEEK_ISO}-001`,
      `angle-evg-${WEEK_ISO}-002`,
    ]);
  });

  test('idempotency: second call with same bank version returns cached, regenerated false, callRaw not called again', async () => {
    const callRaw = makeCallRaw([validEvergreenResponse()]);
    const first = await generateEvergreenAngles({ weekIso: WEEK_ISO, now: NOW, baseDir: tmpDir, callRaw });
    expect(first.regenerated).toBe(true);
    expect(callRaw).toHaveBeenCalledTimes(1);

    const second = await generateEvergreenAngles({ weekIso: WEEK_ISO, now: NOW, baseDir: tmpDir, callRaw });
    expect(second.regenerated).toBe(false);
    expect(callRaw).toHaveBeenCalledTimes(1);
    expect(second.angles.length).toBe(first.angles.length);
  });

  test('opts.force true bypasses idempotency, callRaw invoked again', async () => {
    const callRaw = makeCallRaw([validEvergreenResponse(), validEvergreenResponse()]);
    await generateEvergreenAngles({ weekIso: WEEK_ISO, now: NOW, baseDir: tmpDir, callRaw });
    expect(callRaw).toHaveBeenCalledTimes(1);

    await generateEvergreenAngles({ weekIso: WEEK_ISO, now: NOW, baseDir: tmpDir, callRaw, force: true });
    expect(callRaw).toHaveBeenCalledTimes(2);
  });

  test('Claude returns malformed JSON then valid: succeeds, callRaw called twice', async () => {
    const callRaw = makeCallRaw(['not json{{{', validEvergreenResponse()]);
    const result = await generateEvergreenAngles({ weekIso: WEEK_ISO, now: NOW, baseDir: tmpDir, callRaw });
    expect(result.regenerated).toBe(true);
    expect(callRaw).toHaveBeenCalledTimes(2);
  });

  test('Claude returns malformed JSON twice: throws EvergreenAngleGenerationError', async () => {
    const callRaw = makeCallRaw(['not json{{{', 'still not json{{{']);
    await expect(
      generateEvergreenAngles({ weekIso: WEEK_ISO, now: NOW, baseDir: tmpDir, callRaw })
    ).rejects.toThrow(EvergreenAngleGenerationError);
  });

  // DELIBERATE DIVERGENCE from market's >= 2 floor: a single evergreen angle
  // is still a usable swap-menu entry for the slot-based mix (commit 7).
  test('one valid angle (>= 1 floor divergence): succeeds and writes with a single angle', async () => {
    const seedIds = SELECTED_SEED_IDS;
    const angles = {};
    angles[seedIds[0]] = headlineThesisFor(seedIds[0]);
    const response = JSON.stringify({ angles });

    const callRaw = makeCallRaw([response]);
    const result = await generateEvergreenAngles({ weekIso: WEEK_ISO, now: NOW, baseDir: tmpDir, callRaw });

    expect(result.regenerated).toBe(true);
    expect(result.angles.length).toBe(1);
    expect(result.angles[0].id).toBe(`angle-evg-${WEEK_ISO}-001`);
  });

  test('zero valid angles twice: throws EvergreenAngleGenerationError', async () => {
    const emptyResponse = JSON.stringify({ angles: {} });
    const callRaw = makeCallRaw([emptyResponse, emptyResponse]);
    await expect(
      generateEvergreenAngles({ weekIso: WEEK_ISO, now: NOW, baseDir: tmpDir, callRaw })
    ).rejects.toThrow(EvergreenAngleGenerationError);
  });

  test('file persisted atomically: .tmp file does not remain after write', async () => {
    const callRaw = makeCallRaw([validEvergreenResponse()]);
    await generateEvergreenAngles({ weekIso: WEEK_ISO, now: NOW, baseDir: tmpDir, callRaw });
    const dir = path.join(tmpDir, '_evergreen', '_angles');
    const entries = fs.readdirSync(dir);
    expect(entries).toEqual([`${WEEK_ISO}.json`]);
  });

  test('malformed opts.weekIso throws before any callRaw', async () => {
    const callRaw = makeCallRaw([validEvergreenResponse()]);
    await expect(
      generateEvergreenAngles({ weekIso: '2026-W00', now: NOW, baseDir: tmpDir, callRaw })
    ).rejects.toThrow();
    expect(callRaw).not.toHaveBeenCalled();
  });
});

// ── readEvergreenAngles ───────────────────────────────────────────────────────

describe('readEvergreenAngles', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evergreen-angles-read-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns null when file does not exist', async () => {
    const result = await readEvergreenAngles(WEEK_ISO, { baseDir: tmpDir });
    expect(result).toBeNull();
  });

  test('returns parsed object when file exists', async () => {
    const dir = path.join(tmpDir, '_evergreen', '_angles');
    fs.mkdirSync(dir, { recursive: true });
    const menu = { weekIso: WEEK_ISO, generatedAt: NOW.toISOString(), bankVersion: 'abc123', angles: [] };
    fs.writeFileSync(path.join(dir, `${WEEK_ISO}.json`), JSON.stringify(menu));

    const result = await readEvergreenAngles(WEEK_ISO, { baseDir: tmpDir });
    expect(result).toEqual(menu);
  });

  test('throws on JSON parse failure (corruption loud)', async () => {
    const dir = path.join(tmpDir, '_evergreen', '_angles');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${WEEK_ISO}.json`), 'not json{{{');

    await expect(readEvergreenAngles(WEEK_ISO, { baseDir: tmpDir })).rejects.toThrow();
  });

  test('throws on malformed weekIso', async () => {
    await expect(readEvergreenAngles('2026-W00', { baseDir: tmpDir })).rejects.toThrow(/malformed weekIso/);
  });
});

// ── validateEvergreenAngle ────────────────────────────────────────────────────

describe('validateEvergreenAngle', () => {
  function validEvergreenAngle(overrides = {}) {
    return {
      origin:            'evergreen',
      id:                `angle-evg-${WEEK_ISO}-001`,
      weekStartIso:      '2026-05-11T00:00:00Z',
      headline:          'A tight hook',
      thesis:            'A thesis restating the take.',
      dataPoints:        [],
      themeTag:          'craft',
      audienceFocus:     'sellers',
      bestSuitedFor:     ['reel'],
      surpriseScore:     0.6,
      longFormSuitable:  false,
      sourceFooter:      null,
      forbidsRateAdvice: false,
      ...overrides,
    };
  }

  test('valid full angle returns { valid: true }', () => {
    const r = validateEvergreenAngle(validEvergreenAngle());
    expect(r.valid).toBe(true);
  });

  test('sourceFooter non-null returns invalid', () => {
    const r = validateEvergreenAngle(validEvergreenAngle({ sourceFooter: 'Bank of Canada' }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/sourceFooter/);
  });

  test('non-empty dataPoints returns invalid', () => {
    const r = validateEvergreenAngle(validEvergreenAngle({ dataPoints: [{ metric: 'x', asOf: 'y' }] }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/dataPoints/);
  });

  test('forbidsRateAdvice true returns invalid', () => {
    const r = validateEvergreenAngle(validEvergreenAngle({ forbidsRateAdvice: true }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/forbidsRateAdvice/);
  });

  test('malformed id returns invalid', () => {
    const r = validateEvergreenAngle(validEvergreenAngle({ id: 'angle-2026-W20-001' }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/id/);
  });

  test('wrong origin returns invalid', () => {
    const r = validateEvergreenAngle(validEvergreenAngle({ origin: 'market' }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/origin/);
  });
});
