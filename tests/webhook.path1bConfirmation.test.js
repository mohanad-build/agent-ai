'use strict';

jest.mock('twilio', () => ({ validateRequest: jest.fn() }));
jest.mock('../src/agentConfig', () => ({ findAgentByPhone: jest.fn().mockReturnValue(null) }));
jest.mock('../src/claude', () => ({ draft: jest.fn() }));
jest.mock('../src/email', () => ({
  readSheetRows: jest.fn(),
  getSignaturePresence: jest.fn(),
  sendNewEmail: jest.fn(),
  sendReply: jest.fn(),
  getThreadHistory: jest.fn(),
  updateSheetRow: jest.fn(),
  appendToConversationHistory: jest.fn(),
}));
jest.mock('../src/twilio', () => ({ sendSMS: jest.fn(), TEMPLATES: {} }));
jest.mock('../src/prompts', () => ({
  buildPath1BDraftPrompt: jest.fn().mockReturnValue({ system: 's', user: 'u' }),
  getMergedBannedPhrases: jest.fn().mockReturnValue([]),
}));

const claude = require('../src/claude');
const email = require('../src/email');
const twilioSrc = require('../src/twilio');
const prompts = require('../src/prompts');
const { handleAgentReply } = require('../src/webhook');

describe('handleAgentReply Path 1B confirmation SMS', () => {
  function baseAgent(mode) {
    return {
      agentId: 'agent-1',
      agentPhone: '+15551234567',
      gmailAddress: 'agent@example.com',
      mode,
    };
  }

  function makeRow(overrides = {}) {
    return {
      rowIndex: 5,
      name: 'Jane Doe',
      leadId: 'jane@example.com',
      originalMessage: 'Looking for a 3 bed',
      pendingQuestion: '[Q1] What is the price?',
      gmailThreadId: 'thread-1',
      ...overrides,
    };
  }

  function confirmationMessages() {
    return twilioSrc.sendSMS.mock.calls.map(([, msg]) => msg);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    claude.draft.mockResolvedValue({ text: 'Great, here are the details.', attempts: 1 });
    email.getSignaturePresence.mockResolvedValue(true);
    email.sendNewEmail.mockResolvedValue({});
    email.sendReply.mockResolvedValue({});
    email.getThreadHistory.mockResolvedValue([]);
    email.updateSheetRow.mockResolvedValue({});
    email.appendToConversationHistory.mockResolvedValue({});
    twilioSrc.sendSMS.mockResolvedValue({ sid: 'SM123' });
    prompts.buildPath1BDraftPrompt.mockReturnValue({ system: 's', user: 'u' });
    prompts.getMergedBannedPhrases.mockReturnValue([]);
  });

  it('live mode, queue emptied: confirmation says sent, names the lead, no remaining-count suffix', async () => {
    const agent = baseAgent('live');
    email.readSheetRows.mockResolvedValue([makeRow({ pendingQuestion: '[Q1] What is the price?' })]);

    await handleAgentReply(agent, 'Q1 $500k', 'SM1', 'single', 'Q1');

    const msg = confirmationMessages().find((m) => m.startsWith('Answer sent to'));
    expect(msg).toBe('Answer sent to Jane Doe.');
    expect(msg).not.toMatch(/more open/);
  });

  it('live mode, 2 questions remaining: confirmation includes "2 more open"', async () => {
    const agent = baseAgent('live');
    email.readSheetRows.mockResolvedValue([
      makeRow({ pendingQuestion: '[Q1] q1? || [Q2] q2? || [Q3] q3?' }),
    ]);

    await handleAgentReply(agent, 'Q1 answer', 'SM2', 'single', 'Q1');

    const msg = confirmationMessages().find((m) => m.startsWith('Answer sent to'));
    expect(msg).toBe('Answer sent to Jane Doe. 2 more open for this lead.');
  });

  it('shadow mode: confirmation says draft in inbox, and the string does not contain "sent"', async () => {
    const agent = baseAgent('shadow');
    email.readSheetRows.mockResolvedValue([makeRow({ pendingQuestion: '[Q1] What is the price?' })]);

    await handleAgentReply(agent, 'Q1 $500k', 'SM3', 'single', 'Q1');

    const msg = confirmationMessages().find((m) => m.startsWith('Draft for'));
    expect(msg).toBe('Draft for Jane Doe is in your inbox. Lead not contacted yet.');
    expect(msg.toLowerCase()).not.toContain('sent');
  });

  it('shadow mode with remaining questions: both halves present', async () => {
    const agent = baseAgent('shadow');
    email.readSheetRows.mockResolvedValue([
      makeRow({ pendingQuestion: '[Q1] q1? || [Q2] q2?' }),
    ]);

    await handleAgentReply(agent, 'Q1 answer', 'SM4', 'single', 'Q1');

    const msg = confirmationMessages().find((m) => m.startsWith('Draft for'));
    expect(msg).toContain('Draft for Jane Doe is in your inbox. Lead not contacted yet.');
    expect(msg).toContain('1 more open for this lead.');
  });

  it('matchedRow.name empty: falls back to the lead email in the message', async () => {
    const agent = baseAgent('live');
    email.readSheetRows.mockResolvedValue([
      makeRow({ name: '', pendingQuestion: '[Q1] What is the price?' }),
    ]);

    await handleAgentReply(agent, 'Q1 $500k', 'SM5', 'single', 'Q1');

    const msg = confirmationMessages().find((m) => m.startsWith('Answer sent to'));
    expect(msg).toBe('Answer sent to jane@example.com.');
  });

  it('claude.draft throw: sends the "could not draft" notification and returns normally', async () => {
    const agent = baseAgent('live');
    email.readSheetRows.mockResolvedValue([makeRow({ pendingQuestion: '[Q1] What is the price?' })]);
    claude.draft.mockRejectedValueOnce(new Error('boom'));

    await expect(handleAgentReply(agent, 'Q1 $500k', 'SM6', 'single', 'Q1')).resolves.toBeUndefined();

    expect(twilioSrc.sendSMS).toHaveBeenCalledWith(
      agent,
      'Could not draft a reply for Q1. The question stays in your queue.'
    );
    expect(email.updateSheetRow).not.toHaveBeenCalled();
  });

  it('shadow sendNewEmail failure: sends the "could not deliver" notification and returns normally', async () => {
    const agent = baseAgent('shadow');
    email.readSheetRows.mockResolvedValue([makeRow({ pendingQuestion: '[Q1] What is the price?' })]);
    email.sendNewEmail.mockRejectedValueOnce(new Error('gmail down'));

    await expect(handleAgentReply(agent, 'Q1 $500k', 'SM7', 'single', 'Q1')).resolves.toBeUndefined();

    expect(twilioSrc.sendSMS).toHaveBeenCalledWith(
      agent,
      'Could not deliver the draft for Q1. The question stays in your queue, try again.'
    );
    expect(email.updateSheetRow).not.toHaveBeenCalled();
  });

  it('live sendReply failure: sends the "could not send" notification and returns normally', async () => {
    const agent = baseAgent('live');
    email.readSheetRows.mockResolvedValue([makeRow({ pendingQuestion: '[Q1] What is the price?' })]);
    email.sendReply.mockRejectedValueOnce(new Error('gmail down'));

    await expect(handleAgentReply(agent, 'Q1 $500k', 'SM8', 'single', 'Q1')).resolves.toBeUndefined();

    expect(twilioSrc.sendSMS).toHaveBeenCalledWith(
      agent,
      'Could not send your answer to Jane Doe. The question stays in your queue, try again.'
    );
    expect(email.updateSheetRow).not.toHaveBeenCalled();
  });

  it('updateSheetRow failure: sends the bookkeeping-failure notification, falls through to column L, and returns normally', async () => {
    const agent = baseAgent('live');
    email.readSheetRows.mockResolvedValue([makeRow({ pendingQuestion: '[Q1] What is the price?' })]);
    email.updateSheetRow.mockRejectedValueOnce(new Error('sheets API down'));

    await expect(handleAgentReply(agent, 'Q1 $500k', 'SM9', 'single', 'Q1')).resolves.toBeUndefined();

    expect(twilioSrc.sendSMS).toHaveBeenCalledWith(
      agent,
      'Answer sent to Jane Doe. The sheet did not update, so you may see this question again.'
    );
    expect(email.appendToConversationHistory).toHaveBeenCalled();
  });

  it('updateSheetRow failure sends EXACTLY ONE sms', async () => {
    const agent = baseAgent('live');
    email.readSheetRows.mockResolvedValue([makeRow({ pendingQuestion: '[Q1] What is the price?' })]);
    email.updateSheetRow.mockRejectedValueOnce(new Error('sheets API down'));

    await handleAgentReply(agent, 'Q1 $500k', 'SM9b', 'single', 'Q1');

    expect(twilioSrc.sendSMS.mock.calls.length).toBe(1);
    const messages = confirmationMessages();
    expect(messages).not.toContain('Answer sent to Jane Doe.');
  });

  it('updateSheetRow failure in shadow mode: single message starts with "Draft for" and does not contain "sent"', async () => {
    const agent = baseAgent('shadow');
    email.readSheetRows.mockResolvedValue([makeRow({ pendingQuestion: '[Q1] What is the price?' })]);
    email.updateSheetRow.mockRejectedValueOnce(new Error('sheets API down'));

    await handleAgentReply(agent, 'Q1 $500k', 'SM9c', 'single', 'Q1');

    expect(twilioSrc.sendSMS.mock.calls.length).toBe(1);
    const msg = confirmationMessages()[0];
    expect(msg.startsWith('Draft for')).toBe(true);
    expect(msg.toLowerCase()).not.toContain('sent');
  });

  it('the happy path still sends exactly one sms', async () => {
    const agent = baseAgent('live');
    email.readSheetRows.mockResolvedValue([makeRow({ pendingQuestion: '[Q1] What is the price?' })]);

    await handleAgentReply(agent, 'Q1 $500k', 'SM9d', 'single', 'Q1');

    expect(twilioSrc.sendSMS.mock.calls.length).toBe(1);
  });

  it('a throwing sendSMS in notifySafely does not propagate: the handler still completes and the Sheet write still happened', async () => {
    const agent = baseAgent('live');
    email.readSheetRows.mockResolvedValue([makeRow({ pendingQuestion: '[Q1] What is the price?' })]);
    twilioSrc.sendSMS.mockRejectedValue(new Error('twilio down'));

    await expect(handleAgentReply(agent, 'Q1 $500k', 'SM10', 'single', 'Q1')).resolves.toBeUndefined();

    expect(email.updateSheetRow).toHaveBeenCalledTimes(1);
  });

  it('the escalate branch still sends its original unchanged message', async () => {
    const agent = baseAgent('live');
    email.readSheetRows.mockResolvedValue([makeRow({ pendingQuestion: '[Q1] What is the price?' })]);
    claude.draft.mockResolvedValueOnce({ escalate: true, attempts: 3, violations: ['banned phrase'] });

    await expect(handleAgentReply(agent, 'Q1 $500k', 'SM11', 'single', 'Q1')).resolves.toBeUndefined();

    expect(twilioSrc.sendSMS).toHaveBeenCalledWith(
      agent,
      'Could not draft email for Q1. Please email jane@example.com directly. The question stays open in your queue.'
    );
    expect(email.updateSheetRow).not.toHaveBeenCalled();
  });
});
