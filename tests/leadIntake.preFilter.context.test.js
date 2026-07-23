'use strict';

// Load-bearing race guard: a known lead (already in Sheet column A) whose
// fresh, non-reply message gets misclassified as noise by the classifier
// must never reach the noise branch of processClassification, because that
// branch calls gmail.markRead, which would remove UNREAD before
// fetchUnreadReplies (queried later in the same processAgent cycle) ever
// sees the message. See leadIntake.js applyPreFilter's known-lead rule.

jest.mock('../src/gmail', () => ({
  fetchUnreadInboxEmails: jest.fn(),
  ensureLabels: jest.fn(),
  applyMessageLabels: jest.fn(),
  markRead: jest.fn(),
  findRowByEmail: jest.requireActual('../src/gmail').findRowByEmail,
}));

jest.mock('../src/email', () => ({
  readSheetRows: jest.fn(),
  appendSheetRow: jest.fn(),
  appendToConversationHistory: jest.fn(),
}));

jest.mock('../src/claude', () => ({
  callRaw: jest.fn(),
}));

jest.mock('../src/agentState', () => ({
  incrementNoiseFiltered: jest.fn(),
}));

const gmail = require('../src/gmail');
const email = require('../src/email');
const claude = require('../src/claude');
const agentState = require('../src/agentState');

const leadIntake = require('../src/leadIntake');
const { runLeadIntake } = leadIntake;
const {
  LABEL_PROCESSING,
  LABEL_INTAKEN,
  LABEL_NOISE,
  LABEL_FIRST_TOUCH_PENDING,
  LABEL_BUSINESS,
} = leadIntake._internal;

const MOCK_LABEL_MAP = new Map([
  [LABEL_PROCESSING, 'L_PROC'],
  [LABEL_INTAKEN, 'L_INTAKEN'],
  [LABEL_NOISE, 'L_NOISE'],
  [LABEL_FIRST_TOUCH_PENDING, 'L_FTP'],
  [LABEL_BUSINESS, 'L_BIZ'],
]);

const MOCK_AGENT = {
  agentId: 'race-test-agent',
  gmailAddress: 'agent@example.com',
  googleSheetId: 'sheet-id',
  googleRefreshToken: 'token',
};

// A fresh, non-reply message (no In-Reply-To) from a sender who already has
// a row in the Sheet, that the classifier will (mis)score as noise at a
// confidence above the noise threshold (0.85).
const knownLeadMsg = {
  messageId: 'm1',
  threadId: 't1',
  from: 'Known Lead <lead@example.com>',
  subject: 'Question about pricing on 12 Oak St',
  body: 'What is the price for 12 Oak St?',
  inReplyTo: '',
  labelIds: [],
  internalDate: Date.now(),
};

const noiseClassifierResponse = JSON.stringify({
  category: 'noise',
  confidence: 0.97,
  name: '',
  email: '',
  phone: '',
  inquiryMessage: '',
  propertyReference: '',
  reasoning: 'looks automated',
});

beforeEach(() => {
  jest.clearAllMocks();
  gmail.ensureLabels.mockResolvedValue(MOCK_LABEL_MAP);
  gmail.applyMessageLabels.mockResolvedValue(undefined);
  gmail.markRead.mockResolvedValue(undefined);
  email.appendSheetRow.mockResolvedValue(undefined);
  email.appendToConversationHistory.mockResolvedValue(undefined);
});

test('race guard: known lead misclassified as noise never reaches classification or markRead', async () => {
  gmail.fetchUnreadInboxEmails.mockResolvedValue([knownLeadMsg]);
  email.readSheetRows.mockResolvedValue([{ rowIndex: 5, leadId: 'lead@example.com' }]);
  claude.callRaw.mockResolvedValue(noiseClassifierResponse);

  const stats = await runLeadIntake(MOCK_AGENT);

  expect(claude.callRaw).not.toHaveBeenCalled();
  expect(gmail.markRead).not.toHaveBeenCalled();
  expect(stats.candidates).toBe(0);
});

test('control: same message with an unknown sender does reach classification and gets noise-labeled (left unread)', async () => {
  const unknownSenderMsg = Object.assign({}, knownLeadMsg, { from: 'Stranger <stranger@example.com>' });
  gmail.fetchUnreadInboxEmails.mockResolvedValue([unknownSenderMsg]);
  email.readSheetRows.mockResolvedValue([{ rowIndex: 5, leadId: 'lead@example.com' }]);
  claude.callRaw.mockResolvedValue(noiseClassifierResponse);

  const stats = await runLeadIntake(MOCK_AGENT);

  expect(claude.callRaw).toHaveBeenCalledTimes(1);
  expect(gmail.applyMessageLabels).toHaveBeenCalledWith(MOCK_AGENT, 'm1', ['L_NOISE'], ['L_PROC']);
  expect(gmail.markRead).not.toHaveBeenCalled();
  expect(stats.candidates).toBe(1);
  expect(stats.noise).toBe(1);
  expect(agentState.incrementNoiseFiltered).toHaveBeenCalledWith(MOCK_AGENT.agentId);
});

test('own address: a message from the agent itself never reaches classification', async () => {
  const selfSentMsg = Object.assign({}, knownLeadMsg, { from: 'Agent <agent@example.com>' });
  gmail.fetchUnreadInboxEmails.mockResolvedValue([selfSentMsg]);
  email.readSheetRows.mockResolvedValue([]);
  claude.callRaw.mockResolvedValue(noiseClassifierResponse);

  const stats = await runLeadIntake(MOCK_AGENT);

  expect(claude.callRaw).not.toHaveBeenCalled();
  expect(gmail.markRead).not.toHaveBeenCalled();
  expect(stats.candidates).toBe(0);
});

describe('processClassification branch-level: noise stays unread', () => {
  const { processClassification } = leadIntake._internal;

  const noiseMsg = {
    messageId: 'noise-1',
    threadId: 'thread-noise-1',
    from: 'promo@example.com',
    subject: 'Weekly newsletter',
    body: 'Check out this week deals',
  };

  const noiseClassification = {
    category: 'noise',
    confidence: 0.9,
    name: '',
    email: '',
    phone: '',
    inquiryMessage: '',
    propertyReference: '',
    reasoning: 'looks automated',
  };

  const bizMsg = {
    messageId: 'biz-1',
    threadId: 'thread-biz-1',
    from: 'lawyer@example.com',
    subject: 'Closing documents',
    body: 'Please find the closing documents attached',
  };

  const bizClassification = {
    category: 'business_correspondence',
    confidence: 0.8,
    name: '',
    email: '',
    phone: '',
    inquiryMessage: '',
    propertyReference: '',
    reasoning: 'from a professional',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    gmail.ensureLabels.mockResolvedValue(MOCK_LABEL_MAP);
    gmail.applyMessageLabels.mockResolvedValue(undefined);
  });

  // LOAD-BEARING: label applied AND markRead not called, asserted together
  // so this cannot pass by the branch simply not running.
  test('noise at confidence >= 0.85 gets the noise label applied but markRead is NOT called', async () => {
    const stats = { leads: 0, noise: 0, businessCorrespondence: 0, errors: 0 };
    await processClassification(MOCK_AGENT, noiseMsg, noiseClassification, [], stats);

    expect(gmail.applyMessageLabels).toHaveBeenCalledWith(MOCK_AGENT, 'noise-1', ['L_NOISE'], ['L_PROC']);
    expect(gmail.markRead).not.toHaveBeenCalled();
    expect(stats.noise).toBe(1);
    expect(agentState.incrementNoiseFiltered).toHaveBeenCalledWith(MOCK_AGENT.agentId);
  });

  test('noise branch increments the noise-filtered counter even when noiseId is absent from the label map', async () => {
    const labelMapNoNoise = new Map([
      [LABEL_PROCESSING, 'L_PROC'],
      [LABEL_INTAKEN, 'L_INTAKEN'],
      [LABEL_FIRST_TOUCH_PENDING, 'L_FTP'],
      [LABEL_BUSINESS, 'L_BIZ'],
    ]);
    gmail.ensureLabels.mockResolvedValue(labelMapNoNoise);

    const stats = { leads: 0, noise: 0, businessCorrespondence: 0, errors: 0 };
    await processClassification(MOCK_AGENT, noiseMsg, noiseClassification, [], stats);

    expect(gmail.applyMessageLabels).not.toHaveBeenCalled();
    expect(agentState.incrementNoiseFiltered).toHaveBeenCalledWith(MOCK_AGENT.agentId);
    expect(stats.noise).toBe(1);
  });

  test('business_correspondence applies the business label and removes processing, still does not mark read', async () => {
    const stats = { leads: 0, noise: 0, businessCorrespondence: 0, errors: 0 };
    await processClassification(MOCK_AGENT, bizMsg, bizClassification, [], stats);

    expect(gmail.markRead).not.toHaveBeenCalled();
    expect(gmail.applyMessageLabels).toHaveBeenCalledWith(MOCK_AGENT, 'biz-1', ['L_BIZ'], ['L_PROC']);
    expect(stats.businessCorrespondence).toBe(1);
  });
});

describe('ensureLabelsExist requests all five intake label names', () => {
  test('gmail.ensureLabels is called with the full five-label array', async () => {
    gmail.fetchUnreadInboxEmails.mockResolvedValue([]);
    email.readSheetRows.mockResolvedValue([]);

    await runLeadIntake(MOCK_AGENT);

    expect(gmail.ensureLabels).toHaveBeenCalledWith(MOCK_AGENT, [
      LABEL_PROCESSING,
      LABEL_INTAKEN,
      LABEL_NOISE,
      LABEL_FIRST_TOUCH_PENDING,
      LABEL_BUSINESS,
    ]);
  });
});

describe('loop-closed proof: business_correspondence is not re-classified across cycles', () => {
  // LOAD-BEARING: this is the test that pins the fix. Cycle 1 fetches an
  // unlabeled business_correspondence message; the business branch labels it
  // agent-ai/business. Cycle 2 simulates what real Gmail returns next: the
  // same message, still unread and in inbox, now carrying that label. If the
  // fix regresses (label not applied, or Rule 4 stops checking it), cycle 2
  // will call the classifier again and this test fails.
  const bizMsgUnlabeled = {
    messageId: 'biz-loop-1',
    threadId: 'thread-biz-loop-1',
    from: 'lawyer@example.com',
    subject: 'Closing documents',
    body: 'Please find the closing documents attached',
    inReplyTo: '',
    labelIds: [],
  };

  const bizClassifierResponse = JSON.stringify({
    category: 'business_correspondence',
    confidence: 0.8,
    name: '',
    email: '',
    phone: '',
    inquiryMessage: '',
    propertyReference: '',
    reasoning: 'from a professional',
  });

  test('cycle 1 classifies and labels; cycle 2 (message now carrying the business label) never reaches the classifier', async () => {
    email.readSheetRows.mockResolvedValue([]);
    claude.callRaw.mockResolvedValue(bizClassifierResponse);

    // Cycle 1: Gmail has not applied any intake label yet.
    gmail.fetchUnreadInboxEmails.mockResolvedValueOnce([bizMsgUnlabeled]);
    const stats1 = await runLeadIntake(MOCK_AGENT);

    expect(stats1.candidates).toBe(1);
    expect(stats1.businessCorrespondence).toBe(1);
    expect(gmail.applyMessageLabels).toHaveBeenCalledWith(MOCK_AGENT, 'biz-loop-1', ['L_BIZ'], ['L_PROC']);

    // Cycle 2: real Gmail now returns the message carrying L_BIZ, since
    // cycle 1's applyMessageLabels call added it. Message is still unread
    // and in inbox, so it still matches the fetch query.
    const bizMsgLabeled = Object.assign({}, bizMsgUnlabeled, { labelIds: ['L_BIZ'] });
    gmail.fetchUnreadInboxEmails.mockResolvedValueOnce([bizMsgLabeled]);
    const stats2 = await runLeadIntake(MOCK_AGENT);

    expect(stats2.candidates).toBe(0);
    expect(claude.callRaw).toHaveBeenCalledTimes(1);
  });
});
