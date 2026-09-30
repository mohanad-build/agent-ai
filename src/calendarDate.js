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
// Today-in-timezone and day counting will live here too.

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

module.exports = { isCalendarDate };
