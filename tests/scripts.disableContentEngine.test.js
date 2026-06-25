'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

jest.mock('../src/agentConfig', () => ({
  loadAgent: jest.fn(),
}));

const { loadAgent } = require('../src/agentConfig');
const { disableContentEngine } = require('../scripts/disable-content-engine');
const {
  readContentProfile,
  writeContentProfile,
} = require('../src/content/profile');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'disable-ce-test-'));
}

function makeProfile(overrides = {}) {
  return {
    agentId:                'test-agent',
    contentEngineEnabled:   true,
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

describe('disableContentEngine', () => {
  let baseDir;

  beforeEach(() => {
    baseDir = makeTmpDir();
    loadAgent.mockReturnValue({ agentId: 'test-agent' });
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
    jest.resetAllMocks();
  });

  test('propagates error when loadAgent throws', async () => {
    loadAgent.mockImplementation(() => {
      throw new Error('Agent config not found: unknown-agent');
    });
    await expect(disableContentEngine('unknown-agent', { baseDir })).rejects.toThrow('Agent config not found');
  });

  test('throws when profile is null', async () => {
    await expect(disableContentEngine('test-agent', { baseDir })).rejects.toThrow(
      'Agent has no Content Engine profile. Nothing to disable.'
    );
  });

  test('returns noop-already-disabled when profile exists and is already disabled', async () => {
    writeContentProfile('test-agent', makeProfile({ contentEngineEnabled: false }), { baseDir });
    const result = await disableContentEngine('test-agent', { baseDir });
    expect(result).toEqual({ action: 'noop-already-disabled', enabled: false });
  });

  test('returns disabled and flips flag when profile exists and is enabled', async () => {
    writeContentProfile('test-agent', makeProfile({ contentEngineEnabled: true }), { baseDir });
    const result = await disableContentEngine('test-agent', { baseDir });
    expect(result).toEqual({ action: 'disabled', enabled: false });
    const saved = readContentProfile('test-agent', { baseDir });
    expect(saved.contentEngineEnabled).toBe(false);
  });

  test('preserves all other profile fields when disabling', async () => {
    writeContentProfile('test-agent', makeProfile({
      contentEngineEnabled: true,
      voiceDescriptor:      'Warm and approachable',
      forbiddenTerms:       ['cheap'],
      forbiddenTopics:      ['Foreclosures'],
      primaryFocus:         'sellers',
      contentVolume:        'minimum',
    }), { baseDir });
    await disableContentEngine('test-agent', { baseDir });
    const saved = readContentProfile('test-agent', { baseDir });
    expect(saved.contentEngineEnabled).toBe(false);
    expect(saved.voiceDescriptor).toBe('Warm and approachable');
    expect(saved.forbiddenTerms).toEqual(['cheap']);
    expect(saved.forbiddenTopics).toEqual(['Foreclosures']);
    expect(saved.primaryFocus).toBe('sellers');
    expect(saved.contentVolume).toBe('minimum');
  });
});
