'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { markWrongDeal } = require('../src/transactions/wrongDeal');
const { confirmProposalSet } = require('../src/transactions/confirmSet');
const store = require('../src/transactions/store');
const { createTransaction, readTransaction } = store;
const {
  recordDocumentSeen,
  recordDocumentFiled,
  confirmFiling,
  rejectFiling,
  buildFilingKey,
} = require('../src/transactions/filings');
const proposals = require('../src/transactions/proposals');
const { createProposalSet } = proposals;

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');
const LATER = new Date('2026-07-16T09:30:00.000Z');
const EVEN_LATER = new Date('2026-07-17T08:00:00.000Z');
const YET_LATER = new Date('2026-07-18T08:00:00.000Z');
const WRONG_DEAL_NOW = new Date('2026-07-19T08:00:00.000Z');
const WRONG_DEAL_AT = WRONG_DEAL_NOW.toISOString();

const MESSAGE_ID = 'msg-abc123';
const ATTACHMENT_ID = 'att-def456';
const THREAD_ID = 'thread-xyz789';

const MEMBER_A = { roles: ['client'], name: 'Jane Smith' };
const MEMBER_B = { roles: ['co_client'], name: 'John Smith' };

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transactions-wrongDeal-test-'));
}

let baseDir;

beforeEach(() => { baseDir = makeTmpDir(); });
afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });
afterEach(() => jest.restoreAllMocks());

function create(type = 'buyer_purchase', state = 'conditional') {
  return createTransaction(AGENT_ID, { type, state, address: '12 Main St' }, { baseDir, now: CLOCK });
}

function seeDocument(transactionId, messageId, attachmentId, opts = {}) {
  return recordDocumentSeen(AGENT_ID, transactionId, messageId, attachmentId, {
    at: '2026-07-16T09:30:00.000Z',
    actor: 'system',
    filename: 'agreement.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    threadId: THREAD_ID,
    sender: 'Lawyer <lawyer@firm.com>',
    receivedAt: '2026-07-16T09:00:00.000Z',
    subject: 'Purchase Agreement',
    baseDir,
    now: LATER,
    ...opts,
  });
}

function fileDocument(transactionId, messageId, attachmentId, opts = {}) {
  return recordDocumentFiled(AGENT_ID, transactionId, messageId, attachmentId, {
    at: '2026-07-17T08:00:00.000Z',
    actor: 'system',
    driveFileId: 'drive-xyz',
    contentHash: 'sha256:deadbeef',
    baseDir,
    now: EVEN_LATER,
    ...opts,
  });
}

function createFiledTransaction(messageId = MESSAGE_ID, attachmentId = ATTACHMENT_ID, opts = {}) {
  const created = create();
  seeDocument(created.transactionId, messageId, attachmentId);
  return fileDocument(created.transactionId, messageId, attachmentId, opts);
}

function createSet(members, transactionId, messageId = MESSAGE_ID, attachmentId = ATTACHMENT_ID) {
  const result = createProposalSet(AGENT_ID, transactionId, messageId, attachmentId, members, {
    at: '2026-07-17T08:00:00.000Z', actor: 'system', baseDir, now: EVEN_LATER,
  });
  const memberIds = Object.keys(result.transaction.participantProposals[result.setId].members);
  return { setId: result.setId, memberIds };
}

describe('markWrongDeal: happy path', () => {
  it('rejects the filing, discards the set, touches no members, creates no participants, one shared at', () => {
    const filed = createFiledTransaction();
    const { setId, memberIds } = createSet([MEMBER_A, MEMBER_B], filed.transactionId);
    const beforeTxn = readTransaction(AGENT_ID, filed.transactionId, { baseDir });
    const eventCountBefore = beforeTxn.events.length;

    const result = markWrongDeal(AGENT_ID, filed.transactionId, setId, { baseDir, now: WRONG_DEAL_NOW });

    expect(result).toEqual({ outcome: 'wrong_deal_recorded', filingRejected: true });

    const finalTxn = readTransaction(AGENT_ID, filed.transactionId, { baseDir });
    const set = finalTxn.participantProposals[setId];
    expect(set.status).toBe('discarded');
    expect(set.members).toEqual(beforeTxn.participantProposals[setId].members);
    memberIds.forEach((memberId) => {
      expect(set.members[memberId].status).toBe('pending');
      expect(set.members[memberId].participantId).toBeUndefined();
    });
    expect(finalTxn.participants || {}).toEqual({});

    const filingKey = buildFilingKey(MESSAGE_ID, ATTACHMENT_ID);
    expect(finalTxn.filings[filingKey].review).toBe('rejected');

    const newEvents = finalTxn.events.slice(eventCountBefore);
    expect(newEvents).toHaveLength(2);
    newEvents.forEach((event) => expect(event.at).toBe(WRONG_DEAL_AT));
    expect(newEvents.map((e) => e.kind).sort()).toEqual(['document_rejected', 'proposal_set_discarded'].sort());
  });

  it('writes exactly once', () => {
    const filed = createFiledTransaction();
    const { setId } = createSet([MEMBER_A], filed.transactionId);
    const writeSpy = jest.spyOn(store, 'writeTransaction');

    markWrongDeal(AGENT_ID, filed.transactionId, setId, { baseDir, now: WRONG_DEAL_NOW });

    expect(writeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('markWrongDeal: filing review branches', () => {
  it('filing already rejected: set discarded, filingRejected false, no second document_rejected event', () => {
    const filed = createFiledTransaction();
    const { setId } = createSet([MEMBER_A, MEMBER_B], filed.transactionId);
    rejectFiling(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, { at: '2026-07-17T09:00:00.000Z', actor: 'agent', baseDir, now: YET_LATER });

    const result = markWrongDeal(AGENT_ID, filed.transactionId, setId, { baseDir, now: WRONG_DEAL_NOW });

    expect(result).toEqual({ outcome: 'wrong_deal_recorded', filingRejected: false });

    const finalTxn = readTransaction(AGENT_ID, filed.transactionId, { baseDir });
    expect(finalTxn.participantProposals[setId].status).toBe('discarded');
    const filingKey = buildFilingKey(MESSAGE_ID, ATTACHMENT_ID);
    expect(finalTxn.filings[filingKey].review).toBe('rejected');
    const rejectedEvents = finalTxn.events.filter((e) => e.kind === 'document_rejected');
    expect(rejectedEvents).toHaveLength(1);
  });

  it('filing confirmed: filing_confirmed, file on disk byte-identical', () => {
    const filed = createFiledTransaction();
    const { setId } = createSet([MEMBER_A, MEMBER_B], filed.transactionId);
    confirmFiling(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, { at: '2026-07-17T09:00:00.000Z', actor: 'agent', baseDir, now: YET_LATER });

    const filePath = store._internal.transactionPath(baseDir, AGENT_ID, filed.transactionId);
    const before = fs.readFileSync(filePath, 'utf8');

    const result = markWrongDeal(AGENT_ID, filed.transactionId, setId, { baseDir, now: WRONG_DEAL_NOW });

    expect(result).toEqual({ outcome: 'filing_confirmed' });
    const after = fs.readFileSync(filePath, 'utf8');
    expect(after).toBe(before);
  });
});

describe('markWrongDeal: set-status branches', () => {
  it('set confirmed (built through confirmProposalSet): set_confirmed, file byte-identical, participant count unchanged', () => {
    const filed = createFiledTransaction();
    const { setId } = createSet([MEMBER_A, MEMBER_B], filed.transactionId);
    const confirmResult = confirmProposalSet(AGENT_ID, filed.transactionId, setId, { baseDir, now: YET_LATER });
    expect(confirmResult.outcome).toBe('confirmed');
    const participantCountBefore = Object.keys(readTransaction(AGENT_ID, filed.transactionId, { baseDir }).participants).length;

    const filePath = store._internal.transactionPath(baseDir, AGENT_ID, filed.transactionId);
    const before = fs.readFileSync(filePath, 'utf8');

    const result = markWrongDeal(AGENT_ID, filed.transactionId, setId, { baseDir, now: WRONG_DEAL_NOW });

    expect(result).toEqual({ outcome: 'set_confirmed' });
    const after = fs.readFileSync(filePath, 'utf8');
    expect(after).toBe(before);
    const participantCountAfter = Object.keys(readTransaction(AGENT_ID, filed.transactionId, { baseDir }).participants).length;
    expect(participantCountAfter).toBe(participantCountBefore);
  });

  it('ORDERING: a confirmed set whose filing is also confirmed returns set_confirmed, not filing_confirmed', () => {
    const filed = createFiledTransaction();
    const { setId } = createSet([MEMBER_A], filed.transactionId);
    const confirmResult = confirmProposalSet(AGENT_ID, filed.transactionId, setId, { baseDir, now: YET_LATER });
    expect(confirmResult.outcome).toBe('confirmed');
    // Both conditions hold simultaneously: confirmProposalSet leaves the
    // filing at review 'confirmed' AND the set at status 'confirmed'.
    const preCheckTxn = readTransaction(AGENT_ID, filed.transactionId, { baseDir });
    const filingKey = buildFilingKey(MESSAGE_ID, ATTACHMENT_ID);
    expect(preCheckTxn.filings[filingKey].review).toBe('confirmed');
    expect(preCheckTxn.participantProposals[setId].status).toBe('confirmed');

    const result = markWrongDeal(AGENT_ID, filed.transactionId, setId, { baseDir, now: WRONG_DEAL_NOW });

    expect(result).toEqual({ outcome: 'set_confirmed' });
  });

  it('set not found: set_not_found, no write', () => {
    const filed = createFiledTransaction();
    const writeSpy = jest.spyOn(store, 'writeTransaction');

    const result = markWrongDeal(AGENT_ID, filed.transactionId, 'pps-ffffffff', { baseDir, now: WRONG_DEAL_NOW });

    expect(result).toEqual({ outcome: 'set_not_found' });
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('transaction not found: transaction_not_found, no write', () => {
    const writeSpy = jest.spyOn(store, 'writeTransaction');

    const result = markWrongDeal(AGENT_ID, 'txn-20260101-deadbeef', 'pps-ffffffff', { baseDir, now: WRONG_DEAL_NOW });

    expect(result).toEqual({ outcome: 'transaction_not_found' });
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

describe('markWrongDeal: double tap', () => {
  it('second call returns already_discarded, no write', () => {
    const filed = createFiledTransaction();
    const { setId } = createSet([MEMBER_A, MEMBER_B], filed.transactionId);
    const first = markWrongDeal(AGENT_ID, filed.transactionId, setId, { baseDir, now: WRONG_DEAL_NOW });
    expect(first.outcome).toBe('wrong_deal_recorded');

    const writeSpy = jest.spyOn(store, 'writeTransaction');
    const second = markWrongDeal(AGENT_ID, filed.transactionId, setId, { baseDir, now: YET_LATER });

    expect(second).toEqual({ outcome: 'already_discarded' });
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

describe('markWrongDeal: missing filing', () => {
  it('missing filing behind an existing set throws the exact message', () => {
    const created = createTransaction(AGENT_ID, {
      type: 'buyer_purchase', state: 'conditional', address: '12 Main St',
    }, { baseDir, now: CLOCK });
    const setId = 'pps-88888888';
    const missingFilingKey = buildFilingKey('msg-missing', 'att-missing');
    const rawTransaction = {
      ...created,
      participantProposals: {
        [setId]: {
          status: 'open',
          createdAt: '2026-07-17T08:00:00.000Z',
          actor: 'system',
          source: { kind: 'document', filingKey: missingFilingKey, contentHash: 'sha256:deadbeef', filename: 'agreement.pdf', receivedAt: '2026-07-16T09:00:00.000Z' },
          members: { 'ppm-33333333': { roles: ['client'], name: 'Alice', status: 'pending' } },
        },
      },
    };
    store.writeTransaction(AGENT_ID, rawTransaction, { baseDir, now: EVEN_LATER });

    expect(() => markWrongDeal(AGENT_ID, created.transactionId, setId, { baseDir, now: WRONG_DEAL_NOW }))
      .toThrow(`markWrongDeal: set ${setId} references filing ${JSON.stringify(missingFilingKey)} which does not exist on transaction ${created.transactionId}`);
  });
});

describe('markWrongDeal: atomicity', () => {
  it('when buildSetDiscard throws, markWrongDeal throws and writes nothing; the filing is still needs_review', () => {
    const filed = createFiledTransaction();
    const { setId } = createSet([MEMBER_A, MEMBER_B], filed.transactionId);

    const filePath = store._internal.transactionPath(baseDir, AGENT_ID, filed.transactionId);
    const before = fs.readFileSync(filePath, 'utf8');

    jest.spyOn(proposals, 'buildSetDiscard').mockImplementation(() => {
      throw new Error('boom');
    });

    expect(() => markWrongDeal(AGENT_ID, filed.transactionId, setId, { baseDir, now: WRONG_DEAL_NOW })).toThrow('boom');

    const after = fs.readFileSync(filePath, 'utf8');
    expect(after).toBe(before);
    const finalTxn = readTransaction(AGENT_ID, filed.transactionId, { baseDir });
    const filingKey = buildFilingKey(MESSAGE_ID, ATTACHMENT_ID);
    expect(finalTxn.filings[filingKey].review).toBe('needs_review');
  });
});
