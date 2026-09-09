'use strict';

// A SILENT FAILURE MODE, not a defensive nicety. session-file-store@1.5.0
// (used by src/sessionStore.js) declares kruptein: ^2.0.4, and its own
// encrypt() helper (node_modules/session-file-store/lib/session-file-
// helpers.js) assumes kruptein's set() callback fires SYNCHRONOUSLY -- it
// captures the callback's result into a local variable and returns that
// variable immediately, before yielding back to its own caller:
//
//   encrypt: function (options, data, sessionId) {
//     var ciphertext = null;
//     options.kruptein.set(options.secret, data, function(err, ct) {
//       ciphertext = ct;
//     });
//     return ciphertext;   // read before the callback may have run
//   }
//
// kruptein 2.x's key derivation (_derive_key) is genuinely synchronous --
// crypto.pbkdf2Sync / crypto.scryptSync, called and returned within the
// same tick -- so the callback-style API still resolves before encrypt()
// reads `ciphertext`. kruptein 3.x is a full rewrite: its key derivation
// (Kruptein#deriveKey) uses crypto.scrypt, the ASYNC callback-based
// variant dispatched onto libuv's threadpool, so the callback fires on a
// later tick. Under 3.x, encrypt() would return its captured variable
// while it's still null, and session-file-store would write that null
// straight to disk via write-file-atomic.
//
// The symptom is not an error. Nothing throws, nothing logs. Session files
// on disk would silently contain the literal string "null" (or an empty/
// truncated write, depending on exact timing) instead of ciphertext --
// CASA 2.2.1's encryption-at-rest control would appear configured (the
// `secret` option is set, the code path runs without complaint) while
// actually producing no encryption, and no working session persistence,
// at all.
//
// npm's own resolution is what is supposed to prevent this today (see
// package-lock.json: session-file-store's ^2.0.4 range). This test is the
// instrument that catches a FUTURE change to that range, a lockfile
// regeneration that drifts it, or a resolution override added elsewhere
// in the tree -- a comment cannot do that job, only an assertion that
// actually runs can. DO NOT DELETE THIS TEST AS A TAUTOLOGY. It will look
// like it's pinning something static and therefore pointless; it is the
// only thing standing between a dependency bump and silently unencrypted
// (or simply empty) session files, and it is only ever meant to fail once
// that has actually happened.
describe('kruptein major version pin (CASA 2.2.1 encryption prerequisite)', () => {
  it('the installed kruptein is major version 2, not 3', () => {
    const installedVersion = require('kruptein/package.json').version;
    const major = parseInt(installedVersion.split('.')[0], 10);

    expect(major).toBe(2);
  });
});
