// src/paths.js
// Path-routing layer for the orchestrator.
// Each function handles one reply category and follows the same shape:
//   async function pathX(agent, row, msg, cat) -> result
//
// Path functions never throw. They catch their own errors and return a result
// object the orchestrator can log. This allows partial success (e.g. Sheet
// written, SMS failed) without stopping the processing loop.
//
// Paths implemented here so far:
//   pathHotSignal  (Path 2, category: hot_signal)
//   pathStopSignal (Path 3, category: stop_signal)
//   pathNeedsReview (Path 4, category: needs_review)
//
// Coming in subsequent commits:
//   pathAnswerGeneral          (Path 1A, category: answer_general)
//   pathAnswerPropertySpecific (Path 1B, category: answer_property_specific)

const email = require('./email');
const twilio = require('./twilio');
const prompts = require('./prompts');
const claude = require('./claude');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOT_SMS_CONFIDENCE_THRESHOLD = 0.85;
// SMS only fires when categorizer confidence >= this threshold.
// Below this, the lead is still flagged HOT in the Sheet and the email alert
// still fires, but the agent's phone does NOT buzz. Prevents SMS fatigue from
// borderline categorizations. Tunable in one place; can become per-agent later.

const URGENT_KEYWORDS = ['lawyer', 'attorney', 'complaint', 'dispute', 'legal action'];
// Keywords that trigger an immediate SMS to the agent on top of the email alert
// in Path 4. No confidence threshold applies here: keyword presence alone fires
// the SMS. The list is intentionally short to avoid false positives.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Returns true if any urgent keyword appears (case-insensitive) in text.
// Returns false for null/undefined input.
function hasUrgentKeyword(text) {
  if (!text) return false;
  const lower = String(text).toLowerCase();
  return URGENT_KEYWORDS.some((k) => lower.includes(k));
}

// Wraps a Claude-drafted body for Shadow Mode delivery. The wrapped email goes
// to the agent, not the lead. Used by Path 3 today; reusable by Path 1A later.
// Returns { subject, body }.
function buildShadowDraftWrapper(leadEmail, draftBody) {
  const body = [
    'This is a draft. The lead did NOT receive this message.',
    `If you want to send your own version, reply at ${leadEmail}.`,
    '',
    '---',
    '',
    draftBody,
  ].join('\n');
  return { subject: '[SHADOW DRAFT]', body };
}

// ---------------------------------------------------------------------------
// Path 2: hot_signal
// ---------------------------------------------------------------------------

/**
 * Handle a hot_signal reply.
 *
 * Steps (in order):
 *   1. Update Sheet: status -> 'HOT', lastActionTimestamp -> now. CRITICAL: failure aborts.
 *   2. Append entry to column L (conversation history). Non-fatal.
 *   3. Send email alert to agent's escalation address. Non-fatal.
 *   4. Send SMS to agent, only when cat.confidence >= HOT_SMS_CONFIDENCE_THRESHOLD. Non-fatal.
 *
 * Returns { ok, actions, skipped, errors }.
 */
async function pathHotSignal(agent, row, msg, cat) {
  const prefix = `[paths.hotSignal] row ${row.rowIndex}:`;

  // Step 1: Update Sheet (critical)
  console.log(`${prefix} marking HOT`);
  try {
    await email.updateSheetRow(agent, row.rowIndex, {
      status: 'HOT',
      lastActionTimestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.log(`${prefix} STEP sheet failed: ${err.message}`);
    return { ok: false, actions: [], error: `sheet update failed: ${err.message}` };
  }

  const actions = ['sheet'];
  const skipped = [];
  const errors = [];

  // Step 2: Append to column L (non-fatal)
  const historyEntry = `HOT signal: ${(msg.snippet || '').slice(0, 200)}`;
  try {
    await email.appendToConversationHistory(agent, row.rowIndex, historyEntry);
    actions.push('columnL');
    console.log(`${prefix} column L logged`);
  } catch (err) {
    console.log(`${prefix} STEP columnL failed: ${err.message}`);
    errors.push({ step: 'columnL', error: err.message });
  }

  // Step 3: Email alert to agent (non-fatal)
  const alertTo = agent.escalationEmail || agent.gmailAddress;
  const alertSubject = `🔥 HOT LEAD: ${row.name || 'Lead'}`;
  const alertBody = [
    'A hot lead just replied. Action needed.',
    '',
    `Lead: ${row.name || 'unknown'}`,
    `Email: ${row.leadId}`,
    `Phone: ${row.phone || 'not on file'}`,
    '',
    'What they said:',
    msg.snippet || '',
    '',
    'Categorizer reasoning:',
    cat.reasoning || '',
    '',
    `Sheet row: ${row.rowIndex}`,
    '',
    `ACTION: Reply directly to ${row.leadId}`,
  ].join('\n');

  try {
    await email.sendNewEmail(agent, {
      to: alertTo,
      subject: alertSubject,
      body: alertBody,
    });
    actions.push('email');
    console.log(`${prefix} email alert sent`);
  } catch (err) {
    console.log(`${prefix} STEP email failed: ${err.message}`);
    errors.push({ step: 'email', error: err.message });
  }

  // Step 4: SMS alert to agent (non-fatal, confidence-gated)
  if (cat.confidence >= HOT_SMS_CONFIDENCE_THRESHOLD) {
    const smsBody = twilio.TEMPLATES.hotLeadAlert({
      leadName: row.name || 'A lead',
      snippet: msg.snippet || '',
      leadEmail: row.leadId,
    });
    try {
      await twilio.sendSMS(agent, smsBody);
      actions.push('sms');
      console.log(`${prefix} SMS sent (confidence ${cat.confidence.toFixed(2)})`);
    } catch (err) {
      console.log(`${prefix} STEP sms failed: ${err.message}`);
      errors.push({ step: 'sms', error: err.message });
    }
  } else {
    skipped.push('sms_below_threshold');
    console.log(`${prefix} SMS skipped (confidence ${cat.confidence.toFixed(2)} < ${HOT_SMS_CONFIDENCE_THRESHOLD} threshold)`);
  }

  return { ok: true, actions, skipped, errors };
}

// ---------------------------------------------------------------------------
// Path 4: needs_review
// ---------------------------------------------------------------------------

/**
 * Handle a needs_review reply.
 *
 * Steps (in order):
 *   1. Update Sheet: status -> 'needs_review', lastActionTimestamp -> now. CRITICAL: failure aborts.
 *   2. Append entry to column L (conversation history). Non-fatal.
 *   3. Send email alert to agent's escalation address with full context. Non-fatal.
 *   4. Keyword scan: check msg.snippet for URGENT_KEYWORDS.
 *   5. Send SMS only if an urgent keyword was detected. Non-fatal. No confidence gate.
 *
 * Returns { ok, actions, skipped, errors }.
 *   actions is an object: { sheet, columnL, email, sms }
 *   actions.email: 'sent' | 'failed'
 *   actions.sms:   'delivered' | 'failed' | 'skipped'
 */
async function pathNeedsReview(agent, row, msg, cat) {
  const prefix = `[paths.needsReview] row ${row.rowIndex}:`;

  // Step 1: Update Sheet (critical)
  console.log(`${prefix} marking needs_review`);
  try {
    await email.updateSheetRow(agent, row.rowIndex, {
      status: 'needs_review',
      lastActionTimestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.log(`${prefix} STEP sheet failed: ${err.message}`);
    return { ok: false, actions: {}, skipped: [], errors: [{ step: 'sheet', error: err.message }] };
  }

  const actions = { sheet: true };
  const skipped = [];
  const errors = [];

  // Step 2: Append to column L (non-fatal)
  const historyEntry = [
    `needs_review (confidence ${cat.confidence.toFixed(2)})`,
    `Reasoning: ${cat.reasoning || ''}`,
    `Snippet: ${(msg.snippet || '').slice(0, 200)}`,
  ].join(' | ');
  try {
    await email.appendToConversationHistory(agent, row.rowIndex, historyEntry);
    actions.columnL = true;
    console.log(`${prefix} column L logged`);
  } catch (err) {
    console.log(`${prefix} STEP columnL failed: ${err.message}`);
    errors.push({ step: 'columnL', error: err.message });
  }

  // Step 3: Email alert to agent (non-fatal)
  const alertTo = agent.escalationEmail || agent.gmailAddress;
  const alertSubject = `[NEEDS REVIEW] Lead reply from ${row.name || 'Lead'}`;
  const alertBody = [
    'A lead reply requires your manual attention.',
    '',
    `Lead: ${row.name || 'unknown'}`,
    `Email: ${row.leadId}`,
    `Phone: ${row.phone || 'not on file'}`,
    '',
    'Original inquiry:',
    row.originalMessage || '(not on file)',
    '',
    'Reply that triggered review:',
    msg.snippet || '',
    '',
    "Claude's reasoning:",
    cat.reasoning || '',
    '',
    `Claude's confidence: ${cat.confidence.toFixed(2)}`,
    '',
    `Reply directly to the lead at ${row.leadId} to handle this manually.`,
  ].join('\n');

  try {
    await email.sendNewEmail(agent, {
      to: alertTo,
      subject: alertSubject,
      body: alertBody,
    });
    actions.email = 'sent';
    console.log(`${prefix} email alert sent`);
  } catch (err) {
    console.log(`${prefix} STEP email failed: ${err.message}`);
    actions.email = 'failed';
    errors.push({ step: 'email', error: err.message });
  }

  // Step 4: Keyword scan
  const urgentDetected = hasUrgentKeyword(msg.snippet);
  console.log(`${prefix} keyword scan: urgentDetected=${urgentDetected}`);

  // Step 5: Urgent SMS if keyword detected (non-fatal, no confidence gate)
  if (urgentDetected) {
    const keyword = URGENT_KEYWORDS.find((k) =>
      (msg.snippet || '').toLowerCase().includes(k)
    ) || 'urgent';
    const smsBody = twilio.TEMPLATES.urgentNeedsReview({
      keyword,
      leadName: row.name || 'A lead',
    });
    try {
      await twilio.sendSMS(agent, smsBody);
      actions.sms = 'delivered';
      console.log(`${prefix} urgent SMS sent (keyword: ${keyword})`);
    } catch (err) {
      console.log(`${prefix} STEP sms failed: ${err.message}`);
      actions.sms = 'failed';
      errors.push({ step: 'sms', error: err.message });
    }
  } else {
    actions.sms = 'skipped';
    skipped.push('no_urgent_keyword');
    console.log(`${prefix} SMS skipped (no urgent keyword detected)`);
  }

  return { ok: true, actions, skipped, errors };
}

// ---------------------------------------------------------------------------
// Path 3: stop_signal
// ---------------------------------------------------------------------------

/**
 * Handle a stop_signal reply.
 *
 * Steps (in order):
 *   a. Draft via Claude using buildPath3DraftPrompt. Best-effort: if Claude
 *      throws or returns escalate=true, fall back to a hardcoded safe template.
 *      Either way, a draft is always produced before proceeding.
 *   b. Update Sheet: status -> 'cold', lastActionTimestamp -> now. CRITICAL: failure aborts.
 *   c. Append entry to column L. Non-fatal.
 *   d. Send email. Mode-gated:
 *        shadow: wrap with buildShadowDraftWrapper, sendNewEmail to agent.gmailAddress.
 *        live:   sendReply to lead, threaded.
 *      Non-fatal.
 *
 * Returns { ok, actions, skipped, errors }.
 *   actions.draft: 'claude' | 'fallback_template'
 *   actions.sheet: 'updated'
 *   actions.columnL: 'logged' | 'failed'
 *   actions.email: 'sent_to_agent_shadow' | 'sent_to_lead' | 'failed'
 */
async function pathStopSignal(agent, row, msg, cat) {
  const prefix = `[paths.stopSignal] row ${row.rowIndex}:`;

  // Step a: Draft via Claude (best-effort, always produces a draft)
  const firstName = row.firstName || (row.name || '').split(' ')[0] || 'there';
  let draftBody;
  let draftSource;
  let draftError = null;

  let hasSignature = false;
  try {
    hasSignature = await email.getSignaturePresence(agent);
  } catch (err) {
    console.log(`${prefix} signature check failed: ${err.message} (assuming no signature)`);
  }

  const leadContext = { name: row.name || '' };
  const prompt = prompts.buildPath3DraftPrompt(agent, leadContext, hasSignature, cat.reasoning);
  const bannedPhrases = prompts.getMergedBannedPhrases(agent);

  try {
    const result = await claude.draft(prompt, bannedPhrases);
    if (result.escalate) {
      throw new Error(
        `draft escalated after ${result.attempts} attempt(s): violations=[${result.violations.join(', ')}]`
      );
    }
    draftBody = result.text;
    draftSource = 'claude';
    console.log(`${prefix} Claude draft ready (${result.attempts} attempt(s))`);
  } catch (err) {
    draftError = err.message;
    console.log(`${prefix} STEP draft failed (using fallback): ${err.message}`);
    draftBody = [
      `Hi ${firstName},`,
      '',
      "No problem, I'll take you off the list. Wishing you the best with your search.",
      '',
      agent.agentName || '',
    ].join('\n');
    draftSource = 'fallback_template';
  }

  // Step b: Update Sheet (critical)
  console.log(`${prefix} marking cold`);
  try {
    await email.updateSheetRow(agent, row.rowIndex, {
      status: 'cold',
      lastActionTimestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.log(`${prefix} STEP sheet failed: ${err.message}`);
    return { ok: false, actions: {}, skipped: [], errors: [{ step: 'sheet', error: err.message }] };
  }

  const actions = { draft: draftSource, sheet: 'updated' };
  const skipped = [];
  const errors = draftError ? [{ step: 'draft', error: draftError }] : [];

  // Step c: Append to column L (non-fatal)
  const historyEntry = [
    `stop_signal (confidence ${cat.confidence.toFixed(2)})`,
    `Reasoning: ${cat.reasoning || ''}`,
    `Snippet: ${(msg.snippet || '').slice(0, 200)}`,
    `Draft source: ${draftSource}`,
  ].join(' | ');
  try {
    await email.appendToConversationHistory(agent, row.rowIndex, historyEntry);
    actions.columnL = 'logged';
    console.log(`${prefix} column L logged`);
  } catch (err) {
    console.log(`${prefix} STEP columnL failed: ${err.message}`);
    actions.columnL = 'failed';
    errors.push({ step: 'columnL', error: err.message });
  }

  // Step d: Send email, shadow or live (non-fatal)
  if (agent.mode === 'shadow') {
    const wrapped = buildShadowDraftWrapper(row.leadId, draftBody);
    try {
      await email.sendNewEmail(agent, {
        to: agent.gmailAddress,
        subject: wrapped.subject,
        body: wrapped.body,
      });
      actions.email = 'sent_to_agent_shadow';
      console.log(`${prefix} shadow draft sent to agent (${agent.gmailAddress})`);
    } catch (err) {
      console.log(`${prefix} STEP email (shadow) failed: ${err.message}`);
      actions.email = 'failed';
      errors.push({ step: 'email', error: err.message });
    }
  } else {
    try {
      await email.sendReply(agent, {
        to: row.leadId,
        subject: msg.subject || '',
        body: draftBody,
        threadId: msg.threadId,
      });
      actions.email = 'sent_to_lead';
      console.log(`${prefix} live reply sent to lead (${row.leadId})`);
    } catch (err) {
      console.log(`${prefix} STEP email (live) failed: ${err.message}`);
      actions.email = 'failed';
      errors.push({ step: 'email', error: err.message });
    }
  }

  return { ok: true, actions, skipped, errors };
}

// ---------------------------------------------------------------------------
// Path 1A: answer_general and conversation_continue
// ---------------------------------------------------------------------------

/**
 * Handle an answer_general or conversation_continue reply.
 *
 * Both categories route here because the response strategy is identical:
 * Claude drafts a general reply, no agent input required.
 *
 * Steps (in order):
 *   a. Read conversation history from the row (already fetched by readSheetRows). Best-effort.
 *   b. Check Gmail signature presence. Best-effort.
 *   c. Draft via Claude using buildPath1ADraftPrompt. Best-effort: fallback template on failure.
 *   d. Update Sheet: status -> 'warm' (claude) or 'needs_review' (fallback),
 *      lastActionTimestamp -> now. CRITICAL: failure aborts.
 *   e. Append entry to column L. Non-fatal.
 *   f. Send email. Mode-gated:
 *        shadow: wrap with buildShadowDraftWrapper, sendNewEmail to agent.
 *        live:   sendReply to lead, threaded.
 *      Non-fatal.
 *   g. If draftSource === 'fallback_template', send escalation email to agent. Non-fatal.
 *      If draftSource === 'claude', set actions.escalationEmail = 'not_needed'.
 *
 * Returns { ok, actions, skipped, errors }.
 *   actions.draft: 'claude' | 'fallback_template'
 *   actions.sheet: 'updated'
 *   actions.columnL: 'logged' | 'failed'
 *   actions.email: 'sent_to_agent_shadow' | 'sent_to_lead' | 'failed'
 *   actions.escalationEmail: 'sent' | 'failed' | 'not_needed'
 */
async function pathAnswerGeneral(agent, row, msg, cat) {
  const prefix = `[paths.answerGeneral] row ${row.rowIndex}:`;
  const errors = [];

  // Step a: Get conversation history from the row object (best-effort)
  let conversationHistory = '';
  try {
    conversationHistory = row.conversationHistory || '';
  } catch (err) {
    console.log(`${prefix} STEP columnL read failed: ${err.message} (proceeding with empty history)`);
    errors.push({ step: 'columnL_read', error: err.message });
  }

  // Step b: Check signature presence (best-effort)
  let hasSignature = false;
  try {
    hasSignature = await email.getSignaturePresence(agent);
  } catch (err) {
    console.log(`${prefix} signature check failed: ${err.message} (assuming no signature)`);
  }

  const leadContext = {
    name: row.name,
    originalInquiry: row.originalMessage,
    conversationHistory,
  };

  const prompt = prompts.buildPath1ADraftPrompt(agent, msg.snippet || '', leadContext, hasSignature);
  const bannedPhrases = prompts.getMergedBannedPhrases(agent);

  // Step c: Draft via Claude (best-effort, always produces a draft)
  const firstName = row.firstName || (row.name || '').split(' ')[0] || 'there';
  let draftBody;
  let draftSource;
  let draftError = null;

  try {
    const result = await claude.draft(prompt, bannedPhrases);
    if (result.escalate) {
      throw new Error(
        `draft escalated after ${result.attempts} attempt(s): violations=[${result.violations.join(', ')}]`
      );
    }
    draftBody = result.text;
    draftSource = 'claude';
    console.log(`${prefix} Claude draft ready (${result.attempts} attempt(s))`);
  } catch (err) {
    draftError = err.message;
    console.log(`${prefix} STEP draft failed (using fallback): ${err.message}`);
    draftBody = `Hi ${firstName},\n\nGreat question. Let me check on this and get back to you with a complete answer shortly.\n\n${agent.agentName || ''}`;
    draftSource = 'fallback_template';
  }

  // Step d: Update Sheet (critical, only this determines ok)
  const newStatus = draftSource === 'claude' ? 'warm' : 'needs_review';
  console.log(`${prefix} marking ${newStatus}`);
  try {
    await email.updateSheetRow(agent, row.rowIndex, {
      status: newStatus,
      lastActionTimestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.log(`${prefix} STEP sheet failed: ${err.message}`);
    return { ok: false, actions: {}, skipped: [], errors: [{ step: 'sheet', error: err.message }] };
  }

  const actions = { draft: draftSource, sheet: 'updated' };
  if (draftError) {
    errors.push({ step: 'draft', error: draftError });
  }

  // Step e: Append to column L (non-fatal)
  const historyEntry = [
    `${cat.category} (confidence ${cat.confidence.toFixed(2)})`,
    `Reasoning: ${cat.reasoning || ''}`,
    `Snippet: ${(msg.snippet || '').slice(0, 200)}`,
    `Draft source: ${draftSource}`,
  ].join(' | ');
  try {
    await email.appendToConversationHistory(agent, row.rowIndex, historyEntry);
    actions.columnL = 'logged';
    console.log(`${prefix} column L logged`);
  } catch (err) {
    console.log(`${prefix} STEP columnL failed: ${err.message}`);
    actions.columnL = 'failed';
    errors.push({ step: 'columnL', error: err.message });
  }

  // Step f: Send email, shadow or live (non-fatal)
  if (agent.mode === 'shadow') {
    const wrapped = buildShadowDraftWrapper(row.leadId, draftBody);
    try {
      await email.sendNewEmail(agent, {
        to: agent.gmailAddress,
        subject: wrapped.subject,
        body: wrapped.body,
      });
      actions.email = 'sent_to_agent_shadow';
      console.log(`${prefix} shadow draft sent to agent (${agent.gmailAddress})`);
    } catch (err) {
      console.log(`${prefix} STEP email (shadow) failed: ${err.message}`);
      actions.email = 'failed';
      errors.push({ step: 'email', error: err.message });
    }
  } else {
    try {
      await email.sendReply(agent, {
        to: row.leadId,
        subject: msg.subject || '',
        body: draftBody,
        threadId: msg.threadId,
      });
      actions.email = 'sent_to_lead';
      console.log(`${prefix} live reply sent to lead (${row.leadId})`);
    } catch (err) {
      console.log(`${prefix} STEP email (live) failed: ${err.message}`);
      actions.email = 'failed';
      errors.push({ step: 'email', error: err.message });
    }
  }

  // Step g: Escalation email when fallback was used (non-fatal)
  if (draftSource === 'fallback_template') {
    const escalationTo = agent.escalationEmail || agent.gmailAddress;
    const escalationSubject = `[ESCALATION] Path 1A draft failed for lead ${row.name || 'unknown'}`;
    const escalationBody = [
      'Claude failed to draft a response after 3 retries. A holding message has been sent to the lead.',
      '',
      `Lead: ${row.name || 'unknown'}`,
      `Email: ${row.leadId}`,
      `Phone: ${row.phone || 'not on file'}`,
      '',
      'Original inquiry:',
      row.originalMessage || '(not on file)',
      '',
      'Current reply that triggered Path 1A:',
      msg.snippet || '',
      '',
      "Categorizer's reasoning:",
      cat.reasoning || '',
      '',
      `Holding message sent to lead: "${draftBody}"`,
      '',
      `Please follow up with a real answer manually by replying directly to the lead at ${row.leadId}.`,
    ].join('\n');

    try {
      await email.sendNewEmail(agent, {
        to: escalationTo,
        subject: escalationSubject,
        body: escalationBody,
      });
      actions.escalationEmail = 'sent';
      console.log(`${prefix} escalation email sent (draft fallback)`);
    } catch (err) {
      console.log(`${prefix} STEP escalationEmail failed: ${err.message}`);
      actions.escalationEmail = 'failed';
      errors.push({ step: 'escalationEmail', error: err.message });
    }
  } else {
    actions.escalationEmail = 'not_needed';
  }

  return { ok: true, actions, skipped: [], errors };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  pathHotSignal,
  HOT_SMS_CONFIDENCE_THRESHOLD,
  pathNeedsReview,
  URGENT_KEYWORDS,
  pathStopSignal,
  pathAnswerGeneral,
};
