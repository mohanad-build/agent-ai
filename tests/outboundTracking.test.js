'use strict';

const { findRowByEmail } = require('../src/gmail');
const { trackOutbound } = require('../src/outboundTracking');

const SYSTEM_FOLLOWUP_ID = 'Label_SYSTEM_FOLLOWUP';
const OUTBOUND_PROCESSED_ID = 'Label_OUTBOUND_PROCESSED';

function makeAgentConfig(overrides = {}) {
  return {
    agentId: 'ot-test',
    isActive: true,
    googleSheetId: 'sheet-123',
    ...overrides,
  };
}

function sheetRow(overrides = {}) {
  return {
    rowIndex: 7,
    leadId: 'jane@example.com',
    aiEnabled: 'TRUE',
    followUpCount: '2',
    lastFollowUpDate: '2026-06-01T00:00:00.000Z',
    lastActionTimestamp: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function fetchedMessage(overrides = {}) {
  return {
    id: 'msg-1',
    threadId: 'thread-1',
    from: 'agent@example.com',
    to: 'jane@example.com',
    subject: 'Re: inquiry',
    body: 'body text',
    internalDate: 1780000000000,
    labelIds: [],
    ...overrides,
  };
}

function mockDeps({ rows = [], searchIds = [], fetchImpl } = {}) {
  const ensureLabels = jest.fn().mockResolvedValue(
    new Map([
      ['agent-ai/system-followup', SYSTEM_FOLLOWUP_ID],
      ['agent-ai/outbound-processed', OUTBOUND_PROCESSED_ID],
    ])
  );
  const searchMessages = jest.fn().mockResolvedValue(searchIds);
  const fetchMessage = jest.fn(fetchImpl || (async () => fetchedMessage()));
  const applyMessageLabels = jest.fn().mockResolvedValue(undefined);

  const readSheetRows = jest.fn().mockResolvedValue(rows);
  const updateSheetRow = jest.fn().mockResolvedValue(undefined);
  const appendToConversationHistory = jest.fn().mockResolvedValue(undefined);

  return {
    gmail: { ensureLabels, searchMessages, fetchMessage, applyMessageLabels, findRowByEmail },
    email: { readSheetRows, updateSheetRow, appendToConversationHistory },
  };
}

function callTrack(agentCfg, deps, extraOpts = {}) {
  return trackOutbound(agentCfg, { gmail: deps.gmail, email: deps.email, now: new Date('2026-07-22T12:00:00.000Z'), ...extraOpts });
}

describe('trackOutbound', () => {
  it('a genuine outbound to a lead resets H/J/P and appends L', async () => {
    const agentConfig = makeAgentConfig();
    const row = sheetRow();
    const deps = mockDeps({
      rows: [row],
      searchIds: ['msg-1'],
      fetchImpl: async () => fetchedMessage({ internalDate: 1780000000000 }),
    });

    const result = await callTrack(agentConfig, deps);

    const expectedIso = new Date(1780000000000).toISOString();
    expect(deps.email.updateSheetRow).toHaveBeenCalledWith(agentConfig, 7, {
      followUpCount: '0',
      lastFollowUpDate: expectedIso,
      lastActionTimestamp: expectedIso,
    });
    expect(deps.email.appendToConversationHistory).toHaveBeenCalledWith(
      agentConfig,
      7,
      expect.any(String)
    );
    expect(deps.email.appendToConversationHistory.mock.calls[0][2].length).toBeGreaterThan(0);
    expect(result.reset).toBe(1);
    expect(result.matched).toBe(1);
  });

  it('a message carrying system-followup id in labelIds is SKIPPED (infinite-reset-loop guard)', async () => {
    const agentConfig = makeAgentConfig();
    const row = sheetRow();
    const deps = mockDeps({
      rows: [row],
      searchIds: ['msg-1'],
      fetchImpl: async () => fetchedMessage({ labelIds: [SYSTEM_FOLLOWUP_ID] }),
    });

    const result = await callTrack(agentConfig, deps);

    expect(deps.email.updateSheetRow).not.toHaveBeenCalled();
    expect(result.skippedLabeled).toBe(1);
  });

  it('a message carrying outbound-processed id in labelIds is SKIPPED', async () => {
    const agentConfig = makeAgentConfig();
    const row = sheetRow();
    const deps = mockDeps({
      rows: [row],
      searchIds: ['msg-1'],
      fetchImpl: async () => fetchedMessage({ labelIds: [OUTBOUND_PROCESSED_ID] }),
    });

    const result = await callTrack(agentConfig, deps);

    expect(deps.email.updateSheetRow).not.toHaveBeenCalled();
    expect(result.skippedLabeled).toBe(1);
  });

  it('a survivor gets stamped outbound-processed AFTER its reset', async () => {
    const agentConfig = makeAgentConfig();
    const row = sheetRow();
    const deps = mockDeps({
      rows: [row],
      searchIds: ['msg-1'],
      fetchImpl: async () => fetchedMessage(),
    });

    const callOrder = [];
    deps.email.updateSheetRow.mockImplementation(async () => { callOrder.push('reset'); });
    deps.gmail.applyMessageLabels.mockImplementation(async () => { callOrder.push('stamp'); });

    await callTrack(agentConfig, deps);

    expect(deps.gmail.applyMessageLabels).toHaveBeenCalledWith(
      agentConfig,
      'msg-1',
      [OUTBOUND_PROCESSED_ID],
      []
    );
    expect(callOrder).toEqual(['reset', 'stamp']);
  });

  it('an outbound to an aiEnabled=FALSE / rate-limited lead is still matched and reset (unfiltered findRowByEmail)', async () => {
    const agentConfig = makeAgentConfig();
    const row = sheetRow({ aiEnabled: 'FALSE', lastActionTimestamp: new Date().toISOString() });
    const deps = mockDeps({
      rows: [row],
      searchIds: ['msg-1'],
      fetchImpl: async () => fetchedMessage(),
    });

    const result = await callTrack(agentConfig, deps);

    expect(deps.email.updateSheetRow).toHaveBeenCalledTimes(1);
    expect(result.reset).toBe(1);
  });

  it('a display-name To header matches the bare column-A address (extractAddress runs before findRowByEmail)', async () => {
    const agentConfig = makeAgentConfig();
    const row = sheetRow({ leadId: 'jane@example.com' });
    const deps = mockDeps({
      rows: [row],
      searchIds: ['msg-1'],
      fetchImpl: async () => fetchedMessage({ to: 'Jane Lead <jane@example.com>' }),
    });

    const result = await callTrack(agentConfig, deps);

    expect(deps.email.updateSheetRow).toHaveBeenCalledWith(agentConfig, 7, expect.any(Object));
    expect(result.reset).toBe(1);
  });

  it('internalDate (number, ms since epoch) converts to ISO in J/P', async () => {
    const agentConfig = makeAgentConfig();
    const row = sheetRow();
    const numericInternalDate = 1750000000123;
    const deps = mockDeps({
      rows: [row],
      searchIds: ['msg-1'],
      fetchImpl: async () => fetchedMessage({ internalDate: numericInternalDate }),
    });

    await callTrack(agentConfig, deps);

    const expectedIso = new Date(numericInternalDate).toISOString();
    expect(deps.email.updateSheetRow).toHaveBeenCalledWith(
      agentConfig,
      7,
      expect.objectContaining({ lastFollowUpDate: expectedIso, lastActionTimestamp: expectedIso })
    );
  });

  it('per-message isolation: one fetchMessage throwing increments errors and does not abort the other id', async () => {
    const agentConfig = makeAgentConfig();
    const row = sheetRow();
    const deps = mockDeps({
      rows: [row],
      searchIds: ['bad-msg', 'msg-1'],
      fetchImpl: async (agentCfg, id) => {
        if (id === 'bad-msg') throw new Error('fetch failed');
        return fetchedMessage({ id: 'msg-1' });
      },
    });

    const result = await callTrack(agentConfig, deps);

    expect(result.errors).toBe(1);
    expect(result.reset).toBe(1);
    expect(deps.email.updateSheetRow).toHaveBeenCalledTimes(1);
  });

  it('isActive false returns early with no Sheet read', async () => {
    const agentConfig = makeAgentConfig({ isActive: false });
    const deps = mockDeps({ rows: [sheetRow()], searchIds: ['msg-1'] });

    const result = await callTrack(agentConfig, deps);

    expect(deps.email.readSheetRows).not.toHaveBeenCalled();
    expect(deps.gmail.searchMessages).not.toHaveBeenCalled();
    expect(result.skipped).toBe('inactive');
  });
});
