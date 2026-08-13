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

function buildCloseOutstandingPayload(items) {
  if (!Array.isArray(items)) {
    throw new Error('buildCloseOutstandingPayload: items must be an array');
  }

  let outstandingCount = 0;
  const rows = [];

  items.forEach((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('buildCloseOutstandingPayload: every item must be a plain object');
    }
    if (typeof item.id !== 'string' || item.id.trim() === '') {
      throw new Error('buildCloseOutstandingPayload: every item must have a non-empty string id');
    }
    if (typeof item.label !== 'string' || item.label.trim() === '') {
      throw new Error('buildCloseOutstandingPayload: every item must have a non-empty string label');
    }
    if (!APPLICABILITIES.includes(item.applicability)) {
      throw new Error(`buildCloseOutstandingPayload: unknown applicability '${item.applicability}'`);
    }

    const completed = Boolean(item.completed);

    if (item.applicability === 'required' && !completed) {
      outstandingCount += 1;
    }

    if (item.applicability === 'required' || item.applicability === 'indeterminate') {
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
