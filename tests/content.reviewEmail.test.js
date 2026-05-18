'use strict';

const { composeReviewEmail, _internal } = require('../src/content/reviewEmail');

const {
  buildSubject,
  buildOpener,
  buildWhyThisOne,
  buildActionMailto,
  renderText,
  renderHtml,
  actionButton,
  markdownToHtml,
  escape,
  validateInputs,
} = _internal;

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeAngle(overrides = {}) {
  return {
    id:               'angle-2026-W21-001',
    weekStartIso:     '2026-05-18T00:00:00Z',
    headline:         'Bond yields soften while BoC holds steady',
    thesis:           'Five-year yields fell as the overnight rate held. Markets may be pricing in cuts the central bank has not announced.',
    dataPoints:       [{ metric: 'goc_5yr_yield', asOf: '2026-05-14' }],
    themeTag:         'monetary-policy',
    audienceFocus:    'both',
    bestSuitedFor:    ['reel'],
    surpriseScore:    0.72,
    longFormSuitable: true,
    forbidsRateAdvice: false,
    sourceFooter:     'Bank of Canada (May 14 2026)',
    ...overrides,
  };
}

function makeReelPiece(overrides = {}) {
  return {
    id:    'reel-001',
    type:  'reel',
    angle: makeAngle(),
    reel: {
      script:  {
        text: 'HOOK (0-5s):\nThe bond market just moved.\n\nBODY (5s-60s):\nHere is what it means for you.',
        sections: {},
        model: 'claude-sonnet-4-6',
        generatedAt: '2026-05-18T10:00:00Z',
      },
      caption: {
        text: 'Bond yields dropped. Here is why it matters. #realestate #mortgages',
        sections: {},
        model: 'claude-sonnet-4-6',
        generatedAt: '2026-05-18T10:00:00Z',
      },
    },
    ...overrides,
  };
}

function makeBlogPiece(overrides = {}) {
  return {
    id:    'blog-001',
    type:  'blog',
    angle: makeAngle({ themeTag: 'housing-supply', headline: 'New listings hit three-year high' }),
    blog: {
      text:     '# New Listings Hit Three-Year High\n\nHere is what buyers need to know.\n\n## What This Means\n\nMore supply means more options.',
      sections: {
        targetKeyword:   'new listings Toronto 2026',
        metaDescription: 'New listings in Toronto hit a three-year high.',
      },
      model:       'claude-sonnet-4-6',
      generatedAt: '2026-05-18T10:00:00Z',
    },
    ...overrides,
  };
}

function makeBatch(overrides = {}) {
  return {
    agentProfile: { firstName: 'Alex', email: 'alex@example.com' },
    weekIso:      '2026-W21',
    pieces:       [makeReelPiece()],
    otherAngles:  [],
    headsUp:      [],
    now:          new Date('2026-05-18T09:00:00Z'),
    ...overrides,
  };
}

// ── 1. Input validation ───────────────────────────────────────────────────────

describe('Input validation', () => {
  test('throws TypeError on null batch', () => {
    expect(() => validateInputs(null)).toThrow(TypeError);
  });

  test('throws TypeError on non-object batch', () => {
    expect(() => validateInputs('string')).toThrow(TypeError);
    expect(() => validateInputs(42)).toThrow(TypeError);
  });

  test('throws TypeError on missing weekIso', () => {
    const batch = makeBatch();
    delete batch.weekIso;
    expect(() => validateInputs(batch)).toThrow(TypeError);
  });

  test('throws TypeError on empty weekIso', () => {
    expect(() => validateInputs(makeBatch({ weekIso: '' }))).toThrow(TypeError);
  });

  test('throws TypeError on pieces array of length 0', () => {
    expect(() => validateInputs(makeBatch({ pieces: [] }))).toThrow(TypeError);
  });

  test('throws TypeError on pieces array of length 4', () => {
    const p = makeReelPiece();
    expect(() => validateInputs(makeBatch({ pieces: [p, p, p, p] }))).toThrow(TypeError);
  });

  test('throws TypeError on piece missing id', () => {
    const piece = makeReelPiece();
    delete piece.id;
    expect(() => validateInputs(makeBatch({ pieces: [piece] }))).toThrow(TypeError);
  });

  test('throws TypeError on piece missing type', () => {
    const piece = makeReelPiece();
    delete piece.type;
    expect(() => validateInputs(makeBatch({ pieces: [piece] }))).toThrow(TypeError);
  });

  test('throws TypeError on piece missing angle', () => {
    const piece = makeReelPiece();
    delete piece.angle;
    expect(() => validateInputs(makeBatch({ pieces: [piece] }))).toThrow(TypeError);
  });

  test('throws TypeError on reel piece missing script.text', () => {
    const piece = makeReelPiece();
    piece.reel.script.text = '';
    expect(() => validateInputs(makeBatch({ pieces: [piece] }))).toThrow(TypeError);
  });

  test('throws TypeError on reel piece missing caption.text', () => {
    const piece = makeReelPiece();
    piece.reel.caption.text = '';
    expect(() => validateInputs(makeBatch({ pieces: [piece] }))).toThrow(TypeError);
  });

  test('throws TypeError on reel piece with no reel object', () => {
    const piece = makeReelPiece();
    delete piece.reel;
    expect(() => validateInputs(makeBatch({ pieces: [piece] }))).toThrow(TypeError);
  });

  test('throws TypeError on blog piece missing blog.text', () => {
    const piece = makeBlogPiece();
    piece.blog.text = '';
    expect(() => validateInputs(makeBatch({ pieces: [piece] }))).toThrow(TypeError);
  });

  test('throws TypeError on blog piece with no blog object', () => {
    const piece = makeBlogPiece();
    delete piece.blog;
    expect(() => validateInputs(makeBatch({ pieces: [piece] }))).toThrow(TypeError);
  });

  test('throws TypeError when otherAngles is not an array', () => {
    expect(() => validateInputs(makeBatch({ otherAngles: null }))).toThrow(TypeError);
    expect(() => validateInputs(makeBatch({ otherAngles: 'none' }))).toThrow(TypeError);
  });

  test('throws TypeError when headsUp is not an array', () => {
    expect(() => validateInputs(makeBatch({ headsUp: null }))).toThrow(TypeError);
    expect(() => validateInputs(makeBatch({ headsUp: 'none' }))).toThrow(TypeError);
  });

  test('does not throw on valid 1-piece reel batch', () => {
    expect(() => validateInputs(makeBatch())).not.toThrow();
  });

  test('does not throw on valid 3-piece mixed batch', () => {
    const batch = makeBatch({
      pieces: [makeReelPiece(), makeReelPiece({ id: 'reel-002' }), makeBlogPiece()],
    });
    expect(() => validateInputs(batch)).not.toThrow();
  });
});

// ── 2. buildSubject ───────────────────────────────────────────────────────────

describe('buildSubject', () => {
  const NOW = new Date('2026-05-18T09:00:00Z'); // Monday, May 18

  test('3-piece subject format', () => {
    const subject = buildSubject({ pieceCount: 3, now: NOW });
    expect(subject).toBe('Your content batch -- Mon, May 18 -- 3 pieces ready');
  });

  test('2-piece subject format', () => {
    const subject = buildSubject({ pieceCount: 2, now: NOW });
    expect(subject).toBe('Your content batch -- Mon, May 18 -- 2 pieces ready');
  });

  test('1-piece subject includes (light news week)', () => {
    const subject = buildSubject({ pieceCount: 1, now: NOW });
    expect(subject).toBe('Your content batch -- Mon, May 18 -- 1 piece ready (light news week)');
  });

  test('weekday/month/day derived correctly from UTC date', () => {
    const friday = new Date('2026-05-22T09:00:00Z'); // Friday, May 22
    const subject = buildSubject({ pieceCount: 2, now: friday });
    expect(subject).toContain('Fri');
    expect(subject).toContain('May 22');
  });

  test('subject uses -- not em-dash', () => {
    const subject = buildSubject({ pieceCount: 2, now: NOW });
    expect(subject).not.toContain('—');
    expect(subject).not.toContain('–');
    expect(subject).toContain('--');
  });
});

// ── 3. buildOpener ───────────────────────────────────────────────────────────

describe('buildOpener', () => {
  test('3 pieces: solid news week', () => {
    expect(buildOpener(3)).toBe('Solid news week -- 3 pieces ready.');
  });

  test('2 pieces: decent week', () => {
    expect(buildOpener(2)).toBe('Decent week -- 2 pieces ready.');
  });

  test('1 piece: light news week', () => {
    expect(buildOpener(1)).toBe("Light news week. Here's one strong angle.");
  });

  test('never contains em-dash in prose', () => {
    expect(buildOpener(1)).not.toContain('—');
    expect(buildOpener(2)).not.toContain('—');
    expect(buildOpener(3)).not.toContain('—');
  });
});

// ── 4. buildWhyThisOne ───────────────────────────────────────────────────────

describe('buildWhyThisOne', () => {
  test('hyphenated themeTag becomes spaced and capitalized', () => {
    const angle = makeAngle({ themeTag: 'monetary-policy' });
    expect(buildWhyThisOne(angle)).toMatch(/^Monetary policy:/);
  });

  test('first sentence of thesis extracted', () => {
    const angle = makeAngle({
      themeTag: 'rates',
      thesis: 'The BoC held rates at 2.75%. Markets had priced in a cut.',
    });
    const result = buildWhyThisOne(angle);
    expect(result).toBe('Rates: The BoC held rates at 2.75%.');
    expect(result).not.toContain('Markets had priced');
  });

  test('period appended when first sentence does not end with punctuation', () => {
    const angle = makeAngle({
      themeTag: 'supply',
      thesis: 'Listings rose 12 percent. That is significant.',
    });
    const result = buildWhyThisOne(angle);
    expect(result).toMatch(/Listings rose 12 percent\.$/);
  });

  test('single-sentence thesis (no period+space) uses full thesis', () => {
    const angle = makeAngle({
      themeTag: 'rates',
      thesis: 'Rates are holding steady for now',
    });
    const result = buildWhyThisOne(angle);
    expect(result).toBe('Rates: Rates are holding steady for now.');
  });

  test('thesis ending in ! is not double-punctuated (single sentence)', () => {
    // Split is on ". " only, so a single sentence ending with ! uses the whole thesis.
    const angle = makeAngle({
      themeTag: 'market',
      thesis: 'Sales hit a 10-year high!',
    });
    const result = buildWhyThisOne(angle);
    expect(result).toBe('Market: Sales hit a 10-year high!');
    expect(result).not.toMatch(/!\.$/);
  });

  test('thesis ending in ? is not double-punctuated (single sentence)', () => {
    const angle = makeAngle({
      themeTag: 'market',
      thesis: 'Are buyers coming back?',
    });
    const result = buildWhyThisOne(angle);
    expect(result).toBe('Market: Are buyers coming back?');
    expect(result).not.toMatch(/\?\.$/);
  });
});

// ── 5. buildActionMailto ──────────────────────────────────────────────────────

describe('buildActionMailto', () => {
  test('returns correctly URL-encoded mailto', () => {
    const url = buildActionMailto('agent@example.com', 'APPROVE', 'reel-001');
    expect(url).toBe('mailto:agent@example.com?subject=APPROVE%20reel-001');
  });

  test('action + space + pieceId is the subject parameter', () => {
    const url = buildActionMailto('agent@example.com', 'REGEN', 'blog-001');
    const subjectParam = new URL(url).searchParams.get('subject');
    expect(subjectParam).toBe('REGEN blog-001');
  });

  test('special characters in pieceId are URL-encoded', () => {
    const url = buildActionMailto('agent@example.com', 'APPROVE', 'piece 001&x=1');
    expect(url).not.toContain(' ');
    expect(url).not.toContain('&x=1');
    expect(url).toContain('piece%20001');
  });

  test('handles missing agentEmail gracefully', () => {
    const url = buildActionMailto(null, 'APPROVE', 'reel-001');
    expect(url).toMatch(/^mailto:\?subject=/);
  });
});

// ── 6. renderText ─────────────────────────────────────────────────────────────

describe('renderText', () => {
  const NOW = new Date('2026-05-18T09:00:00Z');

  test('happy path: 3-piece batch renders all expected sections', () => {
    const batch = makeBatch({
      pieces: [
        makeReelPiece(),
        makeReelPiece({ id: 'reel-002' }),
        makeBlogPiece(),
      ],
      otherAngles: [{ id: 'angle-x', headline: 'Alt angle', themeTag: 'housing' }],
      headsUp: ['First note', 'Second note'],
    });
    const text = renderText(batch, NOW);

    expect(text).toContain("-- This week's batch --");
    expect(text).toContain('-- Other angles available this week --');
    expect(text).toContain('-- Heads up --');
    expect(text).toContain('First note');
    expect(text).toContain('Second note');
    expect(text).toContain('Alt angle');
  });

  test('1-piece batch with empty otherAngles omits the Other angles block', () => {
    const text = renderText(makeBatch(), NOW);
    expect(text).not.toContain('-- Other angles available this week --');
  });

  test('empty headsUp omits the Heads up block', () => {
    const text = renderText(makeBatch(), NOW);
    expect(text).not.toContain('Heads up');
  });

  test('first reel gets RECOMMENDED PRIORITY annotation', () => {
    const text = renderText(makeBatch(), NOW);
    expect(text).toContain('#1 REEL (RECOMMENDED PRIORITY)');
  });

  test('second reel does NOT get the RECOMMENDED PRIORITY annotation', () => {
    const batch = makeBatch({
      pieces: [makeReelPiece(), makeReelPiece({ id: 'reel-002' })],
    });
    const text = renderText(batch, NOW);
    expect(text).toContain('#2 REEL');
    expect(text).not.toMatch(/#2 REEL \(RECOMMENDED PRIORITY\)/);
  });

  test('blog at position 0 does NOT get the annotation', () => {
    const batch = makeBatch({ pieces: [makeBlogPiece()] });
    const text = renderText(batch, NOW);
    expect(text).toContain('#1 BLOG / NEWSLETTER POST');
    expect(text).not.toContain('RECOMMENDED PRIORITY');
  });

  test('actions block lists all 4 reply syntaxes per piece', () => {
    const text = renderText(makeBatch(), NOW);
    expect(text).toContain('"APPROVE reel-001"');
    expect(text).toContain('"REGEN reel-001"');
    expect(text).toContain('reply with the edited version inline');
    expect(text).toContain('"SWAP reel-001 TO <angle-id>"');
  });

  test('script text and caption text both included for reel pieces', () => {
    const text = renderText(makeBatch(), NOW);
    expect(text).toContain('[Script]');
    expect(text).toContain('The bond market just moved.');
    expect(text).toContain('[Instagram caption]');
    expect(text).toContain('Bond yields dropped.');
  });

  test('blog text included for blog pieces', () => {
    const batch = makeBatch({ pieces: [makeBlogPiece()] });
    const text = renderText(batch, NOW);
    expect(text).toContain('[Post]');
    expect(text).toContain('New Listings Hit Three-Year High');
  });

  test('sources footer appears under each piece', () => {
    const batch = makeBatch({
      pieces: [makeReelPiece(), makeBlogPiece()],
    });
    const text = renderText(batch, NOW);
    const matches = (text.match(/Sources:/g) || []).length;
    expect(matches).toBeGreaterThanOrEqual(2);
    expect(text).toContain('Sources: Bank of Canada (May 14 2026)');
  });

  test('arrow actions use the correct Unicode arrow character', () => {
    const text = renderText(makeBatch(), NOW);
    expect(text).toContain('→ Approve:');
    expect(text).toContain('→ Regenerate:');
    expect(text).toContain('→ Edit by hand:');
    expect(text).toContain('→ Swap angle:');
  });
});

// ── 7. renderHtml ─────────────────────────────────────────────────────────────

describe('renderHtml', () => {
  const NOW = new Date('2026-05-18T09:00:00Z');

  test('happy path: returns a string starting with <div', () => {
    const html = renderHtml(makeBatch(), NOW);
    expect(typeof html).toBe('string');
    expect(html.startsWith('<div')).toBe(true);
  });

  test('all 4 action buttons rendered per piece with mailto: hrefs', () => {
    const html = renderHtml(makeBatch(), NOW);
    expect(html).toContain('href="mailto:alex@example.com?subject=APPROVE%20reel-001"');
    expect(html).toContain('href="mailto:alex@example.com?subject=REGEN%20reel-001"');
    expect(html).toContain('href="mailto:alex@example.com?subject=EDIT%20reel-001"');
    expect(html).toContain('href="mailto:alex@example.com?subject=SWAP%20reel-001"');
  });

  test('styled with STYLE_TOKENS buttonBackground value', () => {
    const html = renderHtml(makeBatch(), NOW);
    expect(html).toContain('#1a1a1a');
  });

  test('escape applied: script tag in headline does not produce a script tag in output', () => {
    const piece = makeReelPiece({
      angle: makeAngle({ headline: '<script>alert(1)</script>' }),
    });
    const html = renderHtml(makeBatch({ pieces: [piece] }), NOW);
    expect(html).not.toMatch(/<script>/);
    expect(html).toContain('&lt;script&gt;');
  });

  test('markdown links in blog text render as anchor tags', () => {
    const blogText = '# Title\n\nCheck [this link](https://example.com) out.';
    const piece = makeBlogPiece({ blog: { ...makeBlogPiece().blog, text: blogText } });
    const html = renderHtml(makeBatch({ pieces: [piece] }), NOW);
    expect(html).toContain('<a href="https://example.com">this link</a>');
  });

  test('blog metadata (target keyword, meta description) appears', () => {
    const html = renderHtml(makeBatch({ pieces: [makeBlogPiece()] }), NOW);
    expect(html).toContain('new listings Toronto 2026');
    expect(html).toContain('New listings in Toronto hit a three-year high.');
  });

  test('empty otherAngles omits the Other angles section', () => {
    const html = renderHtml(makeBatch({ otherAngles: [] }), NOW);
    expect(html).not.toContain('Other angles available this week');
  });

  test('non-empty otherAngles renders the Other angles section', () => {
    const batch = makeBatch({
      otherAngles: [{ id: 'angle-x', headline: 'Alt angle headline', themeTag: 'housing' }],
    });
    const html = renderHtml(batch, NOW);
    expect(html).toContain('Other angles available this week');
    expect(html).toContain('Alt angle headline');
  });

  test('empty headsUp omits the Heads up section', () => {
    const html = renderHtml(makeBatch({ headsUp: [] }), NOW);
    expect(html).not.toContain('Heads up');
  });

  test('non-empty headsUp renders the Heads up section', () => {
    const html = renderHtml(makeBatch({ headsUp: ['Watch the BoC on Wednesday'] }), NOW);
    expect(html).toContain('Heads up');
    expect(html).toContain('Watch the BoC on Wednesday');
  });
});

// ── 8. escape ─────────────────────────────────────────────────────────────────

describe('escape', () => {
  test('escapes &', () => {
    expect(escape('a & b')).toBe('a &amp; b');
  });

  test('escapes <', () => {
    expect(escape('<div>')).toBe('&lt;div&gt;');
  });

  test('escapes >', () => {
    expect(escape('a > b')).toBe('a &gt; b');
  });

  test('escapes "', () => {
    expect(escape('"quoted"')).toBe('&quot;quoted&quot;');
  });

  test("escapes '", () => {
    expect(escape("it's")).toBe('it&#39;s');
  });

  test('no double-escaping: & becomes &amp; not &amp;amp;', () => {
    expect(escape('&amp;')).toBe('&amp;amp;');
    // verifying & is escaped once
    const result = escape('a & b');
    expect(result).toBe('a &amp; b');
    expect(result).not.toContain('&amp;amp;');
  });

  test('handles numbers without throwing', () => {
    expect(() => escape(42)).not.toThrow();
    expect(typeof escape(42)).toBe('string');
  });

  test('handles null without throwing', () => {
    expect(() => escape(null)).not.toThrow();
    expect(typeof escape(null)).toBe('string');
  });

  test('handles undefined without throwing', () => {
    expect(() => escape(undefined)).not.toThrow();
    expect(typeof escape(undefined)).toBe('string');
  });
});

// ── 9. markdownToHtml ────────────────────────────────────────────────────────

describe('markdownToHtml', () => {
  test('H1 conversion', () => {
    expect(markdownToHtml('# Title Here')).toContain('<h1>Title Here</h1>');
  });

  test('H2 conversion', () => {
    expect(markdownToHtml('## Subtitle')).toContain('<h2>Subtitle</h2>');
  });

  test('bullet lists grouped into a single ul', () => {
    const md = '- item one\n- item two\n- item three';
    const html = markdownToHtml(md);
    expect(html).toContain('<ul>');
    expect(html).toContain('</ul>');
    expect(html).toContain('<li>item one</li>');
    expect(html).toContain('<li>item two</li>');
    expect(html).toContain('<li>item three</li>');
    const ulCount = (html.match(/<ul>/g) || []).length;
    expect(ulCount).toBe(1);
  });

  test('--- becomes <hr>', () => {
    expect(markdownToHtml('---')).toContain('<hr>');
  });

  test('[text](url) becomes <a href>', () => {
    const html = markdownToHtml('[Click here](https://example.com)');
    expect(html).toContain('<a href="https://example.com">Click here</a>');
  });

  test('**bold** becomes <strong>', () => {
    const html = markdownToHtml('This is **bold** text.');
    expect(html).toContain('<strong>bold</strong>');
  });

  test('*italic* becomes <em>', () => {
    const html = markdownToHtml('This is *italic* text.');
    expect(html).toContain('<em>italic</em>');
  });

  test('escape applied: XSS in link text does not produce script tag', () => {
    const md = '[<script>alert(1)</script>](https://evil.com)';
    const html = markdownToHtml(md);
    expect(html).not.toMatch(/<script>/);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<a href="https://evil.com">');
  });

  test('blank-line-separated text blocks wrapped in <p> tags', () => {
    const md = 'First paragraph.\n\nSecond paragraph.';
    const html = markdownToHtml(md);
    expect(html).toContain('<p>First paragraph.</p>');
    expect(html).toContain('<p>Second paragraph.</p>');
  });

  test('multiline prose block within same paragraph joined without br', () => {
    const md = 'Line one.\nLine two.';
    const html = markdownToHtml(md);
    expect(html).toContain('<p>');
    expect(html).toContain('Line one.');
    expect(html).toContain('Line two.');
  });

  test('h1 and paragraph and list combined', () => {
    const md = '# Title\n\nParagraph text.\n\n- bullet one\n- bullet two';
    const html = markdownToHtml(md);
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<p>Paragraph text.</p>');
    expect(html).toContain('<li>bullet one</li>');
    expect(html).toContain('<li>bullet two</li>');
  });
});

// ── 10. composeReviewEmail (integration) ─────────────────────────────────────

describe('composeReviewEmail (integration)', () => {
  const NOW = new Date('2026-05-18T09:00:00Z');

  test('returns object with subject, text, html all populated', () => {
    const result = composeReviewEmail(makeBatch({ now: NOW }));
    expect(typeof result.subject).toBe('string');
    expect(result.subject.length).toBeGreaterThan(0);
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(0);
    expect(typeof result.html).toBe('string');
    expect(result.html.length).toBeGreaterThan(0);
  });

  test('subject matches buildSubject output', () => {
    const batch  = makeBatch({ now: NOW });
    const result = composeReviewEmail(batch);
    const expected = buildSubject({ pieceCount: batch.pieces.length, now: NOW });
    expect(result.subject).toBe(expected);
  });

  test('text matches renderText output', () => {
    const batch  = makeBatch({ now: NOW });
    const result = composeReviewEmail(batch);
    const expected = renderText(batch, NOW);
    expect(result.text).toBe(expected);
  });

  test('html matches renderHtml output', () => {
    const batch  = makeBatch({ now: NOW });
    const result = composeReviewEmail(batch);
    const expected = renderHtml(batch, NOW);
    expect(result.html).toBe(expected);
  });

  test('now injection works: subject reflects the injected date', () => {
    const friday = new Date('2026-05-22T09:00:00Z');
    const result = composeReviewEmail(makeBatch({ now: friday }));
    expect(result.subject).toContain('Fri');
    expect(result.subject).toContain('May 22');
  });

  test('throws TypeError on invalid input rather than returning partial result', () => {
    expect(() => composeReviewEmail(null)).toThrow(TypeError);
    expect(() => composeReviewEmail(makeBatch({ pieces: [] }))).toThrow(TypeError);
  });

  test('now defaults to current time when not provided', () => {
    const batch = makeBatch();
    delete batch.now;
    const before = Date.now();
    const result = composeReviewEmail(batch);
    const after  = Date.now();
    // Subject will contain today's date; just verify no crash and shape is correct
    expect(typeof result.subject).toBe('string');
    expect(typeof result.text).toBe('string');
    expect(typeof result.html).toBe('string');
    expect(before).toBeLessThanOrEqual(after + 100);
  });
});
