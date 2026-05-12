'use strict';

// Mock googleapis so appendToConversationHistory never touches real Sheets.
// google.sheets is left as a bare jest.fn() so we can call mockReturnValue
// on it below (after the factory runs but before the module under test loads).
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

const mockGet = jest.fn();
const mockUpdate = jest.fn();
google.sheets.mockReturnValue({
  spreadsheets: { values: { get: mockGet, update: mockUpdate } },
});

const { appendToConversationHistory } = require('../src/email');

const agentConfig = {
  agentId: 'test-agent',
  provider: 'gmail',
  googleSheetId: 'test-sheet-id',
  googleRefreshToken: 'test-refresh-token',
};

beforeEach(() => {
  mockGet.mockReset().mockResolvedValue({ data: { values: null } });
  mockUpdate.mockReset().mockResolvedValue({});
});

test('appendToConversationHistory writes MOCK_NOW timestamp to L-column entry', async () => {
  // Parked item 7.8.5 / session 14 J12/P12 vs L12 observation:
  // appendToConversationHistory previously called new Date() directly and
  // therefore ignored MOCK_NOW. After the fix it routes through getNowIso().
  const MOCKED = '2026-05-18T22:33:00.000Z';
  process.env.MOCK_NOW = MOCKED;
  try {
    await appendToConversationHistory(agentConfig, 5, 'test entry');

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const written = mockUpdate.mock.calls[0][0].requestBody.values[0][0];
    expect(written).toContain(MOCKED);
    expect(written).toContain('test entry');
  } finally {
    delete process.env.MOCK_NOW;
  }
});
