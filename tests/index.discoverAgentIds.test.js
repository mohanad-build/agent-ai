'use strict';

jest.mock('fs');

// Must be required AFTER jest.mock('fs') so src/index uses the same mock instance.
const fs = require('fs');
const { discoverAgentIds, AGENT_ID_REGEX } = require('../src/index');

beforeEach(() => {
  jest.resetAllMocks();
  delete process.env.AGENT_ID;
  fs.existsSync.mockReturnValue(true);
  fs.readdirSync.mockReturnValue([]);
});

afterEach(() => {
  delete process.env.AGENT_ID;
});

function setAgentFiles(files) {
  fs.readdirSync.mockReturnValue(files);
}

// --------------------------------------------------------------------------
// AGENT_ID_REGEX contract
// --------------------------------------------------------------------------

describe('AGENT_ID_REGEX', () => {
  test('matches simple lowercase agent id', () => {
    expect(AGENT_ID_REGEX.test('mo-test.json')).toBe(true);
  });

  test('matches single-word agent id', () => {
    expect(AGENT_ID_REGEX.test('assistant.json')).toBe(true);
  });

  test('matches numeric-containing id', () => {
    expect(AGENT_ID_REGEX.test('agent-42.json')).toBe(true);
  });

  test('rejects state file (extra dot)', () => {
    expect(AGENT_ID_REGEX.test('mo-test.state.json')).toBe(false);
  });

  test('rejects content profile file', () => {
    expect(AGENT_ID_REGEX.test('mo-test.contentProfile.json')).toBe(false);
  });

  test('rejects content state file', () => {
    expect(AGENT_ID_REGEX.test('mo-test.contentState.json')).toBe(false);
  });

  test('rejects uppercase letters', () => {
    expect(AGENT_ID_REGEX.test('Mo-Test.json')).toBe(false);
  });

  test('rejects underscore', () => {
    expect(AGENT_ID_REGEX.test('mo_test.json')).toBe(false);
  });

  test('rejects tmp variant (no .json at end)', () => {
    expect(AGENT_ID_REGEX.test('mo-test.json.tmp')).toBe(false);
  });
});

// --------------------------------------------------------------------------
// discoverAgentIds integration
// --------------------------------------------------------------------------

describe('discoverAgentIds', () => {
  test('returns only files matching regex, blocklist excluded', () => {
    setAgentFiles([
      'mo-test.json',
      'mo-test.state.json',
      'mo-test.contentProfile.json',
      'mo-test.contentState.json',
      'Mo-Test.json',
      'mo_test.json',
      'mo-test.json.tmp',
      'example.json',        // regex matches but blocked by AGENT_FILE_BLOCKLIST
      'assistant.json',
    ]);
    const ids = discoverAgentIds();
    expect(ids).toEqual(['assistant', 'mo-test']); // sorted, blocklisted excluded
  });

  test('example.json is excluded by AGENT_FILE_BLOCKLIST even though regex matches', () => {
    setAgentFiles(['example.json', 'mo-test.json']);
    const ids = discoverAgentIds();
    expect(ids).not.toContain('example');
    expect(ids).toContain('mo-test');
  });

  test('process.env.AGENT_ID short-circuit returns single element', () => {
    process.env.AGENT_ID = 'my-agent';
    setAgentFiles(['mo-test.json', 'assistant.json']);
    const ids = discoverAgentIds();
    expect(ids).toEqual(['my-agent']);
  });

  test('returns empty array when agents dir does not exist', () => {
    fs.existsSync.mockReturnValue(false);
    const ids = discoverAgentIds();
    expect(ids).toEqual([]);
  });

  test('returns sorted list', () => {
    setAgentFiles(['zebra.json', 'alpha.json', 'mo-test.json']);
    const ids = discoverAgentIds();
    expect(ids).toEqual(['alpha', 'mo-test', 'zebra']);
  });
});
