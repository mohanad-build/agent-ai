'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { addParticipant } = require('../src/transactions/participants');
const { PARTICIPANT_ID_RE } = require('../src/transactions/participants')._internal;
const { createTransaction, readTransaction } = require('../src/transactions/store');

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');
const LATER = new Date('2026-07-16T09:30:00.000Z');
const AT = '2026-07-15T10:00:00.000Z';
const AT2 = '2026-07-16T09:30:00.000Z';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transactions-participants-test-'));
}

let baseDir;

beforeEach(() => { baseDir = makeTmpDir(); });
afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

function create() {
  return createTransaction(AGENT_ID, { type: 'buyer_purchase', state: 'conditional', address: '12 Main St' }, { baseDir, now: CLOCK });
}

describe('addParticipant', () => {
  it('writes a participant readable from disk, with a generated id matching PARTICIPANT_ID_RE', () => {
    const created = create();
    const result = addParticipant(AGENT_ID, created.transactionId, ['client'], { at: AT, actor: 'agent', baseDir, now: LATER });

    const ids = Object.keys(result.participants);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(PARTICIPANT_ID_RE);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.participants[ids[0]]).toEqual({ roles: ['client'] });
  });

  it('gives two participants on one transaction different ids, and both persist', () => {
    const created = create();
    const afterFirst = addParticipant(AGENT_ID, created.transactionId, ['client'], { at: AT, actor: 'agent', baseDir, now: LATER });
    const firstId = Object.keys(afterFirst.participants)[0];

    const afterSecond = addParticipant(AGENT_ID, created.transactionId, ['agent'], { at: AT2, actor: 'agent', baseDir, now: LATER });
    const secondIds = Object.keys(afterSecond.participants).filter((id) => id !== firstId);

    expect(secondIds).toHaveLength(1);
    expect(secondIds[0]).not.toBe(firstId);

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(Object.keys(onDisk.participants)).toHaveLength(2);
  });

  it('round-trips roles as an array, including a participant holding two roles', () => {
    const created = create();
    const result = addParticipant(AGENT_ID, created.transactionId, ['client', 'property_manager'], { at: AT, actor: 'agent', baseDir, now: LATER });

    const id = Object.keys(result.participants)[0];
    expect(result.participants[id].roles).toEqual(['client', 'property_manager']);
  });

  it('omits every optional field that was not given, rather than storing it as undefined', () => {
    const created = create();
    const result = addParticipant(AGENT_ID, created.transactionId, ['client'], { at: AT, actor: 'agent', baseDir, now: LATER });

    const id = Object.keys(result.participants)[0];
    const record = result.participants[id];
    expect('name' in record).toBe(false);
    expect('emails' in record).toBe(false);
    expect('phone' in record).toBe(false);
    expect('entityType' in record).toBe(false);
    expect('isSelfRepresented' in record).toBe(false);
  });

  it('stores every optional field when given', () => {
    const created = create();
    const result = addParticipant(AGENT_ID, created.transactionId, ['client'], {
      name: 'John Smith',
      emails: ['j@x.com'],
      phone: '555-0100',
      entityType: 'individual',
      isSelfRepresented: true,
      at: AT,
      actor: 'agent',
      baseDir,
      now: LATER,
    });

    const id = Object.keys(result.participants)[0];
    expect(result.participants[id]).toEqual({
      roles: ['client'],
      name: 'John Smith',
      emails: ['j@x.com'],
      phone: '555-0100',
      entityType: 'individual',
      isSelfRepresented: true,
    });
  });

  it('throws when an optional field is explicitly null', () => {
    const created = create();
    const base = { at: AT, actor: 'agent', baseDir, now: LATER };

    expect(() => addParticipant(AGENT_ID, created.transactionId, ['client'], { ...base, name: null }))
      .toThrow('addParticipant: name must be a non-empty string');
    expect(() => addParticipant(AGENT_ID, created.transactionId, ['client'], { ...base, emails: null }))
      .toThrow('addParticipant: emails must be an array of non-empty strings');
    expect(() => addParticipant(AGENT_ID, created.transactionId, ['client'], { ...base, phone: null }))
      .toThrow('addParticipant: phone must be a non-empty string');
    expect(() => addParticipant(AGENT_ID, created.transactionId, ['client'], { ...base, entityType: null }))
      .toThrow('addParticipant: entityType must be a non-empty string');
    expect(() => addParticipant(AGENT_ID, created.transactionId, ['client'], { ...base, isSelfRepresented: null }))
      .toThrow('addParticipant: isSelfRepresented must be a boolean');
  });

  it('throws for an empty roles array', () => {
    const created = create();
    expect(() => addParticipant(AGENT_ID, created.transactionId, [], { at: AT, actor: 'agent', baseDir, now: LATER }))
      .toThrow('addParticipant: roles must be a non-empty array of non-empty strings');
  });

  it('throws for a non-array roles argument', () => {
    const created = create();
    expect(() => addParticipant(AGENT_ID, created.transactionId, 'client', { at: AT, actor: 'agent', baseDir, now: LATER }))
      .toThrow('addParticipant: roles must be a non-empty array of non-empty strings');
  });

  it('throws when roles contains an empty string', () => {
    const created = create();
    expect(() => addParticipant(AGENT_ID, created.transactionId, ['client', ''], { at: AT, actor: 'agent', baseDir, now: LATER }))
      .toThrow('addParticipant: roles must be a non-empty array of non-empty strings');
  });

  it('creates the participants map on a transaction that has none yet', () => {
    const created = create();
    expect('participants' in created).toBe(false);

    const result = addParticipant(AGENT_ID, created.transactionId, ['client'], { at: AT, actor: 'agent', baseDir, now: LATER });
    expect('participants' in result).toBe(true);
  });

  it('a second write preserves the first participant', () => {
    const created = create();
    const afterFirst = addParticipant(AGENT_ID, created.transactionId, ['client'], { at: AT, actor: 'agent', baseDir, now: LATER });
    const firstId = Object.keys(afterFirst.participants)[0];

    addParticipant(AGENT_ID, created.transactionId, ['agent'], { at: AT2, actor: 'agent', baseDir, now: LATER });

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.participants[firstId]).toEqual({ roles: ['client'] });
  });

  it('appends a participant_added event carrying the id and roles, preserving existing events', () => {
    const created = create();
    const afterFirst = addParticipant(AGENT_ID, created.transactionId, ['client'], { at: AT, actor: 'agent', baseDir, now: LATER });
    const firstId = Object.keys(afterFirst.participants)[0];

    const afterSecond = addParticipant(AGENT_ID, created.transactionId, ['agent'], { at: AT2, actor: 'agent', baseDir, now: LATER });
    const secondId = Object.keys(afterSecond.participants).find((id) => id !== firstId);

    const addedEvents = afterSecond.events.filter((e) => e.kind === 'participant_added');
    expect(addedEvents).toHaveLength(2);
    expect(addedEvents[0]).toMatchObject({ at: AT, actor: 'agent', kind: 'participant_added', payload: { id: firstId, roles: ['client'] } });
    expect(addedEvents[1]).toMatchObject({ at: AT2, actor: 'agent', kind: 'participant_added', payload: { id: secondId, roles: ['agent'] } });
  });

  it('does not deduplicate by name: two participants with identical roles and names both persist as separate records', () => {
    const created = create();
    const afterFirst = addParticipant(AGENT_ID, created.transactionId, ['client'], { name: 'John Smith', at: AT, actor: 'agent', baseDir, now: LATER });
    const firstId = Object.keys(afterFirst.participants)[0];

    const afterSecond = addParticipant(AGENT_ID, created.transactionId, ['client'], { name: 'John Smith', at: AT2, actor: 'agent', baseDir, now: LATER });
    const secondId = Object.keys(afterSecond.participants).find((id) => id !== firstId);

    expect(secondId).toBeDefined();
    expect(secondId).not.toBe(firstId);
    expect(Object.keys(afterSecond.participants)).toHaveLength(2);
    expect(afterSecond.participants[firstId]).toEqual({ roles: ['client'], name: 'John Smith' });
    expect(afterSecond.participants[secondId]).toEqual({ roles: ['client'], name: 'John Smith' });
  });
});

describe('PARTICIPANT_ID_RE', () => {
  it('matches the per- plus 8 hex character format, with no date prefix', () => {
    expect(PARTICIPANT_ID_RE.test('per-1a2b3c4d')).toBe(true);
    expect(PARTICIPANT_ID_RE.test('per-1A2B3C4D')).toBe(false);
    expect(PARTICIPANT_ID_RE.test('per-1a2b3c4')).toBe(false);
    expect(PARTICIPANT_ID_RE.test('txn-20260715-1a2b3c4d')).toBe(false);
  });
});
