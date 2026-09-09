'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createSessionStore, deriveSessionFileKey } = require('../src/sessionStore');

const SESSION_SECRET = 'test-session-secret-not-real-but-long-enough';

let tmpDir;
let savedStorageRoot;
let savedSessionSecret;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionStore-persistence-test-'));
  savedStorageRoot = process.env.STORAGE_ROOT;
  savedSessionSecret = process.env.SESSION_SECRET;
  process.env.STORAGE_ROOT = tmpDir;
  process.env.SESSION_SECRET = SESSION_SECRET;
});

afterEach(() => {
  if (savedStorageRoot === undefined) {
    delete process.env.STORAGE_ROOT;
  } else {
    process.env.STORAGE_ROOT = savedStorageRoot;
  }
  if (savedSessionSecret === undefined) {
    delete process.env.SESSION_SECRET;
  } else {
    process.env.SESSION_SECRET = savedSessionSecret;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function setSession(store, sid, sess) {
  return new Promise((resolve, reject) => {
    store.set(sid, sess, (err) => (err ? reject(err) : resolve()));
  });
}

function getSession(store, sid) {
  return new Promise((resolve, reject) => {
    store.get(sid, (err, sess) => (err ? reject(err) : resolve(sess)));
  });
}

// CASA 2.2.1: the reason for this swap is that MemoryStore loses every
// session on process restart, logging the operator out on every deploy.
// This is the test that actually proves the fix: construct a SECOND,
// independent store instance over the same STORAGE_ROOT/_sessions
// directory -- standing in for the new process a deploy spins up -- and
// confirm a session written before "restart" is still readable and still
// valid after it. SESSION_SECRET is left unchanged across the two
// instances, as it is in production (a fixed env var), so the HKDF-derived
// encryption key is identical on both sides and the round trip only
// proves persistence, not a same-process artifact.
describe('session persistence across a simulated restart (CASA 2.2.1)', () => {
  it('a session written before restart is still valid after', async () => {
    const beforeRestart = createSessionStore();
    await setSession(beforeRestart, 'restart-sid', {
      cookie: { originalMaxAge: 1000 * 60 * 60 * 12 },
      authenticated: true,
      principal: { type: 'operator', allowedAgents: '*' },
    });

    const afterRestart = createSessionStore(); // new instance, same directory: the "restart"
    const sess = await getSession(afterRestart, 'restart-sid');

    expect(sess).toBeTruthy();
    expect(sess.authenticated).toBe(true);
    expect(sess.principal).toEqual({ type: 'operator', allowedAgents: '*' });
  });
});

// Unset within this one test only (not a global default in test setup,
// which would make this exact failure path untestable everywhere at
// once - same reasoning as the per-file STORAGE_ROOT/SESSION_SECRET
// save/restore above). Proves the guard fires with a real, readable
// message instead of crypto.hkdfSync's internals-level TypeError -
// server.js already refuses to boot without SESSION_SECRET, but this
// guard is for the next entrypoint that calls createSessionStore()
// without going through server.js's own check (session 9's webhook
// dotenv bug was this exact shape: a missing env var surfacing several
// calls downstream as an error naming the wrong thing).
describe('deriveSessionFileKey guard', () => {
  it('throws a clear error when SESSION_SECRET is missing, not a crypto internals error', () => {
    delete process.env.SESSION_SECRET;
    expect(() => deriveSessionFileKey(undefined)).toThrow(
      'SESSION_SECRET is required to derive the session store encryption key'
    );
  });
});
