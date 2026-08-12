'use strict';

// -- Landlord listing items ---------------------------------------------------
// The universal spine (universal.js) currently carries two deal-only items,
// deal_sheet and srp_disclosure, because every existing type happens to be a
// deal type. landlord_listing is the first non-deal record, which is what
// exposes that. Splitting the spine touches all four existing type files and
// lands in the migration commit; until then this type spreads only the one
// universal item that isn't deal-only, not the whole spine.

const LANDLORD_LISTING_ITEMS = [
  {
    id: 'reco_information_guide',
    label: 'RECO Information Guide',
    source: 'TRESA',
    scope: 'client',
    clientScope: 'event',
    evidence: 'attestation',
    reads: [],
  },
  {
    id: 'listing_agreement_lease',
    label: 'Listing Agreement (Lease), in writing with remuneration method stated',
    source: 'TRESA',
    scope: 'transaction',
    evidence: 'document',
    reads: [],
  },
];

module.exports = {
  LANDLORD_LISTING_ITEMS,
};
