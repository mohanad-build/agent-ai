'use strict';

const os   = require('os');
const fs   = require('node:fs');
const path = require('node:path');

// ── Redirect readWeeklyAngles to a per-test tmp dir ───────────────────────────
// Uses the existing opts.baseDir override in angles.js; engine.js never passes
// it, so we wrap at the module boundary.
// The variable name must start with "mock" so Jest's babel transform permits
// the reference inside the jest.mock() factory scope.
let mockTmpBaseDir;

jest.mock('../src/content/angles', () => {
  const real = jest.requireActual('../src/content/angles');
  return {
    ...real,
    readWeeklyAngles: jest.fn((weekIso, opts = {}) =>
      real.readWeeklyAngles(weekIso, { ...opts, baseDir: mockTmpBaseDir })
    ),
  };
});

jest.mock('../src/content/profile',             () => ({ readContentProfile: jest.fn() }));
jest.mock('../src/content/state',               () => ({
  readContentState:  jest.fn(),
  initBatch:         jest.fn(),
  buildAgentHistory: jest.fn(),
  recordBatchSent:   jest.fn(),
}));
jest.mock('../src/content/renderReelScript',    () => ({ renderReelScript: jest.fn() }));
jest.mock('../src/content/renderInstagramCaption', () => ({ renderInstagramCaption: jest.fn() }));
jest.mock('../src/content/renderBlogPost',      () => ({ renderBlogPost: jest.fn() }));
jest.mock('../src/email',                       () => ({ sendNewEmail: jest.fn() }));
jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  appendFileSync: jest.fn(),
}));

const { readContentProfile }   = require('../src/content/profile');
const { readContentState, initBatch, buildAgentHistory, recordBatchSent } =
  require('../src/content/state');
const { renderReelScript }       = require('../src/content/renderReelScript');
const { renderInstagramCaption } = require('../src/content/renderInstagramCaption');
const { renderBlogPost }         = require('../src/content/renderBlogPost');
const { sendNewEmail }           = require('../src/email');
const { runContentEngineForAgent } = require('../src/content/engine');

// MOCK_NOW: Monday 2026-05-18T11:00:00.000Z = 07:00 EDT → ISO week 2026-W21
const MOCK_NOW_ISO = '2026-05-18T11:00:00.000Z';
const WEEK_ISO     = '2026-W21';

const operatorConfig = {
  operatorId:    'test-operator',
  operatorEmail: 'op@example.com',
  operatorPhone: '+15555550100',
};

// ── Fixture builders ──────────────────────────────────────────────────────────

function makeAgent(overrides = {}) {
  return {
    agentId:         'test-agent',
    firstName:       'Test',
    gmailAddress:    'agent@example.com',
    escalationEmail: 'op@example.com',
    operatorEmail:   'op@example.com',
    timezone:        'America/Toronto',
    isActive:        true,
    ...overrides,
  };
}

function makeContentProfile(overrides = {}) {
  return {
    contentEngineEnabled: true,
    contentEngineMode:    'shadow',
    deliveryTime:         '07:00',
    primaryFocus:         'buyers',
    contentVolume:        'max',
    ...overrides,
  };
}

function makeContentState(overrides = {}) {
  return {
    agentId:              'test-agent',
    schemaVersion:        1,
    lastContentBatchSent: null,
    batches:              {},
    ...overrides,
  };
}

function makeAngle(id, overrides = {}) {
  return {
    id,
    headline:          `Headline ${id}`,
    thesis:            'Rates are rising. This matters for buyers.',
    themeTag:          'rates',
    audienceFocus:     'buyers',
    bestSuitedFor:     ['reel'],
    surpriseScore:     0.5,
    longFormSuitable:  false,
    forbidsRateAdvice: false,
    sourceFooter:      'CREA (May 2026)',
    ...overrides,
  };
}

// Produces 5 angles. With contentVolume:'max' and primaryFocus:'buyers'
// (all angles audienceFocus:'buyers' → +0.2 score bonus), selectDefaults picks:
//   blog-001 → angle-2026-W21-001 (score 0.8, highest longFormSuitable)
//   reel-001 → angle-2026-W21-002 (score 0.7)
//   reel-002 → angle-2026-W21-003 (score 0.6)
//   remaining → [angle-2026-W21-004, angle-2026-W21-005]
function makeAngleMenu(weekIso) {
  return {
    weekIso,
    generatedAt: '2026-05-18T08:00:00.000Z',
    angles: [
      makeAngle('angle-2026-W21-001', { surpriseScore: 0.6, longFormSuitable: true,  bestSuitedFor: ['reel', 'blog'] }),
      makeAngle('angle-2026-W21-002', { surpriseScore: 0.5, longFormSuitable: false, bestSuitedFor: ['reel'] }),
      makeAngle('angle-2026-W21-003', { surpriseScore: 0.4, longFormSuitable: false, bestSuitedFor: ['reel'] }),
      makeAngle('angle-2026-W21-004', { surpriseScore: 0.3, longFormSuitable: false, bestSuitedFor: ['reel'] }),
      makeAngle('angle-2026-W21-005', { surpriseScore: 0.2, longFormSuitable: false, bestSuitedFor: ['reel'] }),
    ],
  };
}

function makeReelScriptResult() {
  return { text: 'Script text for reel.', generatedAt: '2026-05-18T11:00:01.000Z' };
}
function makeCaptionResult() {
  return { text: 'Caption text. #realestate', generatedAt: '2026-05-18T11:00:02.000Z' };
}
function makeBlogPostResult() {
  return { text: '# Blog post\n\nBody text.', generatedAt: '2026-05-18T11:00:03.000Z' };
}

// ── File helpers ──────────────────────────────────────────────────────────────

function writeAngleFile(weekIso, content) {
  const dir    = path.join(mockTmpBaseDir, 'data', 'market', '_angles');
  const realFs = jest.requireActual('node:fs');
  realFs.mkdirSync(dir, { recursive: true });
  realFs.writeFileSync(path.join(dir, `${weekIso}.json`), JSON.stringify(content), 'utf8');
}

// ── Shared setup/teardown ─────────────────────────────────────────────────────

let _origMockNow;

beforeEach(() => {
  _origMockNow   = process.env.MOCK_NOW;
  process.env.MOCK_NOW = MOCK_NOW_ISO;

  mockTmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-integ-'));

  readContentProfile.mockReturnValue(makeContentProfile());
  readContentState.mockReturnValue(makeContentState());
  buildAgentHistory.mockReturnValue({ recentThemeTags: [], rejectedRateContent: false });
  initBatch.mockReturnValue({});
  sendNewEmail.mockResolvedValue(undefined);
  renderReelScript.mockResolvedValue(makeReelScriptResult());
  renderInstagramCaption.mockResolvedValue(makeCaptionResult());
  renderBlogPost.mockResolvedValue(makeBlogPostResult());

  writeAngleFile(WEEK_ISO, makeAngleMenu(WEEK_ISO));
});

afterEach(() => {
  if (_origMockNow === undefined) {
    delete process.env.MOCK_NOW;
  } else {
    process.env.MOCK_NOW = _origMockNow;
  }
  jest.clearAllMocks();
  try { fs.rmSync(mockTmpBaseDir, { recursive: true }); } catch (_) {}
});

// ── Integration tests ─────────────────────────────────────────────────────────

describe('runContentEngineForAgent integration', () => {

  test('1. happy path shadow: email to agent+cc, body has all 3 pieces', async () => {
    const agent = makeAgent({ gmailAddress: 'agent@example.com', escalationEmail: 'op@example.com' });
    const result = await runContentEngineForAgent(agent, { operatorConfig });

    expect(result.ok).toBe(true);
    expect(result.sent).toBe(true);
    expect(result.batchWeekIso).toBe(WEEK_ISO);
    expect(result.pieceResults).toHaveLength(3);
    expect(result.pieceResults.every(r => r.status === 'ok')).toBe(true);
    expect(result.errors).toEqual([]);

    expect(sendNewEmail).toHaveBeenCalledTimes(1);
    const [, opts] = sendNewEmail.mock.calls[0];
    expect(opts.to).toBe('agent@example.com');
    expect(opts.cc).toBe('op@example.com');
    expect(opts.body).toContain('#1 REEL');
    expect(opts.body).toContain('#2 REEL');
    expect(opts.body).toContain('#3 BLOG');
    expect(recordBatchSent).toHaveBeenCalledTimes(1);
    expect(recordBatchSent).toHaveBeenCalledWith('test-agent', WEEK_ISO, expect.any(String));
  });

  test('2. happy path live: email to agent only, no cc', async () => {
    readContentProfile.mockReturnValue(makeContentProfile({ contentEngineMode: 'live' }));
    const result = await runContentEngineForAgent(makeAgent(), { operatorConfig });

    expect(result.sent).toBe(true);
    expect(sendNewEmail).toHaveBeenCalledTimes(1);
    const [, opts] = sendNewEmail.mock.calls[0];
    expect(opts.to).toBe('agent@example.com');
    expect(opts.cc).toBeUndefined();
  });

  test('3. partial failure: blog throws, email still sends with headsUp', async () => {
    renderBlogPost.mockRejectedValue(new Error('blog generation failed'));
    const result = await runContentEngineForAgent(makeAgent(), { operatorConfig });

    expect(result.sent).toBe(true);
    expect(result.pieceResults.find(r => r.pieceId === 'blog-001').status).toBe('failed');
    expect(result.pieceResults.filter(r => r.status === 'ok')).toHaveLength(2);
    expect(recordBatchSent).toHaveBeenCalledTimes(1);
    expect(recordBatchSent).toHaveBeenCalledWith('test-agent', WEEK_ISO, expect.any(String));

    expect(sendNewEmail).toHaveBeenCalledTimes(1);
    const [, opts] = sendNewEmail.mock.calls[0];
    expect(opts.body).toContain('Blog post #1');
  });

  test('4. all failed: no email, result.skipped === all-failed', async () => {
    renderReelScript.mockRejectedValue(new Error('render failed'));
    renderBlogPost.mockRejectedValue(new Error('render failed'));
    const result = await runContentEngineForAgent(makeAgent(), { operatorConfig });

    expect(result.skipped).toBe('all-failed');
    expect(result.sent).toBe(false);
    expect(sendNewEmail).not.toHaveBeenCalled();
    expect(recordBatchSent).not.toHaveBeenCalled();
  });

  test('5. no angles: result.skipped === no-angles, no email', async () => {
    const realFs = jest.requireActual('node:fs');
    realFs.unlinkSync(
      path.join(mockTmpBaseDir, 'data', 'market', '_angles', `${WEEK_ISO}.json`)
    );
    const result = await runContentEngineForAgent(makeAgent(), { operatorConfig });

    expect(result.skipped).toBe('no-angles');
    expect(result.batchWeekIso).toBe(WEEK_ISO);
    expect(sendNewEmail).not.toHaveBeenCalled();
    expect(recordBatchSent).not.toHaveBeenCalled();
  });

  test('6. dryRun: email to operator only, no cc, recordBatchSent not called', async () => {
    const agent = makeAgent({ gmailAddress: 'agent@example.com' });
    const result = await runContentEngineForAgent(agent, { dryRun: true, operatorConfig });

    expect(result.sent).toBe(true);
    expect(sendNewEmail).toHaveBeenCalledTimes(1);
    const [, opts] = sendNewEmail.mock.calls[0];
    expect(opts.to).toBe('op@example.com');
    expect(opts.cc).toBeUndefined();
    expect(recordBatchSent).not.toHaveBeenCalled();
  });

  test('7. IG caption auto-skip: caption not called when reel-001 script fails', async () => {
    renderReelScript
      .mockRejectedValueOnce(new Error('script failed'))
      .mockResolvedValue(makeReelScriptResult());

    const result = await runContentEngineForAgent(makeAgent(), { operatorConfig });

    expect(renderInstagramCaption).toHaveBeenCalledTimes(1);
    expect(result.sent).toBe(true);
    expect(result.pieceResults.find(r => r.pieceId === 'reel-001').status).toBe('failed');
    expect(result.pieceResults.find(r => r.pieceId === 'reel-002').status).toBe('ok');
  });

  test('8. recordBatchSent called with agentId, weekIso, and options.now as sentAt', async () => {
    const now = new Date(MOCK_NOW_ISO);
    const result = await runContentEngineForAgent(makeAgent(), { now, operatorConfig });

    expect(result.ok).toBe(true);
    expect(recordBatchSent).toHaveBeenCalledTimes(1);
    expect(recordBatchSent).toHaveBeenCalledWith('test-agent', WEEK_ISO, now.toISOString());
  });

});
