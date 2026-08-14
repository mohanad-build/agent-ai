// src/googleRetry.js
//
// Generic retry helper for Google API calls that gaxios's OWN built-in
// retry does not cover.
//
// googleapis-common sets `options.retry = true` unconditionally for every
// call made through the googleapis client library
// (node_modules/googleapis-common/build/src/apirequest.js:262), and nothing
// in src/ overrides it. That means calls made via google.gmail()/
// google.sheets()/google.drive() already retry through gaxios: up to 3
// attempts, exponential backoff, no jitter -- but ONLY for the HTTP methods
// gaxios lists as safe to retry: GET, HEAD, PUT, OPTIONS, DELETE
// (node_modules/gaxios/build/src/retry.js:25-31), on status 429/5xx or a
// no-response network error (node_modules/gaxios/build/src/retry.js:50-64).
// POST is absent from that list, so POST calls -- Drive folder creation and
// file upload (drive.files.create) among them -- get NO retry from gaxios.
// This module exists to cover exactly that gap.
//
// Do NOT wrap a GET/HEAD/PUT/OPTIONS/DELETE call in this helper: gaxios
// already retries it, and stacking this on top would compound attempts
// (up to 3 x 3 = 9).

// KNOWN-UGLY DEPENDENCY: this module reaches into gmail.js for an auth
// concern (isAuthFailure / handleAuthFailure) that really belongs to a
// shared token module that doesn't exist yet. That's a deliberate
// deferral, not an oversight -- the alternative is touching gmail.js's
// call sites, which run every intake cycle, and that's out of scope here.
// handleAuthFailure is a state transition on the agent (flips isActive to
// false on disk, evicts the OAuth client cache) and must have exactly one
// implementation; this module only decides whether to try again.
const { isAuthFailure, handleAuthFailure } = require('./gmail');

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;

function isNetworkFailure(err) {
  return !err?.response;
}

function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

function shouldRetry(err) {
  if (isNetworkFailure(err)) return true;
  return isRetryableStatus(err.response.status);
}

// Retry-After is either delay-seconds or an HTTP-date (RFC 7231 7.1.3).
// Returns ms to wait, or null if absent/unparseable.
function getRetryAfterMs(err) {
  const headerVal = err?.response?.headers?.['retry-after'];
  if (headerVal === undefined || headerVal === null) return null;
  const seconds = Number(headerVal);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(headerVal);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

// Full jitter: random value in [0, cap], cap doubling per attempt. Jitter
// matters here specifically because a single intake cycle can fire several
// of these (e.g. multiple attachment uploads) at once -- identical backoff
// would make them all retry in the same instant and collide with the rate
// limit again together.
function computeBackoffMs(attempt) {
  const cap = BASE_DELAY_MS * Math.pow(2, attempt - 1);
  return Math.random() * cap;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withGoogleRetry(agentConfig, fn) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isAuthFailure(err)) {
        handleAuthFailure(agentConfig, err);
        throw err;
      }
      if (attempt === MAX_ATTEMPTS || !shouldRetry(err)) {
        throw err;
      }
      const delayMs = getRetryAfterMs(err) ?? computeBackoffMs(attempt);
      await sleep(delayMs);
    }
  }
}

module.exports = {
  withGoogleRetry,
  _internal: {
    isNetworkFailure,
    isRetryableStatus,
    shouldRetry,
    getRetryAfterMs,
    computeBackoffMs,
  },
};
