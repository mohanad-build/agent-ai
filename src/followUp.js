// src/followUp.js
//
// Follow-Up Sequences (Step 5): time-triggered outreach engine.
// Sends Day 3, Day 7, and Day 14 follow-up emails to leads in
// 'awaiting_response' status who have not replied since the last outbound touch.
//
// Eligibility per row:
//   status === 'awaiting_response'
//   aiEnabled === TRUE
//   followUpCount < cadence.length
//   now - lastOutboundTimestamp >= cadence[followUpCount] days
//
// Pre-flight threading check: if the lead's Gmail thread has activity newer
// than lastOutboundTimestamp, the fire is skipped and lastFollowUpDate is
// updated so the next cycle re-anchors the clock.
//
// Cold flip: after the final touch fires, status is set to 'cold' immediately.

const email = require('./email');
const claude = require('./claude');
const prompts = require('./prompts');
const { buildShadowDraftWrapper } = require('./paths');
const { getFollowUpCadence } = require('./agentConfig');
const { getNow, getNowIso } = require('./time');
const agentState = require('./agentState');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isAiEnabled(row) {
  const v = row.aiEnabled;
  if (v === undefined || v === null || v === '') return true;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (s === 'false' || s === 'no' || s === '0') return false;
  return true;
}

// Returns the follow-up prompt builder for a given 0-based touch index.
// Touch 0 -> Day 3, touch 1 -> Day 7, touch 2+ -> Day 14 (final style).
function getPromptBuilder(touchIndex) {
  if (touchIndex === 0) return prompts.buildFollowUpDay3Prompt;
  if (touchIndex === 1) return prompts.buildFollowUpDay7Prompt;
  return prompts.buildFollowUpDay14Prompt;
}

async function runFollowUps(agentConfig) {
  const agentId = agentConfig.agentId;
  const stats = {
    eligible: 0,
    threadingMismatchSkipped: 0,
    fired: 0,
    errors: 0,
  };

  let rows;
  try {
    rows = await email.readSheetRows(agentConfig);
  } catch (err) {
    console.error(`[${agentId}] Follow-up: readSheetRows failed: ${err.message}`);
    throw err;
  }

  const cadence = getFollowUpCadence(agentConfig);
  const now = getNow();

  for (const row of rows) {
    if (row.status !== 'awaiting_response') continue;
    if (!isAiEnabled(row)) continue;

    const touchIndex = parseInt(String(row.followUpCount || '0'), 10);
    if (Number.isNaN(touchIndex) || touchIndex < 0 || touchIndex >= cadence.length) continue;

    // Use lastFollowUpDate if present, fall back to lastActionTimestamp.
    const refTimestamp = row.lastFollowUpDate || row.lastActionTimestamp;
    if (!refTimestamp) continue;
    const lastOutboundMs = new Date(refTimestamp).getTime();
    if (Number.isNaN(lastOutboundMs)) continue;

    const daysElapsed = (now - lastOutboundMs) / MS_PER_DAY;
    if (daysElapsed < cadence[touchIndex]) continue;

    stats.eligible++;

    // Pre-flight threading check: skip if thread has activity newer than lastOutbound.
    if (row.gmailThreadId) {
      try {
        const messages = await email.getThreadHistory(agentConfig, row.gmailThreadId);
        if (messages && messages.length > 0) {
          const latest = messages.reduce((a, b) => {
            const ta = new Date(a.receivedAt || 0).getTime();
            const tb = new Date(b.receivedAt || 0).getTime();
            return tb > ta ? b : a;
          });
          const latestMs = new Date(latest.receivedAt || 0).getTime();
          if (latestMs > lastOutboundMs) {
            try {
              await email.updateSheetRow(agentConfig, row.rowIndex, {
                lastFollowUpDate: latest.receivedAt,
              });
            } catch (updateErr) {
              console.warn(`[${agentId}] Follow-up: row ${row.rowIndex} threading mismatch update failed: ${updateErr.message}`);
            }
            stats.threadingMismatchSkipped++;
            try {
              agentState.incrementWeeklyPreflightSkips(agentId);
            } catch (err) {
              console.warn(`[${agentId}] Follow-up: row ${row.rowIndex} incrementWeeklyPreflightSkips failed: ${err.message}`);
            }
            console.log(`[${agentId}] Follow-up: row ${row.rowIndex} threading mismatch skipped (thread activity at ${latest.receivedAt})`);
            continue;
          }
        }
      } catch (err) {
        console.warn(`[${agentId}] Follow-up: row ${row.rowIndex} getThreadHistory failed: ${err.message} (proceeding)`);
      }
    }

    // Signature check (best-effort).
    let hasSignature = false;
    try {
      hasSignature = await email.getSignaturePresence(agentConfig);
    } catch (err) {
      console.warn(`[${agentId}] Follow-up: row ${row.rowIndex} getSignaturePresence failed: ${err.message}`);
    }

    const buildPrompt = getPromptBuilder(touchIndex);
    const conversationHistory = row.conversationHistory || '';
    const prompt = buildPrompt(agentConfig, row, conversationHistory, hasSignature);
    const bannedPhrases = prompts.getMergedBannedPhrases(agentConfig);

    let draftBody;
    try {
      const result = await claude.draft(prompt, bannedPhrases);
      if (result.escalate) {
        throw new Error(`draft escalated after ${result.attempts} attempt(s): violations=[${result.violations.join(', ')}]`);
      }
      draftBody = result.text;
      console.log(`[${agentId}] Follow-up: row ${row.rowIndex} touch ${touchIndex + 1} draft ready (${result.attempts} attempt(s))`);
    } catch (err) {
      console.error(`[${agentId}] Follow-up: row ${row.rowIndex} draft failed: ${err.message}`);
      stats.errors++;
      continue;
    }

    const isFinalTouch = touchIndex === cadence.length - 1;
    const touchLabel = 'Day ' + cadence[touchIndex];
    const nowIso = getNowIso();

    if (agentConfig.mode === 'shadow') {
      const wrapped = buildShadowDraftWrapper(row.leadId, draftBody);
      try {
        await email.sendNewEmail(agentConfig, {
          to: agentConfig.gmailAddress,
          subject: wrapped.subject,
          body: wrapped.body,
        });
      } catch (err) {
        console.error(`[${agentId}] Follow-up: row ${row.rowIndex} sendNewEmail (shadow) failed: ${err.message}`);
        stats.errors++;
        continue;
      }
    } else {
      try {
        await email.sendReply(agentConfig, {
          to: row.leadId,
          subject: 'Re: ' + (row.originalMessage || 'Your inquiry').slice(0, 80),
          body: draftBody,
          threadId: row.gmailThreadId || '',
        });
      } catch (err) {
        console.error(`[${agentId}] Follow-up: row ${row.rowIndex} sendReply failed: ${err.message}`);
        stats.errors++;
        continue;
      }
    }

    const newStatus = isFinalTouch ? 'cold' : 'awaiting_response';
    try {
      await email.updateSheetRow(agentConfig, row.rowIndex, {
        followUpCount: String(touchIndex + 1),
        lastFollowUpDate: nowIso,
        status: newStatus,
        lastActionTimestamp: nowIso,
      });
    } catch (err) {
      console.error(`[${agentId}] Follow-up: row ${row.rowIndex} updateSheetRow failed: ${err.message}`);
      stats.errors++;
      continue;
    }

    const historyEntry = `Follow-up ${touchLabel} sent (touch ${touchIndex + 1}/${cadence.length})` +
      (isFinalTouch ? ' [final touch, status set to cold]' : '') +
      '. Draft source: claude';
    try {
      await email.appendToConversationHistory(agentConfig, row.rowIndex, historyEntry);
    } catch (err) {
      console.warn(`[${agentId}] Follow-up: row ${row.rowIndex} appendToConversationHistory failed: ${err.message}`);
    }

    stats.fired++;
    console.log(`[${agentId}] Follow-up: row ${row.rowIndex} ${row.leadId} touch ${touchIndex + 1}/${cadence.length} (${touchLabel}) fired -> status=${newStatus}`);
  }

  return stats;
}

module.exports = { runFollowUps };
