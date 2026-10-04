'use strict';

const { sendWelcomeText } = require('../src/welcomeText');

const AGENT = { agentId: 'agent-1', agentName: 'Sam Agent', operatorId: 'op-1', agentPhone: '+14165550188' };

test('success: sendSMS called once with the welcome template, alert not called', async () => {
  const sendSMS = jest.fn().mockResolvedValue(undefined);
  const alertAgentTextFailed = jest.fn().mockResolvedValue({ sent: true });

  await sendWelcomeText(AGENT, { sendSMS, alertAgentTextFailed });

  expect(sendSMS).toHaveBeenCalledTimes(1);
  const [calledAgent, smsBody] = sendSMS.mock.calls[0];
  expect(calledAgent).toBe(AGENT);
  expect(smsBody).toBe(
    "GetKlosed here. This is the number your morning brief and hot-lead alerts will come from. Save it as a contact so you never miss one."
  );
  expect(alertAgentTextFailed).not.toHaveBeenCalled();
});

test('failure: sendSMS rejects, alertAgentTextFailed called once with kind welcome', async () => {
  const smsError = new Error("The 'To' number is not a valid phone number.");
  const sendSMS = jest.fn().mockRejectedValue(smsError);
  const alertAgentTextFailed = jest.fn().mockResolvedValue({ sent: true });

  await sendWelcomeText(AGENT, { sendSMS, alertAgentTextFailed });

  expect(alertAgentTextFailed).toHaveBeenCalledTimes(1);
  const [calledAgent, payload] = alertAgentTextFailed.mock.calls[0];
  expect(calledAgent).toBe(AGENT);
  expect(payload.kind).toBe('welcome');
  expect(payload.error).toBe(smsError);
  expect(typeof payload.smsBody).toBe('string');
});

test('never rejects, even when alertAgentTextFailed itself rejects', async () => {
  const sendSMS = jest.fn().mockRejectedValue(new Error('send failed'));
  const alertAgentTextFailed = jest.fn().mockRejectedValue(new Error('alert boom'));

  await expect(sendWelcomeText(AGENT, { sendSMS, alertAgentTextFailed })).resolves.toBeUndefined();
});

test('never rejects on success either', async () => {
  const sendSMS = jest.fn().mockResolvedValue(undefined);
  const alertAgentTextFailed = jest.fn();

  await expect(sendWelcomeText(AGENT, { sendSMS, alertAgentTextFailed })).resolves.toBeUndefined();
});
