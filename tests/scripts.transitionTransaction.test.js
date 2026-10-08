'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { execFileSync } = require('child_process');

const { createTransaction, readTransaction } = require('../src/transactions/store');
const { readAllTransactionsSettled } = require('../src/transactions/queries');
const { collectDealAlerts } = require('../src/transactions/dealAlerts');

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transition-transaction-test-'));
}

let baseDir;

beforeEach(() => { baseDir = makeTmpDir(); });
afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

function createInState(state, type = 'buyer_purchase', fields = {}) {
  return createTransaction(AGENT_ID, { type, state, address: '12 Main St', ...fields }, { baseDir, now: CLOCK });
}

describe('CLI argument handling (spawned subprocess)', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'transition-transaction.js');

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

  // ── Dry run writes nothing ────────────────────────────────────────────────

  it('dry run: file bytes identical before and after, exit 0, no "Done."', () => {
    const created = createInState('firm');
    const before = fs.readFileSync(path.join(baseDir, `${AGENT_ID}.transactions`, `${created.transactionId}.json`), 'utf8');

    const stdout = run([AGENT_ID, created.transactionId, 'collapsed', '--reason', 'buyer backed out', '--base-dir', baseDir]);

    const after = fs.readFileSync(path.join(baseDir, `${AGENT_ID}.transactions`, `${created.transactionId}.json`), 'utf8');
    expect(after).toBe(before);
    expect(stdout).not.toContain('Done.');
    expect(stdout.trim().split('\n').pop()).toBe('Dry run: nothing was changed. Run again with --yes to apply.');
  });

  it('dry run prints the full preview: agent, transaction, address with unit, type, states, terminal, reason', () => {
    const created = createInState('firm', 'buyer_purchase', { unit: '4' });

    const stdout = run([AGENT_ID, created.transactionId, 'collapsed', '--reason', 'buyer backed out', '--base-dir', baseDir]);

    expect(stdout).toContain(`Agent: ${AGENT_ID}`);
    expect(stdout).toContain(`Transaction: ${created.transactionId}`);
    expect(stdout).toContain('Address: 12 Main St, unit 4');
    expect(stdout).toContain('Type: buyer_purchase');
    expect(stdout).toContain('Current state: firm');
    expect(stdout).toContain('Target state: collapsed');
    expect(stdout).toContain('Terminal: yes');
    expect(stdout).toContain('This cannot be undone.');
    expect(stdout).toContain('Reason: buyer backed out');
  });

  it('dry run for a non-terminal target: Terminal: no, and no "This cannot be undone."', () => {
    const created = createInState('conditional');

    const stdout = run([AGENT_ID, created.transactionId, 'firm', '--base-dir', baseDir]);

    expect(stdout).toContain('Terminal: no');
    expect(stdout).not.toContain('This cannot be undone.');
  });

  // ── --yes writes exactly one state change and one event ──────────────────

  it('--yes writes the state change and exactly one state_transitioned event, prints "Done."', () => {
    const created = createInState('firm');

    const stdout = run([AGENT_ID, created.transactionId, 'collapsed', '--reason', 'buyer backed out', '--yes', '--base-dir', baseDir]);

    expect(stdout).toContain('Done.');
    expect(stdout).not.toContain('Dry run: nothing was changed.');
    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.state).toBe('collapsed');
    expect(onDisk.events).toHaveLength(1);
    expect(onDisk.events[0].kind).toBe('state_transitioned');
    expect(onDisk.events[0].actor).toBe('operator');
    expect(onDisk.events[0].payload).toEqual({ fromState: 'firm', toState: 'collapsed', reason: 'buyer backed out' });
    expect(typeof onDisk.events[0].at).toBe('string');
  });

  it('--yes with no --reason on a non-terminal move: reason lands as null', () => {
    const created = createInState('conditional');

    run([AGENT_ID, created.transactionId, 'firm', '--yes', '--base-dir', baseDir]);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.events[0].payload.reason).toBeNull();
  });

  // ── Refusals: no write, nonzero exit ──────────────────────────────────────

  it('unknown transaction: nonzero exit, no write possible (nothing to compare), message names agent and id', () => {
    const { stderr, status } = runExpectingFailure([AGENT_ID, 'txn-20260715-00000000', 'firm', '--base-dir', baseDir]);

    expect(status).toBe(1);
    expect(stderr).toContain(`no transaction txn-20260715-00000000 for agent ${AGENT_ID}`);
  });

  it('a transition the state machine does not allow: canTransition message printed verbatim, no write', () => {
    const created = createInState('conditional');
    const before = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    const { stderr, status } = runExpectingFailure([AGENT_ID, created.transactionId, 'closed', '--yes', '--base-dir', baseDir]);

    expect(status).toBe(1);
    expect(stderr.trim()).toBe('Cannot move from conditional to closed');
    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk).toEqual(before);
  });

  it('already in target state: the script\'s own message, nonzero exit, no write', () => {
    const created = createInState('firm');
    const before = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    const { stderr, status } = runExpectingFailure([AGENT_ID, created.transactionId, 'firm', '--yes', '--base-dir', baseDir]);

    expect(status).toBe(1);
    expect(stderr.trim()).toBe("transition-transaction: already in state 'firm'");
    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk).toEqual(before);
  });

  it('already terminal: canTransition\'s final-state message printed verbatim, no write', () => {
    const created = createInState('collapsed');
    const before = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    const { stderr, status } = runExpectingFailure([AGENT_ID, created.transactionId, 'closed', '--yes', '--base-dir', baseDir]);

    expect(status).toBe(1);
    expect(stderr.trim()).toBe('collapsed is a final state and cannot transition to another state');
    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk).toEqual(before);
  });

  it('missing --reason for a terminal target: refused on the dry run itself, before --yes, no write', () => {
    const created = createInState('firm');
    const before = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    const { stderr, status } = runExpectingFailure([AGENT_ID, created.transactionId, 'collapsed', '--base-dir', baseDir]);

    expect(status).toBe(1);
    expect(stderr.trim()).toBe("transition-transaction: --reason is required when moving to 'collapsed'");
    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk).toEqual(before);
  });

  it('--reason is optional for closed (terminal, but not held to the reason requirement)', () => {
    const created = createInState('firm');

    const stdout = run([AGENT_ID, created.transactionId, 'closed', '--base-dir', baseDir]);
    expect(stdout).toContain('Terminal: yes');
    expect(stdout).not.toContain('Reason:');
  });

  it('--reason is optional for a non-terminal move', () => {
    const created = createInState('conditional');

    expect(() => run([AGENT_ID, created.transactionId, 'firm', '--base-dir', baseDir])).not.toThrow();
  });

  it('missing --base-dir refuses, nonzero exit, message names the flag', () => {
    const created = createInState('firm');

    const { stderr, status } = runExpectingFailure([AGENT_ID, created.transactionId, 'collapsed', '--reason', 'x']);

    expect(status).toBe(1);
    expect(stderr).toContain('--base-dir');
  });

  // ── End-to-end: the point of the command ──────────────────────────────────

  it('a collapsed deal produces no alerts from collectDealAlerts', () => {
    const created = createInState('firm');

    run([AGENT_ID, created.transactionId, 'collapsed', '--reason', 'buyer backed out', '--yes', '--base-dir', baseDir]);

    const settled = readAllTransactionsSettled(AGENT_ID, { baseDir });
    const collected = collectDealAlerts(settled, { today: '2026-07-16', now: new Date('2026-07-16T10:00:00.000Z') });

    expect(collected.alerts).toHaveLength(0);
    expect(collected.activeCount).toBe(0);
  });
});
