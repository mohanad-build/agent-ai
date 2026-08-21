'use strict';

// What an event IS (shape and validation), plus the payload shape for the
// closed_with_items_outstanding kind. Writing an event onto a transaction
// record, or calling the resolver to produce items in the first place,
// stays out of this file.

const ACTORS = Object.freeze(['agent', 'system', 'operator']);

const EVENT_KINDS = Object.freeze([
  'closed_with_items_outstanding',
  'fact_set',
  'fact_confirmed',
  'fact_corrected',
  'item_completed',
  'item_uncompleted',
  'person_satisfied',
  'person_unsatisfied',
  'document_seen',
  'document_filed',
  'document_filing_abandoned',
  'document_confirmed',
  'document_rejected',
  'participant_added',
]);

function makeEvent({ at, actor, kind, payload }) {
  if (typeof at !== 'string' || at.trim() === '') {
    throw new Error('makeEvent: at must be a non-empty string');
  }

  // Number.isNaN short-circuits before toISOString() so an unparseable
  // string fails with the makeEvent-prefixed error below instead of a raw
  // RangeError from calling toISOString() on an Invalid Date.
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== at) {
    throw new Error('makeEvent: at must be a strict ISO 8601 string where new Date(at).toISOString() === at');
  }

  if (!ACTORS.includes(actor)) {
    throw new Error(`makeEvent: actor must be one of ${ACTORS.join(', ')}`);
  }

  if (!EVENT_KINDS.includes(kind)) {
    throw new Error(`makeEvent: kind must be one of ${EVENT_KINDS.join(', ')}`);
  }

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('makeEvent: payload must be a plain object');
  }

  return Object.freeze({ at, actor, kind, payload });
}

function appendEvent(events, event) {
  const base = events === undefined ? [] : events;
  return Object.freeze([...base, event]);
}

// Applicability values as produced by resolver.reResolve. Local to this
// file: the resolver owns the definition, this is only a closed list to
// validate against.
const APPLICABILITIES = ['required', 'indeterminate', 'not_applicable', 'no_longer_applicable'];

// outstandingCount and indeterminateCount are reported separately, never
// merged into one number. outstanding 2 / indeterminate 0 is an agent who
// worked the file and skipped two required items — a compliance gap.
// outstanding 2 / indeterminate 11 is a file nobody ever filled in, so most
// of the checklist never resolved past waiting on facts — a data gap. One
// number cannot tell those apart, and the person reading this during a
// complaint is the one who most needs to.
function buildCloseOutstandingPayload(items) {
  if (!Array.isArray(items)) {
    throw new Error('buildCloseOutstandingPayload: items must be an array');
  }

  let outstandingCount = 0;
  let indeterminateCount = 0;
  const rows = [];

  items.forEach((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('buildCloseOutstandingPayload: every item must be a plain object');
    }
    if (typeof item.id !== 'string' || item.id.trim() === '') {
      throw new Error('buildCloseOutstandingPayload: every item must have a non-empty string id');
    }
    if (!APPLICABILITIES.includes(item.applicability)) {
      throw new Error(`buildCloseOutstandingPayload: unknown applicability '${item.applicability}'`);
    }

    // For a client-scoped 'event' item, per-person satisfaction is the
    // completion signal, not item.completed: withClientSatisfaction (in
    // resolver.js) never writes item.completed, so a client-scoped item
    // that every represented person has cleared would otherwise show up as
    // incomplete here. We read presence of outstandingPersons specifically
    // (not satisfiedPersons, not either-of-the-two): the resolver already
    // decided when to emit it — required emits it, not_applicable emits
    // only satisfiedPersons — so re-deriving that from scope/clientScope
    // here would duplicate the resolver's rule in a second place.
    const completed = Object.prototype.hasOwnProperty.call(item, 'outstandingPersons')
      ? item.outstandingPersons.length === 0
      : Boolean(item.completed);

    if (item.applicability === 'required' && !completed) {
      outstandingCount += 1;
    }

    if (item.applicability === 'indeterminate') {
      indeterminateCount += 1;
    }

    if (item.applicability === 'required' || item.applicability === 'indeterminate') {
      // label is only ever read off a row, so it is only validated for an
      // item that becomes one. A carried-over no_longer_applicable item has
      // no label (carriedOver in resolver.js only spreads the stored entry,
      // which never had one) and is dropped below before this would matter.
      if (typeof item.label !== 'string' || item.label.trim() === '') {
        throw new Error('buildCloseOutstandingPayload: every item must have a non-empty string label');
      }
      rows.push({
        id: item.id,
        label: item.label,
        applicability: item.applicability,
        completed,
      });
    }
  });

  Object.freeze(rows);

  return Object.freeze({
    outstandingCount,
    indeterminateCount,
    rows,
  });
}

module.exports = {
  ACTORS,
  EVENT_KINDS,
  makeEvent,
  appendEvent,
  buildCloseOutstandingPayload,
};
