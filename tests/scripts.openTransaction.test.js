'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('child_process');

const { openTransaction } = require('../scripts/open-transaction');
const { readTransaction, createTransaction, listTransactionIds } = require('../src/transactions/store');
const states = require('../src/transactions/states');
const facts = require('../src/transactions/facts');

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

describe('openTransaction with factPlan', () => {
  test('1. sets all four date-related facts in order, each a fact_set event with actor operator', () => {
    const factPlan = [
      ['conditions', ['financing', 'inspection']],
      ['conditionDates', { financing: '2026-10-06' }],
      ['acceptedDate', '2026-10-01'],
      ['additionalDepositDueDates', []],
    ];

    const result = openTransaction(AGENT_ID, { type: 'buyer_purchase', state: 'conditional', address: '12 Main St' }, { baseDir, now: CLOCK, factPlan });

    expect(result.facts).toEqual({
      conditions: ['financing', 'inspection'],
      conditionDates: { financing: '2026-10-06' },
      acceptedDate: '2026-10-01',
      additionalDepositDueDates: [],
    });

    const factSetEvents = result.events.filter((e) => e.kind === 'fact_set');
    expect(factSetEvents).toHaveLength(4);
    factSetEvents.forEach((e) => {
      expect(e.actor).toBe('operator');
    });
  });

  test('2. an invalid acceptedDate throws and nothing is created', () => {
    const factPlan = [
      ['conditions', ['financing', 'inspection']],
      ['conditionDates', { financing: '2026-10-06' }],
      ['acceptedDate', '2026-02-30'],
      ['additionalDepositDueDates', []],
    ];

    expect(() => openTransaction(AGENT_ID, { type: 'buyer_purchase', state: 'conditional', address: '12 Main St' }, { baseDir, now: CLOCK, factPlan }))
      .toThrow('open-transaction: acceptedDate must be a calendar date');

    expect(listTransactionIds(AGENT_ID, { baseDir })).toEqual([]);
  });

  test('3. conditionDates for a condition not on the deal throws with the open-transaction label and nothing is created', () => {
    const factPlan = [
      ['conditions', ['financing']],
      ['conditionDates', { inspection: '2026-10-04' }],
    ];

    expect(() => openTransaction(AGENT_ID, { type: 'buyer_purchase', state: 'conditional', address: '12 Main St' }, { baseDir, now: CLOCK, factPlan }))
      .toThrow("open-transaction: conditionDates has a date for 'inspection', but this deal's conditions are [financing]");

    expect(listTransactionIds(AGENT_ID, { baseDir })).toEqual([]);
  });

  test('4. additionalDepositDueDates is refused on tenant_lease and nothing is created', () => {
    const factPlan = [['additionalDepositDueDates', []]];

    expect(() => openTransaction(AGENT_ID, { type: 'tenant_lease', state: 'accepted', address: '12 Main St' }, { baseDir, now: CLOCK, factPlan }))
      .toThrow("additionalDepositDueDates is not permitted on type 'tenant_lease'");

    expect(listTransactionIds(AGENT_ID, { baseDir })).toEqual([]);
  });

  test('5. an empty factPlan behaves exactly as before: no facts, no events', () => {
    const result = openTransaction(AGENT_ID, { type: 'buyer_purchase', state: 'conditional', address: '12 Main St' }, { baseDir, now: CLOCK, factPlan: [] });

    expect(result).not.toHaveProperty('facts');
    expect(result).not.toHaveProperty('events');
  });

  test('6. a partial failure wraps the error with transactionId and factsWritten, and the deal keeps what was written', () => {
    const factPlan = [
      ['conditions', ['financing']],
      ['acceptedDate', '2026-10-01'],
    ];

    const realSetFact = facts.setFact;
    let calls = 0;
    const spy = jest.spyOn(facts, 'setFact').mockImplementation((...args) => {
      calls++;
      if (calls === 2) {
        throw new Error('disk full');
      }
      return realSetFact(...args);
    });

    try {
      let caught;
      try {
        openTransaction(AGENT_ID, { type: 'buyer_purchase', state: 'conditional', address: '12 Main St' }, { baseDir, now: CLOCK, factPlan });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect(caught.message).toContain('created');
      expect(caught.message).toContain('disk full');
      expect(caught.transactionId).toBeDefined();
      expect(caught.factsWritten).toEqual(['conditions']);

      const onDisk = readTransaction(AGENT_ID, caught.transactionId, { baseDir });
      expect(onDisk.facts).toEqual({ conditions: ['financing'] });
    } finally {
      spy.mockRestore();
    }
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
        [scriptPath, AGENT_ID, 'buyer_purchase', 'conditional', '--base-dir', baseDir, '--no-folder'],
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
      [scriptPath, AGENT_ID, 'buyer_purchase', 'conditional', '--address', '12 Main St', '--unit', 'Basement', '--base-dir', baseDir, '--no-folder'],
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
      [scriptPath, AGENT_ID, 'buyer_purchase', 'conditional', '--address', '12 Main St', '--base-dir', baseDir, '--no-folder'],
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

describe('CLI: deal-open facts (spawned subprocess)', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'open-transaction.js');

  function run(args) {
    return execFileSync('node', [scriptPath, ...args, '--no-folder'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }

  function runExpectingFailure(args) {
    const result = spawnSync('node', [scriptPath, ...args, '--no-folder'], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    return result;
  }

  test('7. conditions, conditionDates, acceptedDate and additionalDepositDueDates all land, and the digest-style lines appear', () => {
    const stdout = run([
      AGENT_ID, 'buyer_purchase', 'conditional', '--address', '12 Main St', '--base-dir', baseDir,
      '--condition', 'financing=2026-10-06', '--condition', 'inspection', '--accepted', '2026-10-01', '--no-additional-deposit',
    ]);

    expect(stdout).toContain('Facts set: conditions, conditionDates, acceptedDate, additionalDepositDueDates');
    expect(stdout).toContain('Still unanswered: hasSelfRepresentedParty, representationArrangement, entityType');
    expect(stdout).toContain('No date yet for: inspection');
  });

  test('8. --condition and --no-conditions together refuse, nothing created', () => {
    const result = runExpectingFailure([
      AGENT_ID, 'buyer_purchase', 'conditional', '--address', '12 Main St', '--base-dir', baseDir,
      '--condition', 'financing', '--no-conditions',
    ]);

    expect(result.stderr).toContain('--condition and --no-conditions');
    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  test('9. --accepted given twice refuses, nothing created', () => {
    const result = runExpectingFailure([
      AGENT_ID, 'buyer_purchase', 'conditional', '--address', '12 Main St', '--base-dir', baseDir,
      '--accepted', '2026-10-01', '--accepted', '2026-10-02',
    ]);

    expect(result.stderr).toContain('--accepted given more than once');
    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  test('10. a duplicate condition name refuses, nothing created', () => {
    const result = runExpectingFailure([
      AGENT_ID, 'buyer_purchase', 'conditional', '--address', '12 Main St', '--base-dir', baseDir,
      '--condition', 'financing=2026-10-06', '--condition', 'financing',
    ]);

    expect(result.stderr).toContain("duplicate condition 'financing'");
    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  test('11. --condition on a non-sale type refuses, nothing created', () => {
    const result = runExpectingFailure([
      AGENT_ID, 'tenant_lease', 'accepted', '--address', '12 Main St', '--base-dir', baseDir,
      '--condition', 'financing',
    ]);

    expect(result.stderr).toContain('apply to sales only');
    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  test('12. an invalid condition date refuses, nothing created', () => {
    const result = runExpectingFailure([
      AGENT_ID, 'buyer_purchase', 'conditional', '--address', '12 Main St', '--base-dir', baseDir,
      '--condition', 'financing=2026-02-30',
    ]);

    expect(result.stderr).toContain('open-transaction: conditionDates.financing must be a calendar date');
    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  test('13. no new flags: no Facts set line, and every unanswered fact is listed', () => {
    const stdout = run([AGENT_ID, 'buyer_purchase', 'conditional', '--address', '12 Main St', '--base-dir', baseDir]);

    expect(stdout).not.toContain('Facts set');
    expect(stdout).toContain('Still unanswered: hasSelfRepresentedParty, representationArrangement, entityType, additionalDepositDueDates, conditions');
  });

  // run/runExpectingFailure append --no-folder AFTER the given args, so a
  // "last argument" test has to spawn directly, with --no-folder placed
  // earlier, to leave --accepted/--additional-deposit as the true last
  // argument with nothing after it to supply a value.
  test('14. --accepted as the final argument refuses, nothing created', () => {
    const result = spawnSync('node', [
      scriptPath, AGENT_ID, 'buyer_purchase', 'conditional', '--no-folder', '--address', '12 Main St', '--base-dir', baseDir, '--accepted',
    ], { encoding: 'utf8' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--accepted needs a date');
    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  test('15. --additional-deposit as the final argument refuses, nothing created', () => {
    const result = spawnSync('node', [
      scriptPath, AGENT_ID, 'buyer_purchase', 'conditional', '--no-folder', '--address', '12 Main St', '--base-dir', baseDir, '--additional-deposit',
    ], { encoding: 'utf8' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--additional-deposit needs a date');
    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  test('16. a full set of APS flags lands every fact and leaves nothing unanswered', () => {
    const stdout = run([
      AGENT_ID, 'buyer_purchase', 'conditional', '--address', '12 Main St', '--base-dir', baseDir,
      '--condition', 'financing=2026-10-06', '--accepted', '2026-10-01', '--no-additional-deposit',
      '--no-self-represented', '--entity', 'individual', '--representation', 'single',
    ]);

    expect(stdout).toContain('Facts set: conditions, conditionDates, acceptedDate, additionalDepositDueDates, hasSelfRepresentedParty, entityType, representationArrangement');
    expect(stdout).toContain('Still unanswered: none');

    const dir = path.join(baseDir, `${AGENT_ID}.transactions`);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const written = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
    expect(written.facts.hasSelfRepresentedParty).toBe(false);
    expect(written.facts.entityType).toBe('individual');
    expect(written.facts.representationArrangement).toBe('single');
  });

  test('17. --self-represented with --no-self-represented refuses, nothing created', () => {
    const result = runExpectingFailure([
      AGENT_ID, 'buyer_purchase', 'conditional', '--address', '12 Main St', '--base-dir', baseDir,
      '--self-represented', '--no-self-represented',
    ]);

    expect(result.stderr).toContain('cannot both be given');
    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  test("18. --entity corperation refuses with the vocabulary message, nothing created", () => {
    const result = runExpectingFailure([
      AGENT_ID, 'buyer_purchase', 'conditional', '--address', '12 Main St', '--base-dir', baseDir,
      '--entity', 'corperation',
    ]);

    expect(result.stderr).toContain("open-transaction: entityType must be one of individual, corporation, other_entity, got 'corperation'");
    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  test('19. --representation double_ended on buyer_purchase refuses, nothing created', () => {
    const result = runExpectingFailure([
      AGENT_ID, 'buyer_purchase', 'conditional', '--address', '12 Main St', '--base-dir', baseDir,
      '--representation', 'double_ended',
    ]);

    expect(result.stderr).toContain("representationArrangement 'double_ended' is not permitted on type 'buyer_purchase'");
    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  test('20. --entity as the final argument refuses, nothing created', () => {
    const result = spawnSync('node', [
      scriptPath, AGENT_ID, 'buyer_purchase', 'conditional', '--no-folder', '--address', '12 Main St', '--base-dir', baseDir, '--entity',
    ], { encoding: 'utf8' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--entity needs a value (individual, corporation, other_entity)');
    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  test('21. --representation as the final argument refuses, nothing created', () => {
    const result = spawnSync('node', [
      scriptPath, AGENT_ID, 'buyer_purchase', 'conditional', '--no-folder', '--address', '12 Main St', '--base-dir', baseDir, '--representation',
    ], { encoding: 'utf8' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--representation needs a value (single, double_ended, designated)');
    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  test('22. --entity given twice refuses, nothing created', () => {
    const result = runExpectingFailure([
      AGENT_ID, 'buyer_purchase', 'conditional', '--address', '12 Main St', '--base-dir', baseDir,
      '--entity', 'individual', '--entity', 'corporation',
    ]);

    expect(result.stderr).toContain('--entity given more than once');
    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  test('23. --representation double_ended on seller_sale succeeds', () => {
    const stdout = run([
      AGENT_ID, 'seller_sale', 'conditional', '--address', '12 Main St', '--base-dir', baseDir,
      '--representation', 'double_ended',
    ]);

    const dir = path.join(baseDir, `${AGENT_ID}.transactions`);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const written = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
    expect(written.facts.representationArrangement).toBe('double_ended');
    expect(stdout).toContain('Transaction created:');
  });
});

describe('CLI: Drive folder creation is non-fatal', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'open-transaction.js');

  // No agents/<AGENT_ID>.json exists under this subprocess's STORAGE_ROOT
  // (unset, so agentConfig.js falls back to process.cwd()), so loadAgent
  // inside the folder-creation attempt throws naturally -- the same
  // failure shape a real Drive 500 or an auth failure would produce from
  // the CLI's point of view, since both are caught by the same non-fatal
  // try/catch. This is the assertion that matters: a deal must never fail
  // to open because Drive (or anything downstream of it) failed.
  test('Drive/agent-config failure: transaction is still created, driveFolderId is absent, exit is success', () => {
    const result = spawnSync(
      'node',
      [scriptPath, AGENT_ID, 'buyer_purchase', 'conditional', '--address', '12 Main St', '--base-dir', baseDir],
      { encoding: 'utf8' }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Transaction created:');
    expect(result.stderr).toContain('could not create Drive folder');

    const dir = path.join(baseDir, `${AGENT_ID}.transactions`);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    const written = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
    expect('driveFolderId' in written).toBe(false); // absent, not null
  });

  test('--no-folder skips the attempt entirely: no success message, no failure message', () => {
    const result = spawnSync(
      'node',
      [scriptPath, AGENT_ID, 'buyer_purchase', 'conditional', '--address', '12 Main St', '--base-dir', baseDir, '--no-folder'],
      { encoding: 'utf8' }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Transaction created:');
    expect(result.stdout).not.toContain('Drive folder ready');
    expect(result.stderr).not.toContain('could not create Drive folder');

    const dir = path.join(baseDir, `${AGENT_ID}.transactions`);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const written = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
    expect('driveFolderId' in written).toBe(false);
  });
});

describe('CLI: candidate listing report', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'open-transaction.js');

  // Fixture listings go straight through store.createTransaction, not
  // openTransaction: openTransaction enforces initial states, and the
  // terminal-listing fixture below needs a terminal one.
  function createListing(type, addressText, opts = {}) {
    const { state = 'live', unit } = opts;
    const fields = { type, state, address: addressText };
    if (unit !== undefined) fields.unit = unit;
    return createTransaction(AGENT_ID, fields, { baseDir, now: CLOCK });
  }

  // --no-folder: none of the tests in this describe block are testing Drive
  // folder behaviour, so none of them should depend on the folder-creation
  // try/catch swallowing a loadAgent failure they never meant to trigger.
  function run(args) {
    return execFileSync('node', [scriptPath, ...args, '--no-folder'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }

  function extractCreatedId(stdout) {
    const match = stdout.match(/Transaction created: (txn-\d{8}-[0-9a-f]{8})/);
    return match ? match[1] : undefined;
  }

  test('a seller_sale opened at a matching address reports the one non-terminal seller_listing found', () => {
    const listing = createListing('seller_listing', '14 Bonacres Rd');

    const stdout = run([AGENT_ID, 'seller_sale', 'conditional', '--address', '14 Bonacres Rd', '--base-dir', baseDir]);

    expect(stdout).toContain(listing.transactionId);
    expect(stdout).toContain('Matching listing found');
  });

  test('a landlord_lease opened at a matching address reports the one non-terminal landlord_listing found', () => {
    const listing = createListing('landlord_listing', '14 Bonacres Rd');

    const stdout = run([AGENT_ID, 'landlord_lease', 'accepted', '--address', '14 Bonacres Rd', '--base-dir', baseDir]);

    expect(stdout).toContain(listing.transactionId);
    expect(stdout).toContain('Matching listing found');
  });

  test('two matching listings are both reported', () => {
    const first = createListing('seller_listing', '14 Bonacres Rd');
    const second = createListing('seller_listing', '14 Bonacres Rd');

    const stdout = run([AGENT_ID, 'seller_sale', 'conditional', '--address', '14 Bonacres Rd', '--base-dir', baseDir]);

    expect(stdout).toContain(first.transactionId);
    expect(stdout).toContain(second.transactionId);
    expect(stdout).toContain('2 matching listings found');
  });

  test('a terminal listing at the same address is not reported', () => {
    const listing = createListing('seller_listing', '14 Bonacres Rd', { state: 'terminated' });

    const stdout = run([AGENT_ID, 'seller_sale', 'conditional', '--address', '14 Bonacres Rd', '--base-dir', baseDir]);

    expect(stdout).not.toContain(listing.transactionId);
    expect(stdout).not.toContain('Matching listing found');
  });

  test('a matching seller_listing is not reported for a buyer_purchase: wrong pairing, and buyer_purchase carries no listingId', () => {
    const listing = createListing('seller_listing', '14 Bonacres Rd');

    const stdout = run([AGENT_ID, 'buyer_purchase', 'conditional', '--address', '14 Bonacres Rd', '--base-dir', baseDir]);

    expect(stdout).not.toContain(listing.transactionId);
    expect(stdout).not.toContain('Matching listing found');
  });

  test('a listing at a different address is not reported', () => {
    const listing = createListing('seller_listing', '99 Other Ave');

    const stdout = run([AGENT_ID, 'seller_sale', 'conditional', '--address', '14 Bonacres Rd', '--base-dir', baseDir]);

    expect(stdout).not.toContain(listing.transactionId);
    expect(stdout).not.toContain('Matching listing found');
  });

  test('an explicit --listing-id suppresses the report even though a matching listing exists', () => {
    const listing = createListing('seller_listing', '14 Bonacres Rd');

    const stdout = run([
      AGENT_ID, 'seller_sale', 'conditional',
      '--address', '14 Bonacres Rd',
      '--listing-id', 'txn-20260101-aaaaaaaa',
      '--base-dir', baseDir,
    ]);

    expect(stdout).not.toContain('Matching listing found');
    expect(stdout).not.toContain(listing.transactionId);
  });

  test('address variants match: a listing stored as "14 Bonacres" is reported when opening a deal at "14 Bonacres Rd"', () => {
    const listing = createListing('seller_listing', '14 Bonacres');

    const stdout = run([AGENT_ID, 'seller_sale', 'conditional', '--address', '14 Bonacres Rd', '--base-dir', baseDir]);

    expect(stdout).toContain(listing.transactionId);
  });

  test('the exit code is 0 when a candidate is reported', () => {
    createListing('seller_listing', '14 Bonacres Rd');

    const result = spawnSync(
      'node',
      [scriptPath, AGENT_ID, 'seller_sale', 'conditional', '--address', '14 Bonacres Rd', '--base-dir', baseDir, '--no-folder'],
      { encoding: 'utf8' }
    );

    expect(result.status).toBe(0);
  });

  test('the exit code is 0 when two candidates are reported', () => {
    createListing('seller_listing', '14 Bonacres Rd');
    createListing('seller_listing', '14 Bonacres Rd');

    const result = spawnSync(
      'node',
      [scriptPath, AGENT_ID, 'seller_sale', 'conditional', '--address', '14 Bonacres Rd', '--base-dir', baseDir, '--no-folder'],
      { encoding: 'utf8' }
    );

    expect(result.status).toBe(0);
  });

  test('CRITICAL: no listingId is written to the created transaction when a candidate is reported', () => {
    createListing('seller_listing', '14 Bonacres Rd');

    const stdout = run([AGENT_ID, 'seller_sale', 'conditional', '--address', '14 Bonacres Rd', '--base-dir', baseDir]);

    const createdId = extractCreatedId(stdout);
    expect(createdId).toBeDefined();
    const onDisk = readTransaction(AGENT_ID, createdId, { baseDir });
    expect('listingId' in onDisk).toBe(false);
  });

  test('CRITICAL: no listingId is written to the created transaction when two candidates are reported', () => {
    createListing('seller_listing', '14 Bonacres Rd');
    createListing('seller_listing', '14 Bonacres Rd');

    const stdout = run([AGENT_ID, 'seller_sale', 'conditional', '--address', '14 Bonacres Rd', '--base-dir', baseDir]);

    const createdId = extractCreatedId(stdout);
    expect(createdId).toBeDefined();
    const onDisk = readTransaction(AGENT_ID, createdId, { baseDir });
    expect('listingId' in onDisk).toBe(false);
  });
});
