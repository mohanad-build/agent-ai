'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const {
  ContentStateNotFoundError,
  ContentStateSchemaValidationError,
  ContentStateCorruptionError,
  readContentState,
  writeContentState,
  updateContentState,
  initBatch,
  recordRegen,
  recordSwap,
  approveVersion,
  recordBatchSent,
  buildAgentHistory,
  buildDefaultContentState,
} = require('../src/content/state');

const { statePath, normalizeState, validateState, writeStateFile } =
  require('../src/content/state')._internal;

// ── Helpers ───────────────────────────────────────────────────────────────────

const AGENT_ID   = 'test-agent';
const WEEK_ISO   = '2026-W21';
const CREATED_AT = '2026-05-18T10:00:00.000Z';
const GEN_AT_1   = '2026-05-18T10:00:00.000Z';
const GEN_AT_2   = '2026-05-18T10:01:00.000Z';
const GEN_AT_3   = '2026-05-18T10:02:00.000Z';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'state-test-'));
}

function caught(fn) {
  try { fn(); } catch (e) { return e; }
}

function makeVersion(overrides = {}) {
  return {
    versionId: `v-${GEN_AT_1}`,
    text: 'some rendered text',
    generatedAt: GEN_AT_1,
    claudeCallId: null,
    ...overrides,
  };
}

function makePiece(overrides = {}) {
  return {
    angleId: 'angle-001',
    themeTag: 'market-update',
    forbidsRateAdvice: false,
    regenCount: 0,
    swapCount: 0,
    versions: [makeVersion()],
    approvedVersionId: null,
    ...overrides,
  };
}

function makeState(overrides = {}) {
  return {
    agentId: AGENT_ID,
    schemaVersion: 1,
    createdAt: CREATED_AT,
    lastContentBatchSent: null,
    batches: {},
    ...overrides,
  };
}

function makePieceInput(id, overrides = {}) {
  return {
    id,
    angleId: 'angle-001',
    themeTag: 'market-update',
    forbidsRateAdvice: false,
    initialVersion: { text: 'initial text', generatedAt: GEN_AT_1, claudeCallId: null },
    ...overrides,
  };
}

// ── 1. Error classes ──────────────────────────────────────────────────────────

describe('Error classes', () => {
  test('ContentStateNotFoundError is instantiable with correct name and agentId', () => {
    const err = new ContentStateNotFoundError('agent-x');
    expect(err).toBeInstanceOf(ContentStateNotFoundError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ContentStateNotFoundError');
    expect(err.agentId).toBe('agent-x');
    expect(err.message).toMatch(/agent-x/);
  });

  test('ContentStateSchemaValidationError is instantiable with correct name and errors', () => {
    const errs = ['field1: bad', 'field2: missing'];
    const err = new ContentStateSchemaValidationError('Validation failed', errs);
    expect(err).toBeInstanceOf(ContentStateSchemaValidationError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ContentStateSchemaValidationError');
    expect(err.errors).toEqual(errs);
    expect(err.message).toBe('Validation failed');
  });

  test('ContentStateCorruptionError is instantiable with correct name', () => {
    const err = new ContentStateCorruptionError('bad json', new SyntaxError('oops'));
    expect(err).toBeInstanceOf(ContentStateCorruptionError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ContentStateCorruptionError');
  });

  test('ContentStateCorruptionError attaches cause when provided', () => {
    const cause = new SyntaxError('parse error');
    const err = new ContentStateCorruptionError('corrupt', cause);
    expect(err.cause).toBe(cause);
  });

  test('ContentStateCorruptionError has no cause property when omitted', () => {
    const err = new ContentStateCorruptionError('corrupt');
    expect(err.cause).toBeUndefined();
  });
});

// ── 2. buildDefaultContentState ───────────────────────────────────────────────

describe('buildDefaultContentState', () => {
  test('throws TypeError on missing agentId', () => {
    expect(() => buildDefaultContentState()).toThrow(TypeError);
  });

  test('throws TypeError on empty agentId', () => {
    expect(() => buildDefaultContentState('')).toThrow(TypeError);
  });

  test('returns expected shape with no overrides', () => {
    const state = buildDefaultContentState('agent-abc');
    expect(state.agentId).toBe('agent-abc');
    expect(state.schemaVersion).toBe(1);
    expect(typeof state.createdAt).toBe('string');
    expect(state.lastContentBatchSent).toBeNull();
    expect(state.batches).toEqual({});
  });

  test('opts.now respected for createdAt', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const state = buildDefaultContentState('agent-ts', { now });
    expect(state.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  test('createdAt is a valid ISO 8601 string', () => {
    const state = buildDefaultContentState('agent-iso');
    expect(!Number.isNaN(new Date(state.createdAt).getTime())).toBe(true);
  });
});

// ── 3. validateState (via _internal) ─────────────────────────────────────────

describe('validateState', () => {
  test('clean default state passes without throwing', () => {
    expect(() => validateState(makeState())).not.toThrow();
  });

  test('missing agentId fails', () => {
    const err = caught(() => validateState(makeState({ agentId: '' })));
    expect(err).toBeInstanceOf(ContentStateSchemaValidationError);
    expect(err.errors.join('|')).toMatch(/agentId/);
  });

  test('schemaVersion !== 1 fails', () => {
    const err = caught(() => validateState(makeState({ schemaVersion: 2 })));
    expect(err).toBeInstanceOf(ContentStateSchemaValidationError);
    expect(err.errors.join('|')).toMatch(/schemaVersion/);
  });

  test('createdAt not ISO fails', () => {
    const err = caught(() => validateState(makeState({ createdAt: 'not-a-date' })));
    expect(err).toBeInstanceOf(ContentStateSchemaValidationError);
    expect(err.errors.join('|')).toMatch(/createdAt/);
  });

  test('lastContentBatchSent not null and not ISO fails', () => {
    const err = caught(() => validateState(makeState({ lastContentBatchSent: 'bad' })));
    expect(err).toBeInstanceOf(ContentStateSchemaValidationError);
    expect(err.errors.join('|')).toMatch(/lastContentBatchSent/);
  });

  test('lastContentBatchSent null passes', () => {
    expect(() => validateState(makeState({ lastContentBatchSent: null }))).not.toThrow();
  });

  test('batches not object fails', () => {
    const err = caught(() => validateState(makeState({ batches: 'nope' })));
    expect(err).toBeInstanceOf(ContentStateSchemaValidationError);
    expect(err.errors.join('|')).toMatch(/batches/);
  });

  test('invalid weekIso key fails', () => {
    const err = caught(() => validateState(makeState({
      batches: { 'bad-week': { sentAt: null, pieces: {} } },
    })));
    expect(err).toBeInstanceOf(ContentStateSchemaValidationError);
    expect(err.errors.join('|')).toMatch(/weekIso/);
  });

  test('piece with invalid pieceId fails', () => {
    const err = caught(() => validateState(makeState({
      batches: {
        [WEEK_ISO]: {
          sentAt: null,
          pieces: { 'bad-id': makePiece() },
        },
      },
    })));
    expect(err).toBeInstanceOf(ContentStateSchemaValidationError);
    expect(err.errors.join('|')).toMatch(/pieceId/);
  });

  test('piece missing angleId fails', () => {
    const err = caught(() => validateState(makeState({
      batches: { [WEEK_ISO]: { sentAt: null, pieces: { 'reel-001': makePiece({ angleId: '' }) } } },
    })));
    expect(err).toBeInstanceOf(ContentStateSchemaValidationError);
    expect(err.errors.join('|')).toMatch(/angleId/);
  });

  test('piece missing themeTag fails', () => {
    const err = caught(() => validateState(makeState({
      batches: { [WEEK_ISO]: { sentAt: null, pieces: { 'reel-001': makePiece({ themeTag: '' }) } } },
    })));
    expect(err).toBeInstanceOf(ContentStateSchemaValidationError);
    expect(err.errors.join('|')).toMatch(/themeTag/);
  });

  test('piece missing forbidsRateAdvice fails', () => {
    const err = caught(() => validateState(makeState({
      batches: { [WEEK_ISO]: { sentAt: null, pieces: { 'reel-001': makePiece({ forbidsRateAdvice: 'yes' }) } } },
    })));
    expect(err).toBeInstanceOf(ContentStateSchemaValidationError);
    expect(err.errors.join('|')).toMatch(/forbidsRateAdvice/);
  });

  test('piece with negative regenCount fails', () => {
    const err = caught(() => validateState(makeState({
      batches: { [WEEK_ISO]: { sentAt: null, pieces: { 'reel-001': makePiece({ regenCount: -1 }) } } },
    })));
    expect(err).toBeInstanceOf(ContentStateSchemaValidationError);
    expect(err.errors.join('|')).toMatch(/regenCount/);
  });

  test('piece with negative swapCount fails', () => {
    const err = caught(() => validateState(makeState({
      batches: { [WEEK_ISO]: { sentAt: null, pieces: { 'reel-001': makePiece({ swapCount: -1 }) } } },
    })));
    expect(err).toBeInstanceOf(ContentStateSchemaValidationError);
    expect(err.errors.join('|')).toMatch(/swapCount/);
  });

  test('versions[].versionId not "v-"-prefixed fails', () => {
    const err = caught(() => validateState(makeState({
      batches: {
        [WEEK_ISO]: {
          sentAt: null,
          pieces: { 'reel-001': makePiece({ versions: [makeVersion({ versionId: 'bad-id' })] }) },
        },
      },
    })));
    expect(err).toBeInstanceOf(ContentStateSchemaValidationError);
    expect(err.errors.join('|')).toMatch(/versionId/);
  });

  test('approvedVersionId set to versionId not in versions array fails', () => {
    const err = caught(() => validateState(makeState({
      batches: {
        [WEEK_ISO]: {
          sentAt: null,
          pieces: {
            'reel-001': makePiece({ approvedVersionId: 'v-9999-01-01T00:00:00.000Z' }),
          },
        },
      },
    })));
    expect(err).toBeInstanceOf(ContentStateSchemaValidationError);
    expect(err.errors.join('|')).toMatch(/approvedVersionId/);
  });

  test('approvedVersionId === null passes', () => {
    expect(() => validateState(makeState({
      batches: {
        [WEEK_ISO]: {
          sentAt: null,
          pieces: { 'reel-001': makePiece({ approvedVersionId: null }) },
        },
      },
    }))).not.toThrow();
  });

  test('approvedVersionId matching a real versionId passes', () => {
    const ver = makeVersion();
    expect(() => validateState(makeState({
      batches: {
        [WEEK_ISO]: {
          sentAt: null,
          pieces: {
            'reel-001': makePiece({ versions: [ver], approvedVersionId: ver.versionId }),
          },
        },
      },
    }))).not.toThrow();
  });

  test('multiple validation errors collected together', () => {
    const err = caught(() => validateState(makeState({ agentId: '', schemaVersion: 99 })));
    expect(err).toBeInstanceOf(ContentStateSchemaValidationError);
    expect(err.errors.length).toBeGreaterThan(1);
  });
});

// ── 4. readContentState ───────────────────────────────────────────────────────

describe('readContentState', () => {
  let baseDir;
  beforeEach(() => { baseDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

  test('missing file returns default state AND writes it to disk', () => {
    const state = readContentState(AGENT_ID, { baseDir });
    expect(state.agentId).toBe(AGENT_ID);
    expect(state.schemaVersion).toBe(1);
    expect(state.batches).toEqual({});
    const filePath = statePath(baseDir, AGENT_ID);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('existing valid file is parsed and returned', () => {
    writeContentState(AGENT_ID, makeState(), { baseDir });
    const result = readContentState(AGENT_ID, { baseDir });
    expect(result.agentId).toBe(AGENT_ID);
    expect(result.lastContentBatchSent).toBeNull();
  });

  test('corrupt JSON throws ContentStateCorruptionError', () => {
    const dir = path.join(baseDir, 'agents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${AGENT_ID}.contentState.json`), 'not-json', 'utf8');
    const err = caught(() => readContentState(AGENT_ID, { baseDir }));
    expect(err).toBeInstanceOf(ContentStateCorruptionError);
    expect(err.name).toBe('ContentStateCorruptionError');
  });

  test('JSON that fails validation throws ContentStateSchemaValidationError', () => {
    const dir = path.join(baseDir, 'agents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${AGENT_ID}.contentState.json`),
      JSON.stringify({ agentId: AGENT_ID, schemaVersion: 99, createdAt: CREATED_AT, lastContentBatchSent: null, batches: {} }),
      'utf8'
    );
    const err = caught(() => readContentState(AGENT_ID, { baseDir }));
    expect(err).toBeInstanceOf(ContentStateSchemaValidationError);
  });

  test('opts.baseDir respected: reading from different baseDir returns default', () => {
    const baseDir2 = makeTmpDir();
    try {
      writeContentState(AGENT_ID, makeState(), { baseDir });
      const result = readContentState(AGENT_ID, { baseDir: baseDir2 });
      expect(result.batches).toEqual({});
    } finally {
      fs.rmSync(baseDir2, { recursive: true, force: true });
    }
  });
});

// ── 5. writeContentState ──────────────────────────────────────────────────────

describe('writeContentState', () => {
  let baseDir;
  beforeEach(() => { baseDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

  test('happy path: writes and round-trips correctly', () => {
    const written = writeContentState(AGENT_ID, makeState(), { baseDir });
    expect(written.agentId).toBe(AGENT_ID);
    const read = readContentState(AGENT_ID, { baseDir });
    expect(read).toEqual(written);
  });

  test('invalid state throws ContentStateSchemaValidationError and is not written', () => {
    const err = caught(() => writeContentState(AGENT_ID, makeState({ schemaVersion: 0 }), { baseDir }));
    expect(err).toBeInstanceOf(ContentStateSchemaValidationError);
    expect(fs.existsSync(statePath(baseDir, AGENT_ID))).toBe(false);
  });

  test('atomic write: no .tmp file remains after success', () => {
    writeContentState(AGENT_ID, makeState(), { baseDir });
    const tmp = `${statePath(baseDir, AGENT_ID)}.tmp`;
    expect(fs.existsSync(tmp)).toBe(false);
  });

  test('file is written with 2-space indentation', () => {
    writeContentState(AGENT_ID, makeState(), { baseDir });
    const raw = fs.readFileSync(statePath(baseDir, AGENT_ID), 'utf8');
    expect(raw).toMatch(/^{\n  "/);
  });
});

// ── 6. updateContentState ─────────────────────────────────────────────────────

describe('updateContentState', () => {
  let baseDir;
  beforeEach(() => { baseDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

  test('patches lastContentBatchSent at top level', () => {
    const sentAt = '2026-05-19T07:00:00.000Z';
    const result = updateContentState(AGENT_ID, { lastContentBatchSent: sentAt }, { baseDir });
    expect(result.lastContentBatchSent).toBe(sentAt);
    expect(result.agentId).toBe(AGENT_ID);
  });

  test('returns new state with merged fields', () => {
    writeContentState(AGENT_ID, makeState(), { baseDir });
    const sentAt = '2026-05-20T07:00:00.000Z';
    const result = updateContentState(AGENT_ID, { lastContentBatchSent: sentAt }, { baseDir });
    expect(result.lastContentBatchSent).toBe(sentAt);
    expect(result.schemaVersion).toBe(1);
  });

  test('shallow merge only: patching batches replaces the whole batches object', () => {
    writeContentState(AGENT_ID, makeState(), { baseDir });
    const newBatches = { [WEEK_ISO]: { sentAt: null, pieces: {} } };
    const result = updateContentState(AGENT_ID, { batches: newBatches }, { baseDir });
    expect(result.batches).toEqual(newBatches);
    expect(Object.keys(result.batches)).toHaveLength(1);
  });
});

// ── 7. initBatch ─────────────────────────────────────────────────────────────

describe('initBatch', () => {
  let baseDir;
  beforeEach(() => { baseDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

  test('happy path: creates batch with 3 pieces', () => {
    const pieces = [
      makePieceInput('reel-001', { themeTag: 'buyers-market' }),
      makePieceInput('reel-002', { themeTag: 'interest-rates' }),
      makePieceInput('blog-001', { themeTag: 'first-time-buyers' }),
    ];
    const state = initBatch(AGENT_ID, WEEK_ISO, pieces, { baseDir });
    expect(Object.keys(state.batches[WEEK_ISO].pieces)).toHaveLength(3);
    expect(state.batches[WEEK_ISO].sentAt).toBeNull();
  });

  test('throws if batch already exists for that weekIso', () => {
    initBatch(AGENT_ID, WEEK_ISO, [makePieceInput('reel-001')], { baseDir });
    const err = caught(() => initBatch(AGENT_ID, WEEK_ISO, [makePieceInput('reel-002')], { baseDir }));
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/already exists/);
  });

  test('all pieces get regenCount=0, swapCount=0, approvedVersionId=null', () => {
    const state = initBatch(AGENT_ID, WEEK_ISO, [makePieceInput('reel-001')], { baseDir });
    const piece = state.batches[WEEK_ISO].pieces['reel-001'];
    expect(piece.regenCount).toBe(0);
    expect(piece.swapCount).toBe(0);
    expect(piece.approvedVersionId).toBeNull();
  });

  test('versions[0].versionId is "v-" + initialVersion.generatedAt', () => {
    const genAt = '2026-05-18T10:00:00.000Z';
    const state = initBatch(AGENT_ID, WEEK_ISO, [
      makePieceInput('reel-001', { initialVersion: { text: 'text', generatedAt: genAt, claudeCallId: null } }),
    ], { baseDir });
    const piece = state.batches[WEEK_ISO].pieces['reel-001'];
    expect(piece.versions[0].versionId).toBe(`v-${genAt}`);
  });

  test('pieces with claudeCallId omitted get null', () => {
    const state = initBatch(AGENT_ID, WEEK_ISO, [
      makePieceInput('reel-001', { initialVersion: { text: 'text', generatedAt: GEN_AT_1 } }),
    ], { baseDir });
    const piece = state.batches[WEEK_ISO].pieces['reel-001'];
    expect(piece.versions[0].claudeCallId).toBeNull();
  });

  test('empty pieces array creates batch with pieces: {}', () => {
    const state = initBatch(AGENT_ID, WEEK_ISO, [], { baseDir });
    expect(state.batches[WEEK_ISO]).toBeDefined();
    expect(state.batches[WEEK_ISO].pieces).toEqual({});
  });
});

// ── 8. recordRegen ────────────────────────────────────────────────────────────

describe('recordRegen', () => {
  let baseDir;
  beforeEach(() => {
    baseDir = makeTmpDir();
    initBatch(AGENT_ID, WEEK_ISO, [makePieceInput('reel-001')], { baseDir });
  });
  afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

  test('happy path: appends version and increments regenCount', () => {
    const newVer = { text: 'new text', generatedAt: GEN_AT_2, claudeCallId: null };
    const state = recordRegen(AGENT_ID, WEEK_ISO, 'reel-001', newVer, { baseDir });
    const piece = state.batches[WEEK_ISO].pieces['reel-001'];
    expect(piece.versions).toHaveLength(2);
    expect(piece.regenCount).toBe(1);
  });

  test('throws if batch missing', () => {
    const err = caught(() => recordRegen(AGENT_ID, '2026-W99', 'reel-001', { text: 'x', generatedAt: GEN_AT_2 }, { baseDir }));
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/not found/);
  });

  test('throws if piece missing', () => {
    const err = caught(() => recordRegen(AGENT_ID, WEEK_ISO, 'reel-999', { text: 'x', generatedAt: GEN_AT_2 }, { baseDir }));
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/not found/);
  });

  test('new version has correct versionId format', () => {
    const newVer = { text: 'v2', generatedAt: GEN_AT_2, claudeCallId: null };
    const state = recordRegen(AGENT_ID, WEEK_ISO, 'reel-001', newVer, { baseDir });
    const piece = state.batches[WEEK_ISO].pieces['reel-001'];
    expect(piece.versions[1].versionId).toBe(`v-${GEN_AT_2}`);
  });

  test('regenCount increments by exactly 1', () => {
    recordRegen(AGENT_ID, WEEK_ISO, 'reel-001', { text: 'v2', generatedAt: GEN_AT_2 }, { baseDir });
    const state = recordRegen(AGENT_ID, WEEK_ISO, 'reel-001', { text: 'v3', generatedAt: GEN_AT_3 }, { baseDir });
    expect(state.batches[WEEK_ISO].pieces['reel-001'].regenCount).toBe(2);
  });

  test('approvedVersionId NOT cleared by regen', () => {
    const initialVersionId = `v-${GEN_AT_1}`;
    approveVersion(AGENT_ID, WEEK_ISO, 'reel-001', initialVersionId, { baseDir });
    const state = recordRegen(AGENT_ID, WEEK_ISO, 'reel-001', { text: 'v2', generatedAt: GEN_AT_2 }, { baseDir });
    expect(state.batches[WEEK_ISO].pieces['reel-001'].approvedVersionId).toBe(initialVersionId);
  });
});

// ── 9. recordSwap ─────────────────────────────────────────────────────────────

describe('recordSwap', () => {
  let baseDir;
  beforeEach(() => {
    baseDir = makeTmpDir();
    initBatch(AGENT_ID, WEEK_ISO, [makePieceInput('reel-001'), makePieceInput('reel-002')], { baseDir });
  });
  afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

  test('happy path: updates angleData, resets versions, increments swapCount, clears approvedVersionId', () => {
    const prevId = `v-${GEN_AT_1}`;
    approveVersion(AGENT_ID, WEEK_ISO, 'reel-001', prevId, { baseDir });
    const newAngle = { angleId: 'angle-new', themeTag: 'new-tag', forbidsRateAdvice: true };
    const newVer   = { text: 'swapped text', generatedAt: GEN_AT_2, claudeCallId: null };
    const state = recordSwap(AGENT_ID, WEEK_ISO, 'reel-001', newAngle, newVer, { baseDir });
    const piece = state.batches[WEEK_ISO].pieces['reel-001'];
    expect(piece.angleId).toBe('angle-new');
    expect(piece.themeTag).toBe('new-tag');
    expect(piece.forbidsRateAdvice).toBe(true);
    expect(piece.versions).toHaveLength(1);
    expect(piece.swapCount).toBe(1);
    expect(piece.approvedVersionId).toBeNull();
  });

  test('throws if batch missing', () => {
    const err = caught(() => recordSwap(AGENT_ID, '2026-W99', 'reel-001', {}, { text: 'x', generatedAt: GEN_AT_2 }, { baseDir }));
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/not found/);
  });

  test('throws if piece missing', () => {
    const err = caught(() => recordSwap(AGENT_ID, WEEK_ISO, 'reel-999', {}, { text: 'x', generatedAt: GEN_AT_2 }, { baseDir }));
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/not found/);
  });

  test('regenCount NOT reset after swap', () => {
    recordRegen(AGENT_ID, WEEK_ISO, 'reel-001', { text: 'v2', generatedAt: GEN_AT_2 }, { baseDir });
    const newAngle = { angleId: 'angle-new', themeTag: 'new-tag', forbidsRateAdvice: false };
    const state = recordSwap(AGENT_ID, WEEK_ISO, 'reel-001', newAngle, { text: 'swapped', generatedAt: GEN_AT_3 }, { baseDir });
    expect(state.batches[WEEK_ISO].pieces['reel-001'].regenCount).toBe(1);
  });

  test('prior versions are discarded after swap (versions.length === 1)', () => {
    recordRegen(AGENT_ID, WEEK_ISO, 'reel-001', { text: 'v2', generatedAt: GEN_AT_2 }, { baseDir });
    const newAngle = { angleId: 'angle-new', themeTag: 'new-tag', forbidsRateAdvice: false };
    const state = recordSwap(AGENT_ID, WEEK_ISO, 'reel-001', newAngle, { text: 'swapped', generatedAt: GEN_AT_3 }, { baseDir });
    expect(state.batches[WEEK_ISO].pieces['reel-001'].versions).toHaveLength(1);
  });
});

// ── 10. approveVersion ────────────────────────────────────────────────────────

describe('approveVersion', () => {
  let baseDir;
  beforeEach(() => {
    baseDir = makeTmpDir();
    initBatch(AGENT_ID, WEEK_ISO, [makePieceInput('reel-001')], { baseDir });
  });
  afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

  test('happy path: sets approvedVersionId', () => {
    const vId = `v-${GEN_AT_1}`;
    const state = approveVersion(AGENT_ID, WEEK_ISO, 'reel-001', vId, { baseDir });
    expect(state.batches[WEEK_ISO].pieces['reel-001'].approvedVersionId).toBe(vId);
  });

  test('throws if batch missing', () => {
    const err = caught(() => approveVersion(AGENT_ID, '2026-W99', 'reel-001', `v-${GEN_AT_1}`, { baseDir }));
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/not found/);
  });

  test('throws if piece missing', () => {
    const err = caught(() => approveVersion(AGENT_ID, WEEK_ISO, 'reel-999', `v-${GEN_AT_1}`, { baseDir }));
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/not found/);
  });

  test('throws if versionId not in piece.versions', () => {
    const err = caught(() => approveVersion(AGENT_ID, WEEK_ISO, 'reel-001', 'v-nonexistent', { baseDir }));
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/not found/);
  });

  test('approving the same versionId twice is idempotent', () => {
    const vId = `v-${GEN_AT_1}`;
    approveVersion(AGENT_ID, WEEK_ISO, 'reel-001', vId, { baseDir });
    const state = approveVersion(AGENT_ID, WEEK_ISO, 'reel-001', vId, { baseDir });
    expect(state.batches[WEEK_ISO].pieces['reel-001'].approvedVersionId).toBe(vId);
  });
});

// ── 11. recordBatchSent ───────────────────────────────────────────────────────

describe('recordBatchSent', () => {
  let baseDir;
  const SENT_AT = '2026-05-19T07:00:00.000Z';
  beforeEach(() => {
    baseDir = makeTmpDir();
    initBatch(AGENT_ID, WEEK_ISO, [makePieceInput('reel-001')], { baseDir });
  });
  afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

  test('happy path: sets lastContentBatchSent and batch.sentAt', () => {
    const state = recordBatchSent(AGENT_ID, WEEK_ISO, SENT_AT, { baseDir });
    expect(state.lastContentBatchSent).toBe(SENT_AT);
    expect(state.batches[WEEK_ISO].sentAt).toBe(SENT_AT);
  });

  test('throws if batch missing', () => {
    const err = caught(() => recordBatchSent(AGENT_ID, '2026-W99', SENT_AT, { baseDir }));
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/not found/);
  });

  test('both timestamps are exactly the input sentAt', () => {
    const state = recordBatchSent(AGENT_ID, WEEK_ISO, SENT_AT, { baseDir });
    expect(state.lastContentBatchSent).toBe(SENT_AT);
    expect(state.batches[WEEK_ISO].sentAt).toBe(SENT_AT);
  });
});

// ── 12. buildAgentHistory ─────────────────────────────────────────────────────

describe('buildAgentHistory', () => {
  let baseDir;
  beforeEach(() => { baseDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

  test('empty state returns { recentThemeTags: [], rejectedRateContent: false }', () => {
    const result = buildAgentHistory(AGENT_ID, { baseDir });
    expect(result).toEqual({ recentThemeTags: [], rejectedRateContent: false });
  });

  test('state with 1 batch, all pieces unapproved: recentThemeTags is []', () => {
    initBatch(AGENT_ID, WEEK_ISO, [makePieceInput('reel-001', { themeTag: 'market' })], { baseDir });
    const result = buildAgentHistory(AGENT_ID, { baseDir });
    expect(result.recentThemeTags).toEqual([]);
  });

  test('state with 1 batch, 2 pieces approved: returns both themeTags deduplicated', () => {
    initBatch(AGENT_ID, WEEK_ISO, [
      makePieceInput('reel-001', { themeTag: 'market' }),
      makePieceInput('blog-001', { themeTag: 'market' }),
    ], { baseDir });
    approveVersion(AGENT_ID, WEEK_ISO, 'reel-001', `v-${GEN_AT_1}`, { baseDir });
    approveVersion(AGENT_ID, WEEK_ISO, 'blog-001', `v-${GEN_AT_1}`, { baseDir });
    const result = buildAgentHistory(AGENT_ID, { baseDir });
    expect(result.recentThemeTags).toEqual(['market']);
  });

  test('state with 3 batches: only the most recent 2 considered', () => {
    const W20 = '2026-W20';
    const W21 = '2026-W21';
    const W22 = '2026-W22';
    initBatch(AGENT_ID, W20, [makePieceInput('reel-001', { themeTag: 'old-tag' })], { baseDir });
    approveVersion(AGENT_ID, W20, 'reel-001', `v-${GEN_AT_1}`, { baseDir });
    initBatch(AGENT_ID, W21, [makePieceInput('reel-001', { themeTag: 'mid-tag' })], { baseDir });
    approveVersion(AGENT_ID, W21, 'reel-001', `v-${GEN_AT_1}`, { baseDir });
    initBatch(AGENT_ID, W22, [makePieceInput('reel-001', { themeTag: 'new-tag' })], { baseDir });
    approveVersion(AGENT_ID, W22, 'reel-001', `v-${GEN_AT_1}`, { baseDir });
    const result = buildAgentHistory(AGENT_ID, { baseDir });
    expect(result.recentThemeTags).toContain('new-tag');
    expect(result.recentThemeTags).toContain('mid-tag');
    expect(result.recentThemeTags).not.toContain('old-tag');
  });

  test('rejectedRateContent: true when forbidsRateAdvice && regenCount > 0', () => {
    initBatch(AGENT_ID, WEEK_ISO, [
      makePieceInput('reel-001', { forbidsRateAdvice: true }),
    ], { baseDir });
    recordRegen(AGENT_ID, WEEK_ISO, 'reel-001', { text: 'v2', generatedAt: GEN_AT_2 }, { baseDir });
    const result = buildAgentHistory(AGENT_ID, { baseDir });
    expect(result.rejectedRateContent).toBe(true);
  });

  test('rejectedRateContent: false when forbidsRateAdvice && regenCount === 0', () => {
    initBatch(AGENT_ID, WEEK_ISO, [
      makePieceInput('reel-001', { forbidsRateAdvice: true }),
    ], { baseDir });
    const result = buildAgentHistory(AGENT_ID, { baseDir });
    expect(result.rejectedRateContent).toBe(false);
  });

  test('rejectedRateContent: false when !forbidsRateAdvice && regenCount > 0', () => {
    initBatch(AGENT_ID, WEEK_ISO, [
      makePieceInput('reel-001', { forbidsRateAdvice: false }),
    ], { baseDir });
    recordRegen(AGENT_ID, WEEK_ISO, 'reel-001', { text: 'v2', generatedAt: GEN_AT_2 }, { baseDir });
    const result = buildAgentHistory(AGENT_ID, { baseDir });
    expect(result.rejectedRateContent).toBe(false);
  });

  test('batches sorted by weekIso descending across years', () => {
    const W51_2025 = '2025-W51';
    const W52_2025 = '2025-W52';
    const W01_2026 = '2026-W01';
    initBatch(AGENT_ID, W51_2025, [makePieceInput('reel-001', { themeTag: 'oldest' })], { baseDir });
    approveVersion(AGENT_ID, W51_2025, 'reel-001', `v-${GEN_AT_1}`, { baseDir });
    initBatch(AGENT_ID, W52_2025, [makePieceInput('reel-001', { themeTag: 'middle' })], { baseDir });
    approveVersion(AGENT_ID, W52_2025, 'reel-001', `v-${GEN_AT_1}`, { baseDir });
    initBatch(AGENT_ID, W01_2026, [makePieceInput('reel-001', { themeTag: 'newest' })], { baseDir });
    approveVersion(AGENT_ID, W01_2026, 'reel-001', `v-${GEN_AT_1}`, { baseDir });
    const result = buildAgentHistory(AGENT_ID, { baseDir });
    expect(result.recentThemeTags).toContain('newest');
    expect(result.recentThemeTags).toContain('middle');
    expect(result.recentThemeTags).not.toContain('oldest');
  });

  test('approvedVersionId match: themeTag included only if version approved', () => {
    initBatch(AGENT_ID, WEEK_ISO, [
      makePieceInput('reel-001', { themeTag: 'approved-tag' }),
      makePieceInput('blog-001', { themeTag: 'unapproved-tag' }),
    ], { baseDir });
    approveVersion(AGENT_ID, WEEK_ISO, 'reel-001', `v-${GEN_AT_1}`, { baseDir });
    const result = buildAgentHistory(AGENT_ID, { baseDir });
    expect(result.recentThemeTags).toContain('approved-tag');
    expect(result.recentThemeTags).not.toContain('unapproved-tag');
  });
});

// ── 13. Integration: full lifecycle ───────────────────────────────────────────

describe('Integration: full lifecycle', () => {
  let baseDir;
  beforeEach(() => { baseDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

  test('full lifecycle from first read to buildAgentHistory', () => {
    const opts = { baseDir };

    // Step 1: readContentState (missing) returns default and writes it
    const initial = readContentState(AGENT_ID, opts);
    expect(initial.agentId).toBe(AGENT_ID);
    expect(initial.batches).toEqual({});
    expect(fs.existsSync(statePath(baseDir, AGENT_ID))).toBe(true);

    // Step 2: initBatch W21, 3 pieces
    const GEN_REEL001 = '2026-05-18T10:00:00.000Z';
    const GEN_REEL002 = '2026-05-18T10:00:01.000Z';
    const GEN_BLOG001 = '2026-05-18T10:00:02.000Z';
    initBatch(AGENT_ID, WEEK_ISO, [
      { id: 'reel-001', angleId: 'angle-a', themeTag: 'buyers-market', forbidsRateAdvice: false, initialVersion: { text: 'reel v1', generatedAt: GEN_REEL001, claudeCallId: null } },
      { id: 'reel-002', angleId: 'angle-b', themeTag: 'interest-rates', forbidsRateAdvice: true,  initialVersion: { text: 'reel2 v1', generatedAt: GEN_REEL002, claudeCallId: null } },
      { id: 'blog-001', angleId: 'angle-c', themeTag: 'first-time-buyers', forbidsRateAdvice: false, initialVersion: { text: 'blog v1', generatedAt: GEN_BLOG001, claudeCallId: null } },
    ], opts);

    // Step 3: recordRegen on reel-001 twice
    const GEN_REEL001_V2 = '2026-05-18T10:01:00.000Z';
    const GEN_REEL001_V3 = '2026-05-18T10:02:00.000Z';
    recordRegen(AGENT_ID, WEEK_ISO, 'reel-001', { text: 'reel v2', generatedAt: GEN_REEL001_V2, claudeCallId: null }, opts);
    const afterRegen2 = recordRegen(AGENT_ID, WEEK_ISO, 'reel-001', { text: 'reel v3', generatedAt: GEN_REEL001_V3, claudeCallId: null }, opts);
    const reel001 = afterRegen2.batches[WEEK_ISO].pieces['reel-001'];
    expect(reel001.regenCount).toBe(2);
    expect(reel001.versions).toHaveLength(3);

    // Step 4: recordSwap on reel-002
    const GEN_REEL002_V2 = '2026-05-18T10:03:00.000Z';
    const afterSwap = recordSwap(
      AGENT_ID, WEEK_ISO, 'reel-002',
      { angleId: 'angle-new', themeTag: 'sellers-market', forbidsRateAdvice: false },
      { text: 'reel2 swapped', generatedAt: GEN_REEL002_V2, claudeCallId: null },
      opts
    );
    const reel002 = afterSwap.batches[WEEK_ISO].pieces['reel-002'];
    expect(reel002.swapCount).toBe(1);
    expect(reel002.versions).toHaveLength(1);
    expect(reel002.angleId).toBe('angle-new');

    // Step 5: approveVersion on reel-001 (latest versionId)
    const latestVId = `v-${GEN_REEL001_V3}`;
    const afterApprove = approveVersion(AGENT_ID, WEEK_ISO, 'reel-001', latestVId, opts);
    expect(afterApprove.batches[WEEK_ISO].pieces['reel-001'].approvedVersionId).toBe(latestVId);

    // Step 6: recordBatchSent
    const SENT_AT = '2026-05-19T07:00:00.000Z';
    const afterSent = recordBatchSent(AGENT_ID, WEEK_ISO, SENT_AT, opts);
    expect(afterSent.lastContentBatchSent).toBe(SENT_AT);
    expect(afterSent.batches[WEEK_ISO].sentAt).toBe(SENT_AT);

    // Step 7: buildAgentHistory includes reel-001's themeTag (approved)
    const history = buildAgentHistory(AGENT_ID, opts);
    expect(history.recentThemeTags).toContain('buyers-market');
    expect(history.recentThemeTags).not.toContain('interest-rates');

    // Step 8: readContentState round trip
    const final = readContentState(AGENT_ID, opts);
    expect(final.lastContentBatchSent).toBe(SENT_AT);
    expect(Object.keys(final.batches[WEEK_ISO].pieces)).toHaveLength(3);
    expect(final.batches[WEEK_ISO].pieces['reel-001'].regenCount).toBe(2);
  });
});
