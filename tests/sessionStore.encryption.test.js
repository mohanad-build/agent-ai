'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const session = require('express-session');
const FileStoreFactory = require('session-file-store');

const { deriveSessionFileKey } = require('../src/sessionStore');

const FileStore = FileStoreFactory(session);
const TEST_SECRET = 'test-session-secret-not-real-but-long-enough';
const SENTINEL = 'sentinel-plaintext-marker-4f8a2c';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionStore-encryption-test-'));
});

afterEach(() => {
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

function rawFileBytes(sid) {
  return fs.readFileSync(path.join(tmpDir, `${sid}.json`), 'utf8');
}

// CASA 2.2.1 + secure storage of server-side secrets: req.session.pendingMfa
// (src/routes/dashboard.js) carries the live 6-digit SMS MFA code for up to
// 5 minutes. Under MemoryStore that value never left process memory; a
// plaintext file store would put a live authentication factor on disk for
// that whole window. This is the assertion that actually matters for that
// control -- not "is the `secret` option set" (a config check that says
// nothing about whether encryption worked), but "does the known plaintext
// value physically appear in the bytes written to disk."
describe('session file encryption at rest (CASA 2.2.1)', () => {
  it('does not write the plaintext sentinel to disk', async () => {
    const store = new FileStore({
      path: tmpDir,
      secret: deriveSessionFileKey(TEST_SECRET),
    });

    await setSession(store, 'sentinel-sid', {
      cookie: { originalMaxAge: 1000 * 60 * 60 * 12 },
      pendingMfa: { code: SENTINEL, expiresAt: Date.now() + 300000, attempts: 0 },
    });

    const raw = rawFileBytes('sentinel-sid');
    expect(raw).not.toContain(SENTINEL);
  });

  it('round-trips: the same key can still read back what it encrypted', async () => {
    const store = new FileStore({
      path: tmpDir,
      secret: deriveSessionFileKey(TEST_SECRET),
    });

    await setSession(store, 'sentinel-sid', {
      cookie: { originalMaxAge: 1000 * 60 * 60 * 12 },
      pendingMfa: { code: SENTINEL, expiresAt: Date.now() + 300000, attempts: 0 },
    });

    const sess = await getSession(store, 'sentinel-sid');
    expect(sess.pendingMfa.code).toBe(SENTINEL);
  });
});
