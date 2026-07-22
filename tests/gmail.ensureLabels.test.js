'use strict';

// Mock googleapis so ensureLabels never touches real Gmail.
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
const mockCreate = jest.fn();
google.gmail.mockReturnValue({
  users: {
    labels: {
      list: mockList,
      create: mockCreate,
    },
  },
});

const gmail = require('../src/gmail');
const { ensureLabels } = gmail;
const { _clearLabelCache } = gmail._internal;

const AGENT_A = { agentId: 'agent-a', googleRefreshToken: 'token-a' };
const AGENT_B = { agentId: 'agent-b', googleRefreshToken: 'token-b' };

beforeEach(() => {
  _clearLabelCache();
  mockList.mockReset();
  mockCreate.mockReset();
});

test('first call with a name-set lists once, creates missing, returns exactly those names', async () => {
  mockList.mockResolvedValue({ data: { labels: [{ name: 'agent-ai/noise', id: 'L_NOISE' }] } });
  mockCreate.mockImplementation(async ({ requestBody }) => ({ data: { id: 'L_NEW_' + requestBody.name } }));

  const result = await ensureLabels(AGENT_A, ['agent-ai/noise', 'agent-ai/processing']);

  expect(mockList).toHaveBeenCalledTimes(1);
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ requestBody: { name: 'agent-ai/processing' } }));
  expect(result).toEqual(new Map([
    ['agent-ai/noise', 'L_NOISE'],
    ['agent-ai/processing', 'L_NEW_agent-ai/processing'],
  ]));
});

test('second call with the SAME set does NOT call listLabels again (cache hit)', async () => {
  mockList.mockResolvedValue({ data: { labels: [{ name: 'agent-ai/noise', id: 'L_NOISE' }] } });
  mockCreate.mockImplementation(async ({ requestBody }) => ({ data: { id: 'L_NEW_' + requestBody.name } }));

  await ensureLabels(AGENT_A, ['agent-ai/noise', 'agent-ai/processing']);
  mockList.mockClear();
  mockCreate.mockClear();

  const result = await ensureLabels(AGENT_A, ['agent-ai/noise', 'agent-ai/processing']);

  expect(mockList).not.toHaveBeenCalled();
  expect(mockCreate).not.toHaveBeenCalled();
  expect(result).toEqual(new Map([
    ['agent-ai/noise', 'L_NOISE'],
    ['agent-ai/processing', 'L_NEW_agent-ai/processing'],
  ]));
});

test('a call with a DIFFERENT name-set for the same agent reuses the accumulated cache for known names and lists to resolve the new ones', async () => {
  mockList.mockResolvedValue({ data: { labels: [{ name: 'agent-ai/noise', id: 'L_NOISE' }] } });
  mockCreate.mockImplementation(async ({ requestBody }) => ({ data: { id: 'L_NEW_' + requestBody.name } }));

  await ensureLabels(AGENT_A, ['agent-ai/noise']);
  mockList.mockClear();
  mockCreate.mockClear();
  mockList.mockResolvedValue({ data: { labels: [{ name: 'agent-ai/noise', id: 'L_NOISE' }] } });

  const result = await ensureLabels(AGENT_A, ['agent-ai/noise', 'agent-ai/system-followup']);

  expect(mockList).toHaveBeenCalledTimes(1);
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ requestBody: { name: 'agent-ai/system-followup' } }));
  expect(result).toEqual(new Map([
    ['agent-ai/noise', 'L_NOISE'],
    ['agent-ai/system-followup', 'L_NEW_agent-ai/system-followup'],
  ]));
});

test('a name that already exists in Gmail is reused, not created', async () => {
  mockList.mockResolvedValue({
    data: {
      labels: [
        { name: 'agent-ai/outbound-processed', id: 'L_EXISTING' },
      ],
    },
  });

  const result = await ensureLabels(AGENT_A, ['agent-ai/outbound-processed']);

  expect(mockCreate).not.toHaveBeenCalled();
  expect(result).toEqual(new Map([['agent-ai/outbound-processed', 'L_EXISTING']]));
});

test('per-agent isolation: agent B does not see agent A cached labels', async () => {
  mockList.mockResolvedValue({ data: { labels: [{ name: 'agent-ai/noise', id: 'L_NOISE_A' }] } });
  await ensureLabels(AGENT_A, ['agent-ai/noise']);
  mockList.mockClear();

  mockList.mockResolvedValue({ data: { labels: [{ name: 'agent-ai/noise', id: 'L_NOISE_B' }] } });
  const result = await ensureLabels(AGENT_B, ['agent-ai/noise']);

  expect(mockList).toHaveBeenCalledTimes(1);
  expect(result).toEqual(new Map([['agent-ai/noise', 'L_NOISE_B']]));
});
