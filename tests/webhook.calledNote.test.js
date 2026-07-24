'use strict';

jest.mock('twilio', () => ({ validateRequest: jest.fn() }));
jest.mock('../src/agentConfig', () => ({ findAgentByPhone: jest.fn().mockReturnValue(null) }));
jest.mock('../src/email', () => ({
  readSheetRows: jest.fn(),
  updateSheetRow: jest.fn(),
  appendToConversationHistory: jest.fn(),
}));
jest.mock('../src/twilio', () => ({ sendSMS: jest.fn(), TEMPLATES: {} }));

const email = require('../src/email');
const twilioSrc = require('../src/twilio');
const { handleCalledCommand } = require('../src/webhook');

describe('handleCalledCommand note capture', () => {
  function baseAgent() {
    return {
      agentId: 'agent-1',
      agentPhone: '+15551234567',
      gmailAddress: 'agent@example.com',
    };
  }

  function makeRow(overrides = {}) {
    return {
      rowIndex: 7,
      name: 'Jane Doe',
      leadId: 'jane@example.com',
      pendingQuestion: '[Q1] What is the price?',
      status: 'awaiting_agent',
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    email.updateSheetRow.mockResolvedValue({});
    email.appendToConversationHistory.mockResolvedValue({});
    twilioSrc.sendSMS.mockResolvedValue({ sid: 'SM1' });
  });

  it('CALLED with no note: one column L append, confirmation unchanged, no "Note saved."', async () => {
    const agent = baseAgent();
    const row = makeRow();
    email.readSheetRows.mockResolvedValue([row]);

    await handleCalledCommand(agent, 'CALLED Q1');

    expect(email.appendToConversationHistory).toHaveBeenCalledTimes(1);
    expect(email.appendToConversationHistory).toHaveBeenCalledWith(
      agent,
      row.rowIndex,
      'Agent called lead, status set to manual_handling via SMS command'
    );
    expect(twilioSrc.sendSMS).toHaveBeenCalledWith(
      agent,
      'Jane Doe (jane@example.com) set to manual_handling.'
    );
  });

  it('CALLED with a note: second column L entry, confirmation ends with "Note saved."', async () => {
    const agent = baseAgent();
    const row = makeRow();
    email.readSheetRows.mockResolvedValue([row]);

    await handleCalledCommand(agent, 'CALLED Q1 talked to him, following up Monday');

    expect(email.appendToConversationHistory).toHaveBeenCalledTimes(2);
    expect(email.appendToConversationHistory).toHaveBeenNthCalledWith(
      1,
      agent,
      row.rowIndex,
      'Agent called lead, status set to manual_handling via SMS command'
    );
    expect(email.appendToConversationHistory).toHaveBeenNthCalledWith(
      2,
      agent,
      row.rowIndex,
      'Agent note from call: talked to him, following up Monday'
    );
    expect(twilioSrc.sendSMS).toHaveBeenCalledWith(
      agent,
      'Jane Doe (jane@example.com) set to manual_handling. Note saved.'
    );
  });

  it('a note containing newlines and tabs is flattened to single spaces', async () => {
    const agent = baseAgent();
    const row = makeRow();
    email.readSheetRows.mockResolvedValue([row]);

    await handleCalledCommand(agent, 'CALLED Q1 line1\nline2\tline3');

    expect(email.appendToConversationHistory).toHaveBeenNthCalledWith(
      2,
      agent,
      row.rowIndex,
      'Agent note from call: line1 line2 line3'
    );
  });

  it('a 600-character note is truncated to 500 plus the ellipsis character', async () => {
    const agent = baseAgent();
    const row = makeRow();
    email.readSheetRows.mockResolvedValue([row]);
    const longNote = 'a'.repeat(600);

    await handleCalledCommand(agent, 'CALLED Q1 ' + longNote);

    const written = email.appendToConversationHistory.mock.calls[1][2];
    expect(written).toBe('Agent note from call: ' + 'a'.repeat(500) + '…');
  });

  it('a 500-character note is NOT truncated and carries no ellipsis', async () => {
    const agent = baseAgent();
    const row = makeRow();
    email.readSheetRows.mockResolvedValue([row]);
    const note500 = 'b'.repeat(500);

    await handleCalledCommand(agent, 'CALLED Q1 ' + note500);

    const written = email.appendToConversationHistory.mock.calls[1][2];
    expect(written).toBe('Agent note from call: ' + note500);
  });

  it('a note of only whitespace is treated as absent: no second append, no "Note saved."', async () => {
    const agent = baseAgent();
    const row = makeRow();
    email.readSheetRows.mockResolvedValue([row]);

    await handleCalledCommand(agent, 'CALLED Q1    \t  ');

    expect(email.appendToConversationHistory).toHaveBeenCalledTimes(1);
    expect(twilioSrc.sendSMS).toHaveBeenCalledWith(
      agent,
      'Jane Doe (jane@example.com) set to manual_handling.'
    );
  });

  it('token still resolves correctly with a trailing note - Q-token form', async () => {
    const agent = baseAgent();
    const row = makeRow({ pendingQuestion: '[Q1] price?' });
    email.readSheetRows.mockResolvedValue([row]);

    await handleCalledCommand(agent, 'CALLED Q1 left a voicemail');

    expect(email.updateSheetRow).toHaveBeenCalledWith(
      agent,
      row.rowIndex,
      expect.objectContaining({ status: 'manual_handling' })
    );
  });

  it('token still resolves correctly with a trailing note - email form', async () => {
    const agent = baseAgent();
    const row = makeRow({ leadId: 'jane@example.com', pendingQuestion: '' });
    email.readSheetRows.mockResolvedValue([row]);

    await handleCalledCommand(agent, 'CALLED jane@example.com left a voicemail');

    expect(email.updateSheetRow).toHaveBeenCalledWith(
      agent,
      row.rowIndex,
      expect.objectContaining({ status: 'manual_handling' })
    );
  });

  it('a throwing second append does not prevent the confirmation SMS', async () => {
    const agent = baseAgent();
    const row = makeRow();
    email.readSheetRows.mockResolvedValue([row]);
    email.appendToConversationHistory
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('sheets down'));

    await expect(
      handleCalledCommand(agent, 'CALLED Q1 left a voicemail')
    ).resolves.toBeUndefined();

    expect(twilioSrc.sendSMS).toHaveBeenCalledWith(
      agent,
      'Jane Doe (jane@example.com) set to manual_handling. Note saved.'
    );
  });
});
