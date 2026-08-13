'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { execFileSync } = require('child_process');

const { openTransaction } = require('../scripts/open-transaction');
const { readTransaction } = require('../src/transactions/store');
const states = require('../src/transactions/states');

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'open-transaction-test-'));
}

let baseDir;

beforeEach(() => { baseDir = makeTmpDir(); });
afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

describe('openTransaction', () => {
  test('a missing baseDir throws', () => {
    expect(() => openTransaction(AGENT_ID, { type: 'buyer_purchase', state: 'conditional' }, { now: CLOCK }))
      .toThrow('openTransaction: baseDir is required');
  });

  test('the baseDir refusal fires before type validation', () => {
    expect(() => openTransaction(AGENT_ID, { type: 'nonsense', state: 'conditional' }, { now: CLOCK }))
      .toThrow('openTransaction: baseDir is required');
  });

  test('an unknown type throws', () => {
    expect(() => openTransaction(AGENT_ID, { type: 'nonsense', state: 'conditional' }, { baseDir, now: CLOCK }))
      .toThrow(/unknown type 'nonsense'/);

    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  test('a valid type with a non-initial state throws and names the valid initial states', () => {
    expect(() => openTransaction(AGENT_ID, { type: 'buyer_purchase', state: 'closed' }, { baseDir, now: CLOCK }))
      .toThrow("openTransaction: 'closed' is not a valid initial state for type 'buyer_purchase'. Valid initial states: conditional, firm");

    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  test('a state that is not a state of the type at all throws the not-a-valid-state error, naming the valid states', () => {
    expect(() => openTransaction(AGENT_ID, { type: 'landlord_lease', state: 'preparing' }, { baseDir, now: CLOCK }))
      .toThrow("openTransaction: 'preparing' is not a valid state for type 'landlord_lease'. Valid states: accepted, signed, possession, closed, collapsed");

    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  for (const type of states.TRANSACTION_TYPES) {
    for (const state of states.getInitialStates(type)) {
      test(`opens ${type} in initial state ${state}`, () => {
        const result = openTransaction(AGENT_ID, { type, state, address: '12 Main St' }, { baseDir, now: CLOCK });

        expect(result.type).toBe(type);
        expect(result.state).toBe(state);
        expect(result.agentId).toBe(AGENT_ID);

        const onDisk = readTransaction(AGENT_ID, result.transactionId, { baseDir });
        expect(onDisk).toEqual(result);
      });
    }
  }

  test('persists a listingId when given', () => {
    const result = openTransaction(
      AGENT_ID,
      { type: 'seller_sale', state: 'conditional', address: '12 Main St', listingId: 'txn-20260601-11112222' },
      { baseDir, now: CLOCK }
    );

    expect(result.listingId).toBe('txn-20260601-11112222');
    const onDisk = readTransaction(AGENT_ID, result.transactionId, { baseDir });
    expect(onDisk.listingId).toBe('txn-20260601-11112222');
  });

  test('works without a listingId', () => {
    const result = openTransaction(AGENT_ID, { type: 'seller_sale', state: 'conditional', address: '12 Main St' }, { baseDir, now: CLOCK });

    expect(result).not.toHaveProperty('listingId');
    const onDisk = readTransaction(AGENT_ID, result.transactionId, { baseDir });
    expect(onDisk).not.toHaveProperty('listingId');
  });

  test('forwards address and unit through to the store', () => {
    const result = openTransaction(
      AGENT_ID,
      { type: 'seller_sale', state: 'conditional', address: '12 Main St', unit: 'Basement' },
      { baseDir, now: CLOCK }
    );

    expect(result.address).toBe('12 Main St');
    expect(result.unit).toBe('Basement');
    const onDisk = readTransaction(AGENT_ID, result.transactionId, { baseDir });
    expect(onDisk.address).toBe('12 Main St');
    expect(onDisk.unit).toBe('Basement');
  });

  test('works without a unit', () => {
    const result = openTransaction(AGENT_ID, { type: 'seller_sale', state: 'conditional', address: '12 Main St' }, { baseDir, now: CLOCK });

    expect(result).not.toHaveProperty('unit');
    const onDisk = readTransaction(AGENT_ID, result.transactionId, { baseDir });
    expect(onDisk).not.toHaveProperty('unit');
  });

  test('a transaction created without an address is refused', () => {
    expect(() => openTransaction(AGENT_ID, { type: 'seller_sale', state: 'conditional' }, { baseDir, now: CLOCK }))
      .toThrow(/address/);

    expect(fs.readdirSync(baseDir)).toEqual([]);
  });
});

describe('CLI argument handling (spawned subprocess)', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'open-transaction.js');

  test('missing --address refuses, exits nonzero, and names the flag', () => {
    let threw = false;
    let stderr = '';
    try {
      execFileSync(
        'node',
        [scriptPath, AGENT_ID, 'buyer_purchase', 'conditional', '--base-dir', baseDir],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch (err) {
      threw = true;
      stderr = err.stderr || '';
      expect(err.status).toBe(1);
    }
    expect(threw).toBe(true);
    expect(stderr).toContain('--address');
    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  test('a full valid invocation with --unit succeeds and writes a file', () => {
    const stdout = execFileSync(
      'node',
      [scriptPath, AGENT_ID, 'buyer_purchase', 'conditional', '--address', '12 Main St', '--unit', 'Basement', '--base-dir', baseDir],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );

    expect(stdout).toContain('Transaction created:');
    const dir = path.join(baseDir, `${AGENT_ID}.transactions`);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    const written = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
    expect(written.address).toBe('12 Main St');
    expect(written.unit).toBe('Basement');
  });

  test('the same invocation without --unit still succeeds', () => {
    const stdout = execFileSync(
      'node',
      [scriptPath, AGENT_ID, 'buyer_purchase', 'conditional', '--address', '12 Main St', '--base-dir', baseDir],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );

    expect(stdout).toContain('Transaction created:');
    const dir = path.join(baseDir, `${AGENT_ID}.transactions`);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    const written = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
    expect(written.address).toBe('12 Main St');
    expect(written).not.toHaveProperty('unit');
  });
});
