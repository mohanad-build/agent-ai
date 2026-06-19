'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const {
  ProfileNotFoundError,
  SchemaValidationError,
  ProfileCorruptionError,
  readContentProfile,
  writeContentProfile,
  updateContentProfile,
  setContentEngineEnabled,
  isContentEngineEnabled,
  buildDefaultContentProfile,
} = require('../src/content/profile');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'profile-test-'));
}

function makeProfile(overrides = {}) {
  return {
    agentId:                'agent-test',
    contentEngineEnabled:   false,
    contentEngineMode:      'shadow',
    primaryFocus:           'both',
    voiceSamples:           [],
    selfDescription:        '',
    voiceDescriptor:        null,
    voiceDescriptorVersion: 1,
    voiceDescriptorTier:    'default',
    voiceExtractedAt:       null,
    forbiddenTerms:         [],
    forbiddenTopics:        [],
    contentVolume:          'max',
    cadence:                'weekly',
    deliveryDay:            'monday',
    deliveryTime:           '07:00',
    timezone:               'America/Toronto',
    activatedAt:            '2026-05-15T14:00:00.000Z',
    ...overrides,
  };
}

// Catches a thrown error and returns it; returns undefined if no throw.
function caught(fn) {
  try { fn(); } catch (e) { return e; }
}

// ── readContentProfile ────────────────────────────────────────────────────────

describe('readContentProfile', () => {
  test('returns null when file does not exist', () => {
    const baseDir = makeTmpDir();
    expect(readContentProfile('agent-missing', { baseDir })).toBeNull();
  });

  test('returns parsed object when file exists and is valid JSON', () => {
    const baseDir = makeTmpDir();
    writeContentProfile('agent-test', makeProfile(), { baseDir });
    const result = readContentProfile('agent-test', { baseDir });
    expect(result).not.toBeNull();
    expect(result.agentId).toBe('agent-test');
    expect(result.contentEngineMode).toBe('shadow');
  });

  test('throws ProfileCorruptionError when file contains invalid JSON', () => {
    const baseDir = makeTmpDir();
    const dir = baseDir;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'agent-bad.contentProfile.json'), 'not-json', 'utf8');
    const err = caught(() => readContentProfile('agent-bad', { baseDir }));
    expect(err).toBeInstanceOf(ProfileCorruptionError);
    expect(err.name).toBe('ProfileCorruptionError');
    expect(err.message).toMatch(/agent-bad/);
  });

  test('throws non-ENOENT fs errors (e.g. permission denied)', () => {
    const baseDir = makeTmpDir();
    const dir = baseDir;
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'agent-noperm.contentProfile.json');
    fs.writeFileSync(filePath, '{}', 'utf8');
    fs.chmodSync(filePath, 0o000);
    try {
      expect(() => readContentProfile('agent-noperm', { baseDir })).toThrow();
    } finally {
      fs.chmodSync(filePath, 0o644);
    }
  });
});

// ── writeContentProfile ───────────────────────────────────────────────────────

describe('writeContentProfile', () => {
  test('writes file at expected path', () => {
    const baseDir = makeTmpDir();
    writeContentProfile('agent-test', makeProfile(), { baseDir });
    const expected = path.join(baseDir, 'agent-test.contentProfile.json');
    expect(fs.existsSync(expected)).toBe(true);
  });

  test('no .tmp file remains after successful write', () => {
    const baseDir = makeTmpDir();
    writeContentProfile('agent-test', makeProfile(), { baseDir });
    const tmp = path.join(baseDir, 'agent-test.contentProfile.json.tmp');
    expect(fs.existsSync(tmp)).toBe(false);
  });

  test('returns the normalized written profile', () => {
    const baseDir = makeTmpDir();
    const result = writeContentProfile('agent-test', makeProfile(), { baseDir });
    expect(result.agentId).toBe('agent-test');
    expect(typeof result.contentEngineEnabled).toBe('boolean');
  });

  // Required field validation -- one test per field

  test('rejects missing agentId', () => {
    const err = caught(() => writeContentProfile('agent-test', makeProfile({ agentId: '' }), { baseDir: makeTmpDir() }));
    expect(err).toBeInstanceOf(SchemaValidationError);
    expect(err.errors.join('|')).toMatch(/agentId/);
  });

  test('rejects non-boolean contentEngineEnabled', () => {
    const err = caught(() => writeContentProfile('agent-test', makeProfile({ contentEngineEnabled: 'yes' }), { baseDir: makeTmpDir() }));
    expect(err).toBeInstanceOf(SchemaValidationError);
    expect(err.errors.join('|')).toMatch(/contentEngineEnabled/);
  });

  test('rejects invalid contentEngineMode', () => {
    const err = caught(() => writeContentProfile('agent-test', makeProfile({ contentEngineMode: 'turbo' }), { baseDir: makeTmpDir() }));
    expect(err).toBeInstanceOf(SchemaValidationError);
    expect(err.errors.join('|')).toMatch(/contentEngineMode/);
  });

  test('rejects invalid primaryFocus', () => {
    const err = caught(() => writeContentProfile('agent-test', makeProfile({ primaryFocus: 'everyone' }), { baseDir: makeTmpDir() }));
    expect(err).toBeInstanceOf(SchemaValidationError);
    expect(err.errors.join('|')).toMatch(/primaryFocus/);
  });

  test('rejects invalid contentVolume', () => {
    const err = caught(() => writeContentProfile('agent-test', makeProfile({ contentVolume: 'extreme' }), { baseDir: makeTmpDir() }));
    expect(err).toBeInstanceOf(SchemaValidationError);
    expect(err.errors.join('|')).toMatch(/contentVolume/);
  });

  test('rejects invalid cadence', () => {
    const err = caught(() => writeContentProfile('agent-test', makeProfile({ cadence: 'daily' }), { baseDir: makeTmpDir() }));
    expect(err).toBeInstanceOf(SchemaValidationError);
    expect(err.errors.join('|')).toMatch(/cadence/);
  });

  test('rejects invalid deliveryDay', () => {
    const err = caught(() => writeContentProfile('agent-test', makeProfile({ deliveryDay: 'funday' }), { baseDir: makeTmpDir() }));
    expect(err).toBeInstanceOf(SchemaValidationError);
    expect(err.errors.join('|')).toMatch(/deliveryDay/);
  });

  test('rejects empty timezone', () => {
    const err = caught(() => writeContentProfile('agent-test', makeProfile({ timezone: '' }), { baseDir: makeTmpDir() }));
    expect(err).toBeInstanceOf(SchemaValidationError);
    expect(err.errors.join('|')).toMatch(/timezone/);
  });

  test('rejects invalid voiceDescriptorTier', () => {
    const err = caught(() => writeContentProfile('agent-test', makeProfile({ voiceDescriptorTier: 'none' }), { baseDir: makeTmpDir() }));
    expect(err).toBeInstanceOf(SchemaValidationError);
    expect(err.errors.join('|')).toMatch(/voiceDescriptorTier/);
  });

  test('rejects invalid activatedAt', () => {
    const err = caught(() => writeContentProfile('agent-test', makeProfile({ activatedAt: 'not-a-date' }), { baseDir: makeTmpDir() }));
    expect(err).toBeInstanceOf(SchemaValidationError);
    expect(err.errors.join('|')).toMatch(/activatedAt/);
  });

  // Normalization

  test('normalizes deliveryDay to lowercase', () => {
    const baseDir = makeTmpDir();
    const result = writeContentProfile('agent-test', makeProfile({ deliveryDay: 'Monday' }), { baseDir });
    expect(result.deliveryDay).toBe('monday');
    const saved = readContentProfile('agent-test', { baseDir });
    expect(saved.deliveryDay).toBe('monday');
  });

  test('normalizes forbiddenTerms (trim and lowercase)', () => {
    const baseDir = makeTmpDir();
    const result = writeContentProfile('agent-test', makeProfile({ forbiddenTerms: ['  FOO  ', 'BAR'] }), { baseDir });
    expect(result.forbiddenTerms).toEqual(['foo', 'bar']);
  });

  test('preserves case in forbiddenTopics but trims whitespace', () => {
    const baseDir = makeTmpDir();
    const result = writeContentProfile('agent-test', makeProfile({ forbiddenTopics: ['  Real Estate Bubble  '] }), { baseDir });
    expect(result.forbiddenTopics).toEqual(['Real Estate Bubble']);
  });

  // Optional field validation

  test('rejects voiceSamples with unknown type', () => {
    const err = caught(() => writeContentProfile('agent-test', makeProfile({
      voiceSamples: [{ type: 'unknown_type', content: 'hello' }],
    }), { baseDir: makeTmpDir() }));
    expect(err).toBeInstanceOf(SchemaValidationError);
    expect(err.errors.join('|')).toMatch(/voiceSamples/);
  });

  test('rejects voiceSamples array longer than 5', () => {
    const s = { type: 'email', content: 'x' };
    const err = caught(() => writeContentProfile('agent-test', makeProfile({
      voiceSamples: [s, s, s, s, s, s],
    }), { baseDir: makeTmpDir() }));
    expect(err).toBeInstanceOf(SchemaValidationError);
    expect(err.errors.join('|')).toMatch(/voiceSamples/);
  });

  test('accepts voiceSamples with all valid types', () => {
    const baseDir = makeTmpDir();
    const samples = [
      { type: 'video_transcript',      content: 'a' },
      { type: 'blog_post',             content: 'b' },
      { type: 'email',                 content: 'c' },
      { type: 'voice_note_transcript', content: 'd' },
      { type: 'social_post',           content: 'e' },
    ];
    expect(() => writeContentProfile('agent-test', makeProfile({ voiceSamples: samples }), { baseDir })).not.toThrow();
  });

  test('rejects selfDescription longer than 1000 chars', () => {
    const err = caught(() => writeContentProfile('agent-test', makeProfile({ selfDescription: 'x'.repeat(1001) }), { baseDir: makeTmpDir() }));
    expect(err).toBeInstanceOf(SchemaValidationError);
    expect(err.errors.join('|')).toMatch(/selfDescription/);
  });

  test('rejects deliveryTime "7:00" (missing leading zero)', () => {
    const err = caught(() => writeContentProfile('agent-test', makeProfile({ deliveryTime: '7:00' }), { baseDir: makeTmpDir() }));
    expect(err).toBeInstanceOf(SchemaValidationError);
    expect(err.name).toBe('SchemaValidationError');
  });

  test('rejects deliveryTime "25:00" (hour out of range)', () => {
    const err = caught(() => writeContentProfile('agent-test', makeProfile({ deliveryTime: '25:00' }), { baseDir: makeTmpDir() }));
    expect(err).toBeInstanceOf(SchemaValidationError);
  });

  test('rejects deliveryTime "12:60" (minute out of range)', () => {
    const err = caught(() => writeContentProfile('agent-test', makeProfile({ deliveryTime: '12:60' }), { baseDir: makeTmpDir() }));
    expect(err).toBeInstanceOf(SchemaValidationError);
  });

  test('accepts valid deliveryTime boundary values', () => {
    const baseDir = makeTmpDir();
    expect(() => writeContentProfile('agent-test', makeProfile({ deliveryTime: '00:00' }), { baseDir })).not.toThrow();
    expect(() => writeContentProfile('agent-test', makeProfile({ deliveryTime: '23:59' }), { baseDir })).not.toThrow();
  });

  test('accepts a minimal valid profile from buildDefaultContentProfile', () => {
    const baseDir = makeTmpDir();
    const profile = buildDefaultContentProfile('agent-default');
    expect(() => writeContentProfile('agent-default', profile, { baseDir })).not.toThrow();
  });

  test('SchemaValidationError has errors array with field-specific messages', () => {
    const err = caught(() => writeContentProfile('agent-test', makeProfile({ agentId: '' }), { baseDir: makeTmpDir() }));
    expect(Array.isArray(err.errors)).toBe(true);
    expect(err.errors.length).toBeGreaterThan(0);
    expect(err.errors[0]).toMatch(/agentId/);
  });
});

// ── updateContentProfile ──────────────────────────────────────────────────────

describe('updateContentProfile', () => {
  test('merges patch over existing profile', () => {
    const baseDir = makeTmpDir();
    writeContentProfile('agent-test', makeProfile({ contentVolume: 'balanced' }), { baseDir });
    const result = updateContentProfile('agent-test', { contentVolume: 'minimum' }, { baseDir });
    expect(result.contentVolume).toBe('minimum');
    expect(result.agentId).toBe('agent-test');
  });

  test('persists the merged result to disk', () => {
    const baseDir = makeTmpDir();
    writeContentProfile('agent-test', makeProfile(), { baseDir });
    updateContentProfile('agent-test', { contentEngineEnabled: true }, { baseDir });
    const saved = readContentProfile('agent-test', { baseDir });
    expect(saved.contentEngineEnabled).toBe(true);
  });

  test('validates the merged result, not just the patch', () => {
    const baseDir = makeTmpDir();
    writeContentProfile('agent-test', makeProfile(), { baseDir });
    const err = caught(() => updateContentProfile('agent-test', { contentEngineMode: 'turbo' }, { baseDir }));
    expect(err).toBeInstanceOf(SchemaValidationError);
  });

  test('throws ProfileNotFoundError if profile does not exist', () => {
    const baseDir = makeTmpDir();
    const err = caught(() => updateContentProfile('agent-missing', { contentVolume: 'minimum' }, { baseDir }));
    expect(err).toBeInstanceOf(ProfileNotFoundError);
    expect(err.name).toBe('ProfileNotFoundError');
  });

  test('shallow merge -- arrays are replaced, not appended', () => {
    const baseDir = makeTmpDir();
    writeContentProfile('agent-test', makeProfile({ forbiddenTerms: ['foo'] }), { baseDir });
    const result = updateContentProfile('agent-test', { forbiddenTerms: ['bar'] }, { baseDir });
    // 'bar' normalized to lowercase, and the original 'foo' is gone
    expect(result.forbiddenTerms).toEqual(['bar']);
  });
});

// ── setContentEngineEnabled ───────────────────────────────────────────────────

describe('setContentEngineEnabled', () => {
  test('flips the flag from false to true', () => {
    const baseDir = makeTmpDir();
    writeContentProfile('agent-test', makeProfile({ contentEngineEnabled: false }), { baseDir });
    const result = setContentEngineEnabled('agent-test', true, { baseDir });
    expect(result.contentEngineEnabled).toBe(true);
  });

  test('flips the flag from true to false', () => {
    const baseDir = makeTmpDir();
    writeContentProfile('agent-test', makeProfile({ contentEngineEnabled: true }), { baseDir });
    const result = setContentEngineEnabled('agent-test', false, { baseDir });
    expect(result.contentEngineEnabled).toBe(false);
  });

  test('throws ProfileNotFoundError if profile does not exist', () => {
    const baseDir = makeTmpDir();
    const err = caught(() => setContentEngineEnabled('agent-missing', true, { baseDir }));
    expect(err).toBeInstanceOf(ProfileNotFoundError);
  });

  test('throws TypeError on non-boolean argument', () => {
    const baseDir = makeTmpDir();
    writeContentProfile('agent-test', makeProfile(), { baseDir });
    expect(() => setContentEngineEnabled('agent-test', 'yes', { baseDir })).toThrow(TypeError);
    expect(() => setContentEngineEnabled('agent-test', 1, { baseDir })).toThrow(TypeError);
  });
});

// ── isContentEngineEnabled ────────────────────────────────────────────────────

describe('isContentEngineEnabled', () => {
  test('returns false when profile does not exist (absent-as-false)', () => {
    const baseDir = makeTmpDir();
    expect(isContentEngineEnabled('agent-missing', { baseDir })).toBe(false);
  });

  test('returns false when profile exists but flag is false', () => {
    const baseDir = makeTmpDir();
    writeContentProfile('agent-test', makeProfile({ contentEngineEnabled: false }), { baseDir });
    expect(isContentEngineEnabled('agent-test', { baseDir })).toBe(false);
  });

  test('returns true when profile exists and flag is true', () => {
    const baseDir = makeTmpDir();
    writeContentProfile('agent-test', makeProfile({ contentEngineEnabled: true }), { baseDir });
    expect(isContentEngineEnabled('agent-test', { baseDir })).toBe(true);
  });

  test('throws ProfileCorruptionError on invalid JSON (corruption is loud on hot path)', () => {
    const baseDir = makeTmpDir();
    const dir = baseDir;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'agent-corrupt.contentProfile.json'), '{broken', 'utf8');
    const err = caught(() => isContentEngineEnabled('agent-corrupt', { baseDir }));
    expect(err).toBeInstanceOf(ProfileCorruptionError);
    expect(err.name).toBe('ProfileCorruptionError');
  });
});

// ── buildDefaultContentProfile ────────────────────────────────────────────────

describe('buildDefaultContentProfile', () => {
  // Per spec: agentId is required. This module throws TypeError if omitted.
  test('throws TypeError when agentId is omitted', () => {
    expect(() => buildDefaultContentProfile()).toThrow(TypeError);
    expect(() => buildDefaultContentProfile('')).toThrow(TypeError);
  });

  test('returns a valid profile that passes writeContentProfile without error', () => {
    const baseDir = makeTmpDir();
    const profile = buildDefaultContentProfile('agent-default');
    expect(() => writeContentProfile('agent-default', profile, { baseDir })).not.toThrow();
  });

  test('overrides win in shallow merge', () => {
    const profile = buildDefaultContentProfile('agent-x', {
      contentEngineMode: 'live',
      contentVolume:     'balanced',
    });
    expect(profile.contentEngineMode).toBe('live');
    expect(profile.contentVolume).toBe('balanced');
    expect(profile.agentId).toBe('agent-x');
  });

  test('agentId from first argument is set on the returned profile', () => {
    const profile = buildDefaultContentProfile('agent-jane');
    expect(profile.agentId).toBe('agent-jane');
  });

  test('defaults include expected sentinel values', () => {
    const profile = buildDefaultContentProfile('agent-default');
    expect(profile.contentEngineEnabled).toBe(false);
    expect(profile.contentEngineMode).toBe('shadow');
    expect(profile.voiceDescriptorTier).toBe('default');
    expect(profile.voiceDescriptor).toBeNull();
    expect(Array.isArray(profile.voiceSamples)).toBe(true);
    expect(profile.voiceSamples.length).toBe(0);
  });

  test('activatedAt is an ISO string set at call time', () => {
    const before = Date.now();
    const profile = buildDefaultContentProfile('agent-ts');
    const after = Date.now();
    const ts = new Date(profile.activatedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
