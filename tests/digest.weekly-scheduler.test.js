'use strict';

const { shouldRunWeeklyDigest } = require('../src/digest');

// 2026-05-17 is a Sunday. Verify:
//   May 1 2026 = Thursday (Jan 1 2026 = Thursday, day 4)
//   Days from Jan 1 to May 17 = 31+28+31+30+16 = 136
//   (4 + 136) % 7 = 140 % 7 = 0 = Sunday
//
// America/Toronto = EDT = UTC-4 in May.
// America/Vancouver = PDT = UTC-7 in May.
// Toronto digestTime '08:00' fires at 12:00 UTC on Sunday.

const TORONTO_WEEKLY_FIRE = new Date('2026-05-17T12:00:00Z'); // Sunday 08:00 EDT
const STATE_NULL  = { lastWeeklyDigestRun: null };
const TORONTO_CFG = { digestTime: '08:00', timezone: 'America/Toronto' };

test('fires when today is Sunday, now is at digestTime, lastWeeklyDigestRun is null', () => {
  expect(shouldRunWeeklyDigest(TORONTO_CFG, TORONTO_WEEKLY_FIRE, STATE_NULL)).toBe(true);
});

test('does NOT fire when today is Saturday (one day before Sunday)', () => {
  const now = new Date('2026-05-16T12:00:00Z'); // Saturday 08:00 EDT
  expect(shouldRunWeeklyDigest(TORONTO_CFG, now, STATE_NULL)).toBe(false);
});

test('does NOT fire when today is Monday (one day after Sunday)', () => {
  const now = new Date('2026-05-18T12:00:00Z'); // Monday 08:00 EDT
  expect(shouldRunWeeklyDigest(TORONTO_CFG, now, STATE_NULL)).toBe(false);
});

test('does NOT fire when today is Sunday but now is 90min past digestTime', () => {
  const now = new Date('2026-05-17T13:30:00Z'); // Sunday 09:30 EDT
  expect(shouldRunWeeklyDigest(TORONTO_CFG, now, STATE_NULL)).toBe(false);
});

test('does NOT fire when lastWeeklyDigestRun was 3 days ago (within 6d idempotency)', () => {
  const state = { lastWeeklyDigestRun: '2026-05-14T12:00:00Z' }; // 3 days before
  expect(shouldRunWeeklyDigest(TORONTO_CFG, TORONTO_WEEKLY_FIRE, state)).toBe(false);
});

test('fires when lastWeeklyDigestRun was 7 days ago (outside 6d idempotency)', () => {
  const state = { lastWeeklyDigestRun: '2026-05-10T12:00:00Z' }; // 7 days before
  expect(shouldRunWeeklyDigest(TORONTO_CFG, TORONTO_WEEKLY_FIRE, state)).toBe(true);
});

test('defaults digestTime to 08:00 when undefined', () => {
  const config = { timezone: 'America/Toronto' };
  expect(shouldRunWeeklyDigest(config, TORONTO_WEEKLY_FIRE, STATE_NULL)).toBe(true);
});

test('defaults timezone to America/Toronto when undefined', () => {
  const config = { digestTime: '08:00' };
  expect(shouldRunWeeklyDigest(config, TORONTO_WEEKLY_FIRE, STATE_NULL)).toBe(true);
});

test('timezone shift: same UTC time fires for Toronto but not Vancouver (fire 3h later)', () => {
  // 12:05 UTC = Sunday 08:05 EDT (5min into grace for Toronto digestTime 08:00)
  //            = Sunday 05:05 PDT (2h55m BEFORE Vancouver's fire moment at 15:00 UTC)
  const now = new Date('2026-05-17T12:05:00Z');
  const vcCfg = { digestTime: '08:00', timezone: 'America/Vancouver' };

  expect(shouldRunWeeklyDigest(TORONTO_CFG, now, STATE_NULL)).toBe(true);
  expect(shouldRunWeeklyDigest(vcCfg,       now, STATE_NULL)).toBe(false);
});
