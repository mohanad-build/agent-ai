'use strict';

// Parses the Authentication-Results header Gmail attaches to inbound mail
// into a trust verdict. Requires nothing: pure, total, never throws -- this
// also runs on the lead-reply path via parseGmailMessage, so a throw here
// would break lead processing, not just assistant@ mail.
//
// TRUST MODEL: only the header Gmail itself writes as the message enters
// its infrastructure is trusted, and only when it looks like exactly what
// Gmail writes. A forged Authentication-Results header injected by the
// sender is indistinguishable from a real one by name alone -- an attacker
// can put any content after "Authentication-Results:". What they cannot do
// is control HOW MANY such headers exist or WHERE the genuine one Gmail
// added sits in the header block: Gmail's own header goes in first (nearest
// the top, since headers are prepended as mail moves through MTAs), and a
// header they forge upstream of Gmail arrives already below it by the time
// Gmail is done. So this only ever trusts a lone header whose authserv-id
// is 'mx.google.com' AND is the first Authentication-Results header seen --
// a forged one below a real one is caught by requiring exactly one match,
// not by pattern-matching content.
//
// ARC-Authentication-Results is a DIFFERENT header (a distinct, signed
// forwarding-hop record) and must never match here -- see the exact-equality
// requirement in collectAuthResultsValues below.
//
// FOLDED HEADERS need no explicit unfolding step: a legal RFC 5322 fold only
// ever replaces pre-existing whitespace with CRLF+WSP, and .trim() plus this
// file's \s/negated-character-class regex boundaries already treat \r, \n
// and \t the same as a space everywhere a fold can land, so a folded header
// parses identically to its unfolded form without any extra handling. The
// two "folded across lines" tests pin that behaviour directly.

const SAFE_RESULT = Object.freeze({
  trusted: false,
  reason: 'none',
  dmarc: null,
  dkim: null,
  spf: null,
  fromDomain: null,
});

function authservId(rawValue) {
  const idx = rawValue.indexOf(';');
  const idPart = idx === -1 ? rawValue : rawValue.slice(0, idx);
  return idPart.trim().toLowerCase();
}

// Exact equality only (after lowercasing), never includes/endsWith:
// ARC-Authentication-Results must never match 'authentication-results'.
function collectAuthResultsValues(headers) {
  const values = [];
  if (!Array.isArray(headers)) {
    return values;
  }
  headers.forEach((header) => {
    if (header === null || typeof header !== 'object') return;
    if (typeof header.name !== 'string' || typeof header.value !== 'string') return;
    if (header.name.toLowerCase() === 'authentication-results') {
      values.push(header.value);
    }
  });
  return values;
}

// Parses ONLY the first collected header's method results, once the caller
// has already established it is the sole trusted one. Comments are stripped
// before splitting on ';' so a comment containing ';' (Gmail's spf comment
// often does) can never fracture a segment.
function parseMethodResults(rawValue) {
  const noComments = rawValue.replace(/\([^)]*\)/g, '');
  const segments = noComments.split(';');

  const results = { dkim: null, spf: null, dmarc: null };
  let fromDomain = null;

  segments.forEach((segment) => {
    const trimmed = segment.trim();
    const match = trimmed.match(/^(dkim|spf|dmarc)=([a-z]+)/i);
    if (!match) return;

    const method = match[1].toLowerCase();
    const value = match[2].toLowerCase();
    // Several entries for one method: pass wins if any entry is pass,
    // otherwise the first entry's value stands.
    if (results[method] === null || (results[method] !== 'pass' && value === 'pass')) {
      results[method] = value;
    }

    if (method === 'dmarc' && fromDomain === null) {
      const fromMatch = trimmed.match(/header\.from=([^\s;]+)/i);
      if (fromMatch) {
        fromDomain = fromMatch[1].toLowerCase();
      }
    }
  });

  return { dmarc: results.dmarc, dkim: results.dkim, spf: results.spf, fromDomain };
}

function parseAuthResults(headers) {
  const collected = collectAuthResultsValues(headers);

  if (collected.length === 0) {
    return SAFE_RESULT;
  }

  const authservIds = collected.map(authservId);

  if (authservIds[0] !== 'mx.google.com') {
    return { ...SAFE_RESULT, reason: 'first_not_google' };
  }

  const googleCount = authservIds.filter((id) => id === 'mx.google.com').length;
  if (googleCount > 1) {
    return { ...SAFE_RESULT, reason: 'multiple_google' };
  }

  const { dmarc, dkim, spf, fromDomain } = parseMethodResults(collected[0]);
  return { trusted: true, reason: 'ok', dmarc, dkim, spf, fromDomain };
}

module.exports = { parseAuthResults };
