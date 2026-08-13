'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const {
  TransactionCorruptionError,
  TransactionSchemaValidationError,
  createTransaction,
  readTransaction,
  writeTransaction,
  listTransactionIds,
} = require('../src/transactions/store');

const { TRANSACTION_ID_RE, transactionsDir, transactionPath, validateEnvelope } =
  require('../src/transactions/store')._internal;

// -- Helpers ------------------------------------------------------------------

const AGENT_ID = 'test-agent';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transactionStore-test-'));
}

function caught(fn) {
  try { fn(); } catch (e) { return e; }
}

function makeEnvelope(overrides = {}) {
  return {
    schemaVersion: 1,
    transactionId: 'txn-20260715-abcd1234',
    agentId: AGENT_ID,
    type: 'buyer_purchase',
    state: 'offer_drafted',
    createdAt: '2026-07-15T10:00:00.000Z',
    updatedAt: '2026-07-15T10:00:00.000Z',
    ...overrides,
  };
}

let baseDir;

beforeEach(() => { baseDir = makeTmpDir(); });
afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

// -- createTransaction / readTransaction round trip ----------------------------

describe('createTransaction / readTransaction', () => {
  test('round trip: create then read returns an equal object', () => {
    const now = new Date('2026-07-15T10:00:00.000Z');
    const created = createTransaction(AGENT_ID, { type: 'buyer_purchase', state: 'offer_drafted' }, { baseDir, now });
    const read = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(read).toEqual(created);
  });

  test('unknown keys on the body survive the round trip untouched', () => {
    const now = new Date('2026-07-15T10:00:00.000Z');
    const created = createTransaction(
      AGENT_ID,
      { type: 'buyer_purchase', state: 'offer_drafted', price: 450000, address: { street: '12 Main St' } },
      { baseDir, now }
    );
    const read = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(read.price).toBe(450000);
    expect(read.address).toEqual({ street: '12 Main St' });
  });

  test('createTransaction throws if fields carries transactionId', () => {
    expect(() => createTransaction(AGENT_ID, { transactionId: 'txn-20260715-deadbeef', type: 'buyer_purchase', state: 's' }, { baseDir }))
      .toThrow('transactionId');
  });

  test('createTransaction throws if fields carries createdAt', () => {
    expect(() => createTransaction(AGENT_ID, { createdAt: '2026-07-15T10:00:00.000Z', type: 'buyer_purchase', state: 's' }, { baseDir }))
      .toThrow('createdAt');
  });

  test('createTransaction throws if fields carries schemaVersion', () => {
    expect(() => createTransaction(AGENT_ID, { schemaVersion: 1, type: 'buyer_purchase', state: 's' }, { baseDir }))
      .toThrow('schemaVersion');
  });

  test('two createTransaction calls with the same injected clock produce different ids', () => {
    const now = new Date('2026-07-15T10:00:00.000Z');
    const a = createTransaction(AGENT_ID, { type: 'buyer_purchase', state: 's' }, { baseDir, now });
    const b = createTransaction(AGENT_ID, { type: 'buyer_purchase', state: 's' }, { baseDir, now });
    expect(a.transactionId).not.toBe(b.transactionId);
  });
});

describe('readTransaction', () => {
  test('returns null when the transaction does not exist, with no side effects', () => {
    const result = readTransaction(AGENT_ID, 'txn-20260715-00000000', { baseDir });
    expect(result).toBeNull();
    expect(fs.existsSync(transactionsDir(baseDir, AGENT_ID))).toBe(false);
  });

  test('throws TransactionCorruptionError on malformed JSON', () => {
    const dir = transactionsDir(baseDir, AGENT_ID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'txn-20260715-abcd1234.json'), 'not-json{{{', 'utf8');
    const err = caught(() => readTransaction(AGENT_ID, 'txn-20260715-abcd1234', { baseDir }));
    expect(err).toBeInstanceOf(TransactionCorruptionError);
  });

  test('throws rather than reading a schemaVersion 2 envelope', () => {
    const dir = transactionsDir(baseDir, AGENT_ID);
    fs.mkdirSync(dir, { recursive: true });
    const envelope = makeEnvelope({ schemaVersion: 2 });
    fs.writeFileSync(path.join(dir, 'txn-20260715-abcd1234.json'), JSON.stringify(envelope), 'utf8');
    const err = caught(() => readTransaction(AGENT_ID, 'txn-20260715-abcd1234', { baseDir }));
    expect(err).toBeInstanceOf(TransactionSchemaValidationError);
  });
});

describe('writeTransaction', () => {
  test('throws if the file does not already exist', () => {
    const envelope = makeEnvelope();
    expect(() => writeTransaction(AGENT_ID, envelope, { baseDir })).toThrow();
    expect(fs.existsSync(transactionPath(baseDir, AGENT_ID, envelope.transactionId))).toBe(false);
  });

  test('stamps updatedAt from opts.now and persists', () => {
    const created = createTransaction(AGENT_ID, { type: 'buyer_purchase', state: 'offer_drafted' }, { baseDir, now: new Date('2026-07-15T10:00:00.000Z') });
    const later = new Date('2026-07-16T09:30:00.000Z');
    const updated = writeTransaction(AGENT_ID, { ...created, state: 'under_contract' }, { baseDir, now: later });
    expect(updated.updatedAt).toBe(later.toISOString());
    expect(updated.createdAt).toBe(created.createdAt);
    const read = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(read.state).toBe('under_contract');
  });

  test('throws on agentId mismatch and leaves the on-disk file unchanged', () => {
    const created = createTransaction(AGENT_ID, { type: 'buyer_purchase', state: 'offer_drafted' }, { baseDir, now: new Date('2026-07-15T10:00:00.000Z') });
    const mutated = { ...created, agentId: 'a-different-agent', state: 'under_contract' };
    expect(() => writeTransaction(AGENT_ID, mutated, { baseDir })).toThrow(/a-different-agent/);
    expect(() => writeTransaction(AGENT_ID, mutated, { baseDir })).toThrow(new RegExp(AGENT_ID));
    const read = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(read).toEqual(created);
  });
});

// -- Envelope validation --------------------------------------------------------

describe('validateEnvelope', () => {
  test('valid envelope does not throw', () => {
    expect(() => validateEnvelope(makeEnvelope())).not.toThrow();
  });

  test('schemaVersion failing validation throws TransactionSchemaValidationError', () => {
    const err = caught(() => validateEnvelope(makeEnvelope({ schemaVersion: 2 })));
    expect(err).toBeInstanceOf(TransactionSchemaValidationError);
  });

  test('transactionId failing validation throws TransactionSchemaValidationError', () => {
    const err = caught(() => validateEnvelope(makeEnvelope({ transactionId: 'txn-not-the-right-shape' })));
    expect(err).toBeInstanceOf(TransactionSchemaValidationError);
  });

  test('agentId failing validation throws TransactionSchemaValidationError', () => {
    const err = caught(() => validateEnvelope(makeEnvelope({ agentId: '' })));
    expect(err).toBeInstanceOf(TransactionSchemaValidationError);
  });

  test('type failing validation throws TransactionSchemaValidationError', () => {
    const err = caught(() => validateEnvelope(makeEnvelope({ type: 'not_a_real_type' })));
    expect(err).toBeInstanceOf(TransactionSchemaValidationError);
  });

  test('state failing validation throws TransactionSchemaValidationError', () => {
    const err = caught(() => validateEnvelope(makeEnvelope({ state: '' })));
    expect(err).toBeInstanceOf(TransactionSchemaValidationError);
  });

  test('createdAt failing validation throws TransactionSchemaValidationError', () => {
    const err = caught(() => validateEnvelope(makeEnvelope({ createdAt: 'not-a-date' })));
    expect(err).toBeInstanceOf(TransactionSchemaValidationError);
  });

  test('updatedAt failing validation throws TransactionSchemaValidationError', () => {
    const err = caught(() => validateEnvelope(makeEnvelope({ updatedAt: 'not-a-date' })));
    expect(err).toBeInstanceOf(TransactionSchemaValidationError);
  });

  test('state accepts any non-empty string, since the state machine is not locked yet', () => {
    expect(() => validateEnvelope(makeEnvelope({ state: 'some_future_state_not_yet_spec_d' }))).not.toThrow();
  });
});

// -- listingId ------------------------------------------------------------------

describe('validateEnvelope: listingId', () => {
  test('absent is valid on all six types', () => {
    const types = ['buyer_purchase', 'seller_sale', 'tenant_lease', 'landlord_lease', 'seller_listing', 'landlord_listing'];
    for (const type of types) {
      expect(() => validateEnvelope(makeEnvelope({ type }))).not.toThrow();
    }
  });

  test('well-formed listingId is accepted on seller_sale', () => {
    expect(() => validateEnvelope(makeEnvelope({ type: 'seller_sale', listingId: 'txn-20260715-abcd1234' }))).not.toThrow();
  });

  test('well-formed listingId is accepted on landlord_lease', () => {
    expect(() => validateEnvelope(makeEnvelope({ type: 'landlord_lease', listingId: 'txn-20260715-abcd1234' }))).not.toThrow();
  });

  test('present listingId is rejected on buyer_purchase, naming the type', () => {
    const err = caught(() => validateEnvelope(makeEnvelope({ type: 'buyer_purchase', listingId: 'txn-20260715-abcd1234' })));
    expect(err).toBeInstanceOf(TransactionSchemaValidationError);
    expect(err.message).toMatch(/listingId.*buyer_purchase/);
  });

  test('present listingId is rejected on tenant_lease, naming the type', () => {
    const err = caught(() => validateEnvelope(makeEnvelope({ type: 'tenant_lease', listingId: 'txn-20260715-abcd1234' })));
    expect(err).toBeInstanceOf(TransactionSchemaValidationError);
    expect(err.message).toMatch(/listingId.*tenant_lease/);
  });

  test('present listingId is rejected on seller_listing, naming the type', () => {
    const err = caught(() => validateEnvelope(makeEnvelope({ type: 'seller_listing', listingId: 'txn-20260715-abcd1234' })));
    expect(err).toBeInstanceOf(TransactionSchemaValidationError);
    expect(err.message).toMatch(/listingId.*seller_listing/);
  });

  test('present listingId is rejected on landlord_listing, naming the type', () => {
    const err = caught(() => validateEnvelope(makeEnvelope({ type: 'landlord_listing', listingId: 'txn-20260715-abcd1234' })));
    expect(err).toBeInstanceOf(TransactionSchemaValidationError);
    expect(err.message).toMatch(/listingId.*landlord_listing/);
  });

  test('null listingId is rejected on seller_sale, distinctly from absent', () => {
    const err = caught(() => validateEnvelope(makeEnvelope({ type: 'seller_sale', listingId: null })));
    expect(err).toBeInstanceOf(TransactionSchemaValidationError);
    expect(err.message).toMatch(/listingId/);
  });

  test('empty string listingId is rejected on seller_sale, distinctly from absent', () => {
    const err = caught(() => validateEnvelope(makeEnvelope({ type: 'seller_sale', listingId: '' })));
    expect(err).toBeInstanceOf(TransactionSchemaValidationError);
    expect(err.message).toMatch(/listingId/);
  });

  test('listingId with wrong prefix is rejected on seller_sale', () => {
    const err = caught(() => validateEnvelope(makeEnvelope({ type: 'seller_sale', listingId: 'lst-20260715-abcd1234' })));
    expect(err).toBeInstanceOf(TransactionSchemaValidationError);
  });

  test('listingId with wrong date shape is rejected on seller_sale', () => {
    const err = caught(() => validateEnvelope(makeEnvelope({ type: 'seller_sale', listingId: 'txn-2026-07-15-abcd1234' })));
    expect(err).toBeInstanceOf(TransactionSchemaValidationError);
  });

  test('listingId with wrong suffix length is rejected on seller_sale', () => {
    const err = caught(() => validateEnvelope(makeEnvelope({ type: 'seller_sale', listingId: 'txn-20260715-abcd12' })));
    expect(err).toBeInstanceOf(TransactionSchemaValidationError);
  });
});

// -- isIsoString (exercised through validateEnvelope's createdAt field) ---------

describe('isIsoString', () => {
  test('rejects a bare year', () => {
    const err = caught(() => validateEnvelope(makeEnvelope({ createdAt: '2026' })));
    expect(err).toBeInstanceOf(TransactionSchemaValidationError);
  });

  test('rejects a bare date with no time', () => {
    const err = caught(() => validateEnvelope(makeEnvelope({ createdAt: '2026-07-15' })));
    expect(err).toBeInstanceOf(TransactionSchemaValidationError);
  });

  test('rejects a non-ISO date string', () => {
    const err = caught(() => validateEnvelope(makeEnvelope({ createdAt: 'July 15 2026' })));
    expect(err).toBeInstanceOf(TransactionSchemaValidationError);
  });

  test('accepts a full ISO 8601 timestamp with timezone designator', () => {
    expect(() => validateEnvelope(makeEnvelope({ createdAt: '2026-07-15T10:00:00.000Z' }))).not.toThrow();
  });
});

// -- listTransactionIds ---------------------------------------------------------

describe('listTransactionIds', () => {
  test('returns [] for a missing directory', () => {
    expect(listTransactionIds(AGENT_ID, { baseDir })).toEqual([]);
  });

  test('excludes a stray .tmp file, a stray non-matching .json file, and a subdirectory', () => {
    const dir = transactionsDir(baseDir, AGENT_ID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'txn-20260715-aaaaaaaa.json'), JSON.stringify(makeEnvelope({ transactionId: 'txn-20260715-aaaaaaaa' })), 'utf8');
    fs.writeFileSync(path.join(dir, 'txn-20260715-bbbbbbbb.json.tmp'), 'partial', 'utf8');
    fs.writeFileSync(path.join(dir, 'notes.json'), '{}', 'utf8');
    fs.mkdirSync(path.join(dir, 'txn-20260715-cccccccc.json'), { recursive: true });

    expect(listTransactionIds(AGENT_ID, { baseDir })).toEqual(['txn-20260715-aaaaaaaa']);
  });

  test('returns sorted ids', () => {
    const dir = transactionsDir(baseDir, AGENT_ID);
    fs.mkdirSync(dir, { recursive: true });
    const ids = ['txn-20260715-cccccccc', 'txn-20260715-aaaaaaaa', 'txn-20260715-bbbbbbbb'];
    for (const id of ids) {
      fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(makeEnvelope({ transactionId: id })), 'utf8');
    }
    expect(listTransactionIds(AGENT_ID, { baseDir })).toEqual(
      ['txn-20260715-aaaaaaaa', 'txn-20260715-bbbbbbbb', 'txn-20260715-cccccccc']
    );
  });
});

// -- Atomic write -------------------------------------------------------------------

describe('atomic write', () => {
  test('does not leave a .tmp file behind after a successful write', () => {
    const created = createTransaction(AGENT_ID, { type: 'buyer_purchase', state: 's' }, { baseDir, now: new Date('2026-07-15T10:00:00.000Z') });
    const filePath = transactionPath(baseDir, AGENT_ID, created.transactionId);
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

// -- Directory layout -------------------------------------------------------------

describe('directory layout', () => {
  test('directory name is exactly `${agentId}.transactions`', () => {
    createTransaction(AGENT_ID, { type: 'buyer_purchase', state: 's' }, { baseDir, now: new Date('2026-07-15T10:00:00.000Z') });
    expect(fs.existsSync(path.join(baseDir, `${AGENT_ID}.transactions`))).toBe(true);
  });
});

// -- ID format --------------------------------------------------------------------

describe('generateTransactionId / TRANSACTION_ID_RE', () => {
  test('created transactions have ids matching TRANSACTION_ID_RE', () => {
    const created = createTransaction(AGENT_ID, { type: 'buyer_purchase', state: 's' }, { baseDir, now: new Date('2026-07-15T10:00:00.000Z') });
    expect(TRANSACTION_ID_RE.test(created.transactionId)).toBe(true);
  });

  test('id date segment reflects the injected UTC clock', () => {
    const created = createTransaction(AGENT_ID, { type: 'buyer_purchase', state: 's' }, { baseDir, now: new Date('2026-01-05T23:59:00.000Z') });
    expect(created.transactionId.startsWith('txn-20260105-')).toBe(true);
  });
});
