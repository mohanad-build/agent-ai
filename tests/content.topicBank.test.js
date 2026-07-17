'use strict';

const {
  TOPIC_BANK,
  validateEntry,
  listSlots,
  selectWeeklyTopics,
  bankVersion,
  _internal,
} = require('../src/content/topicBank');

const { stableStringify, epochDeck } = _internal;

// ── Helper: minimal valid entry/seed for negative-path tests ─────────────────

function makeEntry(overrides = {}) {
  return {
    id: 'base-entry',
    themeTag: 'craft',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [makeSeed()],
    ...overrides,
  };
}

function makeSeed(overrides = {}) {
  return {
    id: 'base-seed',
    take: 'A plain take with no statistics in it.',
    audienceFocus: 'buyers',
    bestSuitedFor: ['reel'],
    longFormSuitable: false,
    baseInterest: 0.5,
    ...overrides,
  };
}

// ── Real bank integrity ───────────────────────────────────────────────────────

describe('TOPIC_BANK integrity', () => {
  test('every entry in the real bank passes validateEntry', () => {
    for (const entry of TOPIC_BANK) {
      const errors = validateEntry(entry);
      expect({ id: entry.id, errors }).toEqual({ id: entry.id, errors: [] });
    }
  });

  test('entry ids are unique across the bank', () => {
    const ids = TOPIC_BANK.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('seed ids are unique within each entry', () => {
    for (const entry of TOPIC_BANK) {
      const seedIds = entry.angleSeeds.map(s => s.id);
      expect(new Set(seedIds).size).toBe(seedIds.length);
    }
  });

  test('no seed take contains a digit', () => {
    for (const entry of TOPIC_BANK) {
      for (const seed of entry.angleSeeds) {
        expect(seed.take).not.toMatch(/[0-9]/);
      }
    }
  });

  test('no em-dash or en-dash anywhere in the real bank', () => {
    const serialized = JSON.stringify(TOPIC_BANK);
    expect(serialized).not.toMatch(/[–—]/);
  });
});

// ── validateEntry negative paths ─────────────────────────────────────────────

describe('validateEntry rejects malformed entries', () => {
  test('bad themeTag', () => {
    const errors = validateEntry(makeEntry({ themeTag: 'not-a-real-tag' }));
    expect(errors.some(e => e.includes('themeTag'))).toBe(true);
  });

  test('empty angleSeeds', () => {
    const errors = validateEntry(makeEntry({ angleSeeds: [] }));
    expect(errors.some(e => e.includes('angleSeeds'))).toBe(true);
  });

  test('baseInterest out of range', () => {
    const errors = validateEntry(makeEntry({ angleSeeds: [makeSeed({ baseInterest: 1.5 })] }));
    expect(errors.some(e => e.includes('baseInterest'))).toBe(true);
  });

  test('months containing 0', () => {
    const errors = validateEntry(makeEntry({ months: [0] }));
    expect(errors.some(e => e.includes('months'))).toBe(true);
  });

  test('months containing 13', () => {
    const errors = validateEntry(makeEntry({ months: [13] }));
    expect(errors.some(e => e.includes('months'))).toBe(true);
  });

  test('duplicate seed ids', () => {
    const errors = validateEntry(makeEntry({
      angleSeeds: [makeSeed({ id: 'dup' }), makeSeed({ id: 'dup' })],
    }));
    expect(errors.some(e => e.includes('duplicate seed id'))).toBe(true);
  });

  test('bestSuitedFor empty', () => {
    const errors = validateEntry(makeEntry({ angleSeeds: [makeSeed({ bestSuitedFor: [] })] }));
    expect(errors.some(e => e.includes('bestSuitedFor'))).toBe(true);
  });

  test('non-null sourceFooter when facts is empty', () => {
    const errors = validateEntry(makeEntry({ facts: [], sourceFooter: 'Some Source (Jan 1 2026)' }));
    expect(errors.some(e => e.includes('sourceFooter'))).toBe(true);
  });

  test('valid entry produces zero errors', () => {
    expect(validateEntry(makeEntry())).toEqual([]);
  });
});

// ── listSlots ─────────────────────────────────────────────────────────────────

describe('listSlots', () => {
  test('order is stable across calls', () => {
    const a = listSlots(TOPIC_BANK).map(s => `${s.topicId}:${s.seedId}`);
    const b = listSlots(TOPIC_BANK).map(s => `${s.topicId}:${s.seedId}`);
    expect(a).toEqual(b);
  });

  test('flattens every entry x seed', () => {
    const expectedCount = TOPIC_BANK.reduce((sum, e) => sum + e.angleSeeds.length, 0);
    expect(listSlots(TOPIC_BANK).length).toBe(expectedCount);
  });

  test('order is not bank declaration order', () => {
    const declarationOrder = [];
    for (const entry of TOPIC_BANK) {
      for (const seed of entry.angleSeeds) {
        declarationOrder.push(`${entry.id}:${seed.id}`);
      }
    }
    const slotOrder = listSlots(TOPIC_BANK).map(s => `${s.topicId}:${s.seedId}`);
    expect(slotOrder).not.toEqual(declarationOrder);
  });
});

// ── selectWeeklyTopics ────────────────────────────────────────────────────────

describe('selectWeeklyTopics', () => {
  test('deterministic for the same weekIso', () => {
    const a = selectWeeklyTopics('2026-W10', 5).map(s => `${s.topicId}:${s.seedId}`);
    const b = selectWeeklyTopics('2026-W10', 5).map(s => `${s.topicId}:${s.seedId}`);
    expect(a).toEqual(b);
  });

  test('returns count slots for a normal week', () => {
    const result = selectWeeklyTopics('2026-W10', 5);
    expect(result.length).toBe(5);
  });

  test('no duplicate topicId within one week result', () => {
    const result = selectWeeklyTopics('2026-W10', 8);
    const topicIds = result.map(s => s.topicId);
    expect(new Set(topicIds).size).toBe(topicIds.length);
  });

  test('rotation advances across consecutive weeks', () => {
    // Evergreen-only fixture (no months restriction on any entry) so a
    // seasonality shift between weeks can't be mistaken for cursor movement.
    const fixture = Array.from({ length: 12 }, (_, i) =>
      makeEntry({
        id: `evergreen-${i}`,
        months: null,
        angleSeeds: [makeSeed({ id: 'only-seed' })],
      })
    );

    const weekIsos = [
      '2026-W01', '2026-W02', '2026-W03', '2026-W04', '2026-W05',
      '2026-W06', '2026-W07', '2026-W08', '2026-W09', '2026-W10',
    ];
    const resultSets = weekIsos.map(w =>
      JSON.stringify(selectWeeklyTopics(w, 5, { entries: fixture }).map(s => `${s.topicId}:${s.seedId}`))
    );
    expect(new Set(resultSets).size).toBeGreaterThan(1);
  });

  test('over enough weeks every slot appears at least once', () => {
    const allSlots = new Set(listSlots(TOPIC_BANK).map(s => `${s.topicId}:${s.seedId}`));
    const seen = new Set();
    for (let year = 2026; year <= 2028; year++) {
      for (let w = 1; w <= 52; w++) {
        const weekIso = `${year}-W${String(w).padStart(2, '0')}`;
        for (const slot of selectWeeklyTopics(weekIso, 5)) {
          seen.add(`${slot.topicId}:${slot.seedId}`);
        }
      }
    }
    for (const slot of allSlots) {
      expect(seen.has(slot)).toBe(true);
    }
  });

  test('count=3 is the production value and must not cycle', () => {
    // Regression: an arithmetic cursor with gcd(count, slots.length) > 1
    // (e.g. gcd(3, 51) = 3) partitions slots into fixed groups and can
    // produce at most slots.length / gcd distinct menus. At count=3 that
    // was 17. The deck mechanism has no such ceiling.
    const sigs = new Set();
    for (let w = 1; w <= 52; w++) {
      const weekIso = `2026-W${String(w).padStart(2, '0')}`;
      const sig = selectWeeklyTopics(weekIso, 3).map(s => `${s.topicId}:${s.seedId}`).join('|');
      sigs.add(sig);
    }
    expect(sigs.size).toBeGreaterThanOrEqual(40);
  });

  test('count=3 covers every non-seasonal slot within three years', () => {
    // Seasonal entries are dealt from the same deck but filtered by their
    // months window, so their coverage horizon is a function of season
    // width, not of the rotation. Mixing them into a coverage assertion
    // tests the seasonality filter, not the deck. Restricting to the
    // evergreen subset isolates the deck's coverage property, which is
    // what this test is for.
    const evergreenOnly = TOPIC_BANK.filter(e => e.months === null);
    const allSlots = new Set(listSlots(evergreenOnly).map(s => `${s.topicId}:${s.seedId}`));
    const seen = new Set();
    for (let year = 2026; year <= 2028; year++) {
      for (let w = 1; w <= 52; w++) {
        const weekIso = `${year}-W${String(w).padStart(2, '0')}`;
        for (const slot of selectWeeklyTopics(weekIso, 3, { entries: evergreenOnly })) {
          seen.add(`${slot.topicId}:${slot.seedId}`);
        }
      }
    }
    for (const slot of allSlots) {
      expect(seen.has(slot)).toBe(true);
    }
  });

  test('seasonal entries surface within their season', () => {
    const weeksAppearedIn = [];
    for (let year = 2026; year <= 2028; year++) {
      for (let w = 1; w <= 52; w++) {
        const weekIso = `${year}-W${String(w).padStart(2, '0')}`;
        const result = selectWeeklyTopics(weekIso, 3);
        if (result.some(s => s.topicId === 'moving-day-logistics')) {
          weeksAppearedIn.push(weekIso);
        }
      }
    }

    expect(weeksAppearedIn.length).toBeGreaterThan(0);

    for (const weekIso of weeksAppearedIn) {
      const [yearStr, weekStr] = weekIso.split('-W');
      const year = parseInt(yearStr, 10);
      const week = parseInt(weekStr, 10);
      const jan4 = new Date(Date.UTC(year, 0, 4));
      const jan4IsoWeekday = (jan4.getUTCDay() + 6) % 7 + 1;
      const week1Monday = new Date(jan4.getTime() - (jan4IsoWeekday - 1) * 86400000);
      const thursday = new Date(week1Monday.getTime() + ((week - 1) * 7 + 3) * 86400000);
      const month = thursday.getUTCMonth() + 1;
      expect([6, 7, 8]).toContain(month);
    }
  });

  // Within an epoch and with one seed per topic, dedupe cannot skip, so deal
  // windows are truly disjoint and consecutive weeks cannot overlap. That is
  // what this test pins.
  //
  // Across an epoch boundary the deck reshuffles independently, so a slot
  // can land in both windows by chance. Structural, accepted, roughly 1-2
  // occurrences per 3 years at the real bank's 51 slots.
  //
  // In the real multi-seed bank, two seeds of one topic can land in a single
  // window; dedupe skips the second and the walk reaches into the next
  // week's window to fill. Measured: 10 overlapping pairs across 155
  // consecutive-week pairs, 2026-2028, count=3, down from 33 before
  // seasonality was moved ahead of windowing.
  test('consecutive weeks within an epoch share no slot when topic dedupe cannot fire', () => {
    const fixture = Array.from({ length: 12 }, (_, i) =>
      makeEntry({
        id: `single-seed-${i}`,
        months: i === 0 ? [1] : null,
        angleSeeds: [makeSeed({ id: 'only-seed' })],
      })
    );

    const count = 3;
    const epochLength = Math.ceil(listSlots(fixture).length / count);

    function epochOf(weekIso) {
      const [yearStr, weekStr] = weekIso.split('-W');
      const year = parseInt(yearStr, 10);
      const weekNumber = parseInt(weekStr, 10);
      const absWeek = year * 53 + weekNumber;
      return Math.floor(absWeek / epochLength);
    }

    const weekIsos = [];
    for (let year = 2026; year <= 2028; year++) {
      for (let w = 1; w <= 52; w++) {
        weekIsos.push(`${year}-W${String(w).padStart(2, '0')}`);
      }
    }

    const resultsByWeek = weekIsos.map(weekIso => ({
      weekIso,
      epoch: epochOf(weekIso),
      slots: selectWeeklyTopics(weekIso, count, { entries: fixture }).map(s => `${s.topicId}:${s.seedId}`),
    }));

    const overlaps = [];
    let sameEpochPairCount = 0;
    for (let i = 0; i < resultsByWeek.length - 1; i++) {
      const a = resultsByWeek[i];
      const b = resultsByWeek[i + 1];
      if (a.epoch !== b.epoch) continue;
      sameEpochPairCount++;
      const shared = b.slots.filter(s => a.slots.includes(s));
      if (shared.length > 0) {
        overlaps.push({ weekA: a.weekIso, weekB: b.weekIso, epoch: a.epoch, shared });
      }
    }

    expect(sameEpochPairCount).toBeGreaterThan(100);
    expect(overlaps).toEqual([]);
  });

  test('count=3 is deterministic for the same weekIso', () => {
    const a = selectWeeklyTopics('2026-W10', 3).map(s => `${s.topicId}:${s.seedId}`);
    const b = selectWeeklyTopics('2026-W10', 3).map(s => `${s.topicId}:${s.seedId}`);
    expect(a).toEqual(b);
  });

  test('selectWeeklyTopics does not mutate caller entries', () => {
    const fixture = [
      makeEntry({ id: 'entry-a', angleSeeds: [makeSeed({ id: 'seed-a' }), makeSeed({ id: 'seed-b' })] }),
      makeEntry({ id: 'entry-b', angleSeeds: [makeSeed({ id: 'seed-c' })] }),
    ];
    const before = JSON.stringify(fixture);
    selectWeeklyTopics('2026-W10', 3, { entries: fixture });
    const after = JSON.stringify(fixture);
    expect(after).toBe(before);
  });

  test('seasonality excludes out-of-season entries and includes in-season ones', () => {
    const fixture = [
      makeEntry({
        id: 'winter-only',
        months: [1],
        angleSeeds: [makeSeed({ id: 'seed-a' })],
      }),
      makeEntry({
        id: 'evergreen',
        months: null,
        angleSeeds: [makeSeed({ id: 'seed-b' })],
      }),
    ];

    // 2026-W29's Thursday falls in July.
    const julyResult = selectWeeklyTopics('2026-W29', 2, { entries: fixture });
    expect(julyResult.some(s => s.topicId === 'winter-only')).toBe(false);

    // 2026-W03's Thursday falls in January.
    const janResult = selectWeeklyTopics('2026-W03', 2, { entries: fixture });
    expect(janResult.some(s => s.topicId === 'winter-only')).toBe(true);
  });

  test('fewer qualifying slots than count returns fewer, not duplicates', () => {
    const fixture = [
      makeEntry({
        id: 'winter-only',
        months: [1],
        angleSeeds: [makeSeed({ id: 'seed-a' })],
      }),
    ];

    // 2026-W29's Thursday falls in July, so the single entry is out of season.
    const result = selectWeeklyTopics('2026-W29', 5, { entries: fixture });
    expect(result.length).toBe(0);
  });

  test('malformed weekIso throws TypeError', () => {
    expect(() => selectWeeklyTopics('not-a-week', 5)).toThrow(TypeError);
    expect(() => selectWeeklyTopics('2026-W99', 5)).toThrow(TypeError);
    expect(() => selectWeeklyTopics('2026-01', 5)).toThrow(TypeError);
  });
});

// ── bankVersion ───────────────────────────────────────────────────────────────

describe('bankVersion', () => {
  test('returns a 16-char hex string', () => {
    expect(bankVersion()).toMatch(/^[0-9a-f]{16}$/);
  });

  test('is stable across calls', () => {
    expect(bankVersion()).toBe(bankVersion());
  });
});

// ── stableStringify ───────────────────────────────────────────────────────────

describe('stableStringify', () => {
  test('object key order does not affect output', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  test('key order inside an array element does not affect output', () => {
    expect(stableStringify([{ a: 1, b: 2 }])).toBe(stableStringify([{ b: 2, a: 1 }]));
  });

  test('array order is significant', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});

// ── epochDeck ─────────────────────────────────────────────────────────────────

describe('epochDeck', () => {
  test('does not mutate its input array', () => {
    const slots = listSlots(TOPIC_BANK);
    const before = slots.map(s => `${s.topicId}:${s.seedId}`);

    const result = epochDeck(slots, 0, 'deadbeefdeadbeef');

    const after = slots.map(s => `${s.topicId}:${s.seedId}`);
    expect(after).toEqual(before);
    expect(result).not.toBe(slots);
  });
});
