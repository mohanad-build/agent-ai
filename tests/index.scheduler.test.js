'use strict';

// ── Mock all heavy index.js dependencies ─────────────────────────────────────

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
jest.mock('../src/operatorState', () => ({
  getState:               jest.fn(),
  setState:               jest.fn(),
  recordWeeklyDigestRun:  jest.fn(),
}));
jest.mock('../src/operatorConfig', () => ({
  loadOperator:                  jest.fn(),
  discoverOperatorIds:           jest.fn().mockReturnValue([]),
  validateAgentOperatorMappings: jest.fn().mockReturnValue({ orphans: [] }),
}));
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
  generateWeeklyAngles:    jest.fn(),
  shouldRunAngleGeneration: jest.fn(),
}));
jest.mock('../src/content/pullData', () => ({
  pullBankOfCanada:  jest.fn(),
  shouldRunDataPull: jest.fn(),
}));
jest.mock('../src/time', () => ({
  getNow:     jest.fn(),
  getNowIso:  jest.fn().mockReturnValue('2026-05-17T07:00:00.000Z'),
  getNowDate: jest.fn().mockReturnValue(new Date('2026-05-17T07:00:00.000Z')),
}));

// ── Pull in modules under test ────────────────────────────────────────────────

const fsp  = require('node:fs/promises');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { maybeRunDataPull, maybeRunWeeklyAngleGenerationJob } = require('../src/index');

const operatorState                         = require('../src/operatorState');
const { pullBankOfCanada, shouldRunDataPull } = require('../src/content/pullData');
const { generateWeeklyAngles, shouldRunAngleGeneration } = require('../src/content/angles');

// currentWeek is a real pure function -- used to compute the expected week ISO
// for the angle-gen file path from the mocked getNowDate value.
const { currentWeek } = require('../src/content/cache');
const MOCK_DATE = new Date('2026-05-17T07:00:00.000Z');
const MOCK_WEEK = currentWeek(MOCK_DATE); // '2026-W20'

// ── Helpers ───────────────────────────────────────────────────────────────────

const SUCCESS_RESULT = {
  success:        true,
  metricsWritten: ['boc_overnight_rate', 'boc_last_decision_date', 'goc_5yr_yield'],
  metricsFailed:  [],
  errors:         [],
  pulledAt:       '2026-05-17T07:00:00.000Z',
};

// ── maybeRunDataPull ──────────────────────────────────────────────────────────

describe('maybeRunDataPull', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    operatorState.getState.mockReturnValue({ lastWeeklyDigestRun: null });
  });

  it('does nothing when the time gate is closed', async () => {
    shouldRunDataPull.mockReturnValue(false);

    await maybeRunDataPull();

    expect(pullBankOfCanada).not.toHaveBeenCalled();
    expect(operatorState.setState).not.toHaveBeenCalled();
  });

  it('calls pullBankOfCanada and updates state when gate is open', async () => {
    shouldRunDataPull.mockReturnValue(true);
    pullBankOfCanada.mockResolvedValue(SUCCESS_RESULT);

    await maybeRunDataPull();

    expect(pullBankOfCanada).toHaveBeenCalledTimes(1);
    expect(operatorState.setState).toHaveBeenCalledWith(
      'mo',
      expect.objectContaining({ lastDataPullAt: '2026-05-17T07:00:00.000Z' }),
    );
  });

  it('logs success format on success', async () => {
    shouldRunDataPull.mockReturnValue(true);
    pullBankOfCanada.mockResolvedValue(SUCCESS_RESULT);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await maybeRunDataPull();

    expect(logSpy).toHaveBeenCalledWith(
      '[scheduler] data-pull: success metricsWritten=3',
    );
    logSpy.mockRestore();
  });

  it('logs failure format and does not update state when pullBankOfCanada throws', async () => {
    shouldRunDataPull.mockReturnValue(true);
    pullBankOfCanada.mockRejectedValue(new Error('network timeout'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await maybeRunDataPull();

    expect(errSpy).toHaveBeenCalledWith(
      '[scheduler] data-pull: failed err=network timeout',
    );
    expect(operatorState.setState).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('logs failure format and does not update state when result.success is false', async () => {
    shouldRunDataPull.mockReturnValue(true);
    pullBankOfCanada.mockResolvedValue({
      success:        false,
      metricsWritten: [],
      metricsFailed:  ['boc_overnight_rate'],
      errors:         [{ metric: 'boc_overnight_rate', error: 'HTTP 503' }],
      pulledAt:       '2026-05-17T07:00:00.000Z',
    });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await maybeRunDataPull();

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[scheduler\] data-pull: failed/),
    );
    expect(operatorState.setState).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

// ── maybeRunWeeklyAngleGenerationJob ─────────────────────────────────────────

describe('maybeRunWeeklyAngleGenerationJob', () => {
  let tmpDir;

  beforeEach(async () => {
    jest.clearAllMocks();
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'angle-sched-'));
    process.env.STORAGE_ROOT = tmpDir;
  });

  afterEach(async () => {
    delete process.env.STORAGE_ROOT;
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('does nothing when the time gate is closed', async () => {
    shouldRunAngleGeneration.mockReturnValue(false);

    await maybeRunWeeklyAngleGenerationJob();

    expect(generateWeeklyAngles).not.toHaveBeenCalled();
  });

  it('logs skip and does not call generateWeeklyAngles when angle file already exists', async () => {
    shouldRunAngleGeneration.mockReturnValue(true);
    const anglesDir = path.join(tmpDir, '_market', '_angles');
    fs.mkdirSync(anglesDir, { recursive: true });
    fs.writeFileSync(path.join(anglesDir, `${MOCK_WEEK}.json`), '{}', 'utf8');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await maybeRunWeeklyAngleGenerationJob();

    expect(generateWeeklyAngles).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      `[scheduler] angle-gen: skipped (already exists for week ${MOCK_WEEK})`,
    );
    logSpy.mockRestore();
  });

  it('calls generateWeeklyAngles when angle file does not exist', async () => {
    shouldRunAngleGeneration.mockReturnValue(true);
    generateWeeklyAngles.mockResolvedValue({
      angles:   [{ surpriseScore: 0.72 }, { surpriseScore: 0.55 }],
      weekIso:  MOCK_WEEK,
      generatedAt: '2026-05-17T08:00:00.000Z',
      regenerated: true,
    });

    await maybeRunWeeklyAngleGenerationJob();

    expect(generateWeeklyAngles).toHaveBeenCalledWith({});
  });

  it('logs success format on success', async () => {
    shouldRunAngleGeneration.mockReturnValue(true);
    generateWeeklyAngles.mockResolvedValue({
      angles:   [{ surpriseScore: 0.72 }, { surpriseScore: 0.55 }],
      weekIso:  MOCK_WEEK,
      generatedAt: '2026-05-17T08:00:00.000Z',
      regenerated: true,
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await maybeRunWeeklyAngleGenerationJob();

    expect(logSpy).toHaveBeenCalledWith(
      `[scheduler] angle-gen: success week=${MOCK_WEEK} angles=2 topScore=0.72`,
    );
    logSpy.mockRestore();
  });

  it('logs failure format and does not rethrow when generateWeeklyAngles throws', async () => {
    shouldRunAngleGeneration.mockReturnValue(true);
    generateWeeklyAngles.mockRejectedValue(new Error('Claude API timeout'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(maybeRunWeeklyAngleGenerationJob()).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalledWith(
      '[scheduler] angle-gen: failed err=Claude API timeout',
    );
    errSpy.mockRestore();
  });
});
