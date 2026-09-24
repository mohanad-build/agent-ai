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

jest.mock('../src/transactions/store', () => ({
  ...jest.requireActual('../src/transactions/store'),
  readTransaction: jest.fn(),
}));

jest.mock('../src/transactions/proposals', () => ({
  ...jest.requireActual('../src/transactions/proposals'),
  rejectProposalMember: jest.fn(),
}));

jest.mock('../src/transactions/confirmSet', () => ({ confirmProposalSet: jest.fn() }));
jest.mock('../src/transactions/wrongDeal',  () => ({ markWrongDeal:      jest.fn() }));
jest.mock('../src/operatorConfig',          () => ({ loadOperator:       jest.fn() }));

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
const store                               = require('../src/transactions/store');
const { rejectProposalMember }            = require('../src/transactions/proposals');
const { confirmProposalSet }              = require('../src/transactions/confirmSet');
const { markWrongDeal }                   = require('../src/transactions/wrongDeal');
const { loadOperator }                    = require('../src/operatorConfig');
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
  operatorId:    'op-test',
};

// ── TC (CONFIRM / REJECT / WRONGDEAL) fixtures ───────────────────────────────

const TXN_ID          = 'txn-20260715-1a2b3c4d';
const SET_ID           = 'pps-1a2b3c4d';
const MEMBER_ID_NAMED  = 'ppm-11111111';
const MEMBER_ID_NAMELESS = 'ppm-22222222';
const PARTICIPANT_ID_NAMED    = 'per-11111111';
const PARTICIPANT_ID_NAMELESS = 'per-22222222';
const ADDRESS          = '12 Main St';
const OPERATOR_EMAIL   = 'operator@getklosed.ca';

function makeTcTransaction(overrides = {}) {
  return {
    schemaVersion: 1,
    transactionId: TXN_ID,
    agentId:       AGENT_ID,
    type:          'buyer_purchase',
    state:         'conditional',
    address:       ADDRESS,
    createdAt:     '2026-07-15T10:00:00.000Z',
    updatedAt:     '2026-07-15T10:00:00.000Z',
    participants: {
      [PARTICIPANT_ID_NAMED]:    { roles: ['client'], name: 'Jane Doe' },
      [PARTICIPANT_ID_NAMELESS]: { roles: ['co_client'], emails: ['nameless-participant@example.com'] },
    },
    participantProposals: {
      [SET_ID]: {
        status:    'open',
        createdAt: '2026-07-15T10:00:00.000Z',
        actor:     'system',
        source: {
          kind: 'document', filingKey: 'msg-a:att-a', contentHash: 'sha256:aaaa',
          filename: 'agreement.pdf', receivedAt: '2026-07-15T09:00:00.000Z',
        },
        members: {
          [MEMBER_ID_NAMED]:    { roles: ['client'], name: 'Jane Doe', status: 'pending' },
          [MEMBER_ID_NAMELESS]: { roles: ['co_client'], emails: [{ address: 'nameless-member@example.com', from: 'document' }], status: 'pending' },
        },
      },
    },
    ...overrides,
  };
}

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

  store.readTransaction.mockReturnValue(makeTcTransaction());
  loadOperator.mockReturnValue({ operatorId: 'op-test', operatorEmail: OPERATOR_EMAIL });
  confirmProposalSet.mockReturnValue({ outcome: 'confirmed', participantIds: {} });
  markWrongDeal.mockReturnValue({ outcome: 'wrong_deal_recorded' });
  rejectProposalMember.mockReturnValue({ outcome: 'rejected' });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  _internal._resetCooldowns();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runActionHandler', () => {
  test('unrecognized sender is skipped and marked read with no reply', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const msg = makeMsg({ from: 'unknown@other.com', subject: 'APPROVE reel-001' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(gmail.sendNewEmail).not.toHaveBeenCalled();
    expect(gmail.markRead).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'assistant' }),
      'msg-1'
    );

    const unrecognizedLine = logSpy.mock.calls.map(call => call[0])
      .find(line => typeof line === 'string' && line.startsWith('[actionHandler] unrecognized sender'));
    expect(unrecognizedLine).toBeDefined();
    logSpy.mock.calls.forEach(call => call.forEach(arg => {
      if (typeof arg === 'string') expect(arg).not.toContain('unknown@other.com');
    }));
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
        autoSubmitted: true,
      })
    );
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        body: expect.stringContaining('Note saved.'),
        autoSubmitted: true,
      })
    );
    expect(callRaw).not.toHaveBeenCalled();
  });

  describe('CONFIRM / REJECT / WRONGDEAL subject verbs', () => {
    function makeTcTransactionWithSetStatus(status) {
      const txn = makeTcTransaction();
      return {
        ...txn,
        participantProposals: {
          [SET_ID]: { ...txn.participantProposals[SET_ID], status },
        },
      };
    }

    // ── claim / parse ────────────────────────────────────────────────────────

    test('CONFIRM with valid ids calls confirmProposalSet with { now }, never reaches Haiku', async () => {
      confirmProposalSet.mockReturnValue({ outcome: 'confirmed', participantIds: {} });
      const msg = makeMsg({ subject: `CONFIRM ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(confirmProposalSet).toHaveBeenCalledTimes(1);
      const [agentIdArg, txnArg, setArg, opts] = confirmProposalSet.mock.calls[0];
      expect(agentIdArg).toBe(AGENT_ID);
      expect(txnArg).toBe(TXN_ID);
      expect(setArg).toBe(SET_ID);
      expect(opts).toEqual({ now: expect.any(Date) });
      expect(markWrongDeal).not.toHaveBeenCalled();
      expect(rejectProposalMember).not.toHaveBeenCalled();
      expect(callRaw).not.toHaveBeenCalled();
    });

    test('WRONGDEAL with valid ids calls markWrongDeal with { now }, never reaches Haiku', async () => {
      markWrongDeal.mockReturnValue({ outcome: 'wrong_deal_recorded' });
      const msg = makeMsg({ subject: `WRONGDEAL ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(markWrongDeal).toHaveBeenCalledTimes(1);
      const [agentIdArg, txnArg, setArg, opts] = markWrongDeal.mock.calls[0];
      expect(agentIdArg).toBe(AGENT_ID);
      expect(txnArg).toBe(TXN_ID);
      expect(setArg).toBe(SET_ID);
      expect(opts).toEqual({ now: expect.any(Date) });
      expect(confirmProposalSet).not.toHaveBeenCalled();
      expect(rejectProposalMember).not.toHaveBeenCalled();
      expect(callRaw).not.toHaveBeenCalled();
    });

    test('REJECT with valid ids calls rejectProposalMember with { now, at, actor: "agent" }, never reaches Haiku', async () => {
      rejectProposalMember.mockReturnValue({ outcome: 'rejected' });
      const msg = makeMsg({ subject: `REJECT ${TXN_ID} ${SET_ID} ${MEMBER_ID_NAMED}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(rejectProposalMember).toHaveBeenCalledTimes(1);
      const [agentIdArg, txnArg, setArg, memberArg, opts] = rejectProposalMember.mock.calls[0];
      expect(agentIdArg).toBe(AGENT_ID);
      expect(txnArg).toBe(TXN_ID);
      expect(setArg).toBe(SET_ID);
      expect(memberArg).toBe(MEMBER_ID_NAMED);
      expect(opts.actor).toBe('agent');
      expect(opts.now).toBeInstanceOf(Date);
      expect(opts.at).toBe(opts.now.toISOString());
      expect(Object.keys(opts).sort()).toEqual(['actor', 'at', 'now']);
      expect(confirmProposalSet).not.toHaveBeenCalled();
      expect(markWrongDeal).not.toHaveBeenCalled();
      expect(callRaw).not.toHaveBeenCalled();
    });

    test('fall-through: "Confirm our showing tomorrow" calls no composition and goes down today\'s Track 2 path', async () => {
      const msg = makeMsg({ subject: 'Confirm our showing tomorrow' });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(confirmProposalSet).not.toHaveBeenCalled();
      expect(markWrongDeal).not.toHaveBeenCalled();
      expect(rejectProposalMember).not.toHaveBeenCalled();
      expect(callRaw).toHaveBeenCalledTimes(1);
    });

    test('"Re: CONFIRM <valid ids>" calls no composition and falls through to Track 2', async () => {
      const msg = makeMsg({ subject: `Re: CONFIRM ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(confirmProposalSet).not.toHaveBeenCalled();
      expect(callRaw).toHaveBeenCalledTimes(1);
    });

    test('lowercase "confirm <valid ids>" is claimed', async () => {
      confirmProposalSet.mockReturnValue({ outcome: 'confirmed', participantIds: {} });
      const msg = makeMsg({ subject: `confirm ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(confirmProposalSet).toHaveBeenCalledTimes(1);
    });

    // ── malformed: no composition call, parse-failure reply, note sent ────────

    test('malformed: bad transaction id -> no composition call, parse-failure reply, note sent', async () => {
      const msg = makeMsg({ subject: `CONFIRM txn-BADID ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(confirmProposalSet).not.toHaveBeenCalled();
      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: AGENT_EMAIL, body: "Nothing was changed. We couldn't read that request. Mo has been told and will follow up." })
      );
      expect(gmail.sendNewEmail).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: OPERATOR_EMAIL }));
    });

    test('malformed: wrong token count for CONFIRM (missing setId) -> no composition call, parse-failure reply, note sent', async () => {
      const msg = makeMsg({ subject: `CONFIRM ${TXN_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(confirmProposalSet).not.toHaveBeenCalled();
      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: AGENT_EMAIL, body: "Nothing was changed. We couldn't read that request. Mo has been told and will follow up." })
      );
      expect(gmail.sendNewEmail).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: OPERATOR_EMAIL }));
    });

    test('malformed: wrong token count for REJECT (missing memberId) -> no composition call, parse-failure reply, note sent', async () => {
      const msg = makeMsg({ subject: `REJECT ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(rejectProposalMember).not.toHaveBeenCalled();
      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: AGENT_EMAIL, body: "Nothing was changed. We couldn't read that request. Mo has been told and will follow up." })
      );
      expect(gmail.sendNewEmail).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: OPERATOR_EMAIL }));
    });

    // ── every outcome row: exact reply text, note sent or not exactly as marked ──

    test('CONFIRM confirmed: exact reply text, no note', async () => {
      confirmProposalSet.mockReturnValue({ outcome: 'confirmed', participantIds: { [MEMBER_ID_NAMED]: PARTICIPANT_ID_NAMED } });
      const msg = makeMsg({ subject: `CONFIRM ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: AGENT_EMAIL, body: `Done. Added to ${ADDRESS}: Jane Doe (your client). If anyone here is wrong, email Mo at mohanad@getklosed.ca.` })
      );
      expect(gmail.sendNewEmail).not.toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: OPERATOR_EMAIL }));
    });

    test('CONFIRM already_confirmed: exact reply text, no note', async () => {
      confirmProposalSet.mockReturnValue({ outcome: 'already_confirmed' });
      const msg = makeMsg({ subject: `CONFIRM ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: AGENT_EMAIL, body: `Already done. These people were added to ${ADDRESS} earlier, so nothing was changed.` })
      );
      expect(gmail.sendNewEmail).not.toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: OPERATOR_EMAIL }));
    });

    test('CONFIRM set_discarded: exact reply text, note sent', async () => {
      confirmProposalSet.mockReturnValue({ outcome: 'set_discarded' });
      const msg = makeMsg({ subject: `CONFIRM ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: AGENT_EMAIL, body: `Nothing was changed. This group was marked as the wrong deal for ${ADDRESS} earlier, so no one was added. Mo has been told and will follow up.` })
      );
      expect(gmail.sendNewEmail).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: OPERATOR_EMAIL }));
    });

    test('CONFIRM filing_rejected: exact reply text, note sent', async () => {
      confirmProposalSet.mockReturnValue({ outcome: 'filing_rejected' });
      const msg = makeMsg({ subject: `CONFIRM ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: AGENT_EMAIL, body: `Nothing was changed. The document these people came from was marked as not belonging to ${ADDRESS}, so no one was added. Mo has been told and will follow up.` })
      );
      expect(gmail.sendNewEmail).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: OPERATOR_EMAIL }));
    });

    test('WRONGDEAL wrong_deal_recorded: exact reply text, no note', async () => {
      markWrongDeal.mockReturnValue({ outcome: 'wrong_deal_recorded' });
      const msg = makeMsg({ subject: `WRONGDEAL ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: AGENT_EMAIL, body: `Got it. This document is marked as not belonging to ${ADDRESS}, and no one from it was added.` })
      );
      expect(gmail.sendNewEmail).not.toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: OPERATOR_EMAIL }));
    });

    test('WRONGDEAL already_discarded: exact reply text, no note', async () => {
      markWrongDeal.mockReturnValue({ outcome: 'already_discarded' });
      const msg = makeMsg({ subject: `WRONGDEAL ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: AGENT_EMAIL, body: 'Already done. This was marked as the wrong deal earlier, so nothing was changed.' })
      );
      expect(gmail.sendNewEmail).not.toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: OPERATOR_EMAIL }));
    });

    test('WRONGDEAL set_confirmed: exact reply text, note sent', async () => {
      markWrongDeal.mockReturnValue({ outcome: 'set_confirmed' });
      const msg = makeMsg({ subject: `WRONGDEAL ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: AGENT_EMAIL, body: `Nothing was changed. These people were already added to ${ADDRESS}. Mo has been told and will sort it out with you.` })
      );
      expect(gmail.sendNewEmail).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: OPERATOR_EMAIL }));
    });

    test('WRONGDEAL filing_confirmed: exact reply text, note sent', async () => {
      markWrongDeal.mockReturnValue({ outcome: 'filing_confirmed' });
      const msg = makeMsg({ subject: `WRONGDEAL ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: AGENT_EMAIL, body: `Nothing was changed. This document was already confirmed as belonging to ${ADDRESS}. Mo has been told and will follow up.` })
      );
      expect(gmail.sendNewEmail).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: OPERATOR_EMAIL }));
    });

    test('REJECT rejected: exact reply text, no note', async () => {
      rejectProposalMember.mockReturnValue({ outcome: 'rejected' });
      const msg = makeMsg({ subject: `REJECT ${TXN_ID} ${SET_ID} ${MEMBER_ID_NAMED}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: AGENT_EMAIL, body: `Done. Jane Doe won't be added to ${ADDRESS}.` })
      );
      expect(gmail.sendNewEmail).not.toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: OPERATOR_EMAIL }));
    });

    test('REJECT already_rejected: exact reply text, no note', async () => {
      rejectProposalMember.mockReturnValue({ outcome: 'already_rejected' });
      const msg = makeMsg({ subject: `REJECT ${TXN_ID} ${SET_ID} ${MEMBER_ID_NAMED}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: AGENT_EMAIL, body: 'Already done. Jane Doe was removed earlier, so nothing was changed.' })
      );
      expect(gmail.sendNewEmail).not.toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: OPERATOR_EMAIL }));
    });

    test('REJECT set_closed on a confirmed set: exact reply text, note sent', async () => {
      rejectProposalMember.mockReturnValue({ outcome: 'set_closed' });
      store.readTransaction.mockReturnValue(makeTcTransactionWithSetStatus('confirmed'));
      const msg = makeMsg({ subject: `REJECT ${TXN_ID} ${SET_ID} ${MEMBER_ID_NAMED}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: AGENT_EMAIL, body: `Nothing was changed. Jane Doe was already added to ${ADDRESS}. Mo has been told and will sort it out with you.` })
      );
      expect(gmail.sendNewEmail).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: OPERATOR_EMAIL }));
    });

    test('REJECT set_closed on a discarded set: exact reply text, no note', async () => {
      rejectProposalMember.mockReturnValue({ outcome: 'set_closed' });
      store.readTransaction.mockReturnValue(makeTcTransactionWithSetStatus('discarded'));
      const msg = makeMsg({ subject: `REJECT ${TXN_ID} ${SET_ID} ${MEMBER_ID_NAMED}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: AGENT_EMAIL, body: `Nothing was changed. This group was already marked as the wrong deal for ${ADDRESS}, so Jane Doe was never added.` })
      );
      expect(gmail.sendNewEmail).not.toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: OPERATOR_EMAIL }));
    });

    test('REJECT set_closed on any other set status: generic reply, note sent', async () => {
      rejectProposalMember.mockReturnValue({ outcome: 'set_closed' });
      store.readTransaction.mockReturnValue(makeTcTransactionWithSetStatus('weird'));
      const msg = makeMsg({ subject: `REJECT ${TXN_ID} ${SET_ID} ${MEMBER_ID_NAMED}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: AGENT_EMAIL, body: 'Nothing was changed. Something went wrong on our end. Mo has been told and will follow up.' })
      );
      expect(gmail.sendNewEmail).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: OPERATOR_EMAIL }));
    });

    test('transaction_not_found: exact reply text, note sent, no DESCRIBE attempted', async () => {
      confirmProposalSet.mockReturnValue({ outcome: 'transaction_not_found' });
      const msg = makeMsg({ subject: `CONFIRM ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: AGENT_EMAIL, body: "Nothing was changed. We couldn't find that deal. Mo has been told and will follow up." })
      );
      expect(gmail.sendNewEmail).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: OPERATOR_EMAIL }));
      expect(store.readTransaction).not.toHaveBeenCalled();
    });

    test('set_not_found: exact reply text, note sent', async () => {
      confirmProposalSet.mockReturnValue({ outcome: 'set_not_found' });
      const msg = makeMsg({ subject: `CONFIRM ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: AGENT_EMAIL, body: "Nothing was changed. We couldn't find that deal. Mo has been told and will follow up." })
      );
      expect(gmail.sendNewEmail).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: OPERATOR_EMAIL }));
    });

    // ── composition throws ───────────────────────────────────────────────────

    test('composition throws -> reply begins "Nothing was changed." and a note is sent', async () => {
      confirmProposalSet.mockImplementation(() => { throw new Error('disk exploded'); });
      const msg = makeMsg({ subject: `CONFIRM ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: AGENT_EMAIL, body: expect.stringMatching(/^Nothing was changed\./) })
      );
      expect(gmail.sendNewEmail).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: OPERATOR_EMAIL }));
    });

    // ── LOAD-BEARING ──────────────────────────────────────────────────────────

    test('LOAD-BEARING: confirmed + readTransaction throws -> reply contains "Done." and not "Nothing was changed"; note sent', async () => {
      confirmProposalSet.mockReturnValue({ outcome: 'confirmed', participantIds: { [MEMBER_ID_NAMED]: PARTICIPANT_ID_NAMED } });
      store.readTransaction.mockImplementation(() => { throw new Error('disk read failed'); });
      const msg = makeMsg({ subject: `CONFIRM ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      const agentReplyCall = gmail.sendNewEmail.mock.calls.find((call) => call[1].to === AGENT_EMAIL);
      expect(agentReplyCall).toBeDefined();
      expect(agentReplyCall[1].body).toContain('Done.');
      expect(agentReplyCall[1].body).not.toContain('Nothing was changed');
      expect(gmail.sendNewEmail).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: OPERATOR_EMAIL }));
    });

    test('LOAD-BEARING: the agent reply send rejects on a noted outcome -> note still sent, no second "went wrong" reply, markRead called, replied=false logged', async () => {
      jest.useFakeTimers();
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      markWrongDeal.mockReturnValue({ outcome: 'set_confirmed' });
      gmail.sendNewEmail.mockImplementation((cfg, { to }) => {
        if (to === AGENT_EMAIL) return Promise.reject(new Error('smtp down'));
        return Promise.resolve();
      });
      const msg = makeMsg({ subject: `WRONGDEAL ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      const runPromise = runActionHandler([AGENT_CONFIG]);
      await jest.runAllTimersAsync();
      await runPromise;

      const secondReply = gmail.sendNewEmail.mock.calls.some(
        (call) => call[1].body === 'Something went wrong processing your request. Please try again or contact support.'
      );
      expect(secondReply).toBe(false);
      expect(gmail.sendNewEmail).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: OPERATOR_EMAIL }));
      expect(gmail.markRead).toHaveBeenCalledWith(expect.any(Object), 'msg-1');

      const line = logSpy.mock.calls.map((c) => c[0]).find((l) => typeof l === 'string' && l.startsWith('[tc-verb]'));
      expect(line).toBeDefined();
      expect(line).toContain('replied=false');
    });

    test('backstop: an unexpected throw inside the branch (store.isTransactionId throws) gets a safe reply and an unexpected_error note, never the catch-all reply', async () => {
      jest.spyOn(store, 'isTransactionId').mockImplementation(() => { throw new Error('validator exploded'); });
      const msg = makeMsg({ subject: `CONFIRM ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          to: AGENT_EMAIL,
          body: "We got your request, but couldn't confirm whether it went through. Mo has been told and will check.",
        })
      );
      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: OPERATOR_EMAIL, body: expect.stringContaining('outcome: unexpected_error') })
      );
      const wentWrong = gmail.sendNewEmail.mock.calls.some(
        (call) => call[1].body === 'Something went wrong processing your request. Please try again or contact support.'
      );
      expect(wentWrong).toBe(false);
      expect(gmail.markRead).toHaveBeenCalledWith(expect.any(Object), 'msg-1');
    });

    test('operator note fails: loadOperator throws -> agent reply still sent, markRead still called', async () => {
      confirmProposalSet.mockReturnValue({ outcome: 'set_discarded' });
      loadOperator.mockImplementation(() => { throw new Error('operator config not found'); });
      const msg = makeMsg({ subject: `CONFIRM ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: AGENT_EMAIL, body: expect.stringContaining('This group was marked as the wrong deal') })
      );
      expect(gmail.markRead).toHaveBeenCalledWith(expect.any(Object), 'msg-1');
    });

    test('operator note fails: the operator send rejects -> agent reply still sent, markRead still called', async () => {
      jest.useFakeTimers();
      confirmProposalSet.mockReturnValue({ outcome: 'set_discarded' });
      gmail.sendNewEmail.mockImplementation((cfg, { to }) => {
        if (to === OPERATOR_EMAIL) return Promise.reject(new Error('operator smtp down'));
        return Promise.resolve();
      });
      const msg = makeMsg({ subject: `CONFIRM ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      const runPromise = runActionHandler([AGENT_CONFIG]);
      await jest.runAllTimersAsync();
      await runPromise;

      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ to: AGENT_EMAIL, body: expect.stringContaining('This group was marked as the wrong deal') })
      );
      expect(gmail.markRead).toHaveBeenCalledWith(expect.any(Object), 'msg-1');
    });

    // ── confirmed-list / member-name rendering ───────────────────────────────

    test('confirmed list: a named participant renders "Name (your client)"', async () => {
      confirmProposalSet.mockReturnValue({ outcome: 'confirmed', participantIds: { [MEMBER_ID_NAMED]: PARTICIPANT_ID_NAMED } });
      const msg = makeMsg({ subject: `CONFIRM ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      expect(gmail.sendNewEmail).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ body: expect.stringContaining('Jane Doe (your client)') })
      );
    });

    test('confirmed list: a nameless participant (string email) renders its email, never "[object Object]"', async () => {
      confirmProposalSet.mockReturnValue({ outcome: 'confirmed', participantIds: { [MEMBER_ID_NAMELESS]: PARTICIPANT_ID_NAMELESS } });
      const msg = makeMsg({ subject: `CONFIRM ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      const call = gmail.sendNewEmail.mock.calls.find((c) => c[1].to === AGENT_EMAIL);
      expect(call[1].body).toContain('nameless-participant@example.com');
      expect(call[1].body).not.toContain('[object Object]');
    });

    test('REJECT: a nameless member (object email) renders its address, never "[object Object]"', async () => {
      rejectProposalMember.mockReturnValue({ outcome: 'rejected' });
      const msg = makeMsg({ subject: `REJECT ${TXN_ID} ${SET_ID} ${MEMBER_ID_NAMELESS}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      const call = gmail.sendNewEmail.mock.calls.find((c) => c[1].to === AGENT_EMAIL);
      expect(call[1].body).toContain('nameless-member@example.com');
      expect(call[1].body).not.toContain('[object Object]');
    });

    // ── logging ───────────────────────────────────────────────────────────────

    test('the [tc-verb] log line contains no "@"', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      confirmProposalSet.mockReturnValue({ outcome: 'confirmed', participantIds: { [MEMBER_ID_NAMED]: PARTICIPANT_ID_NAMED } });
      const msg = makeMsg({ subject: `CONFIRM ${TXN_ID} ${SET_ID}` });
      gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

      await runActionHandler([AGENT_CONFIG]);

      const line = logSpy.mock.calls.map((c) => c[0]).find((l) => typeof l === 'string' && l.startsWith('[tc-verb]'));
      expect(line).toBeDefined();
      expect(line).not.toContain('@');
    });
  });

  test('APPROVE calls approveVersion with latest versionId and sends reply', async () => {
    const msg = makeMsg({ subject: 'APPROVE reel-001' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(approveVersion).toHaveBeenCalledWith(AGENT_ID, WEEK_ISO, 'reel-001', 'v-2026');
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'assistant' }),
      expect.objectContaining({ to: AGENT_EMAIL, subject: 'Re: APPROVE reel-001', autoSubmitted: true })
    );
    expect(gmail.markRead).toHaveBeenCalledWith(expect.any(Object), 'msg-1');
  });

  test('a recognized agent Track 1 confirmation is sent with autoSubmitted: true', async () => {
    const msg = makeMsg({ subject: 'APPROVE reel-001' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ autoSubmitted: true })
    );
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
      expect.objectContaining({ to: AGENT_EMAIL, autoSubmitted: true })
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
      expect.objectContaining({ body: expect.stringContaining('5 times this week'), autoSubmitted: true })
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
      expect.objectContaining({ body: expect.stringContaining("didn't understand that action"), autoSubmitted: true })
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
      expect.objectContaining({ body: expect.stringContaining('follow-ups paused for Sarah'), autoSubmitted: true })
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
      expect.objectContaining({ body: expect.stringContaining('No lead found matching'), autoSubmitted: true })
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
      expect.objectContaining({ body: expect.stringContaining('Found 2 leads matching'), autoSubmitted: true })
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
      expect.objectContaining({ body: expect.stringContaining('marked as SOI'), autoSubmitted: true })
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
      expect.objectContaining({ body: expect.stringContaining('account is paused'), autoSubmitted: true })
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
      expect.objectContaining({ body: expect.stringContaining('account is active again'), autoSubmitted: true })
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
      expect.objectContaining({ body: expect.stringContaining('Sending your digest now'), autoSubmitted: true })
    );
  });

  test('Track 2 unknown intent sends did-not-understand reply', async () => {
    callRaw.mockResolvedValue(JSON.stringify({ intent: 'unknown', leadName: null, confidence: 0.9 }));
    const msg = makeMsg({ subject: 'something random', body: 'do something weird' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([AGENT_CONFIG]);

    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ body: expect.stringContaining("didn't understand that request"), autoSubmitted: true })
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
      expect.objectContaining({ body: expect.stringContaining("didn't understand that request"), autoSubmitted: true })
    );
  });

  test('error in processing sends error reply and runActionHandler does not throw', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    readContentState.mockImplementation(() => { throw new Error('state read failed'); });
    const msg = makeMsg({ subject: 'APPROVE reel-001' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await expect(runActionHandler([AGENT_CONFIG])).resolves.toBeUndefined();

    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ body: expect.stringContaining('Something went wrong'), autoSubmitted: true })
    );
    expect(gmail.markRead).toHaveBeenCalledWith(expect.any(Object), 'msg-1');

    const errorLine = logSpy.mock.calls.map(call => call[0])
      .find(line => typeof line === 'string' && line.startsWith('[actionHandler] error processing email'));
    expect(errorLine).toBeDefined();
    logSpy.mock.calls.forEach(call => call.forEach(arg => {
      if (typeof arg === 'string') expect(arg).not.toContain(AGENT_EMAIL);
    }));
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
        expect.objectContaining({ to: AGENT_EMAIL, subject: 'Re: APPROVE reel-001', autoSubmitted: true })
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
