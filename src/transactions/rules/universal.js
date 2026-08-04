'use strict';

// -- Universal items ----------------------------------------------------------
// Consumed by every transaction type's rules file.

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
  {
    id: 'srp_disclosure',
    label: 'Self-Represented Party Disclosure',
    source: 'TRESA',
    scope: 'transaction',
    evidence: 'document',
    reads: ['hasSelfRepresentedParty'],
    requiredWhen: (facts) => facts.hasSelfRepresentedParty === true,
    notApplicableReason: 'No self-represented party on this transaction',
  },
];

module.exports = {
  UNIVERSAL_ITEMS,
};
