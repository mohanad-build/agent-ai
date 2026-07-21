'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const {
  parseListField,
  provisionContentEngine,
  saveContentEngineConfig,
} = require('../src/routes/dashboard');

const {
  readContentProfile,
  writeContentProfile,
} = require('../src/content/profile');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-ce-test-'));
}

function makeProfile(overrides = {}) {
  return {
    agentId:                'test-agent',
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

describe('parseListField', () => {
  it('splits on newlines and drops empties', () => {
    expect(parseListField('spam\n\nhustle\n')).toEqual(['spam', 'hustle']);
  });

  it('splits on commas', () => {
    expect(parseListField('spam, hustle,crushing it')).toEqual(['spam', 'hustle', 'crushing it']);
  });

  it('handles mixed newline and comma separation', () => {
    expect(parseListField('spam,hustle\ncrushing it, dont miss out')).toEqual(['spam', 'hustle', 'crushing it', 'dont miss out']);
  });

  it('trims whitespace around items', () => {
    expect(parseListField('  spam  ,  hustle  ')).toEqual(['spam', 'hustle']);
  });

  it('returns an empty array for empty or missing input', () => {
    expect(parseListField('')).toEqual([]);
    expect(parseListField(undefined)).toEqual([]);
    expect(parseListField(null)).toEqual([]);
  });
});

describe('provisionContentEngine', () => {
  let baseDir;

  beforeEach(() => {
    baseDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it('writes an enabled, live profile from null via the tier-3 default descriptor, with no API call', async () => {
    expect(readContentProfile('test-agent', { baseDir })).toBeNull();

    const result = await provisionContentEngine('test-agent', { baseDir });

    expect(result).toEqual({ ok: true });
    const saved = readContentProfile('test-agent', { baseDir });
    expect(saved).not.toBeNull();
    expect(saved.contentEngineEnabled).toBe(true);
    expect(saved.contentEngineMode).toBe('live');
    expect(saved.voiceDescriptorTier).toBe('default');
    expect(typeof saved.voiceDescriptor).toBe('string');
    expect(saved.voiceExtractedAt).not.toBeNull();
  });

  it('refuses to overwrite an existing profile, leaving its config untouched', async () => {
    writeContentProfile('test-agent', makeProfile({
      contentEngineEnabled: true,
      primaryFocus: 'sellers',
      contentVolume: 'balanced',
    }), { baseDir });

    const result = await provisionContentEngine('test-agent', { baseDir });

    expect(result).toEqual({ ok: false, reason: 'already_provisioned' });
    const saved = readContentProfile('test-agent', { baseDir });
    expect(saved.primaryFocus).toBe('sellers');
    expect(saved.contentVolume).toBe('balanced');
  });
});

describe('saveContentEngineConfig', () => {
  let baseDir;

  beforeEach(() => {
    baseDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it('redirects with not_provisioned when no profile exists', () => {
    const result = saveContentEngineConfig('ghost-agent', {
      contentEngineEnabled: 'true',
      primaryFocus: 'buyers',
      contentVolume: 'max',
      forbiddenTerms: '',
      forbiddenTopics: '',
    }, { baseDir });

    expect(result).toEqual({ ok: false, reason: 'not_provisioned' });
  });

  it('writes the cheap fields and reconciles the enabled flag from false to true', () => {
    writeContentProfile('test-agent', makeProfile({ contentEngineEnabled: false }), { baseDir });

    const result = saveContentEngineConfig('test-agent', {
      contentEngineEnabled: 'true',
      primaryFocus: 'sellers',
      contentVolume: 'balanced',
      forbiddenTerms: 'spam\nhustle',
      forbiddenTopics: 'politics, religion',
    }, { baseDir });

    expect(result).toEqual({ ok: true });

    const saved = readContentProfile('test-agent', { baseDir });
    expect(saved.contentEngineEnabled).toBe(true);
    expect(saved.primaryFocus).toBe('sellers');
    expect(saved.contentVolume).toBe('balanced');
    expect(saved.forbiddenTerms).toEqual(['spam', 'hustle']);
    expect(saved.forbiddenTopics).toEqual(['politics', 'religion']);
  });

  it('reconciles the enabled flag from true to false', () => {
    writeContentProfile('test-agent', makeProfile({ contentEngineEnabled: true }), { baseDir });

    const result = saveContentEngineConfig('test-agent', {
      contentEngineEnabled: 'false',
      primaryFocus: 'both',
      contentVolume: 'max',
      forbiddenTerms: '',
      forbiddenTopics: '',
    }, { baseDir });

    expect(result).toEqual({ ok: true });
    const saved = readContentProfile('test-agent', { baseDir });
    expect(saved.contentEngineEnabled).toBe(false);
  });

  it('returns invalid on SchemaValidationError instead of throwing', () => {
    writeContentProfile('test-agent', makeProfile({ contentEngineEnabled: true }), { baseDir });

    const result = saveContentEngineConfig('test-agent', {
      contentEngineEnabled: 'true',
      primaryFocus: 'not-a-real-focus',
      contentVolume: 'max',
      forbiddenTerms: '',
      forbiddenTopics: '',
    }, { baseDir });

    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });
});
