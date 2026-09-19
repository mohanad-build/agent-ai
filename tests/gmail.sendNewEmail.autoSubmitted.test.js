'use strict';

// Mock googleapis so sendNewEmail never touches real Gmail. Same pattern as
// tests/gmail.fetchUnreadInboxEmails.test.js.
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

const { google } = require('googleapis');

const mockSend = jest.fn();
google.gmail.mockReturnValue({
  users: {
    messages: {
      send: mockSend,
    },
  },
});

const { sendNewEmail } = require('../src/gmail');

function decodeBase64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

const agentConfig = {
  agentId: 'test-agent',
  provider: 'gmail',
  googleRefreshToken: 'test-refresh-token',
  ccEmails: [],
  bccEmails: [],
};

beforeEach(() => {
  mockSend.mockReset().mockResolvedValue({ data: { id: 'sent-1' } });
});

test('sendNewEmail with autoSubmitted: true produces a raw message carrying Auto-Submitted: auto-replied', async () => {
  await sendNewEmail(agentConfig, {
    to: 'lead@example.com',
    subject: 'Hello there',
    body: 'Plain body text.',
    autoSubmitted: true,
  });

  expect(mockSend).toHaveBeenCalledTimes(1);
  const { raw } = mockSend.mock.calls[0][0].requestBody;
  const decoded = decodeBase64url(raw);
  const headerBlock = decoded.split('\r\n\r\n')[0];
  expect(headerBlock.split('\r\n')).toContain('Auto-Submitted: auto-replied');
});

test('sendNewEmail without autoSubmitted produces a raw message with no Auto-Submitted header', async () => {
  await sendNewEmail(agentConfig, {
    to: 'lead@example.com',
    subject: 'Hello there',
    body: 'Plain body text.',
  });

  expect(mockSend).toHaveBeenCalledTimes(1);
  const { raw } = mockSend.mock.calls[0][0].requestBody;
  const decoded = decodeBase64url(raw);
  expect(decoded).not.toContain('Auto-Submitted');
});
