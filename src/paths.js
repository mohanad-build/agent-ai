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
//   pathHotSignal (Path 2, category: hot_signal)
//
// Coming in subsequent commits:
//   pathAnswerGeneral         (Path 1A, category: answer_general)
//   pathAnswerPropertySpecific (Path 1B, category: answer_property_specific)
//   pathStopSignal            (Path 3,  category: stop_signal)
//   pathNeedsReview           (Path 4,  category: needs_review)

const email = require('./email');
const twilio = require('./twilio');

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
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  pathHotSignal,
  HOT_SMS_CONFIDENCE_THRESHOLD,
  pathNeedsReview,
  URGENT_KEYWORDS,
};
