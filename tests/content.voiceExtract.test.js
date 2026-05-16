'use strict';

jest.mock('../src/claude');

// Factory mock: preserves error classes and buildDefaultContentProfile (real
// implementations), but wraps I/O functions as jest.fn() so tests can spy on
// them. The extractVoiceForAgent tests restore the real implementations via
// mockImplementation in beforeEach to get actual fs I/O against a tmpDir.
jest.mock('../src/content/profile', () => {
  const actual = jest.requireActual('../src/content/profile');
  return {
    ...actual,
    readContentProfile:      jest.fn(),
    writeContentProfile:     jest.fn(),
    updateContentProfile:    jest.fn(),
    setContentEngineEnabled: jest.fn(),
    isContentEngineEnabled:  jest.fn(),
  };
});

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const claude  = require('../src/claude');
const profileMod = require('../src/content/profile');

const {
  SYSTEM_DEFAULT_DESCRIPTOR,
  DESCRIPTOR_SCHEMA_VERSION,
  extractVoice,
  extractVoiceForAgent,
  VoiceExtractionError,
  _internal,
} = require('../src/content/voiceExtract');

const { MODELS } = claude;
const {
  validateDescriptor,
  truncateSampleContent,
  buildExtractionPrompt,
  buildSelfDescriptionPrompt,
} = _internal;

// ── Fixtures ──────────────────────────────────────────────────────────────────

function validDescriptorJson(overrides = {}) {
  return JSON.stringify({
    version:           DESCRIPTOR_SCHEMA_VERSION,
    extractedAt:       '2026-05-15T10:00:00.000Z',
    modelUsed:         'claude-sonnet-4-6',
    samplesUsedCount:  0,
    tier:              'extracted',
    tone:              'Warm and direct.',
    sentenceRhythm:    'Short sentences. Clear paragraphs.',
    signaturePhrases:  ['lets talk'],
    vocabularyNotes:   'Plain English, avoids jargon.',
    ctaPattern:        'Invites a call.',
    hookPattern:       'Opens with a question.',
    extractedRefusals: ['hustle'],
    rawSummary:        'A clear and direct communicator.',
    ...overrides,
  });
}

function makeSample(type = 'email', content = 'Hello, this is a test email.') {
  return { type, content };
}

// ── extractVoice -- Tier 3 (no samples, no selfDescription) ──────────────────

describe('extractVoice -- Tier 3 (default)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    claude.callRaw.mockResolvedValue(validDescriptorJson());
  });

  test('empty samples and empty selfDescription returns tier === "default"', async () => {
    const result = await extractVoice([], '');
    expect(result.tier).toBe('default');
  });

  test('null selfDescription falls through to Tier 3', async () => {
    const result = await extractVoice([], null);
    expect(result.tier).toBe('default');
  });

  test('whitespace-only selfDescription falls through to Tier 3', async () => {
    const result = await extractVoice([], '   ');
    expect(result.tier).toBe('default');
  });

  test('samplesUsedCount is 0', async () => {
    const result = await extractVoice([], '');
    expect(result.samplesUsedCount).toBe(0);
  });

  test('modelUsed is "system_default"', async () => {
    const result = await extractVoice([], '');
    expect(result.modelUsed).toBe('system_default');
  });

  test('extractedAt is a valid ISO string', async () => {
    const before = Date.now();
    const result = await extractVoice([], '');
    const after  = Date.now();
    const ts = new Date(result.extractedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  test('claude.callRaw is NOT called for Tier 3', async () => {
    await extractVoice([], '');
    expect(claude.callRaw.mock.calls.length).toBe(0);
  });

  test('returned object is a clone, not the frozen constant', async () => {
    const result = await extractVoice([], '');
    // Mutating the clone should succeed (not throw)
    expect(() => { result.tone = 'mutated'; }).not.toThrow();
    expect(result.tone).toBe('mutated');
    // Frozen constant is unchanged
    expect(() => { SYSTEM_DEFAULT_DESCRIPTOR.tone = 'mutated'; }).toThrow();
  });

  test('two sequential Tier 3 calls return different extractedAt values', async () => {
    const first = await extractVoice([], '');
    await new Promise(r => setTimeout(r, 5));
    const second = await extractVoice([], '');
    expect(first.extractedAt).not.toBe(second.extractedAt);
  });
});

// ── extractVoice -- Tier 2 (selfDescription only) ────────────────────────────

describe('extractVoice -- Tier 2 (self_described)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    claude.callRaw.mockResolvedValue(validDescriptorJson({ tier: 'self_described', samplesUsedCount: 0 }));
  });

  test('callRaw is called exactly once', async () => {
    await extractVoice([], 'I write short and punchy emails.');
    expect(claude.callRaw.mock.calls.length).toBe(1);
  });

  test('callRaw receives model === MODELS.SONNET', async () => {
    await extractVoice([], 'I write short and punchy emails.');
    const callArg = claude.callRaw.mock.calls[0][0];
    expect(callArg.model).toBe(MODELS.SONNET);
  });

  test('prompt user message contains SELF-DESCRIPTION delimiter', async () => {
    await extractVoice([], 'I write short and punchy emails.');
    const callArg = claude.callRaw.mock.calls[0][0];
    expect(callArg.user).toMatch(/SELF-DESCRIPTION/);
  });

  test('returned descriptor has tier === "self_described"', async () => {
    const result = await extractVoice([], 'I write short and punchy emails.');
    expect(result.tier).toBe('self_described');
  });

  test('samplesUsedCount is 0', async () => {
    const result = await extractVoice([], 'I write short and punchy emails.');
    expect(result.samplesUsedCount).toBe(0);
  });

  test('modelUsed equals MODELS.SONNET string', async () => {
    const result = await extractVoice([], 'I write short and punchy emails.');
    expect(result.modelUsed).toBe(MODELS.SONNET);
    expect(result.modelUsed).not.toBe('system_default');
  });

  test('maxTokens 2048 is passed to callRaw', async () => {
    await extractVoice([], 'I write short emails.');
    const callArg = claude.callRaw.mock.calls[0][0];
    expect(callArg.maxTokens).toBe(2048);
  });
});

// ── extractVoice -- Tier 1 (samples present) ─────────────────────────────────

describe('extractVoice -- Tier 1 (extracted)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    claude.callRaw.mockResolvedValue(validDescriptorJson({ tier: 'extracted', samplesUsedCount: 2 }));
  });

  test('prompt user message contains SAMPLE 1 delimiter', async () => {
    await extractVoice([makeSample('email', 'Hi there')], '');
    const callArg = claude.callRaw.mock.calls[0][0];
    expect(callArg.user).toMatch(/SAMPLE 1/);
  });

  test('prompt includes the sample type verbatim', async () => {
    await extractVoice([makeSample('blog_post', 'Some content')], '');
    const callArg = claude.callRaw.mock.calls[0][0];
    expect(callArg.user).toMatch(/type: blog_post/);
  });

  test('returned descriptor has tier === "extracted"', async () => {
    const result = await extractVoice([makeSample()], '');
    expect(result.tier).toBe('extracted');
  });

  test('samplesUsedCount matches input array length', async () => {
    const result = await extractVoice([makeSample(), makeSample('blog_post', 'post')], '');
    expect(result.samplesUsedCount).toBe(2);
  });

  test('long sample is truncated with [truncated] suffix in prompt', async () => {
    const longContent = Array.from({ length: 2100 }, (_, i) => `word${i}`).join(' ');
    await extractVoice([makeSample('email', longContent)], '');
    const callArg = claude.callRaw.mock.calls[0][0];
    expect(callArg.user).toMatch(/\[truncated\]/);
  });

  test('short sample is NOT truncated', async () => {
    await extractVoice([makeSample('email', 'Short content here.')], '');
    const callArg = claude.callRaw.mock.calls[0][0];
    expect(callArg.user).not.toMatch(/\[truncated\]/);
  });
});

// ── extractVoice -- response shape failures and retry logic ──────────────────

describe('extractVoice -- retry logic', () => {
  beforeEach(() => jest.clearAllMocks());

  test('bad JSON first, valid JSON second: succeeds with callRaw called twice', async () => {
    claude.callRaw
      .mockResolvedValueOnce('not-json')
      .mockResolvedValueOnce(validDescriptorJson({ tier: 'extracted', samplesUsedCount: 1 }));
    const result = await extractVoice([makeSample()], '');
    expect(claude.callRaw.mock.calls.length).toBe(2);
    expect(result.tier).toBe('extracted');
  });

  test('bad JSON twice: throws VoiceExtractionError with attempts === 2', async () => {
    claude.callRaw.mockResolvedValue('not-json');
    let err;
    try { await extractVoice([makeSample()], ''); }
    catch (e) { err = e; }
    expect(err).toBeInstanceOf(VoiceExtractionError);
    expect(err.name).toBe('VoiceExtractionError');
    expect(err.attempts).toBe(2);
    expect(err.cause).toBeDefined();
  });

  test('missing required field first call, valid second: succeeds, callRaw called twice', async () => {
    claude.callRaw
      .mockResolvedValueOnce(validDescriptorJson({ tone: '' }))
      .mockResolvedValueOnce(validDescriptorJson({ tier: 'extracted', samplesUsedCount: 1 }));
    const result = await extractVoice([makeSample()], '');
    expect(claude.callRaw.mock.calls.length).toBe(2);
    expect(result.tier).toBe('extracted');
  });

  test('schema invalid twice: throws VoiceExtractionError with .errors naming the field', async () => {
    claude.callRaw.mockResolvedValue(validDescriptorJson({ tone: '' }));
    let err;
    try { await extractVoice([makeSample()], ''); }
    catch (e) { err = e; }
    expect(err).toBeInstanceOf(VoiceExtractionError);
    expect(err.attempts).toBe(2);
    expect(Array.isArray(err.errors)).toBe(true);
    expect(err.errors.length).toBeGreaterThan(0);
    expect(err.errors[0]).toMatch(/tone/);
  });

  test('markdown-fenced response parses successfully', async () => {
    claude.callRaw.mockResolvedValue('```json\n' + validDescriptorJson({ tier: 'extracted', samplesUsedCount: 1 }) + '\n```');
    const result = await extractVoice([makeSample()], '');
    expect(result.tier).toBe('extracted');
    expect(claude.callRaw.mock.calls.length).toBe(1);
  });

  test('response with leading/trailing whitespace parses successfully', async () => {
    claude.callRaw.mockResolvedValue('  \n' + validDescriptorJson({ tier: 'extracted', samplesUsedCount: 1 }) + '\n  ');
    const result = await extractVoice([makeSample()], '');
    expect(result.tier).toBe('extracted');
  });

  test('callRaw error propagates unchanged, not wrapped in VoiceExtractionError', async () => {
    const networkErr = new Error('ECONNREFUSED');
    claude.callRaw.mockRejectedValue(networkErr);
    let err;
    try { await extractVoice([makeSample()], ''); }
    catch (e) { err = e; }
    expect(err).toBe(networkErr);
    expect(err.name).not.toBe('VoiceExtractionError');
  });
});

// ── validateDescriptor ────────────────────────────────────────────────────────

describe('validateDescriptor', () => {
  function validDescriptor(overrides = {}) {
    const clone = structuredClone(SYSTEM_DEFAULT_DESCRIPTOR);
    clone.extractedAt = '2026-05-15T10:00:00.000Z';
    clone.tier        = 'default';
    return { ...clone, ...overrides };
  }

  test('accepts a fully valid descriptor', () => {
    expect(validateDescriptor(validDescriptor())).toEqual({ valid: true });
  });

  test('rejects when version !== DESCRIPTOR_SCHEMA_VERSION', () => {
    const r = validateDescriptor(validDescriptor({ version: 99 }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/version/);
  });

  test('rejects when extractedAt is not a valid ISO string', () => {
    const r = validateDescriptor(validDescriptor({ extractedAt: 'not-a-date' }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/extractedAt/);
  });

  test('rejects when modelUsed is empty', () => {
    const r = validateDescriptor(validDescriptor({ modelUsed: '' }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/modelUsed/);
  });

  test('rejects when samplesUsedCount is negative', () => {
    const r = validateDescriptor(validDescriptor({ samplesUsedCount: -1 }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/samplesUsedCount/);
  });

  test('rejects when tier is unknown', () => {
    const r = validateDescriptor(validDescriptor({ tier: 'turbo' }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/tier/);
  });

  test('rejects when tone is empty', () => {
    const r = validateDescriptor(validDescriptor({ tone: '' }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/tone/);
  });

  test('rejects when sentenceRhythm is missing', () => {
    const r = validateDescriptor(validDescriptor({ sentenceRhythm: '' }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/sentenceRhythm/);
  });

  test('rejects when vocabularyNotes is empty', () => {
    const r = validateDescriptor(validDescriptor({ vocabularyNotes: '' }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/vocabularyNotes/);
  });

  test('rejects when ctaPattern is empty', () => {
    const r = validateDescriptor(validDescriptor({ ctaPattern: '' }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/ctaPattern/);
  });

  test('rejects when hookPattern is empty', () => {
    const r = validateDescriptor(validDescriptor({ hookPattern: '' }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/hookPattern/);
  });

  test('rejects when rawSummary is empty', () => {
    const r = validateDescriptor(validDescriptor({ rawSummary: '' }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/rawSummary/);
  });

  test('rejects when signaturePhrases has 11 items', () => {
    const r = validateDescriptor(validDescriptor({ signaturePhrases: Array(11).fill('x') }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/signaturePhrases/);
  });

  test('rejects when extractedRefusals contains an empty string', () => {
    const r = validateDescriptor(validDescriptor({ extractedRefusals: ['fine', ''] }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/extractedRefusals.*empty/);
  });

  test('rejects when signaturePhrases contains a non-string', () => {
    const r = validateDescriptor(validDescriptor({ signaturePhrases: [42] }));
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toMatch(/signaturePhrases/);
  });

  test('accepts when signaturePhrases is empty array', () => {
    expect(validateDescriptor(validDescriptor({ signaturePhrases: [] }))).toEqual({ valid: true });
  });

  test('accepts when extractedRefusals is empty array', () => {
    expect(validateDescriptor(validDescriptor({ extractedRefusals: [] }))).toEqual({ valid: true });
  });
});

// ── truncateSampleContent ─────────────────────────────────────────────────────

describe('truncateSampleContent', () => {
  test('returns content unchanged when under the limit', () => {
    expect(truncateSampleContent('hello world')).toBe('hello world');
  });

  test('truncates and appends [truncated] when over limit', () => {
    const long = Array.from({ length: 2001 }, (_, i) => `w${i}`).join(' ');
    const result = truncateSampleContent(long);
    expect(result.endsWith('[truncated]')).toBe(true);
    expect(result.split(/\s+/).length).toBe(2001); // 2000 words + [truncated]
  });

  test('custom maxWords is respected', () => {
    const content = 'one two three four five';
    const result = truncateSampleContent(content, 3);
    expect(result).toBe('one two three [truncated]');
  });
});

// ── buildExtractionPrompt ─────────────────────────────────────────────────────

describe('buildExtractionPrompt', () => {
  test('returns { system, user }', () => {
    const { system, user } = buildExtractionPrompt([makeSample()]);
    expect(typeof system).toBe('string');
    expect(typeof user).toBe('string');
  });

  test('user contains sample count', () => {
    const { user } = buildExtractionPrompt([makeSample(), makeSample('blog_post', 'post')]);
    expect(user).toMatch(/2 sample/);
  });

  test('system prompt references em-dashes ban', () => {
    const { system } = buildExtractionPrompt([makeSample()]);
    expect(system).toMatch(/em-dash/i);
  });
});

// ── buildSelfDescriptionPrompt ────────────────────────────────────────────────

describe('buildSelfDescriptionPrompt', () => {
  test('returns { system, user }', () => {
    const { system, user } = buildSelfDescriptionPrompt('I am direct.');
    expect(typeof system).toBe('string');
    expect(typeof user).toBe('string');
  });

  test('user contains the self-description text', () => {
    const { user } = buildSelfDescriptionPrompt('I write short punchy emails.');
    expect(user).toMatch(/I write short punchy emails/);
  });
});

// ── extractVoiceForAgent ──────────────────────────────────────────────────────

describe('extractVoiceForAgent', () => {
  // These tests use real profile.js I/O with a tmpdir, but claude is still mocked.
  // Unmock profile for this describe block only by using the real implementation.

  let tmpDir;
  const realProfile = jest.requireActual('../src/content/profile');

  beforeEach(() => {
    jest.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceextract-test-'));
    // Wire the real profile functions into the module under test via the mock
    profileMod.readContentProfile.mockImplementation(realProfile.readContentProfile);
    profileMod.updateContentProfile.mockImplementation(realProfile.updateContentProfile);
    claude.callRaw.mockResolvedValue(
      validDescriptorJson({ tier: 'extracted', samplesUsedCount: 0 })
    );
  });

  function writeRealProfile(agentId, overrides = {}) {
    const p = realProfile.buildDefaultContentProfile(agentId, overrides);
    realProfile.writeContentProfile(agentId, p, { baseDir: tmpDir });
    return p;
  }

  test('successful extraction writes descriptor fields to profile on disk', async () => {
    writeRealProfile('agent-test');
    claude.callRaw.mockResolvedValue(
      validDescriptorJson({ tier: 'extracted', samplesUsedCount: 0 })
    );
    const result = await extractVoiceForAgent('agent-test', { baseDir: tmpDir });
    expect(result.extracted).toBe(true);
    const saved = realProfile.readContentProfile('agent-test', { baseDir: tmpDir });
    expect(saved.voiceDescriptor).not.toBeNull();
    expect(saved.voiceDescriptorVersion).toBe(DESCRIPTOR_SCHEMA_VERSION);
    expect(typeof saved.voiceExtractedAt).toBe('string');
  });

  test('throws ProfileNotFoundError when profile is missing', async () => {
    let err;
    try { await extractVoiceForAgent('agent-missing', { baseDir: tmpDir }); }
    catch (e) { err = e; }
    expect(err).toBeInstanceOf(realProfile.ProfileNotFoundError);
  });

  test('returns already_present without calling callRaw when descriptor exists and version matches', async () => {
    writeRealProfile('agent-test');
    // First extraction
    await extractVoiceForAgent('agent-test', { baseDir: tmpDir });
    claude.callRaw.mockClear();
    // Second call -- should short-circuit
    const result = await extractVoiceForAgent('agent-test', { baseDir: tmpDir });
    expect(result.extracted).toBe(false);
    expect(result.reason).toBe('already_present');
    expect(claude.callRaw.mock.calls.length).toBe(0);
  });

  test('re-extracts when voiceDescriptorVersion mismatches current schema', async () => {
    // selfDescription ensures Tier 2 is triggered so Claude is actually called.
    writeRealProfile('agent-test', { selfDescription: 'I am direct and concise.' });
    // Manually plant a stale descriptor with version 999 (valid positive integer
    // but intentionally not equal to DESCRIPTOR_SCHEMA_VERSION = 1).
    realProfile.updateContentProfile('agent-test', {
      voiceDescriptor:        { version: 999, tier: 'extracted', extractedAt: '2026-01-01T00:00:00Z', modelUsed: 'old', samplesUsedCount: 0, tone: 'x', sentenceRhythm: 'x', signaturePhrases: [], vocabularyNotes: 'x', ctaPattern: 'x', hookPattern: 'x', extractedRefusals: [], rawSummary: 'x' },
      voiceDescriptorVersion: 999,
      voiceDescriptorTier:    'extracted',
      voiceExtractedAt:       '2026-01-01T00:00:00Z',
    }, { baseDir: tmpDir });
    claude.callRaw.mockClear();
    const result = await extractVoiceForAgent('agent-test', { baseDir: tmpDir });
    expect(result.extracted).toBe(true);
    expect(claude.callRaw.mock.calls.length).toBe(1);
    const saved = realProfile.readContentProfile('agent-test', { baseDir: tmpDir });
    expect(saved.voiceDescriptorVersion).toBe(DESCRIPTOR_SCHEMA_VERSION);
  });

  test('opts.force === true re-extracts even when descriptor present with matching version', async () => {
    // Use a profile with selfDescription so extractVoice hits Tier 2 and calls Claude.
    writeRealProfile('agent-test', { selfDescription: 'I am direct and concise.' });
    await extractVoiceForAgent('agent-test', { baseDir: tmpDir });
    claude.callRaw.mockClear();
    const result = await extractVoiceForAgent('agent-test', { force: true, baseDir: tmpDir });
    expect(result.extracted).toBe(true);
    expect(claude.callRaw.mock.calls.length).toBe(1);
  });

  test('VoiceExtractionError propagates; profile.voiceDescriptor stays null on disk', async () => {
    // Profile needs selfDescription so extractVoice hits Tier 2 and calls Claude.
    writeRealProfile('agent-test', { selfDescription: 'I write punchy emails.' });
    claude.callRaw.mockResolvedValue('not-json');
    let err;
    try { await extractVoiceForAgent('agent-test', { baseDir: tmpDir }); }
    catch (e) { err = e; }
    expect(err).toBeInstanceOf(VoiceExtractionError);
    const saved = realProfile.readContentProfile('agent-test', { baseDir: tmpDir });
    expect(saved.voiceDescriptor).toBeNull();
  });

  test('Tier 3 path: empty samples and selfDescription writes default descriptor; subsequent call returns already_present', async () => {
    writeRealProfile('agent-test', { voiceSamples: [], selfDescription: '' });
    // Tier 3 -- no claude call
    const first = await extractVoiceForAgent('agent-test', { baseDir: tmpDir });
    expect(first.extracted).toBe(true);
    expect(first.tier).toBe('default');
    expect(claude.callRaw.mock.calls.length).toBe(0);

    const saved = realProfile.readContentProfile('agent-test', { baseDir: tmpDir });
    expect(saved.voiceDescriptor).not.toBeNull();
    expect(saved.voiceDescriptor.tier).toBe('default');

    // Second call -- already present
    claude.callRaw.mockClear();
    const second = await extractVoiceForAgent('agent-test', { baseDir: tmpDir });
    expect(second.extracted).toBe(false);
    expect(second.reason).toBe('already_present');
    expect(claude.callRaw.mock.calls.length).toBe(0);
  });
});
