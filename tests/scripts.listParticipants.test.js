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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'list-participants-test-'));
}

let baseDir;

beforeEach(() => { baseDir = makeTmpDir(); });
afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

function create() {
  return createTransaction(AGENT_ID, { type: 'buyer_purchase', state: 'conditional', address: '12 Main St' }, { baseDir, now: CLOCK });
}

// Adds one participant with the given roles and (optionally) name, and
// returns the generated id. The CLI under test only reads, so the fixture
// setup goes straight through addParticipant rather than the CLI.
function add(transactionId, roles, name) {
  const before = readTransaction(AGENT_ID, transactionId, { baseDir });
  const beforeIds = Object.keys(before.participants || {});
  const opts = { at: AT, actor: 'agent', baseDir, now: CLOCK };
  const result = name === undefined
    ? addParticipant(AGENT_ID, transactionId, roles, opts)
    : addParticipant(AGENT_ID, transactionId, roles, { ...opts, name });
  return Object.keys(result.participants).find((id) => !beforeIds.includes(id));
}

describe('CLI argument handling (spawned subprocess)', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'list-participants.js');

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

  it('lists a single participant: id, name, and role all appear', () => {
    const created = create();
    const janeId = add(created.transactionId, ['client'], 'Jane Smith');

    const stdout = run([AGENT_ID, created.transactionId, '--base-dir', baseDir]);

    expect(stdout).toContain(janeId);
    expect(stdout).toContain('Jane Smith');
    expect(stdout).toContain('client');
  });

  it('lists several participants, sorted by id, and all of them appear', () => {
    const created = create();
    const idA = add(created.transactionId, ['client'], 'Alpha');
    const idB = add(created.transactionId, ['lawyer'], 'Beta');
    const idC = add(created.transactionId, ['co_client'], 'Gamma');

    const stdout = run([AGENT_ID, created.transactionId, '--base-dir', baseDir]);

    const sortedIds = [idA, idB, idC].sort();
    const lines = stdout.split('\n').filter((line) => sortedIds.some((id) => line.includes(id)));
    expect(lines.length).toBe(3);
    sortedIds.forEach((id, i) => {
      expect(lines[i]).toContain(id);
    });
  });

  it('a nameless participant prints the explicit absent-name marker, and its id still appears', () => {
    const created = create();
    const namelessId = add(created.transactionId, ['lawyer']);

    const stdout = run([AGENT_ID, created.transactionId, '--base-dir', baseDir]);

    expect(stdout).toContain(namelessId);
    expect(stdout).toContain('(no name)');
  });

  it('a represented participant is marked and a non-represented one is not', () => {
    const created = create();
    const clientId = add(created.transactionId, ['client'], 'Represented Rita');
    const lawyerId = add(created.transactionId, ['lawyer'], 'Unrepresented Uma');

    const stdout = run([AGENT_ID, created.transactionId, '--base-dir', baseDir]);
    const lines = stdout.split('\n');
    const clientLine = lines.find((line) => line.includes(clientId));
    const lawyerLine = lines.find((line) => line.includes(lawyerId));

    expect(clientLine).toContain('(represented)');
    expect(lawyerLine).not.toContain('(represented)');
  });

  it('a transaction with no participants exits 0 and says so', () => {
    const created = create();

    const stdout = run([AGENT_ID, created.transactionId, '--base-dir', baseDir]);

    expect(stdout).toContain('No participants');
  });

  it('a nonexistent transaction exits 1 with a message on stderr', () => {
    const { stderr, status } = runExpectingFailure([AGENT_ID, 'tx-does-not-exist', '--base-dir', baseDir]);

    expect(status).toBe(1);
    expect(stderr).toContain('tx-does-not-exist');
  });

  it('missing --base-dir with no STORAGE_ROOT exits 1 and the message names the flag', () => {
    const created = create();

    const { stderr, status } = runExpectingFailure([AGENT_ID, created.transactionId]);

    expect(status).toBe(1);
    expect(stderr).toContain('--base-dir');
  });

  it('missing positionals prints usage and exits 1', () => {
    const { stderr, status } = runExpectingFailure([AGENT_ID, '--base-dir', baseDir]);

    expect(status).toBe(1);
    expect(stderr).toContain('Usage:');
  });

  it('the transaction file is unchanged after running', () => {
    const created = create();
    add(created.transactionId, ['client'], 'Jane Smith');
    add(created.transactionId, ['lawyer']);
    const before = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    run([AGENT_ID, created.transactionId, '--base-dir', baseDir]);

    const after = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(after).toEqual(before);
  });
});
