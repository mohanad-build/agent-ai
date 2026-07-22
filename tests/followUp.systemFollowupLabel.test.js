'use strict';

// ── Mock followUp.js dependencies (order matters: before any require) ─────────

jest.mock('../src/email', () => ({
  readSheetRows: jest.fn(),
  getSignaturePresence: jest.fn(),
  sendReply: jest.fn(),
  sendNewEmail: jest.fn(),
  updateSheetRow: jest.fn(),
  appendToConversationHistory: jest.fn(),
  getThreadHistory: jest.fn(),
}));
jest.mock('../src/gmail', () => ({
  ensureLabels: jest.fn(),
  applyMessageLabels: jest.fn(),
}));
jest.mock('../src/claude', () => ({ draft: jest.fn() }));
jest.mock('../src/prompts', () => ({
  buildFollowUpDay3Prompt: jest.fn().mockReturnValue('prompt-text'),
  buildFollowUpDay7Prompt: jest.fn().mockReturnValue('prompt-text'),
  buildFollowUpDay14Prompt: jest.fn().mockReturnValue('prompt-text'),
  getMergedBannedPhrases: jest.fn().mockReturnValue([]),
}));
jest.mock('../src/paths', () => ({ buildShadowDraftWrapper: jest.fn() }));
jest.mock('../src/agentConfig', () => ({ getFollowUpCadence: jest.fn().mockReturnValue([3, 7, 14]) }));
jest.mock('../src/time', () => ({
  getNow: jest.fn(() => Date.now()),
  getNowIso: jest.fn().mockReturnValue('2026-07-22T00:00:00.000Z'),
}));
jest.mock('../src/agentState', () => ({ incrementWeeklyPreflightSkips: jest.fn() }));

// ── Pull in modules under test ────────────────────────────────────────────────

const { runFollowUps } = require('../src/followUp');
const email = require('../src/email');
const gmail = require('../src/gmail');
const claude = require('../src/claude');
const paths = require('../src/paths');

const LABEL_SYSTEM_FOLLOWUP = 'agent-ai/system-followup';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAgentConfig(overrides = {}) {
  return {
    agentId: 'label-test',
    isActive: true,
    googleSheetId: 'sheet-123',
    timezone: 'America/Toronto',
    ...overrides,
  };
}

function fiveDaysAgoIso() {
  return new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
}

function makeRow(overrides = {}) {
  return {
    rowIndex: 5,
    status: 'awaiting_response',
    aiEnabled: '',
    followUpCount: '0',
    lastFollowUpDate: fiveDaysAgoIso(),
    lastActionTimestamp: '',
    gmailThreadId: '',
    leadId: 'lead@example.com',
    originalMessage: 'Interested in the property',
    conversationHistory: '',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  claude.draft.mockResolvedValue({ escalate: false, text: 'draft body', attempts: 1 });
  email.getSignaturePresence.mockResolvedValue(false);
  email.updateSheetRow.mockResolvedValue(undefined);
  email.appendToConversationHistory.mockResolvedValue(undefined);
});

describe('runFollowUps: live-mode system-followup label', () => {
  it('applies the system-followup label to the sent id', async () => {
    const agentConfig = makeAgentConfig();
    const row = makeRow();
    email.readSheetRows.mockResolvedValue([row]);
    email.sendReply.mockResolvedValue({ id: 'sent-msg-123', threadId: 'thread-abc', labelIds: [] });
    gmail.ensureLabels.mockResolvedValue(new Map([[LABEL_SYSTEM_FOLLOWUP, 'label-xyz']]));
    gmail.applyMessageLabels.mockResolvedValue(undefined);

    const result = await runFollowUps(agentConfig);

    expect(gmail.ensureLabels).toHaveBeenCalledWith(agentConfig, [LABEL_SYSTEM_FOLLOWUP]);
    expect(gmail.applyMessageLabels).toHaveBeenCalledWith(agentConfig, 'sent-msg-123', ['label-xyz'], []);
    expect(result.fired).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('does NOT apply the label on the shadow-mode branch', async () => {
    const agentConfig = makeAgentConfig({ mode: 'shadow', gmailAddress: 'agent@example.com' });
    const row = makeRow();
    email.readSheetRows.mockResolvedValue([row]);
    paths.buildShadowDraftWrapper.mockReturnValue({ subject: '[SHADOW DRAFT] wrapped', body: 'wrapped body' });
    email.sendNewEmail.mockResolvedValue({ id: 'shadow-msg-1' });

    const result = await runFollowUps(agentConfig);

    expect(email.sendNewEmail).toHaveBeenCalledTimes(1);
    expect(gmail.applyMessageLabels).not.toHaveBeenCalled();
    expect(gmail.ensureLabels).not.toHaveBeenCalled();
    expect(result.fired).toBe(1);
  });

  it('a label failure does not throw and does not block the Sheet write', async () => {
    const agentConfig = makeAgentConfig();
    const row = makeRow();
    email.readSheetRows.mockResolvedValue([row]);
    email.sendReply.mockResolvedValue({ id: 'sent-msg-456', threadId: 'thread-def', labelIds: [] });
    gmail.ensureLabels.mockRejectedValue(new Error('label boom'));

    let threw = false;
    let result;
    try {
      result = await runFollowUps(agentConfig);
    } catch (err) {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(email.updateSheetRow).toHaveBeenCalledTimes(1);
    expect(result.fired).toBe(1);
    expect(result.errors).toBe(0);
  });
});
