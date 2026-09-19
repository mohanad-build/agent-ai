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

jest.mock('../src/webhook', () => ({
  ...jest.requireActual('../src/webhook'),
  clearLeadAndLogNote: jest.fn(),
  parseCommandToken:   jest.fn(),
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
const { clearLeadAndLogNote, parseCommandToken } = require('../src/webhook');
const { readContentProfile }              = require('../src/content/profile');
const { renderReelScript }                = require('../src/content/renderReelScript');
const { renderInstagramCaption }          = require('../src/content/renderInstagramCaption');
const { renderBlogPost }                  = require('../src/content/renderBlogPost');
const { currentWeek }                     = require('../src/content/cache');
const { getNowDate }                      = require('../src/time');
const { maybeRunDailyDigest }             = require('../src/index');
const { runActionHandler, _internal }     = require('../src/content/actionHandler');

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
  getNowDate.mockReturnValue(new Date('2026-05-20T00:00:00.000Z'));

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

afterEach(() => {
  jest.restoreAllMocks();
  _internal._resetCooldowns();
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

  test('CALLED by email resolves via clearLeadAndLogNote and skips Haiku classification', async () => {
    parseCommandToken.mockReturnValue({ type: 'email', value: 'lead@x.com' });
    clearLeadAndLogNote.mockResolvedValue({
      ok: true,
      matchedRow: { name: 'Lead X', leadId: 'lead@x.com' },
    });
    const msg = makeMsg({ subject: 'CALLED lead@x.com', body: 'Notes from the call: wants 2pm' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(parseCommandToken).toHaveBeenCalledWith('lead@x.com');
    expect(clearLeadAndLogNote).toHaveBeenCalledWith(
      AGENT_CONFIG,
      { type: 'email', value: 'lead@x.com' },
      'wants 2pm',
      'email command'
    );
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        body: expect.stringContaining('Cleared Lead X'),
      })
    );
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        body: expect.stringContaining('Note saved.'),
      })
    );
    expect(callRaw).not.toHaveBeenCalled();
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

  test('emits an [auth-results] log line for a recognized sender, with no email address in it', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const msg = makeMsg({ subject: 'APPROVE reel-001' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    const authLine = logSpy.mock.calls.map(call => call[0]).find(line => line.startsWith('[auth-results]'));
    expect(authLine).toBeDefined();
    expect(authLine).toContain('messageId=msg-1');
    expect(authLine).toContain('recognized=true');
    expect(authLine).not.toContain('@');
  });

  test('emits an [auth-results] log line for an unrecognized sender, with no email address in it', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const msg = makeMsg({ from: 'unknown@other.com', subject: 'APPROVE reel-001' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    const authLine = logSpy.mock.calls.map(call => call[0]).find(line => line.startsWith('[auth-results]'));
    expect(authLine).toBeDefined();
    expect(authLine).toContain('messageId=msg-1');
    expect(authLine).toContain('recognized=false');
    expect(authLine).not.toContain('@');
  });

  describe('unrecognized-sender reply (7.54.8)', () => {
    const STRANGER_EMAIL = 'stranger@gmail.com';
    const PASSING_AUTH_RESULTS = {
      trusted: true, reason: 'ok', dmarc: 'pass', dkim: 'pass', spf: 'pass', fromDomain: 'gmail.com',
    };
    const NOT_AUTOMATED = { automated: false, reason: null };
    const EXPECTED_SUBJECT = 'GetKlosed: email address not recognized';
    const EXPECTED_BODY =
      "We couldn't match this email address to a GetKlosed account, so nothing was changed.\n\n" +
      "If you're a GetKlosed agent, please send it again from the email address your account is set up with. If you're not sure which address that is, contact mohanad@getklosed.ca.";

    function makeUnrecognizedMsg(overrides = {}) {
      return makeMsg({
        from: `Stranger <${STRANGER_EMAIL}>`,
        automation: NOT_AUTOMATED,
        authResults: PASSING_AUTH_RESULTS,
        ...overrides,
      });
    }

    function findLine(logSpy, prefix) {
      return logSpy.mock.calls.map(call => call[0]).find(line => line.startsWith(prefix));
    }

    test('all gates pass: sends the fixed notice with autoSubmitted, marks read, logs sent', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const msg = makeUnrecognizedMsg();
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledTimes(1);
      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'assistant' }),
        {
          to: STRANGER_EMAIL,
          subject: EXPECTED_SUBJECT,
          body: EXPECTED_BODY,
          autoSubmitted: true,
        }
      );
      expect(gmail.markRead).toHaveBeenCalledWith(expect.any(Object), 'msg-1');
      expect(findLine(logSpy, '[unrecognized-reply]')).toBe('[unrecognized-reply] messageId=msg-1 decision=sent reason=-');
    });

    test.each([
      ['automated', () => makeUnrecognizedMsg({ automation: { automated: true, reason: 'system_sender' } })],
      ['automated (msg.automation absent)', () => makeUnrecognizedMsg({ automation: undefined })],
      ['untrusted', () => makeUnrecognizedMsg({ authResults: { ...PASSING_AUTH_RESULTS, trusted: false, reason: 'first_not_google' } })],
      ['untrusted (msg.authResults absent)', () => makeUnrecognizedMsg({ authResults: undefined })],
      ['dmarc_not_pass (dmarc none)', () => makeUnrecognizedMsg({ authResults: { ...PASSING_AUTH_RESULTS, dmarc: 'none' } })],
      ['dmarc_not_pass (dmarc fail)', () => makeUnrecognizedMsg({ authResults: { ...PASSING_AUTH_RESULTS, dmarc: 'fail' } })],
      ['invalid_address', () => makeUnrecognizedMsg({ from: 'not-an-email-address' })],
      ['domain_mismatch', () => makeUnrecognizedMsg({ from: 'Stranger <stranger@evil.com>' })],
    ])('gate failure - %s: no send, markRead still called, log names the reason', async (expectedReason, buildMsg) => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const label = expectedReason.split(' ')[0]; // strip the parenthetical for the assertion
      const msg = buildMsg();
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).not.toHaveBeenCalled();
      expect(gmail.markRead).toHaveBeenCalledWith(expect.any(Object), 'msg-1');
      const line = findLine(logSpy, '[unrecognized-reply]');
      expect(line).toBe(`[unrecognized-reply] messageId=msg-1 decision=skipped reason=${label}`);
    });

    test('cooldown: a second message from the same sender within 24h skips with cooldown', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const firstMsg = makeUnrecognizedMsg({ messageId: 'msg-first' });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([firstMsg]);
      await runActionHandler([AGENT_CONFIG]);
      expect(gmail.sendNewEmail).toHaveBeenCalledTimes(1);

      getNowDate.mockReturnValue(new Date('2026-05-20T12:00:00.000Z')); // +12h
      const secondMsg = makeUnrecognizedMsg({ messageId: 'msg-second' });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([secondMsg]);
      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledTimes(1);
      const line = findLine(logSpy, '[unrecognized-reply] messageId=msg-second');
      expect(line).toBe('[unrecognized-reply] messageId=msg-second decision=skipped reason=cooldown');
    });

    test('cooldown: after exactly 24h plus 1ms it sends again', async () => {
      const firstMsg = makeUnrecognizedMsg({ messageId: 'msg-first' });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([firstMsg]);
      await runActionHandler([AGENT_CONFIG]);
      expect(gmail.sendNewEmail).toHaveBeenCalledTimes(1);

      getNowDate.mockReturnValue(new Date(new Date('2026-05-20T00:00:00.000Z').getTime() + 24 * 60 * 60 * 1000 + 1));
      const secondMsg = makeUnrecognizedMsg({ messageId: 'msg-second' });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([secondMsg]);
      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledTimes(2);
    });

    test('cooldown: a different sender in that window is unaffected', async () => {
      const firstMsg = makeUnrecognizedMsg({ messageId: 'msg-first' });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([firstMsg]);
      await runActionHandler([AGENT_CONFIG]);
      expect(gmail.sendNewEmail).toHaveBeenCalledTimes(1);

      const otherMsg = makeUnrecognizedMsg({ messageId: 'msg-other', from: 'Other <other@gmail.com>', authResults: { ...PASSING_AUTH_RESULTS, fromDomain: 'gmail.com' } });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([otherMsg]);
      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledTimes(2);
      expect(gmail.sendNewEmail).toHaveBeenNthCalledWith(
        2,
        expect.any(Object),
        expect.objectContaining({ to: 'other@gmail.com' })
      );
    });

    test('send throws: markRead still called, log reason send_failed, no cooldown recorded so the next message from that sender sends', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      gmail.sendNewEmail.mockRejectedValueOnce(new Error('network blip'));
      const firstMsg = makeUnrecognizedMsg({ messageId: 'msg-first' });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([firstMsg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.markRead).toHaveBeenCalledWith(expect.any(Object), 'msg-first');
      const line = findLine(logSpy, '[unrecognized-reply] messageId=msg-first');
      expect(line).toBe('[unrecognized-reply] messageId=msg-first decision=skipped reason=send_failed');

      const secondMsg = makeUnrecognizedMsg({ messageId: 'msg-second' });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([secondMsg]);
      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledTimes(2);
    });

    test('a recognized sender: no reply sent, behaviour unchanged', async () => {
      const msg = makeMsg({ subject: 'APPROVE reel-001' });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledTimes(1);
      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'assistant' }),
        expect.objectContaining({ to: AGENT_EMAIL, subject: 'Re: APPROVE reel-001' })
      );
    });

    test('no [unrecognized-reply] line contains an email address', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const msg = makeUnrecognizedMsg();
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      const lines = logSpy.mock.calls.map(call => call[0]).filter(line => line.startsWith('[unrecognized-reply]'));
      expect(lines.length).toBeGreaterThan(0);
      lines.forEach(line => expect(line).not.toContain('@'));
    });
  });
});
