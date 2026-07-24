// src/webhook.js
//
// Express webhook server for inbound Twilio SMS.
// Handles signature verification, idempotency, agent lookup, token parsing,
// and the full Path 1B reply flow (draft + send + Sheet update).

require('dotenv').config();

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

// Parses a CALLED/RESUME command token from the part after the keyword.
// The token may be a lead email address or a Q-token (e.g. "Q47").
// Returns { type: 'email'|'qtoken', value } or null if unrecognizable.
function parseCommandToken(tokenStr) {
  if (!tokenStr) return null;
  const s = tokenStr.trim();
  if (s.includes('@')) return { type: 'email', value: s.toLowerCase() };
  const qMatch = s.match(/Q\s*-?\s*(\d+)/i);
  if (qMatch) return { type: 'qtoken', value: 'Q' + qMatch[1] };
  return null;
}

// Looks up a sheet row by a command token (email or Q-token).
// Returns the matched row, or null if not found.
async function lookupRowByCommandToken(agent, parsed) {
  const rows = await emailModule.readSheetRows(agent);
  if (parsed.type === 'email') {
    return rows.find((r) => String(r.leadId || '').trim().toLowerCase() === parsed.value) || null;
  }
  for (const row of rows) {
    const entries = parsePendingQuestions(row.pendingQuestion);
    const entry = findEntryByToken(entries, parsed.value);
    if (entry) return row;
  }
  return null;
}

// Handles "CALLED <token>" from the agent. Sets the lead to manual_handling.
// Never throws.
async function handleCalledCommand(agent, body) {
  const match = body.match(/^CALLED\s+(\S+)(?:\s+([\s\S]*))?$/i);
  if (!match) {
    await twilioModule.sendSMS(agent, 'Format: CALLED <Q-token or lead email>').catch(() => {});
    return;
  }
  const parsed = parseCommandToken(match[1]);
  if (!parsed) {
    await twilioModule.sendSMS(agent, 'Could not parse token: ' + match[1]).catch(() => {});
    return;
  }

  const note = sanitiseNote(match[2]);

  let matchedRow;
  try {
    matchedRow = await lookupRowByCommandToken(agent, parsed);
  } catch (err) {
    console.error('webhook: handleCalledCommand readSheetRows failed for agent ' + agent.agentId + ': ' + err.message);
    return;
  }

  if (!matchedRow) {
    await twilioModule.sendSMS(agent, 'Lead not found for: ' + match[1]).catch(() => {});
    return;
  }

  const nowIso = new Date().toISOString();
  try {
    await emailModule.updateSheetRow(agent, matchedRow.rowIndex, {
      status: 'manual_handling',
      lastActionTimestamp: nowIso,
    });
  } catch (err) {
    console.error('webhook: handleCalledCommand updateSheetRow failed: ' + err.message);
    return;
  }

  try {
    await emailModule.appendToConversationHistory(
      agent,
      matchedRow.rowIndex,
      'Agent called lead, status set to manual_handling via SMS command'
    );
  } catch (err) {
    console.warn('webhook: handleCalledCommand appendToConversationHistory failed: ' + err.message);
  }

  if (note) {
    try {
      await emailModule.appendToConversationHistory(
        agent,
        matchedRow.rowIndex,
        'Agent note from call: ' + note
      );
    } catch (err) {
      console.warn('webhook: handleCalledCommand note appendToConversationHistory failed: ' + err.message);
    }
  }

  await twilioModule.sendSMS(
    agent,
    matchedRow.name + ' (' + matchedRow.leadId + ') set to manual_handling.' + (note ? ' Note saved.' : '')
  ).catch(() => {});

  console.log('webhook: CALLED command processed for agent ' + agent.agentId + ', lead ' + matchedRow.leadId);
}

// Handles "RESUME <token>" from the agent. Validates current status is
// manual_handling, then flips to awaiting_response and resets follow-up counters.
// Never throws.
async function handleResumeCommand(agent, body) {
  const match = body.match(/^RESUME\s+(\S+)/i);
  if (!match) {
    await twilioModule.sendSMS(agent, 'Format: RESUME <Q-token or lead email>').catch(() => {});
    return;
  }
  const parsed = parseCommandToken(match[1]);
  if (!parsed) {
    await twilioModule.sendSMS(agent, 'Could not parse token: ' + match[1]).catch(() => {});
    return;
  }

  let matchedRow;
  try {
    matchedRow = await lookupRowByCommandToken(agent, parsed);
  } catch (err) {
    console.error('webhook: handleResumeCommand readSheetRows failed for agent ' + agent.agentId + ': ' + err.message);
    return;
  }

  if (!matchedRow) {
    await twilioModule.sendSMS(agent, 'Lead not found for: ' + match[1]).catch(() => {});
    return;
  }

  if (matchedRow.status !== 'manual_handling') {
    await twilioModule.sendSMS(
      agent,
      matchedRow.name + ' is not in manual_handling (current: ' + (matchedRow.status || 'unknown') + '). Use CALLED first.'
    ).catch(() => {});
    return;
  }

  const nowIso = new Date().toISOString();
  try {
    await emailModule.updateSheetRow(agent, matchedRow.rowIndex, {
      status: 'awaiting_response',
      lastFollowUpDate: nowIso,
      followUpCount: '0',
      lastActionTimestamp: nowIso,
    });
  } catch (err) {
    console.error('webhook: handleResumeCommand updateSheetRow failed: ' + err.message);
    return;
  }

  try {
    await emailModule.appendToConversationHistory(
      agent,
      matchedRow.rowIndex,
      'Agent resumed AI follow-ups via SMS command. Status set to awaiting_response, follow-up count reset to 0.'
    );
  } catch (err) {
    console.warn('webhook: handleResumeCommand appendToConversationHistory failed: ' + err.message);
  }

  await twilioModule.sendSMS(
    agent,
    matchedRow.name + ' (' + matchedRow.leadId + ') AI follow-ups resumed.'
  ).catch(() => {});

  console.log('webhook: RESUME command processed for agent ' + agent.agentId + ', lead ' + matchedRow.leadId);
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

// A notification failure must never break the handler that produced the
// thing being notified about. The lead email has already gone out by the
// time most of these fire.
async function notifySafely(agent, message, prefix) {
  try {
    await twilioModule.sendSMS(agent, message);
  } catch (err) {
    console.error(prefix + ' confirmation SMS failed: ' + err.message);
  }
}

// Column L is newline-delimited and every reader splits on \n and indexes
// the first or last line, so a multi-line note would silently break that
// invariant. It also feeds the drafting prompts untruncated, which is why
// there is a hard cap here and not just a formatting pass.
function sanitiseNote(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const flattened = raw.replace(/\s+/g, ' ').trim();
  if (flattened.length > 500) {
    return flattened.slice(0, 500) + '…';
  }
  return flattened;
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
  const leadDisplayName = matchedRow.name || leadEmail;
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
    await notifySafely(agent, 'Could not draft a reply for ' + token + '. The question stays in your queue.', prefix);
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
      await notifySafely(agent, 'Could not deliver the draft for ' + token + '. The question stays in your queue, try again.', prefix);
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
      await notifySafely(agent, 'Could not send your answer to ' + leadDisplayName + '. The question stays in your queue, try again.', prefix);
      return;
    }
  }

  // Shadow mode emails the agent, not the lead. Saying "sent" here would
  // assert contact that did not happen.
  // Computed once at the point delivery actually succeeded, so every
  // downstream notification describes the same event the same way.
  const deliveredBase = agent.mode === 'shadow'
    ? 'Draft for ' + leadDisplayName + ' is in your inbox. Lead not contacted yet.'
    : 'Answer sent to ' + leadDisplayName + '.';

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

  let sheetUpdateFailed = false;

  try {
    await emailModule.updateSheetRow(agent, matchedRow.rowIndex, {
      pendingQuestion: updatedQueue,
      status: newStatus,
      lastActionTimestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error(prefix + ' updateSheetRow failed: ' + err.message);
    sheetUpdateFailed = true;
    await notifySafely(agent, deliveredBase + ' The sheet did not update, so you may see this question again.', prefix);
  }

  try {
    const snippet = agentAnswer.slice(0, 60);
    // Shadow mode never contacted the lead. This line is read back into the
    // Path 1A and follow-up drafting prompts, so claiming a reply was sent
    // would have the drafter build on an event that did not happen.
    const columnLEntry = agent.mode === 'shadow'
      ? 'Path 1B draft prepared for ' + token + ': ' + snippet
      : 'Path 1B reply sent for ' + token + ': ' + snippet;
    await emailModule.appendToConversationHistory(
      agent,
      matchedRow.rowIndex,
      columnLEntry
    );
  } catch (err) {
    console.error(prefix + ' appendToConversationHistory failed: ' + err.message);
  }

  const remainingSuffix = remainingEntries.length > 0
    ? ' ' + remainingEntries.length + ' more open for this lead.'
    : '';

  if (!sheetUpdateFailed) {
    await notifySafely(agent, deliveredBase + remainingSuffix, prefix);
  }
}

function createApp() {
  const app = express();
  // req.protocol is evaluated on whichever app instance handles the
  // request; set this here too (not just on the mounting parent app in
  // server.js) so X-Forwarded-Proto is honoured even if this app is ever
  // run standalone.
  app.set('trust proxy', true);
  app.use(express.urlencoded({ extended: false }));

  app.post('/sms-incoming', (req, res) => {
    const host = req.get('host') || '';
    const signature = req.get('X-Twilio-Signature') || '';
    // Prefer an explicit configured public URL over reconstructing the
    // scheme from req.protocol: Twilio signs the request against the exact
    // public URL it was told to call, and req.protocol can still land on
    // 'http' behind some proxy configurations even with trust proxy set.
    // PUBLIC_APP_URL, when set, removes that ambiguity entirely.
    const publicAppUrl = process.env.PUBLIC_APP_URL;
    const url = publicAppUrl
      ? publicAppUrl + req.originalUrl
      : req.protocol + '://' + req.get('host') + req.originalUrl;
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
      let dispatchPromise;
      if (/^CALLED\s+\S/i.test(body.trim())) {
        dispatchPromise = handleCalledCommand(agent, body);
      } else if (/^RESUME\s+\S/i.test(body.trim())) {
        dispatchPromise = handleResumeCommand(agent, body);
      } else {
        dispatchPromise = handleAgentReply(agent, body, messageSid, type, token);
      }
      dispatchPromise.catch((err) => {
        console.error(
          'webhook: unhandled error dispatching for agent ' + agent.agentId + ': ' + err.message
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

module.exports = { createApp, handleAgentReply, sendOpenQuestionsSuggestion, handleCalledCommand, handleResumeCommand };
