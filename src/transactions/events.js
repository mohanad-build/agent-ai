'use strict';

// One concern: what an event IS (shape and validation). Building a specific
// event's payload, such as the close-with-items-outstanding payload, is
// separate work that belongs elsewhere.

const ACTORS = Object.freeze(['agent', 'system', 'operator']);

const EVENT_KINDS = Object.freeze(['closed_with_items_outstanding']);

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

module.exports = {
  ACTORS,
  EVENT_KINDS,
  makeEvent,
  appendEvent,
};
