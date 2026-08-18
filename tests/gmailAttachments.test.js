'use strict';

const crypto = require('node:crypto');

// Mock googleapis so gmailAttachments.js never touches real Gmail.
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
      })),
    },
    gmail: jest.fn(),
  },
}));

// Mock gmail.js so getOAuthClient does not run for real.
jest.mock('../src/gmail');

const { google } = require('googleapis');
const gmailMod = require('../src/gmail');

const mockGet = jest.fn();
google.gmail.mockReturnValue({
  users: { messages: { attachments: { get: mockGet } } },
});

const { fetchAttachmentBytes } = require('../src/gmailAttachments');

const agentConfig = { agentId: 'agent-a', googleRefreshToken: 'token-a' };

beforeEach(() => {
  mockGet.mockReset();
  gmailMod.getOAuthClient.mockReset().mockReturnValue({ fake: 'auth' });
});

// Bytes chosen so their standard base64 encoding contains BOTH '+' and '/',
// which become '-' and '_' under base64url. Found programmatically (random
// 8-byte buffers checked until one qualified), not picked and hoped:
// base64    = 'E/+RejWljVA='
// base64url = 'E_-RejWljVA'
const FIXTURE_BYTES = Buffer.from([19, 255, 145, 122, 53, 165, 141, 80]);
const FIXTURE_BASE64URL = FIXTURE_BYTES.toString('base64url');

test('sanity: fixture base64url actually contains both - and _', () => {
  expect(FIXTURE_BASE64URL).toContain('-');
  expect(FIXTURE_BASE64URL).toContain('_');
});

describe('fetchAttachmentBytes', () => {
  test('happy path: decoded buffer matches the source bytes exactly, contentHash is sha256 hex with prefix', async () => {
    mockGet.mockResolvedValue({ data: { data: FIXTURE_BASE64URL, size: FIXTURE_BYTES.length } });

    const result = await fetchAttachmentBytes(agentConfig, 'msg-1', 'att-1');

    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.buffer.equals(FIXTURE_BYTES)).toBe(true);
    expect(result.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('contentHash is the hash of the decoded bytes, not of the base64 string, pinned to an independently computed value', async () => {
    mockGet.mockResolvedValue({ data: { data: FIXTURE_BASE64URL, size: FIXTURE_BYTES.length } });

    const result = await fetchAttachmentBytes(agentConfig, 'msg-1', 'att-1');

    const expectedHash = `sha256:${crypto.createHash('sha256').update(FIXTURE_BYTES).digest('hex')}`;
    const hashOfBase64String = `sha256:${crypto.createHash('sha256').update(FIXTURE_BASE64URL).digest('hex')}`;

    expect(result.contentHash).toBe(expectedHash);
    expect(result.contentHash).not.toBe(hashOfBase64String);
  });

  // Node's Buffer.from(str, 'base64') decoder is itself lenient about the
  // '-'/'_' characters (confirmed empirically: it decodes them the same way
  // 'base64url' does), so a byte-equality assertion alone cannot distinguish
  // the two encoding strings on this runtime. Pin the actual argument passed
  // to Buffer.from instead, so a source change from 'base64url' to 'base64'
  // is still caught even though it would not change the decoded bytes.
  test('decodes by calling Buffer.from with the base64url encoding string specifically', async () => {
    mockGet.mockResolvedValue({ data: { data: FIXTURE_BASE64URL, size: FIXTURE_BYTES.length } });

    const fromSpy = jest.spyOn(Buffer, 'from');
    try {
      const result = await fetchAttachmentBytes(agentConfig, 'msg-1', 'att-1');

      const decodeCall = fromSpy.mock.calls.find((call) => call[0] === FIXTURE_BASE64URL);
      expect(decodeCall).toBeDefined();
      expect(decodeCall[1]).toBe('base64url');
      expect(result.buffer.equals(FIXTURE_BYTES)).toBe(true);
    } finally {
      fromSpy.mockRestore();
    }
  });

  test('throws when the response has no data field', async () => {
    mockGet.mockResolvedValue({ data: { size: 8 } });

    await expect(fetchAttachmentBytes(agentConfig, 'msg-2', 'att-2')).rejects.toThrow(
      'fetchAttachmentBytes: no data for messageId msg-2, attachmentId att-2'
    );
  });

  test('throws when data is an empty string', async () => {
    mockGet.mockResolvedValue({ data: { data: '', size: 0 } });

    await expect(fetchAttachmentBytes(agentConfig, 'msg-3', 'att-3')).rejects.toThrow(
      'fetchAttachmentBytes: no data for messageId msg-3, attachmentId att-3'
    );
  });

  test('calls getOAuthClient with agentConfig', async () => {
    mockGet.mockResolvedValue({ data: { data: FIXTURE_BASE64URL, size: FIXTURE_BYTES.length } });

    await fetchAttachmentBytes(agentConfig, 'msg-1', 'att-1');

    expect(gmailMod.getOAuthClient).toHaveBeenCalledWith(agentConfig);
  });

  test('builds a fresh Gmail client per call, threading the auth from getOAuthClient', async () => {
    mockGet.mockResolvedValue({ data: { data: FIXTURE_BASE64URL, size: FIXTURE_BYTES.length } });
    google.gmail.mockClear();

    await fetchAttachmentBytes(agentConfig, 'msg-1', 'att-1');
    await fetchAttachmentBytes(agentConfig, 'msg-1', 'att-1');

    expect(google.gmail).toHaveBeenCalledTimes(2);
    expect(google.gmail).toHaveBeenCalledWith({ version: 'v1', auth: { fake: 'auth' } });
  });

  test('calls attachments.get with userId me and the given messageId/attachmentId', async () => {
    mockGet.mockResolvedValue({ data: { data: FIXTURE_BASE64URL, size: FIXTURE_BYTES.length } });

    await fetchAttachmentBytes(agentConfig, 'msg-1', 'att-1');

    expect(mockGet).toHaveBeenCalledWith({ userId: 'me', messageId: 'msg-1', id: 'att-1' });
  });
});
