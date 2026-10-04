// src/welcomeText.js
//
// Sends the welcome text (decision 4, docs/designs/agent-phone.md). Started
// without awaiting by both callers (onboarding's OAuth callback, the
// dashboard phone edit): a Twilio send can take several seconds, sometimes
// over ten, and neither caller's response should wait on it. Never rejects,
// the whole body is wrapped, so an un-awaited call can never become an
// unhandled rejection.

const twilio = require('./twilio');
const { alertAgentTextFailed } = require('./textFailureAlert');

async function sendWelcomeText(agentConfig, deps = {}) {
  const sendSMS = deps.sendSMS || twilio.sendSMS;
  const doAlertAgentTextFailed = deps.alertAgentTextFailed || alertAgentTextFailed;

  const agentId = agentConfig.agentId;
  const smsBody = twilio.TEMPLATES.welcomeText();

  try {
    await sendSMS(agentConfig, smsBody);
  } catch (err) {
    // Twilio's own error message can embed the phone number (e.g. error
    // 21211's text), so only the code is logged here, never err.message.
    console.error(`[${agentId}] welcome text failed: code=${err && err.code != null ? err.code : 'n/a'}`);
    try {
      await doAlertAgentTextFailed(agentConfig, { kind: 'welcome', smsBody, error: err });
    } catch (alertErr) {
      console.error(`[${agentId}] welcome text alert failed: ${alertErr.message}`);
    }
  }
}

module.exports = { sendWelcomeText };
