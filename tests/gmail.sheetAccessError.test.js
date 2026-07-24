'use strict';

// Mock googleapis so readSheetRows never touches real Sheets.
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
google.sheets.mockReturnValue({
  spreadsheets: { values: { get: mockGet } },
});

const gmail = require('../src/gmail');
const { readSheetRows, SheetAccessError } = gmail;
const { sheetAccessStatus } = gmail._internal;

const populatedAgent = {
  agentId: 'test-agent',
  provider: 'gmail',
  googleSheetId: 'real-sheet-id',
  googleRefreshToken: 'refresh-token',
};

const emptyStringAgent = {
  agentId: 'test-agent-empty-string',
  provider: 'gmail',
  googleSheetId: '',
  googleRefreshToken: 'refresh-token',
};

const undefinedSheetIdAgent = {
  agentId: 'test-agent-undefined-sheetid',
  provider: 'gmail',
  googleSheetId: undefined,
  googleRefreshToken: 'refresh-token',
};

beforeEach(() => {
  mockGet.mockReset();
});

describe('sheetAccessStatus', () => {
  test.each([
    [{ code: 403 }, 403],
    [{ code: 404 }, 404],
    [{ response: { status: 403 } }, 403],
    [{ response: { status: 404 } }, 404],
    [{ response: { data: { error: { status: 'PERMISSION_DENIED' } } } }, 403],
    [{ response: { data: { error: { status: 'NOT_FOUND' } } } }, 404],
    [{ code: 500 }, null],
    [{ message: 'invalid_grant' }, null],
    [{}, null],
  ])('%j -> %j', (input, expected) => {
    expect(sheetAccessStatus(input)).toBe(expected);
  });
});

describe('readSheetRows Sheet access error handling', () => {
  // withRetry always sleeps 3000ms before its second attempt, regardless of
  // error type, so these exceed Jest's default 5000ms test timeout.
  const RETRY_TIMEOUT_MS = 15000;

  test('populated googleSheetId, inner throws 403-shaped error -> rejects with SheetAccessError (permission)', async () => {
    mockGet.mockRejectedValue({ code: 403, message: 'The caller does not have permission' });

    try {
      await readSheetRows(populatedAgent);
      throw new Error('expected readSheetRows to reject');
    } catch (e) {
      expect(e).toBeInstanceOf(SheetAccessError);
      expect(e.status).toBe(403);
      expect(e.kind).toBe('permission');
      expect(e.agentId).toBe(populatedAgent.agentId);
    }
  }, RETRY_TIMEOUT_MS);

  test('populated googleSheetId, inner throws 404-shaped error -> rejects with SheetAccessError (not_found)', async () => {
    mockGet.mockRejectedValue({ code: 404, message: 'Requested entity was not found' });

    try {
      await readSheetRows(populatedAgent);
      throw new Error('expected readSheetRows to reject');
    } catch (e) {
      expect(e).toBeInstanceOf(SheetAccessError);
      expect(e.status).toBe(404);
      expect(e.kind).toBe('not_found');
      expect(e.agentId).toBe(populatedAgent.agentId);
    }
  }, RETRY_TIMEOUT_MS);

  test('EMPTY STRING googleSheetId, inner throws 404-shaped error -> rejects with the ORIGINAL error, not SheetAccessError', async () => {
    const fakeErr = { code: 404, message: 'Requested entity was not found' };
    mockGet.mockRejectedValue(fakeErr);

    await expect(readSheetRows(emptyStringAgent)).rejects.toBe(fakeErr);
  }, RETRY_TIMEOUT_MS);

  test('UNDEFINED googleSheetId, inner throws 404-shaped error -> rejects with the ORIGINAL error, not SheetAccessError', async () => {
    const fakeErr = { code: 404, message: 'Requested entity was not found' };
    mockGet.mockRejectedValue(fakeErr);

    await expect(readSheetRows(undefinedSheetIdAgent)).rejects.toBe(fakeErr);
  }, RETRY_TIMEOUT_MS);

  test('populated googleSheetId, inner throws 500-shaped error -> rejects with the ORIGINAL error, not SheetAccessError', async () => {
    const fakeErr = { code: 500, message: 'Internal error' };
    mockGet.mockRejectedValue(fakeErr);

    await expect(readSheetRows(populatedAgent)).rejects.toBe(fakeErr);
  }, RETRY_TIMEOUT_MS);

  test('happy path -> resolves the mapped rows, no throw', async () => {
    mockGet.mockResolvedValue({ data: { values: [['a@x.com', 'Alice']] } });

    const rows = await readSheetRows(populatedAgent);

    expect(rows).toEqual([
      {
        rowIndex: 2, leadId: 'a@x.com', name: 'Alice', phone: '', source: '', dateAdded: '',
        originalMessage: '', status: '', followUpCount: '', nextFollowUpDay: '',
        lastFollowUpDate: '', reserved: '', conversationHistory: '', pendingQuestion: '',
        gmailThreadId: '', aiEnabled: '', lastActionTimestamp: '', reminderSent: '',
        validationStatus: '', operatorEscalated: '', leadCategory: '',
      },
    ]);
  });
});
