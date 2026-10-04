// src/textFailureAlert.js
//
// When an agent-facing text fails to send, email tells Mo - the only
// channel left when the one that just failed is SMS itself. Sent via the
// operator's own Gmail OAuth credentials, same as alertOperatorSheetUnavailable
// (src/digest.js). See docs/designs/agent-phone.md decision 3.
//
// hot_lead is exempt from the once-a-day cap: every hot-lead failure alerts.
// Every other kind gets at most one alert email per agent per kind per
// calendar day in the agent's own timezone.

const email = require('./email');
const { loadOperator } = require('./operatorConfig');
const { hasAlertedToday, recordAlertSent } = require('./agentState');
const { getNowDate } = require('./time');
const { todayInTimeZone } = require('./calendarDate');

const KIND_LABELS = {
  daily_brief: 'daily brief',
  hot_lead: 'hot-lead alert',
  needs_review: 'urgent review alert',
  path1b_question: 'property question',
  path1b_reminder: '2-hour reminder',
  welcome: 'welcome text',
};

const UNLIMITED_KINDS = new Set(['hot_lead']);

function buildBody({ kind, agentName, error, smsBody }) {
  const errorCode = error && error.code != null ? error.code : 'n/a';
  const errorMessage = (error && error.message) || 'unknown error';

  const lines = [];
  if (kind === 'hot_lead') {
    lines.push(`A hot lead came in and ${agentName} wasn't told. Worth a call.`, '');
  }
  lines.push(
    `Twilio said: ${errorCode} ${errorMessage}`,
    '',
    "The text they didn't get:",
    smsBody
  );
  if (kind !== 'hot_lead') {
    lines.push('', "You'll get at most one of these a day for this kind of text.");
  }
  return lines.join('\n');
}

// Never throws into its caller: every exit is a return, and the whole body
// is wrapped so even an unexpected failure (e.g. a bad timezone string)
// resolves { sent: false } instead of rejecting.
async function alertAgentTextFailed(agentConfig, { kind, smsBody, error }, deps = {}) {
  const doLoadOperator = deps.loadOperator || loadOperator;
  const doHasAlertedToday = deps.hasAlertedToday || hasAlertedToday;
  const doRecordAlertSent = deps.recordAlertSent || recordAlertSent;
  const sendNewEmail = deps.sendNewEmail || email.sendNewEmail;

  const agentId = agentConfig.agentId;
  const label = KIND_LABELS[kind];

  try {
    if (!label) {
      console.warn(`[${agentId}] text-failure alert: unknown kind "${kind}", not alerting`);
      return { sent: false, reason: 'unknown_kind' };
    }

    const limited = !UNLIMITED_KINDS.has(kind);
    let today = null;

    if (limited) {
      const timezone = agentConfig.timezone || 'America/Toronto';
      today = todayInTimeZone(getNowDate(), timezone);

      if (doHasAlertedToday(agentId, kind, today)) {
        return { sent: false, reason: 'already_alerted_today' };
      }
    }

    if (!agentConfig.operatorId) {
      console.warn(`[${agentId}] text-failure alert: no operatorId, cannot alert`);
      return { sent: false, reason: 'no_operator' };
    }

    let operatorConfig;
    try {
      operatorConfig = doLoadOperator(agentConfig.operatorId);
    } catch (err) {
      console.warn(`[${agentId}] text-failure alert: loadOperator failed: ${err.message}`);
      return { sent: false, reason: 'operator_load_failed' };
    }

    if (!operatorConfig.operatorEmail) {
      console.warn(`[${agentId}] text-failure alert: operator has no operatorEmail, cannot alert`);
      return { sent: false, reason: 'no_operator_email' };
    }

    const agentName = agentConfig.agentName || agentConfig.agentId;
    const subject = `GetKlosed: a text to ${agentName} didn't send (${label})`;
    const body = buildBody({ kind, agentName, error, smsBody });

    try {
      await sendNewEmail(operatorConfig, { to: operatorConfig.operatorEmail, subject, body });
    } catch (err) {
      console.warn(`[${agentId}] text-failure alert: send failed: ${err.message}`);
      return { sent: false, reason: 'send_failed' };
    }

    if (limited) {
      doRecordAlertSent(agentId, kind, today);
    }

    return { sent: true };
  } catch (err) {
    console.error(`[${agentId}] text-failure alert: unexpected error: ${err.message}`);
    return { sent: false, reason: 'error' };
  }
}

module.exports = { alertAgentTextFailed };
