'use strict';

const { ACTORS, EVENT_KINDS, makeEvent, appendEvent, buildCloseOutstandingPayload } = require('../src/transactions/events');

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
  it('lists exactly the six expected kinds', () => {
    expect(EVENT_KINDS).toEqual([
      'closed_with_items_outstanding',
      'fact_set',
      'fact_confirmed',
      'fact_corrected',
      'item_completed',
      'item_uncompleted',
    ]);
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

describe('buildCloseOutstandingPayload', () => {
  function item(overrides = {}) {
    return {
      id: 'item_id',
      label: 'Item label',
      applicability: 'required',
      completed: false,
      ...overrides,
    };
  }

  it('counts only required and incomplete items, but rows carries required and indeterminate', () => {
    const items = [
      item({ id: 'a', label: 'A', applicability: 'required', completed: false }),
      item({ id: 'b', label: 'B', applicability: 'required', completed: true }),
      item({ id: 'c', label: 'C', applicability: 'indeterminate', completed: false }),
      item({ id: 'd', label: 'D', applicability: 'not_applicable', completed: false }),
      item({ id: 'e', label: 'E', applicability: 'no_longer_applicable', completed: false }),
    ];

    const payload = buildCloseOutstandingPayload(items);

    expect(payload.outstandingCount).toBe(1);
    expect(payload.rows).toEqual([
      { id: 'a', label: 'A', applicability: 'required', completed: false },
      { id: 'b', label: 'B', applicability: 'required', completed: true },
      { id: 'c', label: 'C', applicability: 'indeterminate', completed: false },
    ]);
    expect(payload.rows.length).not.toBe(payload.outstandingCount);
  });

  it('freezes the payload and the rows array, but not the row objects', () => {
    const payload = buildCloseOutstandingPayload([item()]);
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.rows)).toBe(true);
    expect(Object.isFrozen(payload.rows[0])).toBe(false);
  });

  it('copies values rather than holding a reference to the original item', () => {
    const original = item({ id: 'a', label: 'A' });
    const payload = buildCloseOutstandingPayload([original]);
    expect(payload.rows[0]).not.toBe(original);
    original.label = 'mutated';
    expect(payload.rows[0].label).toBe('A');
  });

  it('coerces a missing or falsy completed to boolean false', () => {
    const items = [item({ id: 'a', completed: undefined }), item({ id: 'b', completed: 0 })];
    const payload = buildCloseOutstandingPayload(items);
    expect(payload.rows[0].completed).toBe(false);
    expect(payload.rows[1].completed).toBe(false);
  });

  it('coerces a truthy completed to boolean true', () => {
    const payload = buildCloseOutstandingPayload([item({ completed: 'yes' })]);
    expect(payload.rows[0].completed).toBe(true);
  });

  it('excludes not_applicable and no_longer_applicable from rows entirely', () => {
    const items = [
      item({ id: 'a', applicability: 'not_applicable' }),
      item({ id: 'b', applicability: 'no_longer_applicable' }),
    ];
    const payload = buildCloseOutstandingPayload(items);
    expect(payload.rows).toEqual([]);
    expect(payload.outstandingCount).toBe(0);
  });

  it('returns zero count and empty rows for an empty array', () => {
    const payload = buildCloseOutstandingPayload([]);
    expect(payload).toEqual({ outstandingCount: 0, rows: [] });
  });

  it('rejects a non-array items argument', () => {
    expect(() => buildCloseOutstandingPayload({}))
      .toThrow(/^buildCloseOutstandingPayload: items must be an array/);
  });

  it('rejects a null item', () => {
    expect(() => buildCloseOutstandingPayload([null]))
      .toThrow(/^buildCloseOutstandingPayload: every item must be a plain object/);
  });

  it('rejects an array item', () => {
    expect(() => buildCloseOutstandingPayload([[]]))
      .toThrow(/^buildCloseOutstandingPayload: every item must be a plain object/);
  });

  it('rejects a non-object item', () => {
    expect(() => buildCloseOutstandingPayload(['nope']))
      .toThrow(/^buildCloseOutstandingPayload: every item must be a plain object/);
  });

  it('rejects a missing id', () => {
    expect(() => buildCloseOutstandingPayload([item({ id: undefined })]))
      .toThrow(/^buildCloseOutstandingPayload: every item must have a non-empty string id/);
  });

  it('rejects an empty id', () => {
    expect(() => buildCloseOutstandingPayload([item({ id: '' })]))
      .toThrow(/^buildCloseOutstandingPayload: every item must have a non-empty string id/);
  });

  it('rejects a missing label', () => {
    expect(() => buildCloseOutstandingPayload([item({ label: undefined })]))
      .toThrow(/^buildCloseOutstandingPayload: every item must have a non-empty string label/);
  });

  it('rejects an empty label', () => {
    expect(() => buildCloseOutstandingPayload([item({ label: '' })]))
      .toThrow(/^buildCloseOutstandingPayload: every item must have a non-empty string label/);
  });

  it('rejects an unknown applicability instead of dropping the item silently', () => {
    expect(() => buildCloseOutstandingPayload([item({ applicability: 'bogus' })]))
      .toThrow(/^buildCloseOutstandingPayload: unknown applicability 'bogus'/);
  });
});
