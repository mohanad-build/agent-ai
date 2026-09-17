'use strict';

const crypto = require('node:crypto');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const {
  PROPOSAL_SET_STATUSES,
  PROPOSAL_MEMBER_STATUSES,
  PROPOSAL_SOURCE_KINDS,
  EMAIL_SCOPES,
  EMAIL_SOURCES,
  buildProposalSet,
  createProposalSet,
  buildMemberRejection,
  rejectProposalMember,
  buildSetConfirmation,
  buildSetDiscard,
} = require('../src/transactions/proposals');
const { PROPOSAL_SET_ID_RE, PROPOSAL_MEMBER_ID_RE } = require('../src/transactions/proposals')._internal;
const store = require('../src/transactions/store');
const { createTransaction, readTransaction } = store;
const {
  recordDocumentSeen,
  recordDocumentFiled,
  abandonDocumentFiling,
  confirmFiling,
  rejectFiling,
  buildFilingKey,
} = require('../src/transactions/filings');

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');
const LATER = new Date('2026-07-16T09:30:00.000Z');
const EVEN_LATER = new Date('2026-07-17T08:00:00.000Z');
const YET_LATER = new Date('2026-07-18T08:00:00.000Z');
const AT = '2026-07-16T09:30:00.000Z';
const AT2 = '2026-07-17T08:00:00.000Z';
const AT3 = '2026-07-18T08:00:00.000Z';

const MESSAGE_ID = 'msg-abc123';
const ATTACHMENT_ID = 'att-def456';
const MESSAGE_ID_2 = 'msg-second789';
const ATTACHMENT_ID_2 = 'att-second012';
const THREAD_ID = 'thread-xyz789';

const VALID_MEMBER = { roles: ['client'], name: 'Jane Smith' };

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transactions-proposals-test-'));
}

let baseDir;

beforeEach(() => { baseDir = makeTmpDir(); });
afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

function create(type = 'buyer_purchase', state = 'conditional') {
  return createTransaction(AGENT_ID, { type, state, address: '12 Main St' }, { baseDir, now: CLOCK });
}

// Follows transactions-filings.test.js's own seeDocument/file helper
// pattern, parameterized on messageId/attachmentId so a test can put a
// second, distinct filing on the same transaction.
function seeDocument(transactionId, messageId, attachmentId, opts = {}) {
  return recordDocumentSeen(AGENT_ID, transactionId, messageId, attachmentId, {
    at: AT,
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
    at: AT2,
    actor: 'system',
    driveFileId: 'drive-xyz',
    contentHash: 'sha256:deadbeef',
    baseDir,
    now: EVEN_LATER,
    ...opts,
  });
}

// A transaction with one filing already at status 'filed', ready for
// createProposalSet.
function createFiledTransaction(messageId = MESSAGE_ID, attachmentId = ATTACHMENT_ID, opts = {}) {
  const created = create();
  seeDocument(created.transactionId, messageId, attachmentId);
  return fileDocument(created.transactionId, messageId, attachmentId, opts);
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.getOwnPropertyNames(value).forEach((key) => deepFreeze(value[key]));
    Object.freeze(value);
  }
  return value;
}

describe('constants', () => {
  it('PROPOSAL_SET_STATUSES is exactly open, confirmed, discarded, and is frozen', () => {
    expect(PROPOSAL_SET_STATUSES).toEqual(['open', 'confirmed', 'discarded']);
    expect(Object.isFrozen(PROPOSAL_SET_STATUSES)).toBe(true);
  });

  it('PROPOSAL_MEMBER_STATUSES is exactly pending, rejected, and is frozen', () => {
    expect(PROPOSAL_MEMBER_STATUSES).toEqual(['pending', 'rejected']);
    expect(Object.isFrozen(PROPOSAL_MEMBER_STATUSES)).toBe(true);
  });

  it('PROPOSAL_SOURCE_KINDS is exactly document, and is frozen', () => {
    expect(PROPOSAL_SOURCE_KINDS).toEqual(['document']);
    expect(Object.isFrozen(PROPOSAL_SOURCE_KINDS)).toBe(true);
  });

  it('EMAIL_SCOPES is exactly personal, organizational, and is frozen', () => {
    expect(EMAIL_SCOPES).toEqual(['personal', 'organizational']);
    expect(Object.isFrozen(EMAIL_SCOPES)).toBe(true);
  });

  it('EMAIL_SOURCES is exactly document, message, lead_sheet, and is frozen', () => {
    expect(EMAIL_SOURCES).toEqual(['document', 'message', 'lead_sheet']);
    expect(Object.isFrozen(EMAIL_SOURCES)).toBe(true);
  });
});

describe('createProposalSet', () => {
  it('creates a set with the exact stored shape, ids matching regexes, one event, participants absent, member order preserved', () => {
    const filed = createFiledTransaction();
    const members = [
      { roles: ['client'], name: 'Jane Smith', emails: [{ address: 'jane@example.com', scope: 'personal', from: 'document' }] },
      { roles: ['co_client'], name: 'John Smith' },
    ];

    const result = createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, members, {
      at: AT3, actor: 'system', baseDir, now: YET_LATER,
    });

    expect(result.outcome).toBe('created');
    const { transaction, setId } = result;
    expect(setId).toMatch(PROPOSAL_SET_ID_RE);

    const set = transaction.participantProposals[setId];
    const memberIds = Object.keys(set.members);
    expect(memberIds).toHaveLength(2);
    memberIds.forEach((id) => expect(id).toMatch(PROPOSAL_MEMBER_ID_RE));

    const filingKey = buildFilingKey(MESSAGE_ID, ATTACHMENT_ID);
    expect(set).toEqual({
      status: 'open',
      createdAt: AT3,
      actor: 'system',
      source: {
        kind: 'document',
        filingKey,
        contentHash: 'sha256:deadbeef',
        filename: 'agreement.pdf',
        receivedAt: '2026-07-16T09:00:00.000Z',
      },
      members: {
        [memberIds[0]]: {
          roles: ['client'],
          name: 'Jane Smith',
          emails: [{ address: 'jane@example.com', scope: 'personal', from: 'document' }],
          status: 'pending',
        },
        [memberIds[1]]: { roles: ['co_client'], name: 'John Smith', status: 'pending' },
      },
    });

    // Member order preserved: the first generated id is the first input member.
    expect(set.members[memberIds[0]].name).toBe('Jane Smith');
    expect(set.members[memberIds[1]].name).toBe('John Smith');

    expect('participants' in transaction).toBe(false);

    const addedEvents = transaction.events.filter((e) => e.kind === 'proposal_set_created');
    expect(addedEvents).toHaveLength(1);
    expect(addedEvents[0]).toMatchObject({
      at: AT3,
      actor: 'system',
      kind: 'proposal_set_created',
      payload: { setId, filingKey, memberIds },
    });
  });

  it('actor must be system: agent throws', () => {
    const filed = createFiledTransaction();
    expect(() => createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [VALID_MEMBER], { at: AT3, actor: 'agent', baseDir, now: YET_LATER }))
      .toThrow("buildProposalSet: actor must be 'system'");
  });

  it('actor must be system: operator throws', () => {
    const filed = createFiledTransaction();
    expect(() => createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [VALID_MEMBER], { at: AT3, actor: 'operator', baseDir, now: YET_LATER }))
      .toThrow("buildProposalSet: actor must be 'system'");
  });

  it('a missing filing throws', () => {
    const created = create();
    const filingKey = buildFilingKey(MESSAGE_ID, ATTACHMENT_ID);
    expect(() => createProposalSet(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, [VALID_MEMBER], { at: AT, actor: 'system', baseDir, now: LATER }))
      .toThrow(`buildProposalSet: no filing record '${filingKey}' on transaction ${created.transactionId}`);
  });

  it('a filing still at seen throws', () => {
    const created = create();
    seeDocument(created.transactionId, MESSAGE_ID, ATTACHMENT_ID);
    const filingKey = buildFilingKey(MESSAGE_ID, ATTACHMENT_ID);
    expect(() => createProposalSet(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, [VALID_MEMBER], { at: AT, actor: 'system', baseDir, now: LATER }))
      .toThrow(`buildProposalSet: filing '${filingKey}' is 'seen', not 'filed'`);
  });

  it('an abandoned filing throws', () => {
    const created = create();
    seeDocument(created.transactionId, MESSAGE_ID, ATTACHMENT_ID);
    abandonDocumentFiling(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, {
      at: AT, actor: 'system', lastError: 'gave up', baseDir, now: LATER,
    });
    const filingKey = buildFilingKey(MESSAGE_ID, ATTACHMENT_ID);
    expect(() => createProposalSet(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, [VALID_MEMBER], { at: AT2, actor: 'system', baseDir, now: EVEN_LATER }))
      .toThrow(`buildProposalSet: filing '${filingKey}' is 'abandoned', not 'filed'`);
  });

  it('a filing with review confirmed is accepted', () => {
    const filed = createFiledTransaction();
    confirmFiling(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, { at: AT3, actor: 'agent', baseDir, now: YET_LATER });

    const result = createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [VALID_MEMBER], { at: AT3, actor: 'system', baseDir, now: YET_LATER });
    expect(result.outcome).toBe('created');
  });

  it('filing_rejected: a rejected filing refuses without writing or emitting', () => {
    const filed = createFiledTransaction();
    rejectFiling(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, { at: AT3, actor: 'agent', baseDir, now: YET_LATER });

    const filePath = store._internal.transactionPath(baseDir, AGENT_ID, filed.transactionId);
    const before = fs.readFileSync(filePath, 'utf8');

    const result = createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [VALID_MEMBER], { at: AT3, actor: 'system', baseDir, now: YET_LATER });

    expect(result).toEqual({ outcome: 'filing_rejected' });
    const after = fs.readFileSync(filePath, 'utf8');
    expect(after).toBe(before);
    const createdEvents = readTransaction(AGENT_ID, filed.transactionId, { baseDir }).events.filter((e) => e.kind === 'proposal_set_created');
    expect(createdEvents).toHaveLength(0);
  });

  it('duplicate_filing: a second create attempt for the same filing refuses without writing or emitting', () => {
    const filed = createFiledTransaction();
    createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [VALID_MEMBER], { at: AT3, actor: 'system', baseDir, now: YET_LATER });

    const filePath = store._internal.transactionPath(baseDir, AGENT_ID, filed.transactionId);
    const before = fs.readFileSync(filePath, 'utf8');

    const result = createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [VALID_MEMBER], { at: AT3, actor: 'system', baseDir, now: YET_LATER });

    expect(result).toEqual({ outcome: 'duplicate_filing' });
    const after = fs.readFileSync(filePath, 'utf8');
    expect(after).toBe(before);
    const createdEvents = readTransaction(AGENT_ID, filed.transactionId, { baseDir }).events.filter((e) => e.kind === 'proposal_set_created');
    expect(createdEvents).toHaveLength(1);
  });

  it('duplicate_content: a second filing sharing the same contentHash refuses without writing or emitting', () => {
    const created = create();
    seeDocument(created.transactionId, MESSAGE_ID, ATTACHMENT_ID);
    const filedA = fileDocument(created.transactionId, MESSAGE_ID, ATTACHMENT_ID, { contentHash: 'sha256:sharedhash' });
    createProposalSet(AGENT_ID, filedA.transactionId, MESSAGE_ID, ATTACHMENT_ID, [VALID_MEMBER], { at: AT3, actor: 'system', baseDir, now: YET_LATER });

    seeDocument(created.transactionId, MESSAGE_ID_2, ATTACHMENT_ID_2);
    fileDocument(created.transactionId, MESSAGE_ID_2, ATTACHMENT_ID_2, { contentHash: 'sha256:sharedhash' });

    const filePath = store._internal.transactionPath(baseDir, AGENT_ID, created.transactionId);
    const before = fs.readFileSync(filePath, 'utf8');

    const result = createProposalSet(AGENT_ID, created.transactionId, MESSAGE_ID_2, ATTACHMENT_ID_2, [VALID_MEMBER], { at: AT3, actor: 'system', baseDir, now: YET_LATER });

    expect(result).toEqual({ outcome: 'duplicate_content' });
    const after = fs.readFileSync(filePath, 'utf8');
    expect(after).toBe(before);
  });

  it('no_members: an empty members array refuses without writing or emitting', () => {
    const filed = createFiledTransaction();

    const filePath = store._internal.transactionPath(baseDir, AGENT_ID, filed.transactionId);
    const before = fs.readFileSync(filePath, 'utf8');

    const result = createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [], { at: AT3, actor: 'system', baseDir, now: YET_LATER });

    expect(result).toEqual({ outcome: 'no_members' });
    const after = fs.readFileSync(filePath, 'utf8');
    expect(after).toBe(before);
  });

  it('an unknown member key throws naming it', () => {
    const filed = createFiledTransaction();
    expect(() => createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [{ roles: ['client'], email: 'jane@example.com' }], { at: AT3, actor: 'system', baseDir, now: YET_LATER }))
      .toThrow('buildProposalSet: member contains unknown key "email"');
  });

  it('an unknown email-object key throws', () => {
    const filed = createFiledTransaction();
    const member = { roles: ['client'], emails: [{ address: 'jane@example.com', from: 'document', foo: 'bar' }] };
    expect(() => createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [member], { at: AT3, actor: 'system', baseDir, now: YET_LATER }))
      .toThrow('buildProposalSet: member email contains unknown key "foo"');
  });

  it('a missing from on an email throws', () => {
    const filed = createFiledTransaction();
    const member = { roles: ['client'], emails: [{ address: 'jane@example.com' }] };
    expect(() => createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [member], { at: AT3, actor: 'system', baseDir, now: YET_LATER }))
      .toThrow('buildProposalSet: member email from must be one of document, message, lead_sheet');
  });

  it('a bad from on an email throws', () => {
    const filed = createFiledTransaction();
    const member = { roles: ['client'], emails: [{ address: 'jane@example.com', from: 'carrier_pigeon' }] };
    expect(() => createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [member], { at: AT3, actor: 'system', baseDir, now: YET_LATER }))
      .toThrow('buildProposalSet: member email from must be one of document, message, lead_sheet');
  });

  it('a bad scope on an email throws', () => {
    const filed = createFiledTransaction();
    const member = { roles: ['client'], emails: [{ address: 'jane@example.com', from: 'document', scope: 'work' }] };
    expect(() => createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [member], { at: AT3, actor: 'system', baseDir, now: YET_LATER }))
      .toThrow('buildProposalSet: member email scope must be one of personal, organizational');
  });

  it('an explicit null scope on an email throws', () => {
    const filed = createFiledTransaction();
    const member = { roles: ['client'], emails: [{ address: 'jane@example.com', from: 'document', scope: null }] };
    expect(() => createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [member], { at: AT3, actor: 'system', baseDir, now: YET_LATER }))
      .toThrow('buildProposalSet: member email scope must be one of personal, organizational');
  });

  it('a member with neither name nor emails throws', () => {
    const filed = createFiledTransaction();
    expect(() => createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [{ roles: ['client'] }], { at: AT3, actor: 'system', baseDir, now: YET_LATER }))
      .toThrow('buildProposalSet: member must have a name or at least one email');
  });

  it('a member with only a name is accepted', () => {
    const filed = createFiledTransaction();
    const result = createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [{ roles: ['client'], name: 'Jane Smith' }], { at: AT3, actor: 'system', baseDir, now: YET_LATER });
    expect(result.outcome).toBe('created');
  });

  it('a member with only one email is accepted', () => {
    const filed = createFiledTransaction();
    const member = { roles: ['client'], emails: [{ address: 'jane@example.com', from: 'document' }] };
    const result = createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [member], { at: AT3, actor: 'system', baseDir, now: YET_LATER });
    expect(result.outcome).toBe('created');
  });

  it('an invalid role throws through the shared validator, with the buildProposalSet prefix', () => {
    const filed = createFiledTransaction();
    expect(() => createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [{ roles: ['not_a_role'], name: 'Jane Smith' }], { at: AT3, actor: 'system', baseDir, now: YET_LATER }))
      .toThrow(/^buildProposalSet:.*contains unknown role/);
  });

  it('an invalid entityType throws through the shared validator', () => {
    const filed = createFiledTransaction();
    const member = { roles: ['client'], name: 'Jane Smith', entityType: 'company' };
    expect(() => createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [member], { at: AT3, actor: 'system', baseDir, now: YET_LATER }))
      .toThrow(/contains unknown value/);
  });

  it('the same address twice on one member, differing case, throws', () => {
    const filed = createFiledTransaction();
    const member = {
      roles: ['client'],
      name: 'Jane Smith',
      emails: [
        { address: 'Jane@Example.com', from: 'document' },
        { address: 'jane@example.com', from: 'message' },
      ],
    };
    expect(() => createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [member], { at: AT3, actor: 'system', baseDir, now: YET_LATER }))
      .toThrow(/duplicate email address/);
  });

  it('the same address on two different members is accepted', () => {
    const filed = createFiledTransaction();
    const members = [
      { roles: ['client'], name: 'Jane Smith', emails: [{ address: 'shared@example.com', from: 'document' }] },
      { roles: ['co_client'], name: 'John Smith', emails: [{ address: 'shared@example.com', from: 'document' }] },
    ];
    const result = createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, members, { at: AT3, actor: 'system', baseDir, now: YET_LATER });
    expect(result.outcome).toBe('created');
  });

  it('a set id collision throws', () => {
    const created = create();
    seeDocument(created.transactionId, MESSAGE_ID, ATTACHMENT_ID);
    fileDocument(created.transactionId, MESSAGE_ID, ATTACHMENT_ID);
    seeDocument(created.transactionId, MESSAGE_ID_2, ATTACHMENT_ID_2);
    fileDocument(created.transactionId, MESSAGE_ID_2, ATTACHMENT_ID_2, { contentHash: 'sha256:different' });

    const spy = jest.spyOn(crypto, 'randomBytes').mockReturnValue(Buffer.from('11111111', 'hex'));

    createProposalSet(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, [VALID_MEMBER], { at: AT3, actor: 'system', baseDir, now: YET_LATER });

    expect(() => createProposalSet(AGENT_ID, created.transactionId, MESSAGE_ID_2, ATTACHMENT_ID_2, [VALID_MEMBER], { at: AT3, actor: 'system', baseDir, now: YET_LATER }))
      .toThrow(`buildProposalSet: generated set id 'pps-11111111' is already in use on transaction ${created.transactionId}`);

    spy.mockRestore();
  });

  it('a member id collision across two sets throws', () => {
    const created = create();
    seeDocument(created.transactionId, MESSAGE_ID, ATTACHMENT_ID);
    fileDocument(created.transactionId, MESSAGE_ID, ATTACHMENT_ID);
    seeDocument(created.transactionId, MESSAGE_ID_2, ATTACHMENT_ID_2);
    fileDocument(created.transactionId, MESSAGE_ID_2, ATTACHMENT_ID_2, { contentHash: 'sha256:different' });

    // Set ids differ (aaaaaaaa vs bbbbbbbb) but each call's one member
    // reuses the same fixed bytes (11111111), so only the member id
    // collides, not the set id.
    const spy = jest.spyOn(crypto, 'randomBytes')
      .mockReturnValueOnce(Buffer.from('aaaaaaaa', 'hex'))
      .mockReturnValueOnce(Buffer.from('11111111', 'hex'))
      .mockReturnValueOnce(Buffer.from('bbbbbbbb', 'hex'))
      .mockReturnValueOnce(Buffer.from('11111111', 'hex'));

    createProposalSet(AGENT_ID, created.transactionId, MESSAGE_ID, ATTACHMENT_ID, [VALID_MEMBER], { at: AT3, actor: 'system', baseDir, now: YET_LATER });

    expect(() => createProposalSet(AGENT_ID, created.transactionId, MESSAGE_ID_2, ATTACHMENT_ID_2, [VALID_MEMBER], { at: AT3, actor: 'system', baseDir, now: YET_LATER }))
      .toThrow(`buildProposalSet: generated member id 'ppm-11111111' is already in use on transaction ${created.transactionId}`);

    spy.mockRestore();
  });

  it('a refused create with an invalid member leaves the file byte-identical', () => {
    const filed = createFiledTransaction();
    const filePath = store._internal.transactionPath(baseDir, AGENT_ID, filed.transactionId);
    const before = fs.readFileSync(filePath, 'utf8');

    expect(() => createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [{ roles: ['not_a_role'], name: 'Jane Smith' }], { at: AT3, actor: 'system', baseDir, now: YET_LATER }))
      .toThrow('contains unknown role');

    const after = fs.readFileSync(filePath, 'utf8');
    expect(after).toBe(before);
  });
});

describe('rejectProposalMember', () => {
  function createSet(members = [VALID_MEMBER], messageId = MESSAGE_ID, attachmentId = ATTACHMENT_ID, filedOpts = {}) {
    const filed = createFiledTransaction(messageId, attachmentId, filedOpts);
    const result = createProposalSet(AGENT_ID, filed.transactionId, messageId, attachmentId, members, { at: AT2, actor: 'system', baseDir, now: EVEN_LATER });
    const setId = Object.keys(result.transaction.participantProposals)[0];
    const memberIds = Object.keys(result.transaction.participantProposals[setId].members);
    return { transactionId: filed.transactionId, setId, memberIds };
  }

  it('reject happy path: member status and rejectedAt, set still open, exact event payload', () => {
    const { transactionId, setId, memberIds } = createSet();
    const memberId = memberIds[0];

    const result = rejectProposalMember(AGENT_ID, transactionId, setId, memberId, { at: AT3, actor: 'agent', baseDir, now: YET_LATER });

    expect(result.outcome).toBe('rejected');
    const set = result.transaction.participantProposals[setId];
    expect(set.status).toBe('open');
    expect(set.members[memberId].status).toBe('rejected');
    expect(set.members[memberId].rejectedAt).toBe(AT3);

    const rejectedEvents = result.transaction.events.filter((e) => e.kind === 'proposal_member_rejected');
    expect(rejectedEvents).toHaveLength(1);
    expect(rejectedEvents[0]).toMatchObject({ at: AT3, actor: 'agent', kind: 'proposal_member_rejected', payload: { setId, memberId } });
  });

  it('rejecting every member leaves the set open', () => {
    const { transactionId, setId, memberIds } = createSet([VALID_MEMBER, { roles: ['co_client'], name: 'John Smith' }]);

    rejectProposalMember(AGENT_ID, transactionId, setId, memberIds[0], { at: AT3, actor: 'agent', baseDir, now: YET_LATER });
    const result = rejectProposalMember(AGENT_ID, transactionId, setId, memberIds[1], { at: AT3, actor: 'agent', baseDir, now: YET_LATER });

    expect(result.transaction.participantProposals[setId].status).toBe('open');
    expect(result.transaction.participantProposals[setId].members[memberIds[0]].status).toBe('rejected');
    expect(result.transaction.participantProposals[setId].members[memberIds[1]].status).toBe('rejected');
  });

  it('actor must be agent: system throws', () => {
    const { transactionId, setId, memberIds } = createSet();
    expect(() => rejectProposalMember(AGENT_ID, transactionId, setId, memberIds[0], { at: AT3, actor: 'system', baseDir, now: YET_LATER }))
      .toThrow("buildMemberRejection: actor must be 'agent'");
  });

  it('a malformed setId throws', () => {
    const { transactionId, memberIds } = createSet();
    expect(() => rejectProposalMember(AGENT_ID, transactionId, 'not-a-set-id', memberIds[0], { at: AT3, actor: 'agent', baseDir, now: YET_LATER }))
      .toThrow('buildMemberRejection: setId must match the pps- id format');
  });

  it('a malformed memberId throws', () => {
    const { transactionId, setId } = createSet();
    expect(() => rejectProposalMember(AGENT_ID, transactionId, setId, 'not-a-member-id', { at: AT3, actor: 'agent', baseDir, now: YET_LATER }))
      .toThrow('buildMemberRejection: memberId must match the ppm- id format');
  });

  it('an unknown set throws', () => {
    const { transactionId, memberIds } = createSet();
    expect(() => rejectProposalMember(AGENT_ID, transactionId, 'pps-ffffffff', memberIds[0], { at: AT3, actor: 'agent', baseDir, now: YET_LATER }))
      .toThrow(`buildMemberRejection: no proposal set 'pps-ffffffff' on transaction ${transactionId}`);
  });

  it('a member id from a different set throws', () => {
    const first = createSet();
    seeDocument(first.transactionId, MESSAGE_ID_2, ATTACHMENT_ID_2);
    const filed2 = fileDocument(first.transactionId, MESSAGE_ID_2, ATTACHMENT_ID_2, { contentHash: 'sha256:othercontent' });
    const secondResult = createProposalSet(AGENT_ID, filed2.transactionId, MESSAGE_ID_2, ATTACHMENT_ID_2, [VALID_MEMBER], { at: AT3, actor: 'system', baseDir, now: YET_LATER });
    const secondSetId = Object.keys(secondResult.transaction.participantProposals).find((id) => id !== first.setId);

    expect(() => rejectProposalMember(AGENT_ID, first.transactionId, secondSetId, first.memberIds[0], { at: AT3, actor: 'agent', baseDir, now: YET_LATER }))
      .toThrow(`buildMemberRejection: '${first.memberIds[0]}' is not a member of proposal set '${secondSetId}' on transaction ${first.transactionId}`);
  });

  it('already_rejected: rejecting the same member twice leaves the file byte-identical the second time', () => {
    const { transactionId, setId, memberIds } = createSet();
    rejectProposalMember(AGENT_ID, transactionId, setId, memberIds[0], { at: AT3, actor: 'agent', baseDir, now: YET_LATER });

    const filePath = store._internal.transactionPath(baseDir, AGENT_ID, transactionId);
    const before = fs.readFileSync(filePath, 'utf8');

    const result = rejectProposalMember(AGENT_ID, transactionId, setId, memberIds[0], { at: AT3, actor: 'agent', baseDir, now: YET_LATER });

    expect(result).toEqual({ outcome: 'already_rejected' });
    const after = fs.readFileSync(filePath, 'utf8');
    expect(after).toBe(before);
    const rejectedEvents = readTransaction(AGENT_ID, transactionId, { baseDir }).events.filter((e) => e.kind === 'proposal_member_rejected');
    expect(rejectedEvents).toHaveLength(1);
  });

  it('set_closed: rejecting a member of a confirmed set leaves the file byte-identical', () => {
    const { transactionId, setId, memberIds } = createSet();

    const closedTxn = readTransaction(AGENT_ID, transactionId, { baseDir });
    const closedSet = { ...closedTxn.participantProposals[setId], status: 'confirmed' };
    const withClosedSet = { ...closedTxn, participantProposals: { ...closedTxn.participantProposals, [setId]: closedSet } };
    store.writeTransaction(AGENT_ID, withClosedSet, { baseDir, now: YET_LATER });

    const filePath = store._internal.transactionPath(baseDir, AGENT_ID, transactionId);
    const before = fs.readFileSync(filePath, 'utf8');

    const result = rejectProposalMember(AGENT_ID, transactionId, setId, memberIds[0], { at: AT3, actor: 'agent', baseDir, now: YET_LATER });

    expect(result).toEqual({ outcome: 'set_closed' });
    const after = fs.readFileSync(filePath, 'utf8');
    expect(after).toBe(before);
    const rejectedEvents = readTransaction(AGENT_ID, transactionId, { baseDir }).events.filter((e) => e.kind === 'proposal_member_rejected');
    expect(rejectedEvents).toHaveLength(0);
  });
});

describe('buildSetConfirmation', () => {
  function makeOpenSet() {
    const filed = createFiledTransaction();
    const created = createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [VALID_MEMBER], {
      at: AT2, actor: 'system', baseDir, now: EVEN_LATER,
    });
    return { transactionId: filed.transactionId, setId: created.setId };
  }

  it('marks the set confirmed and emits a proposal_set_confirmed event', () => {
    const { transactionId, setId } = makeOpenSet();
    const previous = readTransaction(AGENT_ID, transactionId, { baseDir });

    const result = buildSetConfirmation(previous, { transactionId, setId, at: AT3, actor: 'agent' });

    expect(result.outcome).toBe('confirmed');
    expect(result.transaction.participantProposals[setId].status).toBe('confirmed');
    const event = result.transaction.events[result.transaction.events.length - 1];
    expect(event).toMatchObject({ at: AT3, actor: 'agent', kind: 'proposal_set_confirmed', payload: { setId } });
  });

  it('the no-such-set error names the transactionId it was given, not the one on the envelope', () => {
    const { transactionId } = makeOpenSet();
    const previous = readTransaction(AGENT_ID, transactionId, { baseDir });
    const givenTransactionId = 'txn-20260101-deadbeef';

    expect(() => buildSetConfirmation(previous, { transactionId: givenTransactionId, setId: 'pps-ffffffff', at: AT3, actor: 'agent' }))
      .toThrow(`buildSetConfirmation: no proposal set 'pps-ffffffff' on transaction ${givenTransactionId}`);
  });

  it('throws when actor is not agent', () => {
    const { transactionId, setId } = makeOpenSet();
    const previous = readTransaction(AGENT_ID, transactionId, { baseDir });

    expect(() => buildSetConfirmation(previous, { transactionId, setId, at: AT3, actor: 'system' }))
      .toThrow("buildSetConfirmation: actor must be 'agent'");
  });

  it('a set already confirmed returns already_confirmed and writes nothing further', () => {
    const { transactionId, setId } = makeOpenSet();
    const previous = readTransaction(AGENT_ID, transactionId, { baseDir });
    const firstResult = buildSetConfirmation(previous, { transactionId, setId, at: AT3, actor: 'agent' });

    const secondResult = buildSetConfirmation(firstResult.transaction, { transactionId, setId, at: AT3, actor: 'agent' });

    expect(secondResult).toEqual({ outcome: 'already_confirmed' });
  });

  it('throws confirming a set that is already discarded, naming the set, its status, and the refused transition', () => {
    const { transactionId, setId } = makeOpenSet();
    const previous = readTransaction(AGENT_ID, transactionId, { baseDir });
    const discardResult = buildSetDiscard(previous, { transactionId, setId, at: AT3, actor: 'agent' });

    expect(() => buildSetConfirmation(discardResult.transaction, { transactionId, setId, at: AT3, actor: 'agent' }))
      .toThrow(`buildSetConfirmation: set '${setId}' is 'discarded' and cannot be confirmed on transaction ${transactionId}`);
  });
});

describe('buildSetDiscard', () => {
  function makeOpenSet() {
    const filed = createFiledTransaction();
    const created = createProposalSet(AGENT_ID, filed.transactionId, MESSAGE_ID, ATTACHMENT_ID, [VALID_MEMBER], {
      at: AT2, actor: 'system', baseDir, now: EVEN_LATER,
    });
    return { transactionId: filed.transactionId, setId: created.setId };
  }

  it('marks the set discarded and emits a proposal_set_discarded event', () => {
    const { transactionId, setId } = makeOpenSet();
    const previous = readTransaction(AGENT_ID, transactionId, { baseDir });

    const result = buildSetDiscard(previous, { transactionId, setId, at: AT3, actor: 'agent' });

    expect(result.outcome).toBe('discarded');
    expect(result.transaction.participantProposals[setId].status).toBe('discarded');
    const event = result.transaction.events[result.transaction.events.length - 1];
    expect(event).toMatchObject({ at: AT3, actor: 'agent', kind: 'proposal_set_discarded', payload: { setId } });
  });

  it('the no-such-set error names the transactionId it was given, not the one on the envelope', () => {
    const { transactionId } = makeOpenSet();
    const previous = readTransaction(AGENT_ID, transactionId, { baseDir });
    const givenTransactionId = 'txn-20260101-deadbeef';

    expect(() => buildSetDiscard(previous, { transactionId: givenTransactionId, setId: 'pps-ffffffff', at: AT3, actor: 'agent' }))
      .toThrow(`buildSetDiscard: no proposal set 'pps-ffffffff' on transaction ${givenTransactionId}`);
  });

  it('throws when actor is not agent', () => {
    const { transactionId, setId } = makeOpenSet();
    const previous = readTransaction(AGENT_ID, transactionId, { baseDir });

    expect(() => buildSetDiscard(previous, { transactionId, setId, at: AT3, actor: 'system' }))
      .toThrow("buildSetDiscard: actor must be 'agent'");
  });

  it('a set already discarded returns already_discarded and writes nothing further', () => {
    const { transactionId, setId } = makeOpenSet();
    const previous = readTransaction(AGENT_ID, transactionId, { baseDir });
    const firstResult = buildSetDiscard(previous, { transactionId, setId, at: AT3, actor: 'agent' });

    const secondResult = buildSetDiscard(firstResult.transaction, { transactionId, setId, at: AT3, actor: 'agent' });

    expect(secondResult).toEqual({ outcome: 'already_discarded' });
  });

  it('throws discarding a set that is already confirmed, naming the set, its status, and the refused transition', () => {
    const { transactionId, setId } = makeOpenSet();
    const previous = readTransaction(AGENT_ID, transactionId, { baseDir });
    const confirmResult = buildSetConfirmation(previous, { transactionId, setId, at: AT3, actor: 'agent' });

    expect(() => buildSetDiscard(confirmResult.transaction, { transactionId, setId, at: AT3, actor: 'agent' }))
      .toThrow(`buildSetDiscard: set '${setId}' is 'confirmed' and cannot be discarded on transaction ${transactionId}`);
  });
});

describe('PURITY', () => {
  it('buildProposalSet and buildMemberRejection never mutate the envelope they are given', () => {
    const filingKeyA = buildFilingKey('msg-A', 'att-A');
    const filingKeyB = buildFilingKey('msg-B', 'att-B');
    const frozenSetId = 'pps-11111111';
    const frozenMemberId = 'ppm-11111111';

    const rawPrevious = {
      schemaVersion: 1,
      transactionId: 'txn-20260715-aaaaaaaa',
      agentId: AGENT_ID,
      type: 'buyer_purchase',
      state: 'conditional',
      address: '12 Main St',
      createdAt: AT,
      updatedAt: AT,
      events: [],
      filings: {
        [filingKeyA]: {
          messageId: 'msg-A', attachmentId: 'att-A', filename: 'a.pdf', mimeType: 'application/pdf',
          size: 100, threadId: 'thread-A', sender: 'a@x.com', receivedAt: AT, subject: 'A',
          status: 'filed', review: 'needs_review', seenAt: AT, attempts: 0,
          driveFileId: 'drive-A', contentHash: 'sha256:aaaa',
        },
        [filingKeyB]: {
          messageId: 'msg-B', attachmentId: 'att-B', filename: 'b.pdf', mimeType: 'application/pdf',
          size: 200, threadId: 'thread-B', sender: 'b@x.com', receivedAt: AT, subject: 'B',
          status: 'filed', review: 'needs_review', seenAt: AT, attempts: 0,
          driveFileId: 'drive-B', contentHash: 'sha256:bbbb',
        },
      },
      participantProposals: {
        [frozenSetId]: {
          status: 'open',
          createdAt: AT,
          actor: 'system',
          source: { kind: 'document', filingKey: filingKeyA, contentHash: 'sha256:aaaa', filename: 'a.pdf', receivedAt: AT },
          members: {
            [frozenMemberId]: { roles: ['client'], name: 'Jane Smith', status: 'pending' },
          },
        },
      },
    };

    const previous = deepFreeze(JSON.parse(JSON.stringify(rawPrevious)));
    const beforeSnapshot = JSON.parse(JSON.stringify(rawPrevious));

    const buildResult = buildProposalSet(previous, {
      messageId: 'msg-B',
      attachmentId: 'att-B',
      members: [{ roles: ['client'], name: 'Someone Else' }],
      at: AT2,
      actor: 'system',
    });
    expect(buildResult.outcome).toBe('created');
    expect(buildResult.transaction).not.toBe(previous);

    const rejectResult = buildMemberRejection(previous, {
      setId: frozenSetId,
      memberId: frozenMemberId,
      at: AT2,
      actor: 'agent',
    });
    expect(rejectResult.outcome).toBe('rejected');
    expect(rejectResult.transaction).not.toBe(previous);

    expect(previous).toEqual(beforeSnapshot);
  });

  it('buildProposalSet: the no-such-filing error names the transactionId it was given, not the one on the envelope', () => {
    const envelopeTransactionId = 'txn-20260715-eeeeeeee';
    const givenTransactionId = 'txn-20260101-deadbeef';
    const rawPrevious = {
      schemaVersion: 1,
      transactionId: envelopeTransactionId,
      agentId: AGENT_ID,
      type: 'buyer_purchase',
      state: 'conditional',
      address: '12 Main St',
      createdAt: AT,
      updatedAt: AT,
      events: [],
    };
    const filingKey = buildFilingKey('msg-missing', 'att-missing');

    expect(() => buildProposalSet(rawPrevious, {
      transactionId: givenTransactionId,
      messageId: 'msg-missing',
      attachmentId: 'att-missing',
      members: [],
      at: AT2,
      actor: 'system',
    })).toThrow(`buildProposalSet: no filing record '${filingKey}' on transaction ${givenTransactionId}`);
  });

  it('buildMemberRejection: the no-such-set error names the transactionId it was given, not the one on the envelope', () => {
    const envelopeTransactionId = 'txn-20260715-fffffff0';
    const givenTransactionId = 'txn-20260101-deadbeef';
    const rawPrevious = {
      schemaVersion: 1,
      transactionId: envelopeTransactionId,
      agentId: AGENT_ID,
      type: 'buyer_purchase',
      state: 'conditional',
      address: '12 Main St',
      createdAt: AT,
      updatedAt: AT,
      events: [],
    };

    expect(() => buildMemberRejection(rawPrevious, {
      transactionId: givenTransactionId,
      setId: 'pps-11111111',
      memberId: 'ppm-11111111',
      at: AT2,
      actor: 'agent',
    })).toThrow(`buildMemberRejection: no proposal set 'pps-11111111' on transaction ${givenTransactionId}`);
  });

  it('buildSetConfirmation and buildSetDiscard never mutate the envelope they are given', () => {
    const frozenSetIdA = 'pps-22222222';
    const frozenSetIdB = 'pps-33333333';

    const rawPrevious = {
      schemaVersion: 1,
      transactionId: 'txn-20260715-bbbbbbbb',
      agentId: AGENT_ID,
      type: 'buyer_purchase',
      state: 'conditional',
      address: '12 Main St',
      createdAt: AT,
      updatedAt: AT,
      events: [],
      participantProposals: {
        [frozenSetIdA]: {
          status: 'open',
          createdAt: AT,
          actor: 'system',
          source: { kind: 'document', filingKey: buildFilingKey('msg-A', 'att-A'), contentHash: 'sha256:aaaa', filename: 'a.pdf', receivedAt: AT },
          members: { 'ppm-22222222': { roles: ['client'], name: 'Jane Smith', status: 'pending' } },
        },
        [frozenSetIdB]: {
          status: 'open',
          createdAt: AT,
          actor: 'system',
          source: { kind: 'document', filingKey: buildFilingKey('msg-B', 'att-B'), contentHash: 'sha256:bbbb', filename: 'b.pdf', receivedAt: AT },
          members: { 'ppm-33333333': { roles: ['client'], name: 'John Smith', status: 'pending' } },
        },
      },
    };

    const previous = deepFreeze(JSON.parse(JSON.stringify(rawPrevious)));
    const beforeSnapshot = JSON.parse(JSON.stringify(rawPrevious));

    const confirmResult = buildSetConfirmation(previous, { transactionId: rawPrevious.transactionId, setId: frozenSetIdA, at: AT2, actor: 'agent' });
    expect(confirmResult.outcome).toBe('confirmed');
    expect(confirmResult.transaction).not.toBe(previous);

    const discardResult = buildSetDiscard(previous, { transactionId: rawPrevious.transactionId, setId: frozenSetIdB, at: AT2, actor: 'agent' });
    expect(discardResult.outcome).toBe('discarded');
    expect(discardResult.transaction).not.toBe(previous);

    expect(previous).toEqual(beforeSnapshot);
  });
});
