'use strict';

const { runEnrich, formatReport } = require('../scripts/enrich-leads');

function agentConfig() {
  return { agentId: 'test-agent', googleSheetId: 'sheet-123' };
}

function enrichResult(overrides = {}) {
  return {
    processed: 2,
    enriched: 1,
    failed: 0,
    skipped: 3,
    rows: [
      { email: 'a@x.com', status: 'enriched', note: '' },
      { email: 'b@x.com', status: 'no-history', note: 'no history found in Gmail' },
    ],
    counts: { enriched: 1, noHistory: 1, failed: 0 },
    ...overrides,
  };
}

describe('runEnrich', () => {
  test('happy path: loads agent, calls enrichLeads with limit, returns agentConfig and result', async () => {
    const loadAgent = jest.fn().mockReturnValue(agentConfig());
    const result = enrichResult();
    const enrichLeads = jest.fn().mockResolvedValue(result);

    const out = await runEnrich('test-agent', { loadAgent, enrichLeads, limit: 5 });

    expect(loadAgent).toHaveBeenCalledWith('test-agent');
    expect(enrichLeads).toHaveBeenCalledWith(agentConfig(), { limit: 5 });
    expect(out).toEqual({ agentConfig: agentConfig(), result });
  });

  test('agent not found: loadAgent throws, enrichLeads never called', async () => {
    const loadAgent = jest.fn().mockImplementation(() => {
      throw new Error("Agent config not found: ghost-agent (looked for /agents/ghost-agent.json)");
    });
    const enrichLeads = jest.fn();

    await expect(runEnrich('ghost-agent', { loadAgent, enrichLeads })).rejects.toThrow('ghost-agent');
    expect(enrichLeads).not.toHaveBeenCalled();
  });

  test('enrichLeads error (e.g. missing googleSheetId) propagates unchanged', async () => {
    const loadAgent = jest.fn().mockReturnValue({ agentId: 'no-sheet-agent' });
    const enrichLeads = jest.fn().mockRejectedValue(
      new Error('Cannot enrich leads for agent "no-sheet-agent": onboarding did not complete Sheet creation (googleSheetId missing).')
    );

    await expect(runEnrich('no-sheet-agent', { loadAgent, enrichLeads })).rejects.toThrow(
      'onboarding did not complete Sheet creation'
    );
  });
});

describe('formatReport', () => {
  test('includes processed/enriched/no-history/failed counts and the closing reminder', () => {
    const report = formatReport(enrichResult());

    expect(report).toContain('Processed: 2');
    expect(report).toContain('Enriched: 1');
    expect(report).toContain('No-history: 1');
    expect(report).toContain('Failed: 0');
    expect(report).toContain('rows remain inert');
    expect(report).toContain('Column T (leadCategory) was NOT written');
  });

  test('lists each non-enriched lead with email, status, and note', () => {
    const report = formatReport(enrichResult());

    expect(report).toContain('b@x.com: no-history (no history found in Gmail)');
    expect(report).not.toContain('a@x.com: enriched');
  });

  test('CLI report lists PROPOSED SOI leads explicitly with their reason', () => {
    const result = enrichResult({
      rows: [
        { email: 'a@x.com', status: 'enriched', note: '' },
        {
          email: 'soi@x.com',
          status: 'enriched',
          note: 'PROPOSED SOI: Lead said "we closed on the house."',
        },
      ],
      counts: { enriched: 2, noHistory: 0, failed: 0 },
    });

    const report = formatReport(result);

    expect(report).toContain('PROPOSED SOI (operator decision required):');
    expect(report).toContain('soi@x.com: PROPOSED SOI: Lead said "we closed on the house."');
  });

  test('no SOI leads -> says so explicitly', () => {
    const report = formatReport(enrichResult());
    expect(report).toContain('No leads were proposed for SOI.');
  });
});
