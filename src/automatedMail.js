'use strict';

// Detects automated mail (bounces, autoresponders, mailing lists, no-reply
// senders) from a message's raw header array. Pure and total: never
// throws, requires nothing -- same conventions as src/authResults.js,
// since both run on the same parseGmailMessage path that also serves lead
// processing, where a throw here would break lead processing, not just
// assistant@ mail.
//
// Nothing reads this yet -- a later commit uses it to decide whether to
// reply to an unrecognized sender on assistant@, never to authorize a verb.

const NOT_AUTOMATED = Object.freeze({ automated: false, reason: null });

// Exact equality only (after lowercasing), never includes/endsWith: a
// header named X-Original-List-Id must not match 'List-Id'. Returns the
// FIRST occurrence, since every rule below is defined against "the" header
// as if only one exists, and a header can legitimately repeat.
function findHeaderValue(headers, name) {
  if (!Array.isArray(headers)) return undefined;
  const lowerName = name.toLowerCase();
  for (const header of headers) {
    if (header === null || typeof header !== 'object') continue;
    if (typeof header.name !== 'string' || typeof header.value !== 'string') continue;
    if (header.name.toLowerCase() === lowerName) {
      return header.value;
    }
  }
  return undefined;
}

// mailer-daemon, postmaster, no-reply/noreply, do-not-reply/donotreply,
// optionally followed by a +tag, .separator, or -separator and anything
// after. Anchored at both ends so a local part that merely CONTAINS one of
// these words ('noreplyjohn', 'john.noreply') does not match.
const SYSTEM_SENDER_RE = /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)([+._-].*)?$/;

function extractAddress(fromValue) {
  const match = fromValue.match(/<([^>]+)>/);
  return (match ? match[1] : fromValue).trim().toLowerCase();
}

function localPartOf(address) {
  const at = address.indexOf('@');
  return at === -1 ? address : address.slice(0, at);
}

function detectAutomated(headers) {
  if (!Array.isArray(headers)) {
    return NOT_AUTOMATED;
  }

  const autoSubmitted = findHeaderValue(headers, 'Auto-Submitted');
  if (autoSubmitted !== undefined) {
    const cut = autoSubmitted.split(';')[0].trim().toLowerCase();
    if (cut !== 'no') {
      return { automated: true, reason: 'auto_submitted' };
    }
  }

  const xAutoreply = findHeaderValue(headers, 'X-Autoreply');
  const xAutorespond = findHeaderValue(headers, 'X-Autorespond');
  if ((xAutoreply !== undefined && xAutoreply.trim() !== '') || (xAutorespond !== undefined && xAutorespond.trim() !== '')) {
    return { automated: true, reason: 'autoreply_header' };
  }

  const precedence = findHeaderValue(headers, 'Precedence');
  if (precedence !== undefined) {
    const value = precedence.trim().toLowerCase();
    if (value === 'bulk' || value === 'list' || value === 'junk') {
      return { automated: true, reason: 'precedence' };
    }
  }

  const listId = findHeaderValue(headers, 'List-Id');
  const listUnsubscribe = findHeaderValue(headers, 'List-Unsubscribe');
  if ((listId !== undefined && listId.trim() !== '') || (listUnsubscribe !== undefined && listUnsubscribe.trim() !== '')) {
    return { automated: true, reason: 'list_headers' };
  }

  const returnPath = findHeaderValue(headers, 'Return-Path');
  if (returnPath !== undefined && returnPath.trim() === '<>') {
    return { automated: true, reason: 'null_return_path' };
  }

  const from = findHeaderValue(headers, 'From');
  if (from !== undefined) {
    const localPart = localPartOf(extractAddress(from));
    if (SYSTEM_SENDER_RE.test(localPart)) {
      return { automated: true, reason: 'system_sender' };
    }
  }

  return NOT_AUTOMATED;
}

module.exports = { detectAutomated };
