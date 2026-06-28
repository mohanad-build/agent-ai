'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { discoverAgentIds, AGENT_ID_REGEX } = require('../src/routes/dashboard');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-discover-'));
  process.env.STORAGE_ROOT = tmpDir;
});

afterEach(() => {
  delete process.env.STORAGE_ROOT;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('AGENT_ID_REGEX', () => {
  it('matches plain agent filenames', () => {
    expect(AGENT_ID_REGEX.test('mo-test.json')).toBe(true);
    expect(AGENT_ID_REGEX.test('assistant.json')).toBe(true);
    expect(AGENT_ID_REGEX.test('abc123.json')).toBe(true);
  });

  it('rejects Content Engine satellite files', () => {
    expect(AGENT_ID_REGEX.test('mo-test.contentProfile.json')).toBe(false);
    expect(AGENT_ID_REGEX.test('mo-test.contentState.json')).toBe(false);
  });

  it('rejects state and log files', () => {
    expect(AGENT_ID_REGEX.test('mo-test.state.json')).toBe(false);
    expect(AGENT_ID_REGEX.test('mo-test.digest-errors.log')).toBe(false);
  });
});

describe('discoverAgentIds', () => {
  it('returns only valid agent IDs, sorted, excluding CE satellites', () => {
    fs.writeFileSync(path.join(tmpDir, 'mo-test.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'assistant.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'mo-test.contentProfile.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'mo-test.contentState.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'mo-test.digest-errors.log'), '');

    const result = discoverAgentIds();

    expect(result).toEqual(['assistant', 'mo-test']);
    expect(result.join(',')).not.toMatch(/contentProfile|contentState/);
  });

  it('excludes blocklisted filenames', () => {
    fs.writeFileSync(path.join(tmpDir, 'example.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'real-agent.json'), '{}');

    const result = discoverAgentIds();

    expect(result).toEqual(['real-agent']);
    expect(result).not.toContain('example');
  });

  it('returns empty array when directory does not exist', () => {
    delete process.env.STORAGE_ROOT;
    process.env.STORAGE_ROOT = path.join(tmpDir, 'nonexistent');

    expect(discoverAgentIds()).toEqual([]);
  });

  it('returns empty array when directory is empty', () => {
    expect(discoverAgentIds()).toEqual([]);
  });
});
