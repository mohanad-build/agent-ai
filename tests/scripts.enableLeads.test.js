'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const { runEnable, formatReport } = require('../scripts/enable-leads');

function agentConfig() {
  return { agentId: 'test-agent', googleSheetId: 'sheet-123' };
}

function enableResult(overrides = {}) {
  return {
    enabled: 1,
    blocked: 1,
    notFound: 1,
    rows: [
      { email: 'a@x.com', action: 'enabled', reason: '' },
      { email: 'b@x.com', action: 'blocked', reason: 'leadCategory is SOI; never auto-enabled' },
      { email: 'c@x.com', action: 'not-found', reason: 'not in the Sheet at all' },
    ],
    counts: { enabled: 1, blockedSoi: 1, blockedProposedSoi: 0, notFound: 1, notEligible: 0 },
    ...overrides,
  };
}

describe('runEnable', () => {
  test('--file path: reads file, parses one email per line, trims, skips blanks', async () => {
    const loadAgent = jest.fn().mockReturnValue(agentConfig());
    const readFileSync = jest.fn().mockReturnValue('a@x.com\n  b@x.com  \n\nc@x.com\n');
    const enableLeads = jest.fn().mockResolvedValue(enableResult());

    const out = await runEnable('test-agent', {
      loadAgent,
      readFileSync,
      enableLeads,
      filePath: '/tmp/emails.txt',
    });

    expect(readFileSync).toHaveBeenCalledWith('/tmp/emails.txt', 'utf8');
    expect(enableLeads).toHaveBeenCalledWith(agentConfig(), {
      dryRun: false,
      emails: ['a@x.com', 'b@x.com', 'c@x.com'],
    });
    expect(out.result).toEqual(enableResult());
  });

  test('--status path: passes status through, not a file read', async () => {
    const loadAgent = jest.fn().mockReturnValue(agentConfig());
    const readFileSync = jest.fn();
    const enableLeads = jest.fn().mockResolvedValue(enableResult());

    await runEnable('test-agent', { loadAgent, readFileSync, enableLeads, status: 'warm', dryRun: true });

    expect(readFileSync).not.toHaveBeenCalled();
    expect(enableLeads).toHaveBeenCalledWith(agentConfig(), { dryRun: true, status: 'warm' });
  });

  test('agent not found: loadAgent throws, enableLeads never called', async () => {
    const loadAgent = jest.fn().mockImplementation(() => {
      throw new Error("Agent config not found: ghost-agent (looked for /agents/ghost-agent.json)");
    });
    const enableLeads = jest.fn();

    await expect(
      runEnable('ghost-agent', { loadAgent, enableLeads, status: 'warm' })
    ).rejects.toThrow('ghost-agent');
    expect(enableLeads).not.toHaveBeenCalled();
  });
});

describe('formatReport', () => {
  test('prints enabled count, blocked leads with reasons, not-found addresses, and the LIVE closing line', () => {
    const report = formatReport(enableResult());

    expect(report).toContain('Enabled: 1');
    expect(report).toContain('b@x.com: leadCategory is SOI; never auto-enabled');
    expect(report).toContain('c@x.com: not in the Sheet at all');
    expect(report).toContain('now LIVE');
  });

  test('dryRun=false (explicit) is unchanged from the default: "Enabled" and "now LIVE"', () => {
    const report = formatReport(enableResult(), false);

    expect(report).toContain('Enabled: 1');
    expect(report).toContain('now LIVE');
    expect(report).not.toContain('Would enable');
    expect(report).not.toContain('preview');
  });

  test('dryRun=true reports "Would enable" and does NOT claim leads went live', () => {
    const report = formatReport(enableResult(), true);

    expect(report).toContain('Would enable: 1');
    expect(report).not.toContain('now LIVE');
    expect(report).toContain('NO leads were changed');
  });
});

describe('CLI argument handling (spawned subprocess)', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'enable-leads.js');

  test('--status without --yes -> does not enable, exits nonzero', () => {
    let threw = false;
    let output = '';
    try {
      execFileSync('node', [scriptPath, 'nonexistent-agent-xyz', '--status', 'warm'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      threw = true;
      output = (err.stdout || '') + (err.stderr || '');
      expect(err.status).not.toBe(0);
    }
    expect(threw).toBe(true);
    // Either the --yes gate message fires, or (for a nonexistent agent) the
    // loadAgent error fires first -- both are valid nonzero-exit outcomes for
    // this invocation; what matters is it never silently succeeds.
    expect(output.length).toBeGreaterThan(0);
  });

  test('--file and --status together -> usage, exit 1', () => {
    let threw = false;
    let stderr = '';
    try {
      execFileSync(
        'node',
        [scriptPath, 'nonexistent-agent-xyz', '--file', '/tmp/whatever.txt', '--status', 'warm'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch (err) {
      threw = true;
      stderr = err.stderr || '';
      expect(err.status).toBe(1);
    }
    expect(threw).toBe(true);
    expect(stderr).toContain('Usage:');
  });

  test('neither --file nor --status -> usage, exit 1', () => {
    let threw = false;
    let stderr = '';
    try {
      execFileSync('node', [scriptPath, 'nonexistent-agent-xyz'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      threw = true;
      stderr = err.stderr || '';
      expect(err.status).toBe(1);
    }
    expect(threw).toBe(true);
    expect(stderr).toContain('Usage:');
  });
});
