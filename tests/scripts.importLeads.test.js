'use strict';

const { runImport, formatReport } = require('../scripts/import-leads');

function agentConfig() {
  return { agentId: 'test-agent', googleSheetId: 'sheet-123' };
}

describe('runImport', () => {
  test('happy path: loads agent, reads file, normalizes, lands, returns all three', async () => {
    const loadAgent = jest.fn().mockReturnValue(agentConfig());
    const readFileSync = jest.fn().mockReturnValue('Name,Email\nJane,jane@example.com');
    const normalized = { rows: [], meta: { mapping: { email: 1, name: 0, phone: null, source: null } } };
    const normalizeLeads = jest.fn().mockResolvedValue(normalized);
    const result = { landed: 1, skipped: 0, rows: [], counts: { ok: 1 } };
    const landLeads = jest.fn().mockResolvedValue(result);

    const out = await runImport('test-agent', '/tmp/leads.csv', {
      loadAgent,
      readFileSync,
      normalizeLeads,
      landLeads,
    });

    expect(loadAgent).toHaveBeenCalledWith('test-agent');
    expect(readFileSync).toHaveBeenCalledWith('/tmp/leads.csv', 'utf8');
    expect(normalizeLeads).toHaveBeenCalledWith('Name,Email\nJane,jane@example.com');
    expect(landLeads).toHaveBeenCalledWith(agentConfig(), normalized);
    expect(out).toEqual({ agentConfig: agentConfig(), normalized, result });
  });

  test('agent not found: loadAgent throws, readFileSync/normalizeLeads/landLeads never called', async () => {
    const loadAgent = jest.fn().mockImplementation(() => {
      throw new Error("Agent config not found: ghost-agent (looked for /agents/ghost-agent.json)");
    });
    const readFileSync = jest.fn();
    const normalizeLeads = jest.fn();
    const landLeads = jest.fn();

    await expect(
      runImport('ghost-agent', '/tmp/leads.csv', { loadAgent, readFileSync, normalizeLeads, landLeads })
    ).rejects.toThrow('ghost-agent');

    expect(readFileSync).not.toHaveBeenCalled();
    expect(normalizeLeads).not.toHaveBeenCalled();
    expect(landLeads).not.toHaveBeenCalled();
  });

  test('unreadable file: readFileSync throws, error message includes path; normalizeLeads/landLeads never called', async () => {
    const loadAgent = jest.fn().mockReturnValue(agentConfig());
    const readFileSync = jest.fn().mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });
    const normalizeLeads = jest.fn();
    const landLeads = jest.fn();

    await expect(
      runImport('test-agent', '/tmp/missing.csv', { loadAgent, readFileSync, normalizeLeads, landLeads })
    ).rejects.toThrow(/\/tmp\/missing\.csv.*ENOENT/);

    expect(normalizeLeads).not.toHaveBeenCalled();
    expect(landLeads).not.toHaveBeenCalled();
  });

  test('landLeads error (e.g. missing googleSheetId) propagates unchanged', async () => {
    const loadAgent = jest.fn().mockReturnValue({ agentId: 'no-sheet-agent' });
    const readFileSync = jest.fn().mockReturnValue('Name,Email\nJane,jane@example.com');
    const normalizeLeads = jest.fn().mockResolvedValue({ rows: [], meta: { mapping: {} } });
    const landLeads = jest.fn().mockRejectedValue(
      new Error('Cannot land leads for agent "no-sheet-agent": onboarding did not complete Sheet creation (googleSheetId missing).')
    );

    await expect(
      runImport('no-sheet-agent', '/tmp/leads.csv', { loadAgent, readFileSync, normalizeLeads, landLeads })
    ).rejects.toThrow('onboarding did not complete Sheet creation');
  });
});

describe('formatReport', () => {
  test('includes mapping, landed count, status breakdown, and the bulk-enable reminder', () => {
    const normalized = { meta: { mapping: { email: 1, name: 0, phone: null, source: null } } };
    const result = {
      landed: 2,
      skipped: 0,
      rows: [
        { rawIndex: 0, email: 'a@x.com', status: 'landed', statusReason: '' },
        { rawIndex: 1, email: 'b@x.com', status: 'landed', statusReason: '' },
      ],
      counts: { ok: 2, skippedNoEmail: 0, skippedUnparseable: 0, skippedDupeInFile: 0, skippedDupeInSheet: 0 },
    };

    const report = formatReport(normalized, result);

    expect(report).toContain('"email": 1');
    expect(report).toContain('Landed: 2');
    expect(report).toContain('ok: 2');
    expect(report).toContain('No rows require manual attention.');
    expect(report).toContain('inert (aiEnabled FALSE) until you bulk-enable them.');
  });

  test('lists each non-landed row with rawIndex, email, status, and reason', () => {
    const normalized = { meta: { mapping: {} } };
    const result = {
      landed: 0,
      skipped: 1,
      rows: [
        { rawIndex: 3, email: 'dupe@x.com', status: 'skip:duplicate-in-sheet', statusReason: 'email already exists in the Sheet' },
      ],
      counts: { ok: 0, skippedNoEmail: 0, skippedUnparseable: 0, skippedDupeInFile: 0, skippedDupeInSheet: 1 },
    };

    const report = formatReport(normalized, result);

    expect(report).toContain('[row 3] dupe@x.com: skip:duplicate-in-sheet (email already exists in the Sheet)');
    expect(report).not.toContain('No rows require manual attention.');
  });

  test('a row with no email displays (none)', () => {
    const normalized = { meta: { mapping: {} } };
    const result = {
      landed: 0,
      skipped: 1,
      rows: [
        { rawIndex: 5, email: '', status: 'skip:no-email', statusReason: 'missing or invalid email' },
      ],
      counts: { ok: 0, skippedNoEmail: 1, skippedUnparseable: 0, skippedDupeInFile: 0, skippedDupeInSheet: 0 },
    };

    const report = formatReport(normalized, result);

    expect(report).toContain('[row 5] (none): skip:no-email (missing or invalid email)');
  });
});
