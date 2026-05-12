// src/time.js
//
// Purpose: centralised "now" source for all time-dependent production code,
// enabling controlled time injection for single-session Follow-Up cadence
// testing without running two separate sessions days apart.
//
// Usage:
//   MOCK_NOW=2026-05-18T22:33:00.000Z node src/index.js
//
// When MOCK_NOW is set and parses as a valid date, all three helpers return
// values derived from that fixed instant. When unset or invalid, they fall
// back to real wall-clock time; production behaviour is unchanged.
//
// Files intentionally NOT migrated:
//   webhook.js  - Date references are SMS idempotency windows and arrival
//                 timestamps; these must always reflect real wall-clock.
//   gmail.js    - OAuth token expiry caching and MIME boundary generation
//                 require real wall-clock and remain unmigrated.
//                 appendToConversationHistory IS migrated (parked 7.8.5).

function resolveBase() {
  const raw = process.env.MOCK_NOW;
  if (raw) {
    const ms = new Date(raw).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

function getNow() {
  const base = resolveBase();
  return base !== null ? base : Date.now();
}

function getNowDate() {
  const base = resolveBase();
  return base !== null ? new Date(base) : new Date();
}

function getNowIso() {
  const base = resolveBase();
  return base !== null ? new Date(base).toISOString() : new Date().toISOString();
}

module.exports = { getNow, getNowDate, getNowIso };
