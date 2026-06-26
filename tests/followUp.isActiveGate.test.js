'use strict';

// ── Mock followUp.js dependencies (order matters: before any require) ─────────

jest.mock('../src/email',      () => ({ readSheetRows: jest.fn() }));
jest.mock('../src/claude',     () => ({}));
jest.mock('../src/prompts',    () => ({}));
jest.mock('../src/paths',      () => ({ buildShadowDraftWrapper: jest.fn() }));
jest.mock('../src/agentConfig', () => ({ getFollowUpCadence: jest.fn().mockReturnValue([3, 7, 14]) }));
jest.mock('../src/time',       () => ({ getNow: jest.fn().mockReturnValue(Date.now()), getNowIso: jest.fn().mockReturnValue('2026-06-26T07:00:00.000Z') }));
jest.mock('../src/agentState', () => ({
  getState: jest.fn(),
  setState: jest.fn(),
}));

// ── Pull in modules under test ────────────────────────────────────────────────

const { runFollowUps } = require('../src/followUp');
const email = require('../src/email');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAgentConfig(overrides = {}) {
  return {
    agentId: 'inactive-test',
    isActive: true,
    googleSheetId: 'sheet-123',
    timezone: 'America/Toronto',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

describe('runFollowUps isActive gate', () => {
  it('inactive agent: returns skipped shape without calling readSheetRows', async () => {
    const agentConfig = makeAgentConfig({ isActive: false });

    const result = await runFollowUps(agentConfig);

    expect(result).toEqual({ skipped: 'inactive', eligible: 0, fired: 0, threadingMismatchSkipped: 0, errors: 0 });
    expect(email.readSheetRows).toHaveBeenCalledTimes(0);
  });

  it('active agent: calls readSheetRows (gate does not block)', async () => {
    const agentConfig = makeAgentConfig({ isActive: true });
    email.readSheetRows.mockResolvedValue([]);

    await runFollowUps(agentConfig);

    expect(email.readSheetRows).toHaveBeenCalledTimes(1);
  });
});
