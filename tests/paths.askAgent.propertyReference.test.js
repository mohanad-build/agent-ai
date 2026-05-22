'use strict';

jest.mock('../src/email', () => ({
  updateSheetRow: jest.fn().mockResolvedValue(undefined),
  appendToConversationHistory: jest.fn().mockResolvedValue(undefined),
  sendNewEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/claude', () => ({
  callRaw: jest.fn().mockResolvedValue('456 Elm St'),
}));

// Keep real TEMPLATES so leadPropertyQuestion runs its actual logic; only mock sendSMS.
jest.mock('../src/twilio', () => {
  const real = jest.requireActual('../src/twilio');
  return { ...real, sendSMS: jest.fn().mockResolvedValue(undefined) };
});

jest.mock('../src/agentState', () => ({
  issueToken: jest.fn().mockReturnValue('Q99'),
}));

jest.mock('../src/time', () => ({
  getNowIso: jest.fn().mockReturnValue('2026-05-21T00:00:00.000Z'),
}));

const { pathAskAgent } = require('../src/paths');
const twilio = require('../src/twilio');

const agent = {
  agentId: 'agent-1',
  gmailAddress: 'agent@example.com',
  escalationEmail: 'agent@example.com',
  agentPhone: '+15550001111',
};

const row = {
  rowIndex: 2,
  leadId: 'lead@example.com',
  name: 'Sarah Chen',
  status: 'new',
  phone: '+15550002222',
  originalMessage: 'I am interested in 456 Elm St',
  conversationHistory: 'Lead asked about 456 Elm St',
  pendingQuestion: '',
};

const msg = { snippet: 'Is 456 Elm St still available?' };

beforeEach(() => {
  jest.clearAllMocks();
  // Re-apply default resolved values after clearAllMocks.
  require('../src/email').updateSheetRow.mockResolvedValue(undefined);
  require('../src/email').appendToConversationHistory.mockResolvedValue(undefined);
  require('../src/email').sendNewEmail.mockResolvedValue(undefined);
  require('../src/claude').callRaw.mockResolvedValue('456 Elm St');
  twilio.sendSMS.mockResolvedValue(undefined);
  require('../src/agentState').issueToken.mockReturnValue('Q99');
  require('../src/time').getNowIso.mockReturnValue('2026-05-21T00:00:00.000Z');
});

describe('pathAskAgent propertyReference integration', () => {
  test('propertyReference extracted from claude flows into the SMS body', async () => {
    const result = await pathAskAgent(agent, row, msg, 'answer_property_specific');
    expect(result.ok).toBe(true);
    expect(twilio.sendSMS).toHaveBeenCalledTimes(1);
    const smsBody = twilio.sendSMS.mock.calls[0][1];
    expect(smsBody).toContain('about 456 Elm St');
  });

  test('unclear extraction does not add about clause to SMS body', async () => {
    require('../src/claude').callRaw.mockResolvedValue('unclear');
    const result = await pathAskAgent(agent, row, msg, 'answer_property_specific');
    expect(result.ok).toBe(true);
    const smsBody = twilio.sendSMS.mock.calls[0][1];
    expect(smsBody).not.toContain('about');
  });

  test('extraction failure is non-fatal; SMS still sends without about clause', async () => {
    require('../src/claude').callRaw.mockRejectedValue(new Error('API timeout'));
    const result = await pathAskAgent(agent, row, msg, 'answer_property_specific');
    expect(result.ok).toBe(true);
    expect(twilio.sendSMS).toHaveBeenCalledTimes(1);
    const smsBody = twilio.sendSMS.mock.calls[0][1];
    expect(smsBody).not.toContain('about');
    expect(result.actions.propertyExtraction).toBe('failed');
  });
});
