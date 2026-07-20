'use strict';

const VALID_PRIMARY_FOCUS  = new Set(['buyers', 'sellers', 'both']);
const VALID_CONTENT_VOLUME = new Set(['max', 'balanced', 'minimum']);

// ── Validation ────────────────────────────────────────────────────────────────

function validateInputs(angles, agentProfile, agentHistory) {
  if (!Array.isArray(angles)) {
    throw new TypeError('selectDefaults: angles must be an array');
  }

  if (
    agentProfile == null ||
    typeof agentProfile !== 'object' ||
    !VALID_PRIMARY_FOCUS.has(agentProfile.primaryFocus)
  ) {
    throw new TypeError(
      `selectDefaults: agentProfile.primaryFocus must be one of ${[...VALID_PRIMARY_FOCUS].join(', ')}`
    );
  }

  if (!VALID_CONTENT_VOLUME.has(agentProfile.contentVolume)) {
    throw new TypeError(
      `selectDefaults: agentProfile.contentVolume must be one of ${[...VALID_CONTENT_VOLUME].join(', ')}`
    );
  }

  if (
    agentHistory == null ||
    typeof agentHistory !== 'object' ||
    !Array.isArray(agentHistory.recentThemeTags)
  ) {
    throw new TypeError('selectDefaults: agentHistory.recentThemeTags must be an array of strings');
  }

  if (typeof agentHistory.rejectedRateContent !== 'boolean') {
    throw new TypeError('selectDefaults: agentHistory.rejectedRateContent must be a boolean');
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreAngle(angle, agentProfile, agentHistory) {
  let score = angle.surpriseScore;

  // Audience-focus bonus: angle covers agent's focus (or either is 'both').
  if (
    angle.audienceFocus === 'both' ||
    agentProfile.primaryFocus === 'both' ||
    angle.audienceFocus === agentProfile.primaryFocus
  ) {
    score += 0.2;
  }

  // Recency penalty: theme appeared in agent's last 2 batches.
  if (agentHistory.recentThemeTags.includes(angle.themeTag)) {
    score -= 0.3;
  }

  // Rate-content penalty: angle forbids rate advice AND agent has historically rejected it.
  if (angle.forbidsRateAdvice && agentHistory.rejectedRateContent) {
    score -= 0.1;
  }

  return score;
}

// ── Sorting ───────────────────────────────────────────────────────────────────

function sortByScore(angles, agentProfile, agentHistory) {
  const scored = angles.map(angle => ({
    angle,
    score: scoreAngle(angle, agentProfile, agentHistory),
  }));

  scored.sort((a, b) => {
    // Primary: score descending.
    if (b.score !== a.score) return b.score - a.score;
    // Secondary: raw surpriseScore descending (independent signal, not redundant).
    if (b.angle.surpriseScore !== a.angle.surpriseScore) {
      return b.angle.surpriseScore - a.angle.surpriseScore;
    }
    // Tertiary: id ascending alphabetical.
    if (a.angle.id < b.angle.id) return -1;
    if (a.angle.id > b.angle.id) return 1;
    return 0;
  });

  return scored.map(s => s.angle);
}

// ── Origin split ──────────────────────────────────────────────────────────────

function isEvergreen(angle) { return angle.origin === 'evergreen'; }

// ── Selection ─────────────────────────────────────────────────────────────────

function selectDefaults(angles, agentProfile, agentHistory, opts = {}) {
  validateInputs(angles, agentProfile, agentHistory);

  if (angles.length === 0) {
    return { reelDefaults: [], blogDefault: null, remaining: [] };
  }

  const sorted = sortByScore(angles, agentProfile, agentHistory);
  const { contentVolume } = agentProfile;

  if (contentVolume === 'max' || contentVolume === 'balanced') {
    const reelLimit = contentVolume === 'max' ? 2 : 1;

    // Blog default: highest-scoring longFormSuitable angle, preferring market
    // over evergreen. A strong evergreen explainer is the fallback when no
    // market angle is blog-eligible, not excluded outright.
    const blogEligible       = sorted.filter(a => a.longFormSuitable === true);
    const blogMarketEligible = blogEligible.filter(a => !isEvergreen(a));
    const blogDefault =
      blogMarketEligible.length > 0 ? blogMarketEligible[0]
      : blogEligible.length > 0     ? blogEligible[0]
      : null;

    // Reel defaults: top N reel-eligible angles excluding the blog default.
    const reelPool = sorted.filter(a => a !== blogDefault && a.bestSuitedFor.includes('reel'));

    let reelDefaults;
    if (reelLimit === 2) {
      // 'max': slot-based origin mix. Slot 1 prefers MARKET, slot 2 prefers
      // EVERGREEN, each falling back to the other origin rather than going
      // empty (so a single-origin week fills both slots exactly as before).
      const marketReels    = reelPool.filter(a => !isEvergreen(a));
      const evergreenReels = reelPool.filter(a => isEvergreen(a));

      const slot1 = marketReels[0] || evergreenReels[0] || null;
      const slot2 =
        evergreenReels.find(a => a !== slot1)
        || reelPool.find(a => a !== slot1)
        || null;

      reelDefaults = [slot1, slot2].filter(a => a !== null);
    } else {
      // 'balanced' (reelLimit === 1): unchanged, origin-blind top reel.
      reelDefaults = reelPool.slice(0, 1);
    }

    const chosen    = new Set([...reelDefaults, ...(blogDefault !== null ? [blogDefault] : [])]);
    const remaining = sorted.filter(a => !chosen.has(a));

    return { reelDefaults, blogDefault, remaining };
  }

  // 'minimum': single best eligible angle across all formats.
  // Reel is preferred over blog when both apply (cheaper to produce per spec 2.4).
  for (const angle of sorted) {
    const isReelEligible = angle.bestSuitedFor.includes('reel');
    const isBlogEligible = angle.bestSuitedFor.includes('blog') && angle.longFormSuitable === true;

    if (!isReelEligible && !isBlogEligible) continue;

    const remaining = sorted.filter(a => a !== angle);

    if (isReelEligible) {
      return { reelDefaults: [angle], blogDefault: null, remaining };
    }
    return { reelDefaults: [], blogDefault: angle, remaining };
  }

  // No eligible angle found.
  return { reelDefaults: [], blogDefault: null, remaining: sorted };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  selectDefaults,
  _internal: {
    scoreAngle,
    sortByScore,
  },
};
