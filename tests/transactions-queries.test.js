'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { readAllTransactions, readAllTransactionsSettled } = require('../src/transactions/queries');

const store = require('../src/transactions/store');
const {
  TransactionCorruptionError,
  TransactionSchemaValidationError,
  createTransaction,
} = store;
const { transactionsDir } = store._internal;

// -- Helpers ------------------------------------------------------------------

const AGENT_ID = 'test-agent';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transactionQueries-test-'));
}

function makeEnvelope(overrides = {}) {
  return {
    schemaVersion: 1,
    transactionId: 'txn-20260715-abcd1234',
    agentId: AGENT_ID,
    type: 'buyer_purchase',
    state: 'conditional',
    address: '12 Main St',
    createdAt: '2026-07-15T10:00:00.000Z',
    updatedAt: '2026-07-15T10:00:00.000Z',
    ...overrides,
  };
}

let baseDir;
let readSpy;

beforeEach(() => { baseDir = makeTmpDir(); });

afterEach(() => {
  if (readSpy) {
    readSpy.mockRestore();
    readSpy = null;
  }
  fs.rmSync(baseDir, { recursive: true, force: true });
});

// -- readAllTransactions --------------------------------------------------------

describe('readAllTransactions', () => {
  test('returns [] when the agent directory does not exist at all', () => {
    expect(readAllTransactions(AGENT_ID, { baseDir })).toEqual([]);
  });

  test('returns [] when the agent directory exists but is empty', () => {
    fs.mkdirSync(transactionsDir(baseDir, AGENT_ID), { recursive: true });
    expect(readAllTransactions(AGENT_ID, { baseDir })).toEqual([]);
  });

  test('returns an array of one full object, with nested fields surviving', () => {
    createTransaction(
      AGENT_ID,
      {
        type: 'buyer_purchase',
        state: 'conditional',
        address: '12 Main St',
        filings: { threadId: 'thread-1', confirmed: true },
        participants: [{ role: 'buyer', address: 'buyer@example.com' }],
      },
      { baseDir, now: new Date('2026-07-15T10:00:00.000Z') }
    );

    const result = readAllTransactions(AGENT_ID, { baseDir });

    expect(result).toHaveLength(1);
    expect(result[0].filings).toEqual({ threadId: 'thread-1', confirmed: true });
    expect(result[0].participants).toEqual([{ role: 'buyer', address: 'buyer@example.com' }]);
    expect(result[0].address).toBe('12 Main St');
  });

  test('returns three transactions in listTransactionIds order', () => {
    const dir = transactionsDir(baseDir, AGENT_ID);
    fs.mkdirSync(dir, { recursive: true });
    const ids = ['txn-20260715-cccccccc', 'txn-20260715-aaaaaaaa', 'txn-20260715-bbbbbbbb'];
    for (const id of ids) {
      fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(makeEnvelope({ transactionId: id })), 'utf8');
    }

    const expectedOrder = store.listTransactionIds(AGENT_ID, { baseDir });
    expect(expectedOrder).toEqual(['txn-20260715-aaaaaaaa', 'txn-20260715-bbbbbbbb', 'txn-20260715-cccccccc']);

    const result = readAllTransactions(AGENT_ID, { baseDir });
    expect(result.map((t) => t.transactionId)).toEqual(expectedOrder);
  });

  test('ignores stray files that do not match TRANSACTION_FILE_RE', () => {
    const dir = transactionsDir(baseDir, AGENT_ID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.DS_Store'), 'binary junk', 'utf8');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a transaction', 'utf8');
    fs.writeFileSync(path.join(dir, 'foo.json'), '{}', 'utf8');
    fs.writeFileSync(
      path.join(dir, 'txn-20260715-aaaaaaaa.json'),
      JSON.stringify(makeEnvelope({ transactionId: 'txn-20260715-aaaaaaaa' })),
      'utf8'
    );

    const result = readAllTransactions(AGENT_ID, { baseDir });
    expect(result).toHaveLength(1);
    expect(result[0].transactionId).toBe('txn-20260715-aaaaaaaa');
  });

  test('ignores a directory named like a valid transaction file', () => {
    const dir = transactionsDir(baseDir, AGENT_ID);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'txn-20260715-cccccccc.json'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'txn-20260715-aaaaaaaa.json'),
      JSON.stringify(makeEnvelope({ transactionId: 'txn-20260715-aaaaaaaa' })),
      'utf8'
    );

    const result = readAllTransactions(AGENT_ID, { baseDir });
    expect(result).toHaveLength(1);
    expect(result[0].transactionId).toBe('txn-20260715-aaaaaaaa');
  });

  test('throws TransactionCorruptionError when a matching file contains invalid JSON', () => {
    const dir = transactionsDir(baseDir, AGENT_ID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'txn-20260715-aaaaaaaa.json'), '{ not valid json', 'utf8');

    expect(() => readAllTransactions(AGENT_ID, { baseDir })).toThrow(TransactionCorruptionError);
  });

  test('throws TransactionSchemaValidationError when a matching file fails envelope validation', () => {
    const dir = transactionsDir(baseDir, AGENT_ID);
    fs.mkdirSync(dir, { recursive: true });
    const invalidEnvelope = makeEnvelope({ transactionId: 'txn-20260715-aaaaaaaa' });
    delete invalidEnvelope.address;
    fs.writeFileSync(path.join(dir, 'txn-20260715-aaaaaaaa.json'), JSON.stringify(invalidEnvelope), 'utf8');

    expect(() => readAllTransactions(AGENT_ID, { baseDir })).toThrow(TransactionSchemaValidationError);
  });

  test('silently skips an id whose read comes back null, without throwing', () => {
    const dir = transactionsDir(baseDir, AGENT_ID);
    fs.mkdirSync(dir, { recursive: true });
    const ids = ['txn-20260715-aaaaaaaa', 'txn-20260715-bbbbbbbb', 'txn-20260715-cccccccc'];
    for (const id of ids) {
      fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(makeEnvelope({ transactionId: id })), 'utf8');
    }

    const originalReadTransaction = store.readTransaction.bind(store);
    readSpy = jest.spyOn(store, 'readTransaction').mockImplementation((agentId, transactionId, opts) => {
      if (transactionId === 'txn-20260715-bbbbbbbb') return null;
      return originalReadTransaction(agentId, transactionId, opts);
    });

    const result = readAllTransactions(AGENT_ID, { baseDir });
    expect(result.map((t) => t.transactionId)).toEqual(['txn-20260715-aaaaaaaa', 'txn-20260715-cccccccc']);
  });

  test('throws on a missing agentId', () => {
    expect(() => readAllTransactions(undefined, { baseDir })).toThrow();
  });

  test('throws on an empty agentId', () => {
    expect(() => readAllTransactions('', { baseDir })).toThrow();
  });
});

// -- readAllTransactionsSettled -------------------------------------------------

const NOW = new Date('2026-07-15T10:00:00.000Z');

function setupMixedFixture(baseDir) {
  const dir = transactionsDir(baseDir, AGENT_ID);

  const good1 = createTransaction(AGENT_ID, { type: 'buyer_purchase', state: 'conditional', address: '12 Main St' }, { baseDir, now: NOW });
  const good2 = createTransaction(AGENT_ID, { type: 'seller_sale', state: 'conditional', address: '34 Oak Ave' }, { baseDir, now: NOW });
  const badJson = createTransaction(AGENT_ID, { type: 'buyer_purchase', state: 'conditional', address: '56 Pine Rd' }, { baseDir, now: NOW });
  const badSchema = createTransaction(AGENT_ID, { type: 'tenant_lease', state: 'accepted', address: '78 Elm St' }, { baseDir, now: NOW });

  fs.writeFileSync(path.join(dir, `${badJson.transactionId}.json`), '{ not valid json', 'utf8');

  const invalidEnvelope = { ...badSchema, type: 'not_a_type' };
  fs.writeFileSync(path.join(dir, `${badSchema.transactionId}.json`), JSON.stringify(invalidEnvelope), 'utf8');

  return {
    goodIds: [good1.transactionId, good2.transactionId],
    badJsonId: badJson.transactionId,
    badSchemaId: badSchema.transactionId,
  };
}

describe('readAllTransactionsSettled', () => {
  test('1. unreadable files do not hide the readable ones', () => {
    const { goodIds, badJsonId, badSchemaId } = setupMixedFixture(baseDir);

    const expectedOrder = store.listTransactionIds(AGENT_ID, { baseDir });
    const expectedGoodOrder = expectedOrder.filter((id) => goodIds.includes(id));

    const result = readAllTransactionsSettled(AGENT_ID, { baseDir });

    expect(result.transactions.map((t) => t.transactionId)).toEqual(expectedGoodOrder);
    expect(result.unreadable).toHaveLength(2);

    const byId = Object.fromEntries(result.unreadable.map((entry) => [entry.transactionId, entry.error]));
    expect(Object.keys(byId).sort()).toEqual([badJsonId, badSchemaId].sort());
    expect(byId[badJsonId]).toEqual(expect.stringContaining('invalid JSON'));
    expect(byId[badSchemaId]).toEqual(expect.stringContaining('validation failed'));
  });

  test('2. no transactions directory: empty settled result', () => {
    expect(readAllTransactionsSettled(AGENT_ID, { baseDir })).toEqual({ transactions: [], unreadable: [] });
  });

  test('3. all files valid: unreadable is empty and every deal is present', () => {
    const t1 = createTransaction(AGENT_ID, { type: 'buyer_purchase', state: 'conditional', address: '12 Main St' }, { baseDir, now: NOW });
    const t2 = createTransaction(AGENT_ID, { type: 'seller_sale', state: 'conditional', address: '34 Oak Ave' }, { baseDir, now: NOW });
    const t3 = createTransaction(AGENT_ID, { type: 'tenant_lease', state: 'accepted', address: '56 Pine Rd' }, { baseDir, now: NOW });

    const expectedOrder = store.listTransactionIds(AGENT_ID, { baseDir });
    expect(expectedOrder.sort()).toEqual([t1.transactionId, t2.transactionId, t3.transactionId].sort());

    const result = readAllTransactionsSettled(AGENT_ID, { baseDir });

    expect(result.unreadable).toEqual([]);
    expect(result.transactions.map((t) => t.transactionId)).toEqual(expectedOrder);
  });

  test('4. readAllTransactions on the same fixture still throws', () => {
    setupMixedFixture(baseDir);

    expect(() => readAllTransactions(AGENT_ID, { baseDir })).toThrow();
  });

  test('5. a vanished file (read returns null) is skipped, not recorded as unreadable', () => {
    const t1 = createTransaction(AGENT_ID, { type: 'buyer_purchase', state: 'conditional', address: '12 Main St' }, { baseDir, now: NOW });
    const t2 = createTransaction(AGENT_ID, { type: 'seller_sale', state: 'conditional', address: '34 Oak Ave' }, { baseDir, now: NOW });

    const [firstId, secondId] = store.listTransactionIds(AGENT_ID, { baseDir });
    const secondTransaction = secondId === t1.transactionId ? t1 : t2;

    const originalReadTransaction = store.readTransaction.bind(store);
    readSpy = jest.spyOn(store, 'readTransaction').mockImplementation((agentId, transactionId, opts) => {
      if (transactionId === firstId) return null;
      return originalReadTransaction(agentId, transactionId, opts);
    });

    const result = readAllTransactionsSettled(AGENT_ID, { baseDir });

    expect(result).toEqual({ transactions: [secondTransaction], unreadable: [] });
  });
});
