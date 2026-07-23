'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const {
  loadAgent,
  findAgentByPhone,
  isLeadCategoryActionable,
  getFollowUpCadence,
  isInboxCleaningEnabled,
} = require('../src/agentConfig');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentConfig-'));
  process.env.STORAGE_ROOT = tmpDir;
});

afterEach(() => {
  delete process.env.STORAGE_ROOT;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── loadAgent ─────────────────────────────────────────────────────────────────

describe('loadAgent', () => {
  test('reads agent config from STORAGE_ROOT/<id>.json', () => {
    const cfg = { agentId: 'test-agent', agentPhone: '+15551234567' };
    fs.writeFileSync(path.join(tmpDir, 'test-agent.json'), JSON.stringify(cfg));
    expect(loadAgent('test-agent')).toEqual(cfg);
  });

  test('throws with clear error containing expected path when file is missing', () => {
    const expectedPath = path.join(tmpDir, 'missing-agent.json');
    expect(() => loadAgent('missing-agent')).toThrow(expectedPath);
  });
});

// ── findAgentByPhone ──────────────────────────────────────────────────────────

describe('findAgentByPhone', () => {
  test('returns config for matching phone', () => {
    const cfg = { agentId: 'agent-a', agentPhone: '+15550001111' };
    fs.writeFileSync(path.join(tmpDir, 'agent-a.json'), JSON.stringify(cfg));
    expect(findAgentByPhone('+15550001111')).toEqual(cfg);
  });

  test('returns null when no agent matches the phone', () => {
    const cfg = { agentId: 'agent-b', agentPhone: '+15550002222' };
    fs.writeFileSync(path.join(tmpDir, 'agent-b.json'), JSON.stringify(cfg));
    expect(findAgentByPhone('+19999999999')).toBeNull();
  });

  test('tolerates malformed JSON (logs warning, continues, returns null)', () => {
    fs.writeFileSync(path.join(tmpDir, 'bad-agent.json'), 'not-json{{{');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = findAgentByPhone('+10000000000');
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('bad-agent.json'));
    warnSpy.mockRestore();
  });

  test('skips .state.json files', () => {
    fs.writeFileSync(path.join(tmpDir, 'real-agent.state.json'), JSON.stringify({ agentPhone: '+15550003333' }));
    expect(findAgentByPhone('+15550003333')).toBeNull();
  });

  test('skips .contentProfile.json files', () => {
    fs.writeFileSync(path.join(tmpDir, 'real-agent.contentProfile.json'), JSON.stringify({ agentPhone: '+15550004444' }));
    expect(findAgentByPhone('+15550004444')).toBeNull();
  });

  test('skips .contentState.json files', () => {
    fs.writeFileSync(path.join(tmpDir, 'real-agent.contentState.json'), JSON.stringify({ agentPhone: '+15550005555' }));
    expect(findAgentByPhone('+15550005555')).toBeNull();
  });

  test('skips files that do not match /^[a-z0-9-]+\\.json$/ (uppercase, dots in stem)', () => {
    fs.writeFileSync(path.join(tmpDir, 'Agent-X.json'), JSON.stringify({ agentPhone: '+15550006666' }));
    fs.writeFileSync(path.join(tmpDir, 'some.extra.json'), JSON.stringify({ agentPhone: '+15550007777' }));
    expect(findAgentByPhone('+15550006666')).toBeNull();
    expect(findAgentByPhone('+15550007777')).toBeNull();
  });
});

// ── isLeadCategoryActionable ──────────────────────────────────────────────────

describe('isLeadCategoryActionable', () => {
  test('returns true when row is null', () => {
    expect(isLeadCategoryActionable(null)).toBe(true);
  });

  test('returns true when leadCategory is absent', () => {
    expect(isLeadCategoryActionable({})).toBe(true);
  });

  test('returns false for "soi" (case-insensitive)', () => {
    expect(isLeadCategoryActionable({ leadCategory: 'soi' })).toBe(false);
    expect(isLeadCategoryActionable({ leadCategory: 'SOI' })).toBe(false);
    expect(isLeadCategoryActionable({ leadCategory: '  Soi  ' })).toBe(false);
  });

  test('returns true for any other category', () => {
    expect(isLeadCategoryActionable({ leadCategory: 'buyer' })).toBe(true);
    expect(isLeadCategoryActionable({ leadCategory: 'seller' })).toBe(true);
    expect(isLeadCategoryActionable({ leadCategory: '' })).toBe(true);
  });
});

// ── getFollowUpCadence ────────────────────────────────────────────────────────

describe('getFollowUpCadence', () => {
  test('returns default [3, 7, 14] when followUpCadence is absent', () => {
    expect(getFollowUpCadence({ agentId: 'x' })).toEqual([3, 7, 14]);
  });

  test('returns default when followUpCadence is an empty array', () => {
    expect(getFollowUpCadence({ agentId: 'x', followUpCadence: [] })).toEqual([3, 7, 14]);
  });

  test('returns the configured cadence when valid', () => {
    expect(getFollowUpCadence({ agentId: 'x', followUpCadence: [1, 5, 10] })).toEqual([1, 5, 10]);
  });

  test('returns default and logs warning when a value is non-integer', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = getFollowUpCadence({ agentId: 'x', followUpCadence: [3, 7.5, 14] });
    expect(result).toEqual([3, 7, 14]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('returns default and logs warning when a value is zero or negative', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = getFollowUpCadence({ agentId: 'x', followUpCadence: [3, 0, 14] });
    expect(result).toEqual([3, 7, 14]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ── isInboxCleaningEnabled ───────────────────────────────────────────────────

describe('isInboxCleaningEnabled', () => {
  test.each([
    ['undefined field', undefined, false],
    ['null field', null, false],
    ['empty string field', '', false],
    ['boolean true', true, true],
    ["string 'true'", 'true', true],
    ["string 'yes'", 'yes', true],
    ["string '1'", '1', true],
    ['boolean false', false, false],
    ["string 'false'", 'false', false],
    ["string 'no'", 'no', false],
    ["string 'anything'", 'anything', false],
  ])('%s → %s', (_label, value, expected) => {
    expect(isInboxCleaningEnabled({ agentId: 'x', inboxCleaningEnabled: value })).toBe(expected);
  });

  test('field entirely absent from agentConfig → false', () => {
    expect(isInboxCleaningEnabled({ agentId: 'x' })).toBe(false);
  });
});
