'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { execFileSync } = require('child_process');

const { createTransaction, readTransaction } = require('../src/transactions/store');
const { addParticipant } = require('../src/transactions/participants');

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

// Adds one 'client' participant per name and returns their generated ids, in
// the same order as the names given. The CLI under test takes whatever
// string it is given for the person argument; these tests pass the
// generated id, not the name.
function represent(transactionId, names) {
  const ids = [];
  names.forEach((name) => {
    const result = addParticipant(AGENT_ID, transactionId, ['client'], { name, at: AT, actor: 'agent', baseDir, now: CLOCK });
    const newId = Object.keys(result.participants).find((id) => !ids.includes(id));
    ids.push(newId);
  });
  return ids;
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
    const [janeId] = represent(created.transactionId, ['Jane Smith']);

    const stdout = run([AGENT_ID, created.transactionId, janeId, 'reco_information_guide', '--base-dir', baseDir]);

    expect(stdout).toContain(`Person satisfied: ${janeId} / reco_information_guide`);
    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.facts.clientSatisfactions[janeId]).toHaveProperty('reco_information_guide');
  });

  it('a missing --base-dir refuses, nonzero exit, message names the flag', () => {
    const created = create();
    const [janeId] = represent(created.transactionId, ['Jane Smith']);

    const { stderr, status } = runExpectingFailure([AGENT_ID, created.transactionId, janeId, 'reco_information_guide']);

    expect(status).toBe(1);
    expect(stderr).toContain('--base-dir');
  });

  it('an id that is not a participant on the transaction exits nonzero with the writer message on stderr', () => {
    const created = create();
    represent(created.transactionId, ['Jane Smith']);

    const { stderr, status } = runExpectingFailure([AGENT_ID, created.transactionId, 'per-ffffffff', 'reco_information_guide', '--base-dir', baseDir]);

    expect(status).toBe(1);
    expect(stderr).toContain("markPersonSatisfied: 'per-ffffffff' is not a participant on transaction");
  });

  it('the person argument is passed through unmodified: a differently-cased id is not the same participant', () => {
    const created = create();
    const [janeId] = represent(created.transactionId, ['Jane Smith']);
    const differentCase = janeId.toUpperCase();

    const { stderr, status } = runExpectingFailure([AGENT_ID, created.transactionId, differentCase, 'reco_information_guide', '--base-dir', baseDir]);

    expect(status).toBe(1);
    expect(stderr).toContain(`markPersonSatisfied: '${differentCase}' is not a participant on transaction`);
  });

  it('--undo unsatisfies a previously satisfied person', () => {
    const created = create();
    const [janeId] = represent(created.transactionId, ['Jane Smith']);
    run([AGENT_ID, created.transactionId, janeId, 'reco_information_guide', '--base-dir', baseDir]);

    const stdout = run([AGENT_ID, created.transactionId, janeId, 'reco_information_guide', '--undo', '--base-dir', baseDir]);

    expect(stdout).toContain(`Person unsatisfied: ${janeId} / reco_information_guide`);
    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.facts.clientSatisfactions).toEqual({});
  });

  it('--undo on a never-satisfied item refuses, nonzero exit, and writes nothing', () => {
    const created = create();
    const [janeId] = represent(created.transactionId, ['Jane Smith']);
    const before = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    const { stderr, status } = runExpectingFailure([AGENT_ID, created.transactionId, janeId, 'reco_information_guide', '--undo', '--base-dir', baseDir]);

    expect(status).toBe(1);
    expect(stderr).toContain('is not satisfied for item');
    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk).toEqual(before);
  });
});
