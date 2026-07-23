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

const gmail = require('../src/gmail');
const email = require('../src/email');
const claude = require('../src/claude');

const leadIntake = require('../src/leadIntake');
const { runLeadIntake } = leadIntake;
const {
  LABEL_PROCESSING,
  LABEL_INTAKEN,
  LABEL_NOISE,
  LABEL_FIRST_TOUCH_PENDING,
} = leadIntake._internal;

const MOCK_LABEL_MAP = new Map([
  [LABEL_PROCESSING, 'L_PROC'],
  [LABEL_INTAKEN, 'L_INTAKEN'],
  [LABEL_NOISE, 'L_NOISE'],
  [LABEL_FIRST_TOUCH_PENDING, 'L_FTP'],
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
  });

  test('business_correspondence still does not mark read (unchanged behavior)', async () => {
    const stats = { leads: 0, noise: 0, businessCorrespondence: 0, errors: 0 };
    await processClassification(MOCK_AGENT, bizMsg, bizClassification, [], stats);

    expect(gmail.markRead).not.toHaveBeenCalled();
    expect(gmail.applyMessageLabels).toHaveBeenCalledWith(MOCK_AGENT, 'biz-1', [], ['L_PROC']);
    expect(stats.businessCorrespondence).toBe(1);
  });
});
