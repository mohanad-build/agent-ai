'use strict';

const {
  renderReelScript,
  ReelScriptGenerationError,
  _internal,
} = require('../src/content/renderReelScript');

const { buildReelScriptPrompt, validateReelScript, assembleSections, parseSections } = _internal;

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
    bestSuitedFor:    ['reel'],
    surpriseScore:    0.72,
    longFormSuitable: true,
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

// Valid Claude response fixture -- used across many tests with small modifications.
// Body is ~140 words, within the 100-280 validation window.
// SOURCES contains the sourceFooter verbatim.
// No em-dashes, no forbidden terms, no forbidden topics.
const VALID_CLAUDE_RESPONSE = [
  'HOOK (0-5s):',
  'The bond market just moved, and your mortgage could follow.',
  '',
  'BODY (5s-60s):',
  'Five-year government yields dropped twelve basis points in two weeks. The Bank of Canada held its overnight rate the whole time. That gap is significant. Fixed mortgage rates track bond yields more than the overnight rate. When yields fall, fixed rates tend to follow, and that can happen before the central bank makes any official announcement. We have not seen fixed rates move yet, but the signal is there. What does this mean for you? If you are watching the market and waiting for a rate change before you act, you may be watching the wrong number. The overnight rate gets the press coverage. Bond yields are where the actual movement shows up first. Pay attention to yields this month. If they hold or drop further, fixed rates could shift before the next Bank of Canada announcement.',
  '',
  'CTA (60-75s):',
  'Follow me for weekly market updates. I track the numbers so you do not have to.',
  '',
  'B-ROLL SUGGESTIONS:',
  '- Five-year yield chart showing two-week decline',
  '- Agent reviewing rate comparison spreadsheet',
  '',
  'SOURCES:',
  'Bank of Canada (May 14 2026)',
].join('\n');

// Expected parsed sections for VALID_CLAUDE_RESPONSE.
const VALID_SECTIONS = {
  hook:    'The bond market just moved, and your mortgage could follow.',
  body:    'Five-year government yields dropped twelve basis points in two weeks. The Bank of Canada held its overnight rate the whole time. That gap is significant. Fixed mortgage rates track bond yields more than the overnight rate. When yields fall, fixed rates tend to follow, and that can happen before the central bank makes any official announcement. We have not seen fixed rates move yet, but the signal is there. What does this mean for you? If you are watching the market and waiting for a rate change before you act, you may be watching the wrong number. The overnight rate gets the press coverage. Bond yields are where the actual movement shows up first. Pay attention to yields this month. If they hold or drop further, fixed rates could shift before the next Bank of Canada announcement.',
  cta:     'Follow me for weekly market updates. I track the numbers so you do not have to.',
  bRoll:   ['Five-year yield chart showing two-week decline', 'Agent reviewing rate comparison spreadsheet'],
  sources: 'Bank of Canada (May 14 2026)',
};

// ── Input validation ──────────────────────────────────────────────────────────

describe('Input validation', () => {
  test('throws TypeError when angle is not an object', async () => {
    await expect(renderReelScript({ angle: 'not-an-object', contentProfile: makeContentProfile() }))
      .rejects.toThrow(TypeError);
  });

  test('throws TypeError when angle is null', async () => {
    await expect(renderReelScript({ angle: null, contentProfile: makeContentProfile() }))
      .rejects.toThrow(TypeError);
  });

  test('throws TypeError when required angle field headline is missing', async () => {
    const angle = makeAngle();
    delete angle.headline;
    await expect(renderReelScript({ angle, contentProfile: makeContentProfile() }))
      .rejects.toThrow(TypeError);
  });

  test('throws TypeError when contentProfile.voiceDescriptor is not a string', async () => {
    await expect(renderReelScript({
      angle:          makeAngle(),
      contentProfile: makeContentProfile({ voiceDescriptor: 42 }),
    })).rejects.toThrow(TypeError);
  });

  test('throws TypeError when contentProfile.forbiddenTerms is not an array', async () => {
    await expect(renderReelScript({
      angle:          makeAngle(),
      contentProfile: makeContentProfile({ forbiddenTerms: 'no-guarantees' }),
    })).rejects.toThrow(TypeError);
  });

  test('throws TypeError when contentProfile.forbiddenTopics is not an array', async () => {
    await expect(renderReelScript({
      angle:          makeAngle(),
      contentProfile: makeContentProfile({ forbiddenTopics: 'rate predictions' }),
    })).rejects.toThrow(TypeError);
  });
});

// ── parseSections ─────────────────────────────────────────────────────────────

describe('parseSections', () => {
  test('parses well-formed Claude output into all five sections', () => {
    const result = parseSections(VALID_CLAUDE_RESPONSE);
    expect(result).not.toBeNull();
    expect(result.hook).toBe(VALID_SECTIONS.hook);
    expect(result.body).toBe(VALID_SECTIONS.body);
    expect(result.cta).toBe(VALID_SECTIONS.cta);
    expect(result.bRoll).toEqual(VALID_SECTIONS.bRoll);
    expect(result.sources).toBe(VALID_SECTIONS.sources);
  });

  test('returns null when HOOK section is missing', () => {
    const noHook = VALID_CLAUDE_RESPONSE.replace('HOOK (0-5s):\n', '').replace(
      'The bond market just moved, and your mortgage could follow.\n', ''
    );
    expect(parseSections(noHook)).toBeNull();
  });

  test('returns null when SOURCES section is missing', () => {
    const noSources = VALID_CLAUDE_RESPONSE
      .replace('\nSOURCES:', '')
      .replace('\nBank of Canada (May 14 2026)', '');
    expect(parseSections(noSources)).toBeNull();
  });

  test('returns null when bRoll has no dash-prefixed lines', () => {
    const noDash = VALID_CLAUDE_RESPONSE
      .replace('- Five-year yield chart showing two-week decline\n', '')
      .replace('- Agent reviewing rate comparison spreadsheet\n', '');
    expect(parseSections(noDash)).toBeNull();
  });

  test('tolerates trailing whitespace on section headers', () => {
    const withTrailing = VALID_CLAUDE_RESPONSE
      .replace('HOOK (0-5s):', 'HOOK (0-5s):   ')
      .replace('BODY (5s-60s):', 'BODY (5s-60s):  ')
      .replace('SOURCES:', 'SOURCES:   ');
    const result = parseSections(withTrailing);
    expect(result).not.toBeNull();
    expect(result.hook).toBe(VALID_SECTIONS.hook);
    expect(result.sources).toBe(VALID_SECTIONS.sources);
  });

  test('tolerates multiple blank lines between sections', () => {
    const withExtraBlanks = VALID_CLAUDE_RESPONSE
      .replace('HOOK (0-5s):\n', 'HOOK (0-5s):\n\n\n')
      .replace('\nBODY (5s-60s):', '\n\n\nBODY (5s-60s):');
    const result = parseSections(withExtraBlanks);
    expect(result).not.toBeNull();
    expect(result.hook).toBe(VALID_SECTIONS.hook);
  });

  test('case-insensitive header matching', () => {
    const lowercased = VALID_CLAUDE_RESPONSE
      .replace('HOOK (0-5s):', 'hook (0-5s):')
      .replace('BODY (5s-60s):', 'body (5s-60s):')
      .replace('CTA (60-75s):', 'cta (60-75s):')
      .replace('B-ROLL SUGGESTIONS:', 'b-roll suggestions:')
      .replace('SOURCES:', 'sources:');
    const result = parseSections(lowercased);
    expect(result).not.toBeNull();
    expect(result.hook).toBe(VALID_SECTIONS.hook);
    expect(result.sources).toBe(VALID_SECTIONS.sources);
  });

  test('strips leading dash and whitespace from b-roll entries cleanly', () => {
    const extraSpaceBRoll = VALID_CLAUDE_RESPONSE
      .replace('- Five-year yield chart showing two-week decline', '-  Five-year yield chart showing two-week decline')
      .replace('- Agent reviewing rate comparison spreadsheet', '-   Agent reviewing rate comparison spreadsheet');
    const result = parseSections(extraSpaceBRoll);
    expect(result).not.toBeNull();
    expect(result.bRoll[0]).toBe('Five-year yield chart showing two-week decline');
    expect(result.bRoll[1]).toBe('Agent reviewing rate comparison spreadsheet');
  });
});

// ── validateReelScript ────────────────────────────────────────────────────────

describe('validateReelScript', () => {
  const angle = makeAngle();
  const contentProfile = makeContentProfile();

  test('returns valid for a clean script', () => {
    const result = validateReelScript(VALID_SECTIONS, { angle, contentProfile });
    expect(result.valid).toBe(true);
  });

  test('rejects when BODY word count is below 100', () => {
    const sections = { ...VALID_SECTIONS, body: 'This is far too short to qualify as a valid body.' };
    const result = validateReelScript(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('below minimum 100'))).toBe(true);
  });

  test('rejects when BODY word count is above 280', () => {
    // 285 word body
    const longWord = 'word';
    const longBody = Array.from({ length: 285 }, () => longWord).join(' ');
    const sections = { ...VALID_SECTIONS, body: longBody };
    const result = validateReelScript(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('exceeds maximum 280'))).toBe(true);
  });

  test('rejects when an em-dash is present in assembled text', () => {
    // Use unicode escape to include em-dash without a literal em-dash character in source
    const sections = { ...VALID_SECTIONS, cta: 'Follow me' + '—' + 'for updates.' };
    const result = validateReelScript(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('em-dash'))).toBe(true);
  });

  test('rejects when an en-dash is present in assembled text', () => {
    const sections = { ...VALID_SECTIONS, cta: 'Updates' + '–' + 'weekly.' };
    const result = validateReelScript(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('em-dash or en-dash'))).toBe(true);
  });

  test('rejects when a forbidden term appears in text (case-insensitive)', () => {
    // 'guaranteed' is in forbiddenTerms; use uppercase to test case-insensitivity
    const sections = { ...VALID_SECTIONS, hook: 'GUARANTEED returns on your investment.' };
    const result = validateReelScript(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"guaranteed"'))).toBe(true);
  });

  test('rejects when a forbidden topic appears in text', () => {
    // 'specific rate predictions' is in forbiddenTopics
    const sections = { ...VALID_SECTIONS, cta: 'I make specific rate predictions weekly.' };
    const result = validateReelScript(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"specific rate predictions"'))).toBe(true);
  });

  test('rejects when SOURCES does not contain the angle sourceFooter verbatim', () => {
    const sections = { ...VALID_SECTIONS, sources: 'Some Other Source (May 2026)' };
    const result = validateReelScript(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('sourceFooter'))).toBe(true);
  });

  test('rejects when hook contains a newline character', () => {
    const sections = { ...VALID_SECTIONS, hook: 'First line.\nSecond line.' };
    const result = validateReelScript(sections, { angle, contentProfile });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('single line'))).toBe(true);
  });
});

// ── assembleSections ──────────────────────────────────────────────────────────

describe('assembleSections', () => {
  test('produces correctly formatted text with all five labeled sections', () => {
    const text = assembleSections(VALID_SECTIONS, { forbidsRateAdvice: false });
    expect(text).toContain('HOOK (0-5s):');
    expect(text).toContain('BODY (5s-60s):');
    expect(text).toContain('CTA (60-75s):');
    expect(text).toContain('B-ROLL SUGGESTIONS:');
    expect(text).toContain('SOURCES:');
  });

  test('appends rate disclaimer when forbidsRateAdvice is true', () => {
    const text = assembleSections(VALID_SECTIONS, { forbidsRateAdvice: true });
    expect(text).toContain('*Not financial or rate advice. Consult a licensed mortgage professional for personal guidance.*');
  });

  test('does NOT append rate disclaimer when forbidsRateAdvice is false', () => {
    const text = assembleSections(VALID_SECTIONS, { forbidsRateAdvice: false });
    expect(text).not.toContain('*Not financial or rate advice');
  });

  test('b-roll entries rendered as dash-prefixed lines', () => {
    const text = assembleSections(VALID_SECTIONS, { forbidsRateAdvice: false });
    expect(text).toContain('- Five-year yield chart showing two-week decline');
    expect(text).toContain('- Agent reviewing rate comparison spreadsheet');
  });

  test('blank line separates sections', () => {
    const text = assembleSections(VALID_SECTIONS, { forbidsRateAdvice: false });
    // A blank line appears between sections: header\ncontent\n\nnext-header
    expect(text).toMatch(/HOOK \(0-5s\):\n.+\n\nBODY/s);
    expect(text).toMatch(/SOURCES:\n.+$/s);
  });
});

// ── renderReelScript ──────────────────────────────────────────────────────────

describe('renderReelScript', () => {
  test('happy path: mocked Claude returns valid script, returns expected shape', async () => {
    const callRaw = jest.fn().mockResolvedValue(VALID_CLAUDE_RESPONSE);
    const angle   = makeAngle({ forbidsRateAdvice: false });
    const result  = await renderReelScript({ angle, contentProfile: makeContentProfile(), opts: { callRaw } });

    expect(result.model).toBe('claude-sonnet-4-6');
    expect(typeof result.generatedAt).toBe('string');
    expect(typeof result.text).toBe('string');
    expect(result.sections.hook).toBe(VALID_SECTIONS.hook);
    expect(result.sections.body).toBe(VALID_SECTIONS.body);
    expect(result.sections.cta).toBe(VALID_SECTIONS.cta);
    expect(result.sections.bRoll).toEqual(VALID_SECTIONS.bRoll);
    expect(result.sections.sources).toBe(VALID_SECTIONS.sources);
    expect(callRaw).toHaveBeenCalledTimes(1);
  });

  test('returned generatedAt is a valid ISO string within the last 5 seconds', async () => {
    const callRaw = jest.fn().mockResolvedValue(VALID_CLAUDE_RESPONSE);
    const before  = Date.now();
    const result  = await renderReelScript({ angle: makeAngle(), contentProfile: makeContentProfile(), opts: { callRaw } });
    const after   = Date.now();

    const ts = new Date(result.generatedAt).getTime();
    expect(isNaN(ts)).toBe(false);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 100);
  });

  test('parse failure on first call, valid on retry: returns successfully', async () => {
    const callRaw = jest.fn()
      .mockResolvedValueOnce('not a valid reel script response at all')
      .mockResolvedValueOnce(VALID_CLAUDE_RESPONSE);
    const result = await renderReelScript({ angle: makeAngle(), contentProfile: makeContentProfile(), opts: { callRaw } });

    expect(result.sections.hook).toBe(VALID_SECTIONS.hook);
    expect(callRaw).toHaveBeenCalledTimes(2);
  });

  test('parse failure on both calls: throws ReelScriptGenerationError with cause', async () => {
    const callRaw = jest.fn().mockResolvedValue('no headers here at all');
    await expect(
      renderReelScript({ angle: makeAngle(), contentProfile: makeContentProfile(), opts: { callRaw } })
    ).rejects.toMatchObject({
      name: 'ReelScriptGenerationError',
      cause: expect.any(Error),
    });
    expect(callRaw).toHaveBeenCalledTimes(2);
  });

  test('validation failure on first call, valid on retry: returns successfully', async () => {
    // First response has an em-dash in the hook, second is clean.
    const invalidResponse = VALID_CLAUDE_RESPONSE.replace(
      'The bond market just moved, and your mortgage could follow.',
      'The bond market moved' + '—' + 'and your mortgage could follow.'
    );
    const callRaw = jest.fn()
      .mockResolvedValueOnce(invalidResponse)
      .mockResolvedValueOnce(VALID_CLAUDE_RESPONSE);
    const result = await renderReelScript({ angle: makeAngle(), contentProfile: makeContentProfile(), opts: { callRaw } });

    expect(result.sections.hook).toBe(VALID_SECTIONS.hook);
    expect(callRaw).toHaveBeenCalledTimes(2);
  });

  test('validation failure on both calls: throws ReelScriptGenerationError with validationErrors populated', async () => {
    const invalidResponse = VALID_CLAUDE_RESPONSE.replace(
      'The bond market just moved, and your mortgage could follow.',
      'The bond market moved' + '—' + 'your mortgage could follow.'
    );
    const callRaw = jest.fn().mockResolvedValue(invalidResponse);
    let err;
    try {
      await renderReelScript({ angle: makeAngle(), contentProfile: makeContentProfile(), opts: { callRaw } });
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(ReelScriptGenerationError);
    expect(Array.isArray(err.validationErrors)).toBe(true);
    expect(err.validationErrors.length).toBeGreaterThan(0);
    expect(callRaw).toHaveBeenCalledTimes(2);
  });

  test('forbidsRateAdvice true in angle: assembled text includes rate disclaimer block', async () => {
    const callRaw = jest.fn().mockResolvedValue(VALID_CLAUDE_RESPONSE);
    const result  = await renderReelScript({
      angle:          makeAngle({ forbidsRateAdvice: true }),
      contentProfile: makeContentProfile(),
      opts:           { callRaw },
    });

    expect(result.text).toContain('*Not financial or rate advice. Consult a licensed mortgage professional for personal guidance.*');
  });

  test('forbidden term in first Claude output triggers retry and succeeds on clean second response', async () => {
    // First response has 'guaranteed' (a forbidden term) in the hook.
    const dirtyResponse = VALID_CLAUDE_RESPONSE.replace(
      'The bond market just moved, and your mortgage could follow.',
      'Rates are not guaranteed to hold at this level.'
    );
    const callRaw = jest.fn()
      .mockResolvedValueOnce(dirtyResponse)
      .mockResolvedValueOnce(VALID_CLAUDE_RESPONSE);
    const result = await renderReelScript({ angle: makeAngle(), contentProfile: makeContentProfile(), opts: { callRaw } });

    expect(result.sections.hook).toBe(VALID_SECTIONS.hook);
    expect(callRaw).toHaveBeenCalledTimes(2);
  });
});
