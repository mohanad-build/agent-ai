// src/twilio.js
// SMS sending via Twilio. Used by the orchestrator for agent-facing alerts
// (hot leads, Path 1B questions, reminders, urgent review flags).
//
// Outbound only. Inbound webhook handling for Path 1B agent replies lives in
// a separate module (Agent SMS Reply Handler), built later, after index.js.
//
// Conventions:
//   - One retry with 3s backoff on transient errors, matching claude.js / gmail.js.
//   - Permanent errors (401 auth, 400 bad number, 21xxx Twilio validation codes)
//     are NOT retried, they throw immediately, so the orchestrator can decide.
//   - Templates live at the top of this file rather than a separate module
//     because they are short strings; will split if they grow.

const twilio = require('twilio');

// ---------------------------------------------------------------------------
// 1. TEMPLATES: message factories. Pure functions, no side effects.
// ---------------------------------------------------------------------------

// Cap a string to N chars with an ellipsis. Used to keep SMS within 1-2 segments.
function truncate(str, max) {
  if (!str) return '';
  const s = String(str).trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

const TEMPLATES = {
  // Path 2: hot signal alert. Emoji forces UCS-2 (70 chars/segment), accepted
  // because the visual urgency is the point.
  hotLeadAlert({ leadName, snippet, leadEmail }) {
    return `🔥 HOT LEAD: ${leadName} just said: "${truncate(snippet, 100)}"\nReply to ${leadEmail} ASAP.`;
  },

  // Path 1B: ask agent for the property-specific answer.
  path1BAgentQuery({ leadName, question }) {
    return `${leadName} just asked: "${truncate(question, 120)}"\nReply to this text with the answer and we'll send a polished email back.`;
  },

  // Path 1B: 2-hour reminder if the agent hasn't replied to the SMS above.
  path1BReminder({ leadName }) {
    return `Reminder: ${leadName} is still waiting on an answer. Reply to the previous text and we'll send the email.`;
  },

  // Path 4: optional urgent SMS when needs_review reply contains a high-priority keyword.
  urgentNeedsReview({ keyword, leadName }) {
    return `⚠️ ${leadName}'s reply mentions "${keyword}". Needs your eyes, check email for full context.`;
  },

  // Path 1B initiation: notify the agent that a lead asked a property-specific question.
  // Positional args so call sites read naturally without destructuring.
  leadPropertyQuestion(leadName, leadEmail, question, token) {
    return `[${token}] ${leadName} (${leadEmail}): "${question}"\n\nReply: ${token} <your answer>`;
  },
};

// ---------------------------------------------------------------------------
// 2. Twilio client + send functions
// ---------------------------------------------------------------------------

// Build the client lazily on first use so missing env vars surface as a clear
// error at send time rather than at module load time (avoids breaking unrelated
// tests that don't touch SMS).
let _client = null;
function getClient() {
  if (_client) return _client;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error(
      'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set in environment'
    );
  }
  _client = twilio(sid, token);
  return _client;
}

// Twilio error categorization. Returns true if the error is worth retrying.
// Permanent errors: 401 (auth), 400 (bad request), 404 (not found), and the
// 21xxx range of Twilio validation codes (invalid number, unverified-trial-recipient, etc.).
function isTransientTwilioError(err) {
  if (!err) return false;
  const status = err.status;
  if (status === 401 || status === 400 || status === 404) return false;
  if (typeof err.code === 'number' && err.code >= 21000 && err.code < 22000) return false;
  // Network errors usually have no .status, treat as transient.
  if (!status) return true;
  // 429 (rate limit) and 5xx (server) are transient.
  if (status === 429 || (status >= 500 && status < 600)) return true;
  // Anything else: don't retry, surface the error.
  return false;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Poll Twilio for the message's actual status. Trial accounts and Canadian
// carriers can reject AFTER the API returns success. Up to 3 attempts, 1s apart.
// Returns the final message object on success. Throws if status is 'failed'
// or 'undelivered', with errorCode included in the error message for diagnostics.
async function verifyDelivery(client, sid) {
  const TERMINAL_FAILURE_STATUSES = new Set(['failed', 'undelivered']);
  const TERMINAL_OK_STATUSES = new Set(['sent', 'delivered']);
  const POLL_ATTEMPTS = 3;
  const POLL_INTERVAL_MS = 1000;

  let message;
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    message = await client.messages(sid).fetch();
    if (TERMINAL_FAILURE_STATUSES.has(message.status)) {
      const errCode = message.errorCode ? ' (errorCode ' + message.errorCode + ')' : '';
      throw new Error(
        'SMS delivery failed: status=' + message.status + errCode + '. ' +
        'sid=' + sid + '. errorMessage=' + (message.errorMessage || 'none')
      );
    }
    if (TERMINAL_OK_STATUSES.has(message.status)) {
      return message;
    }
    // Status is queued/sending/accepted, wait and retry.
    if (i < POLL_ATTEMPTS - 1) {
      await sleep(POLL_INTERVAL_MS);
    }
  }
  // After all polls, status is still in-flight (queued/sending). Treat as success
  // for now, most messages ultimately deliver, and we don't want to block forever.
  // Caller can check the returned status if they want stricter behavior.
  return message;
}

async function withRetry(operation) {
  try {
    return await operation();
  } catch (err) {
    if (!isTransientTwilioError(err)) throw err;
    await sleep(3000);
    return await operation();
  }
}

// sendSMS: sends to the agent's own phone (agentConfig.agentPhone).
// Returns { sid } on success. Throws on permanent error or after one retry.
async function sendSMS(agentConfig, message) {
  if (!agentConfig || !agentConfig.agentPhone) {
    throw new Error('agentConfig.agentPhone is required');
  }
  if (!message || typeof message !== 'string') {
    throw new Error('message must be a non-empty string');
  }
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!from) {
    throw new Error('TWILIO_FROM_NUMBER must be set in environment');
  }

  const client = getClient();
  const result = await withRetry(() =>
    client.messages.create({
      to: agentConfig.agentPhone,
      from,
      body: message,
    })
  );
  await verifyDelivery(client, result.sid);
  return { sid: result.sid };
}

// sendSMSTo: same as sendSMS but to an arbitrary number. Used when the
// recipient isn't the agent themselves (brokerage compliance, future use).
async function sendSMSTo(toNumber, message) {
  if (!toNumber || typeof toNumber !== 'string') {
    throw new Error('toNumber must be a non-empty string in E.164 format');
  }
  if (!message || typeof message !== 'string') {
    throw new Error('message must be a non-empty string');
  }
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!from) {
    throw new Error('TWILIO_FROM_NUMBER must be set in environment');
  }

  const client = getClient();
  const result = await withRetry(() =>
    client.messages.create({
      to: toNumber,
      from,
      body: message,
    })
  );
  await verifyDelivery(client, result.sid);
  return { sid: result.sid };
}

// ---------------------------------------------------------------------------
// 3. Exports
// ---------------------------------------------------------------------------

module.exports = {
  sendSMS,
  sendSMSTo,
  TEMPLATES,
  _internal: {
    truncate,
    isTransientTwilioError,
    verifyDelivery,
  },
};
