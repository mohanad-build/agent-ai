'use strict';

// CASA 6.7.1: getOAuthClient (src/gmail.js) is the only decryptToken call
// site in the codebase. This proves it logs an audit line naming the
// agentId, and, separately and more importantly, that the decrypted
// secret itself never appears in any console output during the call.

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
      })),
    },
  },
}));

const { getOAuthClient } = require('../src/gmail');

const SECRET_REFRESH_TOKEN = 'super-secret-refresh-token-value-should-never-be-logged';

describe('secrets access audit logging', () => {
  let logSpy;
  let errorSpy;
  let warnSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('emits a [secrets-audit] line naming the agentId when a secret is decrypted', () => {
    getOAuthClient({ agentId: 'agent-secrets-audit-1', googleRefreshToken: SECRET_REFRESH_TOKEN });

    const lines = logSpy.mock.calls.map((args) => args.join(' '));
    const auditLine = lines.find((line) => line.includes('[secrets-audit]') && line.includes('decryptToken'));
    expect(auditLine).toBeDefined();
    expect(auditLine).toContain('agentId=agent-secrets-audit-1');
  });

  it('never prints the decrypted secret value in any console output', () => {
    getOAuthClient({ agentId: 'agent-secrets-audit-2', googleRefreshToken: SECRET_REFRESH_TOKEN });

    const allOutput = [...logSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls]
      .map((args) => args.join(' '))
      .join('\n');
    expect(allOutput).not.toContain(SECRET_REFRESH_TOKEN);
  });
});
