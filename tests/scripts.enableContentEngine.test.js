'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

jest.mock('../src/agentConfig', () => ({
  loadAgent: jest.fn(),
}));

const { loadAgent } = require('../src/agentConfig');
const { enableContentEngine } = require('../scripts/enable-content-engine');
const {
  readContentProfile,
  writeContentProfile,
} = require('../src/content/profile');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'enable-ce-test-'));
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

describe('enableContentEngine', () => {
  let baseDir;

  beforeEach(() => {
    baseDir = makeTmpDir();
    loadAgent.mockReturnValue({ agentId: 'test-agent' });
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
    jest.resetAllMocks();
  });

  test('throws when agentId is missing', async () => {
    await expect(enableContentEngine(null, { baseDir })).rejects.toThrow('agentId is required');
  });

  test('propagates error when loadAgent throws', async () => {
    loadAgent.mockImplementation(() => {
      throw new Error('Agent config not found: unknown-agent');
    });
    await expect(enableContentEngine('unknown-agent', { baseDir })).rejects.toThrow('Agent config not found');
  });

  test('throws when profile is null and opts are missing', async () => {
    await expect(enableContentEngine('test-agent', { baseDir })).rejects.toThrow(
      'Profile does not exist. Provide primaryFocus, contentVolume, contentEngineMode to create.'
    );
  });

  test('creates profile with correct fields when profile is null and all opts present', async () => {
    const result = await enableContentEngine('test-agent', {
      baseDir,
      primaryFocus:      'sellers',
      contentVolume:     'balanced',
      contentEngineMode: 'live',
    });
    expect(result).toEqual({ action: 'created', enabled: true });
    const saved = readContentProfile('test-agent', { baseDir });
    expect(saved.agentId).toBe('test-agent');
    expect(saved.primaryFocus).toBe('sellers');
    expect(saved.contentVolume).toBe('balanced');
    expect(saved.contentEngineMode).toBe('live');
  });

  test('contentEngineEnabled is true in written file when creating new profile', async () => {
    await enableContentEngine('test-agent', {
      baseDir,
      primaryFocus:      'buyers',
      contentVolume:     'max',
      contentEngineMode: 'shadow',
    });
    const saved = readContentProfile('test-agent', { baseDir });
    expect(saved.contentEngineEnabled).toBe(true);
  });

  test('throws on invalid primaryFocus value', async () => {
    await expect(enableContentEngine('test-agent', {
      baseDir,
      primaryFocus:      'everyone',
      contentVolume:     'max',
      contentEngineMode: 'shadow',
    })).rejects.toThrow('primaryFocus must be one of');
  });

  test('returns noop-already-enabled when profile exists and is already enabled', async () => {
    writeContentProfile('test-agent', makeProfile({ contentEngineEnabled: true }), { baseDir });
    const result = await enableContentEngine('test-agent', { baseDir });
    expect(result).toEqual({ action: 'noop-already-enabled', enabled: true });
  });

  test('returns re-enabled and flips flag when profile exists and is disabled', async () => {
    writeContentProfile('test-agent', makeProfile({ contentEngineEnabled: false }), { baseDir });
    const result = await enableContentEngine('test-agent', { baseDir });
    expect(result).toEqual({ action: 're-enabled', enabled: true });
    const saved = readContentProfile('test-agent', { baseDir });
    expect(saved.contentEngineEnabled).toBe(true);
  });

  test('preserves all other profile fields when re-enabling', async () => {
    writeContentProfile('test-agent', makeProfile({
      contentEngineEnabled: false,
      voiceDescriptor:      'Confident and direct',
      forbiddenTerms:       ['spam'],
      forbiddenTopics:      ['Politics'],
      primaryFocus:         'buyers',
      contentVolume:        'balanced',
    }), { baseDir });
    await enableContentEngine('test-agent', { baseDir });
    const saved = readContentProfile('test-agent', { baseDir });
    expect(saved.contentEngineEnabled).toBe(true);
    expect(saved.voiceDescriptor).toBe('Confident and direct');
    expect(saved.forbiddenTerms).toEqual(['spam']);
    expect(saved.forbiddenTopics).toEqual(['Politics']);
    expect(saved.primaryFocus).toBe('buyers');
    expect(saved.contentVolume).toBe('balanced');
  });
});
