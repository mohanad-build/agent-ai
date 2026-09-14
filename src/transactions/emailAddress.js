'use strict';

// Normalizes an email address string for comparison: trim plus lowercase,
// nothing looser. This is comparison normalization only, not storage
// normalization - callers still store whatever casing and whitespace they
// were given, and only compare through this function. Extracted as its
// own leaf (no dependencies, one export, no _internal) rather than left
// private inside matcher.js, so a second module can compare against the
// same rule instead of growing its own copy that drifts. Not folded into
// address.js: that module owns street addresses, and this is a different
// kind of "address" entirely; reusing that name here would just move the
// ambiguity rather than remove it.
function normalizeEmailAddress(value) {
  return String(value || '').trim().toLowerCase();
}

module.exports = {
  normalizeEmailAddress,
};
