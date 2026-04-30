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
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  pathHotSignal,
  HOT_SMS_CONFIDENCE_THRESHOLD,
};
