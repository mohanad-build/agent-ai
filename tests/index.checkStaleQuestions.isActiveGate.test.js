'use strict';

// ── Mock heavy index.js dependencies (order matters: before any require) ──────

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../src/agentConfig',   () => ({ loadAgent: jest.fn(), isLeadCategoryActionable: jest.fn() }));
jest.mock('../src/leadIntake',    () => ({ runLeadIntake: jest.fn(), transitionToIntaken: jest.fn() }));
jest.mock('../src/followUp',      () => ({ runFollowUps: jest.fn() }));
jest.mock('../src/agentState',    () => ({
  getState: jest.fn(),
  setState: jest.fn(),
  issueToken: jest.fn(),
  incrementWeeklyPreflightSkips: jest.fn(),
  resetWeeklyPreflightSkips: jest.fn(),
  recordDailyDigestRun: jest.fn(),
}));
jest.mock('../src/digest', () => ({
  shouldRunDailyDigest:        jest.fn().mockReturnValue(false),
  runDailyDigestForAgent:      jest.fn(),
  shouldRunWeeklyDigest:       jest.fn().mockReturnValue(false),
  runWeeklyDigestForOperator:  jest.fn(),
}));
jest.mock('../src/operatorState',  () => ({ getState: jest.fn(), recordWeeklyDigestRun: jest.fn() }));
jest.mock('../src/operatorConfig', () => ({ loadOperator: jest.fn(), discoverOperatorIds: jest.fn().mockReturnValue([]) }));
jest.mock('../src/email',   () => ({ readSheetRows: jest.fn() }));
jest.mock('../src/claude',  () => ({}));
jest.mock('../src/prompts', () => ({}));
jest.mock('../src/twilio',  () => ({}));
jest.mock('../src/paths',   () => ({
  pathHotSignal:     jest.fn(),
  pathStopSignal:    jest.fn(),
  pathAskAgent:      jest.fn(),
  pathAnswerGeneral: jest.fn(),
  pathNeedsReview:   jest.fn(),
}));
jest.mock('../src/content/engine', () => ({
  runContentEngineForAgent: jest.fn(),
  shouldRunContentEngine:   jest.fn(),
}));
jest.mock('../src/content/profile', () => ({
  readContentProfile:     jest.fn(),
  isContentEngineEnabled: jest.fn(),
}));
jest.mock('../src/content/state', () => ({
  readContentState: jest.fn(),
  recordBatchSent:  jest.fn(),
}));
jest.mock('../src/content/angles', () => ({
  generateWeeklyAngles: jest.fn(),
}));
jest.mock('../src/time', () => ({
  getNow:     jest.fn().mockReturnValue(Date.now()),
  getNowIso:  jest.fn().mockReturnValue('2026-06-26T07:00:00.000Z'),
  getNowDate: jest.fn().mockReturnValue(new Date('2026-06-26T07:00:00.000Z')),
}));

// ── Pull in modules under test ────────────────────────────────────────────────

const { checkStaleQuestions } = require('../src/index');
const email = require('../src/email');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAgent(overrides = {}) {
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

describe('checkStaleQuestions isActive gate', () => {
  it('inactive agent: returns skipped shape without calling readSheetRows', async () => {
    const agent = makeAgent({ isActive: false });

    const result = await checkStaleQuestions(agent);

    expect(result).toEqual({ skipped: 'inactive', remindersSent: 0, escalationsSent: 0, errors: [] });
    expect(email.readSheetRows).toHaveBeenCalledTimes(0);
  });

  it('active agent: calls readSheetRows (gate does not block)', async () => {
    const agent = makeAgent({ isActive: true });
    email.readSheetRows.mockResolvedValue([]);

    await checkStaleQuestions(agent);

    expect(email.readSheetRows).toHaveBeenCalledTimes(1);
  });
});
