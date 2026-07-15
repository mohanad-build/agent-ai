'use strict';

const { enrichLeads } = require('../src/leadEnrich');

const agentConfig = { agentId: 'test-agent', googleSheetId: 'sheet-123' };

function sheetRow({ rowIndex, leadId, source = 'import', aiEnabled = 'FALSE' }) {
  return { rowIndex, leadId, source, aiEnabled };
}

function foundScanResult(overrides = {}) {
  return {
    found: true,
    note: '',
    email: overrides.email || 'lead@example.com',
    messages: [{ id: 'm1', internalDate: 1000 }],
    ...overrides,
  };
}

function notFoundScanResult(overrides = {}) {
  return {
    found: false,
    note: 'no history found in Gmail',
    email: overrides.email || 'lead@example.com',
    messages: [],
    ...overrides,
  };
}

function summary(overrides = {}) {
  return {
    summary: 'Distilled summary text.',
    inferredStatus: 'warm',
    lastContactDate: '2026-06-01',
    proposedSoi: false,
    soiReason: '',
    tiered: false,
    threadCount: 1,
    messageCount: 1,
    ...overrides,
  };
}

function mockDeps({ rows = [], scanImpl, summarizeImpl } = {}) {
  const readSheetRows = jest.fn().mockResolvedValue(rows);
  const updateSheetRow = jest.fn().mockResolvedValue(undefined);
  const appendToConversationHistory = jest.fn().mockResolvedValue(undefined);
  return {
    email: { readSheetRows, updateSheetRow, appendToConversationHistory },
    claude: {},
    scanLeadHistory: jest.fn(scanImpl || (async () => foundScanResult())),
    summarizeLeadHistory: jest.fn(summarizeImpl || (async () => summary())),
  };
}

function callEnrich(agentCfg, deps, extraOpts = {}) {
  return enrichLeads(agentCfg, {
    email: deps.email,
    claude: deps.claude,
    scanLeadHistory: deps.scanLeadHistory,
    summarizeLeadHistory: deps.summarizeLeadHistory,
    ...extraOpts,
  });
}

describe('enrichLeads', () => {
  test('missing googleSheetId -> throws, readSheetRows NEVER called', async () => {
    const deps = mockDeps();
    const badConfig = { agentId: 'no-sheet-agent' };

    await expect(callEnrich(badConfig, deps)).rejects.toThrow(/no-sheet-agent/);
    expect(deps.email.readSheetRows).not.toHaveBeenCalled();
  });

  test('only source==="import" AND aiEnabled==="FALSE" rows selected; live and non-import rows skipped, updateSheetRow never called for them', async () => {
    const liveRow = sheetRow({ rowIndex: 2, leadId: 'live@x.com', source: 'import', aiEnabled: 'TRUE' });
    const nonImportRow = sheetRow({ rowIndex: 3, leadId: 'inbox@x.com', source: 'inbox', aiEnabled: 'FALSE' });
    const eligibleRow = sheetRow({ rowIndex: 4, leadId: 'eligible@x.com' });

    const deps = mockDeps({ rows: [liveRow, nonImportRow, eligibleRow] });

    const result = await callEnrich(agentConfig, deps);

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(2);
    expect(deps.email.updateSheetRow).toHaveBeenCalledTimes(1);
    expect(deps.email.updateSheetRow).toHaveBeenCalledWith(agentConfig, 4, expect.any(Object));
  });

  test('happy path: updateSheetRow called with dateAdded + status only, no leadCategory, no aiEnabled', async () => {
    const row = sheetRow({ rowIndex: 5, leadId: 'a@x.com' });
    const deps = mockDeps({
      rows: [row],
      summarizeImpl: async () => summary({ lastContactDate: '2026-05-20', inferredStatus: 'HOT' }),
    });

    await callEnrich(agentConfig, deps);

    expect(deps.email.updateSheetRow).toHaveBeenCalledTimes(1);
    const updates = deps.email.updateSheetRow.mock.calls[0][2];
    expect(updates).toEqual({ dateAdded: '2026-05-20', status: 'HOT' });
    expect(updates).not.toHaveProperty('leadCategory');
    expect(updates).not.toHaveProperty('aiEnabled');
  });

  test('appendToConversationHistory called, not an L overwrite (via the append-style function)', async () => {
    const row = sheetRow({ rowIndex: 6, leadId: 'a@x.com' });
    const deps = mockDeps({
      rows: [row],
      summarizeImpl: async () => summary({ summary: 'Evidence-based summary.' }),
    });

    await callEnrich(agentConfig, deps);

    expect(deps.email.appendToConversationHistory).toHaveBeenCalledTimes(1);
    expect(deps.email.appendToConversationHistory).toHaveBeenCalledWith(agentConfig, 6, 'Evidence-based summary.');
  });

  test('proposedSoi true -> the L text contains PROPOSED SOI: and the reason', async () => {
    const row = sheetRow({ rowIndex: 7, leadId: 'a@x.com' });
    const deps = mockDeps({
      rows: [row],
      summarizeImpl: async () =>
        summary({ proposedSoi: true, soiReason: 'Lead said "we closed on the house."', summary: 'Full summary text.' }),
    });

    const result = await callEnrich(agentConfig, deps);

    const historyText = deps.email.appendToConversationHistory.mock.calls[0][2];
    expect(historyText).toContain('PROPOSED SOI:');
    expect(historyText).toContain('Lead said "we closed on the house."');
    expect(result.rows[0].note).toContain('PROPOSED SOI:');
  });

  test('one lead throws -> recorded as error, the NEXT lead still processed', async () => {
    const rowA = sheetRow({ rowIndex: 8, leadId: 'fail@x.com' });
    const rowB = sheetRow({ rowIndex: 9, leadId: 'ok@x.com' });
    const deps = mockDeps({
      rows: [rowA, rowB],
      scanImpl: async (config, leadEmail) => {
        if (leadEmail === 'fail@x.com') throw new Error('gmail scan blew up');
        return foundScanResult();
      },
    });

    const result = await callEnrich(agentConfig, deps);

    expect(result.rows[0]).toEqual({ email: 'fail@x.com', status: 'error', note: 'gmail scan blew up' });
    expect(deps.email.updateSheetRow).toHaveBeenCalledTimes(1);
    expect(deps.email.updateSheetRow).toHaveBeenCalledWith(agentConfig, 9, expect.any(Object));
    expect(result.counts.failed).toBe(1);
    expect(result.counts.enriched).toBe(1);
  });

  test('found:false lead -> still written, counted as no-history', async () => {
    const row = sheetRow({ rowIndex: 10, leadId: 'nohistory@x.com' });
    const deps = mockDeps({
      rows: [row],
      scanImpl: async () => notFoundScanResult(),
      summarizeImpl: async () =>
        summary({ inferredStatus: 'needs_review', lastContactDate: '', summary: 'no history found in Gmail' }),
    });

    const result = await callEnrich(agentConfig, deps);

    expect(deps.email.updateSheetRow).toHaveBeenCalledTimes(1);
    expect(deps.email.appendToConversationHistory).toHaveBeenCalledTimes(1);
    expect(result.rows[0].status).toBe('no-history');
    expect(result.counts.noHistory).toBe(1);
  });

  test('opts.limit respected', async () => {
    const rows = [
      sheetRow({ rowIndex: 2, leadId: 'a@x.com' }),
      sheetRow({ rowIndex: 3, leadId: 'b@x.com' }),
      sheetRow({ rowIndex: 4, leadId: 'c@x.com' }),
    ];
    const deps = mockDeps({ rows });

    const result = await callEnrich(agentConfig, deps, { limit: 2 });

    expect(result.processed).toBe(2);
    expect(deps.email.updateSheetRow).toHaveBeenCalledTimes(2);
  });

  test('counts reconcile to processed', async () => {
    const rows = [
      sheetRow({ rowIndex: 2, leadId: 'ok@x.com' }),
      sheetRow({ rowIndex: 3, leadId: 'nohist@x.com' }),
      sheetRow({ rowIndex: 4, leadId: 'fail@x.com' }),
    ];
    const deps = mockDeps({
      rows,
      scanImpl: async (config, leadEmail) => {
        if (leadEmail === 'nohist@x.com') return notFoundScanResult();
        if (leadEmail === 'fail@x.com') throw new Error('boom');
        return foundScanResult();
      },
    });

    const result = await callEnrich(agentConfig, deps);

    const countSum = result.counts.enriched + result.counts.noHistory + result.counts.failed;
    expect(countSum).toBe(result.processed);
  });
});
