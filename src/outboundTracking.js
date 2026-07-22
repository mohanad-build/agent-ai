// src/outboundTracking.js
//
// Outbound Tracking: closes the loop on outbound sends that are NOT the
// follow-up engine's own nudges (a live-AI reply via paths.js, or a human
// agent replying from Gmail directly). Both are genuine touches that should
// reset a lead's follow-up sequence; without this step, the sequence only
// resets on an inbound reply, so a re-engaged lead's follow-up clock never
// re-arms and risks a double-touch when the timer fires again.
//
// Idempotency: two labels distinguish "the system already knows about this
// send" from "not yet processed". agent-ai/system-followup is stamped by
// followUp.js on its own live nudge (that label excludes it here, so the
// follow-up engine's own send never gets treated as a fresh outbound).
// agent-ai/outbound-processed is stamped here once a genuine outbound has
// been reset, so the next cycle's Sent scan skips it.

const LABEL_SYSTEM_FOLLOWUP = 'agent-ai/system-followup';
const LABEL_OUTBOUND_PROCESSED = 'agent-ai/outbound-processed';
const WINDOW_HOURS = 72;

// Mirrors leadIntake.js's getSenderEmail (leadIntake.js:73-80) and index.js's
// extractEmailAddress: angle-bracket extraction, trim, lowercase. Three
// near-identical copies now exist across the codebase; consolidating them
// into one shared helper is parked, not part of this commit.
function extractAddress(header) {
  if (!header || typeof header !== 'string') return '';
  const angleMatch = header.match(/<([^>]+)>/);
  if (angleMatch && angleMatch[1]) return angleMatch[1].trim().toLowerCase();
  const trimmed = header.trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  return '';
}

function emptySummary() {
  return {
    scanned: 0,
    matched: 0,
    reset: 0,
    skippedLabeled: 0,
    skippedNoMatch: 0,
    errors: 0,
  };
}

async function trackOutbound(agentConfig, opts = {}) {
  const gmail = opts.gmail || require('./gmail');
  const email = opts.email || require('./email');
  const now = opts.now || new Date();
  const agentId = agentConfig.agentId;

  if (agentConfig.isActive === false) {
    console.log(`[${agentId}] Outbound tracking: skipped (inactive)`);
    return { skipped: 'inactive', ...emptySummary() };
  }

  let systemFollowupId;
  let outboundProcessedId;
  try {
    const labels = await gmail.ensureLabels(agentConfig, [LABEL_SYSTEM_FOLLOWUP, LABEL_OUTBOUND_PROCESSED]);
    systemFollowupId = labels.get(LABEL_SYSTEM_FOLLOWUP);
    outboundProcessedId = labels.get(LABEL_OUTBOUND_PROCESSED);
  } catch (err) {
    console.warn(`[${agentId}] Outbound tracking: ensureLabels failed: ${err.message}`);
    return { skipped: 'label-resolution-failed', ...emptySummary() };
  }

  const rows = await email.readSheetRows(agentConfig);

  const bound = Math.floor((now.getTime() - WINDOW_HOURS * 60 * 60 * 1000) / 1000);
  const query = `in:sent after:${bound}`;
  const ids = await gmail.searchMessages(agentConfig, query);

  const summary = emptySummary();

  for (const id of ids) {
    try {
      const msg = await gmail.fetchMessage(agentConfig, id);
      summary.scanned++;

      // Infinite-reset-loop guard: must run before any state write. A
      // message carrying either label has already been accounted for by
      // either the follow-up engine (system-followup) or a prior cycle of
      // this step (outbound-processed).
      const labelIds = msg.labelIds || [];
      if (labelIds.includes(systemFollowupId) || labelIds.includes(outboundProcessedId)) {
        summary.skippedLabeled++;
        continue;
      }

      const address = extractAddress(msg.to);
      if (!address) {
        summary.skippedNoMatch++;
        continue;
      }

      // Unfiltered lookup by design: a lead currently rate-limited or
      // AI-disabled still needs its follow-up state reset when the agent
      // emails them, so this must NOT go through the processable-only
      // leadIndex the orchestrator builds in processAgent. findRowByEmail
      // lives on gmail.js, not email.js (email.js does not re-export it).
      const matchedRow = gmail.findRowByEmail(rows, address);
      if (!matchedRow) {
        summary.skippedNoMatch++;
        continue;
      }

      const sendIso = new Date(msg.internalDate).toISOString();
      await email.updateSheetRow(agentConfig, matchedRow.rowIndex, {
        followUpCount: '0',
        lastFollowUpDate: sendIso,
        lastActionTimestamp: sendIso,
      });
      await email.appendToConversationHistory(
        agentConfig,
        matchedRow.rowIndex,
        'Outbound sent to lead; follow-up sequence re-armed.'
      );
      summary.matched++;
      summary.reset++;

      await gmail.applyMessageLabels(agentConfig, id, [outboundProcessedId], []);
    } catch (err) {
      summary.errors++;
      console.warn(`[${agentId}] Outbound tracking: message ${id} failed: ${err.message}`);
    }
  }

  console.log(
    `[${agentId}] Outbound tracking: scanned=${summary.scanned} matched=${summary.matched} reset=${summary.reset} skippedLabeled=${summary.skippedLabeled} skippedNoMatch=${summary.skippedNoMatch} errors=${summary.errors}`
  );

  return summary;
}

module.exports = { trackOutbound };
