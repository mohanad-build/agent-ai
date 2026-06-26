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
const { getStorageRoot }          = require('../storagePaths');

const ASSISTANT_AGENT_ID   = 'assistant';
const ASSISTANT_EMAIL      = 'assistant@getklosed.ca';
function getTokenPath() { return path.join(getStorageRoot(), 'assistant.json'); }
function getAgentsDir()  { return getStorageRoot(); }
const REGEN_CAP            = 5;
const CONFIDENCE_THRESHOLD = 0.7;

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

async function sendConfirmation(assistantConfig, { to, subject, body }) {
  await _sendWithRetry(
    () => gmail.sendNewEmail(assistantConfig, { to, subject, body }),
    `confirm-${to}`
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

// ── Per-message processor ─────────────────────────────────────────────────────

async function processEmail(msg, allAgentConfigs, assistantConfig) {
  const fromEmail = extractEmailAddress(msg.from || '');
  const agentConfig = allAgentConfigs.find(c =>
    (c.gmailAddress || '').toLowerCase().trim() === fromEmail
  );

  if (!agentConfig) {
    console.log(`[actionHandler] unrecognized sender: ${fromEmail}`);
    try {
      await gmail.markRead(assistantConfig, msg.messageId);
    } catch (err) {
      console.log(`[actionHandler] failed to mark ${msg.messageId} read: ${err.message}`);
    }
    return;
  }

  const subject  = (msg.subject || '').trim();
  const isTrack1 = /^(APPROVE|REGEN|SWAP)\b/i.test(subject);
  const replyTo  = agentConfig.gmailAddress;

  try {
    if (isTrack1) {
      await handleTrack1(agentConfig, subject, assistantConfig, replyTo);
    } else {
      const body = msg.body || msg.snippet || '';
      await handleTrack2(agentConfig, body, assistantConfig, replyTo, subject);
    }
  } catch (err) {
    console.log(`[actionHandler] error processing email from ${fromEmail}: ${err.message}`);
    try {
      await sendConfirmation(assistantConfig, {
        to:      replyTo,
        subject: `Re: ${subject}`,
        body:    `Something went wrong processing your request. Please try again or contact support.`,
      });
    } catch (replyErr) {
      console.log(`[actionHandler] failed to send error reply to ${fromEmail}: ${replyErr.message}`);
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

  for (const msg of messages) {
    await processEmail(msg, allAgentConfigs, assistantConfig);
  }
}

module.exports = { runActionHandler };
