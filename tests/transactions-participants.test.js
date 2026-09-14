'use strict';

const crypto = require('node:crypto');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { addParticipant, voidParticipant, VOID_REASONS, addParticipantEmail, deriveRepresentedPersons, isRepresented, REPRESENTED_ROLES, resolveParticipantByName } = require('../src/transactions/participants');
const { PARTICIPANT_ID_RE } = require('../src/transactions/participants')._internal;
const { createTransaction, readTransaction } = require('../src/transactions/store');
const { evaluateSignals } = require('../src/transactions/matcher');

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

describe('deriveRepresentedPersons', () => {
  it('includes a participant whose roles include client', () => {
    const participants = { 'per-11111111': { roles: ['client'] } };
    expect(deriveRepresentedPersons(participants)).toEqual(['per-11111111']);
  });

  it('includes a participant whose roles include co_client', () => {
    const participants = { 'per-22222222': { roles: ['co_client'] } };
    expect(deriveRepresentedPersons(participants)).toEqual(['per-22222222']);
  });

  it('excludes a participant holding neither client nor co_client', () => {
    const participants = { 'per-33333333': { roles: ['agent'] } };
    expect(deriveRepresentedPersons(participants)).toBeUndefined();
  });

  it('includes a participant holding both client and another role exactly once', () => {
    const participants = { 'per-44444444': { roles: ['client', 'property_manager'] } };
    expect(deriveRepresentedPersons(participants)).toEqual(['per-44444444']);
  });

  it('picks out only the qualifying participants from a mixed map, preserving order', () => {
    const participants = {
      'per-11111111': { roles: ['agent'] },
      'per-22222222': { roles: ['client'] },
      'per-33333333': { roles: ['lawyer'] },
      'per-44444444': { roles: ['co_client'] },
    };
    expect(deriveRepresentedPersons(participants)).toEqual(['per-22222222', 'per-44444444']);
  });

  it('returns undefined when participants is absent', () => {
    expect(deriveRepresentedPersons(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty participants map', () => {
    expect(deriveRepresentedPersons({})).toBeUndefined();
  });

  it('returns undefined, not an empty array, when nobody in the map qualifies', () => {
    const participants = {
      'per-11111111': { roles: ['agent'] },
      'per-22222222': { roles: ['lawyer'] },
    };
    const result = deriveRepresentedPersons(participants);
    expect(result).toBeUndefined();
    expect(result).not.toEqual([]);
  });
});

describe('REPRESENTED_ROLES', () => {
  it('is client and co_client, and is frozen', () => {
    expect(REPRESENTED_ROLES).toEqual(['client', 'co_client']);
    expect(Object.isFrozen(REPRESENTED_ROLES)).toBe(true);
  });
});

describe('isRepresented', () => {
  it('is true for a participant holding client or co_client', () => {
    expect(isRepresented({ roles: ['client'] })).toBe(true);
    expect(isRepresented({ roles: ['co_client'] })).toBe(true);
    expect(isRepresented({ roles: ['client', 'property_manager'] })).toBe(true);
  });

  it('is false for a participant holding neither', () => {
    expect(isRepresented({ roles: ['agent'] })).toBe(false);
    expect(isRepresented({ roles: ['lawyer', 'property_manager'] })).toBe(false);
  });
});

describe('public exports', () => {
  it('isRepresented and REPRESENTED_ROLES are on the public surface, not _internal', () => {
    const participantsModule = require('../src/transactions/participants');
    expect(typeof participantsModule.isRepresented).toBe('function');
    expect(participantsModule.REPRESENTED_ROLES).toEqual(['client', 'co_client']);
    expect(Object.isFrozen(participantsModule.REPRESENTED_ROLES)).toBe(true);
    expect(participantsModule._internal.REPRESENTED_ROLES).toBeUndefined();
    expect(participantsModule._internal.isRepresented).toBeUndefined();
  });
});

describe('resolveParticipantByName', () => {
  it('resolves an exact match to that participant\'s id', () => {
    const transaction = { participants: { 'per-11111111': { roles: ['client'], name: 'Jane Smith' } } };
    expect(resolveParticipantByName(transaction, 'Jane Smith')).toEqual({ resolved: true, id: 'per-11111111' });
  });

  it('matches case-insensitively', () => {
    const transaction = { participants: { 'per-11111111': { roles: ['client'], name: 'Jane Smith' } } };
    expect(resolveParticipantByName(transaction, 'JANE smith')).toEqual({ resolved: true, id: 'per-11111111' });
  });

  it('trims leading and trailing whitespace on the input', () => {
    const transaction = { participants: { 'per-11111111': { roles: ['client'], name: 'Jane Smith' } } };
    expect(resolveParticipantByName(transaction, '  Jane Smith  ')).toEqual({ resolved: true, id: 'per-11111111' });
  });

  it('matches when the stored name itself has surrounding whitespace', () => {
    const transaction = { participants: { 'per-11111111': { roles: ['client'], name: '  Jane Smith  ' } } };
    expect(resolveParticipantByName(transaction, 'Jane Smith')).toEqual({ resolved: true, id: 'per-11111111' });
  });

  it('returns not_found for a name matching nobody', () => {
    const transaction = { participants: { 'per-11111111': { roles: ['client'], name: 'Jane Smith' } } };
    expect(resolveParticipantByName(transaction, 'Nobody Home')).toEqual({ resolved: false, reason: 'not_found', namelessCount: 0 });
  });

  it('returns ambiguous with both candidates when two represented participants share a name', () => {
    const transaction = {
      participants: {
        'per-11111111': { roles: ['client'], name: 'Jane Smith' },
        'per-22222222': { roles: ['co_client'], name: 'Jane Smith' },
      },
    };
    const result = resolveParticipantByName(transaction, 'Jane Smith');
    expect(result.resolved).toBe(false);
    expect(result.reason).toBe('ambiguous');
    expect(result.candidates).toEqual([
      { id: 'per-11111111', name: 'Jane Smith', roles: ['client'] },
      { id: 'per-22222222', name: 'Jane Smith', roles: ['co_client'] },
    ]);
  });

  it('does not resolve a non-represented participant sharing the name, and reports not_found', () => {
    const transaction = { participants: { 'per-11111111': { roles: ['lawyer'], name: 'Jane Smith' } } };
    expect(resolveParticipantByName(transaction, 'Jane Smith')).toEqual({ resolved: false, reason: 'not_found', namelessCount: 0 });
  });

  it('counts only represented, nameless participants in namelessCount', () => {
    const transaction = {
      participants: {
        'per-11111111': { roles: ['client'] },
        'per-22222222': { roles: ['lawyer'] },
        'per-33333333': { roles: ['co_client'] },
      },
    };
    const result = resolveParticipantByName(transaction, 'Jane Smith');
    expect(result).toEqual({ resolved: false, reason: 'not_found', namelessCount: 2 });
  });

  it('does not throw when a represented participant has no name', () => {
    const transaction = { participants: { 'per-11111111': { roles: ['client'] } } };
    expect(() => resolveParticipantByName(transaction, 'Jane Smith')).not.toThrow();
  });

  it('namelessCount is zero when every represented participant has a name', () => {
    const transaction = {
      participants: {
        'per-11111111': { roles: ['client'], name: 'Jane Smith' },
        'per-22222222': { roles: ['co_client'], name: 'John Doe' },
      },
    };
    const result = resolveParticipantByName(transaction, 'Nobody Home');
    expect(result).toEqual({ resolved: false, reason: 'not_found', namelessCount: 0 });
  });

  describe('voided participants', () => {
    it('resolves nothing live, but reports which voided participant the name matches', () => {
      const transaction = {
        participants: {},
        voidedParticipants: {
          'per-11111111': { roles: ['client'], name: 'Dave Lee', at: AT, actor: 'agent', reason: 'no_longer_on_deal' },
        },
      };
      const result = resolveParticipantByName(transaction, 'Dave Lee');
      expect(result).toEqual({ resolved: false, reason: 'voided', id: 'per-11111111', voidReason: 'no_longer_on_deal' });
    });

    it('a name that never existed, live or voided, stays not_found even when voidedParticipants is populated', () => {
      const transaction = {
        participants: {},
        voidedParticipants: {
          'per-11111111': { roles: ['client'], name: 'Dave Lee', at: AT, actor: 'agent', reason: 'no_longer_on_deal' },
        },
      };
      const result = resolveParticipantByName(transaction, 'Nobody Home');
      expect(result).toEqual({ resolved: false, reason: 'not_found', namelessCount: 0 });
    });

    it('a voided NON-represented participant does not produce a voided answer, and reports not_found', () => {
      const transaction = {
        participants: {},
        voidedParticipants: {
          'per-11111111': { roles: ['lawyer'], name: 'Dave Lee', at: AT, actor: 'agent', reason: 'recorded_in_error' },
        },
      };
      const result = resolveParticipantByName(transaction, 'Dave Lee');
      expect(result).toEqual({ resolved: false, reason: 'not_found', namelessCount: 0 });
    });

    it('a live match wins even when a voided participant elsewhere shares the name', () => {
      const transaction = {
        participants: { 'per-22222222': { roles: ['client'], name: 'Dave Lee' } },
        voidedParticipants: {
          'per-11111111': { roles: ['client'], name: 'Dave Lee', at: AT, actor: 'agent', reason: 'recorded_in_error' },
        },
      };
      const result = resolveParticipantByName(transaction, 'Dave Lee');
      expect(result).toEqual({ resolved: true, id: 'per-22222222' });
    });
  });
});

describe('VOID_REASONS', () => {
  it('is exactly recorded_in_error and no_longer_on_deal, and is frozen', () => {
    expect(VOID_REASONS).toEqual(['recorded_in_error', 'no_longer_on_deal']);
    expect(Object.isFrozen(VOID_REASONS)).toBe(true);
  });
});

describe('voidParticipant', () => {
  function addOne(transactionId, roles, opts = {}) {
    const result = addParticipant(AGENT_ID, transactionId, roles, { at: AT, actor: 'agent', baseDir, now: CLOCK, ...opts });
    return Object.keys(result.participants).find((id) => (opts.name ? result.participants[id].name === opts.name : true)) || Object.keys(result.participants)[0];
  }

  it('moves the entry: the live map no longer holds it, and the voided map does', () => {
    const created = create();
    const id = addOne(created.transactionId, ['client'], { name: 'Jane Smith' });

    const result = voidParticipant(AGENT_ID, created.transactionId, id, { reason: 'no_longer_on_deal', at: AT2, actor: 'agent', baseDir, now: LATER });

    expect(result.participants[id]).toBeUndefined();
    expect(result.voidedParticipants[id]).toBeDefined();

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(onDisk.participants[id]).toBeUndefined();
    expect(onDisk.voidedParticipants[id]).toBeDefined();
  });

  it('the voided entry keeps the original record and gains time, actor and reason', () => {
    const created = create();
    const id = addOne(created.transactionId, ['client'], { name: 'Jane Smith', emails: ['jane@example.com'] });

    const result = voidParticipant(AGENT_ID, created.transactionId, id, { reason: 'recorded_in_error', at: AT2, actor: 'agent', baseDir, now: LATER });

    expect(result.voidedParticipants[id]).toEqual({
      roles: ['client'],
      name: 'Jane Smith',
      emails: ['jane@example.com'],
      at: AT2,
      actor: 'agent',
      reason: 'recorded_in_error',
    });
  });

  it('appends a participant_voided event carrying the id and reason', () => {
    const created = create();
    const id = addOne(created.transactionId, ['client']);

    const result = voidParticipant(AGENT_ID, created.transactionId, id, { reason: 'recorded_in_error', at: AT2, actor: 'agent', baseDir, now: LATER });

    const voidedEvents = result.events.filter((e) => e.kind === 'participant_voided');
    expect(voidedEvents).toHaveLength(1);
    expect(voidedEvents[0]).toMatchObject({ at: AT2, actor: 'agent', kind: 'participant_voided', payload: { id, reason: 'recorded_in_error' } });
  });

  it('rejects an invalid reason', () => {
    const created = create();
    const id = addOne(created.transactionId, ['client']);

    expect(() => voidParticipant(AGENT_ID, created.transactionId, id, { reason: 'because', at: AT2, actor: 'agent', baseDir, now: LATER }))
      .toThrow('voidParticipant: reason must be one of recorded_in_error, no_longer_on_deal');
  });

  it('rejects a missing reason', () => {
    const created = create();
    const id = addOne(created.transactionId, ['client']);

    expect(() => voidParticipant(AGENT_ID, created.transactionId, id, { at: AT2, actor: 'agent', baseDir, now: LATER }))
      .toThrow('voidParticipant: reason must be one of recorded_in_error, no_longer_on_deal');
  });

  it('rejects an actor other than agent', () => {
    const created = create();
    const id = addOne(created.transactionId, ['client']);

    expect(() => voidParticipant(AGENT_ID, created.transactionId, id, { reason: 'recorded_in_error', at: AT2, actor: 'system', baseDir, now: LATER }))
      .toThrow("voidParticipant: actor must be 'agent'");
  });

  it('an unknown id and an already-voided id produce different errors', () => {
    const created = create();
    const id = addOne(created.transactionId, ['client']);
    voidParticipant(AGENT_ID, created.transactionId, id, { reason: 'recorded_in_error', at: AT2, actor: 'agent', baseDir, now: LATER });

    const unknownError = (() => {
      try {
        voidParticipant(AGENT_ID, created.transactionId, 'per-ffffffff', { reason: 'recorded_in_error', at: AT2, actor: 'agent', baseDir, now: LATER });
      } catch (err) {
        return err.message;
      }
      return undefined;
    })();

    const alreadyVoidedError = (() => {
      try {
        voidParticipant(AGENT_ID, created.transactionId, id, { reason: 'recorded_in_error', at: AT2, actor: 'agent', baseDir, now: LATER });
      } catch (err) {
        return err.message;
      }
      return undefined;
    })();

    expect(unknownError).toContain('is not a participant on transaction');
    expect(alreadyVoidedError).toContain('is already voided on transaction');
    expect(unknownError).not.toEqual(alreadyVoidedError);
  });

  it('an id is not reusable after voiding: addParticipant refuses a generated id that collides with a voided one', () => {
    const created = create();
    const fixedBytes = Buffer.from('11111111', 'hex');
    const spy = jest.spyOn(crypto, 'randomBytes').mockReturnValue(fixedBytes);

    const id = addOne(created.transactionId, ['client']);
    voidParticipant(AGENT_ID, created.transactionId, id, { reason: 'recorded_in_error', at: AT2, actor: 'agent', baseDir, now: LATER });

    // Same fixed bytes: generateParticipantId would mint the exact id that
    // was just voided, if nothing stopped it.
    expect(() => addParticipant(AGENT_ID, created.transactionId, ['client'], { at: AT2, actor: 'agent', baseDir, now: LATER }))
      .toThrow(`addParticipant: generated id '${id}' is already in use on transaction ${created.transactionId}`);

    spy.mockRestore();
  });

  it('deriveRepresentedPersons stops counting a voided person', () => {
    const created = create();
    const id = addOne(created.transactionId, ['client'], { name: 'Jane Smith' });
    expect(deriveRepresentedPersons(readTransaction(AGENT_ID, created.transactionId, { baseDir }).participants)).toEqual([id]);

    const result = voidParticipant(AGENT_ID, created.transactionId, id, { reason: 'no_longer_on_deal', at: AT2, actor: 'agent', baseDir, now: LATER });

    expect(deriveRepresentedPersons(result.participants)).toBeUndefined();
  });

  // Exercises the real writer end to end, not a hand-built fixture: this is
  // what proves voidParticipant's MOVE, not just matcher.js's read
  // behavior on a shape someone claims voiding produces. No change to
  // matcher.js is needed or made for signal B to stop seeing this address.
  it('collectKnownAddresses (signal B) stops seeing a voided participant\'s email, through the real writer', () => {
    const created = create();
    const id = addOne(created.transactionId, ['client'], { name: 'Jane Smith', emails: ['jane@example.com'] });
    const message = { threadId: 'thread-1', addresses: [{ address: 'jane@example.com' }] };

    const before = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(evaluateSignals(before, message).signals.B).toBe(true);

    voidParticipant(AGENT_ID, created.transactionId, id, { reason: 'no_longer_on_deal', at: AT2, actor: 'agent', baseDir, now: LATER });

    const after = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(evaluateSignals(after, message).signals.B).toBe(false);
  });
});

describe('addParticipantEmail', () => {
  function addOne(transactionId, roles, opts = {}) {
    const result = addParticipant(AGENT_ID, transactionId, roles, { at: AT, actor: 'agent', baseDir, now: CLOCK, ...opts });
    return Object.keys(result.participants).find((id) => (opts.name ? result.participants[id].name === opts.name : true)) || Object.keys(result.participants)[0];
  }

  it('appends, and prior addresses survive in order', () => {
    const created = create();
    const id = addOne(created.transactionId, ['client'], { emails: ['first@example.com'] });

    const result = addParticipantEmail(AGENT_ID, created.transactionId, id, 'second@example.com', { at: AT2, actor: 'agent', baseDir, now: LATER });

    expect(result.outcome).toBe('added');
    expect(result.transaction.participants[id].emails).toEqual(['first@example.com', 'second@example.com']);
  });

  it('creates the emails array on a participant that has none yet', () => {
    const created = create();
    const id = addOne(created.transactionId, ['client']);

    const result = addParticipantEmail(AGENT_ID, created.transactionId, id, 'first@example.com', { at: AT2, actor: 'agent', baseDir, now: LATER });

    expect(result.outcome).toBe('added');
    expect(result.transaction.participants[id].emails).toEqual(['first@example.com']);
  });

  it('stores the value exactly as given, casing and all', () => {
    const created = create();
    const id = addOne(created.transactionId, ['client']);

    const result = addParticipantEmail(AGENT_ID, created.transactionId, id, 'Jane.Smith@Example.COM', { at: AT2, actor: 'agent', baseDir, now: LATER });

    expect(result.transaction.participants[id].emails).toEqual(['Jane.Smith@Example.COM']);
  });

  // Detection correctness only: does the outcome say duplicate. Whether a
  // write actually happens is a separate concern, covered on its own
  // below, so the two properties can be broken (and tested) one at a
  // time.
  it('an identical-case duplicate is detected as a duplicate', () => {
    const created = create();
    const id = addOne(created.transactionId, ['client'], { emails: ['jane@example.com'] });

    const result = addParticipantEmail(AGENT_ID, created.transactionId, id, 'jane@example.com', { at: AT2, actor: 'agent', baseDir, now: LATER });

    expect(result).toEqual({ outcome: 'duplicate' });
  });

  it('a case-differing duplicate is ALSO detected as a duplicate', () => {
    const created = create();
    const id = addOne(created.transactionId, ['client'], { emails: ['Jane@Example.com'] });

    const result = addParticipantEmail(AGENT_ID, created.transactionId, id, '  JANE@EXAMPLE.COM  ', { at: AT2, actor: 'agent', baseDir, now: LATER });

    expect(result).toEqual({ outcome: 'duplicate' });
  });

  it('a duplicate no-op writes nothing: no event, no store write, no updatedAt churn', () => {
    const created = create();
    const id = addOne(created.transactionId, ['client'], { emails: ['jane@example.com'] });
    const before = readTransaction(AGENT_ID, created.transactionId, { baseDir });

    addParticipantEmail(AGENT_ID, created.transactionId, id, 'jane@example.com', { at: AT2, actor: 'agent', baseDir, now: LATER });

    const after = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(after).toEqual(before);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.events).toEqual(before.events);
  });

  it('appends a participant_email_added event carrying the id and email', () => {
    const created = create();
    const id = addOne(created.transactionId, ['client']);

    const result = addParticipantEmail(AGENT_ID, created.transactionId, id, 'jane@example.com', { at: AT2, actor: 'agent', baseDir, now: LATER });

    const addedEvents = result.transaction.events.filter((e) => e.kind === 'participant_email_added');
    expect(addedEvents).toHaveLength(1);
    expect(addedEvents[0]).toMatchObject({ at: AT2, actor: 'agent', kind: 'participant_email_added', payload: { id, email: 'jane@example.com' } });
  });

  it('accepts system as the actor, unlike voidParticipant', () => {
    const created = create();
    const id = addOne(created.transactionId, ['client']);

    const result = addParticipantEmail(AGENT_ID, created.transactionId, id, 'jane@example.com', { at: AT2, actor: 'system', baseDir, now: LATER });

    expect(result.outcome).toBe('added');
    const addedEvents = result.transaction.events.filter((e) => e.kind === 'participant_email_added');
    expect(addedEvents[0].actor).toBe('system');
  });

  it('a voided participant refuses, with a message distinct from an unknown id', () => {
    const created = create();
    const id = addOne(created.transactionId, ['client']);
    voidParticipant(AGENT_ID, created.transactionId, id, { reason: 'no_longer_on_deal', at: AT2, actor: 'agent', baseDir, now: LATER });

    const voidedError = (() => {
      try {
        addParticipantEmail(AGENT_ID, created.transactionId, id, 'jane@example.com', { at: AT2, actor: 'agent', baseDir, now: LATER });
      } catch (err) {
        return err.message;
      }
      return undefined;
    })();

    const unknownError = (() => {
      try {
        addParticipantEmail(AGENT_ID, created.transactionId, 'per-ffffffff', 'jane@example.com', { at: AT2, actor: 'agent', baseDir, now: LATER });
      } catch (err) {
        return err.message;
      }
      return undefined;
    })();

    expect(voidedError).toContain('is voided on transaction');
    expect(unknownError).toContain('is not a participant on transaction');
    expect(voidedError).not.toEqual(unknownError);
  });

  // Exercises the real writer end to end, not a hand-built fixture, the
  // same reasoning voidParticipant's own matcher integration test above
  // uses. No change to matcher.js.
  it('collectKnownAddresses (signal B) sees a newly added address, through the real writer, with no change to matcher.js', () => {
    const created = create();
    const id = addOne(created.transactionId, ['client']);
    const message = { threadId: 'thread-1', addresses: [{ address: 'jane@example.com' }] };

    const before = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(evaluateSignals(before, message).signals.B).toBe(false);

    addParticipantEmail(AGENT_ID, created.transactionId, id, 'jane@example.com', { at: AT2, actor: 'agent', baseDir, now: LATER });

    const after = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(evaluateSignals(after, message).signals.B).toBe(true);
  });
});
