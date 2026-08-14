'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { execFileSync } = require('child_process');

const { createTransaction, readTransaction } = require('../src/transactions/store');

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'complete-item-test-'));
}

let baseDir;

beforeEach(() => { baseDir = makeTmpDir(); });
afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

function create() {
  return createTransaction(AGENT_ID, { type: 'buyer_purchase', state: 'conditional', address: '12 Main St' }, { baseDir, now: CLOCK });
}

describe('CLI argument handling (spawned subprocess)', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'complete-item.js');

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

    const stdout = run([AGENT_ID, created.transactionId, 'reco_information_guide', '--base-dir', baseDir]);

    expect(stdout).toContain('Item completed: reco_information_guide');
    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.items.reco_information_guide.completed).toBe(true);
    expect(typeof onDisk.items.reco_information_guide.completedAt).toBe('string');
  });

  it('a missing --base-dir refuses, nonzero exit, message names the flag', () => {
    const created = create();

    const { stderr, status } = runExpectingFailure([AGENT_ID, created.transactionId, 'reco_information_guide']);

    expect(status).toBe(1);
    expect(stderr).toContain('--base-dir');
  });

  it('an unknown item id exits nonzero with the writer message on stderr', () => {
    const created = create();

    const { stderr, status } = runExpectingFailure([AGENT_ID, created.transactionId, 'not_a_real_item', '--base-dir', baseDir]);

    expect(status).toBe(1);
    expect(stderr).toContain("markItemComplete: unknown item id 'not_a_real_item' for type 'buyer_purchase'");
  });

  it('two --document flags accumulate into the documents array', () => {
    const created = create();

    run([AGENT_ID, created.transactionId, 'reco_information_guide', '--document', 'guide.pdf', '--document', 'signed-copy.pdf', '--base-dir', baseDir]);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.items.reco_information_guide.documents).toEqual(['guide.pdf', 'signed-copy.pdf']);
  });

  it('omitting --document leaves no documents key at all', () => {
    const created = create();

    run([AGENT_ID, created.transactionId, 'reco_information_guide', '--base-dir', baseDir]);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.items.reco_information_guide).not.toHaveProperty('documents');
  });

  it('--completed-at, when given, lands on disk as the exact value passed', () => {
    const created = create();

    run([AGENT_ID, created.transactionId, 'reco_information_guide', '--completed-at', '2026-07-11T00:00:00.000Z', '--base-dir', baseDir]);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.items.reco_information_guide.completedAt).toBe('2026-07-11T00:00:00.000Z');
  });

  it('--undo marks a completed item incomplete again', () => {
    const created = create();
    run([AGENT_ID, created.transactionId, 'reco_information_guide', '--base-dir', baseDir]);

    const stdout = run([AGENT_ID, created.transactionId, 'reco_information_guide', '--undo', '--base-dir', baseDir]);

    expect(stdout).toContain('Item uncompleted: reco_information_guide');
    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.items.reco_information_guide.completed).toBe(false);
  });

  it('--undo combined with --note refuses, nonzero exit, and writes nothing', () => {
    const created = create();
    run([AGENT_ID, created.transactionId, 'reco_information_guide', '--base-dir', baseDir]);
    const before = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    const { stderr, status } = runExpectingFailure([AGENT_ID, created.transactionId, 'reco_information_guide', '--undo', '--note', 'oops', '--base-dir', baseDir]);

    expect(status).toBe(1);
    expect(stderr).toContain('--undo');
    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk).toEqual(before);
  });
});
