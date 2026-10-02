'use strict';

// A calendar date is a day named in an agreement (acceptance, a condition
// deadline, a deposit due date), not an instant: no time, no timezone.
//
// The round trip check below is the point of this module: new Date()
// silently rolls impossible dates forward (2026-02-30 becomes 2026-03-02),
// and the transaction store's timestamp validator accepts that; a date
// that does not survive the round trip is refused, never moved.
//
// The round trip also rejects years 0 to 99, because Date.UTC maps them to 1900
// to 1999.
//
// Today is always computed in the agent's own timezone, because UTC rolls to
// tomorrow during a Toronto evening. Days are counted on calendar dates in
// UTC, where every day is exactly 24 hours, so a DST weekend cannot shorten
// two days to 47 hours. timeZone has no default here on purpose, since
// callers pass the agent's own.

const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const match = CALENDAR_DATE_RE.exec(value);
  if (!match) {
    return false;
  }

  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const d = parseInt(match[3], 10);

  const dt = new Date(Date.UTC(y, m - 1, d));

  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function describeBadCalendarDate(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return `'${value}'`;
  return typeof value;
}

function todayInTimeZone(now, timeZone) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('todayInTimeZone: now must be a valid Date');
  }
  if (typeof timeZone !== 'string' || timeZone === '') {
    throw new Error('todayInTimeZone: timeZone must be a non-empty string');
  }

  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
  } catch (err) {
    if (err instanceof RangeError) {
      throw new Error(`todayInTimeZone: unknown timeZone '${timeZone}'`);
    }
    throw err;
  }

  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;

  return `${year}-${month}-${day}`;
}

function daysBetween(fromDate, toDate) {
  if (!isCalendarDate(fromDate)) {
    throw new Error(`daysBetween: fromDate must be a calendar date (YYYY-MM-DD), got ${describeBadCalendarDate(fromDate)}`);
  }
  if (!isCalendarDate(toDate)) {
    throw new Error(`daysBetween: toDate must be a calendar date (YYYY-MM-DD), got ${describeBadCalendarDate(toDate)}`);
  }

  const [fy, fm, fd] = fromDate.split('-').map(s => parseInt(s, 10));
  const [ty, tm, td] = toDate.split('-').map(s => parseInt(s, 10));

  return (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000;
}

module.exports = { isCalendarDate, todayInTimeZone, daysBetween };
