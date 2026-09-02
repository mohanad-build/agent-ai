'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { _internal } = require('../src/digest');
const { discoverAgentConfigs, DIGEST_AGENT_ID_REGEX } = _internal;

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-discoverAgentConfigs-'));
  process.env.STORAGE_ROOT = tmpDir;
});

afterEach(() => {
  delete process.env.STORAGE_ROOT;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeAgentFile(name, cfg) {
  fs.writeFileSync(path.join(tmpDir, name), JSON.stringify(cfg));
}

describe('discoverAgentConfigs', () => {
  test('discovers a normal active agent file', () => {
    writeAgentFile('agent-a.json', { agentId: 'agent-a', isActive: true });

    const { allAgentIds, activeAgents } = discoverAgentConfigs('test-operator');

    expect(allAgentIds).toEqual(['agent-a']);
    expect(activeAgents).toHaveLength(1);
    expect(activeAgents[0].agentId).toBe('agent-a');
  });

  // This is the important assertion: this commit stops NEW orphans (the
  // temp filenames are fixed), but orphans from before this commit can
  // already be sitting on disk, and this filter -- not the writers -- is
  // what has to keep rejecting them.
  test('rejects an orphaned <agentId>.json.tmp (the shape this commit\'s writers now produce on a crash)', () => {
    writeAgentFile('agent-a.json', { agentId: 'agent-a', isActive: true, googleRefreshToken: 'enc:v1:deadbeef' });
    writeAgentFile('agent-a.json.tmp', { agentId: 'agent-a', isActive: true, googleRefreshToken: 'enc:v1:deadbeef' });

    const { allAgentIds, activeAgents } = discoverAgentConfigs('test-operator');

    expect(allAgentIds).toEqual(['agent-a']);
    expect(activeAgents).toHaveLength(1);
  });

  test('rejects a legacy orphaned <agentId>.tmp.json (the shape the writers produced before this commit)', () => {
    writeAgentFile('agent-a.json', { agentId: 'agent-a', isActive: true, googleRefreshToken: 'enc:v1:deadbeef' });
    writeAgentFile('agent-a.tmp.json', { agentId: 'agent-a', isActive: true, googleRefreshToken: 'enc:v1:deadbeef' });

    const { allAgentIds, activeAgents } = discoverAgentConfigs('test-operator');

    expect(allAgentIds).toEqual(['agent-a']);
    expect(activeAgents).toHaveLength(1);
  });

  test('rejects per-agent companion files (.state.json, .contentProfile.json, .contentState.json)', () => {
    writeAgentFile('agent-a.json', { agentId: 'agent-a', isActive: true });
    writeAgentFile('agent-a.state.json', { lastTokenIssued: 3 });
    writeAgentFile('agent-a.contentProfile.json', { agentId: 'agent-a' });
    writeAgentFile('agent-a.contentState.json', { agentId: 'agent-a' });

    const { allAgentIds, activeAgents } = discoverAgentConfigs('test-operator');

    expect(allAgentIds).toEqual(['agent-a']);
    expect(activeAgents).toHaveLength(1);
  });

  test('DIGEST_AGENT_ID_REGEX rejects both temp-file shapes directly', () => {
    expect(DIGEST_AGENT_ID_REGEX.test('agent-a.json.tmp')).toBe(false);
    expect(DIGEST_AGENT_ID_REGEX.test('agent-a.tmp.json')).toBe(false);
    expect(DIGEST_AGENT_ID_REGEX.test('agent-a.json')).toBe(true);
  });
});
