'use strict';

// Hand-maintained, not derived. item.reads only covers the fact keys the
// resolver checks for presence before calling requiredWhen; requiredWhen
// itself is an opaque closure that dereferences facts.x directly, so nothing
// can enumerate those keys mechanically (see the reads-coverage test in
// facts.test.js, which pins the half of this list that CAN be checked
// mechanically). Every key below is either present in some item's reads
// array, dereferenced inside some item's requiredWhen body, or — for
// representedPersons — read directly by resolver.js itself outside any
// single catalog item (assertRepresentedPersons, withClientSatisfaction).
//
// clientSatisfactions is DELIBERATELY ABSENT from this list. It is also read
// directly by resolver.js (assertClientSatisfactions, isPersonSatisfied), so
// by the same reasoning as representedPersons it looks like an oversight not
// to include it — it is not. It is completion state, a per-person,
// per-item map, not a plain fact: a single { before, after } pair for the
// whole map cannot describe one person clearing one item. It needs its own
// writer, alongside the item writer, per TC_SPEC 4.3's known limitations.
// Adding it here to "complete" the enumeration would cement setFact as the
// wrong home for it. See facts.test.js for the test pinning this exclusion.
const FACT_KEYS = Object.freeze([
  'hasSelfRepresentedParty',
  'entityType',
  'conditions',
  'brokerageReceivedFunds',
  'representedPersons',
]);

module.exports = {
  FACT_KEYS,
};
