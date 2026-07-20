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
jest.mock('../src/operatorConfig', () => ({
  loadOperator:                  jest.fn(),
  discoverOperatorIds:           jest.fn().mockReturnValue([]),
  validateAgentOperatorMappings: jest.fn().mockReturnValue({ ok: true, orphans: [], missingOperators: [] }),
}));
jest.mock('../src/email', () => ({
  readSheetRows:              jest.fn().mockResolvedValue([]),
  updateSheetRow:             jest.fn(),
  appendToConversationHistory: jest.fn(),
}));
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
  shouldRunContentEngine:   jest.fn().mockReturnValue(false),
}));
jest.mock('../src/content/profile', () => ({
  readContentProfile:     jest.fn(),
  isContentEngineEnabled: jest.fn().mockReturnValue(false),
}));
jest.mock('../src/content/angles', () => ({
  generateWeeklyAngles: jest.fn(),
}));
jest.mock('../src/content/evergreenAngles', () => ({
  generateEvergreenAngles: jest.fn(),
  evergreenAnglesFilePath: jest.fn(),
}));
jest.mock('../src/content/state', () => ({
  readContentState: jest.fn(),
  recordBatchSent:  jest.fn(),
}));
jest.mock('../src/time', () => ({
  getNow:     jest.fn().mockReturnValue(1750240800000),
  getNowIso:  jest.fn().mockReturnValue('2026-06-18T10:00:00.000Z'),
  getNowDate: jest.fn().mockReturnValue(new Date('2026-06-18T10:00:00.000Z')),
}));
jest.mock('../src/content/actionHandler', () => ({
  runActionHandler: jest.fn().mockResolvedValue(undefined),
}));

// ── Pull in the module under test ─────────────────────────────────────────────

const { runCycle } = require('../src/index');
const { loadAgent } = require('../src/agentConfig');
const { runLeadIntake } = require('../src/leadIntake');
const { runFollowUps } = require('../src/followUp');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAgent(overrides = {}) {
  return {
    agentId:            'test-agent',
    isActive:           true,
    googleRefreshToken: 'tok_valid',
    operatorId:         'op1',
    timezone:           'America/Toronto',
    ...overrides,
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  process.env.AGENT_ID = 'test-agent';
});

afterEach(() => {
  delete process.env.AGENT_ID;
});

describe('runCycle: googleRefreshToken guard', () => {
  it('1a: empty googleRefreshToken → skipped, no processing, correct log line', async () => {
    loadAgent.mockReturnValue(makeAgent({ googleRefreshToken: '' }));
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runCycle();

    expect(runLeadIntake).not.toHaveBeenCalled();
    expect(runFollowUps).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      '[test-agent] skipped: no Google authorization (refreshToken empty)',
    );
    logSpy.mockRestore();
  });

  it('1b: null googleRefreshToken → skipped, no processing, correct log line', async () => {
    loadAgent.mockReturnValue(makeAgent({ googleRefreshToken: null }));
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runCycle();

    expect(runLeadIntake).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      '[test-agent] skipped: no Google authorization (refreshToken empty)',
    );
    logSpy.mockRestore();
  });

  it('1c: missing googleRefreshToken field → skipped, no processing, correct log line', async () => {
    const { googleRefreshToken: _omit, ...agentNoToken } = makeAgent();
    loadAgent.mockReturnValue(agentNoToken);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runCycle();

    expect(runLeadIntake).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      '[test-agent] skipped: no Google authorization (refreshToken empty)',
    );
    logSpy.mockRestore();
  });

  it('2: valid googleRefreshToken → processing runs normally (runLeadIntake called)', async () => {
    loadAgent.mockReturnValue(makeAgent({ googleRefreshToken: 'tok_valid_xyz', googleSheetId: 'sheet-abc' }));
    runLeadIntake.mockResolvedValue({
      candidates: 0, leads: 0, noise: 0, businessCorrespondence: 0, errors: 0,
    });
    runFollowUps.mockResolvedValue({
      eligible: 0, fired: 0, threadingMismatchSkipped: 0, errors: 0,
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await runCycle();

    expect(runLeadIntake).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });
});
