'use strict';

// Mock googleapis so fetchUnreadInboxEmails never touches real Gmail.
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

const mockList = jest.fn();
const mockGet = jest.fn();
google.gmail.mockReturnValue({
  users: {
    messages: {
      list: mockList,
      get: mockGet,
    },
  },
});

const { fetchUnreadInboxEmails } = require('../src/gmail');

const agentConfig = {
  agentId: 'test-agent',
  provider: 'gmail',
  googleRefreshToken: 'test-refresh-token',
};

beforeEach(() => {
  mockList.mockReset().mockResolvedValue({ data: { messages: [] } });
  mockGet.mockReset();
});

test('query excludes agent-ai/noise so already-labeled noise does not re-enter the fetch', async () => {
  await fetchUnreadInboxEmails(agentConfig);

  expect(mockList).toHaveBeenCalledTimes(1);
  const callArgs = mockList.mock.calls[0][0];
  expect(callArgs.q).toContain('is:unread in:inbox');
  expect(callArgs.q).toContain('-label:"agent-ai/noise"');
  expect(callArgs.maxResults).toBe(100);
});
