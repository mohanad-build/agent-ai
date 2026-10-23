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
  dkimPassDomains: Object.freeze([]),
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

// The domain a dkim=pass segment's signature actually belongs to: header.d
// (the signing domain itself) when present, otherwise the domain half of
// header.i (the signing identity, written as "@domain" or "local@domain").
// Gmail's own Authentication-Results rendering commonly carries header.i
// without header.d at all (see the dkim test fixtures below), so the
// fallback is the common case, not a rare one.
function dkimDomainFromSegment(trimmed) {
  const dMatch = trimmed.match(/header\.d=([^\s;]+)/i);
  if (dMatch) return dMatch[1].toLowerCase();
  const iMatch = trimmed.match(/header\.i=([^\s;]*)/i);
  if (iMatch) {
    const at = iMatch[1].lastIndexOf('@');
    if (at !== -1) return iMatch[1].slice(at + 1).toLowerCase();
  }
  return null;
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
  // Every dkim=pass segment's own domain, not just the one the scalar dkim
  // field above settled on: a message can carry more than one valid
  // signature (e.g. a forwarded message re-signed by the forwarder), and
  // verifySender needs to check each one for alignment, not only whichever
  // segment happened to win the scalar dkim value.
  const dkimPassDomains = [];

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

    if (method === 'dkim' && value === 'pass') {
      const domain = dkimDomainFromSegment(trimmed);
      if (domain !== null) {
        dkimPassDomains.push(domain);
      }
    }
  });

  return { dmarc: results.dmarc, dkim: results.dkim, spf: results.spf, fromDomain, dkimPassDomains };
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

  const { dmarc, dkim, spf, fromDomain, dkimPassDomains } = parseMethodResults(collected[0]);
  return { trusted: true, reason: 'ok', dmarc, dkim, spf, fromDomain, dkimPassDomains };
}

// -- verifySender -------------------------------------------------------------
//
// Log-only for now (session 93): callers log this verdict and still process
// the message exactly as before. Nothing in this file enforces anything.
//
// Rule: trusted AND (dmarc=pass for the agent's OWN domain, OR any dkim=pass
// signature whose domain aligns with the agent's domain). dmarc=pass for a
// DIFFERENT domain than the agent's own does not count on its own -- it
// falls through to the dkim check -- but it is still distinguished in the
// reason ('dmarc_other_domain') from a message with no passing method at
// all, since it is a more specific, more informative signal than silence.
//
// ALIGNMENT is relaxed, not exact, and does not use a Public Suffix List:
// two domains align if they are equal, or one is a literal subdomain of the
// other (dot-boundary checked, so "evil-example.com" can never align with
// "example.com"). Known gap: two sibling subdomains under the same
// multi-label public suffix (e.g. "mail.example.co.uk" and
// "billing.example.co.uk") would not align under this rule. Not a concern
// for the sender population this gates -- a registered agent's own
// gmailAddress domain versus either that same domain or Google's own
// unrelated signing infrastructure -- but it is a documented limitation,
// not an oversight.
const VERIFY_REASONS = Object.freeze([
  'untrusted', 'dmarc_pass', 'dkim_aligned', 'dmarc_other_domain', 'dkim_not_aligned', 'no_pass',
]);

function domainOf(address) {
  const at = (address || '').lastIndexOf('@');
  return at === -1 ? '' : address.slice(at + 1).toLowerCase();
}

function domainsAligned(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function verifySender(authResults, gmailAddress) {
  if (!authResults || authResults.trusted !== true) {
    return { verified: false, reason: 'untrusted' };
  }

  const agentDomain = domainOf(gmailAddress);
  const dmarcPassForAgentDomain = authResults.dmarc === 'pass' && domainsAligned(authResults.fromDomain, agentDomain);

  if (dmarcPassForAgentDomain) {
    return { verified: true, reason: 'dmarc_pass' };
  }

  const dkimPassDomains = authResults.dkimPassDomains || [];
  const dkimAligned = dkimPassDomains.some((domain) => domainsAligned(domain, agentDomain));

  if (dkimAligned) {
    return { verified: true, reason: 'dkim_aligned' };
  }

  if (authResults.dmarc === 'pass') {
    return { verified: false, reason: 'dmarc_other_domain' };
  }

  if (dkimPassDomains.length > 0) {
    return { verified: false, reason: 'dkim_not_aligned' };
  }

  return { verified: false, reason: 'no_pass' };
}

module.exports = { parseAuthResults, verifySender, VERIFY_REASONS };
