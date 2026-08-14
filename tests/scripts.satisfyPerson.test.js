'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { execFileSync } = require('child_process');

const { createTransaction, readTransaction } = require('../src/transactions/store');
const { setFact } = require('../src/transactions/facts');

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');
const AT = '2026-07-15T10:00:00.000Z';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'satisfy-person-test-'));
}

let baseDir;

beforeEach(() => { baseDir = makeTmpDir(); });
afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

function create() {
  return createTransaction(AGENT_ID, { type: 'buyer_purchase', state: 'conditional', address: '12 Main St' }, { baseDir, now: CLOCK });
}

function represent(transactionId, personIds) {
  return setFact(AGENT_ID, transactionId, 'representedPersons', personIds, { at: AT, actor: 'agent', baseDir, now: CLOCK });
}

describe('CLI argument handling (spawned subprocess)', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'satisfy-person.js');

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

  it('a full valid invocation succeeds and the change is on disk', () => {
    const created = create();
    represent(created.transactionId, ['Jane Smith']);

    const stdout = run([AGENT_ID, created.transactionId, 'Jane Smith', 'reco_information_guide', '--base-dir', baseDir]);

    expect(stdout).toContain('Person satisfied: Jane Smith / reco_information_guide');
    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.facts.clientSatisfactions['Jane Smith']).toHaveProperty('reco_information_guide');
  });

  it('a missing --base-dir refuses, nonzero exit, message names the flag', () => {
    const created = create();
    represent(created.transactionId, ['Jane Smith']);

    const { stderr, status } = runExpectingFailure([AGENT_ID, created.transactionId, 'Jane Smith', 'reco_information_guide']);

    expect(status).toBe(1);
    expect(stderr).toContain('--base-dir');
  });

  it('a person not in representedPersons exits nonzero with the writer message on stderr', () => {
    const created = create();
    represent(created.transactionId, ['Jane Smith']);

    const { stderr, status } = runExpectingFailure([AGENT_ID, created.transactionId, 'Ghost Person', 'reco_information_guide', '--base-dir', baseDir]);

    expect(status).toBe(1);
    expect(stderr).toContain("markPersonSatisfied: 'Ghost Person' is not in representedPersons");
  });

  it('the person argument is passed through unmodified: differing case is a different, unrepresented person', () => {
    const created = create();
    represent(created.transactionId, ['Jane Smith']);

    const { stderr, status } = runExpectingFailure([AGENT_ID, created.transactionId, 'jane smith', 'reco_information_guide', '--base-dir', baseDir]);

    expect(status).toBe(1);
    expect(stderr).toContain("markPersonSatisfied: 'jane smith' is not in representedPersons");
  });

  it('--undo unsatisfies a previously satisfied person', () => {
    const created = create();
    represent(created.transactionId, ['Jane Smith']);
    run([AGENT_ID, created.transactionId, 'Jane Smith', 'reco_information_guide', '--base-dir', baseDir]);

    const stdout = run([AGENT_ID, created.transactionId, 'Jane Smith', 'reco_information_guide', '--undo', '--base-dir', baseDir]);

    expect(stdout).toContain('Person unsatisfied: Jane Smith / reco_information_guide');
    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.facts.clientSatisfactions).toEqual({});
  });

  it('--undo on a never-satisfied item refuses, nonzero exit, and writes nothing', () => {
    const created = create();
    represent(created.transactionId, ['Jane Smith']);
    const before = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    const { stderr, status } = runExpectingFailure([AGENT_ID, created.transactionId, 'Jane Smith', 'reco_information_guide', '--undo', '--base-dir', baseDir]);

    expect(status).toBe(1);
    expect(stderr).toContain('is not satisfied for item');
    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk).toEqual(before);
  });
});
