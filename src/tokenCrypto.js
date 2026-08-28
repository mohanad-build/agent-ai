'use strict';

// Encrypts/decrypts OAuth refresh tokens for at-rest storage in agent JSON
// files. AES-256-GCM, one string field in, one string field out, so the
// existing googleRefreshToken shape never has to change.

const crypto = require('crypto');

const PREFIX = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// Read and validate the key lazily, inside encryptToken/decryptToken at call
// time rather than at module load. A top-level throw here would fire the
// moment anything requires this module (gmail.js is required transitively by
// most of the Jest suite), breaking test collection before a single test
// runs. Same reasoning as twilio.js's lazy client init.
function getKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be set to encrypt or decrypt tokens.');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`TOKEN_ENCRYPTION_KEY must base64-decode to exactly 32 bytes (got ${key.length}).`);
  }
  return key;
}

// Always produces enc:v1: output. Nothing written going forward should stay
// plaintext, so there's no passthrough case here.
function encryptToken(plaintext) {
  if (typeof plaintext !== 'string' || !plaintext) {
    throw new Error('encryptToken requires a non-empty string');
  }
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, authTag, ciphertext]);
  return PREFIX + combined.toString('base64');
}

// Legacy plaintext tokens (real Google refresh tokens, typically starting
// with "1//") are returned unchanged. The key is only touched once the
// enc:v1: prefix is actually present, so this passthrough path works even
// when TOKEN_ENCRYPTION_KEY is unset.
function decryptToken(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) {
    return value;
  }
  const key = getKey();
  const combined = Buffer.from(value.slice(PREFIX.length), 'base64');
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = { encryptToken, decryptToken, ENC_PREFIX: PREFIX };
