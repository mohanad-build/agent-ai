'use strict';

const fs = require('node:fs');

jest.mock('../src/content/angles',              () => ({ readWeeklyAngles: jest.fn() }));
jest.mock('../src/content/profile',             () => ({ readContentProfile: jest.fn() }));
jest.mock('../src/content/state',               () => ({
  readContentState:  jest.fn(),
  initBatch:         jest.fn(),
  buildAgentHistory: jest.fn(),
  recordBatchSent:   jest.fn(),
}));
jest.mock('../src/content/selectDefaults',      () => ({ selectDefaults: jest.fn() }));
jest.mock('../src/content/renderReelScript',    () => ({ renderReelScript: jest.fn() }));
jest.mock('../src/content/renderInstagramCaption', () => ({ renderInstagramCaption: jest.fn() }));
jest.mock('../src/content/renderBlogPost',      () => ({ renderBlogPost: jest.fn() }));
jest.mock('../src/content/reviewEmail',         () => ({ composeReviewEmail: jest.fn() }));
jest.mock('../src/email',                       () => ({ sendNewEmail: jest.fn() }));
jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  appendFileSync: jest.fn(),
}));

const { readWeeklyAngles }     = require('../src/content/angles');
const { readContentProfile }   = require('../src/content/profile');
const { readContentState, initBatch, buildAgentHistory, recordBatchSent } = require('../src/content/state');
const { selectDefaults }       = require('../src/content/selectDefaults');
const { renderReelScript }     = require('../src/content/renderReelScript');
const { renderInstagramCaption } = require('../src/content/renderInstagramCaption');
const { renderBlogPost }       = require('../src/content/renderBlogPost');
const { composeReviewEmail }   = require('../src/content/reviewEmail');
const { sendNewEmail }         = require('../src/email');

const {
  runContentEngineForAgent,
  shouldRunContentEngine,
  _internal,
} = require('../src/content/engine');

const { assignPieceIds, renderPiece, assembleBatchObject, _sendWithRetry } = _internal;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const WEEK_ISO = '2026-W21';

const operatorConfig = {
  operatorId:    'test-operator',
  operatorEmail: 'operator@test.example.com',
  operatorPhone: '+15555550100',
};

function makeAgent(overrides = {}) {
  return {
    agentId:        'mo-test',
    firstName:      'Mo',
    gmailAddress:   'agent@example.com',
    escalationEmail: 'operator@example.com',
    timezone:       'America/Toronto',
    isActive:       true,
    ...overrides,
  };
}

function makeContentProfile(overrides = {}) {
  return {
    contentEngineEnabled: true,
    contentEngineMode:    'shadow',
    deliveryTime:         '07:00',
    primaryFocus:         'buyers',
    contentVolume:        'balanced',
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

function makeAngle(id, overrides = {}) {
  return {
    id,
    headline:         `Headline for ${id}`,
    themeTag:         'rates',
    longFormSuitable: true,
    forbidsRateAdvice: false,
    bestSuitedFor:    ['reel'],
    surpriseScore:    5,
    audienceFocus:    'buyers',
    thesis:           'Rates are interesting',
    dataPoints:       [],
    sourceFooter:     'Source: test',
    ...overrides,
  };
}

function makeWeeklyAngles(angleCount = 5) {
  return {
    weekIso: WEEK_ISO,
    angles:  Array.from({ length: angleCount }, (_, i) =>
      makeAngle(`angle-${String(i + 1).padStart(3, '0')}`)
    ),
  };
}

function makeScript() {
  return { text: 'Hook\n\nBody\n\nCTA', generatedAt: '2026-05-19T07:00:00.000Z' };
}

function makeCaption() {
  return { text: 'Caption text #hashtag', generatedAt: '2026-05-19T07:00:10.000Z' };
}

function makeBlog() {
  return { text: '# Blog post\n\nBody text.', generatedAt: '2026-05-19T07:00:05.000Z' };
}

function makePicks(opts = {}) {
  const angles = makeWeeklyAngles(5).angles;
  return {
    reelDefaults: opts.reels !== undefined ? opts.reels : [angles[0], angles[1]],
    blogDefault:  opts.blog  !== undefined ? opts.blog  : angles[2],
    remaining:    opts.remaining !== undefined ? opts.remaining : [angles[3], angles[4]],
  };
}

function setupHappyPath() {
  readContentProfile.mockReturnValue(makeContentProfile());
  readContentState.mockReturnValue(makeContentState());
  buildAgentHistory.mockReturnValue({ recentThemeTags: [], rejectedRateContent: false });
  readWeeklyAngles.mockResolvedValue(makeWeeklyAngles());
  selectDefaults.mockReturnValue(makePicks());
  renderReelScript.mockResolvedValue(makeScript());
  renderInstagramCaption.mockResolvedValue(makeCaption());
  renderBlogPost.mockResolvedValue(makeBlog());
  composeReviewEmail.mockReturnValue({ subject: 'Test subject', text: 'Text body', html: '<p>html</p>' });
  sendNewEmail.mockResolvedValue(undefined);
  initBatch.mockReturnValue({});
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

// ── 1. Early skip paths ───────────────────────────────────────────────────────

describe('Early skip paths', () => {
  test('inactive agent returns { skipped: "inactive" }', async () => {
    const result = await runContentEngineForAgent(makeAgent({ isActive: false }), { operatorConfig });
    expect(result).toEqual({ skipped: 'inactive' });
    expect(readContentProfile).not.toHaveBeenCalled();
  });

  test('contentEngineEnabled: false returns { skipped: "disabled" }', async () => {
    readContentProfile.mockReturnValue(makeContentProfile({ contentEngineEnabled: false }));
    const result = await runContentEngineForAgent(makeAgent(), { operatorConfig });
    expect(result).toEqual({ skipped: 'disabled' });
    expect(readWeeklyAngles).not.toHaveBeenCalled();
  });

  test('readContentProfile throwing propagates the error', async () => {
    readContentProfile.mockImplementation(() => { throw new Error('profile corrupt'); });
    await expect(runContentEngineForAgent(makeAgent(), { operatorConfig })).rejects.toThrow('profile corrupt');
  });

  test('missing angle file returns { skipped: "no-angles", batchWeekIso }', async () => {
    readContentProfile.mockReturnValue(makeContentProfile());
    readWeeklyAngles.mockResolvedValue(null);
    const result = await runContentEngineForAgent(makeAgent(), { operatorConfig });
    expect(result.skipped).toBe('no-angles');
    expect(typeof result.batchWeekIso).toBe('string');
    expect(fs.appendFileSync).toHaveBeenCalled();
  });

  test('readWeeklyAngles throwing returns { skipped: "no-angles", batchWeekIso }', async () => {
    readContentProfile.mockReturnValue(makeContentProfile());
    readWeeklyAngles.mockRejectedValue(new Error('disk error'));
    const result = await runContentEngineForAgent(makeAgent(), { operatorConfig });
    expect(result.skipped).toBe('no-angles');
    expect(fs.appendFileSync).toHaveBeenCalled();
  });

  test('batch already sent for this weekIso returns { skipped: "already-sent", batchWeekIso }', async () => {
    readContentProfile.mockReturnValue(makeContentProfile());
    readWeeklyAngles.mockResolvedValue(makeWeeklyAngles());
    const sentAt = '2026-05-18T07:00:00.000Z';
    readContentState.mockReturnValue(makeContentState({
      batches: { [WEEK_ISO]: { sentAt, availableAngles: [], pieces: {} } },
    }));
    buildAgentHistory.mockReturnValue({ recentThemeTags: [], rejectedRateContent: false });
    const result = await runContentEngineForAgent(makeAgent(), { operatorConfig });
    expect(result.skipped).toBe('already-sent');
    expect(typeof result.batchWeekIso).toBe('string');
    expect(sendNewEmail).not.toHaveBeenCalled();
  });

  test('all pieces fail to render returns { skipped: "all-failed", sent: false }', async () => {
    setupHappyPath();
    renderReelScript.mockRejectedValue(new Error('claude timeout'));
    renderBlogPost.mockRejectedValue(new Error('claude timeout'));
    const result = await runContentEngineForAgent(makeAgent(), { operatorConfig });
    expect(result.skipped).toBe('all-failed');
    expect(result.sent).toBe(false);
    expect(sendNewEmail).not.toHaveBeenCalled();
  });
});

// ── 2. assignPieceIds ─────────────────────────────────────────────────────────

describe('assignPieceIds', () => {
  const a1 = makeAngle('a1');
  const a2 = makeAngle('a2');
  const a3 = makeAngle('a3');

  test('2 reels + 1 blog -> [reel-001, reel-002, blog-001]', () => {
    const result = assignPieceIds({ reelDefaults: [a1, a2], blogDefault: a3, remaining: [] });
    expect(result.map(r => r.pieceId)).toEqual(['reel-001', 'reel-002', 'blog-001']);
  });

  test('1 reel + 1 blog -> [reel-001, blog-001]', () => {
    const result = assignPieceIds({ reelDefaults: [a1], blogDefault: a2, remaining: [] });
    expect(result.map(r => r.pieceId)).toEqual(['reel-001', 'blog-001']);
  });

  test('1 reel only -> [reel-001]', () => {
    const result = assignPieceIds({ reelDefaults: [a1], blogDefault: null, remaining: [] });
    expect(result.map(r => r.pieceId)).toEqual(['reel-001']);
  });

  test('1 blog only -> [blog-001]', () => {
    const result = assignPieceIds({ reelDefaults: [], blogDefault: a1, remaining: [] });
    expect(result.map(r => r.pieceId)).toEqual(['blog-001']);
  });

  test('empty picks -> []', () => {
    const result = assignPieceIds({ reelDefaults: [], blogDefault: null, remaining: [] });
    expect(result).toEqual([]);
  });

  test('each entry has correct type', () => {
    const result = assignPieceIds({ reelDefaults: [a1, a2], blogDefault: a3, remaining: [] });
    expect(result[0].type).toBe('reel');
    expect(result[1].type).toBe('reel');
    expect(result[2].type).toBe('blog');
  });
});

// ── 3. renderPiece ────────────────────────────────────────────────────────────

describe('renderPiece', () => {
  beforeEach(() => jest.clearAllMocks());

  const angle = makeAngle('angle-001');
  const profile = makeContentProfile();

  test('reel happy path: returns { id, type, angle, reel: { script, caption } }', async () => {
    const script  = makeScript();
    const caption = makeCaption();
    renderReelScript.mockResolvedValue(script);
    renderInstagramCaption.mockResolvedValue(caption);

    const result = await renderPiece({ pieceId: 'reel-001', type: 'reel', angle }, profile);
    expect(result.id).toBe('reel-001');
    expect(result.type).toBe('reel');
    expect(result.angle).toBe(angle);
    expect(result.reel.script).toBe(script);
    expect(result.reel.caption).toBe(caption);
  });

  test('blog happy path: returns { id, type, angle, blog }', async () => {
    const blog = makeBlog();
    renderBlogPost.mockResolvedValue(blog);

    const result = await renderPiece({ pieceId: 'blog-001', type: 'blog', angle }, profile);
    expect(result.id).toBe('blog-001');
    expect(result.type).toBe('blog');
    expect(result.blog).toBe(blog);
  });

  test('reel script fails: throws; renderInstagramCaption NOT called', async () => {
    renderReelScript.mockRejectedValue(new Error('script failed'));

    await expect(renderPiece({ pieceId: 'reel-001', type: 'reel', angle }, profile))
      .rejects.toThrow('script failed');
    expect(renderInstagramCaption).not.toHaveBeenCalled();
  });

  test('reel caption fails: throws (whole piece fails)', async () => {
    renderReelScript.mockResolvedValue(makeScript());
    renderInstagramCaption.mockRejectedValue(new Error('caption failed'));

    await expect(renderPiece({ pieceId: 'reel-001', type: 'reel', angle }, profile))
      .rejects.toThrow('caption failed');
  });
});

// ── 4. shouldRunContentEngine ─────────────────────────────────────────────────

describe('shouldRunContentEngine', () => {
  const agent   = makeAgent({ timezone: 'America/Toronto' });
  const profile = makeContentProfile({ deliveryTime: '07:00' });

  function makeState(lastSent = null) {
    return { lastContentBatchSent: lastSent };
  }

  // Monday 2026-05-18 is indeed a Monday
  const MONDAY_0700 = new Date('2026-05-18T11:00:00.000Z'); // 07:00 EDT (UTC-4)
  const MONDAY_0630 = new Date('2026-05-18T10:30:00.000Z'); // 06:30 EDT
  const MONDAY_0830 = new Date('2026-05-18T12:30:00.000Z'); // 08:30 EDT
  const TUESDAY_0700 = new Date('2026-05-19T11:00:00.000Z'); // Tuesday
  const SUNDAY_0700  = new Date('2026-05-17T11:00:00.000Z'); // Sunday

  test('Monday at 07:00 Toronto with no prior batch: true', () => {
    expect(shouldRunContentEngine(agent, profile, MONDAY_0700, makeState())).toBe(true);
  });

  test('Monday at 06:30 Toronto: false (too early)', () => {
    expect(shouldRunContentEngine(agent, profile, MONDAY_0630, makeState())).toBe(false);
  });

  test('Monday at 08:30 Toronto with no prior batch: false (outside 1h grace)', () => {
    expect(shouldRunContentEngine(agent, profile, MONDAY_0830, makeState())).toBe(false);
  });

  test('Tuesday at 07:00: false (not Monday)', () => {
    expect(shouldRunContentEngine(agent, profile, TUESDAY_0700, makeState())).toBe(false);
  });

  test('Sunday at 07:00: false (not Monday)', () => {
    expect(shouldRunContentEngine(agent, profile, SUNDAY_0700, makeState())).toBe(false);
  });

  test('Monday at 07:30, last batch sent 3 days ago: false (within idempotency)', () => {
    const now = new Date('2026-05-18T11:30:00.000Z'); // 07:30 EDT
    const lastSent = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldRunContentEngine(agent, profile, now, makeState(lastSent))).toBe(false);
  });

  test('Monday at 07:30, last batch sent 7 days ago: true', () => {
    const now = new Date('2026-05-18T11:30:00.000Z'); // 07:30 EDT
    const lastSent = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldRunContentEngine(agent, profile, now, makeState(lastSent))).toBe(true);
  });

  test('Monday at 07:30, lastContentBatchSent is null: true', () => {
    const now = new Date('2026-05-18T11:30:00.000Z');
    expect(shouldRunContentEngine(agent, profile, now, makeState(null))).toBe(true);
  });

  test('DST safety: Monday morning during spring-forward still fires', () => {
    // 2026-03-09 is a Monday; clocks spring forward Mar 8 (Sunday) in Toronto
    // At 07:00 EDT (UTC-4): 11:00 UTC
    const monday = new Date('2026-03-09T12:00:00.000Z'); // 07:00 EST (UTC-5 still on Mon)
    // EST is UTC-5, so 07:00 EST = 12:00 UTC
    expect(shouldRunContentEngine(agent, profile, monday, makeState(null))).toBe(true);
  });

  test('Vancouver timezone: fires at 07:00 PST, not 07:00 EST', () => {
    const vanAgent = makeAgent({ timezone: 'America/Vancouver' });
    // Monday 2026-05-18 at 07:00 PDT = 14:00 UTC
    const now = new Date('2026-05-18T14:00:00.000Z'); // 07:00 PDT
    expect(shouldRunContentEngine(vanAgent, profile, now, makeState(null))).toBe(true);
    // Same moment is 10:00 EDT -- should NOT fire for EST agent
    expect(shouldRunContentEngine(agent, profile, now, makeState(null))).toBe(false);
  });
});

// ── 5. runContentEngineForAgent -- happy path ─────────────────────────────────

describe('runContentEngineForAgent -- happy path', () => {
  beforeEach(() => {
    setupHappyPath();
  });

  test('2 reels + 1 blog succeed: returns { ok: true, sent: true, 3 pieceResults }', async () => {
    const result = await runContentEngineForAgent(makeAgent(), { operatorConfig });
    expect(result.ok).toBe(true);
    expect(result.sent).toBe(true);
    expect(result.pieceResults).toHaveLength(3);
    expect(result.pieceResults.every(r => r.status === 'ok')).toBe(true);
    expect(sendNewEmail).toHaveBeenCalledTimes(1);
  });

  test('initBatch called with correct shape (piecesForState and availableAngles)', async () => {
    await runContentEngineForAgent(makeAgent(), { operatorConfig });
    expect(initBatch).toHaveBeenCalledTimes(1);
    const [, , payload] = initBatch.mock.calls[0];
    expect(Array.isArray(payload.pieces)).toBe(true);
    expect(payload.pieces).toHaveLength(3);
    expect(Array.isArray(payload.availableAngles)).toBe(true);
    // availableAngles = full menu from weeklyAngles.angles
    expect(payload.availableAngles).toHaveLength(5);
    // Each piece has id, angleId, themeTag, forbidsRateAdvice, initialVersion
    const piece = payload.pieces[0];
    expect(typeof piece.id).toBe('string');
    expect(typeof piece.angleId).toBe('string');
    expect(typeof piece.themeTag).toBe('string');
    expect(typeof piece.forbidsRateAdvice).toBe('boolean');
    expect(piece.initialVersion.claudeCallId).toBeNull();
  });

  test('composeReviewEmail called with correct batch shape', async () => {
    await runContentEngineForAgent(makeAgent(), { operatorConfig });
    expect(composeReviewEmail).toHaveBeenCalledTimes(1);
    const [batch] = composeReviewEmail.mock.calls[0];
    expect(Array.isArray(batch.pieces)).toBe(true);
    expect(batch.pieces).toHaveLength(3);
    // otherAngles = picks.remaining (2 angles in makePicks default)
    expect(Array.isArray(batch.otherAngles)).toBe(true);
    expect(batch.otherAngles).toHaveLength(2);
    expect(batch.headsUp).toEqual([]);
  });

  test('errors array is empty on happy path', async () => {
    const result = await runContentEngineForAgent(makeAgent(), { operatorConfig });
    expect(result.errors).toEqual([]);
  });
});

// ── 6. runContentEngineForAgent -- failure paths ──────────────────────────────

describe('runContentEngineForAgent -- failure paths', () => {
  beforeEach(() => setupHappyPath());

  test('1 reel succeeds, 1 reel fails: headsUp has message, email sent, pieceResults has 1 ok + 1 failed', async () => {
    renderReelScript
      .mockResolvedValueOnce(makeScript())   // reel-001 ok
      .mockRejectedValueOnce(new Error('timeout')); // reel-002 fails
    renderInstagramCaption.mockResolvedValue(makeCaption());

    const result = await runContentEngineForAgent(makeAgent(), { operatorConfig });
    expect(result.sent).toBe(true);
    expect(result.pieceResults.find(r => r.pieceId === 'reel-001').status).toBe('ok');
    expect(result.pieceResults.find(r => r.pieceId === 'reel-002').status).toBe('failed');
    const [batch] = composeReviewEmail.mock.calls[0];
    expect(batch.headsUp).toContain("Couldn't generate Reel #2 this week.");
  });

  test('blog fails, both reels succeed: headsUp has blog message, email sent', async () => {
    renderBlogPost.mockRejectedValue(new Error('blog failed'));

    const result = await runContentEngineForAgent(makeAgent(), { operatorConfig });
    expect(result.sent).toBe(true);
    const [batch] = composeReviewEmail.mock.calls[0];
    expect(batch.headsUp.some(h => h.includes('Blog post'))).toBe(true);
  });

  test('all pieces fail: returns { skipped: "all-failed" }, no email', async () => {
    renderReelScript.mockRejectedValue(new Error('fail'));
    renderBlogPost.mockRejectedValue(new Error('fail'));

    const result = await runContentEngineForAgent(makeAgent(), { operatorConfig });
    expect(result.skipped).toBe('all-failed');
    expect(sendNewEmail).not.toHaveBeenCalled();
  });

  test('sendNewEmail fails 3 times: returns { ok: false, sent: false, errors }', async () => {
    jest.useFakeTimers();
    sendNewEmail.mockRejectedValue(new Error('SMTP error'));

    const promise = runContentEngineForAgent(makeAgent(), { operatorConfig });
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.sent).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].phase).toBe('send-email');
  });

  test('send exhaustion: _appendErrorLog called (appendFileSync mock)', async () => {
    jest.useFakeTimers();
    sendNewEmail.mockRejectedValue(new Error('SMTP error'));

    const promise = runContentEngineForAgent(makeAgent(), { operatorConfig });
    await jest.runAllTimersAsync();
    await promise;

    expect(fs.appendFileSync).toHaveBeenCalled();
  });
});

// ── 7. Routing ────────────────────────────────────────────────────────────────

describe('Routing', () => {
  beforeEach(() => setupHappyPath());

  test('dryRun=true: to=[operatorConfig.operatorEmail], no cc', async () => {
    const agent = makeAgent();
    await runContentEngineForAgent(agent, { dryRun: true, operatorConfig });
    const [, opts] = sendNewEmail.mock.calls[0];
    expect(opts.to).toBe('operator@test.example.com');
    expect(opts.cc).toBeUndefined();
  });

  test('dryRun=true with no operatorEmail: falls back to escalationEmail', async () => {
    const agent = makeAgent({ escalationEmail: 'escalation@example.com' });
    await runContentEngineForAgent(agent, { dryRun: true, operatorConfig: { operatorId: 'op-fallback' } });
    const [, opts] = sendNewEmail.mock.calls[0];
    expect(opts.to).toBe('escalation@example.com');
  });

  test('mode=shadow, dryRun=false: to=[agent.email], cc=[operatorConfig.operatorEmail]', async () => {
    const agent = makeAgent({ gmailAddress: 'agent@example.com' });
    readContentProfile.mockReturnValue(makeContentProfile({ contentEngineMode: 'shadow' }));
    await runContentEngineForAgent(agent, { operatorConfig });
    const [, opts] = sendNewEmail.mock.calls[0];
    expect(opts.to).toBe('agent@example.com');
    expect(opts.cc).toBe('operator@test.example.com');
  });

  test('mode=live, dryRun=false: to=[agent.email], no cc', async () => {
    const agent = makeAgent({ gmailAddress: 'agent@example.com' });
    readContentProfile.mockReturnValue(makeContentProfile({ contentEngineMode: 'live' }));
    await runContentEngineForAgent(agent, { operatorConfig });
    const [, opts] = sendNewEmail.mock.calls[0];
    expect(opts.to).toBe('agent@example.com');
    expect(opts.cc).toBeUndefined();
  });

  test('default mode (undefined) acts as shadow', async () => {
    const agent = makeAgent({ gmailAddress: 'agent@example.com' });
    readContentProfile.mockReturnValue(makeContentProfile({ contentEngineMode: undefined }));
    await runContentEngineForAgent(agent, { operatorConfig });
    const [, opts] = sendNewEmail.mock.calls[0];
    expect(opts.to).toBe('agent@example.com');
    expect(opts.cc).toBe('operator@test.example.com');
  });

  test('routes to operatorConfig.operatorEmail, not agentConfig.escalationEmail', async () => {
    const agent = makeAgent({ escalationEmail: 'escalation@example.com' });
    const oc = { operatorId: 'op-1', operatorEmail: 'real-operator@example.com' };
    await runContentEngineForAgent(agent, { dryRun: true, operatorConfig: oc });
    const [, opts] = sendNewEmail.mock.calls[0];
    expect(opts.to).toBe('real-operator@example.com');
    expect(opts.to).not.toBe('escalation@example.com');
  });
});

// ── 7a. operatorConfig guard ──────────────────────────────────────────────────

describe('operatorConfig guard', () => {
  test('throws TypeError when operatorConfig is omitted', async () => {
    await expect(runContentEngineForAgent(makeAgent()))
      .rejects.toThrow(TypeError);
    await expect(runContentEngineForAgent(makeAgent()))
      .rejects.toThrow('runContentEngineForAgent requires options.operatorConfig');
  });

  test('throws TypeError when operatorConfig is not an object', async () => {
    await expect(runContentEngineForAgent(makeAgent(), { operatorConfig: 'string' }))
      .rejects.toThrow(TypeError);
    await expect(runContentEngineForAgent(makeAgent(), { operatorConfig: null }))
      .rejects.toThrow(TypeError);
    await expect(runContentEngineForAgent(makeAgent(), { operatorConfig: 42 }))
      .rejects.toThrow(TypeError);
  });
});

// ── 8. State updates ──────────────────────────────────────────────────────────

describe('State updates', () => {
  beforeEach(() => setupHappyPath());

  test('successful send: recordBatchSent called with agentId, weekIso, and options.now sentAt', async () => {
    const now = new Date('2026-05-18T11:00:00.000Z');
    const result = await runContentEngineForAgent(makeAgent(), { now, operatorConfig });
    expect(recordBatchSent).toHaveBeenCalledTimes(1);
    const [calledId, calledWeek, calledSentAt] = recordBatchSent.mock.calls[0];
    expect(calledId).toBe('mo-test');
    expect(calledWeek).toBe(result.batchWeekIso);
    expect(calledSentAt).toBe(now.toISOString());
  });

  test('dryRun: recordBatchSent NOT called even on successful send', async () => {
    await runContentEngineForAgent(makeAgent(), { dryRun: true, operatorConfig });
    expect(recordBatchSent).not.toHaveBeenCalled();
  });

  test('send failure: recordBatchSent NOT called', async () => {
    jest.useFakeTimers();
    sendNewEmail.mockRejectedValue(new Error('SMTP error'));
    const promise = runContentEngineForAgent(makeAgent(), { operatorConfig });
    await jest.runAllTimersAsync();
    await promise;
    expect(recordBatchSent).not.toHaveBeenCalled();
  });

  test('initBatch IS called on happy path', async () => {
    await runContentEngineForAgent(makeAgent(), { operatorConfig });
    expect(initBatch).toHaveBeenCalledTimes(1);
  });

  test('initBatch failure is logged but does NOT block send', async () => {
    initBatch.mockImplementation(() => { throw new Error('already exists'); });
    const result = await runContentEngineForAgent(makeAgent(), { operatorConfig });
    expect(result.sent).toBe(true);
    expect(fs.appendFileSync).toHaveBeenCalled();
  });
});

// ── 9. _sendWithRetry ─────────────────────────────────────────────────────────

describe('_sendWithRetry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('succeeds first attempt: attempts=1, ok=true', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    const promise = _sendWithRetry(fn, 'test');
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
  });

  test('succeeds after 1 retry: attempts=2, ok=true', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail once'))
      .mockResolvedValueOnce(undefined);
    const promise = _sendWithRetry(fn, 'test');
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });

  test('exhausts all 3: attempts=3, ok=false', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fail'));
    const promise = _sendWithRetry(fn, 'test');
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.lastError.message).toBe('always fail');
  });
});
