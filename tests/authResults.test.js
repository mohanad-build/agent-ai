'use strict';

const { parseAuthResults, verifySender } = require('../src/authResults');

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
  dkimPassDomains: ['gmail.com'],
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
      trusted: false, reason: 'none', dmarc: null, dkim: null, spf: null, fromDomain: null, dkimPassDomains: [],
    });
  });

  it('first Authentication-Results is from another host: reason first_not_google', () => {
    const result = parseAuthResults([header('Authentication-Results', 'mx.evil.com; dkim=pass')]);
    expect(result).toEqual({
      trusted: false, reason: 'first_not_google', dmarc: null, dkim: null, spf: null, fromDomain: null, dkimPassDomains: [],
    });
  });

  it('a forged mx.google.com A-R below a different top host: still first_not_google', () => {
    const result = parseAuthResults([
      header('Authentication-Results', 'mx.evil.com; dkim=pass'),
      header('Authentication-Results', 'mx.google.com; dkim=pass'),
    ]);
    expect(result).toEqual({
      trusted: false, reason: 'first_not_google', dmarc: null, dkim: null, spf: null, fromDomain: null, dkimPassDomains: [],
    });
  });

  it('two mx.google.com Authentication-Results headers: reason multiple_google', () => {
    const result = parseAuthResults([
      header('Authentication-Results', 'mx.google.com; dkim=pass'),
      header('Authentication-Results', 'mx.google.com; dkim=fail'),
    ]);
    expect(result).toEqual({
      trusted: false, reason: 'multiple_google', dmarc: null, dkim: null, spf: null, fromDomain: null, dkimPassDomains: [],
    });
  });

  it('a comment containing a semicolon does not split its segment', () => {
    const value = 'mx.google.com; spf=pass (google.com: domain of a@b.com; designates 1.2.3.4 as permitted sender) smtp.mailfrom=a@b.com';
    const result = parseAuthResults([header('Authentication-Results', value)]);
    expect(result).toEqual({
      trusted: true, reason: 'ok', dmarc: null, dkim: null, spf: 'pass', fromDomain: null, dkimPassDomains: [],
    });
  });

  it('parses the FIRST collected header, not the last, when a second non-google header is also collected; a dkim=pass with no header.i/header.d contributes nothing to dkimPassDomains', () => {
    // Two collected Authentication-Results headers: the first is
    // mx.google.com (trusted), the second is a different host, so
    // googleCount stays 1 and this reaches 'ok' -- but the RESULT must
    // come from the first header, never the second. That first header's
    // dkim=pass carries no header.i or header.d at all, so dkimPassDomains
    // stays empty even though the scalar dkim value is 'pass': there is no
    // domain to check alignment against.
    const result = parseAuthResults([
      header('Authentication-Results', 'mx.google.com; dkim=pass'),
      header('Authentication-Results', 'mx.someother.net; dkim=fail'),
    ]);
    expect(result).toEqual({
      trusted: true, reason: 'ok', dmarc: null, dkim: 'pass', spf: null, fromDomain: null, dkimPassDomains: [],
    });
  });

  it('a dmarc comment containing a semicolon does not fracture header.from onto its own segment', () => {
    const value = 'mx.google.com; dmarc=pass (a;b) header.from=gmail.com';
    const result = parseAuthResults([header('Authentication-Results', value)]);
    expect(result).toEqual({
      trusted: true, reason: 'ok', dmarc: 'pass', dkim: null, spf: null, fromDomain: 'gmail.com', dkimPassDomains: [],
    });
  });

  it('two dkim entries, fail then pass: dkim is pass; only the passing entry\'s domain lands in dkimPassDomains; results are lowercased; no dmarc segment means dmarc and fromDomain are null', () => {
    const value = 'mx.google.com; dkim=FAIL header.i=@a.com; dkim=PASS header.i=@b.com';
    const result = parseAuthResults([header('Authentication-Results', value)]);
    expect(result).toEqual({
      trusted: true, reason: 'ok', dmarc: null, dkim: 'pass', spf: null, fromDomain: null, dkimPassDomains: ['b.com'],
    });
  });

  describe('dkimPassDomains: header.d, the header.i fallback, and multiple passing signatures', () => {
    it('Gmail native signing: header.i fallback only, no header.d present', () => {
      const value = 'mx.google.com; dkim=pass header.i=@gmail.com header.s=20251104 header.b=mbKt5Gd1';
      const result = parseAuthResults([header('Authentication-Results', value)]);
      expect(result.dkimPassDomains).toEqual(['gmail.com']);
    });

    it('header.d wins over header.i when both are present', () => {
      const value = 'mx.google.com; dkim=pass header.d=customdomain.com header.i=@mail.customdomain.com header.s=google header.b=abc';
      const result = parseAuthResults([header('Authentication-Results', value)]);
      expect(result.dkimPassDomains).toEqual(['customdomain.com']);
    });

    it('default Google Workspace signing (DKIM not customized): captured verbatim, no header.d, alignment is verifySender\'s job, not this file\'s', () => {
      const value = 'mx.google.com; dkim=pass header.i=@customdomain-com.gappssmtp.com header.s=xxxx header.b=def';
      const result = parseAuthResults([header('Authentication-Results', value)]);
      expect(result.dkimPassDomains).toEqual(['customdomain-com.gappssmtp.com']);
    });

    it('two dkim=pass segments, customdomain.com then gappssmtp.com: both captured, in encounter order', () => {
      const value = 'mx.google.com;' +
        ' dkim=pass header.i=@customdomain.com header.s=google header.b=abc;' +
        ' dkim=pass header.i=@customdomain-com.gappssmtp.com header.s=xxxx header.b=def;' +
        ' dmarc=none header.from=customdomain.com';
      const result = parseAuthResults([header('Authentication-Results', value)]);
      expect(result.dkimPassDomains).toEqual(['customdomain.com', 'customdomain-com.gappssmtp.com']);
    });

    it('the same two dkim=pass segments in the OPPOSITE order: both still captured, in that order', () => {
      const value = 'mx.google.com;' +
        ' dkim=pass header.i=@customdomain-com.gappssmtp.com header.s=xxxx header.b=def;' +
        ' dkim=pass header.i=@customdomain.com header.s=google header.b=abc;' +
        ' dmarc=none header.from=customdomain.com';
      const result = parseAuthResults([header('Authentication-Results', value)]);
      expect(result.dkimPassDomains).toEqual(['customdomain-com.gappssmtp.com', 'customdomain.com']);
    });
  });

  describe('totality: never throws, always returns the safe shape', () => {
    const SAFE = { trusted: false, reason: 'none', dmarc: null, dkim: null, spf: null, fromDomain: null, dkimPassDomains: [] };

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

// verifySender's own tests build authResults objects by hand, never by
// routing through parseAuthResults: this keeps verifySender's rule
// verifiable on its own, independent of whether the parser above still
// extracts the right fields (a test that only compares two code paths
// cannot catch a rule removed from code they both share).
describe('verifySender', () => {
  const AGENT_ADDRESS = 'agent@example.com';

  it('plain gmail.com sender: dmarc pass for the agent\'s own domain -> dmarc_pass', () => {
    const authResults = {
      trusted: true, reason: 'ok', dmarc: 'pass', dkim: 'pass', spf: 'pass',
      fromDomain: 'example.com', dkimPassDomains: ['example.com'],
    };
    expect(verifySender(authResults, AGENT_ADDRESS)).toEqual({ verified: true, reason: 'dmarc_pass' });
  });

  it('Workspace custom domain WITH a DMARC record: dmarc pass for the agent\'s own domain -> dmarc_pass', () => {
    const authResults = {
      trusted: true, reason: 'ok', dmarc: 'pass', dkim: 'pass', spf: 'pass',
      fromDomain: 'example.com', dkimPassDomains: ['example.com'],
    };
    expect(verifySender(authResults, AGENT_ADDRESS)).toEqual({ verified: true, reason: 'dmarc_pass' });
  });

  it('Workspace custom domain, NO DMARC record (dmarc=none): rescued by an aligned dkim=pass -> dkim_aligned', () => {
    const authResults = {
      trusted: true, reason: 'ok', dmarc: 'none', dkim: 'pass', spf: 'pass',
      fromDomain: null, dkimPassDomains: ['example.com'],
    };
    expect(verifySender(authResults, AGENT_ADDRESS)).toEqual({ verified: true, reason: 'dkim_aligned' });
  });

  it('Workspace, DKIM not set up (default Google signing): dmarc=none and the default domain does not align -> dkim_not_aligned', () => {
    const authResults = {
      trusted: true, reason: 'ok', dmarc: 'none', dkim: 'pass', spf: 'pass',
      fromDomain: null, dkimPassDomains: ['example-com.gappssmtp.com'],
    };
    expect(verifySender(authResults, AGENT_ADDRESS)).toEqual({ verified: false, reason: 'dkim_not_aligned' });
  });

  it('forged From, trusted header but nothing passes: no_pass', () => {
    const authResults = {
      trusted: true, reason: 'ok', dmarc: 'fail', dkim: 'fail', spf: 'fail',
      fromDomain: 'example.com', dkimPassDomains: [],
    };
    expect(verifySender(authResults, AGENT_ADDRESS)).toEqual({ verified: false, reason: 'no_pass' });
  });

  it('untrusted header (forged/duplicate Authentication-Results): untrusted, regardless of what dmarc/dkim claim', () => {
    const authResults = {
      trusted: false, reason: 'first_not_google', dmarc: 'pass', dkim: 'pass', spf: 'pass',
      fromDomain: 'example.com', dkimPassDomains: ['example.com'],
    };
    expect(verifySender(authResults, AGENT_ADDRESS)).toEqual({ verified: false, reason: 'untrusted' });
  });

  it('dmarc pass but for a DIFFERENT domain than the agent\'s own, no dkim: dmarc_other_domain', () => {
    const authResults = {
      trusted: true, reason: 'ok', dmarc: 'pass', dkim: null, spf: null,
      fromDomain: 'evil.com', dkimPassDomains: [],
    };
    expect(verifySender(authResults, AGENT_ADDRESS)).toEqual({ verified: false, reason: 'dmarc_other_domain' });
  });

  it('dmarc pass for a different domain, but dkim aligns with the agent\'s own: falls through to dkim_aligned, not dmarc_other_domain', () => {
    const authResults = {
      trusted: true, reason: 'ok', dmarc: 'pass', dkim: 'pass', spf: null,
      fromDomain: 'evil.com', dkimPassDomains: ['example.com'],
    };
    expect(verifySender(authResults, AGENT_ADDRESS)).toEqual({ verified: true, reason: 'dkim_aligned' });
  });

  it('subdomain alignment: a dkim signing domain that is a subdomain of the agent\'s own domain still aligns', () => {
    const authResults = {
      trusted: true, reason: 'ok', dmarc: 'none', dkim: 'pass', spf: null,
      fromDomain: null, dkimPassDomains: ['mail.example.com'],
    };
    expect(verifySender(authResults, AGENT_ADDRESS)).toEqual({ verified: true, reason: 'dkim_aligned' });
  });

  it('defensive: dkim=pass but dkimPassDomains missing entirely (not just empty) does not throw and does not verify', () => {
    const authResults = { trusted: true, reason: 'ok', dmarc: 'none', dkim: 'pass', spf: null, fromDomain: null };
    expect(() => verifySender(authResults, AGENT_ADDRESS)).not.toThrow();
    expect(verifySender(authResults, AGENT_ADDRESS)).toEqual({ verified: false, reason: 'no_pass' });
  });

  it('two dkimPassDomains entries, only the SECOND aligns: still verified via dkim_aligned (every entry is checked, not just the first)', () => {
    const authResults = {
      trusted: true, reason: 'ok', dmarc: 'none', dkim: 'pass', spf: null,
      fromDomain: null, dkimPassDomains: ['customdomain-com.gappssmtp.com', 'example.com'],
    };
    expect(verifySender(authResults, AGENT_ADDRESS)).toEqual({ verified: true, reason: 'dkim_aligned' });
  });

  it('two dkimPassDomains entries in one order: verifies', () => {
    const authResults = {
      trusted: true, reason: 'ok', dmarc: 'none', dkim: 'pass', spf: null,
      fromDomain: null, dkimPassDomains: ['example.com', 'customdomain-com.gappssmtp.com'],
    };
    expect(verifySender(authResults, AGENT_ADDRESS)).toEqual({ verified: true, reason: 'dkim_aligned' });
  });

  it('the same two dkimPassDomains entries in the OPPOSITE order: still verifies', () => {
    const authResults = {
      trusted: true, reason: 'ok', dmarc: 'none', dkim: 'pass', spf: null,
      fromDomain: null, dkimPassDomains: ['customdomain-com.gappssmtp.com', 'example.com'],
    };
    expect(verifySender(authResults, AGENT_ADDRESS)).toEqual({ verified: true, reason: 'dkim_aligned' });
  });
});
