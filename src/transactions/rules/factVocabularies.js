'use strict';

// Absent means unknown; entityType is optional on a participant, and a
// participant with no entityType at all is a real, permitted state, not
// an error. Adding a value here is safe at any time; removing or
// renaming one is not, because a stored participant on an existing
// transaction can already hold a value this list no longer accepts.
// Shared by the deal-level entityType fact and the participant field, so
// the two answers cannot drift.
const ENTITY_TYPES = Object.freeze(['individual', 'corporation', 'other_entity']);

// TC_SPEC 7.1.2b. single is a normal one-sided deal; double_ended is one
// agent on both sides and is the only value that unions the paired
// catalog; designated is two agents at the same brokerage, which produces
// two separate single-sided deals. Absent is the normal state.
const REPRESENTATION_ARRANGEMENTS = Object.freeze(['single', 'double_ended', 'designated']);

module.exports = { ENTITY_TYPES, REPRESENTATION_ARRANGEMENTS };
