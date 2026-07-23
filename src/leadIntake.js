// src/leadIntake.js
//
// Lead Intake Tier 2: reads the agent's unread Gmail inbox, pre-filters,
// classifies via Claude Haiku, and routes each message to the correct branch.
//
// Branches:
//   lead (confidence >= 0.6)         -> append new Sheet row (aiEnabled=TRUE if conf>=0.85, else FALSE), or re-engagement log
//   noise (confidence >= 0.85)       -> apply noise label, mark read
//   business_correspondence (or low  -> remove processing label, leave unread so agent sees it normally
//     confidence anything else)
//
// Called by processAgent in src/index.js before the Sheet read.

const claude = require('./claude');
const gmail = require('./gmail');
const email = require('./email');
const prompts = require('./prompts');
const { getNowDate, getNowIso } = require('./time');

const LEAD_INTAKE_MAX_PER_CYCLE = 20;
const LABEL_PROCESSING = 'agent-ai/processing';
const LABEL_INTAKEN = 'agent-ai/intaken';
const LABEL_NOISE = 'agent-ai/noise';
const LABEL_FIRST_TOUCH_PENDING = 'agent-ai/first-touch-pending';
const CALENDAR_DOMAINS = new Set(['google.com', 'calendly.com', 'googleusercontent.com']);

// ---------------------------------------------------------------------------
// JSON parsing helpers
// ---------------------------------------------------------------------------

function stripCodeFences(text) {
  return text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
}

function parseClassifierResponse(text) {
  const cleaned = stripCodeFences(String(text || ''));
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error('classifier response was not valid JSON: ' + cleaned.slice(0, 120));
  }
  const validCategories = new Set(['lead', 'noise', 'business_correspondence']);
  if (!validCategories.has(parsed.category)) {
    throw new Error('classifier returned unknown category: ' + parsed.category);
  }
  return {
    category: parsed.category,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    name: String(parsed.name || ''),
    email: String(parsed.email || ''),
    phone: String(parsed.phone || ''),
    inquiryMessage: String(parsed.inquiryMessage || ''),
    propertyReference: String(parsed.propertyReference || ''),
    reasoning: String(parsed.reasoning || ''),
  };
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

async function callClassifier(agentConfig, subject, body, senderName, senderEmail) {
  const prompt = prompts.buildHeuristicClassifierPrompt(subject, body, senderName, senderEmail);
  const rawText = await claude.callRaw({ system: prompt.system, user: prompt.user });
  return parseClassifierResponse(rawText);
}

// ---------------------------------------------------------------------------
// Sender helpers
// ---------------------------------------------------------------------------

function getSenderEmail(from) {
  if (!from || typeof from !== 'string') return '';
  const angleMatch = from.match(/<([^>]+)>/);
  if (angleMatch && angleMatch[1]) return angleMatch[1].trim().toLowerCase();
  const trimmed = from.trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  return '';
}

function getSenderDomain(emailAddress) {
  if (!emailAddress || !emailAddress.includes('@')) return '';
  return emailAddress.split('@')[1].toLowerCase();
}

function getSenderDisplayName(from) {
  if (!from || typeof from !== 'string') return '';
  const angleMatch = from.match(/^([^<]+)<[^>]+>/);
  if (angleMatch) return angleMatch[1].trim();
  return '';
}

/**
 * Builds the column-L intake log entry string for a new lead row.
 * Exported for testability via module.exports._internal.
 */
function buildIntakeLogEntry(classification) {
  const rawConfidence = classification && classification.confidence;
  const confidenceNum = typeof rawConfidence === 'number'
    ? rawConfidence
    : parseFloat(rawConfidence);
  const confidenceStr = Number.isFinite(confidenceNum)
    ? confidenceNum.toFixed(2)
    : 'unknown';
  const reasoning = (classification && classification.reasoning)
    ? String(classification.reasoning).trim()
    : 'no reasoning provided';

  const propertyRaw = classification && classification.propertyReference;
  const propertyTrimmed = propertyRaw ? String(propertyRaw).trim() : '';

  const segments = ['confidence ' + confidenceStr];
  if (propertyTrimmed) {
    segments.push('property: ' + propertyTrimmed);
  }

  return 'Heuristic intake (' + segments.join(', ') + '): ' + reasoning;
}

function determineAiEnabledDefault(classification) {
  const rawConfidence = classification && classification.confidence;
  const confidenceNum = typeof rawConfidence === 'number'
    ? rawConfidence
    : parseFloat(rawConfidence);
  if (Number.isFinite(confidenceNum) && confidenceNum >= 0.85) return 'TRUE';
  return 'FALSE';
}

// ---------------------------------------------------------------------------
// Label management
// ---------------------------------------------------------------------------

async function ensureLabelsExist(agentConfig) {
  return gmail.ensureLabels(agentConfig, [LABEL_PROCESSING, LABEL_INTAKEN, LABEL_NOISE, LABEL_FIRST_TOUCH_PENDING]);
}

async function transitionToIntaken(agentConfig, messageId) {
  // Idempotent transition from first-touch-pending to intaken after a path
  // successfully fires. Gmail's labels.modify endpoint tolerates removing a
  // label not present and adding a label already present, so we blindly
  // apply both operations without inspecting current labels. Best-effort:
  // failures are logged and swallowed; the worst case is cosmetic label drift.
  try {
    const labelMap = await ensureLabelsExist(agentConfig);
    const intakenId = labelMap.get(LABEL_INTAKEN);
    const firstTouchPendingId = labelMap.get(LABEL_FIRST_TOUCH_PENDING);
    if (!intakenId) return;
    await gmail.applyMessageLabels(
      agentConfig,
      messageId,
      [intakenId],
      firstTouchPendingId ? [firstTouchPendingId] : []
    );
  } catch (err) {
    console.log('[' + (agentConfig.agentId || 'unknown') + '] transitionToIntaken failed for ' + messageId + ': ' + err.message);
  }
}

// ---------------------------------------------------------------------------
// Pre-filter
// ---------------------------------------------------------------------------

// Returns { pass: bool, reason: string }.
// Operates only on msg.from, msg.subject, msg.body -- the fields fetchMessage()
// also returns -- so historical enrichment can reuse it without the
// live-inbox-only reply/label rules in applyPreFilter.
function isNoiseSender(msg) {
  // Rule: Sender is from a calendar-automation domain
  const senderEmail = getSenderEmail(msg.from || '');
  const domain = getSenderDomain(senderEmail);
  if (domain && CALENDAR_DOMAINS.has(domain)) {
    return { pass: false, reason: 'calendar domain: ' + domain };
  }

  // Rule: Empty body and trivially short subject
  const bodyText = String(msg.body || '').trim();
  const subjectText = String(msg.subject || '').trim();
  if (!bodyText && subjectText.length < 5) {
    return { pass: false, reason: 'empty body and short subject' };
  }

  return { pass: true, reason: '' };
}

// Returns { pass: bool, reason: string }.
// Applied per-message before classification. Fast-fail, checks in order.
// ctx is optional and shaped { ownAddress, rows }. When ctx or a given field
// is missing, the corresponding rule below is skipped and legacy behavior
// (msg, labelMap only) is preserved exactly.
function applyPreFilter(msg, labelMap, ctx) {
  // Rule 0: Sender is the agent's own address (self-sent)
  if (ctx && ctx.ownAddress) {
    const senderAddr = getSenderEmail(msg.from || '');
    if (senderAddr && senderAddr === ctx.ownAddress) {
      return { pass: false, reason: 'own address (self-sent)' };
    }
  }

  // Rule 1: Is a reply (In-Reply-To header set)
  if (msg.inReplyTo && String(msg.inReplyTo).trim()) {
    return { pass: false, reason: 'reply (In-Reply-To present)' };
  }

  // Rule 1b: Sender already has a row in the Sheet (known lead). Reply
  // Detection owns known-lead traffic; intake should not touch it, since a
  // noise misclassification here would mark the message read and hide it
  // from fetchUnreadReplies' is:unread query later in the same cycle.
  if (ctx && ctx.rows) {
    const senderAddr = getSenderEmail(msg.from || '');
    if (senderAddr && gmail.findRowByEmail(ctx.rows, senderAddr)) {
      return { pass: false, reason: 'known lead (already in column A), reply detection handles this' };
    }
  }

  // Rules 2-3: sender/body noise, delegated
  const noiseResult = isNoiseSender(msg);
  if (!noiseResult.pass) {
    return noiseResult;
  }

  // Rule 4: Already has an intake label (idempotency)
  const msgLabels = msg.labelIds || [];
  const processingId = labelMap && labelMap.get(LABEL_PROCESSING);
  const intakenId = labelMap && labelMap.get(LABEL_INTAKEN);
  const noiseId = labelMap && labelMap.get(LABEL_NOISE);
  const firstTouchPendingId = labelMap && labelMap.get(LABEL_FIRST_TOUCH_PENDING);
  for (const labelId of msgLabels) {
    if (
      (processingId && labelId === processingId) ||
      (intakenId && labelId === intakenId) ||
      (noiseId && labelId === noiseId) ||
      (firstTouchPendingId && labelId === firstTouchPendingId)
    ) {
      return { pass: false, reason: 'already has intake label' };
    }
  }

  return { pass: true, reason: '' };
}

// ---------------------------------------------------------------------------
// Classification branching
// ---------------------------------------------------------------------------

// Branches on the classification result and takes the appropriate action.
// Uses gmail.method() and email.method() calls (not destructured) so that
// require-cache mocking in tests can intercept them.
async function processClassification(agentConfig, msg, classification, rows, stats) {
  const { category, confidence } = classification;
  const labelMap = await ensureLabelsExist(agentConfig);
  const processingId = labelMap.get(LABEL_PROCESSING);
  const intakenId = labelMap.get(LABEL_INTAKEN);
  const noiseId = labelMap.get(LABEL_NOISE);
  const firstTouchPendingId = labelMap.get(LABEL_FIRST_TOUCH_PENDING);

  // Lead branch: confidence threshold 0.6
  if (category === 'lead' && confidence >= 0.6) {
    const senderAddr = getSenderEmail(msg.from || '');

    // Dedup: check if this sender already exists in the Sheet
    const existingRow = gmail.findRowByEmail(rows, senderAddr);

    if (existingRow) {
      const now = getNowDate();
      const daysSince = existingRow.lastActionTimestamp
        ? Math.round((now - new Date(existingRow.lastActionTimestamp)) / (1000 * 60 * 60 * 24))
        : null;
      const daysPart =
        daysSince !== null
          ? ' after ' + daysSince + ' day' + (daysSince === 1 ? '' : 's') + ' of silence'
          : '';
      await email.appendToConversationHistory(
        agentConfig,
        existingRow.rowIndex,
        'Re-engagement: lead returned via inbox' + daysPart
      );
    } else {
      const senderName = classification.name || getSenderDisplayName(msg.from || '');
      const now = getNowIso();
      await email.appendSheetRow(agentConfig, {
        leadId: senderAddr,
        name: senderName,
        phone: classification.phone || '',
        source: 'inbox',
        dateAdded: now.slice(0, 10),
        originalMessage: classification.inquiryMessage || msg.subject || '',
        status: 'new',
        followUpCount: '0',
        nextFollowUpDay: '',
        lastFollowUpDate: '',
        reserved: '',
        conversationHistory: buildIntakeLogEntry(classification),
        pendingQuestion: '',
        gmailThreadId: msg.threadId || '',
        aiEnabled: determineAiEnabledDefault(classification),
        // lastActionTimestamp intentionally omitted: that field's contract is
        // "last path action against this lead", and intake is a system event,
        // not an action. Writing it here triggered the orchestrator's per-lead
        // rate limit filter and blocked Reply Detection from same-cycle pickup
        // of first-touch leads.
        reminderSent: '',
        validationStatus: '',
        operatorEscalated: '',
        leadCategory: '',
      });
    }

    stats.leads++;
    if (firstTouchPendingId) {
      await gmail.applyMessageLabels(
        agentConfig,
        msg.messageId,
        [firstTouchPendingId],
        processingId ? [processingId] : []
      );
    }
    // Email is intentionally left unread so Reply Detection can pick it up
    // on the next orchestrator cycle as a first-touch message. The intaken
    // label and markRead will be applied by a downstream path on success.
    return;
  }

  // Noise branch: confidence threshold 0.85
  if (category === 'noise' && confidence >= 0.85) {
    if (noiseId) {
      await gmail.applyMessageLabels(
        agentConfig,
        msg.messageId,
        [noiseId],
        processingId ? [processingId] : []
      );
    }
    await gmail.markRead(agentConfig, msg.messageId);
    stats.noise++;
    return;
  }

  // business_correspondence (or low-confidence lead/noise):
  // Remove the processing label so the email appears untouched in the agent's inbox.
  // Do NOT mark read: the agent must see it as a normal unread message.
  if (processingId) {
    await gmail.applyMessageLabels(agentConfig, msg.messageId, [], [processingId]);
  }
  stats.businessCorrespondence++;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

async function runLeadIntake(agentConfig) {
  const agentId = agentConfig.agentId;
  const stats = { candidates: 0, leads: 0, noise: 0, businessCorrespondence: 0, errors: 0 };

  // Ensure labels exist (also warms the cache used by applyPreFilter)
  let labelMap;
  try {
    labelMap = await ensureLabelsExist(agentConfig);
  } catch (err) {
    console.error('[' + agentId + '] Lead Intake: ensureLabelsExist failed: ' + err.message);
    throw err;
  }

  // Fetch unread inbox emails
  let messages;
  try {
    messages = await gmail.fetchUnreadInboxEmails(agentConfig);
  } catch (err) {
    console.error('[' + agentId + '] Lead Intake: fetchUnreadInboxEmails failed: ' + err.message);
    throw err;
  }

  // Read Sheet once, before the pre-filter loop, so applyPreFilter can skip
  // known leads (column A) and processClassification can still use the same
  // rows for its own dedup check.
  let rows;
  try {
    rows = await email.readSheetRows(agentConfig);
  } catch (err) {
    console.error('[' + agentId + '] Lead Intake: readSheetRows failed: ' + err.message);
    throw err;
  }

  const preFilterCtx = {
    ownAddress: String(agentConfig.gmailAddress || '').trim().toLowerCase(),
    rows,
  };

  // Pre-filter with per-cycle thread and sender dedup
  const candidates = [];
  const seenThreads = new Set();
  const seenSenders = new Set();

  for (const msg of messages) {
    const filterResult = applyPreFilter(msg, labelMap, preFilterCtx);
    if (!filterResult.pass) {
      console.log(
        '[' + agentId + '] Lead Intake: pre-filter blocked ' + msg.messageId + ': ' + filterResult.reason
      );
      continue;
    }

    if (msg.threadId && seenThreads.has(msg.threadId)) {
      console.log('[' + agentId + '] Lead Intake: thread dedup blocked ' + msg.messageId);
      continue;
    }
    if (msg.threadId) seenThreads.add(msg.threadId);

    const senderAddr = getSenderEmail(msg.from || '');
    if (senderAddr && seenSenders.has(senderAddr)) {
      console.log('[' + agentId + '] Lead Intake: sender dedup blocked ' + msg.messageId + ' (' + senderAddr + ')');
      continue;
    }
    if (senderAddr) seenSenders.add(senderAddr);

    candidates.push(msg);
    if (candidates.length >= LEAD_INTAKE_MAX_PER_CYCLE) break;
  }

  stats.candidates = candidates.length;
  if (candidates.length === 0) return stats;

  // Label all candidates as agent-ai/processing (idempotency marker)
  const processingId = labelMap.get(LABEL_PROCESSING);
  if (processingId) {
    await Promise.all(
      candidates.map((msg) =>
        gmail.applyMessageLabels(agentConfig, msg.messageId, [processingId], []).catch((err) => {
          console.warn(
            '[' + agentId + '] Lead Intake: failed to label ' + msg.messageId + ' as processing: ' + err.message
          );
        })
      )
    );
  }

  // Classify and branch each candidate sequentially
  for (const msg of candidates) {
    let classification;
    try {
      const from = msg.from || '';
      classification = await callClassifier(
        agentConfig,
        msg.subject || '',
        msg.body || '',
        getSenderDisplayName(from),
        getSenderEmail(from)
      );
    } catch (err) {
      console.error(
        '[' + agentId + '] Lead Intake: classifier failed for ' + msg.messageId + ': ' + err.message
      );
      stats.errors++;
      continue;
    }

    try {
      await processClassification(agentConfig, msg, classification, rows, stats);
    } catch (err) {
      console.error(
        '[' + agentId + '] Lead Intake: processClassification failed for ' + msg.messageId + ': ' + err.message
      );
      stats.errors++;
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  runLeadIntake,
  transitionToIntaken,
  isNoiseSender,
  LEAD_INTAKE_MAX_PER_CYCLE,
  _internal: {
    applyPreFilter,
    isNoiseSender,
    parseClassifierResponse,
    buildIntakeLogEntry,
    getSenderEmail,
    getSenderDomain,
    processClassification,
    LABEL_PROCESSING,
    LABEL_INTAKEN,
    LABEL_NOISE,
    LABEL_FIRST_TOUCH_PENDING,
    CALENDAR_DOMAINS,
    transitionToIntaken,
  },
};
