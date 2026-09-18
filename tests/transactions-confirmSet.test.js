'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

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
const {
  createProposalSet,
  rejectProposalMember,
  buildSetDiscard,
} = require('../src/transactions/proposals');
const { isParticipantId } = require('../src/transactions/participants');

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');
const LATER = new Date('2026-07-16T09:30:00.000Z');
const EVEN_LATER = new Date('2026-07-17T08:00:00.000Z');
const YET_LATER = new Date('2026-07-18T08:00:00.000Z');
const CONFIRM_NOW = new Date('2026-07-19T08:00:00.000Z');
const CONFIRM_AT = CONFIRM_NOW.toISOString();

const MESSAGE_ID = 'msg-abc123';
const ATTACHMENT_ID = 'att-def456';
const THREAD_ID = 'thread-xyz789';

const MEMBER_A = {
  roles: ['client'],
  name: 'Jane Smith',
  emails: [{ address: 'jane@example.com', from: 'document', scope: 'personal' }],
};
const MEMBER_B = { roles: ['co_client'], name: 'John Smith' };
const MEMBER_C = { roles: ['opposing_party'], name: 'Bob Jones' };

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transactions-confirmSet-test-'));
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

describe('confirmProposalSet: happy path', () => {
  it('confirms pending members, leaves the rejected one alone, confirms the filing and the set, one write, one shared at', () => {
    const filed = createFiledTransaction();
    const { setId, memberIds } = createSet([MEMBER_A, MEMBER_B, MEMBER_C], filed.transactionId);
    rejectProposalMember(AGENT_ID, filed.transactionId, setId, memberIds[2], { at: '2026-07-18T08:00:00.000Z', actor: 'agent', baseDir, now: YET_LATER });

    const beforeTxn = readTransaction(AGENT_ID, filed.transactionId, { baseDir });
    const eventCountBefore = beforeTxn.events.length;

    const result = confirmProposalSet(AGENT_ID, filed.transactionId, setId, { baseDir, now: CONFIRM_NOW });

    expect(result.outcome).toBe('confirmed');
    expect(result.filingConfirmed).toBe(true);
    expect(Object.keys(result.participantIds).sort()).toEqual([memberIds[0], memberIds[1]].sort());
    expect(isParticipantId(result.participantIds[memberIds[0]])).toBe(true);
    expect(isParticipantId(result.participantIds[memberIds[1]])).toBe(true);
    expect(result.participantIds[memberIds[0]]).not.toBe(result.participantIds[memberIds[1]]);

    const finalTxn = readTransaction(AGENT_ID, filed.transactionId, { baseDir });

    const set = finalTxn.participantProposals[setId];
    expect(set.status).toBe('confirmed');
    expect(set.members[memberIds[0]].status).toBe('confirmed');
    expect(set.members[memberIds[0]].participantId).toBe(result.participantIds[memberIds[0]]);
    expect(set.members[memberIds[1]].status).toBe('confirmed');
    expect(set.members[memberIds[1]].participantId).toBe(result.participantIds[memberIds[1]]);
    // The rejected member is untouched by the confirm.
    expect(set.members[memberIds[2]]).toEqual(beforeTxn.participantProposals[setId].members[memberIds[2]]);
    // from/scope stay on the proposal record; only the built participant loses them.
    expect(set.members[memberIds[0]].emails).toEqual(MEMBER_A.emails);

    const participantA = finalTxn.participants[result.participantIds[memberIds[0]]];
    expect(participantA).toEqual({ roles: ['client'], name: 'Jane Smith', emails: ['jane@example.com'] });
    const participantB = finalTxn.participants[result.participantIds[memberIds[1]]];
    expect(participantB).toEqual({ roles: ['co_client'], name: 'John Smith' });

    const filingKey = buildFilingKey(MESSAGE_ID, ATTACHMENT_ID);
    expect(finalTxn.filings[filingKey].review).toBe('confirmed');

    const newEvents = finalTxn.events.slice(eventCountBefore);
    expect(newEvents).toHaveLength(4);
    newEvents.forEach((event) => expect(event.at).toBe(CONFIRM_AT));
    expect(newEvents.map((e) => e.kind).sort()).toEqual(
      ['document_confirmed', 'participant_added', 'participant_added', 'proposal_set_confirmed'].sort()
    );
    expect(newEvents[newEvents.length - 1].kind).toBe('proposal_set_confirmed');
    expect(newEvents[0].kind).toBe('document_confirmed');
  });

  it('writes exactly once', () => {
    const filed = createFiledTransaction();
    const { setId } = createSet([MEMBER_A, MEMBER_B], filed.transactionId);
    const writeSpy = jest.spyOn(store, 'writeTransaction');

    confirmProposalSet(AGENT_ID, filed.transactionId, setId, { baseDir, now: CONFIRM_NOW });

    expect(writeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('confirmProposalSet: filing review branches', () => {
  it('filing already confirmed: participants created, set confirmed, filingConfirmed false, no second document_confirmed event', () => {
    const filed = createFiledTransaction();
    confirmFiling(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, { at: '2026-07-17T09:00:00.000Z', actor: 'agent', baseDir, now: YET_LATER });
    const { setId, memberIds } = createSet([MEMBER_A, MEMBER_B], filed.transactionId);

    const result = confirmProposalSet(AGENT_ID, filed.transactionId, setId, { baseDir, now: CONFIRM_NOW });

    expect(result.outcome).toBe('confirmed');
    expect(result.filingConfirmed).toBe(false);
    expect(Object.keys(result.participantIds).sort()).toEqual(memberIds.sort());

    const finalTxn = readTransaction(AGENT_ID, filed.transactionId, { baseDir });
    const filingKey = buildFilingKey(MESSAGE_ID, ATTACHMENT_ID);
    expect(finalTxn.filings[filingKey].review).toBe('confirmed');
    const confirmedEvents = finalTxn.events.filter((e) => e.kind === 'document_confirmed');
    expect(confirmedEvents).toHaveLength(1);
    expect(Object.keys(finalTxn.participants)).toHaveLength(2);
  });

  it('filing rejected: filing_rejected, file on disk byte-identical', () => {
    const filed = createFiledTransaction();
    const { setId } = createSet([MEMBER_A, MEMBER_B], filed.transactionId);
    rejectFiling(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, { at: '2026-07-17T09:00:00.000Z', actor: 'agent', baseDir, now: YET_LATER });

    const filePath = store._internal.transactionPath(baseDir, AGENT_ID, filed.transactionId);
    const before = fs.readFileSync(filePath, 'utf8');

    const result = confirmProposalSet(AGENT_ID, filed.transactionId, setId, { baseDir, now: CONFIRM_NOW });

    expect(result).toEqual({ outcome: 'filing_rejected' });
    const after = fs.readFileSync(filePath, 'utf8');
    expect(after).toBe(before);
  });
});

describe('confirmProposalSet: set-status branches', () => {
  it('set already confirmed (fixture): already_confirmed, no write', () => {
    const filed = createFiledTransaction();
    const { setId } = createSet([MEMBER_A], filed.transactionId);
    const previous = readTransaction(AGENT_ID, filed.transactionId, { baseDir });
    const forcedConfirmed = { ...previous.participantProposals[setId], status: 'confirmed' };
    const withConfirmedSet = { ...previous, participantProposals: { ...previous.participantProposals, [setId]: forcedConfirmed } };
    store.writeTransaction(AGENT_ID, withConfirmedSet, { baseDir, now: YET_LATER });
    const writeSpy = jest.spyOn(store, 'writeTransaction');

    const result = confirmProposalSet(AGENT_ID, filed.transactionId, setId, { baseDir, now: CONFIRM_NOW });

    expect(result).toEqual({ outcome: 'already_confirmed' });
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('set discarded: set_discarded, no write', () => {
    const filed = createFiledTransaction();
    const { setId } = createSet([MEMBER_A], filed.transactionId);
    const previous = readTransaction(AGENT_ID, filed.transactionId, { baseDir });
    const discardResult = buildSetDiscard(previous, { transactionId: filed.transactionId, setId, at: '2026-07-17T09:00:00.000Z', actor: 'agent' });
    store.writeTransaction(AGENT_ID, discardResult.transaction, { baseDir, now: YET_LATER });
    const writeSpy = jest.spyOn(store, 'writeTransaction');

    const result = confirmProposalSet(AGENT_ID, filed.transactionId, setId, { baseDir, now: CONFIRM_NOW });

    expect(result).toEqual({ outcome: 'set_discarded' });
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('set not found: set_not_found, no write', () => {
    const filed = createFiledTransaction();
    const writeSpy = jest.spyOn(store, 'writeTransaction');

    const result = confirmProposalSet(AGENT_ID, filed.transactionId, 'pps-ffffffff', { baseDir, now: CONFIRM_NOW });

    expect(result).toEqual({ outcome: 'set_not_found' });
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('the status check runs before anything is built: a discarded set with a member carrying invalid data still returns set_discarded, not a validation throw', () => {
    const filingKey = buildFilingKey(MESSAGE_ID, ATTACHMENT_ID);
    const created = createTransaction(AGENT_ID, {
      type: 'buyer_purchase', state: 'conditional', address: '12 Main St',
    }, { baseDir, now: CLOCK });
    const setId = 'pps-77777777';
    const rawTransaction = {
      ...created,
      filings: {
        [filingKey]: {
          messageId: MESSAGE_ID, attachmentId: ATTACHMENT_ID, filename: 'agreement.pdf', mimeType: 'application/pdf',
          size: 2048, threadId: THREAD_ID, sender: 'Lawyer <lawyer@firm.com>', receivedAt: '2026-07-16T09:00:00.000Z',
          subject: 'Purchase Agreement', status: 'filed', review: 'needs_review', seenAt: '2026-07-16T09:30:00.000Z', attempts: 0,
          driveFileId: 'drive-xyz', contentHash: 'sha256:deadbeef',
        },
      },
      participantProposals: {
        [setId]: {
          status: 'discarded',
          createdAt: '2026-07-17T08:00:00.000Z',
          actor: 'system',
          source: { kind: 'document', filingKey, contentHash: 'sha256:deadbeef', filename: 'agreement.pdf', receivedAt: '2026-07-16T09:00:00.000Z' },
          members: { 'ppm-55555555': { roles: ['not-a-real-role'], name: 'Bad Data', status: 'pending' } },
        },
      },
    };
    store.writeTransaction(AGENT_ID, rawTransaction, { baseDir, now: EVEN_LATER });
    const writeSpy = jest.spyOn(store, 'writeTransaction');

    const result = confirmProposalSet(AGENT_ID, created.transactionId, setId, { baseDir, now: CONFIRM_NOW });

    expect(result).toEqual({ outcome: 'set_discarded' });
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('transaction not found: transaction_not_found, no write', () => {
    const writeSpy = jest.spyOn(store, 'writeTransaction');

    const result = confirmProposalSet(AGENT_ID, 'txn-20260101-deadbeef', 'pps-ffffffff', { baseDir, now: CONFIRM_NOW });

    expect(result).toEqual({ outcome: 'transaction_not_found' });
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

describe('confirmProposalSet: all members rejected', () => {
  it('filing confirmed, zero participants created, set confirmed with participantIds {}', () => {
    const filed = createFiledTransaction();
    const { setId, memberIds } = createSet([MEMBER_A, MEMBER_B], filed.transactionId);
    rejectProposalMember(AGENT_ID, filed.transactionId, setId, memberIds[0], { at: '2026-07-18T08:00:00.000Z', actor: 'agent', baseDir, now: YET_LATER });
    rejectProposalMember(AGENT_ID, filed.transactionId, setId, memberIds[1], { at: '2026-07-18T08:00:00.000Z', actor: 'agent', baseDir, now: YET_LATER });

    const result = confirmProposalSet(AGENT_ID, filed.transactionId, setId, { baseDir, now: CONFIRM_NOW });

    expect(result.outcome).toBe('confirmed');
    expect(result.filingConfirmed).toBe(true);
    expect(result.participantIds).toEqual({});

    const finalTxn = readTransaction(AGENT_ID, filed.transactionId, { baseDir });
    expect(finalTxn.participantProposals[setId].status).toBe('confirmed');
    expect(finalTxn.participants || {}).toEqual({});
  });
});

describe('confirmProposalSet: double tap', () => {
  it('second call returns already_confirmed and the participant count is unchanged', () => {
    const filed = createFiledTransaction();
    const { setId } = createSet([MEMBER_A, MEMBER_B], filed.transactionId);

    const first = confirmProposalSet(AGENT_ID, filed.transactionId, setId, { baseDir, now: CONFIRM_NOW });
    expect(first.outcome).toBe('confirmed');
    const participantCountAfterFirst = Object.keys(readTransaction(AGENT_ID, filed.transactionId, { baseDir }).participants).length;

    const second = confirmProposalSet(AGENT_ID, filed.transactionId, setId, { baseDir, now: YET_LATER });

    expect(second).toEqual({ outcome: 'already_confirmed' });
    const participantCountAfterSecond = Object.keys(readTransaction(AGENT_ID, filed.transactionId, { baseDir }).participants).length;
    expect(participantCountAfterSecond).toBe(participantCountAfterFirst);
  });
});

describe('confirmProposalSet: atomicity', () => {
  it('throws when a pending member carries an invalid role, and writes nothing', () => {
    const filingKey = buildFilingKey(MESSAGE_ID, ATTACHMENT_ID);
    const created = createTransaction(AGENT_ID, {
      type: 'buyer_purchase', state: 'conditional', address: '12 Main St',
    }, { baseDir, now: CLOCK });
    const setId = 'pps-99999999';
    const rawTransaction = {
      ...created,
      filings: {
        [filingKey]: {
          messageId: MESSAGE_ID, attachmentId: ATTACHMENT_ID, filename: 'agreement.pdf', mimeType: 'application/pdf',
          size: 2048, threadId: THREAD_ID, sender: 'Lawyer <lawyer@firm.com>', receivedAt: '2026-07-16T09:00:00.000Z',
          subject: 'Purchase Agreement', status: 'filed', review: 'needs_review', seenAt: '2026-07-16T09:30:00.000Z', attempts: 0,
          driveFileId: 'drive-xyz', contentHash: 'sha256:deadbeef',
        },
      },
      participantProposals: {
        [setId]: {
          status: 'open',
          createdAt: '2026-07-17T08:00:00.000Z',
          actor: 'system',
          source: { kind: 'document', filingKey, contentHash: 'sha256:deadbeef', filename: 'agreement.pdf', receivedAt: '2026-07-16T09:00:00.000Z' },
          members: {
            'ppm-11111111': { roles: ['client'], name: 'Alice Valid', status: 'pending' },
            'ppm-22222222': { roles: ['not-a-real-role'], name: 'Bob Invalid', status: 'pending' },
          },
        },
      },
    };
    store.writeTransaction(AGENT_ID, rawTransaction, { baseDir, now: EVEN_LATER });

    const filePath = store._internal.transactionPath(baseDir, AGENT_ID, created.transactionId);
    const before = fs.readFileSync(filePath, 'utf8');

    expect(() => confirmProposalSet(AGENT_ID, created.transactionId, setId, { baseDir, now: CONFIRM_NOW })).toThrow();

    const after = fs.readFileSync(filePath, 'utf8');
    expect(after).toBe(before);
    const finalTxn = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(finalTxn.participants || {}).toEqual({});
    expect(finalTxn.filings[filingKey].review).toBe('needs_review');
  });

  it('missing filing behind an existing set throws with the exact message', () => {
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

    expect(() => confirmProposalSet(AGENT_ID, created.transactionId, setId, { baseDir, now: CONFIRM_NOW }))
      .toThrow(`confirmProposalSet: set ${setId} references filing ${JSON.stringify(missingFilingKey)} which does not exist on transaction ${created.transactionId}`);
  });
});
