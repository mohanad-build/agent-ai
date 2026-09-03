'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { processTcTouchpoints } = require('../src/transactions/touchpoints');
const queries = require('../src/transactions/queries');
const accumulator = require('../src/transactions/accumulator');
const intake = require('../src/transactions/intake');
const { createTransaction, readTransaction } = require('../src/transactions/store');

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');
const AT = '2026-07-16T09:30:00.000Z';
const LATER = new Date(AT);
const THREAD_ID = 'thread-abc123';

function agentConfig(overrides = {}) {
  return { agentId: AGENT_ID, gmailAddress: 'agent@rlp.ca', ...overrides };
}

function message(overrides = {}) {
  return {
    messageId: 'msg-1',
    threadId: 'thread-1',
    hasAttachments: false,
    attachmentInfo: [],
    from: 'lawyer@firm.com',
    subject: '',
    body: '',
    receivedAt: '2026-07-16T08:00:00.000Z',
    ...overrides,
  };
}

let spies;

beforeEach(() => { spies = []; });
afterEach(() => { spies.forEach((s) => s.mockRestore()); });

function spyOn(obj, method) {
  const s = jest.spyOn(obj, method);
  spies.push(s);
  return s;
}

describe('processTcTouchpoints', () => {
  it('reads transactions once per message', () => {
    const readSpy = spyOn(queries, 'readAllTransactions').mockReturnValue([]);

    processTcTouchpoints(agentConfig(), [message({ messageId: 'msg-1' }), message({ messageId: 'msg-2' })]);

    expect(readSpy).toHaveBeenCalledTimes(2);
  });

  it('calls the accumulator once per CANDIDATE transaction, not once per message', () => {
    const t1 = { transactionId: 'txn-1' };
    const t2 = { transactionId: 'txn-2' };
    spyOn(queries, 'readAllTransactions').mockReturnValue([t1, t2]);
    const accSpy = spyOn(accumulator, 'accumulateObservedAddresses').mockReturnValue({ outcome: 'gate_not_met' });

    processTcTouchpoints(agentConfig(), [message()]);

    expect(accSpy).toHaveBeenCalledTimes(2);
    expect(accSpy.mock.calls[0][0]).toBe(t1);
    expect(accSpy.mock.calls[1][0]).toBe(t2);
  });

  // The cost this loop deliberately accepts: a message with no attachments
  // still triggers a read and still runs the accumulator against every
  // candidate. It must never reach the matcher, though -- matchAndFileAttachments
  // has nothing to do without an attachment.
  it('runs the accumulator for a message with no attachments, and never calls the matcher for it', () => {
    const t1 = { transactionId: 'txn-1' };
    spyOn(queries, 'readAllTransactions').mockReturnValue([t1]);
    const accSpy = spyOn(accumulator, 'accumulateObservedAddresses').mockReturnValue({ outcome: 'gate_not_met' });
    const matchSpy = spyOn(intake, 'matchAndFileAttachments');

    processTcTouchpoints(agentConfig(), [message({ hasAttachments: false })]);

    expect(accSpy).toHaveBeenCalledTimes(1);
    expect(matchSpy).not.toHaveBeenCalled();
  });

  it('calls the matcher with the SAME candidates array the accumulator just used when nothing was recorded, not a second read', () => {
    const candidates = [{ transactionId: 'txn-1' }];
    const readSpy = spyOn(queries, 'readAllTransactions').mockReturnValue(candidates);
    spyOn(accumulator, 'accumulateObservedAddresses').mockReturnValue({ outcome: 'gate_not_met' });
    const matchSpy = spyOn(intake, 'matchAndFileAttachments').mockReturnValue([]);
    const msg = message({ hasAttachments: true, attachmentInfo: [{ attachmentId: 'a1' }] });

    processTcTouchpoints(agentConfig(), [msg]);

    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(matchSpy).toHaveBeenCalledTimes(1);
    expect(matchSpy.mock.calls[0][2]).toBe(candidates);
  });

  // THE STALE CANDIDATES ARRAY: signal B reads observedAddresses, which the
  // accumulator can have just written. When any candidate's accumulation
  // outcome is 'recorded', the matcher must see a re-read, not the array
  // from before the write.
  it('re-reads candidates before calling the matcher when any accumulator call outcome is recorded', () => {
    const staleCandidates = [{ transactionId: 'txn-1', observedAddresses: {} }];
    const freshCandidates = [{ transactionId: 'txn-1', observedAddresses: { 'new@firm.com': {} } }];
    const readSpy = spyOn(queries, 'readAllTransactions')
      .mockReturnValueOnce(staleCandidates)
      .mockReturnValueOnce(freshCandidates);
    spyOn(accumulator, 'accumulateObservedAddresses').mockReturnValue({ outcome: 'recorded' });
    const matchSpy = spyOn(intake, 'matchAndFileAttachments').mockReturnValue([]);
    const msg = message({ hasAttachments: true, attachmentInfo: [{ attachmentId: 'a1' }] });

    processTcTouchpoints(agentConfig(), [msg]);

    expect(readSpy).toHaveBeenCalledTimes(2);
    expect(matchSpy).toHaveBeenCalledTimes(1);
    expect(matchSpy.mock.calls[0][2]).toBe(freshCandidates);
  });

  it('does not re-read when accumulation outcomes are nothing_to_collect', () => {
    const candidates = [{ transactionId: 'txn-1' }];
    const readSpy = spyOn(queries, 'readAllTransactions').mockReturnValue(candidates);
    spyOn(accumulator, 'accumulateObservedAddresses').mockReturnValue({ outcome: 'nothing_to_collect' });
    const matchSpy = spyOn(intake, 'matchAndFileAttachments').mockReturnValue([]);
    const msg = message({ hasAttachments: true, attachmentInfo: [{ attachmentId: 'a1' }] });

    processTcTouchpoints(agentConfig(), [msg]);

    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(matchSpy.mock.calls[0][2]).toBe(candidates);
  });

  // THE ORDER IS LOAD-BEARING (accumulator before matcher): proved with an
  // observable side effect -- the order each mock actually fired in -- not
  // just a call-count assertion, which a broken refactor could still pass.
  it('runs the accumulator before the matcher for the same message', () => {
    const order = [];
    spyOn(queries, 'readAllTransactions').mockReturnValue([{ transactionId: 'txn-1' }]);
    spyOn(accumulator, 'accumulateObservedAddresses').mockImplementation(() => {
      order.push('accumulator');
      return { outcome: 'gate_not_met' };
    });
    spyOn(intake, 'matchAndFileAttachments').mockImplementation(() => {
      order.push('matcher');
      return [];
    });

    processTcTouchpoints(agentConfig(), [message({ hasAttachments: true, attachmentInfo: [{ attachmentId: 'a1' }] })]);

    expect(order).toEqual(['accumulator', 'matcher']);
  });

  it('one candidate throwing during accumulation does not stop accumulation for the other candidates', () => {
    const t1 = { transactionId: 'txn-1' };
    const t2 = { transactionId: 'txn-2' };
    spyOn(queries, 'readAllTransactions').mockReturnValue([t1, t2]);
    const accSpy = spyOn(accumulator, 'accumulateObservedAddresses').mockImplementation((candidate) => {
      if (candidate === t1) throw new Error('boom');
      return { outcome: 'gate_not_met' };
    });

    expect(() => processTcTouchpoints(agentConfig(), [message()])).not.toThrow();
    expect(accSpy).toHaveBeenCalledTimes(2);
  });

  it('one candidate throwing during accumulation does not stop the matcher from running afterward', () => {
    spyOn(queries, 'readAllTransactions').mockReturnValue([{ transactionId: 'txn-1' }]);
    spyOn(accumulator, 'accumulateObservedAddresses').mockImplementation(() => { throw new Error('boom'); });
    const matchSpy = spyOn(intake, 'matchAndFileAttachments').mockReturnValue([]);

    processTcTouchpoints(agentConfig(), [message({ hasAttachments: true, attachmentInfo: [{ attachmentId: 'a1' }] })]);

    expect(matchSpy).toHaveBeenCalledTimes(1);
  });

  it('one message failing entirely (the read itself throws) does not stop processing of the next message', () => {
    const readSpy = spyOn(queries, 'readAllTransactions')
      .mockImplementationOnce(() => { throw new Error('read boom'); })
      .mockImplementationOnce(() => []);

    expect(() => {
      processTcTouchpoints(agentConfig(), [message({ messageId: 'msg-1' }), message({ messageId: 'msg-2' })]);
    }).not.toThrow();
    expect(readSpy).toHaveBeenCalledTimes(2);
  });

  // NOT placed in the pre-filter loop: this function does no filtering of
  // its own. A reply (In-Reply-To set, which applyPreFilter's Rule 1 would
  // drop before classification) still gets full accumulator treatment here,
  // proving this loop runs over every fetched message unconditionally, not
  // the pre-filtered subset the classification loop works from.
  it('runs the accumulator against a reply message, which the pre-filter loop would drop', () => {
    const t1 = { transactionId: 'txn-1' };
    spyOn(queries, 'readAllTransactions').mockReturnValue([t1]);
    const accSpy = spyOn(accumulator, 'accumulateObservedAddresses').mockReturnValue({ outcome: 'gate_not_met' });

    processTcTouchpoints(agentConfig(), [message({ inReplyTo: '<abc@firm.com>' })]);

    expect(accSpy).toHaveBeenCalledTimes(1);
  });
});

// Real modules, real filesystem, no mocks: proves the fix actually closes
// the gap, not just that the mocked call graph looks right.
describe('the stale candidates array fix, end to end', () => {
  function makeTmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'transactions-touchpoints-test-'));
  }

  let baseDir;
  beforeEach(() => { baseDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

  // signal D (confirmed filing on this thread) is what satisfies the
  // accumulator's gate AND what the matcher would use to match this
  // attachment anyway -- so `matched: true` alone does not prove signal B
  // was fresh, since D carries the match with or without this fix.
  // signals.B is the assertion that actually distinguishes stale from
  // fresh: it can only be true if the matcher saw the address the
  // accumulator had JUST written to observedAddresses moments earlier, in
  // this same message's iteration.
  it('a message whose address the accumulator just learned is what the matcher needs for signal B, in the same iteration', () => {
    const created = createTransaction(
      AGENT_ID,
      {
        type: 'buyer_purchase',
        state: 'conditional',
        address: '12 Main St',
        filings: { f1: { threadId: THREAD_ID, status: 'filed', review: 'confirmed' } },
      },
      { baseDir, now: CLOCK }
    );

    const msg = {
      messageId: 'msg-1',
      threadId: THREAD_ID,
      subject: '',
      body: '',
      from: 'Jane <jane@firm.com>',
      to: [{ address: 'newparty@firm.com' }],
      cc: [],
      hasAttachments: true,
      attachmentInfo: [{ filename: 'contract.pdf', mimeType: 'application/pdf', size: 100, attachmentId: 'att-1' }],
      receivedAt: '2026-07-16T08:00:00.000Z',
    };

    const results = processTcTouchpoints(agentConfig(), [msg], { at: AT, actor: 'system', baseDir, now: LATER });

    expect(results[0].matchResults).toHaveLength(1);
    expect(results[0].matchResults[0].matched).toBe(true);
    expect(results[0].matchResults[0].signals.B).toBe(true);

    const reread = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(reread.observedAddresses['newparty@firm.com']).toBeDefined();
  });
});
