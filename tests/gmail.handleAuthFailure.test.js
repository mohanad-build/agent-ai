'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { getOAuthClient, handleAuthFailure, AuthFailureError } = require('../src/gmail');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-handleAuthFailure-'));
  process.env.STORAGE_ROOT = tmpDir;
});

afterEach(() => {
  delete process.env.STORAGE_ROOT;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(agentId, cfg) {
  fs.writeFileSync(path.join(tmpDir, `${agentId}.json`), JSON.stringify(cfg));
}

function readConfig(agentId) {
  return JSON.parse(fs.readFileSync(path.join(tmpDir, `${agentId}.json`), 'utf8'));
}

describe('handleAuthFailure', () => {
  test('throws AuthFailureError, flips isActive to false, and preserves googleRefreshToken', () => {
    writeConfig('agent-a', {
      agentId: 'agent-a',
      isActive: true,
      googleRefreshToken: 'enc:v1:deadbeef',
      googleSheetId: 'sheet-123',
    });

    const agentConfig = { agentId: 'agent-a' };
    const originalError = new Error('invalid_grant');

    expect(() => handleAuthFailure(agentConfig, originalError)).toThrow(AuthFailureError);

    const onDisk = readConfig('agent-a');
    expect(onDisk.isActive).toBe(false);
    expect(onDisk.googleRefreshToken).toBe('enc:v1:deadbeef');
    expect(onDisk.googleSheetId).toBe('sheet-123');
  });

  test('writes via a temp file and renames into place, not a direct overwrite', () => {
    writeConfig('agent-a', { agentId: 'agent-a', isActive: true });
    const realPath = path.join(tmpDir, 'agent-a.json');
    const tmpPath = path.join(tmpDir, 'agent-a.json.tmp');

    const writeSpy = jest.spyOn(fs, 'writeFileSync');
    const renameSpy = jest.spyOn(fs, 'renameSync');
    try {
      expect(() => handleAuthFailure({ agentId: 'agent-a' }, new Error('invalid_grant'))).toThrow();

      expect(writeSpy).toHaveBeenCalledWith(tmpPath, expect.any(String), 'utf8');
      expect(writeSpy).not.toHaveBeenCalledWith(realPath, expect.anything(), expect.anything());
      expect(renameSpy).toHaveBeenCalledWith(tmpPath, realPath);
    } finally {
      writeSpy.mockRestore();
      renameSpy.mockRestore();
    }
  });

  test('evicts the OAuth client cache entry for this agent', () => {
    writeConfig('agent-a', { agentId: 'agent-a', isActive: true, googleRefreshToken: 'plaintext-token' });
    const agentConfig = { agentId: 'agent-a', googleRefreshToken: 'plaintext-token' };

    const firstClient = getOAuthClient(agentConfig);
    expect(getOAuthClient(agentConfig)).toBe(firstClient); // cached, same instance

    expect(() => handleAuthFailure(agentConfig, new Error('invalid_grant'))).toThrow(AuthFailureError);

    const secondClient = getOAuthClient(agentConfig);
    expect(secondClient).not.toBe(firstClient); // cache was evicted, a fresh client was built
  });

  test('does not throw if the write fails: still evicts cache and throws AuthFailureError', () => {
    // No config file written for this agentId at all: patchAgent's
    // "not found" error is caught and logged, not allowed to replace the
    // AuthFailureError that must still propagate.
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => handleAuthFailure({ agentId: 'no-such-agent' }, new Error('invalid_grant'))).toThrow(AuthFailureError);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to flip isActive=false for no-such-agent'),
        expect.any(String)
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
