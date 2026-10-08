'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const { getNowDate }              = require('../time');
const { currentWeek }             = require('./cache');
const { readContentState, approveVersion, recordRegen, recordSwap } = require('./state');
const { readContentProfile }      = require('./profile');
const { renderReelScript }        = require('./renderReelScript');
const { renderInstagramCaption }  = require('./renderInstagramCaption');
const { renderBlogPost }          = require('./renderBlogPost');
const { callRaw, MODELS, stripCodeFences } = require('../claude');
const gmail                       = require('../gmail');
const email                       = require('../email');
const { parseAuthResults }        = require('../authResults');
const { getStorageRoot }          = require('../storagePaths');
const { clearLeadAndLogNote, parseCommandToken } = require('../webhook');
const { CALL_NOTE_LABEL, stripCallNote }         = require('../callNote');
const store                       = require('../transactions/store');
const proposals                   = require('../transactions/proposals');
const { confirmProposalSet }      = require('../transactions/confirmSet');
const { markWrongDeal }           = require('../transactions/wrongDeal');
const { formatRoles }             = require('../transactions/participants');
const { loadOperator }            = require('../operatorConfig');
const { plainTextToHtml, escapeHtml } = require('../plainTextHtml');
const { completeOne, completeChain, uncompleteRows } = require('../transactions/taps');
const { ASSISTANT_EMAIL } = require('../assistantAddress');
const { OPERATOR_CONTACT_EMAIL } = require('../operatorAddress');
const { TC_CLAIM_RE, parseTcCommand, catalogItemLabel, buildUndoSubject, buildUndoMailtoHref } = require('../transactions/tapLinks');

const ASSISTANT_AGENT_ID   = 'assistant';
function getTokenPath() { return path.join(getStorageRoot(), 'assistant.json'); }
function getAgentsDir()  { return getStorageRoot(); }
const REGEN_CAP            = 5;
const CONFIDENCE_THRESHOLD = 0.7;

// Unrecognized-sender reply gates (7.54.8): never authorize a verb, only
// decide whether a fixed "we don't know this address" notice goes out.
// One cooldown entry per address, keyed on the SUCCESSFUL send only -- a
// throw records nothing, so the next message from that sender gets a
// fresh attempt rather than being silently suppressed by a send that
// never actually reached anyone.
const REPLY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const cooldownByAddress = new Map();

const FROM_ADDRESS_RE = /^[^\s@<>,;]+@[^\s@<>,;]+$/;

const UNRECOGNIZED_REPLY_SUBJECT = 'GetKlosed: email address not recognized';
const UNRECOGNIZED_REPLY_BODY =
  "We couldn't match this email address to a GetKlosed account, so nothing was changed.\n\n" +
  "If you're a GetKlosed agent, please send it again from the email address your account is set up with. If you're not sure which address that is, contact mohanad@getklosed.ca.";

const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadAssistantConfig() {
  const agentData = JSON.parse(fs.readFileSync(getTokenPath(), 'utf8'));
  return {
    agentId:            ASSISTANT_AGENT_ID,
    gmailAddress:       ASSISTANT_EMAIL,
    googleRefreshToken: agentData.googleRefreshToken,
    ccEmails:           [],
    bccEmails:          [],
    provider:           'gmail',
  };
}

function extractEmailAddress(from) {
  const match = (from || '').match(/<([^>]+)>/);
  return (match ? match[1] : (from || '')).toLowerCase().trim();
}

async function _sendWithRetry(sendFn, label) {
  const delays = [10000, 60000];
  let attempts = 0;
  let lastError = null;
  for (let i = 0; i <= delays.length; i++) {
    attempts++;
    try {
      await sendFn();
      return { ok: true, attempts, lastError: null };
    } catch (err) {
      lastError = err;
      if (i < delays.length) {
        console.log(`[actionHandler:${label}] attempt ${attempts} failed: ${err.message}, retrying in ${delays[i]}ms`);
        await sleep(delays[i]);
      }
    }
  }
  console.log(`[actionHandler:${label}] exhausted after 3 attempts. last error: ${lastError.message}`);
  return { ok: false, attempts: 3, lastError };
}

// Returns _sendWithRetry's result ({ ok, attempts, lastError }) rather than
// discarding it: every existing caller uses this as a fire-and-forget
// statement and ignores the return value, but the tc-verb branch (below)
// needs to know whether the send actually landed, to keep its "send failed"
// path honest instead of silently swallowing it.
//
// html is optional: when absent, behaviour is exactly as before this
// parameter existed (plainTextToHtml(body)). Only DONE/RECEIPT's completed
// reply passes one, to carry a real Undo <a href="mailto:..."> that
// plainTextToHtml would otherwise escape into inert text.
async function sendConfirmation(assistantConfig, { to, subject, body, html }) {
  // No address in the label: it is printed by _sendWithRetry's log lines
  // (7.55.9, 7.57.3); a failure is attributable by position, since messages
  // are processed one at a time and each logs its messageId first.
  return _sendWithRetry(
    () => gmail.sendNewEmail(assistantConfig, { to, subject, body, html: html !== undefined ? html : plainTextToHtml(body), autoSubmitted: true }),
    'confirm'
  );
}

function getWeekIso() {
  return currentWeek(getNowDate());
}

function inferPieceType(pieceId) {
  return String(pieceId).startsWith('reel') ? 'reel' : 'blog';
}

async function renderPieceVersion(pieceId, angle, agentConfig, forceBlog) {
  const contentProfile = readContentProfile(agentConfig.agentId);
  const type = forceBlog ? 'blog' : inferPieceType(pieceId);
  if (type === 'blog') {
    const blog = await renderBlogPost({ angle, contentProfile });
    return { text: blog.text, generatedAt: blog.generatedAt, claudeCallId: null };
  }
  const script  = await renderReelScript({ angle, contentProfile });
  const caption = await renderInstagramCaption({ angle, contentProfile, reelScript: script.text });
  return {
    text:         script.text + '\n\n---\n\n' + caption.text,
    generatedAt:  script.generatedAt,
    claudeCallId: null,
  };
}

// ── Track 1 helpers ───────────────────────────────────────────────────────────

async function handleApprove(agentConfig, pieceId, assistantConfig, replyTo, origSubject) {
  const weekIso = getWeekIso();
  const state   = readContentState(agentConfig.agentId);
  const batch   = state.batches && state.batches[weekIso];
  const piece   = batch && batch.pieces && batch.pieces[pieceId];
  if (!piece) {
    await sendConfirmation(assistantConfig, {
      to: replyTo, subject: `Re: ${origSubject}`,
      body: `Could not find piece "${pieceId}" in the current batch. Please check and try again.`,
    });
    return;
  }
  const latestVersionId = piece.versions[piece.versions.length - 1].versionId;
  approveVersion(agentConfig.agentId, weekIso, pieceId, latestVersionId);
  await sendConfirmation(assistantConfig, {
    to: replyTo, subject: `Re: ${origSubject}`,
    body: `Done -- ${pieceId} approved (version ${latestVersionId}).`,
  });
}

async function handleRegen(agentConfig, pieceId, override, assistantConfig, replyTo, origSubject) {
  const weekIso = getWeekIso();
  const state   = readContentState(agentConfig.agentId);
  const batch   = state.batches && state.batches[weekIso];
  const piece   = batch && batch.pieces && batch.pieces[pieceId];
  if (!piece) {
    await sendConfirmation(assistantConfig, {
      to: replyTo, subject: `Re: ${origSubject}`,
      body: `Could not find piece "${pieceId}" in the current batch. Please check and try again.`,
    });
    return;
  }
  if (!override && piece.regenCount >= REGEN_CAP) {
    await sendConfirmation(assistantConfig, {
      to: replyTo, subject: `Re: ${origSubject}`,
      body: `${pieceId} has already been regenerated ${piece.regenCount} times this week (cap: ${REGEN_CAP}). Reply with REGEN OVERRIDE ${pieceId} to bypass.`,
    });
    return;
  }
  const angle = (batch.availableAngles || []).find(a => a.id === piece.angleId);
  if (!angle) {
    await sendConfirmation(assistantConfig, {
      to: replyTo, subject: `Re: ${origSubject}`,
      body: `Could not find angle data for "${pieceId}". Unable to regenerate.`,
    });
    return;
  }
  const newVersion = await renderPieceVersion(pieceId, angle, agentConfig, false);
  recordRegen(agentConfig.agentId, weekIso, pieceId, newVersion);
  await sendConfirmation(assistantConfig, {
    to: replyTo, subject: `Re: ${origSubject}`,
    body: `Done -- ${pieceId} regenerated.\n\n${newVersion.text}`,
  });
}

async function handleSwap(agentConfig, pieceId, angleId, forceBlog, assistantConfig, replyTo, origSubject) {
  const weekIso = getWeekIso();
  const state   = readContentState(agentConfig.agentId);
  const batch   = state.batches && state.batches[weekIso];
  if (!batch || !batch.pieces || !batch.pieces[pieceId]) {
    await sendConfirmation(assistantConfig, {
      to: replyTo, subject: `Re: ${origSubject}`,
      body: `Could not find piece "${pieceId}" in the current batch. Please check and try again.`,
    });
    return;
  }
  const angle = (batch.availableAngles || []).find(a => a.id === angleId);
  if (!angle) {
    await sendConfirmation(assistantConfig, {
      to: replyTo, subject: `Re: ${origSubject}`,
      body: `Could not find angle "${angleId}" in available angles. Please check and try again.`,
    });
    return;
  }
  const newVersion   = await renderPieceVersion(pieceId, angle, agentConfig, forceBlog);
  const newAngleData = { angleId: angle.id, themeTag: angle.themeTag, forbidsRateAdvice: angle.forbidsRateAdvice };
  recordSwap(agentConfig.agentId, weekIso, pieceId, newAngleData, newVersion);
  await sendConfirmation(assistantConfig, {
    to: replyTo, subject: `Re: ${origSubject}`,
    body: `Done -- ${pieceId} swapped to angle ${angleId}.\n\n${newVersion.text}`,
  });
}

async function handleTrack1(agentConfig, subject, assistantConfig, replyTo) {
  const s = subject.trim();

  const approveM = s.match(/^APPROVE\s+(\S+)$/i);
  if (approveM) {
    await handleApprove(agentConfig, approveM[1], assistantConfig, replyTo, s);
    return;
  }

  const regenOverrideM = s.match(/^REGEN\s+OVERRIDE\s+(\S+)$/i);
  if (regenOverrideM) {
    await handleRegen(agentConfig, regenOverrideM[1], true, assistantConfig, replyTo, s);
    return;
  }

  const regenM = s.match(/^REGEN\s+(\S+)$/i);
  if (regenM) {
    await handleRegen(agentConfig, regenM[1], false, assistantConfig, replyTo, s);
    return;
  }

  const swapBlogM = s.match(/^SWAP\s+(\S+)\s+TO\s+(\S+)\s+AS\s+BLOG$/i);
  if (swapBlogM) {
    await handleSwap(agentConfig, swapBlogM[1], swapBlogM[2], true, assistantConfig, replyTo, s);
    return;
  }

  const swapM = s.match(/^SWAP\s+(\S+)\s+TO\s+(\S+)$/i);
  if (swapM) {
    await handleSwap(agentConfig, swapM[1], swapM[2], false, assistantConfig, replyTo, s);
    return;
  }

  await sendConfirmation(assistantConfig, {
    to: replyTo, subject: `Re: ${s}`,
    body: `Sorry, I didn't understand that action. Valid formats: APPROVE <pieceId>, REGEN <pieceId>, SWAP <pieceId> TO <angleId>.`,
  });
}

// ── Track 2 ───────────────────────────────────────────────────────────────────

const TRACK2_SYSTEM = `You classify real-estate agent commands. Return ONLY a JSON object:
{
  "intent": "pause_followups | mark_soi | pause_account | resume_account | send_digest | unknown",
  "leadName": "<string or null>",
  "confidence": 0.0
}

Intent meanings:
- pause_followups: agent wants to stop follow-ups for a specific lead
- mark_soi: agent wants to mark a lead as sphere of influence
- pause_account: agent wants to pause their whole account
- resume_account: agent wants to resume their account
- send_digest: agent wants today's digest sent now
- unknown: anything else

Return only the JSON object. No preamble, no markdown, no explanation.`;

const UNKNOWN_REPLY = `Sorry, I didn't understand that request. You can ask me to: pause follow-ups for a lead, mark a lead as SOI, pause or resume your account, or send today's digest.`;

async function handleTrack2(agentConfig, body, assistantConfig, replyTo, origSubject) {
  const agentId = agentConfig.agentId;

  let parsed;
  try {
    const raw = await callRaw({
      system:    TRACK2_SYSTEM,
      user:      body,
      model:     MODELS.CATEGORIZATION,
      maxTokens: 200,
    });
    parsed = JSON.parse(stripCodeFences(raw));
  } catch (err) {
    console.log(`[actionHandler] Haiku classification failed for ${agentId}: ${err.message}`);
    await sendConfirmation(assistantConfig, {
      to: replyTo, subject: `Re: ${origSubject}`, body: UNKNOWN_REPLY,
    });
    return;
  }

  const { intent, leadName, confidence } = parsed;

  if (!confidence || confidence < CONFIDENCE_THRESHOLD || intent === 'unknown') {
    await sendConfirmation(assistantConfig, {
      to: replyTo, subject: `Re: ${origSubject}`, body: UNKNOWN_REPLY,
    });
    return;
  }

  if (intent === 'pause_account') {
    const configPath = path.join(getAgentsDir(), `${agentId}.json`);
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    cfg.isActive = false;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    await sendConfirmation(assistantConfig, {
      to: replyTo, subject: `Re: ${origSubject}`,
      body: `Done -- your account is paused. No automated actions will run until you resume.`,
    });
    return;
  }

  if (intent === 'resume_account') {
    const configPath = path.join(getAgentsDir(), `${agentId}.json`);
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    cfg.isActive = true;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    await sendConfirmation(assistantConfig, {
      to: replyTo, subject: `Re: ${origSubject}`,
      body: `Done -- your account is active again.`,
    });
    return;
  }

  if (intent === 'send_digest') {
    // Deferred require avoids circular dependency at module load time.
    const { maybeRunDailyDigest } = require('../index');
    await maybeRunDailyDigest(agentConfig, { force: true });
    await sendConfirmation(assistantConfig, {
      to: replyTo, subject: `Re: ${origSubject}`,
      body: `Sending your digest now.`,
    });
    return;
  }

  // Lead-specific: pause_followups, mark_soi
  const rows      = await email.readSheetRows(agentConfig);
  const nameLower = (leadName || '').toLowerCase();

  const exactMatches   = [];
  const partialMatches = [];

  rows.forEach((row, i) => {
    const rowName = (row[1] || '').toLowerCase();
    if (rowName === nameLower) {
      exactMatches.push({ row, rowIndex: i + 2 });
    } else if (nameLower && rowName.includes(nameLower)) {
      partialMatches.push({ row, rowIndex: i + 2 });
    }
  });

  const matches = exactMatches.length > 0 ? exactMatches : partialMatches;

  if (matches.length === 0) {
    await sendConfirmation(assistantConfig, {
      to: replyTo, subject: `Re: ${origSubject}`,
      body: `No lead found matching '${leadName}'. Please check the name and try again.`,
    });
    return;
  }

  if (matches.length > 1) {
    const names = matches.map(m => m.row[1]).join(', ');
    await sendConfirmation(assistantConfig, {
      to: replyTo, subject: `Re: ${origSubject}`,
      body: `Found ${matches.length} leads matching '${leadName}': ${names}. Please be more specific.`,
    });
    return;
  }

  const { row, rowIndex } = matches[0];
  const matchedName = row[1];

  if (intent === 'pause_followups') {
    await email.updateSheetRow(agentConfig, rowIndex, { aiEnabled: 'FALSE' });
    await sendConfirmation(assistantConfig, {
      to: replyTo, subject: `Re: ${origSubject}`,
      body: `Done -- follow-ups paused for ${matchedName}. Their AI Enabled flag is now off.`,
    });
  } else {
    await email.updateSheetRow(agentConfig, rowIndex, { leadCategory: 'soi' });
    await sendConfirmation(assistantConfig, {
      to: replyTo, subject: `Re: ${origSubject}`,
      body: `Done -- ${matchedName} marked as SOI. They'll be excluded from automated sequences.`,
    });
  }
}

// ── Track TC (CONFIRM / REJECT / WRONGDEAL / DONE / RECEIPT / UNDO) ───────────

const TC_GENERIC_ERROR_BODY = 'Nothing was changed. Something went wrong on our end. Mo has been told and will follow up.';

// Used only when a write outcome (confirmed / wrong_deal_recorded /
// rejected / completed / uncompleted) happened but DESCRIBE then failed to
// build the real reply: the write is a fact, so the reply must stay
// truthful ("Done."/"Got it.") rather than fall back to the generic error
// wording.
const TC_WRITE_OUTCOME_FALLBACK = {
  CONFIRM:   'Done. The people were added to the deal.',
  WRONGDEAL: 'Got it. The document is marked as not belonging to this deal, and no one from it was added.',
  REJECT:    "Done. That person won't be added to the deal.",
  DONE:      'Done. The item was marked complete.',
  RECEIPT:   'Done. The deposit was marked complete.',
  UNDO:      'Done. Those items are back on the checklist.',
};

// transaction.participants[id].emails are plain STRINGS (participants.js
// buildParticipant); transaction.participantProposals[..].members[id].emails
// are OBJECTS ({ address, scope?, from }, proposals.js buildMemberEntry).
// These two lookups deliberately don't share a helper because of that shape
// difference.
function describeParticipant(transaction, participantId) {
  const participant = transaction.participants[participantId];
  const label = participant.name || (participant.emails && participant.emails[0]) || 'someone with no name recorded';
  const roles = formatRoles(participant.roles);
  return roles ? `${label} (${roles})` : label;
}

function describeMember(transaction, setId, memberId) {
  const member = transaction.participantProposals[setId].members[memberId];
  return member.name || (member.emails && member.emails[0] && member.emails[0].address) || 'someone with no name recorded';
}

function buildConfirmReply(outcome, transaction, writeResult) {
  const address = transaction.address;
  switch (outcome) {
    case 'confirmed': {
      const list = Object.values(writeResult.participantIds)
        .map((participantId) => describeParticipant(transaction, participantId))
        .join(', ');
      return { body: `Done. Added to ${address}: ${list}. If anyone here is wrong, email Mo at ${OPERATOR_CONTACT_EMAIL}.`, noted: false };
    }
    case 'already_confirmed':
      return { body: `Already done. These people were added to ${address} earlier, so nothing was changed.`, noted: false };
    case 'set_discarded':
      return { body: `Nothing was changed. This group was marked as the wrong deal for ${address} earlier, so no one was added. Mo has been told and will follow up.`, noted: true };
    case 'filing_rejected':
      return { body: `Nothing was changed. The document these people came from was marked as not belonging to ${address}, so no one was added. Mo has been told and will follow up.`, noted: true };
    default:
      throw new Error(`buildConfirmReply: unexpected outcome ${outcome}`);
  }
}

function buildWrongDealReply(outcome, transaction) {
  const address = transaction.address;
  switch (outcome) {
    case 'wrong_deal_recorded':
      return { body: `Got it. This document is marked as not belonging to ${address}, and no one from it was added.`, noted: false };
    case 'already_discarded':
      return { body: `Already done. This was marked as the wrong deal earlier, so nothing was changed.`, noted: false };
    case 'set_confirmed':
      return { body: `Nothing was changed. These people were already added to ${address}. Mo has been told and will sort it out with you.`, noted: true };
    case 'filing_confirmed':
      return { body: `Nothing was changed. This document was already confirmed as belonging to ${address}. Mo has been told and will follow up.`, noted: true };
    default:
      throw new Error(`buildWrongDealReply: unexpected outcome ${outcome}`);
  }
}

function buildRejectReply(outcome, transaction, setId, memberId) {
  const address = transaction.address;
  const name    = describeMember(transaction, setId, memberId);
  switch (outcome) {
    case 'rejected':
      return { body: `Done. ${name} won't be added to ${address}.`, noted: false };
    case 'already_rejected':
      return { body: `Already done. ${name} was removed earlier, so nothing was changed.`, noted: false };
    case 'set_closed': {
      const setStatus = transaction.participantProposals[setId].status;
      if (setStatus === 'confirmed') {
        return { body: `Nothing was changed. ${name} was already added to ${address}. Mo has been told and will sort it out with you.`, noted: true };
      }
      if (setStatus === 'discarded') {
        return { body: `Nothing was changed. This group was already marked as the wrong deal for ${address}, so ${name} was never added.`, noted: false };
      }
      return { body: TC_GENERIC_ERROR_BODY, noted: true };
    }
    default:
      throw new Error(`buildRejectReply: unexpected outcome ${outcome}`);
  }
}

// No exported helper turns an ISO instant into a human date in a timezone
// (calendarDate.js works in calendar dates, not instants); this mirrors
// digest.js's formatDailyDate/formatWeeklyDate pattern locally.
function formatCompletedDate(isoString, timezone) {
  const tz = timezone || 'America/Toronto';
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: tz }).format(new Date(isoString));
}

// Plain-text fallback line every completed DONE/RECEIPT reply ends with.
// The html part (buildUndoLinkHtml) replaces this line with a real link;
// this text is what a plain-text-only reader sees instead.
function undoPlainTextLine(transactionId, itemIds) {
  return `Tapped by mistake? Email ${ASSISTANT_EMAIL} with the subject: ${buildUndoSubject(transactionId, itemIds)}`;
}

// Styled like digest.js's calledAffordanceHtml: a muted-grey inline link,
// not a button. The href is escaped the same way digest.js escapes its own
// mailtoHref; the visible label is a literal, not interpolated.
function undoLinkHtml(transactionId, itemIds) {
  const href = escapeHtml(buildUndoMailtoHref(transactionId, itemIds));
  return `<a href="${href}" style="color:#666666;">Tapped by mistake? Undo</a>`;
}

// Shared by DONE, RECEIPT and UNDO: the wording only depends on address and
// state, never on which verb refused. Any state outside this switch is a
// programmer error -- states.isTerminal (already true by construction here)
// only ever reports one of these three across every deal and listing type
// (src/transactions/states.js).
function dealClosedReplyBody(transaction) {
  const address = transaction.address;
  switch (transaction.state) {
    case 'closed':
      return `Nothing was changed. ${address} is closed.`;
    case 'collapsed':
      return `Nothing was changed. ${address} fell through.`;
    case 'terminated':
      return `Nothing was changed. The listing for ${address} has ended.`;
    default:
      throw new Error(`dealClosedReplyBody: unexpected terminal state '${transaction.state}'`);
  }
}

function unknownItemReplyBody(transaction) {
  return `Nothing was changed. We couldn't find that item on ${transaction.address}. Mo has been told and will follow up.`;
}

function buildDoneReply(outcome, transaction, writeResult, transactionId, itemId, timezone) {
  const address = transaction.address;
  switch (outcome) {
    case 'deal_closed':
      return { body: dealClosedReplyBody(transaction), noted: false };
    case 'unknown_item':
      return { body: unknownItemReplyBody(transaction), noted: true };
    case 'not_required':
      return { body: `Nothing was changed. ${catalogItemLabel(transaction.type, itemId)} isn't on the checklist for ${address} right now.`, noted: false };
    case 'already_complete':
      return {
        body: `${catalogItemLabel(transaction.type, itemId)} for ${address}. Already marked done on ${formatCompletedDate(writeResult.completedAt, timezone)}.`,
        noted: false,
      };
    case 'completed': {
      const labels = writeResult.itemIds.map((id) => catalogItemLabel(transaction.type, id)).join(', ');
      const sentence = `Done. Marked complete for ${address}: ${labels}.`;
      return {
        body: `${sentence}\n\n${undoPlainTextLine(transactionId, writeResult.itemIds)}`,
        html: `${plainTextToHtml(sentence)}<br><br>${undoLinkHtml(transactionId, writeResult.itemIds)}`,
        noted: false,
      };
    }
    default:
      throw new Error(`buildDoneReply: unexpected outcome ${outcome}`);
  }
}

function buildReceiptReply(outcome, transaction, writeResult, transactionId, receiptItemId, timezone) {
  const address = transaction.address;
  switch (outcome) {
    case 'deal_closed':
      return { body: dealClosedReplyBody(transaction), noted: false };
    case 'unknown_item':
      return { body: unknownItemReplyBody(transaction), noted: true };
    case 'not_required':
      return { body: `Nothing was changed. ${catalogItemLabel(transaction.type, receiptItemId)} isn't on the checklist for ${address} right now.`, noted: false };
    case 'already_complete':
      return {
        body: `${catalogItemLabel(transaction.type, receiptItemId)} for ${address}. Already marked done on ${formatCompletedDate(writeResult.completedAt, timezone)}.`,
        noted: false,
      };
    case 'completed': {
      const labels = writeResult.itemIds.map((id) => catalogItemLabel(transaction.type, id)).join(', ');
      const sentence = `Done. Marked complete for ${address}: ${labels}.`;
      return {
        body: `${sentence}\n\n${undoPlainTextLine(transactionId, writeResult.itemIds)}`,
        html: `${plainTextToHtml(sentence)}<br><br>${undoLinkHtml(transactionId, writeResult.itemIds)}`,
        noted: false,
      };
    }
    default:
      throw new Error(`buildReceiptReply: unexpected outcome ${outcome}`);
  }
}

function buildUndoReply(outcome, transaction, writeResult) {
  const address = transaction.address;
  switch (outcome) {
    case 'deal_closed':
      return { body: dealClosedReplyBody(transaction), noted: false };
    case 'unknown_item':
      return { body: unknownItemReplyBody(transaction), noted: true };
    case 'nothing_to_undo':
      return { body: `Nothing was changed. None of those were marked done for ${address}.`, noted: false };
    case 'uncompleted': {
      const undoneLabels = writeResult.itemIds.map((id) => catalogItemLabel(transaction.type, id)).join(', ');
      let body = `Done. Back on the checklist for ${address}: ${undoneLabels}.`;
      writeResult.skipped.forEach((id) => {
        body += ` ${catalogItemLabel(transaction.type, id)} wasn't marked done, so nothing changed there.`;
      });
      return { body, noted: false };
    }
    default:
      throw new Error(`buildUndoReply: unexpected outcome ${outcome}`);
  }
}

function buildTcReply(verb, outcome, transaction, writeResult, parsed, timezone) {
  if (verb === 'CONFIRM')   return buildConfirmReply(outcome, transaction, writeResult);
  if (verb === 'WRONGDEAL') return buildWrongDealReply(outcome, transaction);
  if (verb === 'REJECT')    return buildRejectReply(outcome, transaction, parsed.setId, parsed.memberId);
  if (verb === 'DONE')      return buildDoneReply(outcome, transaction, writeResult, parsed.transactionId, parsed.itemId, timezone);
  if (verb === 'RECEIPT')   return buildReceiptReply(outcome, transaction, writeResult, parsed.transactionId, parsed.receiptItemId, timezone);
  return buildUndoReply(outcome, transaction, writeResult);
}

// Best-effort, IDs only (no names, no email addresses). Runs only after the
// agent's own reply has already been sent successfully, so nothing in here
// can change what the agent was told.
async function sendTcOperatorNote(agentConfig, msg, assistantConfig, { verb, transactionId, setId, memberId, itemIds, outcome, noteErrorMessage }) {
  try {
    const operator = loadOperator(agentConfig.operatorId);
    if (!operator || !operator.operatorEmail) {
      throw new Error('operator config missing operatorEmail');
    }

    const lines = [
      `agent: ${agentConfig.agentId}`,
      `messageId: ${msg.messageId}`,
      `verb: ${verb || '-'}`,
      `transactionId: ${transactionId || '-'}`,
      `setId: ${setId || '-'}`,
    ];
    if (memberId) lines.push(`memberId: ${memberId}`);
    // DONE/RECEIPT/UNDO only: the tapped item id(s), exactly as parsed from
    // the subject -- for UNDO, every token before uncompleteRows' own
    // dedup, so the note matches what the agent actually typed.
    if (itemIds) lines.push(`item: ${itemIds.join(' ')}`);
    lines.push(`outcome: ${outcome}`);
    if (noteErrorMessage) lines.push(`error: ${noteErrorMessage}`);

    const sendResult = await sendConfirmation(assistantConfig, {
      to:      operator.operatorEmail,
      subject: 'GetKlosed: agent request needs a look',
      body:    lines.join('\n'),
    });
    if (!sendResult.ok) {
      console.log(`[actionHandler] operator note send failed messageId=${msg.messageId}: ${sendResult.lastError && sendResult.lastError.message}`);
    }
  } catch (err) {
    console.log(`[actionHandler] failed to send operator note messageId=${msg.messageId}: ${err.message}`);
  }
}

// Sends the agent's reply and, when noted, the operator note, then logs.
// A failed reply send no longer aborts the note: the agent not hearing back
// is exactly the case where Mo most needs to know, so NOTE still runs
// regardless of REPLY's outcome.
async function finishTcVerb(agentConfig, msg, assistantConfig, replyTo, subject, opts) {
  const { verb, transactionId, setId, memberId, itemIds, outcome, body, html, noted, noteErrorMessage } = opts;

  const sendResult = await sendConfirmation(assistantConfig, { to: replyTo, subject: 'Re: ' + subject, body, html });
  const replied = sendResult.ok;
  if (!replied) {
    console.log(`[actionHandler] tc-verb reply send failed messageId=${msg.messageId}: ${sendResult.lastError && sendResult.lastError.message}`);
  }

  if (noted) {
    await sendTcOperatorNote(agentConfig, msg, assistantConfig, { verb, transactionId, setId, memberId, itemIds, outcome, noteErrorMessage });
  }

  console.log(`[tc-verb] agent=${agentConfig.agentId} messageId=${msg.messageId} verb=${verb || '-'} outcome=${outcome} noted=${noted} replied=${replied}`);
}

// gmail.js turns a missing internalDate into 0 (fetchUnreadInboxEmails);
// completedAt (DONE, RECEIPT) is when the agent said it was done, so 0 is
// never trusted as that date. The event's own at stays processing time
// regardless (point A, docs/designs/done-verb.md), matching CONFIRM.
function resolveCompletedAt(msg, now) {
  if (msg.internalDate > 0) {
    return new Date(msg.internalDate).toISOString();
  }
  console.log(`[tc-verb] messageId=${msg.messageId} missing internalDate, using processing time for completedAt`);
  return now.toISOString();
}

// WRITE: composition called synchronously, its save is the last throwable
// step. DESCRIBE: one immediate re-read, no await between the write and
// this read. REPLY/NOTE: finishTcVerb. Every phase here handles its own
// errors so a failure after a successful write never produces the
// pre-existing catch-all's "something went wrong" reply, which would be
// false at that point.
async function handleTcVerb(agentConfig, msg, subject, assistantConfig, replyTo) {
  const parsed = parseTcCommand(subject);

  if (!parsed) {
    await finishTcVerb(agentConfig, msg, assistantConfig, replyTo, subject, {
      verb: null, transactionId: null, setId: null, memberId: null,
      outcome: 'parse_failure',
      body: "Nothing was changed. We couldn't read that request. Mo has been told and will follow up.",
      noted: true,
      noteErrorMessage: null,
    });
    return;
  }

  const { verb, transactionId, setId, memberId, itemId, receiptItemId, itemIds } = parsed;
  const now = new Date();
  const at  = now.toISOString();

  // DONE/RECEIPT: the one tapped id, wrapped so the note line and the
  // reply-building label lookups share one shape. UNDO: itemIds exactly as
  // parsed (parseTcCommand never dedups), so the note shows every id the
  // agent actually typed. undefined for CONFIRM/REJECT/WRONGDEAL, whose
  // notes are unchanged.
  const noteItemIds = itemId ? [itemId] : receiptItemId ? [receiptItemId] : itemIds;

  let writeResult = null;
  let writeError  = null;
  try {
    if (verb === 'CONFIRM') {
      writeResult = confirmProposalSet(agentConfig.agentId, transactionId, setId, { now });
    } else if (verb === 'WRONGDEAL') {
      writeResult = markWrongDeal(agentConfig.agentId, transactionId, setId, { now });
    } else if (verb === 'REJECT') {
      writeResult = proposals.rejectProposalMember(
        agentConfig.agentId, transactionId, setId, memberId,
        { now, at, actor: 'agent' }
      );
    } else if (verb === 'DONE') {
      writeResult = completeOne(agentConfig.agentId, transactionId, itemId, { at, completedAt: resolveCompletedAt(msg, now), now });
    } else if (verb === 'RECEIPT') {
      writeResult = completeChain(agentConfig.agentId, transactionId, receiptItemId, { at, completedAt: resolveCompletedAt(msg, now), now });
    } else {
      writeResult = uncompleteRows(agentConfig.agentId, transactionId, itemIds, { at, now });
    }
  } catch (err) {
    writeError = err;
  }

  if (writeError) {
    await finishTcVerb(agentConfig, msg, assistantConfig, replyTo, subject, {
      verb, transactionId, setId, memberId, itemIds: noteItemIds,
      outcome: 'error',
      body: TC_GENERIC_ERROR_BODY,
      noted: true,
      noteErrorMessage: writeError.message,
    });
    return;
  }

  const outcome = writeResult.outcome;
  const isWriteOutcome =
    (verb === 'CONFIRM'   && outcome === 'confirmed') ||
    (verb === 'WRONGDEAL' && outcome === 'wrong_deal_recorded') ||
    (verb === 'REJECT'    && outcome === 'rejected') ||
    (verb === 'DONE'      && outcome === 'completed') ||
    (verb === 'RECEIPT'   && outcome === 'completed') ||
    (verb === 'UNDO'      && outcome === 'uncompleted');

  let body;
  let html;
  let noted;
  let noteErrorMessage = null;

  if (outcome === 'transaction_not_found' || outcome === 'set_not_found') {
    body  = "Nothing was changed. We couldn't find that deal. Mo has been told and will follow up.";
    noted = true;
  } else {
    try {
      const transaction = store.readTransaction(agentConfig.agentId, transactionId);
      if (transaction === null) {
        throw new Error(`readTransaction returned null for ${transactionId}`);
      }
      const built = buildTcReply(verb, outcome, transaction, writeResult, parsed, agentConfig.timezone);
      body  = built.body;
      html  = built.html;
      noted = built.noted;
    } catch (describeErr) {
      // DONE/RECEIPT: decision 3 is every confirmation reply carries the
      // Undo, fallback included. writeResult (the composition's own return
      // value, from before this describe-read ever ran) already has
      // itemIds, so this needs no re-read of the transaction that just
      // failed to read cleanly. UNDO's fallback carries no link, matching
      // its normal reply.
      if (isWriteOutcome && (verb === 'DONE' || verb === 'RECEIPT')) {
        const sentence = TC_WRITE_OUTCOME_FALLBACK[verb];
        body = `${sentence}\n\n${undoPlainTextLine(transactionId, writeResult.itemIds)}`;
        html = `${plainTextToHtml(sentence)}<br><br>${undoLinkHtml(transactionId, writeResult.itemIds)}`;
      } else {
        body = isWriteOutcome ? TC_WRITE_OUTCOME_FALLBACK[verb] : TC_GENERIC_ERROR_BODY;
      }
      noted = true;
      noteErrorMessage = `describe_failed: ${describeErr.message}`;
    }
  }

  await finishTcVerb(agentConfig, msg, assistantConfig, replyTo, subject, {
    verb, transactionId, setId, memberId, itemIds: noteItemIds, outcome, body, html, noted, noteErrorMessage,
  });
}

// ── Per-message processor ─────────────────────────────────────────────────────

async function processEmail(msg, allAgentConfigs, assistantConfig) {
  const fromEmail = extractEmailAddress(msg.from || '');
  const agentConfig = allAgentConfigs.find(c =>
    (c.gmailAddress || '').toLowerCase().trim() === fromEmail
  );

  const a = msg.authResults || parseAuthResults(undefined);
  console.log(`[auth-results] messageId=${msg.messageId} recognized=${!!agentConfig} trusted=${a.trusted} reason=${a.reason} dmarc=${a.dmarc || '-'} dkim=${a.dkim || '-'} spf=${a.spf || '-'} fromDomain=${a.fromDomain || '-'}`);

  if (!agentConfig) {
    console.log(`[actionHandler] unrecognized sender messageId=${msg.messageId}`);

    let decision = 'skipped';
    let reason = null;

    // Absent automation info is treated as a gate FAILURE, not a pass:
    // unlike authResults below (whose own safe default already reads as
    // untrusted), there is no safe stand-in for "we don't know whether
    // this looked automated" -- not knowing must not read as "not
    // automated". So this checks msg.automation directly, never a
    // detectAutomated(undefined) fallback, which would flip the polarity.
    if (!msg.automation || msg.automation.automated !== false) {
      reason = 'automated';
    } else if (a.trusted !== true) {
      reason = 'untrusted';
    } else if (a.dmarc !== 'pass') {
      reason = 'dmarc_not_pass';
    } else if (!FROM_ADDRESS_RE.test(fromEmail)) {
      reason = 'invalid_address';
    } else if (fromEmail.slice(fromEmail.indexOf('@') + 1) !== a.fromDomain) {
      reason = 'domain_mismatch';
    } else if (
      cooldownByAddress.has(fromEmail) &&
      getNowDate().getTime() - cooldownByAddress.get(fromEmail) < REPLY_COOLDOWN_MS
    ) {
      reason = 'cooldown';
    }

    if (reason === null) {
      try {
        await gmail.sendNewEmail(assistantConfig, {
          to:      fromEmail,
          subject: UNRECOGNIZED_REPLY_SUBJECT,
          body:    UNRECOGNIZED_REPLY_BODY,
          html:    plainTextToHtml(UNRECOGNIZED_REPLY_BODY),
          autoSubmitted: true,
        });
        cooldownByAddress.set(fromEmail, getNowDate().getTime());
        decision = 'sent';
      } catch (err) {
        reason = 'send_failed';
      }
    }

    console.log(`[unrecognized-reply] messageId=${msg.messageId} decision=${decision} reason=${reason || '-'}`);

    try {
      await gmail.markRead(assistantConfig, msg.messageId);
    } catch (err) {
      console.log(`[actionHandler] failed to mark ${msg.messageId} read: ${err.message}`);
    }
    return;
  }

  const subject     = (msg.subject || '').trim();
  const isTrack1    = /^(APPROVE|REGEN|SWAP)\b/i.test(subject);
  const replyTo     = agentConfig.gmailAddress;
  const calledMatch = subject.match(/^\s*CALLED\s+(\S+)/i);
  const tcClaimed   = TC_CLAIM_RE.test(subject);

  try {
    if (calledMatch) {
      const parsed = parseCommandToken(calledMatch[1]);
      if (!parsed) {
        const sendResult = await sendConfirmation(assistantConfig, {
          to: replyTo, subject: 'Re: ' + subject,
          body: 'Could not read the lead for that CALLED command. Reply CALLED <lead email>.',
        });
        if (!sendResult.ok) {
          console.log(`[actionHandler] reply send failed messageId=${msg.messageId} context=called-parse`);
        }
      } else {
        const note = stripCallNote(msg.body || '');
        const result = await clearLeadAndLogNote(agentConfig, parsed, note, 'email command');
        let body;
        if (result.ok) {
          body = 'Cleared ' + result.matchedRow.name + ' (' + result.matchedRow.leadId + ').' + (note ? ' Note saved.' : '');
        } else if (result.reason === 'not_found') {
          body = 'Could not find a lead for ' + calledMatch[1] + '.';
        } else {
          body = 'Something went wrong clearing that lead. Try again in a minute.';
        }
        const sendResult = await sendConfirmation(assistantConfig, { to: replyTo, subject: 'Re: ' + subject, body });
        if (!sendResult.ok) {
          console.log(`[actionHandler] reply send failed messageId=${msg.messageId} context=called`);
        }
      }
    } else if (tcClaimed) {
      // Own complete try/catch: a reply-send failure no longer throws (see
      // finishTcVerb), so anything reaching here is a genuinely unexpected
      // bug -- we don't know whether the write happened, so this backstop
      // must not claim "Done" or "Nothing was changed" either way, and it
      // must not let anything escape to the pre-existing catch-all below,
      // whose "went wrong" reply would be a second reply either way.
      try {
        await handleTcVerb(agentConfig, msg, subject, assistantConfig, replyTo);
      } catch (err) {
        console.log(`[actionHandler] tc-verb branch threw unexpectedly messageId=${msg.messageId}: ${err.message}`);

        try {
          const sendResult = await sendConfirmation(assistantConfig, {
            to: replyTo, subject: 'Re: ' + subject,
            body: "We got your request, but couldn't confirm whether it went through. Mo has been told and will check.",
          });
          if (!sendResult.ok) {
            console.log(`[actionHandler] reply send failed messageId=${msg.messageId} context=tc-verb-backstop`);
          }
        } catch (replyErr) {
          console.log(`[actionHandler] tc-verb backstop reply failed messageId=${msg.messageId}: ${replyErr.message}`);
        }

        try {
          await sendTcOperatorNote(agentConfig, msg, assistantConfig, {
            verb: null, transactionId: null, setId: null, memberId: null,
            outcome: 'unexpected_error',
            noteErrorMessage: err.message,
          });
        } catch (noteErr) {
          console.log(`[actionHandler] tc-verb backstop note failed messageId=${msg.messageId}: ${noteErr.message}`);
        }
      }
    } else if (isTrack1) {
      await handleTrack1(agentConfig, subject, assistantConfig, replyTo);
    } else {
      const body = msg.body || msg.snippet || '';
      await handleTrack2(agentConfig, body, assistantConfig, replyTo, subject);
    }
  } catch (err) {
    console.log(`[actionHandler] error processing email messageId=${msg.messageId}: ${err.message}`);
    try {
      const sendResult = await sendConfirmation(assistantConfig, {
        to:      replyTo,
        subject: `Re: ${subject}`,
        body:    `Something went wrong processing your request. Please try again or contact support.`,
      });
      if (!sendResult.ok) {
        console.log(`[actionHandler] reply send failed messageId=${msg.messageId} context=catch-all`);
      }
    // Defensive guard: sendConfirmation reports failure via its return
    // value, not by throwing, so this catch should not trigger today.
    // But if a throw ever did escape here, letting it propagate would
    // skip markRead below and cause the message to be reprocessed every
    // cycle.
    } catch (replyErr) {
      console.log(`[actionHandler] failed to send error reply messageId=${msg.messageId}: ${replyErr.message}`);
    }
  }

  try {
    await gmail.markRead(assistantConfig, msg.messageId);
  } catch (err) {
    console.log(`[actionHandler] failed to mark ${msg.messageId} read: ${err.message}`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function runActionHandler(allAgentConfigs) {
  const assistantConfig = loadAssistantConfig();

  let messages;
  try {
    messages = await gmail.fetchUnreadInboxEmails(assistantConfig);
  } catch (err) {
    console.error(`[actionHandler] failed to fetch inbox: ${err.message}`);
    return;
  }

  // Gmail returns this batch newest first, but the loop below is sequential:
  // a REJECT followed by a CONFIRM landing in the same cycle would otherwise
  // run backwards and add the person the agent meant to reject
  // (7.57.1, TC_SPEC 6.7). Sort a copy oldest-first before processing; the
  // fetch itself stays untouched and is shared with the lead path, which is
  // deliberately left unsorted.
  const orderedMessages = [...messages].sort((a, b) => a.internalDate - b.internalDate);

  for (const msg of orderedMessages) {
    await processEmail(msg, allAgentConfigs, assistantConfig);
  }
}

module.exports = { runActionHandler };

module.exports._internal = {
  _resetCooldowns: () => cooldownByAddress.clear(),
};
