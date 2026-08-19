'use strict';

// Hand-maintained, not derived. item.reads only covers the fact keys the
// resolver checks for presence before calling requiredWhen; requiredWhen
// itself is an opaque closure that dereferences facts.x directly, so nothing
// can enumerate those keys mechanically (see the reads-coverage test in
// facts.test.js, which pins the half of this list that CAN be checked
// mechanically). Every key below is either present in some item's reads
// array or dereferenced inside some item's requiredWhen body.
//
// clientSatisfactions and representedPersons are DELIBERATELY ABSENT from
// this list, and for the same reason: each has its own writer, and setFact
// is the wrong home for it. clientSatisfactions is completion state, a
// per-person, per-item map, not a plain fact: a single { before, after }
// pair for the whole map cannot describe one person clearing one item, so
// it needs its own writer alongside the item writer, per TC_SPEC 4.3's
// known limitations. representedPersons is not stored at all anymore: it
// is derived from the participants map (participants.js's
// deriveRepresentedPersons, consumed by checklist.js), and the way to add
// a person to it is addParticipant, not setFact. Adding either key here to
// "complete" the enumeration would cement setFact as a second, competing
// writer for a value that already has its real one. See facts.test.js for
// the tests pinning both exclusions.
const FACT_KEYS = Object.freeze([
  'hasSelfRepresentedParty',
  'entityType',
  'conditions',
  'brokerageReceivedFunds',
]);

module.exports = {
  FACT_KEYS,
};
