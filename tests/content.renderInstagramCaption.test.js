'use strict';

const {
  renderInstagramCaption,
  InstagramCaptionGenerationError,
  _internal,
} = require('../src/content/renderInstagramCaption');

const { buildInstagramCaptionPrompt, validateInstagramCaption, parseSections, assembleSections } = _internal;

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeAngle(overrides = {}) {
  return {
    id:               'angle-2026-W20-001',
    weekStartIso:     '2026-05-11T00:00:00Z',
    headline:         'Bond yields soften while BoC holds steady',
    thesis:           'Five-year yields fell as the overnight rate held, signalling bond markets may be pricing in cuts the central bank has not announced.',
    dataPoints:       [{ metric: 'goc_5yr_yield', asOf: '2026-05-14' }],
    themeTag:         'rates',
    audienceFocus:    'both',
    forbidsRateAdvice: false,
    sourceFooter:     'Bank of Canada (May 14 2026)',
    ...overrides,
  };
}

function makeContentProfile(overrides = {}) {
  return {
    voiceDescriptor:  'Direct and data-driven. Short punchy sentences. No fluff. Speaks to buyers and sellers as intelligent adults.',
    forbiddenTerms:   ['guaranteed', 'best time to buy'],
    forbiddenTopics:  ['specific rate predictions'],
    ...overrides,
  };
}

function makeReelScript() {
  return [
    'HOOK (0-5s):',
    'The bond market just moved, and your mortgage could follow.',
    '',
    'BODY (5s-60s):',
    'Five-year government yields dropped twelve basis points in two weeks. The Bank of Canada held its overnight rate the whole time.',
    '',
    'CTA (60-75s):',
    'Follow me for weekly market updates. I track the numbers so you do not have to.',
    '',
    'B-ROLL SUGGESTIONS:',
    '- Five-year yield chart showing two-week decline',
    '',
    'SOURCES:',
    'Bank of Canada (May 14 2026)',
  ].join('\n');
}

// Valid Claude response fixture used across many tests.
// Hook: 93 chars, within 125 limit.
// Paragraphs: 2 paragraphs, prose total ~87 words, within 80-220.
// Hashtags: 12, within 10-15.
// No em-dashes, no forbidden terms, no forbidden topics.
const VALID_CLAUDE_RESPONSE = [
  'HOOK:',
  'Five-year yields dropped while the Bank of Canada held steady. Fixed rates could follow soon.',
  '',
  'PARAGRAPHS:',
  'Bond yields fell twelve basis points in two weeks. The overnight rate did not move. Those two things moving independently is the signal worth watching.',
  '',
  'Fixed mortgage rates track bond yields, not the overnight rate. If yields hold here or fall further, fixed rates could shift before the next Bank of Canada announcement. This is worth knowing before you make any timing decision.',
  '',
  'CTA:',
  'Follow for weekly data. DM me with questions.',
  '',
  'HASHTAGS:',
  '#TorontoRealEstate #CanadianMortgage #BondYields #FixedRates #TorontoHousing #MortgageRates #RealEstateTips #HomeOwnership #TorontoHomes #RealEstateCanada #HousingMarket #BuyersTips',
].join('\n');

const VALID_SECTIONS = {
  hook: 'Five-year yields dropped while the Bank of Canada held steady. Fixed rates could follow soon.',
  paragraphs: [
    'Bond yields fell twelve basis points in two weeks. The overnight rate did not move. Those two things moving independently is the signal worth watching.',
    'Fixed mortgage rates track bond yields, not the overnight rate. If yields hold here or fall further, fixed rates could shift before the next Bank of Canada announcement. This is worth knowing before you make any timing decision.',
  ],
  cta: 'Follow for weekly data. DM me with questions.',
  hashtags: [
    '#TorontoRealEstate', '#CanadianMortgage', '#BondYields', '#FixedRates',
    '#TorontoHousing', '#MortgageRates', '#RealEstateTips', '#HomeOwnership',
    '#TorontoHomes', '#RealEstateCanada', '#HousingMarket', '#BuyersTips',
  ],
};

// ── Input validation ──────────────────────────────────────────────────────────

describe('Input validation', () => {
  test('throws TypeError when angle is null', async () => {
    await expect(renderInstagramCaption({
      angle: null,
      contentProfile: makeContentProfile(),
      reelScript: makeReelScript(),
    })).rejects.toThrow(TypeError);
  });

  test('throws TypeError when angle.headline is missing', async () => {
    const angle = makeAngle();
    delete angle.headline;
    await expect(renderInstagramCaption({
      angle,
      contentProfile: makeContentProfile(),
      reelScript: makeReelScript(),
    })).rejects.toThrow(TypeError);
  });

  test('throws TypeError when angle.thesis is missing', async () => {
    const angle = makeAngle();
    delete angle.thesis;
    await expect(renderInstagramCaption({
      angle,
      contentProfile: makeContentProfile(),
      reelScript: makeReelScript(),
    })).rejects.toThrow(TypeError);
  });

  test('throws TypeError when contentProfile.voiceDescriptor is not a string', async () => {
    await expect(renderInstagramCaption({
      angle: makeAngle(),
      contentProfile: makeContentProfile({ voiceDescriptor: 42 }),
      reelScript: makeReelScript(),
    })).rejects.toThrow(TypeError);
  });

  test('throws TypeError when contentProfile.forbiddenTerms is not an array', async () => {
    await expect(renderInstagramCaption({
      angle: makeAngle(),
      contentProfile: makeContentProfile({ forbiddenTerms: 'no-guarantees' }),
      reelScript: makeReelScript(),
    })).rejects.toThrow(TypeError);
  });

  test('throws TypeError when reelScript is not a non-empty string', async () => {
    await expect(renderInstagramCaption({
      angle: makeAngle(),
      contentProfile: makeContentProfile(),
      reelScript: '',
    })).rejects.toThrow(TypeError);
  });

  test('throws TypeError when angle.sourceFooter is undefined', async () => {
    const angle = makeAngle();
    delete angle.sourceFooter;
    await expect(renderInstagramCaption({
      angle,
      contentProfile: makeContentProfile(),
      reelScript: makeReelScript(),
    })).rejects.toThrow(TypeError);
  });

  test('throws TypeError when angle.sourceFooter is an empty string', async () => {
    await expect(renderInstagramCaption({
      angle: makeAngle({ sourceFooter: '' }),
      contentProfile: makeContentProfile(),
      reelScript: makeReelScript(),
    })).rejects.toThrow(TypeError);
  });

  test('accepts null angle.sourceFooter without throwing a TypeError', async () => {
    const callRaw = jest.fn().mockResolvedValue(VALID_CLAUDE_RESPONSE);
    const angle   = makeAngle({ sourceFooter: null });
    await expect(
      renderInstagramCaption({
        angle,
        contentProfile: makeContentProfile(),
        reelScript: makeReelScript(),
        opts: { callRaw },
      })
    ).resolves.toBeDefined();
  });
});

// ── parseSections ─────────────────────────────────────────────────────────────

describe('parseSections', () => {
  test('parses well-formed Claude output into all four sections', () => {
    const result = parseSections(VALID_CLAUDE_RESPONSE);
    expect(result).not.toBeNull();
    expect(result.hook).toBe(VALID_SECTIONS.hook);
    expect(result.paragraphs).toEqual(VALID_SECTIONS.paragraphs);
    expect(result.cta).toBe(VALID_SECTIONS.cta);
    expect(result.hashtags).toEqual(VALID_SECTIONS.hashtags);
  });

  test('returns null when HOOK section is missing', () => {
    const noHook = VALID_CLAUDE_RESPONSE
      .replace('HOOK:\n', '')
      .replace('Five-year yields dropped while the Bank of Canada held steady. Fixed rates could follow soon.\n', '');
    expect(parseSections(noHook)).toBeNull();
  });

  test('returns null when HASHTAGS section is missing', () => {
    const noHashtags = VALID_CLAUDE_RESPONSE
      .replace('\nHASHTAGS:', '')
      .replace('\n#TorontoRealEstate #CanadianMortgage #BondYields #FixedRates #TorontoHousing #MortgageRates #RealEstateTips #HomeOwnership #TorontoHomes #RealEstateCanada #HousingMarket #BuyersTips', '');
    expect(parseSections(noHashtags)).toBeNull();
  });

  test('returns null when PARAGRAPHS yields zero paragraphs after splitting', () => {
    const emptyParas = VALID_CLAUDE_RESPONSE
      .replace(
        'Bond yields fell twelve basis points in two weeks. The overnight rate did not move. Those two things moving independently is the signal worth watching.',
        ''
      )
      .replace(
        'Fixed mortgage rates track bond yields, not the overnight rate. If yields hold here or fall further, fixed rates could shift before the next Bank of Canada announcement. This is worth knowing before you make any timing decision.',
        ''
      );
    expect(parseSections(emptyParas)).toBeNull();
  });

  test('tolerates case-insensitive section headers', () => {
    const lowercased = VALID_CLAUDE_RESPONSE
      .replace('HOOK:', 'hook:')
      .replace('PARAGRAPHS:', 'paragraphs:')
      .replace('CTA:', 'cta:')
      .replace('HASHTAGS:', 'hashtags:');
    const result = parseSections(lowercased);
    expect(result).not.toBeNull();
    expect(result.hook).toBe(VALID_SECTIONS.hook);
    expect(result.paragraphs).toEqual(VALID_SECTIONS.paragraphs);
  });

  test('tolerates trailing whitespace on section headers', () => {
    const withTrailing = VALID_CLAUDE_RESPONSE
      .replace('HOOK:', 'HOOK:   ')
      .replace('PARAGRAPHS:', 'PARAGRAPHS:  ')
      .replace('HASHTAGS:', 'HASHTAGS:  ');
    const result = parseSections(withTrailing);
    expect(result).not.toBeNull();
    expect(result.hook).toBe(VALID_SECTIONS.hook);
    expect(result.hashtags).toEqual(VALID_SECTIONS.hashtags);
  });

  test('splits hashtags correctly when separated by tabs or multiple spaces', () => {
    const tabHashtags = VALID_CLAUDE_RESPONSE.replace(
      '#TorontoRealEstate #CanadianMortgage #BondYields #FixedRates #TorontoHousing #MortgageRates #RealEstateTips #HomeOwnership #TorontoHomes #RealEstateCanada #HousingMarket #BuyersTips',
      '#TorontoRealEstate\t#CanadianMortgage  #BondYields   #FixedRates #TorontoHousing #MortgageRates #RealEstateTips #HomeOwnership #TorontoHomes #RealEstateCanada #HousingMarket #BuyersTips'
    );
    const result = parseSections(tabHashtags);
    expect(result).not.toBeNull();
    expect(result.hashtags).toEqual(VALID_SECTIONS.hashtags);
  });
});

// ── validateInstagramCaption ──────────────────────────────────────────────────

describe('validateInstagramCaption', () => {
  const angle = makeAngle();
  const contentProfile = makeContentProfile();

  test('returns valid for a clean caption', () => {
    const result = validateInstagramCaption(VALID_SECTIONS, { angle, contentProfile });
    expect(result.valid).toBe(true);
  });

  test('rejects when hook length is 126 characters', () => {
    const longHook = 'A'.repeat(126);
    const sections = { ...VALID_SECTIONS, hook: longHook };
    const result = validateInstagramCaption(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('exceeds 125 characters'))).toBe(true);
  });

  test('accepts when hook length is exactly 125 characters', () => {
    const exactHook = 'A'.repeat(125);
    const sections = { ...VALID_SECTIONS, hook: exactHook };
    const result = validateInstagramCaption(sections, { angle, contentProfile });
    // hook length is fine; prose word count may be below minimum with single-char words
    expect(result.errors.every(e => !e.includes('exceeds 125 characters'))).toBe(true);
  });

  test('rejects when hook contains a newline character', () => {
    const sections = { ...VALID_SECTIONS, hook: 'First line.\nSecond line.' };
    const result = validateInstagramCaption(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('newline'))).toBe(true);
  });

  test('rejects when paragraphs has length 1', () => {
    const sections = { ...VALID_SECTIONS, paragraphs: ['Only one paragraph here.'] };
    const result = validateInstagramCaption(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('below minimum 2'))).toBe(true);
  });

  test('rejects when paragraphs has length 4', () => {
    const sections = {
      ...VALID_SECTIONS,
      paragraphs: ['Para one.', 'Para two.', 'Para three.', 'Para four.'],
    };
    const result = validateInstagramCaption(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('exceeds maximum 3'))).toBe(true);
  });

  test('rejects when hashtags has length 9', () => {
    const sections = {
      ...VALID_SECTIONS,
      hashtags: VALID_SECTIONS.hashtags.slice(0, 9),
    };
    const result = validateInstagramCaption(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('below minimum 10'))).toBe(true);
  });

  test('rejects when hashtags has length 16', () => {
    const sections = {
      ...VALID_SECTIONS,
      hashtags: [...VALID_SECTIONS.hashtags, '#ExtraTag1', '#ExtraTag2', '#ExtraTag3', '#ExtraTag4'],
    };
    const result = validateInstagramCaption(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('exceeds maximum 15'))).toBe(true);
  });

  test('rejects when a hashtag does not start with #', () => {
    const sections = {
      ...VALID_SECTIONS,
      hashtags: [...VALID_SECTIONS.hashtags.slice(0, 11), 'NoHashPrefix'],
    };
    const result = validateInstagramCaption(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('does not start with #'))).toBe(true);
  });

  test('rejects when a hashtag contains whitespace', () => {
    const sections = {
      ...VALID_SECTIONS,
      hashtags: [...VALID_SECTIONS.hashtags.slice(0, 11), '#Has Space'],
    };
    const result = validateInstagramCaption(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('contains whitespace'))).toBe(true);
  });

  test('rejects on duplicate hashtags (case-insensitive)', () => {
    const sections = {
      ...VALID_SECTIONS,
      hashtags: [...VALID_SECTIONS.hashtags.slice(0, 11), '#torontorealestate'],
    };
    const result = validateInstagramCaption(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('duplicate hashtag'))).toBe(true);
  });

  test('rejects when prose word count is below 80', () => {
    const sections = {
      ...VALID_SECTIONS,
      hook: 'Rates moved.',
      paragraphs: ['Bond yields fell.', 'Fixed rates may follow.'],
      cta: 'DM me.',
    };
    const result = validateInstagramCaption(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('below minimum 80'))).toBe(true);
  });

  test('rejects when prose word count is above 220', () => {
    const manyWords = Array.from({ length: 110 }, () => 'word').join(' ');
    const sections = { ...VALID_SECTIONS, paragraphs: [manyWords, manyWords] };
    const result = validateInstagramCaption(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('exceeds maximum 220'))).toBe(true);
  });

  test('rejects on em-dash present in assembled text', () => {
    const sections = { ...VALID_SECTIONS, cta: 'Follow me' + '—' + 'for updates.' };
    const result = validateInstagramCaption(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('em-dash or en-dash'))).toBe(true);
  });

  test('rejects on en-dash present in assembled text', () => {
    const sections = { ...VALID_SECTIONS, cta: 'Updates' + '–' + 'weekly.' };
    const result = validateInstagramCaption(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('em-dash or en-dash'))).toBe(true);
  });

  test('rejects on forbidden term in prose (case-insensitive)', () => {
    const sections = { ...VALID_SECTIONS, hook: 'GUARANTEED returns on your investment here.' };
    const result = validateInstagramCaption(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"guaranteed"'))).toBe(true);
  });

  test('rejects on forbidden topic in prose (case-insensitive)', () => {
    const sections = { ...VALID_SECTIONS, cta: 'I make specific rate predictions every week.' };
    const result = validateInstagramCaption(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"specific rate predictions"'))).toBe(true);
  });
});

// ── assembleSections ──────────────────────────────────────────────────────────

describe('assembleSections', () => {
  test('produces correctly formatted text with single blank lines between blocks', () => {
    const text = assembleSections(VALID_SECTIONS);
    expect(text).toMatch(/^Five-year yields dropped/);
    expect(text).toContain('Bond yields fell');
    expect(text).toContain('Follow for weekly data.');
    expect(text).toContain('#TorontoRealEstate');
    expect(text).toMatch(/hook.*\n\n.*paragraphs/si === null ? /Five-year yields.+\n\n.+Bond yields/s : /Five-year yields.+\n\nBond yields/s);
  });

  test('two-paragraph case renders correctly with single blank lines', () => {
    const text = assembleSections(VALID_SECTIONS);
    const lines = text.split('\n');
    const hookIdx = lines.indexOf(VALID_SECTIONS.hook);
    expect(hookIdx).toBe(0);
    expect(lines[hookIdx + 1]).toBe('');
    expect(lines[hookIdx + 2]).toBe(VALID_SECTIONS.paragraphs[0]);
    expect(lines[hookIdx + 3]).toBe('');
    expect(lines[hookIdx + 4]).toBe(VALID_SECTIONS.paragraphs[1]);
  });

  test('three-paragraph case renders correctly', () => {
    const threePara = {
      ...VALID_SECTIONS,
      paragraphs: ['Para one.', 'Para two.', 'Para three.'],
    };
    const text = assembleSections(threePara);
    const lines = text.split('\n');
    expect(lines[0]).toBe(VALID_SECTIONS.hook);
    expect(lines[2]).toBe('Para one.');
    expect(lines[4]).toBe('Para two.');
    expect(lines[6]).toBe('Para three.');
    expect(lines[7]).toBe('');
    expect(lines[8]).toBe(VALID_SECTIONS.cta);
  });

  test('hashtags appear as space-separated single line at the end', () => {
    const text = assembleSections(VALID_SECTIONS);
    const lastLine = text.split('\n').filter(l => l.trim()).pop();
    expect(lastLine).toBe(VALID_SECTIONS.hashtags.join(' '));
  });

  test('no rate disclaimer in output even when angle.forbidsRateAdvice is true', () => {
    const text = assembleSections(VALID_SECTIONS);
    expect(text).not.toContain('Not financial');
    expect(text).not.toContain('rate advice');
  });
});

// ── renderInstagramCaption ────────────────────────────────────────────────────

describe('renderInstagramCaption', () => {
  test('happy path: mocked Claude returns valid caption, returns expected shape', async () => {
    const callRaw = jest.fn().mockResolvedValue(VALID_CLAUDE_RESPONSE);
    const result = await renderInstagramCaption({
      angle: makeAngle(),
      contentProfile: makeContentProfile(),
      reelScript: makeReelScript(),
      opts: { callRaw },
    });

    expect(result.model).toBe('claude-sonnet-4-6');
    expect(typeof result.generatedAt).toBe('string');
    expect(typeof result.text).toBe('string');
    expect(result.sections.hook).toBe(VALID_SECTIONS.hook);
    expect(result.sections.paragraphs).toEqual(VALID_SECTIONS.paragraphs);
    expect(result.sections.cta).toBe(VALID_SECTIONS.cta);
    expect(result.sections.hashtags).toEqual(VALID_SECTIONS.hashtags);
    expect(callRaw).toHaveBeenCalledTimes(1);
  });

  test('generatedAt is a valid ISO string within the last 5 seconds', async () => {
    const callRaw = jest.fn().mockResolvedValue(VALID_CLAUDE_RESPONSE);
    const before = Date.now();
    const result = await renderInstagramCaption({
      angle: makeAngle(),
      contentProfile: makeContentProfile(),
      reelScript: makeReelScript(),
      opts: { callRaw },
    });
    const after = Date.now();

    const ts = new Date(result.generatedAt).getTime();
    expect(isNaN(ts)).toBe(false);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 100);
  });

  test('parse failure on first call, valid on retry: returns successfully', async () => {
    const callRaw = jest.fn()
      .mockResolvedValueOnce('not a valid ig caption response at all')
      .mockResolvedValueOnce(VALID_CLAUDE_RESPONSE);
    const result = await renderInstagramCaption({
      angle: makeAngle(),
      contentProfile: makeContentProfile(),
      reelScript: makeReelScript(),
      opts: { callRaw },
    });

    expect(result.sections.hook).toBe(VALID_SECTIONS.hook);
    expect(callRaw).toHaveBeenCalledTimes(2);
  });

  test('parse failure on both calls: throws InstagramCaptionGenerationError with cause', async () => {
    const callRaw = jest.fn().mockResolvedValue('no headers here at all');
    await expect(
      renderInstagramCaption({
        angle: makeAngle(),
        contentProfile: makeContentProfile(),
        reelScript: makeReelScript(),
        opts: { callRaw },
      })
    ).rejects.toMatchObject({
      name: 'InstagramCaptionGenerationError',
      cause: expect.any(Error),
    });
    expect(callRaw).toHaveBeenCalledTimes(2);
  });

  test('validation failure on first call (hook too long), valid on retry: returns successfully', async () => {
    const longHookResponse = VALID_CLAUDE_RESPONSE.replace(
      'Five-year yields dropped while the Bank of Canada held steady. Fixed rates could follow soon.',
      'A'.repeat(130)
    );
    const callRaw = jest.fn()
      .mockResolvedValueOnce(longHookResponse)
      .mockResolvedValueOnce(VALID_CLAUDE_RESPONSE);
    const result = await renderInstagramCaption({
      angle: makeAngle(),
      contentProfile: makeContentProfile(),
      reelScript: makeReelScript(),
      opts: { callRaw },
    });

    expect(result.sections.hook).toBe(VALID_SECTIONS.hook);
    expect(callRaw).toHaveBeenCalledTimes(2);
  });

  test('validation failure on both calls: throws InstagramCaptionGenerationError with validationErrors populated', async () => {
    const invalidResponse = VALID_CLAUDE_RESPONSE.replace(
      'Five-year yields dropped while the Bank of Canada held steady. Fixed rates could follow soon.',
      'A'.repeat(130)
    );
    const callRaw = jest.fn().mockResolvedValue(invalidResponse);
    let err;
    try {
      await renderInstagramCaption({
        angle: makeAngle(),
        contentProfile: makeContentProfile(),
        reelScript: makeReelScript(),
        opts: { callRaw },
      });
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(InstagramCaptionGenerationError);
    expect(Array.isArray(err.validationErrors)).toBe(true);
    expect(err.validationErrors.length).toBeGreaterThan(0);
    expect(callRaw).toHaveBeenCalledTimes(2);
  });

  test('forbidsRateAdvice true in angle does NOT add a disclaimer to the caption', async () => {
    const callRaw = jest.fn().mockResolvedValue(VALID_CLAUDE_RESPONSE);
    const result = await renderInstagramCaption({
      angle: makeAngle({ forbidsRateAdvice: true }),
      contentProfile: makeContentProfile(),
      reelScript: makeReelScript(),
      opts: { callRaw },
    });

    expect(result.text).not.toContain('Not financial');
    expect(result.text).not.toContain('rate advice');
  });

  test('forbidden term in first Claude output triggers retry and succeeds on clean second response', async () => {
    const dirtyResponse = VALID_CLAUDE_RESPONSE.replace(
      'Five-year yields dropped while the Bank of Canada held steady. Fixed rates could follow soon.',
      'Rates are not guaranteed to hold at this level, but the data is clear.'
    );
    const callRaw = jest.fn()
      .mockResolvedValueOnce(dirtyResponse)
      .mockResolvedValueOnce(VALID_CLAUDE_RESPONSE);
    const result = await renderInstagramCaption({
      angle: makeAngle(),
      contentProfile: makeContentProfile(),
      reelScript: makeReelScript(),
      opts: { callRaw },
    });

    expect(result.sections.hook).toBe(VALID_SECTIONS.hook);
    expect(callRaw).toHaveBeenCalledTimes(2);
  });

  test('strips em-dashes from raw model output before validation', async () => {
    const rawWithDash = VALID_CLAUDE_RESPONSE.replace(
      'Five-year yields dropped while the Bank of Canada held steady. Fixed rates could follow soon.',
      'Five-year yields dropped—while the Bank of Canada held steady. Fixed rates could follow soon.'
    );
    const callRaw = jest.fn().mockResolvedValue(rawWithDash);
    await expect(
      renderInstagramCaption({ angle: makeAngle(), contentProfile: makeContentProfile(), reelScript: makeReelScript(), opts: { callRaw } })
    ).resolves.not.toThrow();
  });
});
