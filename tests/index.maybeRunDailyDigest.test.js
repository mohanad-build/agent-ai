'use strict';

// ── Mock heavy index.js dependencies (order matters: before any require) ──────

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../src/agentConfig',   () => ({ loadAgent: jest.fn(), isLeadCategoryActionable: jest.fn() }));
jest.mock('../src/leadIntake',    () => ({ runLeadIntake: jest.fn(), transitionToIntaken: jest.fn() }));
jest.mock('../src/followUp',      () => ({ runFollowUps: jest.fn() }));
jest.mock('../src/outboundTracking', () => ({ trackOutbound: jest.fn() }));
jest.mock('../src/agentState',    () => ({
  getState: jest.fn(),
  setState: jest.fn(),
  issueToken: jest.fn(),
  incrementWeeklyPreflightSkips: jest.fn(),
  resetWeeklyPreflightSkips: jest.fn(),
  recordDailyDigestRun: jest.fn(),
  resetDailyNoiseFiltered: jest.fn(),
  resetDailyNoiseArchived: jest.fn(),
}));
jest.mock('../src/digest', () => ({
  shouldRunDailyDigest:        jest.fn().mockReturnValue(true),
  runDailyDigestForAgent:      jest.fn(),
  alertOperatorSheetUnavailable: jest.fn(),
  alertOperatorDealsUnavailable: jest.fn(),
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

const { maybeRunDailyDigest } = require('../src/index');
const agentStateMod = require('../src/agentState');
const { runDailyDigestForAgent, alertOperatorSheetUnavailable, alertOperatorDealsUnavailable } = require('../src/digest');

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

beforeEach(() => {
  jest.clearAllMocks();
  agentStateMod.getState.mockReturnValue({});
});

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('maybeRunDailyDigest', () => {
  test('9. sent brief with leads unavailable: alert called once with the agent and those leads, stamp written', async () => {
    const agent = makeAgent();
    const leads = { status: 'unavailable', errorKind: 'permission' };
    runDailyDigestForAgent.mockResolvedValue({ smsResult: 'sent', emailResult: 'sent', errors: [], leads });

    await maybeRunDailyDigest(agent);

    expect(alertOperatorSheetUnavailable).toHaveBeenCalledTimes(1);
    expect(alertOperatorSheetUnavailable).toHaveBeenCalledWith(agent, leads);
    expect(agentStateMod.recordDailyDigestRun).toHaveBeenCalledWith(agent.agentId, '2026-06-18T10:00:00.000Z');
  });

  test('10. sent brief with leads ok: alert not called', async () => {
    const agent = makeAgent();
    const leads = { status: 'ok', errorKind: null };
    runDailyDigestForAgent.mockResolvedValue({ smsResult: 'sent', emailResult: 'sent', errors: [], leads });

    await maybeRunDailyDigest(agent);

    expect(alertOperatorSheetUnavailable).not.toHaveBeenCalled();
    expect(agentStateMod.recordDailyDigestRun).toHaveBeenCalledWith(agent.agentId, '2026-06-18T10:00:00.000Z');
  });

  test('11. unavailable but both channels failed: alert not called, no stamp written', async () => {
    const agent = makeAgent();
    const leads = { status: 'unavailable', errorKind: 'permission' };
    runDailyDigestForAgent.mockResolvedValue({
      smsResult: 'failed',
      emailResult: 'failed',
      errors: [{ channel: 'sms', message: 'boom' }, { channel: 'email', message: 'boom' }],
      leads,
    });

    await maybeRunDailyDigest(agent);

    expect(alertOperatorSheetUnavailable).not.toHaveBeenCalled();
    expect(agentStateMod.recordDailyDigestRun).not.toHaveBeenCalled();
    expect(agentStateMod.resetDailyNoiseFiltered).not.toHaveBeenCalled();
    expect(agentStateMod.resetDailyNoiseArchived).not.toHaveBeenCalled();
  });

  test('12. alert rejects: maybeRunDailyDigest still resolves, stamp was written, failure logged as a sheet-alert failure not a digest failure', async () => {
    const agent = makeAgent();
    const leads = { status: 'unavailable', errorKind: 'permission' };
    runDailyDigestForAgent.mockResolvedValue({ smsResult: 'sent', emailResult: 'sent', errors: [], leads });
    alertOperatorSheetUnavailable.mockRejectedValue(new Error('alert boom'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await expect(maybeRunDailyDigest(agent)).resolves.toBeUndefined();

      expect(agentStateMod.recordDailyDigestRun).toHaveBeenCalledWith(agent.agentId, '2026-06-18T10:00:00.000Z');
      expect(errorSpy.mock.calls.some(args => String(args[0]).includes('daily digest failed'))).toBe(false);
      expect(logSpy.mock.calls.some(args => String(args[0]).includes('daily digest: sms=sent email=sent'))).toBe(true);
      expect(errorSpy.mock.calls.some(args => String(args[0]).includes('sheet alert failed'))).toBe(true);
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  test('13. one channel sent, one failed, leads ok: stamp and both resets written', async () => {
    const agent = makeAgent();
    const leads = { status: 'ok', errorKind: null };
    runDailyDigestForAgent.mockResolvedValue({
      smsResult: 'sent',
      emailResult: 'failed',
      errors: [{ channel: 'email', message: 'boom' }],
      leads,
    });

    await maybeRunDailyDigest(agent);

    expect(agentStateMod.recordDailyDigestRun).toHaveBeenCalledWith(agent.agentId, '2026-06-18T10:00:00.000Z');
    expect(agentStateMod.resetDailyNoiseFiltered).toHaveBeenCalledWith(agent.agentId);
    expect(agentStateMod.resetDailyNoiseArchived).toHaveBeenCalledWith(agent.agentId);
  });

  test('14. nothing_to_send: no stamp, no resets, no alert', async () => {
    const agent = makeAgent();
    const leads = { status: 'not_configured', errorKind: null };
    runDailyDigestForAgent.mockResolvedValue({ skipped: 'nothing_to_send', leads });

    await maybeRunDailyDigest(agent);

    expect(agentStateMod.recordDailyDigestRun).not.toHaveBeenCalled();
    expect(agentStateMod.resetDailyNoiseFiltered).not.toHaveBeenCalled();
    expect(agentStateMod.resetDailyNoiseArchived).not.toHaveBeenCalled();
    expect(alertOperatorSheetUnavailable).not.toHaveBeenCalled();
  });

  test('15. deals unreadable, both channels failed: deals alert still called', async () => {
    const agent = makeAgent();
    const deals = { status: 'unreadable', unreadable: [{ transactionId: 'txn-1', error: 'boom', stage: 'read' }] };
    runDailyDigestForAgent.mockResolvedValue({
      smsResult: 'failed',
      emailResult: 'failed',
      errors: [{ channel: 'sms', message: 'boom' }, { channel: 'email', message: 'boom' }],
      leads: { status: 'ok', errorKind: null },
      deals,
    });

    await maybeRunDailyDigest(agent);

    expect(alertOperatorDealsUnavailable).toHaveBeenCalledTimes(1);
    expect(alertOperatorDealsUnavailable).toHaveBeenCalledWith(agent, deals);
  });

  test('16. deals error status, brief sent normally: deals alert called', async () => {
    const agent = makeAgent();
    const deals = { status: 'error', error: 'ENOTDIR' };
    runDailyDigestForAgent.mockResolvedValue({
      smsResult: 'sent',
      emailResult: 'sent',
      errors: [],
      leads: { status: 'ok', errorKind: null },
      deals,
    });

    await maybeRunDailyDigest(agent);

    expect(alertOperatorDealsUnavailable).toHaveBeenCalledTimes(1);
    expect(alertOperatorDealsUnavailable).toHaveBeenCalledWith(agent, deals);
  });

  test('17. deals ok: deals alert not called', async () => {
    const agent = makeAgent();
    runDailyDigestForAgent.mockResolvedValue({
      smsResult: 'sent',
      emailResult: 'sent',
      errors: [],
      leads: { status: 'ok', errorKind: null },
      deals: { status: 'ok' },
    });

    await maybeRunDailyDigest(agent);

    expect(alertOperatorDealsUnavailable).not.toHaveBeenCalled();
  });

  test('18. deals absent (nothing_to_send skip): deals alert not called', async () => {
    const agent = makeAgent();
    runDailyDigestForAgent.mockResolvedValue({ skipped: 'nothing_to_send', leads: { status: 'not_configured', errorKind: null } });

    await maybeRunDailyDigest(agent);

    expect(alertOperatorDealsUnavailable).not.toHaveBeenCalled();
  });

  test('19. deals alert rejects: maybeRunDailyDigest still resolves and still logs the sms/email line', async () => {
    const agent = makeAgent();
    const deals = { status: 'error', error: 'ENOTDIR' };
    runDailyDigestForAgent.mockResolvedValue({
      smsResult: 'sent',
      emailResult: 'sent',
      errors: [],
      leads: { status: 'ok', errorKind: null },
      deals,
    });
    alertOperatorDealsUnavailable.mockRejectedValue(new Error('deals alert boom'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await expect(maybeRunDailyDigest(agent)).resolves.toBeUndefined();

      expect(errorSpy.mock.calls.some(args => String(args[0]).includes('daily digest failed'))).toBe(false);
      expect(logSpy.mock.calls.some(args => String(args[0]).includes('daily digest: sms=sent email=sent'))).toBe(true);
      expect(errorSpy.mock.calls.some(args => String(args[0]).includes('deals alert failed'))).toBe(true);
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
