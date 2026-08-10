'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

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

  for (const type of states.TRANSACTION_TYPES) {
    for (const state of states.getInitialStates(type)) {
      test(`opens ${type} in initial state ${state}`, () => {
        const result = openTransaction(AGENT_ID, { type, state }, { baseDir, now: CLOCK });

        expect(result.type).toBe(type);
        expect(result.state).toBe(state);
        expect(result.agentId).toBe(AGENT_ID);

        const onDisk = readTransaction(AGENT_ID, result.transactionId, { baseDir });
        expect(onDisk).toEqual(result);
      });
    }
  }
});
