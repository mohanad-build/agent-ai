'use strict';

const { isCalendarDate, todayInTimeZone, daysBetween } = require('../src/calendarDate');

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

describe('todayInTimeZone', () => {
  const TORONTO_ROWS = [
    ['2026-11-01T03:30:00Z', '2026-10-31'], // 23:30 EDT the evening before DST ends
    ['2026-11-01T05:30:00Z', '2026-11-01'], // 01:30 EDT, the morning DST ends
    ['2026-11-01T06:30:00Z', '2026-11-01'], // 01:30 EST, the repeated hour after DST ends
    ['2026-03-08T04:30:00Z', '2026-03-07'], // 23:30 EST the evening before DST starts
    ['2026-03-08T07:30:00Z', '2026-03-08'], // 03:30 EDT, just after DST starts
    ['2026-07-15T03:59:00Z', '2026-07-14'], // 23:59 EDT
    ['2026-07-15T04:00:00Z', '2026-07-15'], // 00:00 EDT
    ['2026-12-31T23:30:00Z', '2026-12-31'], // 18:30 EST, still the same year in Toronto
    ['2027-01-01T04:30:00Z', '2026-12-31'], // 23:30 EST, UTC is already next year
  ];

  it.each(TORONTO_ROWS)('America/Toronto %s -> %s', (iso, expected) => {
    expect(todayInTimeZone(new Date(iso), 'America/Toronto')).toBe(expected);
  });

  it('UTC 2026-11-01T03:30:00Z -> 2026-11-01 (proves the zone is actually used)', () => {
    expect(todayInTimeZone(new Date('2026-11-01T03:30:00Z'), 'UTC')).toBe('2026-11-01');
  });

  describe('throws', () => {
    it("now = new Date('not a date') -> 'todayInTimeZone: now must be a valid Date'", () => {
      expect(() => todayInTimeZone(new Date('not a date'), 'America/Toronto'))
        .toThrow('todayInTimeZone: now must be a valid Date');
    });

    it("now = '2026-11-01' (a string) -> same message", () => {
      expect(() => todayInTimeZone('2026-11-01', 'America/Toronto'))
        .toThrow('todayInTimeZone: now must be a valid Date');
    });

    it("timeZone '' -> 'todayInTimeZone: timeZone must be a non-empty string'", () => {
      expect(() => todayInTimeZone(new Date('2026-11-01T03:30:00Z'), ''))
        .toThrow('todayInTimeZone: timeZone must be a non-empty string');
    });

    it("timeZone 'Mars/Olympus' -> \"todayInTimeZone: unknown timeZone 'Mars/Olympus'\"", () => {
      expect(() => todayInTimeZone(new Date('2026-11-01T03:30:00Z'), 'Mars/Olympus'))
        .toThrow("todayInTimeZone: unknown timeZone 'Mars/Olympus'");
    });
  });
});

describe('daysBetween', () => {
  const ROWS = [
    ['2026-10-06', '2026-10-06', 0],
    ['2026-10-04', '2026-10-06', 2],
    ['2026-10-06', '2026-10-04', -2],
    ['2026-03-07', '2026-03-09', 2], // across DST start
    ['2026-10-31', '2026-11-02', 2], // across DST end
    ['2026-12-31', '2027-01-01', 1],
    ['2028-02-28', '2028-03-01', 2], // leap year
    ['2026-02-28', '2026-03-01', 1], // non-leap year
  ];

  it.each(ROWS)('%s -> %s = %i', (fromDate, toDate, expected) => {
    expect(daysBetween(fromDate, toDate)).toBe(expected);
  });

  describe('throws', () => {
    it("('2026-02-30', '2026-10-06') -> \"daysBetween: fromDate must be a calendar date (YYYY-MM-DD), got '2026-02-30'\"", () => {
      expect(() => daysBetween('2026-02-30', '2026-10-06'))
        .toThrow("daysBetween: fromDate must be a calendar date (YYYY-MM-DD), got '2026-02-30'");
    });

    it("('2026-10-06', null) -> 'daysBetween: toDate must be a calendar date (YYYY-MM-DD), got null'", () => {
      expect(() => daysBetween('2026-10-06', null))
        .toThrow('daysBetween: toDate must be a calendar date (YYYY-MM-DD), got null');
    });
  });
});
