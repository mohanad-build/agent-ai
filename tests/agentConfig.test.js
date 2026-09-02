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
  patchAgent,
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

// ── patchAgent ────────────────────────────────────────────────────────────────

describe('patchAgent', () => {
  function writeConfig(agentId, cfg) {
    fs.writeFileSync(path.join(tmpDir, `${agentId}.json`), JSON.stringify(cfg));
  }

  function readConfig(agentId) {
    return JSON.parse(fs.readFileSync(path.join(tmpDir, `${agentId}.json`), 'utf8'));
  }

  test('merges the patch onto the existing file and persists it', () => {
    writeConfig('agent-a', { agentId: 'agent-a', isActive: true, tone: 'friendly' });

    const result = patchAgent('agent-a', { isActive: false });

    expect(result).toEqual({ agentId: 'agent-a', isActive: false, tone: 'friendly' });
    expect(readConfig('agent-a')).toEqual({ agentId: 'agent-a', isActive: false, tone: 'friendly' });
  });

  // This is the assertion that actually protects the token: googleRefreshToken
  // is AES-256-GCM ciphertext (since f92a834) that exists nowhere else, and a
  // writer that only wrote the patched key instead of the whole merged object
  // would silently destroy it on every unrelated patch (e.g. handleAuthFailure
  // flipping isActive). Same reasoning for googleSheetId: losing it breaks the
  // agent's Sheet link with no separate copy to recover from.
  test('a patch to one field does not drop googleRefreshToken or googleSheetId', () => {
    writeConfig('agent-a', {
      agentId: 'agent-a',
      isActive: true,
      googleRefreshToken: 'enc:v1:deadbeef',
      googleSheetId: 'sheet-123',
    });

    patchAgent('agent-a', { isActive: false });

    const onDisk = readConfig('agent-a');
    expect(onDisk.googleRefreshToken).toBe('enc:v1:deadbeef');
    expect(onDisk.googleSheetId).toBe('sheet-123');
    expect(onDisk.isActive).toBe(false);
  });

  test('writes via a temp file and renames into place, never writing the real path directly', () => {
    writeConfig('agent-a', { agentId: 'agent-a', isActive: true });
    const realPath = path.join(tmpDir, 'agent-a.json');
    const tmpPath = path.join(tmpDir, 'agent-a.json.tmp');

    const writeSpy = jest.spyOn(fs, 'writeFileSync');
    const renameSpy = jest.spyOn(fs, 'renameSync');
    try {
      patchAgent('agent-a', { isActive: false });

      expect(writeSpy).toHaveBeenCalledWith(tmpPath, expect.any(String), 'utf8');
      expect(writeSpy).not.toHaveBeenCalledWith(realPath, expect.anything(), expect.anything());
      expect(renameSpy).toHaveBeenCalledWith(tmpPath, realPath);
    } finally {
      writeSpy.mockRestore();
      renameSpy.mockRestore();
    }
  });

  // A crash between the writeFileSync and the renameSync above leaves this
  // temp file sitting on disk. If its name satisfied discoverAgentIds' own
  // filter, the next boot would pick it up as a phantom agent carrying a
  // live copy of googleRefreshToken (this project's session-39 phantom-agent
  // bug). This does not hardcode the temp filename or the regex: it captures
  // the ACTUAL path patchAgent wrote to, and runs the ACTUAL AGENT_ID_REGEX
  // exported by both discoverAgentIds implementations against it, so the
  // test stays meaningful if either side is ever renamed independently.
  test('the temp file it writes cannot be discovered as an agent by any of the three discovery filters', () => {
    writeConfig('agent-a', { agentId: 'agent-a', isActive: true });

    const writeSpy = jest.spyOn(fs, 'writeFileSync');
    let tmpBasename;
    try {
      patchAgent('agent-a', { isActive: false });
      const realPath = path.join(tmpDir, 'agent-a.json');
      const tmpCall = writeSpy.mock.calls.find((call) => call[0] !== realPath);
      expect(tmpCall).toBeDefined();
      tmpBasename = path.basename(tmpCall[0]);
    } finally {
      writeSpy.mockRestore();
    }

    const { AGENT_ID_REGEX: indexRegex } = require('../src/index');
    const { AGENT_ID_REGEX: dashboardRegex } = require('../src/routes/dashboard');
    const { DIGEST_AGENT_ID_REGEX: digestRegex } = require('../src/digest')._internal;

    expect(indexRegex.test(tmpBasename)).toBe(false);
    expect(dashboardRegex.test(tmpBasename)).toBe(false);
    expect(digestRegex.test(tmpBasename)).toBe(false);
  });

  test('returns the full merged object, not just the patch', () => {
    writeConfig('agent-a', { agentId: 'agent-a', isActive: true, tone: 'friendly' });

    const result = patchAgent('agent-a', { isActive: false });

    expect(Object.keys(result).sort()).toEqual(['agentId', 'isActive', 'tone']);
  });

  test('throws a clear error when the agent config does not exist', () => {
    expect(() => patchAgent('missing-agent', { isActive: false })).toThrow('patchAgent: agent config not found');
  });

  test('throws on a missing agentId', () => {
    expect(() => patchAgent(undefined, { isActive: false })).toThrow('patchAgent');
  });

  test('throws on an empty agentId', () => {
    expect(() => patchAgent('', { isActive: false })).toThrow('patchAgent');
  });

  test('throws when patch is not a plain object', () => {
    writeConfig('agent-a', { agentId: 'agent-a' });
    expect(() => patchAgent('agent-a', null)).toThrow('patchAgent: patch must be a plain object');
    expect(() => patchAgent('agent-a', 'isActive')).toThrow('patchAgent: patch must be a plain object');
    expect(() => patchAgent('agent-a', ['isActive'])).toThrow('patchAgent: patch must be a plain object');
  });
});
