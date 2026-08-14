'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { execFileSync } = require('child_process');

const { parseFactValue } = require('../scripts/set-fact');
const { createTransaction, readTransaction } = require('../src/transactions/store');

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'set-fact-test-'));
}

let baseDir;

beforeEach(() => { baseDir = makeTmpDir(); });
afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

function create() {
  return createTransaction(AGENT_ID, { type: 'buyer_purchase', state: 'conditional', address: '12 Main St' }, { baseDir, now: CLOCK });
}

describe('parseFactValue', () => {
  it("parses 'true' and 'false' as booleans", () => {
    expect(parseFactValue('true')).toBe(true);
    expect(parseFactValue('false')).toBe(false);
  });

  it("parses 'null' as null", () => {
    expect(parseFactValue('null')).toBeNull();
  });

  it('parses a value starting with [ as JSON', () => {
    expect(parseFactValue('["Jane Smith","John Smith"]')).toEqual(['Jane Smith', 'John Smith']);
    expect(parseFactValue('[]')).toEqual([]);
  });

  it('throws a clear message when a [ value does not parse', () => {
    expect(() => parseFactValue('[oops')).toThrow(/^set-fact: could not parse '\[oops' as JSON/);
  });

  it('leaves a numeric-looking string as a string, unmodified', () => {
    expect(parseFactValue('12')).toBe('12');
  });

  it('leaves any other string as a string, unmodified', () => {
    expect(parseFactValue('individual')).toBe('individual');
  });
});

describe('CLI argument handling (spawned subprocess)', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'set-fact.js');

  // Strips STORAGE_ROOT so the missing --base-dir test below actually
  // exercises the refusal instead of silently falling back to whatever the
  // outer test run happens to have set.
  function cleanEnv() {
    const env = { ...process.env };
    delete env.STORAGE_ROOT;
    return env;
  }

  function run(args) {
    return execFileSync('node', [scriptPath, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv() });
  }

  function runExpectingFailure(args) {
    let threw = false;
    let stdout = '';
    let stderr = '';
    let status;
    try {
      stdout = run(args);
    } catch (err) {
      threw = true;
      stdout = err.stdout || '';
      stderr = err.stderr || '';
      status = err.status;
    }
    expect(threw).toBe(true);
    return { stdout, stderr, status };
  }

  it('a full valid invocation succeeds and the fact lands on disk', () => {
    const created = create();

    const stdout = run([AGENT_ID, created.transactionId, 'entityType', 'individual', '--base-dir', baseDir]);

    expect(stdout).toContain('Fact set: entityType');
    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.facts.entityType).toBe('individual');
  });

  it('a missing --base-dir refuses, nonzero exit, message names the flag', () => {
    const created = create();

    const { stderr, status } = runExpectingFailure([AGENT_ID, created.transactionId, 'entityType', 'individual']);

    expect(status).toBe(1);
    expect(stderr).toContain('--base-dir');
  });

  it('an unknown fact key exits nonzero with the writer message on stderr', () => {
    const created = create();

    const { stderr, status } = runExpectingFailure([AGENT_ID, created.transactionId, 'notARealKey', 'individual', '--base-dir', baseDir]);

    expect(status).toBe(1);
    expect(stderr).toContain("setFact: unknown fact key 'notARealKey'");
  });

  it("'true' stores a boolean, not a string", () => {
    const created = create();
    run([AGENT_ID, created.transactionId, 'hasSelfRepresentedParty', 'true', '--base-dir', baseDir]);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.facts.hasSelfRepresentedParty).toBe(true);
  });

  it("'[]' stores an empty array", () => {
    const created = create();
    run([AGENT_ID, created.transactionId, 'conditions', '[]', '--base-dir', baseDir]);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.facts.conditions).toEqual([]);
  });

  it("'12' stores the STRING '12', not the number 12", () => {
    const created = create();
    run([AGENT_ID, created.transactionId, 'entityType', '12', '--base-dir', baseDir]);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.facts.entityType).toBe('12');
    expect(typeof onDisk.facts.entityType).toBe('string');
  });

  it('a malformed [ value refuses, nonzero exit', () => {
    const created = create();

    const { stderr, status } = runExpectingFailure([AGENT_ID, created.transactionId, 'conditions', '[oops', '--base-dir', baseDir]);

    expect(status).toBe(1);
    expect(stderr).toContain('could not parse');
    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.facts).toBeUndefined();
  });

  it('--confirm confirms an existing fact instead of setting one, and takes no value', () => {
    const created = create();
    run([AGENT_ID, created.transactionId, 'entityType', 'individual', '--base-dir', baseDir]);

    const stdout = run([AGENT_ID, created.transactionId, 'entityType', '--confirm', '--base-dir', baseDir]);

    expect(stdout).toContain('Fact confirmed: entityType');
    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.events.filter((e) => e.kind === 'fact_confirmed')).toHaveLength(1);
  });

  it('--confirm with a value also given refuses, nonzero exit', () => {
    const created = create();
    run([AGENT_ID, created.transactionId, 'entityType', 'individual', '--base-dir', baseDir]);

    const { stderr, status } = runExpectingFailure([AGENT_ID, created.transactionId, 'entityType', 'individual', '--confirm', '--base-dir', baseDir]);

    expect(status).toBe(1);
    expect(stderr).toContain('--confirm');
  });
});
