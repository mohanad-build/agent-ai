'use strict';

jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  readFileSync:  jest.fn(),
  writeFileSync: jest.fn(),
}));

jest.mock('../src/gmail', () => ({
  fetchUnreadInboxEmails: jest.fn(),
  markRead:               jest.fn(),
  sendNewEmail:           jest.fn(),
}));

jest.mock('../src/claude', () => ({
  callRaw:         jest.fn(),
  MODELS:          { CATEGORIZATION: 'claude-haiku-4-5-20251001' },
  stripCodeFences: s => s,
}));

jest.mock('../src/content/state', () => ({
  readContentState: jest.fn(),
  approveVersion:   jest.fn(),
  recordRegen:      jest.fn(),
  recordSwap:       jest.fn(),
}));

jest.mock('../src/email', () => ({
  readSheetRows:  jest.fn(),
  updateSheetRow: jest.fn(),
}));

jest.mock('../src/content/profile', () => ({ readContentProfile: jest.fn() }));
jest.mock('../src/content/renderReelScript',       () => ({ renderReelScript:        jest.fn() }));
jest.mock('../src/content/renderInstagramCaption', () => ({ renderInstagramCaption:  jest.fn() }));
jest.mock('../src/content/renderBlogPost',         () => ({ renderBlogPost:          jest.fn() }));
jest.mock('../src/content/cache', () => ({ currentWeek: jest.fn() }));
jest.mock('../src/time',          () => ({ getNowDate:  jest.fn() }));
jest.mock('../src/index',         () => ({ maybeRunDailyDigest: jest.fn() }));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
const { readFileSync, writeFileSync } = require('node:fs');
const gmail                           = require('../src/gmail');
const { callRaw }                     = require('../src/claude');
const { readContentState, approveVersion, recordRegen, recordSwap } = require('../src/content/state');
const { readSheetRows, updateSheetRow }    = require('../src/email');
const { readContentProfile }              = require('../src/content/profile');
const { renderReelScript }                = require('../src/content/renderReelScript');
const { renderInstagramCaption }          = require('../src/content/renderInstagramCaption');
const { renderBlogPost }                  = require('../src/content/renderBlogPost');
const { currentWeek }                     = require('../src/content/cache');
const { maybeRunDailyDigest }             = require('../src/index');
const { runActionHandler }                = require('../src/content/actionHandler');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const WEEK_ISO    = '2026-W21';
const AGENT_EMAIL = 'agent@example.com';
const AGENT_ID    = 'mo-test';

const AGENT_CONFIG = {
  agentId:       AGENT_ID,
  gmailAddress:  AGENT_EMAIL,
  googleSheetId: 'sheet-id',
  provider:      'gmail',
  isActive:      true,
};

function makeMsg(overrides = {}) {
  return {
    messageId: 'msg-1',
    from:      `Test Agent <${AGENT_EMAIL}>`,
    subject:   '',
    body:      '',
    snippet:   '',
    ...overrides,
  };
}

function makePiece(overrides = {}) {
  return {
    angleId:          'angle-1',
    themeTag:         'buyers',
    forbidsRateAdvice: false,
    regenCount:       0,
    swapCount:        0,
    versions:         [{ versionId: 'v-2026', text: 'Original text', generatedAt: '2026-05-20T00:00:00.000Z' }],
    approvedVersionId: null,
    ...overrides,
  };
}

function makeState(pieceOverrides = {}) {
  return {
    agentId: AGENT_ID,
    batches: {
      [WEEK_ISO]: {
        availableAngles: [
          {
            id: 'angle-1', headline: 'Headline 1', thesis: 'Thesis 1',
            dataPoints: [], sourceFooter: 'Source 1', themeTag: 'buyers', forbidsRateAdvice: false,
          },
          {
            id: 'angle-2', headline: 'Headline 2', thesis: 'Thesis 2',
            dataPoints: [], sourceFooter: 'Source 2', themeTag: 'sellers', forbidsRateAdvice: false,
          },
        ],
        pieces: {
          'reel-001': makePiece(pieceOverrides),
          'blog-001': makePiece(),
        },
      },
    },
  };
}

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  currentWeek.mockReturnValue(WEEK_ISO);

  readFileSync.mockImplementation(filePath => {
    if (String(filePath).includes('assistant.token.json')) {
      return JSON.stringify({ refresh_token: 'test-token' });
    }
    return JSON.stringify({ agentId: AGENT_ID, isActive: true });
  });
  writeFileSync.mockImplementation(() => {});

  gmail.fetchUnreadInboxEmails.mockResolvedValue([]);
  gmail.markRead.mockResolvedValue();
  gmail.sendNewEmail.mockResolvedValue();

  readContentState.mockReturnValue(makeState());
  approveVersion.mockReturnValue({});
  recordRegen.mockReturnValue({});
  recordSwap.mockReturnValue({});

  readContentProfile.mockReturnValue({ contentEngineEnabled: true });
  renderReelScript.mockResolvedValue({ text: 'New reel script', generatedAt: '2026-05-20T01:00:00.000Z' });
  renderInstagramCaption.mockResolvedValue({ text: 'New caption', generatedAt: '2026-05-20T01:00:00.000Z' });
  renderBlogPost.mockResolvedValue({ text: 'New blog post', generatedAt: '2026-05-20T01:00:00.000Z' });

  readSheetRows.mockResolvedValue([]);
  updateSheetRow.mockResolvedValue();

  callRaw.mockResolvedValue(JSON.stringify({ intent: 'unknown', leadName: null, confidence: 0.9 }));
  maybeRunDailyDigest.mockResolvedValue();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runActionHandler', () => {
  test('unrecognized sender is skipped and marked read with no reply', async () => {
    const msg = makeMsg({ from: 'unknown@other.com', subject: 'APPROVE reel-001' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(gmail.sendNewEmail).not.toHaveBeenCalled();
    expect(gmail.markRead).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'assistant' }),
      'msg-1'
    );
  });

  test('APPROVE calls approveVersion with latest versionId and sends reply', async () => {
    const msg = makeMsg({ subject: 'APPROVE reel-001' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(approveVersion).toHaveBeenCalledWith(AGENT_ID, WEEK_ISO, 'reel-001', 'v-2026');
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'assistant' }),
      expect.objectContaining({ to: AGENT_EMAIL, subject: 'Re: APPROVE reel-001' })
    );
    expect(gmail.markRead).toHaveBeenCalledWith(expect.any(Object), 'msg-1');
  });

  test('REGEN under cap calls renderer and recordRegen', async () => {
    const msg = makeMsg({ subject: 'REGEN reel-001' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(renderReelScript).toHaveBeenCalled();
    expect(renderInstagramCaption).toHaveBeenCalled();
    expect(recordRegen).toHaveBeenCalledWith(AGENT_ID, WEEK_ISO, 'reel-001', expect.objectContaining({ text: expect.any(String) }));
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ to: AGENT_EMAIL })
    );
  });

  test('REGEN at cap sends soft-cap reply and does not call renderer or recordRegen', async () => {
    readContentState.mockReturnValue(makeState({ regenCount: 5 }));
    const msg = makeMsg({ subject: 'REGEN reel-001' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(renderReelScript).not.toHaveBeenCalled();
    expect(recordRegen).not.toHaveBeenCalled();
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ body: expect.stringContaining('5 times this week') })
    );
  });

  test('REGEN OVERRIDE at cap bypasses cap and calls renderer', async () => {
    readContentState.mockReturnValue(makeState({ regenCount: 5 }));
    const msg = makeMsg({ subject: 'REGEN OVERRIDE reel-001' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(renderReelScript).toHaveBeenCalled();
    expect(recordRegen).toHaveBeenCalledWith(AGENT_ID, WEEK_ISO, 'reel-001', expect.any(Object));
  });

  test('SWAP calls recordSwap with correct angle data and sends reply', async () => {
    const msg = makeMsg({ subject: 'SWAP reel-001 TO angle-2' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(renderReelScript).toHaveBeenCalled();
    expect(recordSwap).toHaveBeenCalledWith(
      AGENT_ID, WEEK_ISO, 'reel-001',
      expect.objectContaining({ angleId: 'angle-2' }),
      expect.any(Object)
    );
    expect(gmail.sendNewEmail).toHaveBeenCalled();
  });

  test('SWAP AS BLOG calls renderBlogPost regardless of original piece type', async () => {
    const msg = makeMsg({ subject: 'SWAP reel-001 TO angle-2 AS BLOG' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(renderBlogPost).toHaveBeenCalled();
    expect(renderReelScript).not.toHaveBeenCalled();
    expect(recordSwap).toHaveBeenCalledWith(
      AGENT_ID, WEEK_ISO, 'reel-001',
      expect.objectContaining({ angleId: 'angle-2' }),
      expect.any(Object)
    );
  });

  test('unrecognized Track 1 subject sends error-format reply', async () => {
    // Extra words after the pieceId prevent the pattern from matching
    const msg = makeMsg({ subject: 'APPROVE reel-001 extra-words' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(approveVersion).not.toHaveBeenCalled();
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ body: expect.stringContaining("didn't understand that action") })
    );
  });

  test('Track 2 pause_followups exact name match writes aiEnabled=FALSE', async () => {
    callRaw.mockResolvedValue(JSON.stringify({ intent: 'pause_followups', leadName: 'Sarah', confidence: 0.95 }));
    readSheetRows.mockResolvedValue([
      ['lead-1', 'Sarah', '+1234', '', '', '', '', '', '', '', '', '', '', '', 'TRUE'],
    ]);
    const msg = makeMsg({ subject: 'pause followups', body: 'pause followups for Sarah' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(updateSheetRow).toHaveBeenCalledWith(AGENT_CONFIG, 2, { aiEnabled: 'FALSE' });
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ body: expect.stringContaining('follow-ups paused for Sarah') })
    );
  });

  test('Track 2 pause_followups no match sends no-lead reply', async () => {
    callRaw.mockResolvedValue(JSON.stringify({ intent: 'pause_followups', leadName: 'NonExistent', confidence: 0.95 }));
    readSheetRows.mockResolvedValue([['lead-1', 'Sarah', '+1234']]);
    const msg = makeMsg({ subject: 'pause NonExistent', body: 'pause NonExistent' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(updateSheetRow).not.toHaveBeenCalled();
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ body: expect.stringContaining('No lead found matching') })
    );
  });

  test('Track 2 pause_followups multiple matches sends multiple-match reply', async () => {
    callRaw.mockResolvedValue(JSON.stringify({ intent: 'pause_followups', leadName: 'Sarah', confidence: 0.95 }));
    readSheetRows.mockResolvedValue([
      ['lead-1', 'Sarah Johnson'],
      ['lead-2', 'Sarah Williams'],
    ]);
    const msg = makeMsg({ subject: 'pause Sarah', body: 'pause Sarah' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(updateSheetRow).not.toHaveBeenCalled();
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ body: expect.stringContaining('Found 2 leads matching') })
    );
  });

  test('Track 2 mark_soi updates leadCategory to soi', async () => {
    callRaw.mockResolvedValue(JSON.stringify({ intent: 'mark_soi', leadName: 'Bob', confidence: 0.9 }));
    readSheetRows.mockResolvedValue([['lead-2', 'Bob', '+1235']]);
    const msg = makeMsg({ subject: 'mark Bob as soi', body: 'mark Bob as soi' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(updateSheetRow).toHaveBeenCalledWith(AGENT_CONFIG, 2, { leadCategory: 'soi' });
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ body: expect.stringContaining('marked as SOI') })
    );
  });

  test('Track 2 pause_account writes isActive=false to agent config file', async () => {
    callRaw.mockResolvedValue(JSON.stringify({ intent: 'pause_account', leadName: null, confidence: 0.95 }));
    const msg = makeMsg({ subject: 'pause my account', body: 'pause my account' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining(`${AGENT_ID}.json`),
      expect.stringContaining('"isActive": false')
    );
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ body: expect.stringContaining('account is paused') })
    );
  });

  test('Track 2 resume_account writes isActive=true to agent config file', async () => {
    readFileSync.mockImplementation(filePath => {
      if (String(filePath).includes('assistant.token.json')) return JSON.stringify({ refresh_token: 'tok' });
      return JSON.stringify({ agentId: AGENT_ID, isActive: false });
    });
    callRaw.mockResolvedValue(JSON.stringify({ intent: 'resume_account', leadName: null, confidence: 0.95 }));
    const msg = makeMsg({ subject: 'resume my account', body: 'resume my account' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining(`${AGENT_ID}.json`),
      expect.stringContaining('"isActive": true')
    );
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ body: expect.stringContaining('account is active again') })
    );
  });

  test('Track 2 send_digest calls maybeRunDailyDigest with force=true', async () => {
    callRaw.mockResolvedValue(JSON.stringify({ intent: 'send_digest', leadName: null, confidence: 0.9 }));
    const msg = makeMsg({ subject: 'send digest', body: "send me today's digest" });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(maybeRunDailyDigest).toHaveBeenCalledWith(AGENT_CONFIG, { force: true });
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ body: expect.stringContaining('Sending your digest now') })
    );
  });

  test('Track 2 unknown intent sends did-not-understand reply', async () => {
    callRaw.mockResolvedValue(JSON.stringify({ intent: 'unknown', leadName: null, confidence: 0.9 }));
    const msg = makeMsg({ subject: 'something random', body: 'do something weird' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ body: expect.stringContaining("didn't understand that request") })
    );
  });

  test('Track 2 low confidence sends did-not-understand reply', async () => {
    callRaw.mockResolvedValue(JSON.stringify({ intent: 'pause_followups', leadName: 'Sarah', confidence: 0.5 }));
    const msg = makeMsg({ subject: 'maybe pause sarah', body: 'maybe pause sarah' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(updateSheetRow).not.toHaveBeenCalled();
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ body: expect.stringContaining("didn't understand that request") })
    );
  });

  test('error in processing sends error reply and runActionHandler does not throw', async () => {
    readContentState.mockImplementation(() => { throw new Error('state read failed'); });
    const msg = makeMsg({ subject: 'APPROVE reel-001' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await expect(runActionHandler([AGENT_CONFIG])).resolves.toBeUndefined();

    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ body: expect.stringContaining('Something went wrong') })
    );
    expect(gmail.markRead).toHaveBeenCalledWith(expect.any(Object), 'msg-1');
  });
});
