'use strict';

const { selectDefaults, _internal } = require('../src/content/selectDefaults');
const { scoreAngle, sortByScore }   = _internal;

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeAngle(overrides = {}) {
  return {
    id:               'angle-2026-W20-001',
    themeTag:         'rates',
    audienceFocus:    'both',
    bestSuitedFor:    ['reel'],
    surpriseScore:    0.5,
    longFormSuitable: false,
    forbidsRateAdvice: false,
    ...overrides,
  };
}

// Shared agent profiles and histories used across suites.
const BUYERS_MAX     = { primaryFocus: 'buyers', contentVolume: 'max' };
const BUYERS_BALANCED = { primaryFocus: 'buyers', contentVolume: 'balanced' };
const BOTH_MAX       = { primaryFocus: 'both',   contentVolume: 'max' };
const BOTH_BALANCED  = { primaryFocus: 'both',   contentVolume: 'balanced' };
const BOTH_MIN       = { primaryFocus: 'both',   contentVolume: 'minimum' };

const EMPTY_HISTORY  = { recentThemeTags: [], rejectedRateContent: false };
const RATE_REJECTER  = { recentThemeTags: [], rejectedRateContent: true };

// ── Input validation ──────────────────────────────────────────────────────────

describe('Input validation', () => {
  test('throws TypeError when angles is not an array', () => {
    expect(() => selectDefaults('not-an-array', BUYERS_MAX, EMPTY_HISTORY))
      .toThrow(TypeError);
  });

  test('throws TypeError when agentProfile.primaryFocus is invalid', () => {
    expect(() => selectDefaults([], { primaryFocus: 'everyone', contentVolume: 'max' }, EMPTY_HISTORY))
      .toThrow(TypeError);
  });

  test('throws TypeError when agentProfile.contentVolume is invalid', () => {
    expect(() => selectDefaults([], { primaryFocus: 'buyers', contentVolume: 'extreme' }, EMPTY_HISTORY))
      .toThrow(TypeError);
  });

  test('throws TypeError when agentHistory.recentThemeTags is not an array', () => {
    expect(() => selectDefaults([], BUYERS_MAX, { recentThemeTags: 'rates', rejectedRateContent: false }))
      .toThrow(TypeError);
  });

  test('throws TypeError when agentHistory.rejectedRateContent is not a boolean', () => {
    expect(() => selectDefaults([], BUYERS_MAX, { recentThemeTags: [], rejectedRateContent: 'yes' }))
      .toThrow(TypeError);
  });

  test('empty angles array returns empty result without throwing', () => {
    expect(selectDefaults([], BUYERS_MAX, EMPTY_HISTORY))
      .toEqual({ reelDefaults: [], blogDefault: null, remaining: [] });
  });
});

// ── scoreAngle ────────────────────────────────────────────────────────────────

describe('scoreAngle', () => {
  const BUYERS_PROFILE = { primaryFocus: 'buyers', contentVolume: 'balanced' };

  test('base score equals surpriseScore when no modifiers fire', () => {
    const angle = makeAngle({ surpriseScore: 0.5, audienceFocus: 'sellers', themeTag: 'rates', forbidsRateAdvice: false });
    const score = scoreAngle(angle, BUYERS_PROFILE, EMPTY_HISTORY);
    expect(score).toBeCloseTo(0.5);
  });

  test('strict audienceFocus match: agent buyers + angle buyers -> +0.2', () => {
    const angle = makeAngle({ surpriseScore: 0.5, audienceFocus: 'buyers' });
    const score = scoreAngle(angle, BUYERS_PROFILE, EMPTY_HISTORY);
    expect(score).toBeCloseTo(0.7);
  });

  test('strict audienceFocus mismatch: agent buyers + angle sellers -> no bonus', () => {
    const angle = makeAngle({ surpriseScore: 0.5, audienceFocus: 'sellers' });
    const score = scoreAngle(angle, BUYERS_PROFILE, EMPTY_HISTORY);
    expect(score).toBeCloseTo(0.5);
  });

  test('angle audienceFocus both + agent buyers -> +0.2', () => {
    const angle = makeAngle({ surpriseScore: 0.5, audienceFocus: 'both' });
    const score = scoreAngle(angle, BUYERS_PROFILE, EMPTY_HISTORY);
    expect(score).toBeCloseTo(0.7);
  });

  test('angle audienceFocus both + agent sellers -> +0.2', () => {
    const angle  = makeAngle({ surpriseScore: 0.5, audienceFocus: 'both' });
    const sellers = { primaryFocus: 'sellers', contentVolume: 'balanced' };
    const score  = scoreAngle(angle, sellers, EMPTY_HISTORY);
    expect(score).toBeCloseTo(0.7);
  });

  test('agent primaryFocus both + angle buyers -> +0.2', () => {
    const angle = makeAngle({ surpriseScore: 0.5, audienceFocus: 'buyers' });
    const both  = { primaryFocus: 'both', contentVolume: 'balanced' };
    const score = scoreAngle(angle, both, EMPTY_HISTORY);
    expect(score).toBeCloseTo(0.7);
  });

  test('recency penalty fires when themeTag is in recentThemeTags', () => {
    const angle   = makeAngle({ surpriseScore: 0.5, audienceFocus: 'sellers', themeTag: 'rates' });
    const history = { recentThemeTags: ['rates', 'supply'], rejectedRateContent: false };
    const score   = scoreAngle(angle, BUYERS_PROFILE, history);
    expect(score).toBeCloseTo(0.2);
  });

  test('recency penalty does not fire when themeTag is absent from recentThemeTags', () => {
    const angle   = makeAngle({ surpriseScore: 0.5, audienceFocus: 'sellers', themeTag: 'prices' });
    const history = { recentThemeTags: ['rates', 'supply'], rejectedRateContent: false };
    const score   = scoreAngle(angle, BUYERS_PROFILE, history);
    expect(score).toBeCloseTo(0.5);
  });

  test('rate-content penalty fires when forbidsRateAdvice: true and rejectedRateContent: true', () => {
    const angle = makeAngle({ surpriseScore: 0.5, audienceFocus: 'sellers', forbidsRateAdvice: true });
    const score = scoreAngle(angle, BUYERS_PROFILE, RATE_REJECTER);
    expect(score).toBeCloseTo(0.4);
  });

  test('rate-content penalty does not fire when forbidsRateAdvice: true but rejectedRateContent: false', () => {
    const angle = makeAngle({ surpriseScore: 0.5, audienceFocus: 'sellers', forbidsRateAdvice: true });
    const score = scoreAngle(angle, BUYERS_PROFILE, EMPTY_HISTORY);
    expect(score).toBeCloseTo(0.5);
  });

  test('combined modifiers produce expected sum: 0.5 + 0.2 - 0.3 - 0.1 = 0.3', () => {
    // audienceFocus matches (+0.2), themeTag in history (-0.3), forbidsRateAdvice + rejecter (-0.1).
    const angle   = makeAngle({ surpriseScore: 0.5, audienceFocus: 'buyers', themeTag: 'rates', forbidsRateAdvice: true });
    const history = { recentThemeTags: ['rates'], rejectedRateContent: true };
    const score   = scoreAngle(angle, BUYERS_PROFILE, history);
    expect(score).toBeCloseTo(0.3);
  });

  test('negative scores are allowed; score can go below zero', () => {
    // 0.1 + 0.0 - 0.3 - 0.1 = -0.3
    const angle   = makeAngle({ surpriseScore: 0.1, audienceFocus: 'sellers', themeTag: 'rates', forbidsRateAdvice: true });
    const history = { recentThemeTags: ['rates'], rejectedRateContent: true };
    const score   = scoreAngle(angle, BUYERS_PROFILE, history);
    expect(score).toBeCloseTo(-0.3);
  });
});

// ── sortByScore tiebreaker ────────────────────────────────────────────────────

describe('sortByScore tiebreaker', () => {
  // Use a profile where sellers focus gets no +0.2 bonus, so modifiers are controllable.
  const BUYERS_PROF = { primaryFocus: 'buyers', contentVolume: 'balanced' };

  test('same modified score, different surpriseScore: higher surpriseScore ranks first', () => {
    // A: surpriseScore=0.8, audienceFocus sellers -> no +0.2 -> score=0.8
    // B: surpriseScore=0.6, audienceFocus both   -> +0.2     -> score=0.8 (tie on modified score)
    // A has higher raw surpriseScore -> A should rank first.
    const A = makeAngle({ id: 'angle-2026-W20-001', surpriseScore: 0.8, audienceFocus: 'sellers' });
    const B = makeAngle({ id: 'angle-2026-W20-002', surpriseScore: 0.6, audienceFocus: 'both' });
    const result = sortByScore([B, A], BUYERS_PROF, EMPTY_HISTORY);
    expect(result[0]).toBe(A);
    expect(result[1]).toBe(B);
  });

  test('same modified score, same surpriseScore, different id: alphabetically earlier id ranks first', () => {
    // Both: surpriseScore=0.5, sellers -> score=0.5 each. ids differ.
    const A = makeAngle({ id: 'angle-2026-W20-aaa', surpriseScore: 0.5, audienceFocus: 'sellers' });
    const B = makeAngle({ id: 'angle-2026-W20-bbb', surpriseScore: 0.5, audienceFocus: 'sellers' });
    const result = sortByScore([B, A], BUYERS_PROF, EMPTY_HISTORY);
    expect(result[0]).toBe(A);
    expect(result[1]).toBe(B);
  });

  test('three-way tie resolved by id ascending', () => {
    const A = makeAngle({ id: 'angle-2026-W20-aaa', surpriseScore: 0.5, audienceFocus: 'sellers' });
    const B = makeAngle({ id: 'angle-2026-W20-bbb', surpriseScore: 0.5, audienceFocus: 'sellers' });
    const C = makeAngle({ id: 'angle-2026-W20-ccc', surpriseScore: 0.5, audienceFocus: 'sellers' });
    const result = sortByScore([C, A, B], BUYERS_PROF, EMPTY_HISTORY);
    expect(result.map(a => a.id)).toEqual([A.id, B.id, C.id]);
  });

  test('score-then-surpriseScore-then-id ordering is fully deterministic across runs', () => {
    const angles = [
      makeAngle({ id: 'angle-2026-W20-003', surpriseScore: 0.7, audienceFocus: 'sellers' }),
      makeAngle({ id: 'angle-2026-W20-001', surpriseScore: 0.9, audienceFocus: 'sellers' }),
      makeAngle({ id: 'angle-2026-W20-002', surpriseScore: 0.5, audienceFocus: 'both' }),
    ];
    const first  = sortByScore([...angles], BUYERS_PROF, EMPTY_HISTORY);
    const second = sortByScore([...angles].reverse(), BUYERS_PROF, EMPTY_HISTORY);
    expect(first.map(a => a.id)).toEqual(second.map(a => a.id));
  });

  test('tiebreaker preserves correct order when no ties exist', () => {
    const A = makeAngle({ id: 'angle-2026-W20-001', surpriseScore: 0.9, audienceFocus: 'sellers' });
    const B = makeAngle({ id: 'angle-2026-W20-002', surpriseScore: 0.5, audienceFocus: 'sellers' });
    const C = makeAngle({ id: 'angle-2026-W20-003', surpriseScore: 0.2, audienceFocus: 'sellers' });
    const result = sortByScore([C, A, B], BUYERS_PROF, EMPTY_HISTORY);
    expect(result).toEqual([A, B, C]);
  });
});

// ── selectDefaults -- 'max' mode ──────────────────────────────────────────────

describe("selectDefaults -- 'max' mode", () => {
  // With BOTH_MAX and EMPTY_HISTORY, every angle gets +0.2 (agent.primaryFocus === 'both'),
  // so modified score = surpriseScore + 0.2. Sort order equals surpriseScore order.

  test('3 reel-eligible + 2 blog-only long-form-eligible: picks 2 reel + 1 blog', () => {
    const D = makeAngle({ id: 'd', surpriseScore: 0.9, bestSuitedFor: ['blog'], longFormSuitable: true });
    const A = makeAngle({ id: 'a', surpriseScore: 0.8, bestSuitedFor: ['reel'], longFormSuitable: false });
    const B = makeAngle({ id: 'b', surpriseScore: 0.7, bestSuitedFor: ['reel'], longFormSuitable: false });
    const C = makeAngle({ id: 'c', surpriseScore: 0.6, bestSuitedFor: ['reel'], longFormSuitable: false });
    const E = makeAngle({ id: 'e', surpriseScore: 0.5, bestSuitedFor: ['blog'], longFormSuitable: true });

    const result = selectDefaults([A, B, C, D, E], BOTH_MAX, EMPTY_HISTORY);

    expect(result.blogDefault).toBe(D);
    expect(result.reelDefaults).toEqual([A, B]);
    expect(result.remaining).toHaveLength(2);
  });

  test('top-scored angle is blog default and also reel-eligible: blog gets it, reel pool excludes it', () => {
    const X = makeAngle({ id: 'x', surpriseScore: 0.9, bestSuitedFor: ['reel', 'blog'], longFormSuitable: true });
    const A = makeAngle({ id: 'a', surpriseScore: 0.8, bestSuitedFor: ['reel'], longFormSuitable: false });
    const B = makeAngle({ id: 'b', surpriseScore: 0.7, bestSuitedFor: ['reel'], longFormSuitable: false });
    const C = makeAngle({ id: 'c', surpriseScore: 0.6, bestSuitedFor: ['blog'], longFormSuitable: true });
    const D = makeAngle({ id: 'd', surpriseScore: 0.3, bestSuitedFor: ['blog'], longFormSuitable: false });

    const result = selectDefaults([X, A, B, C, D], BOTH_MAX, EMPTY_HISTORY);

    expect(result.blogDefault).toBe(X);
    expect(result.reelDefaults).toEqual([A, B]);
    expect(result.reelDefaults).not.toContain(X);
  });

  test('no longFormSuitable: true angles: blogDefault is null, picks 2 reel', () => {
    const A = makeAngle({ id: 'a', surpriseScore: 0.8, bestSuitedFor: ['reel'], longFormSuitable: false });
    const B = makeAngle({ id: 'b', surpriseScore: 0.7, bestSuitedFor: ['reel'], longFormSuitable: false });
    const C = makeAngle({ id: 'c', surpriseScore: 0.6, bestSuitedFor: ['blog'], longFormSuitable: false });
    const D = makeAngle({ id: 'd', surpriseScore: 0.5, bestSuitedFor: ['reel'], longFormSuitable: false });
    const E = makeAngle({ id: 'e', surpriseScore: 0.4, bestSuitedFor: ['blog'], longFormSuitable: false });

    const result = selectDefaults([A, B, C, D, E], BOTH_MAX, EMPTY_HISTORY);

    expect(result.blogDefault).toBeNull();
    expect(result.reelDefaults).toEqual([A, B]);
  });

  test('only 1 reel-eligible angle: graceful degradation returns 1 reel + 1 blog', () => {
    const B = makeAngle({ id: 'b', surpriseScore: 0.9, bestSuitedFor: ['blog'], longFormSuitable: true });
    const A = makeAngle({ id: 'a', surpriseScore: 0.8, bestSuitedFor: ['reel'], longFormSuitable: false });
    const C = makeAngle({ id: 'c', surpriseScore: 0.6, bestSuitedFor: ['blog'], longFormSuitable: true });
    const D = makeAngle({ id: 'd', surpriseScore: 0.5, bestSuitedFor: ['blog'], longFormSuitable: false });
    const E = makeAngle({ id: 'e', surpriseScore: 0.4, bestSuitedFor: ['blog'], longFormSuitable: false });

    const result = selectDefaults([A, B, C, D, E], BOTH_MAX, EMPTY_HISTORY);

    expect(result.reelDefaults).toHaveLength(1);
    expect(result.reelDefaults[0]).toBe(A);
    expect(result.blogDefault).toBe(B);
  });

  test('angle in bestSuitedFor both reel and blog with longFormSuitable: true is placed as blog, not reel', () => {
    const X = makeAngle({ id: 'x', surpriseScore: 0.9, bestSuitedFor: ['reel', 'blog'], longFormSuitable: true });
    const A = makeAngle({ id: 'a', surpriseScore: 0.7, bestSuitedFor: ['reel'], longFormSuitable: false });
    const B = makeAngle({ id: 'b', surpriseScore: 0.5, bestSuitedFor: ['reel'], longFormSuitable: false });
    const C = makeAngle({ id: 'c', surpriseScore: 0.4, bestSuitedFor: ['blog'], longFormSuitable: true });
    const D = makeAngle({ id: 'd', surpriseScore: 0.2, bestSuitedFor: ['blog'], longFormSuitable: false });

    const result = selectDefaults([X, A, B, C, D], BOTH_MAX, EMPTY_HISTORY);

    expect(result.blogDefault).toBe(X);
    expect(result.reelDefaults).not.toContain(X);
    expect(result.reelDefaults).toContain(A);
  });

  test('remaining contains leftover angles in score order', () => {
    const D = makeAngle({ id: 'd', surpriseScore: 0.9, bestSuitedFor: ['blog'], longFormSuitable: true });
    const A = makeAngle({ id: 'a', surpriseScore: 0.8, bestSuitedFor: ['reel'], longFormSuitable: false });
    const B = makeAngle({ id: 'b', surpriseScore: 0.7, bestSuitedFor: ['reel'], longFormSuitable: false });
    const C = makeAngle({ id: 'c', surpriseScore: 0.4, bestSuitedFor: ['reel'], longFormSuitable: false });
    const E = makeAngle({ id: 'e', surpriseScore: 0.2, bestSuitedFor: ['blog'], longFormSuitable: true });

    const result = selectDefaults([A, B, C, D, E], BOTH_MAX, EMPTY_HISTORY);

    // blogDefault=D, reelDefaults=[A,B], remaining=[C,E] in score order (C > E)
    expect(result.remaining).toEqual([C, E]);
    expect(result.reelDefaults).not.toContain(result.remaining[0]);
    expect(result.reelDefaults).not.toContain(result.remaining[1]);
    expect(result.remaining).not.toContain(result.blogDefault);
  });
});

// ── selectDefaults -- 'balanced' mode ─────────────────────────────────────────

describe("selectDefaults -- 'balanced' mode", () => {
  test('5 mixed angles: picks 1 reel + 1 blog', () => {
    const D = makeAngle({ id: 'd', surpriseScore: 0.9, bestSuitedFor: ['blog'], longFormSuitable: true });
    const A = makeAngle({ id: 'a', surpriseScore: 0.8, bestSuitedFor: ['reel'], longFormSuitable: false });
    const B = makeAngle({ id: 'b', surpriseScore: 0.6, bestSuitedFor: ['reel'], longFormSuitable: false });
    const C = makeAngle({ id: 'c', surpriseScore: 0.5, bestSuitedFor: ['reel'], longFormSuitable: false });
    const E = makeAngle({ id: 'e', surpriseScore: 0.3, bestSuitedFor: ['blog'], longFormSuitable: true });

    const result = selectDefaults([A, B, C, D, E], BOTH_BALANCED, EMPTY_HISTORY);

    expect(result.reelDefaults).toHaveLength(1);
    expect(result.blogDefault).not.toBeNull();
    expect(result.blogDefault).toBe(D);
    expect(result.reelDefaults[0]).toBe(A);
  });

  test('no long-form-eligible angles: 1 reel + null blog', () => {
    const A = makeAngle({ id: 'a', surpriseScore: 0.8, bestSuitedFor: ['reel'], longFormSuitable: false });
    const B = makeAngle({ id: 'b', surpriseScore: 0.6, bestSuitedFor: ['reel'], longFormSuitable: false });
    const C = makeAngle({ id: 'c', surpriseScore: 0.4, bestSuitedFor: ['blog'], longFormSuitable: false });

    const result = selectDefaults([A, B, C], BOTH_BALANCED, EMPTY_HISTORY);

    expect(result.blogDefault).toBeNull();
    expect(result.reelDefaults).toHaveLength(1);
    expect(result.reelDefaults[0]).toBe(A);
  });

  test('top reel-eligible is also blog default: blog gets it, second reel-eligible picked for reel', () => {
    const X = makeAngle({ id: 'x', surpriseScore: 0.9, bestSuitedFor: ['reel', 'blog'], longFormSuitable: true });
    const A = makeAngle({ id: 'a', surpriseScore: 0.7, bestSuitedFor: ['reel'], longFormSuitable: false });
    const B = makeAngle({ id: 'b', surpriseScore: 0.4, bestSuitedFor: ['blog'], longFormSuitable: true });
    const C = makeAngle({ id: 'c', surpriseScore: 0.3, bestSuitedFor: ['blog'], longFormSuitable: false });

    const result = selectDefaults([X, A, B, C], BOTH_BALANCED, EMPTY_HISTORY);

    expect(result.blogDefault).toBe(X);
    expect(result.reelDefaults).toHaveLength(1);
    expect(result.reelDefaults[0]).toBe(A);
  });
});

// ── selectDefaults -- 'minimum' mode ─────────────────────────────────────────

describe("selectDefaults -- 'minimum' mode", () => {
  test('top-scored is reel-only: placed as reel default, blog null', () => {
    const A = makeAngle({ id: 'a', surpriseScore: 0.9, bestSuitedFor: ['reel'], longFormSuitable: false });
    const B = makeAngle({ id: 'b', surpriseScore: 0.7, bestSuitedFor: ['blog'], longFormSuitable: true });
    const C = makeAngle({ id: 'c', surpriseScore: 0.5, bestSuitedFor: ['reel'], longFormSuitable: false });

    const result = selectDefaults([A, B, C], BOTH_MIN, EMPTY_HISTORY);

    expect(result.reelDefaults).toEqual([A]);
    expect(result.blogDefault).toBeNull();
    expect(result.remaining).toContain(B);
    expect(result.remaining).toContain(C);
  });

  test('top-scored is blog-only and longFormSuitable: true: placed as blog default, reel empty', () => {
    const A = makeAngle({ id: 'a', surpriseScore: 0.9, bestSuitedFor: ['blog'], longFormSuitable: true });
    const B = makeAngle({ id: 'b', surpriseScore: 0.7, bestSuitedFor: ['blog'], longFormSuitable: false });
    const C = makeAngle({ id: 'c', surpriseScore: 0.5, bestSuitedFor: ['blog'], longFormSuitable: false });

    const result = selectDefaults([A, B, C], BOTH_MIN, EMPTY_HISTORY);

    expect(result.reelDefaults).toEqual([]);
    expect(result.blogDefault).toBe(A);
    expect(result.remaining).toContain(B);
  });

  test('top-scored is reel+blog with longFormSuitable: true: reel preferred over blog', () => {
    const A = makeAngle({ id: 'a', surpriseScore: 0.9, bestSuitedFor: ['reel', 'blog'], longFormSuitable: true });
    const B = makeAngle({ id: 'b', surpriseScore: 0.6, bestSuitedFor: ['blog'], longFormSuitable: true });

    const result = selectDefaults([A, B], BOTH_MIN, EMPTY_HISTORY);

    expect(result.reelDefaults).toEqual([A]);
    expect(result.blogDefault).toBeNull();
  });

  test('top-scored is blog-only with longFormSuitable: false: skipped, next-best eligible picked', () => {
    const X = makeAngle({ id: 'x', surpriseScore: 0.9, bestSuitedFor: ['blog'], longFormSuitable: false });
    const A = makeAngle({ id: 'a', surpriseScore: 0.7, bestSuitedFor: ['reel'], longFormSuitable: false });
    const B = makeAngle({ id: 'b', surpriseScore: 0.5, bestSuitedFor: ['blog'], longFormSuitable: false });

    const result = selectDefaults([X, A, B], BOTH_MIN, EMPTY_HISTORY);

    // X is skipped (blog-only, not longFormSuitable). A is the next reel-eligible.
    expect(result.reelDefaults).toEqual([A]);
    expect(result.blogDefault).toBeNull();
    expect(result.remaining).toContain(X);
  });

  test('no eligible angle (all blog-only and longFormSuitable: false): empty result', () => {
    const A = makeAngle({ id: 'a', surpriseScore: 0.9, bestSuitedFor: ['blog'], longFormSuitable: false });
    const B = makeAngle({ id: 'b', surpriseScore: 0.7, bestSuitedFor: ['blog'], longFormSuitable: false });
    const C = makeAngle({ id: 'c', surpriseScore: 0.5, bestSuitedFor: ['blog'], longFormSuitable: false });

    const result = selectDefaults([A, B, C], BOTH_MIN, EMPTY_HISTORY);

    expect(result.reelDefaults).toEqual([]);
    expect(result.blogDefault).toBeNull();
    // remaining is sorted, all angles present
    expect(result.remaining).toHaveLength(3);
  });

  test('single angle in input that is reel-eligible: picked and remaining is empty', () => {
    const A = makeAngle({ id: 'a', surpriseScore: 0.5, bestSuitedFor: ['reel'], longFormSuitable: false });

    const result = selectDefaults([A], BOTH_MIN, EMPTY_HISTORY);

    expect(result.reelDefaults).toEqual([A]);
    expect(result.blogDefault).toBeNull();
    expect(result.remaining).toEqual([]);
  });
});

// ── Deterministic stability ───────────────────────────────────────────────────

describe('Deterministic stability', () => {
  const angles = [
    makeAngle({ id: 'angle-2026-W20-003', surpriseScore: 0.7, bestSuitedFor: ['reel'], longFormSuitable: true }),
    makeAngle({ id: 'angle-2026-W20-001', surpriseScore: 0.9, bestSuitedFor: ['blog'], longFormSuitable: true }),
    makeAngle({ id: 'angle-2026-W20-004', surpriseScore: 0.6, bestSuitedFor: ['reel'], longFormSuitable: false }),
    makeAngle({ id: 'angle-2026-W20-002', surpriseScore: 0.8, bestSuitedFor: ['reel', 'blog'], longFormSuitable: true }),
    makeAngle({ id: 'angle-2026-W20-005', surpriseScore: 0.4, bestSuitedFor: ['blog'], longFormSuitable: false }),
  ];

  test('calling selectDefaults twice with same inputs produces identical output', () => {
    const first  = selectDefaults([...angles], BOTH_MAX, EMPTY_HISTORY);
    const second = selectDefaults([...angles], BOTH_MAX, EMPTY_HISTORY);
    expect(first.blogDefault).toBe(second.blogDefault);
    expect(first.reelDefaults).toEqual(second.reelDefaults);
    expect(first.remaining).toEqual(second.remaining);
  });

  test('permuting input array order does not change output', () => {
    const shuffled = [angles[4], angles[2], angles[0], angles[3], angles[1]];
    const canonical = selectDefaults([...angles],  BOTH_MAX, EMPTY_HISTORY);
    const permuted  = selectDefaults(shuffled,     BOTH_MAX, EMPTY_HISTORY);
    expect(permuted.blogDefault).toBe(canonical.blogDefault);
    expect(permuted.reelDefaults.map(a => a.id)).toEqual(canonical.reelDefaults.map(a => a.id));
    expect(permuted.remaining.map(a => a.id)).toEqual(canonical.remaining.map(a => a.id));
  });
});
