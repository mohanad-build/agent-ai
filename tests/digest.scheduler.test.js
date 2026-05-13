'use strict';

const { shouldRunDailyDigest } = require('../src/digest');

// All times in 2026-05-12 (Tuesday, May). DST is in effect for both zones:
//   America/Toronto  = EDT = UTC-4  -> 07:00 EDT = 11:00 UTC
//   America/Vancouver = PDT = UTC-7  -> 07:00 PDT = 14:00 UTC

const TORONTO_FIRE = new Date('2026-05-12T11:00:00Z'); // exactly 07:00 EDT
const STATE_NULL   = { lastDailyDigestRun: null };
const TORONTO_CFG  = { digestTime: '07:00', timezone: 'America/Toronto' };

test('fires when now is exactly at digestTime, lastDailyDigestRun is null', () => {
  expect(shouldRunDailyDigest(TORONTO_CFG, TORONTO_FIRE, STATE_NULL)).toBe(true);
});

test('fires when now is 30min past digestTime, lastDailyDigestRun is null', () => {
  const now = new Date('2026-05-12T11:30:00Z'); // 07:30 EDT
  expect(shouldRunDailyDigest(TORONTO_CFG, now, STATE_NULL)).toBe(true);
});

test('does NOT fire when now is 30min before digestTime', () => {
  const now = new Date('2026-05-12T10:30:00Z'); // 06:30 EDT
  expect(shouldRunDailyDigest(TORONTO_CFG, now, STATE_NULL)).toBe(false);
});

test('does NOT fire when now is 90min past digestTime (outside 1h grace)', () => {
  const now = new Date('2026-05-12T12:30:00Z'); // 08:30 EDT
  expect(shouldRunDailyDigest(TORONTO_CFG, now, STATE_NULL)).toBe(false);
});

test('does NOT fire when lastDailyDigestRun is 6h ago', () => {
  // now = 07:00 EDT, lastRun = 01:00 EDT (6h ago in UTC-4)
  const state = { lastDailyDigestRun: '2026-05-12T05:00:00Z' };
  expect(shouldRunDailyDigest(TORONTO_CFG, TORONTO_FIRE, state)).toBe(false);
});

test('fires when lastDailyDigestRun is 13h ago', () => {
  // now = 07:00 EDT (11:00 UTC), lastRun = 18:00 EDT prev day (22:00 UTC prev day = 13h ago)
  const state = { lastDailyDigestRun: '2026-05-11T22:00:00Z' };
  expect(shouldRunDailyDigest(TORONTO_CFG, TORONTO_FIRE, state)).toBe(true);
});

test('defaults digestTime to 07:00 when agentConfig.digestTime is undefined', () => {
  const config = { timezone: 'America/Toronto' };
  expect(shouldRunDailyDigest(config, TORONTO_FIRE, STATE_NULL)).toBe(true);
});

test('defaults timezone to America/Toronto when agentConfig.timezone is undefined', () => {
  const config = { digestTime: '07:00' };
  expect(shouldRunDailyDigest(config, TORONTO_FIRE, STATE_NULL)).toBe(true);
});

test('America/Vancouver shifts fire moment 3h later than America/Toronto', () => {
  // 07:00 PDT = 14:00 UTC; now at 14:00 UTC fires for Vancouver, not for Toronto
  const now = new Date('2026-05-12T14:00:00Z');
  const vcCfg = { digestTime: '07:00', timezone: 'America/Vancouver' };
  expect(shouldRunDailyDigest(vcCfg, now, STATE_NULL)).toBe(true);
  // With same now, Toronto fire was at 11:00 UTC: delta = 3h > 1h -> false
  expect(shouldRunDailyDigest(TORONTO_CFG, now, STATE_NULL)).toBe(false);
});
