'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

// getStorageRoot() reads process.env.STORAGE_ROOT at call time, so setting it
// in beforeEach is sufficient without resetting the module cache.
const { loadOperator, discoverOperatorIds, validateAgentOperatorMappings } = require('../src/operatorConfig');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'operatorConfig-'));
  fs.mkdirSync(path.join(tmpDir, '_operators'));
  process.env.STORAGE_ROOT = tmpDir;
});

afterEach(() => {
  delete process.env.STORAGE_ROOT;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── loadOperator ──────────────────────────────────────────────────────────────

describe('loadOperator', () => {
  test('reads operator config from STORAGE_ROOT/_operators/<id>.json', () => {
    const cfg = { operatorId: 'test-op', operatorEmail: 'op@example.com' };
    fs.writeFileSync(
      path.join(tmpDir, '_operators', 'test-op.json'),
      JSON.stringify(cfg),
    );
    expect(loadOperator('test-op')).toEqual(cfg);
  });

  test('throws with clear error containing expected path when file is missing', () => {
    const expectedPath = path.join(tmpDir, '_operators', 'missing.json');
    expect(() => loadOperator('missing')).toThrow(expectedPath);
  });
});

// ── discoverOperatorIds ───────────────────────────────────────────────────────

describe('discoverOperatorIds', () => {
  test('returns sorted IDs of all *.json config files in STORAGE_ROOT/_operators/', () => {
    const dir = path.join(tmpDir, '_operators');
    fs.writeFileSync(path.join(dir, 'zeta.json'), '{}');
    fs.writeFileSync(path.join(dir, 'alpha.json'), '{}');
    fs.writeFileSync(path.join(dir, 'beta.json'), '{}');
    expect(discoverOperatorIds()).toEqual(['alpha', 'beta', 'zeta']);
  });

  test('excludes *.state.json files', () => {
    const dir = path.join(tmpDir, '_operators');
    fs.writeFileSync(path.join(dir, 'real-op.json'), '{}');
    fs.writeFileSync(path.join(dir, 'real-op.state.json'), '{}');
    expect(discoverOperatorIds()).toEqual(['real-op']);
  });

  test('returns [] when the _operators directory does not exist', () => {
    // Replace tmpDir with a fresh dir that has no _operators subdir
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'operatorConfig-empty-'));
    process.env.STORAGE_ROOT = emptyRoot;
    try {
      expect(discoverOperatorIds()).toEqual([]);
    } finally {
      process.env.STORAGE_ROOT = tmpDir;
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});

// ── validateAgentOperatorMappings ─────────────────────────────────────────────

describe('validateAgentOperatorMappings', () => {
  let aDir;
  let oDir;

  beforeEach(() => {
    aDir = path.join(tmpDir, 'agents');
    oDir = path.join(tmpDir, '_operators');
    fs.mkdirSync(aDir);
    // oDir already created by outer beforeEach
  });

  test('returns ok:true when all agents map cleanly', () => {
    fs.writeFileSync(
      path.join(aDir, 'agent-1.json'),
      JSON.stringify({ agentId: 'agent-1', operatorId: 'op-1' }),
    );
    fs.writeFileSync(path.join(oDir, 'op-1.json'), JSON.stringify({ operatorId: 'op-1' }));

    expect(validateAgentOperatorMappings(aDir, oDir)).toEqual({
      ok: true,
      orphans: [],
      missingOperators: [],
    });
  });

  test('returns orphans for agents whose operatorId has no matching operator file', () => {
    fs.writeFileSync(
      path.join(aDir, 'agent-1.json'),
      JSON.stringify({ agentId: 'agent-1', operatorId: 'ghost-op' }),
    );
    // no ghost-op.json in oDir

    const result = validateAgentOperatorMappings(aDir, oDir);
    expect(result.ok).toBe(false);
    expect(result.orphans).toEqual([{ agentId: 'agent-1', operatorId: 'ghost-op' }]);
    expect(result.missingOperators).toEqual(['ghost-op']);
  });

  test('deduplicates missingOperators when multiple agents share the same missing operatorId', () => {
    fs.writeFileSync(
      path.join(aDir, 'agent-a.json'),
      JSON.stringify({ agentId: 'agent-a', operatorId: 'shared-op' }),
    );
    fs.writeFileSync(
      path.join(aDir, 'agent-b.json'),
      JSON.stringify({ agentId: 'agent-b', operatorId: 'shared-op' }),
    );

    const result = validateAgentOperatorMappings(aDir, oDir);
    expect(result.ok).toBe(false);
    expect(result.missingOperators).toEqual(['shared-op']);
    expect(result.orphans).toHaveLength(2);
  });

  test('skips agents without an operatorId field (guarded elsewhere)', () => {
    fs.writeFileSync(
      path.join(aDir, 'no-op-agent.json'),
      JSON.stringify({ agentId: 'no-op-agent' }),
    );

    expect(validateAgentOperatorMappings(aDir, oDir)).toEqual({
      ok: true,
      orphans: [],
      missingOperators: [],
    });
  });

  test('returns ok:true when agentsDir does not exist', () => {
    const missingDir = path.join(tmpDir, 'no-such-dir');
    expect(validateAgentOperatorMappings(missingDir, oDir)).toEqual({
      ok: true,
      orphans: [],
      missingOperators: [],
    });
  });

  // Default-path smoke test. All behavioural tests above pass explicit dirs to
  // stay hermetic. This test calls with zero arguments and asserts that the
  // default agentsDir is getStorageRoot() (Pattern B), which during the test
  // is the tmpDir set by beforeEach.
  test('zero-argument call uses getStorageRoot() as default agentsDir', () => {
    const readdirSpy = jest.spyOn(fs, 'readdirSync').mockReturnValue([]);
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);

    validateAgentOperatorMappings();

    const calledPath = readdirSpy.mock.calls[0][0];
    expect(calledPath).toBe(tmpDir);

    jest.restoreAllMocks();
  });
});
