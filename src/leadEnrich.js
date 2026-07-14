// src/leadEnrich.js
//
// Retrieves and filters an agent's Gmail history for ONE lead. Retrieval only:
// no Haiku, no summarization, no Sheet reads or writes. Callers pass the
// returned messages on to whatever summarization/landing step comes next.

const SCAN_MAX_MESSAGES = 500;

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Builds the Gmail search query for one lead's history. The parens around
// (from: OR to:) are load-bearing: without them Gmail's implicit AND binds
// tighter than OR, so the after: date bound would not apply to the from:
// branch. UTC components only, so the query is deterministic regardless of
// the host machine's timezone.
function buildScanQuery(leadEmail, now, yearsBack) {
  const sinceYear = now.getUTCFullYear() - yearsBack;
  const dateStr = `${sinceYear}/${pad2(now.getUTCMonth() + 1)}/${pad2(now.getUTCDate())}`;
  return `(from:${leadEmail} OR to:${leadEmail}) after:${dateStr}`;
}

async function scanLeadHistory(agentConfig, leadEmail, opts = {}) {
  const email = opts.email || require('./gmail');
  const leadIntake = opts.leadIntake || require('./leadIntake');
  const now = opts.now || new Date();
  const yearsBack = opts.yearsBack !== undefined ? opts.yearsBack : 5;

  const trimmedEmail = String(leadEmail || '').trim();
  if (!trimmedEmail) {
    throw new Error('scanLeadHistory requires a non-empty leadEmail');
  }

  const query = buildScanQuery(trimmedEmail, now, yearsBack);

  const ids = await email.searchMessages(agentConfig, query, SCAN_MAX_MESSAGES);
  const truncated = ids.length === SCAN_MAX_MESSAGES;
  const counts = { rawIds: ids.length, fetched: 0, filteredAsNoise: 0, kept: 0 };

  if (ids.length === 0) {
    return {
      email: trimmedEmail,
      query,
      found: false,
      messages: [],
      counts,
      truncated,
      note: 'no history found in Gmail',
    };
  }

  const kept = [];
  for (const id of ids) {
    let msg;
    try {
      msg = await email.fetchMessage(agentConfig, id);
    } catch (err) {
      continue;
    }
    counts.fetched++;

    const noiseResult = leadIntake.isNoiseSender(msg);
    if (noiseResult.pass) {
      kept.push(msg);
    } else {
      counts.filteredAsNoise++;
    }
  }

  kept.sort((a, b) => a.internalDate - b.internalDate);
  counts.kept = kept.length;

  const found = kept.length > 0;

  let note = '';
  if (!found) {
    note = counts.fetched > 0
      ? `all ${counts.fetched} messages filtered as noise`
      : 'no history found in Gmail';
  }
  if (truncated) {
    const truncationNote = `result set truncated at ${SCAN_MAX_MESSAGES} messages`;
    note = note ? `${note}; ${truncationNote}` : truncationNote;
  }

  return {
    email: trimmedEmail,
    query,
    found,
    messages: kept,
    counts,
    truncated,
    note,
  };
}

// ---------------------------------------------------------------------------
// summarizeLeadHistory: turns scanLeadHistory's messages into a distilled
// summary, an inferred status, a last-contact date, and a PROPOSED (not
// written) SOI flag. No Sheet reads or writes: this module never sees
// gmail.appendSheetRow / updateSheetRow, and takes no email/gmail dependency
// at all. Column T (leadCategory) is manual-only; the caller decides.
// ---------------------------------------------------------------------------

// First-guess threshold pending real-book data on how large lead threads
// actually get. Revisit once we have real usage patterns.
const SUMMARIZE_THRESHOLD = 20;

// Mirrors src/index.js's ALLOWED_STATUSES for column G, which is NOT exported
// from that module (hence the duplication here). PROJECT_STATE.md 3.3 only
// documents 8 of these; the actual code-level allowlist in src/index.js also
// includes 'in_conversation' and 'awaiting_agent_info'. This list follows the
// code, not the doc.
const STATUS_ALLOWLIST = [
  'new',
  'in_conversation',
  'awaiting_agent_info',
  'awaiting_agent',
  'awaiting_response',
  'warm',
  'HOT',
  'cold',
  'needs_review',
  'manual_handling',
];

function stripCodeFences(text) {
  return text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
}

function toIsoDate(internalDateMs) {
  return new Date(internalDateMs).toISOString().slice(0, 10);
}

function formatMessageEvidence(msg) {
  const date = msg.internalDate ? toIsoDate(msg.internalDate) : 'unknown date';
  const body = String(msg.body || '').trim().slice(0, 1000);
  return `[${date}] From: ${msg.from || ''} | To: ${msg.to || ''} | Subject: ${msg.subject || ''}\n${body}`;
}

// Distills one thread into a short plain-text digest. Used only in tiered
// mode, to compress a large history down to one evidence line per thread
// before the final summarization call. Plain text, not JSON: its only job is
// feeding the final call, not producing a Sheet-ready verdict.
function buildThreadDigestPrompt(threadMessages) {
  const system = `You distill one email thread between a real estate agent and a lead into a short factual digest for a later summarization step. Quote specific dates and phrases from the emails rather than only asserting. Note plainly if this thread alone does not establish something (e.g. a status change) rather than guessing. Do not use an em-dash (—) or a double hyphen (--) as a substitute for one. Return plain text only, no JSON, no markdown fences.`;
  const user = threadMessages.map(formatMessageEvidence).join('\n\n---\n\n');
  return { system, user };
}

// THE testable prompt builder referenced by the contract. Used for both the
// single-call (under-threshold) case, fed raw per-message evidence lines, and
// the tiered final call, fed per-thread digest strings instead.
function buildSummaryPrompt(evidenceLines, allowedStatuses) {
  const statusList = allowedStatuses.join(' | ');

  const system = `You are summarizing a real estate lead's email history for the agent's Sheet. Return ONLY a raw JSON object with this exact shape (no markdown fences, no preamble, no explanation outside the JSON):

{
  "summary": "<a few sentences for the agent>",
  "status": "<one of: ${statusList}>",
  "soi": <true or false>,
  "soiReason": "<why, or empty string if soi is false>"
}

Rules:
- The summary MUST quote specific evidence from the emails (dates, phrases) rather than only asserting a conclusion, so the agent can overrule a wrong guess at a glance.
- The summary MUST state plainly that this is email history only, and that phone or SMS contact with this lead is invisible to this summary.
- status MUST be exactly one of the allowed values listed above: ${statusList}. Do not invent a new value.
- soi must be true ONLY on clear evidence of a completed transaction (a closed deal) or a clearly personal relationship (family, friend, not a normal client relationship). soiReason must cite that specific evidence. When unsure, set soi to false.
- Do not use an em-dash (—) or a double hyphen (--) as a substitute for one, anywhere in the summary. Use commas or periods instead.`;

  const user = `Evidence:\n\n${evidenceLines.join('\n\n---\n\n')}`;

  return { system, user };
}

function parseSummaryResponse(text) {
  const cleaned = stripCodeFences(String(text || ''));
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error('summarizer response was not valid JSON: ' + cleaned.slice(0, 200));
  }
  return {
    summary: String(parsed.summary || ''),
    status: String(parsed.status || ''),
    soi: parsed.soi === true,
    soiReason: String(parsed.soiReason || ''),
  };
}

// Mirrors validateCategory's allowlist-check shape (src/claude.js), but falls
// back instead of throwing: an unrecognized status must never propagate to
// the Sheet, and a Haiku hiccup on this best-effort enrichment path should
// not blow up the caller.
function resolveStatus(status) {
  return STATUS_ALLOWLIST.includes(status) ? status : 'needs_review';
}

function groupMessagesByThread(messages) {
  const threadMap = new Map();
  for (const msg of messages) {
    const key = msg.threadId || msg.id;
    if (!threadMap.has(key)) threadMap.set(key, []);
    threadMap.get(key).push(msg);
  }
  const threads = [...threadMap.values()].map((threadMessages) =>
    [...threadMessages].sort((a, b) => a.internalDate - b.internalDate)
  );
  threads.sort((a, b) => a[0].internalDate - b[0].internalDate);
  return threads;
}

async function summarizeLeadHistory(scanResult, opts = {}) {
  const claude = opts.claude || require('./claude');

  if (!scanResult.found) {
    return {
      summary: scanResult.note,
      inferredStatus: 'needs_review',
      lastContactDate: '',
      proposedSoi: false,
      soiReason: '',
      tiered: false,
      threadCount: 0,
      messageCount: 0,
    };
  }

  const messages = scanResult.messages;
  const messageCount = messages.length;
  const lastContactDate = toIsoDate(Math.max(...messages.map((m) => m.internalDate || 0)));

  const threads = groupMessagesByThread(messages);
  const threadCount = threads.length;
  const tiered = messageCount > SUMMARIZE_THRESHOLD;

  let evidenceLines;
  if (!tiered) {
    evidenceLines = messages.map(formatMessageEvidence);
  } else {
    evidenceLines = [];
    for (const threadMessages of threads) {
      const { system, user } = buildThreadDigestPrompt(threadMessages);
      const digest = await claude.callRaw({ system, user });
      evidenceLines.push(String(digest || '').trim());
    }
  }

  const { system, user } = buildSummaryPrompt(evidenceLines, STATUS_ALLOWLIST);
  const rawResponse = await claude.callRaw({ system, user });
  const parsed = parseSummaryResponse(rawResponse);

  return {
    summary: parsed.summary,
    inferredStatus: resolveStatus(parsed.status),
    lastContactDate,
    proposedSoi: parsed.soi,
    soiReason: parsed.soiReason,
    tiered,
    threadCount,
    messageCount,
  };
}

module.exports = {
  scanLeadHistory,
  summarizeLeadHistory,
  SCAN_MAX_MESSAGES,
  SUMMARIZE_THRESHOLD,
  STATUS_ALLOWLIST,
  _internal: {
    buildScanQuery,
    buildSummaryPrompt,
    buildThreadDigestPrompt,
    parseSummaryResponse,
    resolveStatus,
    groupMessagesByThread,
  },
};
