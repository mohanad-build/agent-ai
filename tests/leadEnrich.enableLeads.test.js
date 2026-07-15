'use strict';

const { enableLeads } = require('../src/leadEnrich');
const { findRowByEmail } = require('../src/gmail');

const agentConfig = { agentId: 'test-agent', googleSheetId: 'sheet-123' };

function sheetRow({
  rowIndex,
  leadId,
  source = 'import',
  aiEnabled = 'FALSE',
  status = 'needs_review',
  leadCategory = '',
  conversationHistory = '',
}) {
  return { rowIndex, leadId, source, aiEnabled, status, leadCategory, conversationHistory };
}

function mockEmail({ rows = [] } = {}) {
  return {
    readSheetRows: jest.fn().mockResolvedValue(rows),
    updateSheetRow: jest.fn().mockResolvedValue(undefined),
    findRowByEmail,
  };
}

describe('enableLeads', () => {
  test('missing googleSheetId -> throws, readSheetRows NEVER called', async () => {
    const email = mockEmail();
    const badConfig = { agentId: 'no-sheet-agent' };

    await expect(enableLeads(badConfig, { email, emails: ['a@x.com'] })).rejects.toThrow(/no-sheet-agent/);
    expect(email.readSheetRows).not.toHaveBeenCalled();
  });

  test('both selectors -> throws', async () => {
    const email = mockEmail({ rows: [sheetRow({ rowIndex: 2, leadId: 'a@x.com' })] });
    await expect(
      enableLeads(agentConfig, { email, emails: ['a@x.com'], status: 'warm' })
    ).rejects.toThrow(/EXACTLY ONE selector/);
  });

  test('neither selector -> throws', async () => {
    const email = mockEmail({ rows: [sheetRow({ rowIndex: 2, leadId: 'a@x.com' })] });
    await expect(enableLeads(agentConfig, { email })).rejects.toThrow(/EXACTLY ONE selector/);
  });

  test('emails path: only listed addresses enabled; an unlisted pool row is NOT written', async () => {
    const listed = sheetRow({ rowIndex: 2, leadId: 'listed@x.com' });
    const unlisted = sheetRow({ rowIndex: 3, leadId: 'unlisted@x.com' });
    const email = mockEmail({ rows: [listed, unlisted] });

    const result = await enableLeads(agentConfig, { email, emails: ['listed@x.com'] });

    expect(result.enabled).toBe(1);
    expect(email.updateSheetRow).toHaveBeenCalledTimes(1);
    expect(email.updateSheetRow).toHaveBeenCalledWith(agentConfig, 2, { aiEnabled: 'TRUE' });
  });

  test('a live row (aiEnabled TRUE) named explicitly by email -> notFound with "not an inert import row" reason, updateSheetRow never called', async () => {
    const liveRow = sheetRow({ rowIndex: 4, leadId: 'live@x.com', aiEnabled: 'TRUE' });
    const email = mockEmail({ rows: [liveRow] });

    const result = await enableLeads(agentConfig, { email, emails: ['live@x.com'] });

    expect(result.notFound).toBe(1);
    expect(result.rows[0]).toMatchObject({
      email: 'live@x.com',
      action: 'not-found',
      reason: expect.stringContaining('not an inert import row'),
    });
    expect(email.updateSheetRow).not.toHaveBeenCalled();
  });

  test('status path: only rows with the exact matching status enabled', async () => {
    const warmRow = sheetRow({ rowIndex: 5, leadId: 'warm@x.com', status: 'warm' });
    const coldRow = sheetRow({ rowIndex: 6, leadId: 'cold@x.com', status: 'cold' });
    const email = mockEmail({ rows: [warmRow, coldRow] });

    const result = await enableLeads(agentConfig, { email, status: 'warm' });

    expect(result.enabled).toBe(1);
    expect(email.updateSheetRow).toHaveBeenCalledTimes(1);
    expect(email.updateSheetRow).toHaveBeenCalledWith(agentConfig, 5, { aiEnabled: 'TRUE' });
  });

  test("leadCategory 'soi' named explicitly by email -> BLOCKED, updateSheetRow never called", async () => {
    const soiRow = sheetRow({ rowIndex: 7, leadId: 'soi@x.com', leadCategory: 'soi' });
    const email = mockEmail({ rows: [soiRow] });

    const result = await enableLeads(agentConfig, { email, emails: ['soi@x.com'] });

    expect(result.blocked).toBe(1);
    expect(result.counts.blockedSoi).toBe(1);
    expect(email.updateSheetRow).not.toHaveBeenCalled();
  });

  test("leadCategory ' SOI ' (padded, uppercase) -> also BLOCKED", async () => {
    const soiRow = sheetRow({ rowIndex: 8, leadId: 'soi2@x.com', leadCategory: ' SOI ' });
    const email = mockEmail({ rows: [soiRow] });

    const result = await enableLeads(agentConfig, { email, emails: ['soi2@x.com'] });

    expect(result.counts.blockedSoi).toBe(1);
    expect(email.updateSheetRow).not.toHaveBeenCalled();
  });

  test("conversationHistory containing 'PROPOSED SOI:' with empty T -> BLOCKED", async () => {
    const row = sheetRow({
      rowIndex: 9,
      leadId: 'proposed@x.com',
      leadCategory: '',
      conversationHistory: '[2026-07-14] PROPOSED SOI: lead said they closed.',
    });
    const email = mockEmail({ rows: [row] });

    const result = await enableLeads(agentConfig, { email, emails: ['proposed@x.com'] });

    expect(result.counts.blockedProposedSoi).toBe(1);
    expect(email.updateSheetRow).not.toHaveBeenCalled();
  });

  test('same row with T already set to something non-soi -> NOT blocked by rule 5b', async () => {
    const row = sheetRow({
      rowIndex: 10,
      leadId: 'resolved@x.com',
      leadCategory: 'buyer',
      conversationHistory: '[2026-07-14] PROPOSED SOI: lead said they closed.',
    });
    const email = mockEmail({ rows: [row] });

    const result = await enableLeads(agentConfig, { email, emails: ['resolved@x.com'] });

    expect(result.counts.blockedProposedSoi).toBe(0);
    expect(result.enabled).toBe(1);
    expect(email.updateSheetRow).toHaveBeenCalledWith(agentConfig, 10, { aiEnabled: 'TRUE' });
  });

  test('update payload is exactly { aiEnabled: TRUE } with no status or leadCategory key', async () => {
    const row = sheetRow({ rowIndex: 11, leadId: 'a@x.com' });
    const email = mockEmail({ rows: [row] });

    await enableLeads(agentConfig, { email, emails: ['a@x.com'] });

    const updates = email.updateSheetRow.mock.calls[0][2];
    expect(updates).toEqual({ aiEnabled: 'TRUE' });
    expect(updates).not.toHaveProperty('status');
    expect(updates).not.toHaveProperty('leadCategory');
  });

  test('dryRun -> updateSheetRow called ZERO times, report identical', async () => {
    const row = sheetRow({ rowIndex: 12, leadId: 'a@x.com' });
    const email = mockEmail({ rows: [row] });

    const dryResult = await enableLeads(agentConfig, { email, emails: ['a@x.com'], dryRun: true });
    expect(email.updateSheetRow).not.toHaveBeenCalled();
    expect(dryResult.enabled).toBe(1);
    expect(dryResult.rows[0]).toEqual({ email: 'a@x.com', action: 'enabled', reason: '' });

    email.updateSheetRow.mockClear();
    const wetResult = await enableLeads(agentConfig, { email, emails: ['a@x.com'], dryRun: false });
    expect(email.updateSheetRow).toHaveBeenCalledTimes(1);
    expect(wetResult).toEqual(dryResult);
  });

  test('counts reconcile (emails path: enabled + blockedSoi + blockedProposedSoi + notFound + notEligible === requested count)', async () => {
    const okRow = sheetRow({ rowIndex: 13, leadId: 'ok@x.com' });
    const soiRow = sheetRow({ rowIndex: 14, leadId: 'soi@x.com', leadCategory: 'soi' });
    const email = mockEmail({ rows: [okRow, soiRow] });

    const result = await enableLeads(agentConfig, {
      email,
      emails: ['ok@x.com', 'soi@x.com', 'missing@x.com'],
    });

    const { enabled, blockedSoi, blockedProposedSoi, notFound, notEligible } = result.counts;
    expect(enabled + blockedSoi + blockedProposedSoi + notFound + notEligible).toBe(3);
  });

  test('counts reconcile (status path: enabled + blockedSoi + blockedProposedSoi === selected count)', async () => {
    const okRow = sheetRow({ rowIndex: 15, leadId: 'ok@x.com', status: 'warm' });
    const soiRow = sheetRow({ rowIndex: 16, leadId: 'soi@x.com', status: 'warm', leadCategory: 'soi' });
    const email = mockEmail({ rows: [okRow, soiRow] });

    const result = await enableLeads(agentConfig, { email, status: 'warm' });

    const { enabled, blockedSoi, blockedProposedSoi } = result.counts;
    expect(enabled + blockedSoi + blockedProposedSoi).toBe(2);
  });
});
