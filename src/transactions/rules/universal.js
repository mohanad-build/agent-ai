'use strict';

// -- Universal items ----------------------------------------------------------
// What every record carries regardless of whether it is a deal or a listing.

const UNIVERSAL_ITEMS = [
  {
    id: 'reco_information_guide',
    label: 'RECO Information Guide',
    source: 'TRESA',
    scope: 'client',
    clientScope: 'event',
    evidence: 'attestation',
    reads: [],
  },
];

module.exports = {
  UNIVERSAL_ITEMS,
};
