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
  pathHotSignal:    jest.fn(),
  pathStopSignal:   jest.fn(),
  pathAskAgent:     jest.fn(),
  pathAnswerGeneral: jest.fn(),
  pathNeedsReview:  jest.fn(),
}));

// ── Content engine mocks ───────────────────────────────────────────────────────

jest.mock('../src/content/engine', () => ({
  runContentEngineForAgent: jest.fn(),
  shouldRunContentEngine:   jest.fn(),
}));

jest.mock('../src/content/profile', () => ({
  readContentProfile: jest.fn(),
}));

jest.mock('../src/content/state', () => ({
  readContentState:  jest.fn(),
  recordBatchSent:   jest.fn(),
}));

jest.mock('../src/time', () => ({
  getNow:     jest.fn(),
  getNowIso:  jest.fn().mockReturnValue('2026-05-19T07:00:00.000Z'),
  getNowDate: jest.fn().mockReturnValue(new Date('2026-05-18T07:00:00.000Z')),
}));

// ── Pull in the module under test ─────────────────────────────────────────────

const { maybeRunContentEngine } = require('../src/index');

const { runContentEngineForAgent, shouldRunContentEngine } = require('../src/content/engine');
const { readContentProfile }                               = require('../src/content/profile');
const { readContentState, recordBatchSent }                = require('../src/content/state');
const { getNowDate, getNowIso }                            = require('../src/time');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAgent(overrides = {}) {
  return { agentId: 'mo-test', timezone: 'America/Toronto', isActive: true, ...overrides };
}

function makeContentProfile(overrides = {}) {
  return {
    contentEngineEnabled: true,
    contentEngineMode:    'shadow',
    deliveryDay:          'monday',
    deliveryTime:         '07:00',
    ...overrides,
  };
}

function makeContentState(overrides = {}) {
  return {
    agentId:               'mo-test',
    schemaVersion:         1,
    lastContentBatchSent:  null,
    batches:               {},
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  getNowDate.mockReturnValue(new Date('2026-05-18T07:00:00.000Z'));
  getNowIso.mockReturnValue('2026-05-18T07:00:00.000Z');
});

describe('maybeRunContentEngine', () => {
  it('1: shouldRunContentEngine returns false → engine not called, state not updated', async () => {
    readContentProfile.mockReturnValue(makeContentProfile());
    readContentState.mockReturnValue(makeContentState());
    shouldRunContentEngine.mockReturnValue(false);

    await maybeRunContentEngine(makeAgent());

    expect(runContentEngineForAgent).not.toHaveBeenCalled();
    expect(recordBatchSent).not.toHaveBeenCalled();
  });

  it('2: engine returns sent:true → recordBatchSent called with agentId and batchWeekIso', async () => {
    readContentProfile.mockReturnValue(makeContentProfile());
    readContentState.mockReturnValue(makeContentState());
    shouldRunContentEngine.mockReturnValue(true);
    runContentEngineForAgent.mockResolvedValue({
      ok: true, sent: true, batchWeekIso: '2026-W21', pieceResults: [], errors: [],
    });

    await maybeRunContentEngine(makeAgent());

    expect(recordBatchSent).toHaveBeenCalledTimes(1);
    expect(recordBatchSent).toHaveBeenCalledWith('mo-test', '2026-W21', '2026-05-18T07:00:00.000Z');
  });

  it('3: engine returns sent:false skipped:all-failed → recordBatchSent NOT called', async () => {
    readContentProfile.mockReturnValue(makeContentProfile());
    readContentState.mockReturnValue(makeContentState());
    shouldRunContentEngine.mockReturnValue(true);
    runContentEngineForAgent.mockResolvedValue({
      ok: true, sent: false, skipped: 'all-failed', batchWeekIso: '2026-W21', pieceResults: [], errors: [],
    });

    await maybeRunContentEngine(makeAgent());

    expect(recordBatchSent).not.toHaveBeenCalled();
  });

  it('4: engine returns ok:false skipped:no-angles → recordBatchSent NOT called', async () => {
    readContentProfile.mockReturnValue(makeContentProfile());
    readContentState.mockReturnValue(makeContentState());
    shouldRunContentEngine.mockReturnValue(true);
    runContentEngineForAgent.mockResolvedValue({
      ok: false, skipped: 'no-angles', batchWeekIso: '2026-W21',
    });

    await maybeRunContentEngine(makeAgent());

    expect(recordBatchSent).not.toHaveBeenCalled();
  });

  it('5: readContentProfile returns null → returns silently, engine not called', async () => {
    readContentProfile.mockReturnValue(null);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await maybeRunContentEngine(makeAgent());

    expect(runContentEngineForAgent).not.toHaveBeenCalled();
    expect(recordBatchSent).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('6: readContentProfile throws a generic Error → outer catch logs and returns without rethrowing', async () => {
    const boom = new Error('EACCES permission denied');
    readContentProfile.mockImplementation(() => { throw boom; });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(maybeRunContentEngine(makeAgent())).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('mo-test'),
      boom.message,
    );
    expect(runContentEngineForAgent).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('7: runContentEngineForAgent throws → outer catch logs, no state update', async () => {
    readContentProfile.mockReturnValue(makeContentProfile());
    readContentState.mockReturnValue(makeContentState());
    shouldRunContentEngine.mockReturnValue(true);
    const boom = new Error('Claude API timeout');
    runContentEngineForAgent.mockRejectedValue(boom);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(maybeRunContentEngine(makeAgent())).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('mo-test'),
      boom.message,
    );
    expect(recordBatchSent).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
