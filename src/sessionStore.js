'use strict';

// CASA 2.2.1: the default MemoryStore (node_modules/express-session/session/
// memory.js) emits a hard "not designed for a production environment"
// warning on every boot (index.js:153-154, gated on NODE_ENV === 'production'
// && store instanceof MemoryStore) and loses every session on process
// restart, logging the operator out on every deploy. session-file-store
// persists sessions to disk on the mounted Railway Volume, which survives
// restarts, and supports transparent at-rest encryption (see
// deriveSessionFileKey below) so the SMS MFA code that lands in
// req.session.pendingMfa (src/routes/dashboard.js) is never plaintext on
// disk.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
const FileStoreFactory = require('session-file-store');
const { getStorageRoot } = require('./storagePaths');

const FileStore = FileStoreFactory(session);

// Dedicated subdirectory of STORAGE_ROOT, not the express.static path
// (views/public, see server.js) and not directly in STORAGE_ROOT's root
// where agentDiscovery.js's isAgentConfigFilename scans for <id>.json
// files. Leading underscore matches the existing _operators/_market
// convention (operatorConfig.js, index.js) for "not an agent config"
// subdirectories under STORAGE_ROOT. isAgentConfigFilename's regex is
// anchored on a literal .json suffix, so a directory named "_sessions"
// can never match it regardless of the leading underscore -- see
// tests/agentDiscovery.test.js's phantom-agent guard, which asserts this
// against the real exported name below rather than a hardcoded guess.
const SESSION_STORE_SUBDIR = '_sessions';

function getSessionStoreDir() {
  return path.join(getStorageRoot(), SESSION_STORE_SUBDIR);
}

// Three numbers, one meaning: this, the cookie's `maxAge` in server.js, and
// SESSION_ABSOLUTE_TIMEOUT_MS in src/routes/dashboard.js must all express
// the same 12-hour session lifetime. A future change to one without the
// other two would silently weaken a control that has already been
// assessed. Expressed in seconds here, not ms -- session-file-store's
// `ttl` option is seconds; the other two are ms. In practice this value is
// close to redundant: session-file-store's own isExpired() prefers
// session.cookie.originalMaxAge (copied from the cookie config at session
// creation) over this `ttl` whenever it's present, which it always is
// here. `ttl` is the fallback for the case where it isn't, so it must
// still track the same lifetime rather than drift.
const SESSION_STORE_TTL_SECONDS = 60 * 60 * 12;

// Distinct key for encrypting session files at rest, derived from
// SESSION_SECRET via HKDF rather than reusing SESSION_SECRET directly
// (which signs session cookies) or TOKEN_ENCRYPTION_KEY (which encrypts
// OAuth refresh tokens, see tokenCrypto.js). Reusing either would be the
// same key material serving two purposes, which a reviewer could
// reasonably flag as key reuse. HKDF with a distinct, fixed info string
// gives a cryptographically separate key with no new environment variable
// to set (and so nothing that can be forgotten at deploy time).
//
// The info string is versioned ('-v1') so that if the derivation ever
// changes -- different digest, different output length, a rotation
// scheme -- bumping it to '-v2' is a visible, deliberate break from the
// key every session file was encrypted under, rather than a silent one
// that would leave existing files undecryptable under a new key nobody
// noticed had changed.
//
// kruptein (session-file-store's encryption dependency) requires the
// `secret` it's given to be a string, not a Buffer (see kruptein's own
// _derive_key), hence the hex encoding of the raw HKDF output.
const SESSION_KEY_INFO = 'session-store-encryption-v1';

// server.js throws at boot today if SESSION_SECRET is unset, before
// createSessionStore() is ever reached, which makes this guard redundant
// in the current single-entrypoint arrangement. It stays anyway, for the
// next entrypoint that doesn't go through server.js's boot checks -- a
// script, a worker, a second server -- calling createSessionStore()
// directly. Session 9's webhook dotenv bug was exactly this shape: a
// missing env-var prerequisite surfacing several calls downstream as an
// error that named the wrong thing (there, a signature-verification
// failure; here, crypto.hkdfSync's "ikm must be of type string ...
// Received undefined", which tells a reader nothing about what's actually
// missing). A clear message at the point of failure is the cheap fix.
function deriveSessionFileKey(secret) {
  if (!secret) {
    throw new Error('SESSION_SECRET is required to derive the session store encryption key');
  }
  const keyBytes = crypto.hkdfSync('sha256', secret, '', SESSION_KEY_INFO, 32);
  return Buffer.from(keyBytes).toString('hex');
}

// session-file-store's own writes go through write-file-atomic with no
// mode option threaded through from its public options (see
// session-file-helpers.js's `set`), so individual session files land at
// write-file-atomic's default of 0o666 before umask -- typically 0o644,
// which is world-readable. That default can't be overridden through
// session-file-store's config. What actually enforces non-world-readable
// here is the containing directory: 0o700 (owner rwx only) means no other
// local account can traverse into it at all, which blocks reading any
// file inside regardless of that file's own mode bits -- the standard
// defense for this exact gap. Created (or re-chmod'd, for a directory
// that already existed from a prior deploy under looser permissions)
// before the store touches it, so the store's own internal
// fs.mkdirsSync(path) call -- which does not set a restrictive mode --
// finds it already locked down and is a no-op.
function ensureSessionDirLockedDown(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}

// session-file-store's get() (session-file-helpers.js) retries ANY read
// failure up to `retries` times (default 5, unconditional on error code --
// confirmed by reading it, not assumed) before giving up, logging a
// "will retry" line through this hook on every attempt. A missing session
// file is the expected outcome of an expired cookie, an already-swept
// session, or a forged session id -- not a failure -- and it is common:
// every request carrying such a cookie hits this path once per read.
// Retries cannot be scoped to exclude ENOENT specifically -- get()'s retry
// loop has no error-code branch to hook into -- so lowering `retries`
// to cut this noise would equally cut resilience against a genuine
// transient I/O error (e.g. a momentary EBUSY on a network volume), which
// is not a trade worth making. `retries` is left at the library default;
// this logFn is the actual fix.
//
// Silencing ENOENT here is deliberate and narrow: every other error - a
// real permissions problem, a corrupt file, a full disk - still surfaces,
// through the same [tag] message: err form the rest of this codebase
// already uses (see sweepExpiredSessions's own error log below). The
// benign reap-status lines session-file-store also sends through this
// hook ("Deleting expired sessions", once an hour from its own internal
// reaper) are left on console.log, unchanged - they were never errors.
function sessionStoreLogFn(message) {
  if (message.indexOf('will retry, error on last attempt') !== -1) {
    if (message.indexOf('ENOENT') !== -1) return;
    console.error(`[sessionStore] ${message}`);
    return;
  }
  console.log(message);
}

function createSessionStore() {
  const dir = getSessionStoreDir();
  ensureSessionDirLockedDown(dir);

  return new FileStore({
    path: dir,
    ttl: SESSION_STORE_TTL_SECONDS,
    secret: deriveSessionFileKey(process.env.SESSION_SECRET),
    logFn: sessionStoreLogFn,
    // Not set to -1. session-file-store's own internal reaper (default:
    // every options.ttl-independent reapInterval, 3600s) stays enabled as
    // an independent backstop -- see startSessionSweep's comment for why
    // both run.
  });
}

// session-file-store implements no `.all()` -- unlike MemoryStore, calling
// it would throw. Its public surface for a sweep is `list` (session
// filenames), `expired` (per-id expiry check) and `destroy` (per-id
// delete); its own reap() that combines those three is internal, not
// exposed on the prototype. This reimplements that combination through
// the public API so our sweep, not the library's private one, is what's
// under test and on record for CASA 2.2.1.
//
// destroy() on an id that's already gone must not be treated as failure:
// the library's own internal reaper (see createSessionStore's comment)
// runs on its own timer and can delete the same expired file first. That
// race is expected, not an error -- fs-extra's remove() (which destroy()
// calls) already swallows ENOENT internally, and
// tests/sessionStore.sweep.test.js exercises this directly rather than
// assuming it.
function sweepExpiredSessions(store) {
  return new Promise((resolve, reject) => {
    store.list((err, files) => {
      if (err) return reject(err);
      if (files.length === 0) return resolve();

      let remaining = files.length;
      let settled = false;
      const done = (err2) => {
        if (settled) return;
        if (err2) {
          settled = true;
          return reject(err2);
        }
        if (--remaining === 0) {
          settled = true;
          resolve();
        }
      };

      files.forEach((file) => {
        const sessionId = file.replace(/\.json$/, '');
        store.expired(sessionId, (expErr, isExpired) => {
          // expired() (session-file-helpers.js) reads the file internally
          // to check it, so it can itself ENOENT if the library's own
          // reaper (or a concurrent req.session.destroy(), e.g. a real
          // logout) deletes this exact file in the gap between list()
          // above and this call. That race means the file is already
          // gone -- the outcome this sweep pass wanted anyway -- not a
          // failure; treating it as one would abort reporting on the
          // entire sweep batch over a single already-won race. Any other
          // error still fails this file's iteration for real.
          if (expErr && expErr.code === 'ENOENT') return done();
          if (expErr) return done(expErr);
          if (!isExpired) return done();
          store.destroy(sessionId, done);
        });
      });
    });
  });
}

// Hourly: comfortably inside the 12 hour cookie maxAge (see
// SESSION_STORE_TTL_SECONDS above), so an expired session's disk space is
// reclaimed well before it would matter, but not so frequent that this
// does real work every few seconds for nothing.
const SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

function startSessionSweep(store, intervalMs = SESSION_SWEEP_INTERVAL_MS) {
  const timer = setInterval(() => {
    sweepExpiredSessions(store).catch((err) => {
      console.error('[sessionStore] sweep failed:', err.message);
    });
  }, intervalMs);
  // Must never hold the process open. An un-unref'd interval here is
  // exactly the kind of thing that hangs Jest on exit.
  timer.unref();
  return timer;
}

module.exports = {
  createSessionStore,
  sweepExpiredSessions,
  startSessionSweep,
  SESSION_SWEEP_INTERVAL_MS,
  SESSION_STORE_SUBDIR,
  SESSION_STORE_TTL_SECONDS,
  SESSION_KEY_INFO,
  deriveSessionFileKey,
  getSessionStoreDir,
};
