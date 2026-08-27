'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { accumulateObservedAddresses } = require('../src/transactions/accumulator');
const observedAddresses = require('../src/transactions/observedAddresses');
const { createTransaction } = require('../src/transactions/store');

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');
const LATER = new Date('2026-07-16T09:30:00.000Z');
const AT = '2026-07-16T09:30:00.000Z';
const THREAD_ID = 'thread-xyz789';
const OWN_ADDRESS = 'agent@rlp.ca';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transactions-accumulator-test-'));
}

let baseDir;
let recordSpy;

beforeEach(() => { baseDir = makeTmpDir(); });

afterEach(() => {
  if (recordSpy) {
    recordSpy.mockRestore();
    recordSpy = null;
  }
  fs.rmSync(baseDir, { recursive: true, force: true });
});

function create(overrides = {}) {
  return createTransaction(
    AGENT_ID,
    { type: 'buyer_purchase', state: 'conditional', address: '12 Main St', ...overrides },
    { baseDir, now: CLOCK }
  );
}

function withConfirmedFiling(threadId = THREAD_ID) {
  return {
    filings: {
      f1: { threadId, status: 'filed', review: 'confirmed' },
    },
  };
}

function agentConfig(overrides = {}) {
  return { gmailAddress: OWN_ADDRESS, ...overrides };
}

function accumulate(transaction, message, opts = {}) {
  return accumulateObservedAddresses(transaction, message, agentConfig(), {
    at: AT,
    actor: 'system',
    baseDir,
    now: LATER,
    ...opts,
  });
}

describe('accumulateObservedAddresses', () => {
  it('does not call the writer when hasConfirmedFilingOnThread is false, and says so distinctly', () => {
    recordSpy = jest.spyOn(observedAddresses, 'recordObservedAddresses');
    const created = create();
    const message = { threadId: THREAD_ID, from: 'Jane <jane@firm.com>', to: [], cc: [] };

    const result = accumulate(created, message);

    expect(recordSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'gate_not_met' });
  });

  it('does not call the writer when the gate is met but nothing to collect, and the reason is distinct from gate_not_met', () => {
    recordSpy = jest.spyOn(observedAddresses, 'recordObservedAddresses');
    const created = create(withConfirmedFiling());
    const message = { threadId: THREAD_ID, from: `Agent <${OWN_ADDRESS}>`, to: [], cc: [] };

    const result = accumulate(created, message);

    expect(recordSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'nothing_to_collect' });
    expect(result.outcome).not.toBe('gate_not_met');
  });

  it('calls the writer with the collected set when the gate is met and addresses exist, and returns the recorded result', () => {
    recordSpy = jest.spyOn(observedAddresses, 'recordObservedAddresses');
    const created = create(withConfirmedFiling());
    const message = {
      threadId: THREAD_ID,
      from: 'Jane <jane@firm.com>',
      to: [{ address: 'bob@firm.com' }],
      cc: [],
    };

    const result = accumulate(created, message);

    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledWith(
      created.agentId,
      created.transactionId,
      [{ address: 'jane@firm.com', name: 'Jane' }, { address: 'bob@firm.com' }],
      expect.objectContaining({
        threadId: THREAD_ID,
        at: AT,
        actor: 'system',
        baseDir,
        now: LATER,
      })
    );

    expect(result.outcome).toBe('recorded');
    expect(result.transaction.observedAddresses['jane@firm.com']).toEqual({
      firstSeenAt: AT,
      threadId: THREAD_ID,
      name: 'Jane',
    });
    expect(result.transaction.observedAddresses['bob@firm.com']).toEqual({
      firstSeenAt: AT,
      threadId: THREAD_ID,
    });
  });

  it('derives agentId and transactionId from the transaction envelope, not from a separate argument', () => {
    recordSpy = jest.spyOn(observedAddresses, 'recordObservedAddresses');
    const created = create(withConfirmedFiling());
    const message = { threadId: THREAD_ID, from: 'Jane <jane@firm.com>', to: [], cc: [] };

    accumulate(created, message);

    const [calledAgentId, calledTransactionId] = recordSpy.mock.calls[0];
    expect(calledAgentId).toBe(created.agentId);
    expect(calledTransactionId).toBe(created.transactionId);
  });
});
