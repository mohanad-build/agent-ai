'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { readAllTransactions } = require('../src/transactions/queries');

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
