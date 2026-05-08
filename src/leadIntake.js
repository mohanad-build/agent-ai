// src/leadIntake.js
//
// Lead Intake Tier 2: reads the agent's unread Gmail inbox, pre-filters,
// classifies via Claude Haiku, and routes each message to the correct branch.
//
// Branches:
//   lead (confidence >= 0.6)         -> append new Sheet row (aiEnabled=FALSE), or re-engagement log
//   noise (confidence >= 0.85)       -> apply noise label, mark read
//   business_correspondence (or low  -> remove processing label, leave unread so agent sees it normally
//     confidence anything else)
//
// Called by processAgent in src/index.js before the Sheet read.

const claude = require('./claude');
const gmail = require('./gmail');
const email = require('./email');
const prompts = require('./prompts');

const LEAD_INTAKE_MAX_PER_CYCLE = 20;
const LABEL_PROCESSING = 'agent-ai/processing';
const LABEL_INTAKEN = 'agent-ai/intaken';
const LABEL_NOISE = 'agent-ai/noise';
const CALENDAR_DOMAINS = new Set(['google.com', 'calendly.com', 'googleusercontent.com']);

// Map<agentId, Map<labelName, labelId>>, persists across runLeadIntake cycles
const labelIdCache = new Map();

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

// ---------------------------------------------------------------------------
// Label management
// ---------------------------------------------------------------------------

async function ensureLabelsExist(agentConfig) {
  const agentId = agentConfig.agentId;
  if (labelIdCache.has(agentId)) return labelIdCache.get(agentId);

  const labelNames = [LABEL_PROCESSING, LABEL_INTAKEN, LABEL_NOISE];
  const existingLabels = await gmail.listLabels(agentConfig);
  const existingMap = new Map(existingLabels.map((l) => [l.name, l.id]));

  const result = new Map();
  for (const name of labelNames) {
    if (existingMap.has(name)) {
      result.set(name, existingMap.get(name));
    } else {
      const created = await gmail.createLabel(agentConfig, name);
      result.set(name, created.id);
    }
  }

  labelIdCache.set(agentId, result);
  return result;
}

// ---------------------------------------------------------------------------
// Pre-filter
// ---------------------------------------------------------------------------

// Returns { pass: bool, reason: string }.
// Applied per-message before classification. Fast-fail, checks in order.
function applyPreFilter(msg, labelMap) {
  // Rule 1: Is a reply (In-Reply-To header set)
  if (msg.inReplyTo && String(msg.inReplyTo).trim()) {
    return { pass: false, reason: 'reply (In-Reply-To present)' };
  }

  // Rule 2: Sender is from a calendar-automation domain
  const senderEmail = getSenderEmail(msg.from || '');
  const domain = getSenderDomain(senderEmail);
  if (domain && CALENDAR_DOMAINS.has(domain)) {
    return { pass: false, reason: 'calendar domain: ' + domain };
  }

  // Rule 3: Empty body and trivially short subject
  const bodyText = String(msg.body || '').trim();
  const subjectText = String(msg.subject || '').trim();
  if (!bodyText && subjectText.length < 5) {
    return { pass: false, reason: 'empty body and short subject' };
  }

  // Rule 4: Already has an intake label (idempotency)
  const msgLabels = msg.labelIds || [];
  const processingId = labelMap && labelMap.get(LABEL_PROCESSING);
  const intakenId = labelMap && labelMap.get(LABEL_INTAKEN);
  const noiseId = labelMap && labelMap.get(LABEL_NOISE);
  for (const labelId of msgLabels) {
    if (
      (processingId && labelId === processingId) ||
      (intakenId && labelId === intakenId) ||
      (noiseId && labelId === noiseId)
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

  // Lead branch: confidence threshold 0.6
  if (category === 'lead' && confidence >= 0.6) {
    const senderAddr = getSenderEmail(msg.from || '');

    // Dedup: check if this sender already exists in the Sheet
    const existingRow = rows.find(
      (r) => String(r.leadId || '').trim().toLowerCase() === senderAddr
    );

    if (existingRow) {
      const now = new Date();
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
      const now = new Date().toISOString();
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
        conversationHistory: '',
        pendingQuestion: '',
        gmailThreadId: msg.threadId || '',
        aiEnabled: 'FALSE',
        lastActionTimestamp: now,
        reminderSent: '',
        validationStatus: '',
        operatorEscalated: '',
        leadCategory: '',
      });
    }

    stats.leads++;
    if (intakenId) {
      await gmail.applyMessageLabels(
        agentConfig,
        msg.messageId,
        [intakenId],
        processingId ? [processingId] : []
      );
    }
    await gmail.markRead(agentConfig, msg.messageId);
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

  // Pre-filter with per-cycle thread and sender dedup
  const candidates = [];
  const seenThreads = new Set();
  const seenSenders = new Set();

  for (const msg of messages) {
    const filterResult = applyPreFilter(msg, labelMap);
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

  // Read Sheet once for dedup checks inside processClassification
  let rows;
  try {
    rows = await email.readSheetRows(agentConfig);
  } catch (err) {
    console.error('[' + agentId + '] Lead Intake: readSheetRows failed: ' + err.message);
    throw err;
  }

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
  LEAD_INTAKE_MAX_PER_CYCLE,
  _internal: {
    applyPreFilter,
    parseClassifierResponse,
    getSenderEmail,
    getSenderDomain,
    processClassification,
    LABEL_PROCESSING,
    LABEL_INTAKEN,
    LABEL_NOISE,
    CALENDAR_DOMAINS,
    labelIdCache,
  },
};
