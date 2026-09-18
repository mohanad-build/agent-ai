'use strict';

const { parseAuthResults } = require('../src/authResults');

function header(name, value) {
  return { name, value };
}

// A real-shaped value, matching what Gmail actually attaches (per the
// session-76/77 recon fetch against assistant@getklosed.ca).
const REAL_VALUE =
  'mx.google.com;' +
  '       dkim=pass header.i=@gmail.com header.s=20251104 header.b=mbKt5Gd1;' +
  '       spf=pass (google.com: domain of foo@gmail.com designates 1.2.3.4 as permitted sender) smtp.mailfrom=foo@gmail.com;' +
  '       dmarc=pass (p=NONE sp=QUARANTINE dis=NONE) header.from=gmail.com;' +
  '       dara=neutral header.i=@getklosed.ca';

const REAL_RESULT_OK = {
  trusted: true,
  reason: 'ok',
  dmarc: 'pass',
  dkim: 'pass',
  spf: 'pass',
  fromDomain: 'gmail.com',
};

describe('parseAuthResults', () => {
  it('parses a real-shaped Gmail Authentication-Results header', () => {
    const result = parseAuthResults([header('Authentication-Results', REAL_VALUE)]);
    expect(result).toEqual(REAL_RESULT_OK);
  });

  it('parses the same header folded across lines identically', () => {
    const folded = REAL_VALUE.replace(/       /g, '\r\n\t');
    const result = parseAuthResults([header('Authentication-Results', folded)]);
    expect(result).toEqual(REAL_RESULT_OK);
  });

  it('matches the header name in a different case', () => {
    const result = parseAuthResults([header('authentication-RESULTS', REAL_VALUE)]);
    expect(result).toEqual(REAL_RESULT_OK);
  });

  it('ignores ARC-Authentication-Results headers containing mx.google.com alongside one real A-R', () => {
    const result = parseAuthResults([
      header('ARC-Authentication-Results', 'i=2; mx.google.com; dkim=fail'),
      header('Authentication-Results', REAL_VALUE),
      header('ARC-Authentication-Results', 'i=1; mx.google.com; arc=none'),
    ]);
    expect(result).toEqual(REAL_RESULT_OK);
  });

  it('no Authentication-Results header: reason none', () => {
    const result = parseAuthResults([header('Subject', 'hi'), header('From', 'a@b.com')]);
    expect(result).toEqual({
      trusted: false, reason: 'none', dmarc: null, dkim: null, spf: null, fromDomain: null,
    });
  });

  it('first Authentication-Results is from another host: reason first_not_google', () => {
    const result = parseAuthResults([header('Authentication-Results', 'mx.evil.com; dkim=pass')]);
    expect(result).toEqual({
      trusted: false, reason: 'first_not_google', dmarc: null, dkim: null, spf: null, fromDomain: null,
    });
  });

  it('a forged mx.google.com A-R below a different top host: still first_not_google', () => {
    const result = parseAuthResults([
      header('Authentication-Results', 'mx.evil.com; dkim=pass'),
      header('Authentication-Results', 'mx.google.com; dkim=pass'),
    ]);
    expect(result).toEqual({
      trusted: false, reason: 'first_not_google', dmarc: null, dkim: null, spf: null, fromDomain: null,
    });
  });

  it('two mx.google.com Authentication-Results headers: reason multiple_google', () => {
    const result = parseAuthResults([
      header('Authentication-Results', 'mx.google.com; dkim=pass'),
      header('Authentication-Results', 'mx.google.com; dkim=fail'),
    ]);
    expect(result).toEqual({
      trusted: false, reason: 'multiple_google', dmarc: null, dkim: null, spf: null, fromDomain: null,
    });
  });

  it('a comment containing a semicolon does not split its segment', () => {
    const value = 'mx.google.com; spf=pass (google.com: domain of a@b.com; designates 1.2.3.4 as permitted sender) smtp.mailfrom=a@b.com';
    const result = parseAuthResults([header('Authentication-Results', value)]);
    expect(result).toEqual({
      trusted: true, reason: 'ok', dmarc: null, dkim: null, spf: 'pass', fromDomain: null,
    });
  });

  it('parses the FIRST collected header, not the last, when a second non-google header is also collected', () => {
    // Two collected Authentication-Results headers: the first is
    // mx.google.com (trusted), the second is a different host, so
    // googleCount stays 1 and this reaches 'ok' -- but the RESULT must
    // come from the first header, never the second.
    const result = parseAuthResults([
      header('Authentication-Results', 'mx.google.com; dkim=pass'),
      header('Authentication-Results', 'mx.someother.net; dkim=fail'),
    ]);
    expect(result).toEqual({
      trusted: true, reason: 'ok', dmarc: null, dkim: 'pass', spf: null, fromDomain: null,
    });
  });

  it('a dmarc comment containing a semicolon does not fracture header.from onto its own segment', () => {
    const value = 'mx.google.com; dmarc=pass (a;b) header.from=gmail.com';
    const result = parseAuthResults([header('Authentication-Results', value)]);
    expect(result).toEqual({
      trusted: true, reason: 'ok', dmarc: 'pass', dkim: null, spf: null, fromDomain: 'gmail.com',
    });
  });

  it('two dkim entries, fail then pass: dkim is pass; results are lowercased; no dmarc segment means dmarc and fromDomain are null', () => {
    const value = 'mx.google.com; dkim=FAIL header.i=@a.com; dkim=PASS header.i=@b.com';
    const result = parseAuthResults([header('Authentication-Results', value)]);
    expect(result).toEqual({
      trusted: true, reason: 'ok', dmarc: null, dkim: 'pass', spf: null, fromDomain: null,
    });
  });

  describe('totality: never throws, always returns the safe shape', () => {
    const SAFE = { trusted: false, reason: 'none', dmarc: null, dkim: null, spf: null, fromDomain: null };

    const cases = [
      ['undefined', undefined],
      ['null', null],
      ['a string', 'not-an-array'],
      ['an object', {}],
      ['[null]', [null]],
      ['[{}]', [{}]],
      ["[{ name: 'Authentication-Results' }]", [{ name: 'Authentication-Results' }]],
      ["[{ name: 'Authentication-Results', value: 42 }]", [{ name: 'Authentication-Results', value: 42 }]],
    ];

    cases.forEach(([label, input]) => {
      it(`does not throw for ${label}`, () => {
        expect(() => parseAuthResults(input)).not.toThrow();
        expect(parseAuthResults(input)).toEqual(SAFE);
      });
    });
  });
});
