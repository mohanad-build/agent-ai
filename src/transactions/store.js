'use strict';

const fs     = require('node:fs');
const path   = require('node:path');
const crypto = require('node:crypto');

const { getStorageRoot } = require('../storagePaths');
const states = require('./states');

// -- Error classes -----------------------------------------------------------

class TransactionCorruptionError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'TransactionCorruptionError';
    if (cause !== undefined) this.cause = cause;
  }
}

class TransactionSchemaValidationError extends Error {
  constructor(message, errors) {
    super(message);
    this.name = 'TransactionSchemaValidationError';
    this.errors = errors;
  }
}

// -- Constants ----------------------------------------------------------------

const TRANSACTION_ID_RE = /^txn-\d{8}-[0-9a-f]{8}$/;
const TRANSACTION_FILE_RE = /^txn-\d{8}-[0-9a-f]{8}\.json$/;
const VALID_TYPES = new Set([
  'buyer_purchase',
  'seller_sale',
  'tenant_lease',
  'landlord_lease',
  'seller_listing',
  'landlord_listing',
]);

// The deal types that can sit under a listing. buyer_purchase and
// tenant_lease open at the deal with no listing behind them; the listing
// types themselves don't point at a listing.
const LISTING_ELIGIBLE_TYPES = new Set(['seller_sale', 'landlord_lease']);

// -- Path helpers ---------------------------------------------------------------

// The `${agentId}.` prefix on the directory name is load-bearing. Both
// discoverAgentIds implementations (src/index.js, src/routes/dashboard.js)
// filter entries against /^[a-z0-9-]+\.json$/, which a directory named
// `<agentId>.transactions` never matches, so it stays invisible to agent
// discovery. moveAgentFilesToDeleted (src/routes/dashboard.js) sweeps
// entries by startsWith(`${agentId}.`), which this prefix does match, so
// the whole transactions directory still gets soft-deleted with the rest
// of the agent's files. Do not change the prefix without checking both.
function transactionsDir(baseDir, agentId) {
  return path.join(baseDir, `${agentId}.transactions`);
}

function transactionPath(baseDir, agentId, transactionId) {
  return path.join(transactionsDir(baseDir, agentId), `${transactionId}.json`);
}

// -- ID generation --------------------------------------------------------------

function generateTransactionId(now) {
  const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  const suffix = crypto.randomBytes(4).toString('hex');
  return `txn-${date}-${suffix}`;
}

// -- Validation -------------------------------------------------------------------

// Tighter than content/state.js's isIsoString: that one only checks
// typeof + Date-parse validity, which also accepts bare dates like
// '2026-07-15' or bare years like '2026'. Transaction timestamps need
// full date and time with a timezone designator, so this adds a regex
// gate in front of the same Date-parse validity check.
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isIsoString(value) {
  return typeof value === 'string' && ISO_DATETIME_RE.test(value) && !Number.isNaN(new Date(value).getTime());
}

// The store validates only what the envelope can answer about itself:
// format and type-permission both qualify, since checking either only
// requires reading the object in hand. Existence and target-type do not
// qualify, because answering them needs a filesystem read (does
// listingId point at a real transaction? is that transaction a listing
// type?), and that's the resolver's job, or the caller's, not a
// validator's. listingId is validated when present under that rule
// (format, plus which types may carry it). Every other key on the
// transaction object still passes through untouched and is never
// inspected here: the store owns bytes, the resolver owns meaning. This
// is what lets the store ship before the item catalog is locked.
function validateEnvelope(transaction) {
  const errors = [];

  if (transaction.schemaVersion !== 1) {
    errors.push('schemaVersion: must be 1');
  }

  if (typeof transaction.transactionId !== 'string' || !TRANSACTION_ID_RE.test(transaction.transactionId)) {
    errors.push('transactionId: must match txn-YYYYMMDD-xxxxxxxx format');
  }

  if (typeof transaction.agentId !== 'string' || transaction.agentId.trim() === '') {
    errors.push('agentId: required non-empty string');
  }

  const typeIsValid = VALID_TYPES.has(transaction.type);
  if (!typeIsValid) {
    errors.push(`type: must be one of ${[...VALID_TYPES].join(', ')}`);
  }

  if (typeof transaction.state !== 'string' || transaction.state.trim() === '') {
    errors.push('state: required non-empty string');
  } else if (typeIsValid && !states.isValidState(transaction.type, transaction.state)) {
    errors.push(`state: '${transaction.state}' is not a state of type '${transaction.type}'`);
  }

  if (!isIsoString(transaction.createdAt)) {
    errors.push('createdAt: required ISO 8601 string');
  }

  if (!isIsoString(transaction.updatedAt)) {
    errors.push('updatedAt: required ISO 8601 string');
  }

  // Absent is valid on every type: no linked listing is a real, permitted
  // answer, not an error. Only check shape and type-permission when the
  // key is actually present; null and '' are deliberately not treated as
  // equivalent to absent.
  if (Object.prototype.hasOwnProperty.call(transaction, 'listingId')) {
    if (!LISTING_ELIGIBLE_TYPES.has(transaction.type)) {
      errors.push(`listingId: not permitted on type '${transaction.type}'`);
    } else if (transaction.listingId === null || transaction.listingId === '') {
      errors.push('listingId: must be absent, not null or empty string, when there is no linked listing');
    } else if (typeof transaction.listingId !== 'string' || !TRANSACTION_ID_RE.test(transaction.listingId)) {
      errors.push('listingId: must match txn-YYYYMMDD-xxxxxxxx format');
    }
  }

  if (typeof transaction.address !== 'string' || transaction.address.trim() === '') {
    errors.push('address: required non-empty string');
  }

  // Absent is valid: not every property has a unit. Only check when the key
  // is actually present; null and '' are deliberately not treated as
  // equivalent to absent. No format check on the value itself: units like
  // 'Main', 'Basement', 'PH2' and '402' are all real, so nothing beyond
  // string-or-not is enforced here.
  if (Object.prototype.hasOwnProperty.call(transaction, 'unit')) {
    if (transaction.unit === null || transaction.unit === '') {
      errors.push('unit: must be absent, not null or empty string, when there is no unit');
    } else if (typeof transaction.unit !== 'string') {
      errors.push('unit: must be a string');
    }
  }

  if (errors.length > 0) {
    throw new TransactionSchemaValidationError(
      `Transaction validation failed: ${errors.join('; ')}`,
      errors
    );
  }
}

// -- Atomic write -----------------------------------------------------------------

function writeTransactionFile(filePath, transaction) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(transaction, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

// -- Public API -----------------------------------------------------------------

function createTransaction(agentId, fields, opts = {}) {
  if (fields && Object.prototype.hasOwnProperty.call(fields, 'transactionId')) {
    throw new Error('createTransaction: fields must not carry transactionId');
  }
  if (fields && Object.prototype.hasOwnProperty.call(fields, 'createdAt')) {
    throw new Error('createTransaction: fields must not carry createdAt');
  }
  if (fields && Object.prototype.hasOwnProperty.call(fields, 'schemaVersion')) {
    throw new Error('createTransaction: fields must not carry schemaVersion');
  }

  const baseDir = opts.baseDir || getStorageRoot();
  const now = (opts.now || new Date());
  const nowIso = now.toISOString();
  const transactionId = generateTransactionId(now);

  const transaction = {
    ...fields,
    schemaVersion: 1,
    transactionId,
    agentId,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  validateEnvelope(transaction);
  const filePath = transactionPath(baseDir, agentId, transactionId);
  writeTransactionFile(filePath, transaction);
  return transaction;
}

function readTransaction(agentId, transactionId, opts = {}) {
  const baseDir = opts.baseDir || getStorageRoot();
  const filePath = transactionPath(baseDir, agentId, transactionId);
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new TransactionCorruptionError(
      `Transaction '${transactionId}' for agent '${agentId}' contains invalid JSON: ${err.message}`,
      err
    );
  }
  validateEnvelope(parsed);
  return parsed;
}

function writeTransaction(agentId, transaction, opts = {}) {
  if (transaction.agentId !== agentId) {
    throw new Error(`writeTransaction: agentId mismatch, called with '${agentId}' but transaction.agentId is '${transaction.agentId}'`);
  }
  const baseDir = opts.baseDir || getStorageRoot();
  const filePath = transactionPath(baseDir, agentId, transaction.transactionId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`writeTransaction: no existing transaction at ${filePath}`);
  }
  const now = (opts.now || new Date());
  const stamped = { ...transaction, updatedAt: now.toISOString() };
  validateEnvelope(stamped);
  writeTransactionFile(filePath, stamped);
  return stamped;
}

function listTransactionIds(agentId, opts = {}) {
  const baseDir = opts.baseDir || getStorageRoot();
  const dir = transactionsDir(baseDir, agentId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => {
      const full = path.join(dir, f);
      return TRANSACTION_FILE_RE.test(f) && fs.statSync(full).isFile();
    })
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

// -- Exports ------------------------------------------------------------------

module.exports = {
  TransactionCorruptionError,
  TransactionSchemaValidationError,
  createTransaction,
  readTransaction,
  writeTransaction,
  listTransactionIds,
};

module.exports._internal = {
  TRANSACTION_ID_RE,
  transactionsDir,
  transactionPath,
  generateTransactionId,
  validateEnvelope,
};
