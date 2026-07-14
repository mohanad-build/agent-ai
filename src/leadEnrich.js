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

module.exports = {
  scanLeadHistory,
  SCAN_MAX_MESSAGES,
  _internal: {
    buildScanQuery,
  },
};
