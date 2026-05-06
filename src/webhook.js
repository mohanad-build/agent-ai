// src/webhook.js
//
// Express webhook server for inbound Twilio SMS.
// Handles signature verification, idempotency, agent lookup, token parsing,
// and the full Path 1B reply flow (draft + send + Sheet update).

const express = require('express');
const twilio = require('twilio');
const { findAgentByPhone } = require('./agentConfig');
const claude = require('./claude');
const emailModule = require('./email');
const twilioModule = require('./twilio');
const prompts = require('./prompts');
const {
  parsePendingQuestions,
  serializePendingQuestions,
  findEntryByToken,
  removeEntryByToken,
} = require('./pendingQuestions');
const { buildShadowDraftWrapper } = require('./paths');

const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

// In-memory idempotency store: Map<MessageSid, timestamp>
const processedSids = new Map();

// Purge entries older than TTL every 60 seconds.
setInterval(() => {
  const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;
  for (const [sid, ts] of processedSids) {
    if (ts < cutoff) processedSids.delete(sid);
  }
}, 60 * 1000).unref();

// Returns true if the host is safe to allow signature bypass.
function isLocalOrDev(host) {
  if (!host) return false;
  const h = host.toLowerCase();
  return h === 'localhost' ||
    h.startsWith('localhost:') ||
    h === '127.0.0.1' ||
    h.startsWith('127.0.0.1:') ||
    h.includes('ngrok');
}

// Parses the SMS body for [Qn] tokens. Liberal match: Q followed by optional
// whitespace/dash then digits, case-insensitive.
// Returns { type: 'none'|'single'|'multi', token: string|null }
function parseToken(body) {
  if (!body || typeof body !== 'string') return { type: 'none', token: null };
  const matches = [...body.matchAll(/Q\s*-?\s*(\d+)/gi)];
  if (matches.length === 0) return { type: 'none', token: null };
  if (matches.length === 1) return { type: 'single', token: 'Q' + matches[0][1] };
  return { type: 'multi', token: null };
}

// Strips the leading token reference from the agent's SMS body to extract
// the actual answer. Handles "Q47 answer", "[Q47] answer", "Q47answer".
function extractAgentAnswer(body, token) {
  if (!body || !token) return (body || '').trim();
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body.replace(new RegExp('^\\s*\\[?' + escaped + '\\]?\\s*', 'i'), '').trim() || body.trim();
}

// Strips leading Re:/Fwd:/Fw: prefixes (repeated) and prepends 'Re: '.
function normalizeReplySubject(raw) {
  let s = String(raw || '').trim();
  while (/^(re|fwd?|fw)\s*:\s*/i.test(s)) {
    s = s.replace(/^(re|fwd?|fw)\s*:\s*/i, '').trim();
  }
  return 'Re: ' + s;
}

// Sends the agent a list of their currently open questions via SMS.
// Used when the incoming message has no token, multiple tokens, or an
// unrecognized token (PATH BETA / PATH GAMMA).
// Never throws.
async function sendOpenQuestionsSuggestion(agent, body, reason, badToken) {
  try {
    const rows = await emailModule.readSheetRows(agent);
    const openItems = [];
    for (const row of rows) {
      const entries = parsePendingQuestions(row.pendingQuestion);
      for (const entry of entries) {
        openItems.push({
          token: entry.token,
          leadName: row.name || row.leadId,
          question: entry.question,
        });
      }
    }

    let smsBody;
    if (openItems.length === 0) {
      smsBody = reason === 'bad_token'
        ? 'Token ' + badToken + ' not found. No open questions at the moment.'
        : 'No open questions at the moment.';
    } else {
      const list = openItems
        .map((item) => item.token + ' (' + item.leadName + '): "' + item.question + '"')
        .join('\n');
      smsBody = reason === 'bad_token'
        ? 'Token ' + badToken + ' not found. Open questions:\n' + list
        : 'Open questions:\n' + list;
    }

    await twilioModule.sendSMS(agent, smsBody);
    console.log('webhook: sendOpenQuestionsSuggestion sent to agent ' + agent.agentId + ', reason=' + reason);
  } catch (err) {
    console.error('webhook: sendOpenQuestionsSuggestion failed for agent ' + agent.agentId + ': ' + err.message);
  }
}

// Core handler for an inbound agent SMS reply. Runs after HTTP 200 is sent.
// Never throws: all errors are caught and logged.
async function handleAgentReply(agent, body, messageSid, tokenType, token) {
  // PATH GAMMA: no token or multiple tokens.
  if (tokenType === 'none' || tokenType === 'multi') {
    const reason = tokenType === 'multi' ? 'multi_token' : 'no_token';
    await sendOpenQuestionsSuggestion(agent, body, reason, null);
    return;
  }

  // tokenType === 'single': read Sheet to find the row containing this token.
  let rows;
  try {
    rows = await emailModule.readSheetRows(agent);
  } catch (err) {
    console.error('webhook: readSheetRows failed for agent ' + agent.agentId + ': ' + err.message);
    return;
  }

  let matchedRow = null;
  let matchedEntry = null;

  for (const row of rows) {
    const entries = parsePendingQuestions(row.pendingQuestion);
    const entry = findEntryByToken(entries, token);
    if (entry) {
      matchedRow = row;
      matchedEntry = entry;
      break;
    }
  }

  // PATH BETA: token not found in any row's queue.
  if (!matchedRow) {
    console.log('webhook: token ' + token + ' not found in any row for agent ' + agent.agentId);
    await sendOpenQuestionsSuggestion(agent, body, 'bad_token', token);
    return;
  }

  // PATH ALPHA: token found. Build and send the reply email.
  const agentAnswer = extractAgentAnswer(body, token);
  const leadQuestion = matchedEntry.question;
  const leadEmail = matchedRow.leadId;
  const prefix = '[webhook] agent=' + agent.agentId + ' token=' + token + ':';

  let hasGmailSignature;
  try {
    hasGmailSignature = await emailModule.getSignaturePresence(agent);
  } catch (err) {
    console.warn(prefix + ' getSignaturePresence failed, defaulting false: ' + err.message);
    hasGmailSignature = false;
  }

  const leadContext = {
    name: matchedRow.name || '',
    originalInquiry: matchedRow.originalMessage || '',
  };

  const prompt = prompts.buildPath1BDraftPrompt(
    agent,
    leadQuestion,
    agentAnswer,
    leadContext,
    hasGmailSignature
  );

  let draftBody;
  try {
    const result = await claude.draft(prompt, prompts.getMergedBannedPhrases(agent));
    if (result.escalate) {
      console.error(prefix + ' draft escalated after ' + result.attempts + ' attempt(s): violations=[' + result.violations.join(', ') + ']. Sending fallback SMS to agent.');
      try {
        await twilioModule.sendSMS(
          agent,
          'Could not draft email for ' + token + '. Please email ' + leadEmail + ' directly. The question stays open in your queue.'
        );
      } catch (smsErr) {
        console.error(prefix + ' fallback SMS failed: ' + smsErr.message);
      }
      return;
    }
    console.log(prefix + ' Claude draft ready (' + result.attempts + ' attempt(s))');
    draftBody = result.text;
  } catch (err) {
    console.error(prefix + ' claude.draft failed: ' + err.message);
    return;
  }

  if (agent.mode === 'shadow') {
    const wrapper = buildShadowDraftWrapper(leadEmail, draftBody);
    try {
      await emailModule.sendNewEmail(agent, {
        to: agent.gmailAddress,
        subject: wrapper.subject,
        body: wrapper.body,
      });
      console.log(prefix + ' shadow draft sent to agent (' + agent.gmailAddress + ')');
    } catch (err) {
      console.error(prefix + ' sendNewEmail (shadow) failed: ' + err.message);
      return;
    }
  } else {
    let subject = 'Re: Your question';
    try {
      const messages = await emailModule.getThreadHistory(agent, matchedRow.gmailThreadId);
      if (messages && messages.length > 0 && messages[0].subject) {
        subject = normalizeReplySubject(messages[0].subject);
      }
    } catch (err) {
      console.warn(prefix + ' getThreadHistory failed, using fallback subject: ' + err.message);
    }

    try {
      await emailModule.sendReply(agent, {
        to: leadEmail,
        subject,
        body: draftBody,
        threadId: matchedRow.gmailThreadId,
      });
      console.log(prefix + ' live reply sent to ' + leadEmail);
    } catch (err) {
      console.error(prefix + ' sendReply failed: ' + err.message);
      return;
    }
  }

  // Re-read the row defensively in case the queue changed during the draft.
  let existingEntries;
  try {
    const freshRows = await emailModule.readSheetRows(agent);
    const freshRow = freshRows.find((r) => r.rowIndex === matchedRow.rowIndex);
    existingEntries = parsePendingQuestions(freshRow ? freshRow.pendingQuestion : matchedRow.pendingQuestion);
  } catch (err) {
    console.warn(prefix + ' re-read of row failed, using stale snapshot: ' + err.message);
    existingEntries = parsePendingQuestions(matchedRow.pendingQuestion);
  }
  const remainingEntries = removeEntryByToken(existingEntries, token);
  const updatedQueue = serializePendingQuestions(remainingEntries);

  const newStatus = remainingEntries.length === 0 ? 'warm' : 'awaiting_agent';

  try {
    await emailModule.updateSheetRow(agent, matchedRow.rowIndex, {
      pendingQuestion: updatedQueue,
      status: newStatus,
      lastActionTimestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error(prefix + ' updateSheetRow failed: ' + err.message);
  }

  try {
    const snippet = agentAnswer.slice(0, 60);
    await emailModule.appendToConversationHistory(
      agent,
      matchedRow.rowIndex,
      'Path 1B reply sent for ' + token + ': ' + snippet
    );
  } catch (err) {
    console.error(prefix + ' appendToConversationHistory failed: ' + err.message);
  }
}

function createApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  app.post('/sms-incoming', (req, res) => {
    const host = req.get('host') || '';
    const signature = req.get('X-Twilio-Signature') || '';
    const url = req.protocol + '://' + req.get('host') + req.originalUrl;
    const params = req.body;

    // Signature verification (bypassable for localhost/ngrok in dev only).
    const skipVerification =
      process.env.WEBHOOK_SKIP_SIGNATURE_CHECK === 'true' && isLocalOrDev(host);

    if (!skipVerification) {
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const valid = twilio.validateRequest(authToken, signature, url, params);
      if (!valid) {
        res.status(403).send('Forbidden');
        return;
      }
    }

    // Idempotency check.
    const messageSid = params.MessageSid;
    if (messageSid) {
      const seen = processedSids.get(messageSid);
      if (seen && Date.now() - seen < IDEMPOTENCY_TTL_MS) {
        res.type('text/xml').status(200).send(EMPTY_TWIML);
        return;
      }
    }

    // Agent lookup.
    const from = params.From;
    const agent = findAgentByPhone(from);
    if (!agent) {
      console.warn('webhook: unknown agent phone ' + from + ', ignoring');
      res.type('text/xml').status(200).send(EMPTY_TWIML);
      return;
    }

    // Mark as processed before dispatching so a crash mid-handler does not
    // allow the same message to be re-processed on retry.
    if (messageSid) {
      processedSids.set(messageSid, Date.now());
    }

    // Token parsing.
    const body = params.Body || '';
    const { type, token } = parseToken(body);

    const tokenDisplay = type === 'single' ? token : 'null';
    const bodyPreview = body.slice(0, 60);
    console.log(
      'webhook: agent=' + agent.agentId +
      ' messageSid=' + messageSid +
      ' token=' + tokenDisplay +
      ' bodyPreview=' + bodyPreview
    );

    // Respond immediately, then process asynchronously.
    res.type('text/xml').status(200).send(EMPTY_TWIML);

    setImmediate(() => {
      handleAgentReply(agent, body, messageSid, type, token).catch((err) => {
        console.error(
          'webhook: unhandled error in handleAgentReply for agent ' + agent.agentId + ': ' + err.message
        );
      });
    });
  });

  return app;
}

if (require.main === module) {
  const port = process.env.WEBHOOK_PORT || 3000;

  if (process.env.WEBHOOK_SKIP_SIGNATURE_CHECK === 'true') {
    console.log(
      'WARNING: signature verification bypass enabled. DEV MODE ONLY. Do not run this way in production.'
    );
  }

  const app = createApp();
  app.listen(port, () => {
    console.log('webhook: listening on port ' + port);
  });
}

module.exports = { createApp, handleAgentReply, sendOpenQuestionsSuggestion };
