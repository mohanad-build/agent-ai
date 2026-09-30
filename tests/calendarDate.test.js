'use strict';

const { isCalendarDate } = require('../src/calendarDate');

const ACCEPTS = [
  '2026-10-06',
  '2026-01-01',
  '2026-12-31',
  '2024-02-29',
  '2000-02-29',
];

const REJECTS = [
  ['2026-02-29', 'non-leap year'],
  ['2100-02-29', 'century, not a leap year'],
  ['2026-02-30', 'rollover'],
  ['2026-04-31', 'April has 30 days'],
  ['2026-13-01', 'month 13'],
  ['2026-00-10', 'month 0'],
  ['2026-10-00', 'day 0'],
  ['2026-10-32', 'day 32'],
  ['0099-01-01', 'two-digit year that Date.UTC maps to 1999'],
  ['2026-10-6', 'unpadded day'],
  ['26-10-06', 'two-digit year'],
  ['2026/10/06', 'slashes'],
  ['2026-10-06T00:00:00Z', 'a timestamp, not a date'],
  [' 2026-10-06', 'leading space'],
  ['2026-10-06 ', 'trailing space'],
  ['', 'empty string'],
  [null, 'null'],
  [undefined, 'undefined'],
  [20261006, 'a number'],
  [new Date('2026-10-06T00:00:00Z'), 'a Date object'],
  [{ toString: () => '2026-10-06' }, 'a non-string that stringifies to a valid date'],
];

describe('isCalendarDate', () => {
  describe('accepts', () => {
    it.each(ACCEPTS)('%s', (value) => {
      expect(isCalendarDate(value)).toBe(true);
    });
  });

  describe('rejects', () => {
    it.each(REJECTS)('%s (%s)', (value, _label) => {
      expect(isCalendarDate(value)).toBe(false);
    });
  });

  it('never throws, over every rejects input', () => {
    REJECTS.forEach(([value]) => {
      expect(() => isCalendarDate(value)).not.toThrow();
    });
  });
});
