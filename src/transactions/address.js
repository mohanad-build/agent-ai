'use strict';

// Pure comparison-form address parser for TC document matching. Free text
// in, { civic, street, streetType?, directional?, city? } out. Used only to
// compare one address against another; nothing produced here is ever
// written to storage. No I/O, no clock, no opts bag: parseAddress takes a
// single positional argument, matching states.js and resolver.js rather
// than the CRUD writers in this directory, which take an opts bag because
// they read and write through store.js.

// -- Expansion tables ---------------------------------------------------------------

// Three groups, each canonical key mapped to every free-text alias that
// should collapse onto it. Nested arrays, so this needs the deepFreeze
// idiom from states.js, not a flat Object.freeze: a shallow freeze would
// leave e.g. TABLE.streetTypes.road itself mutable.
const TABLE = {
  streetTypes: {
    street: ['street', 'st'],
    road: ['road', 'rd'],
    avenue: ['avenue', 'ave', 'av'],
    drive: ['drive', 'dr'],
    boulevard: ['boulevard', 'blvd'],
    crescent: ['crescent', 'cres'],
    court: ['court', 'crt', 'ct'],
    place: ['place', 'pl'],
    lane: ['lane', 'ln'],
    trail: ['trail', 'tr'],
    terrace: ['terrace', 'terr'],
    gate: ['gate'],
    grove: ['grove', 'grv'],
    way: ['way'],
    circle: ['circle', 'cir'],
    square: ['square', 'sq'],
    parkway: ['parkway', 'pkwy'],
    heights: ['heights', 'hts'],
    gardens: ['gardens', 'gdns'],
  },
  directionals: {
    e: ['east', 'e'],
    w: ['west', 'w'],
    n: ['north', 'n'],
    s: ['south', 's'],
    ne: ['northeast', 'ne'],
    nw: ['northwest', 'nw'],
    se: ['southeast', 'se'],
    sw: ['southwest', 'sw'],
  },
  namePrefixes: {
    saint: ['saint', 'st'],
    mount: ['mount', 'mt'],
  },
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

deepFreeze(TABLE);

// Alias -> canonical, derived from TABLE at load time so the parser does a
// single property lookup per token instead of scanning every group.
function buildAliasLookup(group) {
  const lookup = {};
  Object.keys(group).forEach((canonical) => {
    group[canonical].forEach((alias) => {
      lookup[alias] = canonical;
    });
  });
  return lookup;
}

const STREET_TYPE_LOOKUP = buildAliasLookup(TABLE.streetTypes);
const DIRECTIONAL_LOOKUP = buildAliasLookup(TABLE.directionals);
const NAME_PREFIX_LOOKUP = buildAliasLookup(TABLE.namePrefixes);

// -- Argument assertions ------------------------------------------------------------

function assertNonEmptyString(fnName, name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fnName}: ${name} must be a non-empty string`);
  }
}

function assertParsedAddressOrNull(fnName, name, value) {
  if (value === undefined || (value !== null && typeof value !== 'object')) {
    throw new Error(`${fnName}: ${name} must be a parseAddress result or null`);
  }
}

// -- Civic number ---------------------------------------------------------------------

// Digits, optionally hyphen-joined to more digits, from the very start of
// the street portion. Captured as a group so the matched text (including
// any trailing separator space) can be measured and stripped separately
// from the captured value itself.
const CIVIC_RE = /^(\d+(?:-\d+)*)\s*/;

// -- City -----------------------------------------------------------------------------

const PROVINCE_RE = /\bon(?:tario)?\b/g;
// Canadian postal code shape: letter-digit-letter, optional space,
// digit-letter-digit. Good enough to recognise and discard one, not to
// validate one -- this module does no province or postal parsing.
const POSTAL_RE = /\b[a-z]\d[a-z]\s?\d[a-z]\d\b/g;

function extractCity(blob) {
  if (blob.trim() === '') {
    return null;
  }

  const candidate = blob
    .toLowerCase()
    .replace(POSTAL_RE, ' ')
    .replace(PROVINCE_RE, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (candidate === '') {
    return null;
  }
  // A comma-separated trailing component that is itself a street type or
  // directional (e.g. a stray "East") is not a city.
  if (Object.prototype.hasOwnProperty.call(STREET_TYPE_LOOKUP, candidate)) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(DIRECTIONAL_LOOKUP, candidate)) {
    return null;
  }
  return candidate;
}

// -- parseAddress -----------------------------------------------------------------

function parseAddress(text) {
  assertNonEmptyString('parseAddress', 'address', text);

  const trimmed = text.trim();
  const commaIndex = trimmed.indexOf(',');
  const streetPart = commaIndex === -1 ? trimmed : trimmed.slice(0, commaIndex);
  const cityBlob = commaIndex === -1 ? '' : trimmed.slice(commaIndex + 1);

  const civicMatch = streetPart.match(CIVIC_RE);
  if (!civicMatch) {
    return null;
  }
  const civic = civicMatch[1];
  const remainder = streetPart.slice(civicMatch[0].length);

  // The civic number is captured above, verbatim, before any punctuation
  // stripping happens. src/digest.js:1401 collapses every non-alphanumeric
  // run to a single space in one pass over the whole string; applied to an
  // address that would turn '14-16' into '14 16' and destroy the range.
  // Only the remainder -- which by construction can no longer contain the
  // civic number -- goes through that kind of collapse, and only after the
  // civic is already captured and set aside.
  const normalizedRemainder = remainder
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const tokens = normalizedRemainder === '' ? [] : normalizedRemainder.split(' ');

  // Trailing position: directional first, then street type on whatever is
  // now last. Checked before the leading check below so that a single
  // remaining token is claimed by the trailing rule first.
  let directional;
  const lastIndex = tokens.length - 1;
  if (lastIndex >= 0 && Object.prototype.hasOwnProperty.call(DIRECTIONAL_LOOKUP, tokens[lastIndex])) {
    directional = DIRECTIONAL_LOOKUP[tokens[lastIndex]];
    tokens.splice(lastIndex, 1);
  }

  let streetType;
  const newLastIndex = tokens.length - 1;
  if (newLastIndex >= 0 && Object.prototype.hasOwnProperty.call(STREET_TYPE_LOOKUP, tokens[newLastIndex])) {
    streetType = STREET_TYPE_LOOKUP[tokens[newLastIndex]];
    tokens.splice(newLastIndex, 1);
  }

  // Leading position, and the positional rule this module exists to get
  // right: 'st' sits in both the street-type table (Street) and the
  // name-prefix table (Saint). The trailing checks above never look at
  // index 0, so without this leading-only check a name-prefix token
  // immediately after the civic number would never get expanded at all --
  // '14 St Clair Ave' would read as street 'st clair' instead of
  // 'saint clair'. This is what disambiguates by position rather than by
  // which table happens to be consulted first.
  if (tokens.length > 0 && Object.prototype.hasOwnProperty.call(NAME_PREFIX_LOOKUP, tokens[0])) {
    tokens[0] = NAME_PREFIX_LOOKUP[tokens[0]];
  }

  // streetType, directional and city are set only when found: absent,
  // never null, for every field with no value, following listingId and
  // unit in store.js.
  const result = { civic, street: tokens.join(' ') };
  if (streetType !== undefined) {
    result.streetType = streetType;
  }
  if (directional !== undefined) {
    result.directional = directional;
  }

  const city = extractCity(cityBlob);
  if (city !== null) {
    result.city = city;
  }

  return result;
}

// -- compareAddresses --------------------------------------------------------------

// Takes two parseAddress results (or null, meaning no civic number was
// found in the source text) and decides whether they name the same
// address. Unit is deliberately not handled here: it is a sibling field on
// the transaction envelope, not part of an address string, so comparing it
// is the caller's concern one level up.
function compareAddresses(a, b) {
  assertParsedAddressOrNull('compareAddresses', 'a', a);
  assertParsedAddressOrNull('compareAddresses', 'b', b);

  if (a === null || b === null) {
    return { match: false, reason: 'no address' };
  }

  if (a.civic !== b.civic) {
    return { match: false, reason: 'civic differs' };
  }

  if (a.street !== b.street) {
    return { match: false, reason: 'street differs' };
  }

  // Absent on either side is uninformative, not a mismatch: agents usually
  // type just a number and street name.
  if (a.streetType !== undefined && b.streetType !== undefined && a.streetType !== b.streetType) {
    return { match: false, reason: 'street type conflict' };
  }

  if (a.directional !== undefined && b.directional !== undefined && a.directional !== b.directional) {
    return { match: false, reason: 'directional conflict' };
  }

  if (a.city !== undefined && b.city !== undefined && a.city !== b.city) {
    return { match: false, reason: 'city conflict' };
  }

  return { match: true, reason: 'match' };
}

module.exports = { parseAddress, compareAddresses };

module.exports._internal = { TABLE };
