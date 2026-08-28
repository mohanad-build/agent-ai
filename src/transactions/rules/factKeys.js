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
//
// representationArrangement (TC_SPEC 7.1.2b) is read in two different ways,
// which is worth spelling out since they look alike but are not: (1)
// resolveChecklist itself reads it directly (resolver.js) to decide which
// CATALOG entries to union -- a fact deciding an item SET, not one item's
// applicability, which was a new role for a fact in this codebase when it
// shipped. (2) Separately, multiple_representation_agreement's requiredWhen
// (buyerPurchase.js, sellerSale.js, tenantLease.js, landlordLease.js) reads
// it the ordinary way, same as any other requiredWhen, to decide that one
// item's applicability. Both readings coexist: the fact first decides
// whether a catalog gets unioned in, then, independently, decides whether
// this one item within the (possibly unioned) result is required.
const FACT_KEYS = Object.freeze([
  'hasSelfRepresentedParty',
  'entityType',
  'conditions',
  'brokerageReceivedFunds',
  'representationArrangement',
]);

module.exports = {
  FACT_KEYS,
};
