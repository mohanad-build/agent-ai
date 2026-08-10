'use strict';

const { ACTORS, EVENT_KINDS, makeEvent, appendEvent } = require('../src/transactions/events');

const VALID_AT = '2026-05-18T22:33:00.000Z';
const VALID_KIND = 'closed_with_items_outstanding';

function validArgs(overrides = {}) {
  return {
    at: VALID_AT,
    actor: 'agent',
    kind: VALID_KIND,
    payload: { note: 'ok' },
    ...overrides,
  };
}

describe('ACTORS', () => {
  it('lists exactly the three actors', () => {
    expect(ACTORS).toEqual(['agent', 'system', 'operator']);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ACTORS)).toBe(true);
  });
});

describe('EVENT_KINDS', () => {
  it('lists exactly one kind', () => {
    expect(EVENT_KINDS).toEqual(['closed_with_items_outstanding']);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(EVENT_KINDS)).toBe(true);
  });
});

describe('makeEvent', () => {
  it('builds a frozen event with the four expected fields', () => {
    const event = makeEvent(validArgs());
    expect(event).toEqual({
      at: VALID_AT,
      actor: 'agent',
      kind: VALID_KIND,
      payload: { note: 'ok' },
    });
    expect(Object.isFrozen(event)).toBe(true);
  });

  it('does not freeze the payload', () => {
    const payload = { note: 'ok' };
    const event = makeEvent(validArgs({ payload }));
    expect(Object.isFrozen(event.payload)).toBe(false);
    expect(event.payload).toBe(payload);
  });

  it.each(ACTORS)('accepts actor %s', (actor) => {
    expect(() => makeEvent(validArgs({ actor }))).not.toThrow();
  });

  it('rejects an actor outside ACTORS', () => {
    expect(() => makeEvent(validArgs({ actor: 'client' })))
      .toThrow(/^makeEvent: actor must be one of/);
  });

  it('rejects a missing at', () => {
    expect(() => makeEvent(validArgs({ at: undefined })))
      .toThrow(/^makeEvent: at must be a non-empty string/);
  });

  it('rejects an empty at', () => {
    expect(() => makeEvent(validArgs({ at: '' })))
      .toThrow(/^makeEvent: at must be a non-empty string/);
  });

  it('rejects an at that is not a strict ISO round trip', () => {
    expect(() => makeEvent(validArgs({ at: '2026-05-18' })))
      .toThrow(/^makeEvent: at must be a strict ISO 8601 string/);
  });

  it('rejects an at that does not parse as a date at all', () => {
    expect(() => makeEvent(validArgs({ at: 'not-a-date' })))
      .toThrow(/^makeEvent: at must be a strict ISO 8601 string/);
  });

  it('rejects a kind outside EVENT_KINDS', () => {
    expect(() => makeEvent(validArgs({ kind: 'reopened' })))
      .toThrow(/^makeEvent: kind must be one of/);
  });

  it('rejects a null payload', () => {
    expect(() => makeEvent(validArgs({ payload: null })))
      .toThrow(/^makeEvent: payload must be a plain object/);
  });

  it('rejects an array payload', () => {
    expect(() => makeEvent(validArgs({ payload: [] })))
      .toThrow(/^makeEvent: payload must be a plain object/);
  });

  it('rejects a non-object payload', () => {
    expect(() => makeEvent(validArgs({ payload: 'oops' })))
      .toThrow(/^makeEvent: payload must be a plain object/);
  });
});

describe('appendEvent', () => {
  it('returns a new frozen array with the event appended', () => {
    const event = makeEvent(validArgs());
    const result = appendEvent([], event);
    expect(result).toEqual([event]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('does not mutate the input array', () => {
    const event1 = makeEvent(validArgs());
    const event2 = makeEvent(validArgs({ actor: 'system' }));
    const original = [event1];
    const result = appendEvent(original, event2);
    expect(original).toEqual([event1]);
    expect(original.length).toBe(1);
    expect(result).toEqual([event1, event2]);
    expect(result).not.toBe(original);
  });

  it('treats undefined events as an empty array', () => {
    const event = makeEvent(validArgs());
    const result = appendEvent(undefined, event);
    expect(result).toEqual([event]);
    expect(Object.isFrozen(result)).toBe(true);
  });
});
