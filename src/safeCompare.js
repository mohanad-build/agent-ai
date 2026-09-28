'use strict';

// Constant-time string comparison, shared by the dashboard login and the onboarding passcode gate (7.25.1).

const crypto = require('crypto');

// crypto.timingSafeEqual throws if the two buffers differ in length, and a
// naive catch-and-return-false around that would itself leak length
// information through which branch executes - so both sides are hashed to a
// fixed 32-byte digest first, and it's the digests (always equal length)
// that get compared.
function safeCompare(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

module.exports = { safeCompare };
