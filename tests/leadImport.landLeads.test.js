'use strict';

const { landLeads } = require('../src/leadImport');
const { findRowByEmail } = require('../src/gmail');

const FIXED_NOW = new Date('2026-07-14T12:00:00.000Z');

function mockEmail({ existingRows = [] } = {}) {
  return {
    readSheetRows: jest.fn().mockResolvedValue(existingRows),
    appendSheetRows: jest.fn().mockResolvedValue(undefined),
    updateSheetRow: jest.fn().mockResolvedValue(undefined),
    findRowByEmail,
  };
}

function okRow({ email, name = 'Name', phone = '', source = '', rawIndex = 0 }) {
  return { name, email, phone, source, status: 'ok', statusReason: '', rawIndex };
}

const agentConfig = { agentId: 'test-agent', googleSheetId: 'sheet-123' };

describe('landLeads', () => {
  test('happy path: N ok rows -> appendSheetRows called ONCE with N rowData objects', async () => {
    const email = mockEmail();
    const normalized = {
      rows: [
        okRow({ email: 'a@x.com', name: 'A', rawIndex: 0 }),
        okRow({ email: 'b@x.com', name: 'B', rawIndex: 1 }),
        okRow({ email: 'c@x.com', name: 'C', rawIndex: 2 }),
      ],
      meta: {},
    };

    const result = await landLeads(agentConfig, normalized, { email, now: FIXED_NOW });

    expect(email.appendSheetRows).toHaveBeenCalledTimes(1);
    const rowDataArray = email.appendSheetRows.mock.calls[0][1];
    expect(rowDataArray).toHaveLength(3);
    rowDataArray.forEach((rd) => {
      expect(rd.source).toBe('import');
      expect(rd.status).toBe('needs_review');
      expect(rd.aiEnabled).toBe('FALSE');
      expect(rd.conversationHistory).toEqual(expect.any(String));
      expect(rd.conversationHistory.length).toBeGreaterThan(0);
    });
    expect(result.landed).toBe(3);
  });

  test('missing googleSheetId -> throws, and readSheetRows is NEVER called', async () => {
    const email = mockEmail();
    const badConfig = { agentId: 'no-sheet-agent' };
    const normalized = { rows: [okRow({ email: 'a@x.com' })], meta: {} };

    await expect(landLeads(badConfig, normalized, { email, now: FIXED_NOW })).rejects.toThrow(
      /no-sheet-agent/
    );
    expect(email.readSheetRows).not.toHaveBeenCalled();
  });

  test('email already in Sheet -> skip:duplicate-in-sheet, excluded from append payload, updateSheetRow never called', async () => {
    const email = mockEmail({ existingRows: [{ rowIndex: 5, leadId: 'a@x.com' }] });
    const normalized = {
      rows: [okRow({ email: 'a@x.com' }), okRow({ email: 'b@x.com' })],
      meta: {},
    };

    const result = await landLeads(agentConfig, normalized, { email, now: FIXED_NOW });

    const dupeRow = result.rows.find((r) => r.email === 'a@x.com');
    expect(dupeRow.status).toBe('skip:duplicate-in-sheet');

    const rowDataArray = email.appendSheetRows.mock.calls[0][1];
    expect(rowDataArray).toHaveLength(1);
    expect(rowDataArray[0].leadId).toBe('b@x.com');
    expect(email.updateSheetRow).not.toHaveBeenCalled();
  });

  test('same email twice in file -> first lands, second skip:duplicate-in-file, append payload has exactly one', async () => {
    const email = mockEmail();
    const normalized = {
      rows: [okRow({ email: 'a@x.com', rawIndex: 0 }), okRow({ email: 'a@x.com', rawIndex: 1 })],
      meta: {},
    };

    const result = await landLeads(agentConfig, normalized, { email, now: FIXED_NOW });

    expect(result.rows[0].status).toBe('landed');
    expect(result.rows[1].status).toBe('skip:duplicate-in-file');
    const rowDataArray = email.appendSheetRows.mock.calls[0][1];
    expect(rowDataArray).toHaveLength(1);
  });

  test('normalizer skips carried through unchanged and still present in rows', async () => {
    const email = mockEmail();
    const noEmailRow = { name: 'No Email', email: '', phone: '', source: '', status: 'skip:no-email', statusReason: 'missing or invalid email', rawIndex: 0 };
    const unparseableRow = { name: '', email: '', phone: '', source: '', status: 'skip:unparseable', statusReason: 'row has fewer columns than the inferred mapping requires', rawIndex: 1 };
    const normalized = { rows: [noEmailRow, unparseableRow], meta: {} };

    const result = await landLeads(agentConfig, normalized, { email, now: FIXED_NOW });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(noEmailRow);
    expect(result.rows[1]).toEqual(unparseableRow);
  });

  test('zero survivors -> appendSheetRows NOT called', async () => {
    const email = mockEmail();
    const noEmailRow = { name: '', email: '', phone: '', source: '', status: 'skip:no-email', statusReason: 'missing or invalid email', rawIndex: 0 };
    const normalized = { rows: [noEmailRow], meta: {} };

    await landLeads(agentConfig, normalized, { email, now: FIXED_NOW });

    expect(email.appendSheetRows).not.toHaveBeenCalled();
  });

  test('count reconciliation: counts sum to rows.length === normalized.rows.length', async () => {
    const email = mockEmail({ existingRows: [{ rowIndex: 5, leadId: 'dupe@x.com' }] });
    const noEmailRow = { name: '', email: '', phone: '', source: '', status: 'skip:no-email', statusReason: 'missing or invalid email', rawIndex: 0 };
    const unparseableRow = { name: '', email: '', phone: '', source: '', status: 'skip:unparseable', statusReason: 'row has fewer columns than the inferred mapping requires', rawIndex: 1 };
    const normalized = {
      rows: [
        noEmailRow,
        unparseableRow,
        okRow({ email: 'ok1@x.com', rawIndex: 2 }),
        okRow({ email: 'ok1@x.com', rawIndex: 3 }),
        okRow({ email: 'dupe@x.com', rawIndex: 4 }),
      ],
      meta: {},
    };

    const result = await landLeads(agentConfig, normalized, { email, now: FIXED_NOW });

    expect(result.rows).toHaveLength(normalized.rows.length);
    const countSum = Object.values(result.counts).reduce((a, b) => a + b, 0);
    expect(countSum).toBe(result.rows.length);
  });

  test('dateAdded is empty string on landed rows', async () => {
    const email = mockEmail();
    const normalized = { rows: [okRow({ email: 'a@x.com' })], meta: {} };

    await landLeads(agentConfig, normalized, { email, now: FIXED_NOW });

    const rowDataArray = email.appendSheetRows.mock.calls[0][1];
    expect(rowDataArray[0].dateAdded).toBe('');
  });

  test('original source from the file appears in the conversationHistory entry', async () => {
    const email = mockEmail();
    const normalized = {
      rows: [okRow({ email: 'a@x.com', source: 'Zillow CRM export' })],
      meta: {},
    };

    await landLeads(agentConfig, normalized, { email, now: FIXED_NOW });

    const rowDataArray = email.appendSheetRows.mock.calls[0][1];
    expect(rowDataArray[0].conversationHistory).toContain('Zillow CRM export');
  });
});
