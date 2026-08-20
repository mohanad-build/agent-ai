'use strict';

const { parseAddress } = require('./address');

// Scans free text (an email body, an attachment filename) for substrings
// shaped like an address and returns every one that address.js's own
// parser accepts. Pure text in, array out: no I/O, no clock, no opts
// bag, single positional argument, matching address.js's own
// conventions. Requires only parseAddress -- this module knows nothing
// about comparing addresses and nothing about transactions.

// -- Terminator list ------------------------------------------------------------------

// Words that stop a candidate window from growing into surrounding
// prose or document boilerplate. Three groups for readability -- the
// scanner itself does not care which group a terminator came from, so
// they are flattened into one lookup below.
const TERMINATORS = {
  functionWords: [
    'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in',
    'is', 'it', 'of', 'on', 'or', 'please', 're', 'see', 'the', 'this',
    'to', 'was', 'we', 'will', 'with', 'you', 'your',
  ],
  documentWords: [
    'accepted', 'addendum', 'agreement', 'amendment', 'aps', 'completed',
    'conditional', 'confirmation', 'copy', 'doc', 'document', 'executed',
    'final', 'firm', 'form', 'lease', 'notice', 'offer', 'release',
    'revised', 'scan', 'schedule', 'signback', 'signed', 'waiver',
  ],
  unitWords: [
    'apartment', 'apt', 'basement', 'bsmt', 'floor', 'lower', 'main',
    'penthouse', 'ph', 'suite', 'unit', 'upper',
  ],
};

function deepFreeze(value) {
  Object.getOwnPropertyNames(value).forEach((key) => {
    const child = value[key];
    if (child && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  });
  return Object.freeze(value);
}

deepFreeze(TERMINATORS);

// Word -> true, derived from TERMINATORS at load time so the scanner does
// a single property lookup per token instead of scanning every group.
function buildTerminatorSet(groups) {
  const set = {};
  Object.keys(groups).forEach((group) => {
    groups[group].forEach((word) => {
      set[word] = true;
    });
  });
  return set;
}

const TERMINATOR_SET = buildTerminatorSet(TERMINATORS);

// -- Argument assertions ---------------------------------------------------------------

function assertNonEmptyString(fnName, name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fnName}: ${name} must be a non-empty string`);
  }
}

// -- Tokeniser --------------------------------------------------------------------------

// A token is either a civic-range shape (a digit run, optionally
// chained to more digit runs by hyphens -- tried first so '14-16'
// matches whole) or a plain alphanumeric run. Any other character,
// including a hyphen that is NOT chaining two digit runs, falls through
// both alternatives and is left for tokenize() to classify as part of a
// separator.
const TOKEN_RE = /\d+(?:-\d+)*|[a-z0-9]+/g;

// A digit run, optionally hyphen-chained to more digit runs -- the same
// shape address.js's CIVIC_RE captures from the start of a street part,
// anchored here to the whole token since tokens are already delimited.
const CIVIC_SHAPE_RE = /^\d+(?:-\d+)*$/;

// Whitespace and underscore are soft separators: they split tokens but
// do not stop a window from growing across them. Everything else
// (comma, period, hyphen not chaining digits, parens, ...) is a hard
// boundary a window may never cross, matching the "separators" vs.
// "terminator boundary" split in the tokenisation rule.
function isHardSeparator(run) {
  return /[^\s_]/.test(run);
}

function tokenize(text) {
  const lower = text.toLowerCase();
  const tokens = [];
  let prevEnd = 0;

  for (const match of lower.matchAll(TOKEN_RE)) {
    const between = lower.slice(prevEnd, match.index);
    tokens.push({
      text: match[0],
      hardBoundaryBefore: tokens.length > 0 && isHardSeparator(between),
    });
    prevEnd = match.index + match[0].length;
  }

  return tokens;
}

// -- findAddressCandidates ---------------------------------------------------------------

// For every civic-shaped token in the text, grow a window forward and
// hand it to parseAddress; keep whatever comes back non-null. The
// scanner never interprets what a token means -- trailing street type,
// trailing directional, st-as-Saint and city are all parseAddress's job.
function findAddressCandidates(text) {
  assertNonEmptyString('findAddressCandidates', 'text', text);

  const tokens = tokenize(text);
  const results = [];

  for (let i = 0; i < tokens.length; i += 1) {
    if (!CIVIC_SHAPE_RE.test(tokens[i].text)) {
      continue;
    }

    const window = [tokens[i].text];
    const next = tokens[i + 1];

    // The immediate next token is taken as the first street name token
    // unconditionally -- whatever it is, terminator or not -- as long
    // as no hard boundary sits between it and the civic number. This is
    // what lets '14 The Queensway' and '22 Main St' work even though
    // 'the' and 'main' are both in the terminator list above.
    if (next !== undefined && !next.hardBoundaryBefore) {
      window.push(next.text);

      let j = i + 2;
      while (
        j < tokens.length &&
        !tokens[j].hardBoundaryBefore &&
        !Object.prototype.hasOwnProperty.call(TERMINATOR_SET, tokens[j].text)
      ) {
        window.push(tokens[j].text);
        j += 1;
      }
    }

    // Position one is exempt from the terminator list PROVISIONALLY, so
    // that street names beginning with a terminator ('The Queensway',
    // 'Main St') survive. The exemption is confirmed only if the run
    // continues past it: a civic number adjacent to a single stopword
    // ('16 copy', '400 agreement') is a digit next to a word, not an
    // address. This check counts tokens taken into the WINDOW, before
    // parseAddress ever sees it -- it must not be reapplied to
    // parseAddress's output, where '22 Main St' legitimately reduces to
    // street 'main' once 'St' is consumed as a streetType.
    const tokensAfterCivic = window.length - 1;
    if (
      tokensAfterCivic === 1 &&
      Object.prototype.hasOwnProperty.call(TERMINATOR_SET, window[1])
    ) {
      continue;
    }

    const candidate = parseAddress(window.join(' '));
    if (candidate !== null) {
      results.push(candidate);
    }
  }

  return results;
}

module.exports = { findAddressCandidates };

module.exports._internal = { TERMINATORS };
