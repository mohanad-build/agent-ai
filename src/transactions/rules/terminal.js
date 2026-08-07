'use strict';

// -- Terminal items -------------------------------------------------------------
// Spread into all four catalog types. terminalOnly: true is the one deliberate
// exception to "the resolver returns the annotated full set and never filters":
// resolveChecklist excludes an item marked terminalOnly entirely unless state is
// 'collapsed', rather than resolving it not_applicable, because a not_applicable
// mutual release would still render as a row with a reason, which on a healthy
// deal reads as the system floating the possibility the deal dies. Absent is the
// requirement, not merely not-required.

const TERMINAL_ITEMS = [
  {
    id: 'mutual_release',
    label: 'Mutual Release signed by all parties and submitted to the brokerage',
    source: 'brokerage',
    scope: 'transaction',
    evidence: 'document',
    reads: [],
    terminalOnly: true,
  },
];

module.exports = {
  TERMINAL_ITEMS,
};
