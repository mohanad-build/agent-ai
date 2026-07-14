'use strict';

const { normalizeLeads } = require('../src/leadImport');

function mockClaude(mappingObj) {
  return { callRaw: jest.fn().mockResolvedValue(JSON.stringify(mappingObj)) };
}

describe('normalizeLeads', () => {
  test('clean CSV with header -> all ok, emails lowercased', async () => {
    const rawText = [
      'Name,Email,Phone,Source',
      'Jane Doe,JANE@EXAMPLE.COM,416-555-1234,Website',
      'John Smith,john@example.com,+1 647 555 9999,Referral',
    ].join('\n');
    const claude = mockClaude({
      headerPresent: true,
      columns: { email: 1, name: 0, phone: 2, source: 3 },
    });

    const result = await normalizeLeads(rawText, { claude });

    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.status === 'ok')).toBe(true);
    expect(result.rows[0].email).toBe('jane@example.com');
    expect(result.rows[1].email).toBe('john@example.com');
    expect(result.rows[0].rawIndex).toBe(0);
    expect(result.rows[1].rawIndex).toBe(1);
    expect(claude.callRaw).toHaveBeenCalledTimes(1);
  });

  test('first/last split-name columns -> name joined with one space', async () => {
    const rawText = ['First,Last,Email', 'Jane,Doe,jane@example.com'].join('\n');
    const claude = mockClaude({
      headerPresent: true,
      columns: { email: 2, name: [0, 1], phone: null, source: null },
    });

    const result = await normalizeLeads(rawText, { claude });

    expect(result.rows[0].name).toBe('Jane Doe');
    expect(result.rows[0].status).toBe('ok');
  });

  test('a row with no email -> skip:no-email, still appears in rows', async () => {
    const rawText = ['Name,Email', 'Jane Doe,jane@example.com', 'No Email Guy,'].join('\n');
    const claude = mockClaude({
      headerPresent: true,
      columns: { email: 1, name: 0, phone: null, source: null },
    });

    const result = await normalizeLeads(rawText, { claude });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[1].status).toBe('skip:no-email');
    expect(result.rows[1].name).toBe('No Email Guy');
  });

  test('a garbage/short row not fitting the mapping -> skip:unparseable', async () => {
    const rawText = ['Name,Email,Phone', 'Jane Doe,jane@example.com,416-555-1234', 'BadRow'].join(
      '\n'
    );
    const claude = mockClaude({
      headerPresent: true,
      columns: { email: 1, name: 0, phone: 2, source: null },
    });

    const result = await normalizeLeads(rawText, { claude });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[1].status).toBe('skip:unparseable');
  });

  test('tab-delimited input parses', async () => {
    const rawText = ['Name\tEmail', 'Jane Doe\tjane@example.com'].join('\n');
    const claude = mockClaude({
      headerPresent: true,
      columns: { email: 1, name: 0, phone: null, source: null },
    });

    const result = await normalizeLeads(rawText, { claude });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].email).toBe('jane@example.com');
    expect(result.rows[0].name).toBe('Jane Doe');
    expect(result.rows[0].status).toBe('ok');
  });

  test('a quoted field containing a comma parses as one field', async () => {
    const rawText = [
      'Name,Email,Notes',
      '"Doe, Jane",jane@example.com,"Likes commas, apparently"',
    ].join('\n');
    const claude = mockClaude({
      headerPresent: true,
      columns: { email: 1, name: 0, phone: null, source: null },
    });

    const result = await normalizeLeads(rawText, { claude });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('Doe, Jane');
    expect(result.rows[0].email).toBe('jane@example.com');
  });

  test('count reconciliation: N input data rows -> rows.length === N, okCount + skippedCount === N', async () => {
    const rawText = [
      'Name,Email,Phone',
      'Jane Doe,jane@example.com,416-555-1234',
      'No Email,,',
      'BadRow',
      'John Smith,john@example.com,647-555-9999',
    ].join('\n');
    const claude = mockClaude({
      headerPresent: true,
      columns: { email: 1, name: 0, phone: 2, source: null },
    });

    const result = await normalizeLeads(rawText, { claude });

    expect(result.rows).toHaveLength(4);
    expect(result.meta.inputRowCount).toBe(4);
    expect(result.meta.okCount + result.meta.skippedCount).toBe(4);
  });

  test('non-delimited single-column input -> throws the clear Error', async () => {
    const rawText = ['just some free text', 'another line with no structure', 'yet another'].join(
      '\n'
    );
    const claude = mockClaude({
      headerPresent: false,
      columns: { email: null, name: null, phone: null, source: null },
    });

    await expect(normalizeLeads(rawText, { claude })).rejects.toThrow(
      'input does not look like delimited CSV/TSV; freeform paste is not supported in the MVP'
    );
    expect(claude.callRaw).not.toHaveBeenCalled();
  });

  test('meta.mapping echoes the inferred map', async () => {
    const rawText = ['Name,Email,Phone,Source', 'Jane Doe,jane@example.com,416-555-1234,Website'].join(
      '\n'
    );
    const columns = { email: 1, name: 0, phone: 2, source: 3 };
    const claude = mockClaude({ headerPresent: true, columns });

    const result = await normalizeLeads(rawText, { claude });

    expect(result.meta.mapping).toEqual(columns);
  });
});
