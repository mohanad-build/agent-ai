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
jest.mock('../src/email',   () => ({}));
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

jest.mock('../src/content/state', () => ({
  readContentState: jest.fn(),
  recordBatchSent:  jest.fn(),
}));

jest.mock('../src/content/profile', () => ({
  readContentProfile:     jest.fn(),
  isContentEngineEnabled: jest.fn(),
}));

jest.mock('../src/content/angles', () => ({
  generateWeeklyAngles: jest.fn(),
}));

jest.mock('../src/content/evergreenAngles', () => ({
  generateEvergreenAngles: jest.fn(),
  evergreenAnglesFilePath: jest.fn(),
}));

jest.mock('../src/time', () => ({
  getNow:     jest.fn(),
  getNowIso:  jest.fn().mockReturnValue('2026-05-17T07:00:00.000Z'),
  getNowDate: jest.fn().mockReturnValue(new Date('2026-05-17T07:00:00.000Z')),
}));

// ── Pull in the module under test ─────────────────────────────────────────────

const { maybeRunAngleGeneration } = require('../src/index');

const { generateWeeklyAngles }  = require('../src/content/angles');
const { isContentEngineEnabled } = require('../src/content/profile');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAgent(overrides = {}) {
  return { agentId: 'mo-test', timezone: 'America/Toronto', isActive: true, ...overrides };
}

// Sunday 2026-05-17 07:00 UTC = Sunday 03:00 America/Toronto
const SUNDAY_UTC  = new Date('2026-05-17T07:00:00.000Z');
// Monday 2026-05-18 07:00 UTC = Monday 03:00 America/Toronto
const MONDAY_UTC  = new Date('2026-05-18T07:00:00.000Z');

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  isContentEngineEnabled.mockResolvedValue(true);
  generateWeeklyAngles.mockResolvedValue({ regenerated: true, weekIso: '2026-W21' });
});

describe('maybeRunAngleGeneration', () => {
  it('1: isContentEngineEnabled returns false → generateWeeklyAngles not called, disabled logged', async () => {
    isContentEngineEnabled.mockResolvedValue(false);
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await maybeRunAngleGeneration(makeAgent(), SUNDAY_UTC);

    expect(generateWeeklyAngles).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('skipped (disabled)'),
    );
    consoleSpy.mockRestore();
  });

  it('2: day is Monday → generateWeeklyAngles not called, not-Sunday logged', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await maybeRunAngleGeneration(makeAgent(), MONDAY_UTC);

    expect(generateWeeklyAngles).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('not Sunday in America/Toronto'),
    );
    consoleSpy.mockRestore();
  });

  it('3: Sunday + enabled → generateWeeklyAngles called with { now }', async () => {
    await maybeRunAngleGeneration(makeAgent(), SUNDAY_UTC);

    expect(generateWeeklyAngles).toHaveBeenCalledTimes(1);
    expect(generateWeeklyAngles).toHaveBeenCalledWith({ now: SUNDAY_UTC });
  });

  it('4: Sunday + enabled + regenerated:true → logs "generated"', async () => {
    generateWeeklyAngles.mockResolvedValue({ regenerated: true, weekIso: '2026-W21' });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await maybeRunAngleGeneration(makeAgent(), SUNDAY_UTC);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringMatching(/mo-test.*generated.*2026-W21/),
    );
    consoleSpy.mockRestore();
  });

  it('5: Sunday + enabled + regenerated:false → logs "unchanged"', async () => {
    generateWeeklyAngles.mockResolvedValue({ regenerated: false, weekIso: '2026-W21' });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await maybeRunAngleGeneration(makeAgent(), SUNDAY_UTC);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringMatching(/mo-test.*unchanged.*2026-W21/),
    );
    consoleSpy.mockRestore();
  });

  it('6: generateWeeklyAngles throws → error logged, exception not rethrown', async () => {
    const boom = new Error('Claude API timeout');
    generateWeeklyAngles.mockRejectedValue(boom);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(maybeRunAngleGeneration(makeAgent(), SUNDAY_UTC)).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('mo-test') && expect.stringContaining(boom.message),
    );
    consoleSpy.mockRestore();
  });

  it('7: agent without timezone → defaults to America/Toronto, Sunday still fires', async () => {
    const agentNoTz = makeAgent({ timezone: undefined });

    await maybeRunAngleGeneration(agentNoTz, SUNDAY_UTC);

    expect(generateWeeklyAngles).toHaveBeenCalledTimes(1);
  });
});
