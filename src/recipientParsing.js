'use strict';

// Parses a raw To/Cc header value into an array of { address, name? }.
// A state machine, not headerValue.split(','): a comma inside a quoted
// display name or inside the <...> address part is not a separator, so a
// naive split would cut '"Smith, Jane" <jane@firm.com>' into two garbage
// fragments. Runs on every message on a shipped path, so it never throws -
// it parses what it can and drops only a fragment with no recoverable
// address, never a fragment whose address is fine but whose name isn't.
function parseRecipientList(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return [];

  function splitFragments(value) {
    const fragments = [];
    let current = '';
    let inQuotes = false;
    let angleDepth = 0;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (inQuotes) {
        if (ch === '\\' && i + 1 < value.length) {
          current += ch + value[i + 1];
          i++;
          continue;
        }
        if (ch === '"') {
          inQuotes = false;
        }
        current += ch;
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        current += ch;
        continue;
      }
      if (ch === '<') {
        angleDepth++;
        current += ch;
        continue;
      }
      if (ch === '>') {
        if (angleDepth > 0) angleDepth--;
        current += ch;
        continue;
      }
      if (ch === ',' && angleDepth === 0) {
        fragments.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    fragments.push(current);
    return fragments;
  }

  // A quoted display name is well-formed only if its last character is an
  // unescaped closing quote. Malformed (unterminated) names are dropped
  // without dropping the address that follows them.
  function isProperlyQuoted(str) {
    if (str.length < 2 || str[0] !== '"') return false;
    let i = 1;
    while (i < str.length) {
      const ch = str[i];
      if (ch === '\\' && i + 1 < str.length) {
        i += 2;
        continue;
      }
      if (ch === '"') {
        return i === str.length - 1;
      }
      i++;
    }
    return false;
  }

  function unquote(str) {
    const inner = str.slice(1, -1);
    let out = '';
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '\\' && i + 1 < inner.length) {
        out += inner[i + 1];
        i++;
      } else {
        out += inner[i];
      }
    }
    return out;
  }

  function parseFragment(fragment) {
    const trimmed = fragment.trim();
    if (!trimmed) return null;

    const angleMatch = trimmed.match(/^(.*)<([^<>]*)>\s*$/);
    if (angleMatch) {
      const beforeAngle = angleMatch[1].trim();
      const addressPart = angleMatch[2].trim();
      if (!addressPart || !addressPart.includes('@')) return null;

      const record = { address: addressPart.toLowerCase() };
      if (beforeAngle) {
        if (beforeAngle.startsWith('"')) {
          if (isProperlyQuoted(beforeAngle)) {
            record.name = unquote(beforeAngle);
          }
          // else: malformed quoted name - address is kept, name stays absent.
        } else {
          record.name = beforeAngle;
        }
      }
      return record;
    }

    // An unterminated quote leaves inQuotes set for the rest of the header,
    // so commas stop separating and the whole tail arrives here as one
    // fragment. Without this shape check that fragment would be accepted
    // verbatim as an address, fabricating one that does not exist.
    // Dropping it loses a recipient, which is free; fabricating one writes
    // garbage to a compliance record, which is not.
    if (trimmed.includes('@') && !/[\s<>"]/.test(trimmed)) {
      return { address: trimmed.toLowerCase() };
    }

    return null;
  }

  const results = [];
  for (const fragment of splitFragments(headerValue)) {
    const parsed = parseFragment(fragment);
    if (parsed) results.push(parsed);
  }
  return results;
}

module.exports = {
  parseRecipientList,
};
