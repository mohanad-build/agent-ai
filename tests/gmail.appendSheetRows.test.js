'use strict';

// Mock googleapis so appendSheetRows / appendSheetRow never touch real Sheets.
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
      })),
    },
    sheets: jest.fn(),
  },
}));

const { google } = require('googleapis');

const mockAppend = jest.fn();
google.sheets.mockReturnValue({
  spreadsheets: { values: { append: mockAppend } },
});

const { appendSheetRows } = require('../src/gmail');

const agentConfig = {
  agentId: 'test-agent',
  provider: 'gmail',
  googleSheetId: 'test-sheet-id',
  googleRefreshToken: 'test-refresh-token',
};

const COLUMN_ORDER = [
  'leadId', 'name', 'phone', 'source', 'dateAdded', 'originalMessage', 'status',
  'followUpCount', 'nextFollowUpDay', 'lastFollowUpDate', 'reserved',
  'conversationHistory', 'pendingQuestion', 'gmailThreadId', 'aiEnabled',
  'lastActionTimestamp', 'reminderSent', 'validationStatus', 'operatorEscalated',
  'leadCategory',
];

beforeEach(() => {
  mockAppend.mockReset().mockResolvedValue({});
});

test('N rowData objects -> values.append called ONCE with a 2D array of length N, each row in COLUMN_MAP order', async () => {
  const rowDataArray = [
    { leadId: 'a@x.com', name: 'A', status: 'new' },
    { leadId: 'b@x.com', name: 'B', status: 'new' },
    { leadId: 'c@x.com', name: 'C', status: 'new' },
  ];

  await appendSheetRows(agentConfig, rowDataArray);

  expect(mockAppend).toHaveBeenCalledTimes(1);
  const { requestBody, spreadsheetId, range, valueInputOption, insertDataOption } =
    mockAppend.mock.calls[0][0];
  expect(spreadsheetId).toBe('test-sheet-id');
  expect(range).toBe('A:T');
  expect(valueInputOption).toBe('RAW');
  expect(insertDataOption).toBe('INSERT_ROWS');
  expect(requestBody.values).toHaveLength(3);
  requestBody.values.forEach((row) => expect(row).toHaveLength(COLUMN_ORDER.length));
});

test('a rowData missing some fields -> those positions default to empty string', async () => {
  await appendSheetRows(agentConfig, [{ leadId: 'a@x.com', name: 'A' }]);

  const row = mockAppend.mock.calls[0][0].requestBody.values[0];
  expect(row[COLUMN_ORDER.indexOf('leadId')]).toBe('a@x.com');
  expect(row[COLUMN_ORDER.indexOf('name')]).toBe('A');
  expect(row[COLUMN_ORDER.indexOf('phone')]).toBe('');
  expect(row[COLUMN_ORDER.indexOf('status')]).toBe('');
  expect(row[COLUMN_ORDER.indexOf('leadCategory')]).toBe('');
});

test('empty array -> no values.append call', async () => {
  const result = await appendSheetRows(agentConfig, []);
  expect(mockAppend).not.toHaveBeenCalled();
  expect(result).toBeUndefined();
});

test('column ordering: a known rowData maps to the expected positional array', async () => {
  const rowData = {
    leadId: 'jane@example.com',
    name: 'Jane Doe',
    phone: '4165551234',
    source: 'inbox',
    dateAdded: '2026-07-14',
    originalMessage: 'Interested in 45 Maple',
    status: 'new',
    followUpCount: '0',
    nextFollowUpDay: '',
    lastFollowUpDate: '',
    reserved: '',
    conversationHistory: 'log entry',
    pendingQuestion: '',
    gmailThreadId: 'thread-1',
    aiEnabled: 'TRUE',
    lastActionTimestamp: '',
    reminderSent: '',
    validationStatus: '',
    operatorEscalated: '',
    leadCategory: 'buyer',
  };

  await appendSheetRows(agentConfig, [rowData]);

  const row = mockAppend.mock.calls[0][0].requestBody.values[0];
  const expected = COLUMN_ORDER.map((name) => rowData[name]);
  expect(row).toEqual(expected);
});
