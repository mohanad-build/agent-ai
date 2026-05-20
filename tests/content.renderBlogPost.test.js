'use strict';

const {
  renderBlogPost,
  BlogPostGenerationError,
  _internal,
} = require('../src/content/renderBlogPost');

const { buildBlogPostPrompt, validateBlogPost, assembleSections, parseSections } = _internal;

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeAngle(overrides = {}) {
  return {
    id:                'angle-2026-W20-001',
    weekStartIso:      '2026-05-11T00:00:00Z',
    headline:          'Bond yields soften while BoC holds steady',
    thesis:            'Five-year yields fell as the overnight rate held, signalling bond markets may be pricing in cuts the central bank has not announced.',
    dataPoints:        [{ metric: 'goc_5yr_yield', asOf: '2026-05-14' }],
    themeTag:          'rates',
    audienceFocus:     'both',
    bestSuitedFor:     ['blog'],
    forbidsRateAdvice: false,
    sourceFooter:      'Bank of Canada (May 14 2026)',
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

// Valid Claude response fixture -- word count ~608 (hook + all body paragraphs),
// within 550-850. Contains one Markdown link. No em/en-dashes, no forbidden terms,
// no banned AI-tell phrases. META 153 chars. Title 74 chars, contains "bond yields".
const VALID_CLAUDE_RESPONSE = [
  '# Bond yields in Canada: what the latest data means for fixed-rate borrowers',
  '',
  'When bond yields fall and the central bank does not move, the gap between those two signals is worth paying attention to. Five-year Government of Canada yields dropped twelve basis points over two weeks while the Bank of Canada held its overnight rate target unchanged. That disconnect matters because fixed mortgage rates in Canada are priced off bond yields, not the overnight rate. By the time the Bank of Canada makes an official announcement, the bond market has often been moving for weeks.',
  '',
  '## How bond yields drive fixed mortgage rates',
  '',
  'Fixed mortgage rates in Canada are priced off the Government of Canada five-year bond yield, not the Bank of Canada overnight rate. When a lender sets a five-year fixed rate, they start with what the government bond is yielding and add a spread that reflects their cost of funds and margin. The [Bank of Canada\'s overnight rate](https://www.bankofcanada.ca/core-functions/monetary-policy/) has a direct effect on prime-based variable rates, but for the fixed side of the market it is a secondary signal. Bond yields are the primary one.',
  '',
  'Bond yields move when investors adjust their expectations about future growth and inflation. When the market starts to collectively believe that rate cuts are coming, demand for government bonds increases, bond prices rise, and yields fall. This can happen well before any official announcement from the Bank of Canada. The two-week drop in five-year yields that the data shows is not a one-day blip. It is a signal that bond investors are repricing their expectations, and that repricing often shows up in fixed mortgage rates within a few weeks.',
  '',
  '## What a two-week yield drop actually signals',
  '',
  'A drop of twelve basis points over two weeks is not a dramatic number on its own, but context matters. It represents sustained directional movement, not noise. When yields decline steadily over multiple sessions while the overnight rate holds, bond investors are telling you something about where they think rates are heading. They are not reacting to a single data release. They are accumulating a position based on a broader view of the economic trajectory, and that view tends to have lead time on official policy decisions.',
  '',
  'For fixed-rate borrowers and prospective buyers, the implication is practical. If you are waiting for the Bank of Canada to announce a cut before you lock a fixed rate, you may be reacting to yesterday\'s news. Fixed rates at most lenders follow yields by days or weeks, not by announcement cycles. By the time the cut is official and in the headlines, lenders who were watching bond yields closely will have already repriced. Watching yields yourself gives you a timing advantage that waiting for news coverage does not.',
  '',
  '## What to do with this information if you are buying or renewing',
  '',
  'If your renewal window is opening in the next six months, or you are actively looking at a purchase, the current rate environment is worth monitoring weekly. This does not mean acting on every data point, and it does not mean trying to time the bottom of a rate cycle. It means knowing which numbers to watch and why. The five-year Government of Canada bond yield is publicly available and updated daily. Check it weekly alongside any conversation with your mortgage professional about locking versus floating.',
  '',
  'Understanding the relationship between bond yields and fixed mortgage rates is not about predicting where rates go. It is about knowing where to look for early signals. Most buyers and owners follow the Bank of Canada and nothing else, which means they are perpetually one cycle behind the data. If you want to make a more informed timing decision on your next purchase or renewal, start by tracking the five-year yield. If you want help translating that into a specific strategy, reach out and we can look at the numbers together.',
  '',
  '---',
  '',
  '**Sources:**',
  '- [Bank of Canada key policy rate](https://www.bankofcanada.ca/core-functions/monetary-policy/) -- as of 2026-05-14',
  '',
  'META: Five-year Government of Canada yields fell twelve basis points while the overnight rate held. Here is what that divergence means for buyers and renewers.',
  'KEYWORD: bond yields',
].join('\n');

const VALID_SECTIONS = {
  title:   'Bond yields in Canada: what the latest data means for fixed-rate borrowers',
  hook:    'When bond yields fall and the central bank does not move, the gap between those two signals is worth paying attention to. Five-year Government of Canada yields dropped twelve basis points over two weeks while the Bank of Canada held its overnight rate target unchanged. That disconnect matters because fixed mortgage rates in Canada are priced off bond yields, not the overnight rate. By the time the Bank of Canada makes an official announcement, the bond market has often been moving for weeks.',
  body: [
    {
      heading:    'How bond yields drive fixed mortgage rates',
      paragraphs: [
        'Fixed mortgage rates in Canada are priced off the Government of Canada five-year bond yield, not the Bank of Canada overnight rate. When a lender sets a five-year fixed rate, they start with what the government bond is yielding and add a spread that reflects their cost of funds and margin. The [Bank of Canada\'s overnight rate](https://www.bankofcanada.ca/core-functions/monetary-policy/) has a direct effect on prime-based variable rates, but for the fixed side of the market it is a secondary signal. Bond yields are the primary one.',
        'Bond yields move when investors adjust their expectations about future growth and inflation. When the market starts to collectively believe that rate cuts are coming, demand for government bonds increases, bond prices rise, and yields fall. This can happen well before any official announcement from the Bank of Canada. The two-week drop in five-year yields that the data shows is not a one-day blip. It is a signal that bond investors are repricing their expectations, and that repricing often shows up in fixed mortgage rates within a few weeks.',
      ],
    },
    {
      heading:    'What a two-week yield drop actually signals',
      paragraphs: [
        'A drop of twelve basis points over two weeks is not a dramatic number on its own, but context matters. It represents sustained directional movement, not noise. When yields decline steadily over multiple sessions while the overnight rate holds, bond investors are telling you something about where they think rates are heading. They are not reacting to a single data release. They are accumulating a position based on a broader view of the economic trajectory, and that view tends to have lead time on official policy decisions.',
        'For fixed-rate borrowers and prospective buyers, the implication is practical. If you are waiting for the Bank of Canada to announce a cut before you lock a fixed rate, you may be reacting to yesterday\'s news. Fixed rates at most lenders follow yields by days or weeks, not by announcement cycles. By the time the cut is official and in the headlines, lenders who were watching bond yields closely will have already repriced. Watching yields yourself gives you a timing advantage that waiting for news coverage does not.',
      ],
    },
    {
      heading:    'What to do with this information if you are buying or renewing',
      paragraphs: [
        'If your renewal window is opening in the next six months, or you are actively looking at a purchase, the current rate environment is worth monitoring weekly. This does not mean acting on every data point, and it does not mean trying to time the bottom of a rate cycle. It means knowing which numbers to watch and why. The five-year Government of Canada bond yield is publicly available and updated daily. Check it weekly alongside any conversation with your mortgage professional about locking versus floating.',
        'Understanding the relationship between bond yields and fixed mortgage rates is not about predicting where rates go. It is about knowing where to look for early signals. Most buyers and owners follow the Bank of Canada and nothing else, which means they are perpetually one cycle behind the data. If you want to make a more informed timing decision on your next purchase or renewal, start by tracking the five-year yield. If you want help translating that into a specific strategy, reach out and we can look at the numbers together.',
      ],
    },
  ],
  sources:         [{ name: 'Bank of Canada key policy rate', url: 'https://www.bankofcanada.ca/core-functions/monetary-policy/', asOfDate: '2026-05-14' }],
  metaDescription: 'Five-year Government of Canada yields fell twelve basis points while the overnight rate held. Here is what that divergence means for buyers and renewers.',
  targetKeyword:   'bond yields',
};

// Helper: build VALID_SECTIONS with a specific body prose word count.
// Distributes words across hook and two body sections, includes one Markdown link.
function makeSectionsForWc(n) {
  const hookCount = Math.ceil(n / 3);
  const para1Count = Math.floor(n / 3);
  const para2Count = n - hookCount - para1Count;
  const hook = '[link](https://example.com) ' + Array.from({ length: hookCount - 1 }, () => 'word').join(' ');
  const para1 = Array.from({ length: para1Count }, () => 'word').join(' ');
  const para2 = Array.from({ length: para2Count }, () => 'word').join(' ');
  return {
    ...VALID_SECTIONS,
    hook,
    body: [
      { heading: 'Section One', paragraphs: [para1] },
      { heading: 'Section Two', paragraphs: [para2] },
    ],
  };
}

// ── Input validation ──────────────────────────────────────────────────────────

describe('Input validation', () => {
  test('throws TypeError when angle is not an object', async () => {
    await expect(renderBlogPost({ angle: 'not-an-object', contentProfile: makeContentProfile() }))
      .rejects.toThrow(TypeError);
  });

  test('throws TypeError when angle is null', async () => {
    await expect(renderBlogPost({ angle: null, contentProfile: makeContentProfile() }))
      .rejects.toThrow(TypeError);
  });

  test('throws TypeError when angle.headline is missing', async () => {
    const angle = makeAngle();
    delete angle.headline;
    await expect(renderBlogPost({ angle, contentProfile: makeContentProfile() }))
      .rejects.toThrow(TypeError);
  });

  test('throws TypeError when angle.thesis is missing', async () => {
    const angle = makeAngle();
    delete angle.thesis;
    await expect(renderBlogPost({ angle, contentProfile: makeContentProfile() }))
      .rejects.toThrow(TypeError);
  });

  test('throws TypeError when contentProfile.voiceDescriptor is not a string', async () => {
    await expect(renderBlogPost({
      angle:          makeAngle(),
      contentProfile: makeContentProfile({ voiceDescriptor: 42 }),
    })).rejects.toThrow(TypeError);
  });

  test('throws TypeError when contentProfile.forbiddenTerms is not an array', async () => {
    await expect(renderBlogPost({
      angle:          makeAngle(),
      contentProfile: makeContentProfile({ forbiddenTerms: 'no-guarantees' }),
    })).rejects.toThrow(TypeError);
  });

  test('throws TypeError when contentProfile.forbiddenTopics is not an array', async () => {
    await expect(renderBlogPost({
      angle:          makeAngle(),
      contentProfile: makeContentProfile({ forbiddenTopics: 'rate predictions' }),
    })).rejects.toThrow(TypeError);
  });
});

// ── parseSections ─────────────────────────────────────────────────────────────

describe('parseSections', () => {
  test('parses well-formed Markdown into all required sections', () => {
    const result = parseSections(VALID_CLAUDE_RESPONSE);
    expect(result).not.toBeNull();
    expect(result.title).toBe(VALID_SECTIONS.title);
    expect(result.hook).toBe(VALID_SECTIONS.hook);
    expect(result.body).toHaveLength(3);
    expect(result.body[0].heading).toBe(VALID_SECTIONS.body[0].heading);
    expect(result.body[0].paragraphs).toEqual(VALID_SECTIONS.body[0].paragraphs);
    expect(result.body[2].heading).toBe(VALID_SECTIONS.body[2].heading);
    expect(result.sources).toEqual(VALID_SECTIONS.sources);
    expect(result.metaDescription).toBe(VALID_SECTIONS.metaDescription);
    expect(result.targetKeyword).toBe(VALID_SECTIONS.targetKeyword);
  });

  test('returns null when title (# line) is missing', () => {
    const noTitle = VALID_CLAUDE_RESPONSE.replace(
      '# Bond yields in Canada: what the latest data means for fixed-rate borrowers\n',
      ''
    );
    expect(parseSections(noTitle)).toBeNull();
  });

  test('returns null when no H2 sections are present', () => {
    const noH2 = VALID_CLAUDE_RESPONSE
      .replace(/^## .+$/gm, '')
      .replace(/\n{3,}/g, '\n\n');
    expect(parseSections(noH2)).toBeNull();
  });

  test('returns null when sources block (**Sources:**) is missing', () => {
    const noSources = VALID_CLAUDE_RESPONSE
      .replace('\n**Sources:**\n', '\n')
      .replace('- [Bank of Canada key policy rate](https://www.bankofcanada.ca/core-functions/monetary-policy/) -- as of 2026-05-14\n', '');
    expect(parseSections(noSources)).toBeNull();
  });

  test('returns null when META line is missing', () => {
    const noMeta = VALID_CLAUDE_RESPONSE.replace(
      /^META: .+$/m, ''
    );
    expect(parseSections(noMeta)).toBeNull();
  });

  test('returns null when KEYWORD line is missing', () => {
    const noKeyword = VALID_CLAUDE_RESPONSE.replace(
      /^KEYWORD: .+$/m, ''
    );
    expect(parseSections(noKeyword)).toBeNull();
  });

  test('tolerates trailing whitespace on H2 headers', () => {
    const withTrailing = VALID_CLAUDE_RESPONSE
      .replace('## How bond yields drive fixed mortgage rates', '## How bond yields drive fixed mortgage rates   ')
      .replace('## What a two-week yield drop actually signals', '## What a two-week yield drop actually signals  ');
    const result = parseSections(withTrailing);
    expect(result).not.toBeNull();
    expect(result.body[0].heading).toBe('How bond yields drive fixed mortgage rates');
    expect(result.body[1].heading).toBe('What a two-week yield drop actually signals');
  });

  test('tolerates extra blank lines between sections', () => {
    const withExtraBlanks = VALID_CLAUDE_RESPONSE
      .replace('## How bond yields drive fixed mortgage rates\n', '## How bond yields drive fixed mortgage rates\n\n\n')
      .replace('\n## What a two-week', '\n\n\n## What a two-week');
    const result = parseSections(withExtraBlanks);
    expect(result).not.toBeNull();
    expect(result.body).toHaveLength(3);
    expect(result.hook).toBe(VALID_SECTIONS.hook);
  });

  test('case-insensitive matching of META, KEYWORD, and **Sources:**', () => {
    const lowercased = VALID_CLAUDE_RESPONSE
      .replace('**Sources:**', '**sources:**')
      .replace(/^META: /m, 'meta: ')
      .replace(/^KEYWORD: /m, 'keyword: ');
    const result = parseSections(lowercased);
    expect(result).not.toBeNull();
    expect(result.metaDescription).toBe(VALID_SECTIONS.metaDescription);
    expect(result.targetKeyword).toBe(VALID_SECTIONS.targetKeyword);
    expect(result.sources).toEqual(VALID_SECTIONS.sources);
  });

  test('parses exactly 2 H2 sections correctly', () => {
    const twoSection = [
      '# Bond yields in Canada: what the latest data means for fixed-rate borrowers',
      '',
      VALID_SECTIONS.hook,
      '',
      '## How bond yields drive fixed mortgage rates',
      '',
      VALID_SECTIONS.body[0].paragraphs[0],
      '',
      '## What a two-week yield drop actually signals',
      '',
      VALID_SECTIONS.body[1].paragraphs[0],
      '',
      '---',
      '',
      '**Sources:**',
      '- [Bank of Canada key policy rate](https://www.bankofcanada.ca/core-functions/monetary-policy/) -- as of 2026-05-14',
      '',
      'META: Five-year Government of Canada yields fell twelve basis points while the overnight rate held. Here is what that divergence means for buyers and renewers.',
      'KEYWORD: bond yields',
    ].join('\n');
    const result = parseSections(twoSection);
    expect(result).not.toBeNull();
    expect(result.body).toHaveLength(2);
    expect(result.body[0].heading).toBe('How bond yields drive fixed mortgage rates');
    expect(result.body[1].heading).toBe('What a two-week yield drop actually signals');
  });

  test('parses exactly 4 H2 sections correctly', () => {
    const fourSection = [
      '# Bond yields in Canada: what the latest data means for fixed-rate borrowers',
      '',
      VALID_SECTIONS.hook,
      '',
      '## Section One',
      '',
      'First section paragraph.',
      '',
      '## Section Two',
      '',
      'Second section paragraph.',
      '',
      '## Section Three',
      '',
      'Third section paragraph.',
      '',
      '## Section Four',
      '',
      'Fourth section paragraph.',
      '',
      '---',
      '',
      '**Sources:**',
      '- [Bank of Canada key policy rate](https://www.bankofcanada.ca/core-functions/monetary-policy/) -- as of 2026-05-14',
      '',
      'META: Five-year Government of Canada yields fell twelve basis points while the overnight rate held. Here is what that divergence means for buyers and renewers.',
      'KEYWORD: bond yields',
    ].join('\n');
    const result = parseSections(fourSection);
    expect(result).not.toBeNull();
    expect(result.body).toHaveLength(4);
    expect(result.body[3].heading).toBe('Section Four');
  });
});

// ── validateBlogPost ──────────────────────────────────────────────────────────

describe('validateBlogPost', () => {
  const angle = makeAngle();
  const contentProfile = makeContentProfile();

  test('returns valid for a clean fixture', () => {
    const result = validateBlogPost(VALID_SECTIONS, { angle, contentProfile });
    expect(result.valid).toBe(true);
  });

  test('rejects when body prose word count is below 550', () => {
    const sections = makeSectionsForWc(549);
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('below minimum 550'))).toBe(true);
  });

  test('rejects when body prose word count is above 850', () => {
    const sections = makeSectionsForWc(851);
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('exceeds maximum 850'))).toBe(true);
  });

  test('accepts exactly 550 words (lower boundary)', () => {
    const sections = makeSectionsForWc(550);
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(true);
  });

  test('accepts exactly 850 words (upper boundary)', () => {
    const sections = makeSectionsForWc(850);
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(true);
  });

  test('rejects when em-dash is present in assembled text', () => {
    const sections = { ...VALID_SECTIONS, hook: VALID_SECTIONS.hook + ' Bond yields' + '—' + 'important signal.' };
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('em-dash'))).toBe(true);
  });

  test('rejects when en-dash is present in assembled text', () => {
    const sections = { ...VALID_SECTIONS, hook: VALID_SECTIONS.hook + ' Rates' + '–' + 'weekly.' };
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('en-dash'))).toBe(true);
  });

  test('rejects when a forbidden term appears in text (case-insensitive)', () => {
    const sections = { ...VALID_SECTIONS, hook: 'GUARANTEED returns on your real estate investment. ' + VALID_SECTIONS.hook };
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"guaranteed"'))).toBe(true);
  });

  test('rejects when a forbidden topic appears in text', () => {
    const sections = { ...VALID_SECTIONS, hook: 'I make specific rate predictions every week. ' + VALID_SECTIONS.hook };
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"specific rate predictions"'))).toBe(true);
  });

  test('rejects when "in conclusion" appears in text', () => {
    const sections = { ...VALID_SECTIONS, hook: 'In conclusion, rates are shifting. ' + VALID_SECTIONS.hook };
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('in conclusion'))).toBe(true);
  });

  test('rejects when "it\'s worth noting" appears in text', () => {
    const sections = { ...VALID_SECTIONS, hook: "It's worth noting that rates shifted. " + VALID_SECTIONS.hook };
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("it's worth noting"))).toBe(true);
  });

  test('rejects "navigating the housing market" (regex pattern)', () => {
    const sections = { ...VALID_SECTIONS, hook: 'Buyers navigating the housing market need data. ' + VALID_SECTIONS.hook };
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('navigating the [x] market'))).toBe(true);
  });

  test('"landscape" does NOT fail validation (prompt-level only)', () => {
    const sections = { ...VALID_SECTIONS, hook: 'The real estate landscape shifted last month. ' + VALID_SECTIONS.hook };
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(true);
  });

  test('rejects when body section count is 1', () => {
    const sections = { ...VALID_SECTIONS, body: [VALID_SECTIONS.body[0]] };
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('below minimum 2'))).toBe(true);
  });

  test('rejects when body section count is 5', () => {
    const extraSection = { heading: 'Extra section', paragraphs: ['Extra paragraph.'] };
    const sections = { ...VALID_SECTIONS, body: [...VALID_SECTIONS.body, extraSection, extraSection] };
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('exceeds maximum 4'))).toBe(true);
  });

  test('accepts body section count of 2', () => {
    const twoSections = makeSectionsForWc(600);
    const result = validateBlogPost(twoSections, { angle, contentProfile });
    expect(result.valid).toBe(true);
  });

  test('accepts body section count of 4', () => {
    const fourBodySections = [
      VALID_SECTIONS.body[0],
      VALID_SECTIONS.body[1],
      VALID_SECTIONS.body[2],
      { heading: 'Fourth section', paragraphs: ['Fourth paragraph text here and more words to be sure.'] },
    ];
    const sections = { ...VALID_SECTIONS, body: fourBodySections };
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(true);
  });

  test('rejects when body contains no Markdown link', () => {
    const noLink = {
      ...VALID_SECTIONS,
      hook: 'No links in this hook paragraph at all, just plain text words.',
      body: VALID_SECTIONS.body.map(s => ({
        heading:    s.heading,
        paragraphs: s.paragraphs.map(p => p.replace(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g, 'the Bank of Canada rate')),
      })),
    };
    const result = validateBlogPost(noLink, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('no Markdown link'))).toBe(true);
  });

  test('rejects when sources block is empty', () => {
    const sections = { ...VALID_SECTIONS, sources: [] };
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('sources block is empty'))).toBe(true);
  });

  test('rejects when title exceeds 80 characters', () => {
    const sections = { ...VALID_SECTIONS, title: 'A'.repeat(81) };
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('exceeds 80 characters'))).toBe(true);
  });

  test('rejects when metaDescription is 99 characters', () => {
    const sections = { ...VALID_SECTIONS, metaDescription: 'A'.repeat(99) };
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('below minimum'))).toBe(true);
  });

  test('accepts metaDescription of exactly 100 characters', () => {
    const sections = { ...VALID_SECTIONS, metaDescription: 'A'.repeat(100) };
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(true);
  });

  test('rejects when metaDescription is 161 characters', () => {
    const sections = { ...VALID_SECTIONS, metaDescription: 'A'.repeat(161) };
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('exceeds maximum 160'))).toBe(true);
  });

  test('accepts metaDescription of exactly 140 characters', () => {
    const sections = { ...VALID_SECTIONS, metaDescription: 'A'.repeat(140) };
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(true);
  });

  test('accepts metaDescription of exactly 160 characters', () => {
    const sections = { ...VALID_SECTIONS, metaDescription: 'A'.repeat(160) };
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(true);
  });

  test('rejects when targetKeyword is empty', () => {
    const sections = { ...VALID_SECTIONS, targetKeyword: '' };
    const result = validateBlogPost(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('targetKeyword is empty'))).toBe(true);
  });

  test('RATE_DISCLAIMER_BLOCK presence enforced when forbidsRateAdvice true', () => {
    const rateAngle = makeAngle({ forbidsRateAdvice: true });
    const result = validateBlogPost(VALID_SECTIONS, { angle: rateAngle, contentProfile });
    expect(result.valid).toBe(true);
  });
});

// ── assembleSections ──────────────────────────────────────────────────────────

describe('assembleSections', () => {
  test('produces correctly formatted Markdown with title, hook, H2 sections, sources', () => {
    const text = assembleSections(VALID_SECTIONS, { forbidsRateAdvice: false });
    expect(text).toMatch(/^# Bond yields in Canada/);
    expect(text).toContain('## How bond yields drive fixed mortgage rates');
    expect(text).toContain('## What a two-week yield drop actually signals');
    expect(text).toContain('## What to do with this information if you are buying or renewing');
    expect(text).toContain('**Sources:**');
    expect(text).toContain('---');
  });

  test('appends rate disclaimer before --- when forbidsRateAdvice is true', () => {
    const text = assembleSections(VALID_SECTIONS, { forbidsRateAdvice: true });
    expect(text).toContain('*Not financial or rate advice. Consult a licensed mortgage professional for personal guidance.*');
    const disclaimerIdx = text.indexOf('*Not financial or rate advice');
    const separatorIdx  = text.indexOf('---');
    expect(disclaimerIdx).toBeLessThan(separatorIdx);
  });

  test('does NOT append rate disclaimer when forbidsRateAdvice is false', () => {
    const text = assembleSections(VALID_SECTIONS, { forbidsRateAdvice: false });
    expect(text).not.toContain('*Not financial or rate advice');
  });

  test('2 H2 sections render correctly', () => {
    const twoBody = [VALID_SECTIONS.body[0], VALID_SECTIONS.body[1]];
    const sections = { ...VALID_SECTIONS, body: twoBody };
    const text = assembleSections(sections, { forbidsRateAdvice: false });
    expect(text).toContain('## How bond yields drive fixed mortgage rates');
    expect(text).toContain('## What a two-week yield drop actually signals');
    expect(text).not.toContain('## What to do with this information');
  });

  test('4 H2 sections render correctly', () => {
    const fourBody = [...VALID_SECTIONS.body, { heading: 'Extra section', paragraphs: ['Extra paragraph.'] }];
    const sections = { ...VALID_SECTIONS, body: fourBody };
    const text = assembleSections(sections, { forbidsRateAdvice: false });
    expect(text).toContain('## Extra section');
    expect(text).toContain('Extra paragraph.');
  });

  test('sources rendered as - [name](url) -- as of date lines', () => {
    const text = assembleSections(VALID_SECTIONS, { forbidsRateAdvice: false });
    expect(text).toContain('- [Bank of Canada key policy rate](https://www.bankofcanada.ca/core-functions/monetary-policy/) -- as of 2026-05-14');
  });

  test('does NOT include META or KEYWORD lines in output', () => {
    const text = assembleSections(VALID_SECTIONS, { forbidsRateAdvice: false });
    expect(text).not.toMatch(/^META:/m);
    expect(text).not.toMatch(/^KEYWORD:/m);
  });

  test('paragraphs within a section are joined with blank line between them', () => {
    const text = assembleSections(VALID_SECTIONS, { forbidsRateAdvice: false });
    const para1 = VALID_SECTIONS.body[0].paragraphs[0];
    const para2 = VALID_SECTIONS.body[0].paragraphs[1];
    expect(text).toContain(para1 + '\n\n' + para2);
  });
});

// ── renderBlogPost ────────────────────────────────────────────────────────────

describe('renderBlogPost', () => {
  test('happy path: mocked callRaw returns valid post, returns expected shape', async () => {
    const callRaw = jest.fn().mockResolvedValue(VALID_CLAUDE_RESPONSE);
    const result  = await renderBlogPost({ angle: makeAngle(), contentProfile: makeContentProfile(), opts: { callRaw } });

    expect(result.model).toBe('claude-sonnet-4-6');
    expect(typeof result.generatedAt).toBe('string');
    expect(typeof result.text).toBe('string');
    expect(result.sections.title).toBe(VALID_SECTIONS.title);
    expect(result.sections.hook).toBe(VALID_SECTIONS.hook);
    expect(result.sections.body).toHaveLength(3);
    expect(result.sections.sources).toEqual(VALID_SECTIONS.sources);
    expect(result.sections.metaDescription).toBe(VALID_SECTIONS.metaDescription);
    expect(result.sections.targetKeyword).toBe(VALID_SECTIONS.targetKeyword);
    expect(callRaw).toHaveBeenCalledTimes(1);
  });

  test('generatedAt is a valid ISO string within the last 5 seconds', async () => {
    const callRaw = jest.fn().mockResolvedValue(VALID_CLAUDE_RESPONSE);
    const before  = Date.now();
    const result  = await renderBlogPost({ angle: makeAngle(), contentProfile: makeContentProfile(), opts: { callRaw } });
    const after   = Date.now();

    const ts = new Date(result.generatedAt).getTime();
    expect(isNaN(ts)).toBe(false);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 100);
  });

  test('parse failure on first call, valid on retry: returns successfully', async () => {
    const callRaw = jest.fn()
      .mockResolvedValueOnce('not a valid blog post response at all')
      .mockResolvedValueOnce(VALID_CLAUDE_RESPONSE);
    const result = await renderBlogPost({ angle: makeAngle(), contentProfile: makeContentProfile(), opts: { callRaw } });

    expect(result.sections.title).toBe(VALID_SECTIONS.title);
    expect(callRaw).toHaveBeenCalledTimes(2);
  });

  test('parse failure on both calls: throws BlogPostGenerationError with cause', async () => {
    const callRaw = jest.fn().mockResolvedValue('no valid markdown here at all');
    await expect(
      renderBlogPost({ angle: makeAngle(), contentProfile: makeContentProfile(), opts: { callRaw } })
    ).rejects.toMatchObject({
      name:  'BlogPostGenerationError',
      cause: expect.any(Error),
    });
    expect(callRaw).toHaveBeenCalledTimes(2);
  });

  test('validation failure on first call, valid on retry: returns successfully', async () => {
    const invalidResponse = VALID_CLAUDE_RESPONSE.replace(
      'When bond yields fall and the central bank does not move',
      'When bond yields fall and the central bank does not move' + '—' + 'and rates shift'
    );
    const callRaw = jest.fn()
      .mockResolvedValueOnce(invalidResponse)
      .mockResolvedValueOnce(VALID_CLAUDE_RESPONSE);
    const result = await renderBlogPost({ angle: makeAngle(), contentProfile: makeContentProfile(), opts: { callRaw } });

    expect(result.sections.hook).toBe(VALID_SECTIONS.hook);
    expect(callRaw).toHaveBeenCalledTimes(2);
  });

  test('validation failure on both calls: throws BlogPostGenerationError with validationErrors populated', async () => {
    const invalidResponse = VALID_CLAUDE_RESPONSE.replace(
      'When bond yields fall and the central bank does not move',
      'When bond yields fall and the central bank does not move' + '—' + 'and rates shift'
    );
    const callRaw = jest.fn().mockResolvedValue(invalidResponse);
    let err;
    try {
      await renderBlogPost({ angle: makeAngle(), contentProfile: makeContentProfile(), opts: { callRaw } });
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(BlogPostGenerationError);
    expect(Array.isArray(err.validationErrors)).toBe(true);
    expect(err.validationErrors.length).toBeGreaterThan(0);
    expect(callRaw).toHaveBeenCalledTimes(2);
  });

  test('forbidsRateAdvice true: assembled text includes RATE_DISCLAIMER_BLOCK', async () => {
    const callRaw = jest.fn().mockResolvedValue(VALID_CLAUDE_RESPONSE);
    const result  = await renderBlogPost({
      angle:          makeAngle({ forbidsRateAdvice: true }),
      contentProfile: makeContentProfile(),
      opts:           { callRaw },
    });

    expect(result.text).toContain('*Not financial or rate advice. Consult a licensed mortgage professional for personal guidance.*');
  });

  test('forbidden term in first Claude output triggers retry and succeeds on clean second response', async () => {
    const dirtyResponse = VALID_CLAUDE_RESPONSE.replace(
      'When bond yields fall and the central bank does not move',
      'Rates are not guaranteed to hold at current levels.'
    );
    const callRaw = jest.fn()
      .mockResolvedValueOnce(dirtyResponse)
      .mockResolvedValueOnce(VALID_CLAUDE_RESPONSE);
    const result = await renderBlogPost({ angle: makeAngle(), contentProfile: makeContentProfile(), opts: { callRaw } });

    expect(result.sections.hook).toBe(VALID_SECTIONS.hook);
    expect(callRaw).toHaveBeenCalledTimes(2);
  });
});
