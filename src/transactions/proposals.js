'use strict';

// A store for participant PROPOSALS: candidate participants extracted
// from a filed document, held for an agent to accept or reject before
// any of them become a real participant. Stored `participantProposals`
// is a new top-level map on the transaction envelope, a sibling of
// `participants` and `voidedParticipants` (participants.js), NOT a
// status field on either of those maps (TC_SPEC 6.7): a proposal is not
// yet known to be a real person on the deal, and folding it into
// `participants` would force every direct reader of that map
// (matcher.js's collectKnownAddresses, satisfactions.js's
// assertRepresented, deriveRepresentedPersons, resolveParticipantByName)
// to learn a new status filter just to keep ignoring proposals nobody
// has confirmed yet. A sibling map means none of those readers change at
// all.
//
// SETS ARE SEALED. One set is created per filed document, and its
// members are fixed at creation: a member can be REJECTED, but a set
// never gains a new member later. A re-extraction of the same document
// is refused outright (see buildProposalSet's duplicate_filing and
// duplicate_content outcomes below), so there is no path that would ever
// need to add to an existing set's membership.
//
// REJECTED MEMBERS ARE KEPT, NEVER REMOVED. A rejected member stays in
// `members` with status 'rejected' and a rejectedAt, the same discipline
// voidParticipant uses for `voidedParticipants` (participants.js): the
// record of "this was proposed and refused" has to survive, because a
// later extraction pass over a related document must not re-propose the
// same person and force the agent to reject them a second time. Deleting
// a rejected member would erase the only evidence this already happened.
//
// PURE BUILDERS. buildProposalSet and buildMemberRejection each take the
// current envelope and return either a new envelope (never mutating the
// one they were given) or a discriminated outcome object; neither one
// touches the store. createProposalSet and rejectProposalMember are thin
// wrappers that read, call the builder, and write only on success. This
// split is new to this codebase -- every existing participants.js and
// filings.js writer reads and writes in a single call -- because a
// future confirm operation (TC_SPEC section 14, not part of this commit)
// needs to compose this module's builder with addParticipant's and
// confirmFiling's logic into ONE atomic save, which is only possible if
// each half is a pure function first.
//
// NOTHING CALLS THIS MODULE YET. createProposalSet and
// rejectProposalMember have no live callers and there is no CLI for
// either; this commit ships the store alone.

const crypto = require('node:crypto');

const store = require('./store');
const events = require('./events');
const filings = require('./filings');
const participants = require('./participants');
const { normalizeEmailAddress } = require('./emailAddress');

// -- Constants ----------------------------------------------------------------

const PROPOSAL_SET_STATUSES = Object.freeze(['open', 'confirmed', 'discarded']);
const PROPOSAL_MEMBER_STATUSES = Object.freeze(['pending', 'rejected']);

// One kind today: every proposal set is born from a filed document.
// Frozen and exported anyway, the same reasoning as VOID_REASONS and
// FACT_KEYS elsewhere in this codebase -- a closed list, not a string
// callers invent, even when it currently has one member.
const PROPOSAL_SOURCE_KINDS = Object.freeze(['document']);

const EMAIL_SCOPES = Object.freeze(['personal', 'organizational']);
const EMAIL_SOURCES = Object.freeze(['document', 'message', 'lead_sheet']);

// filings.js's FILING_STATUSES and FILING_REVIEW_STATUSES are plain
// ordered arrays with no named export for one specific value (filings.js
// :59-65), so the only way to read a value out of them rather than
// retyping its literal here is by the position filings.js itself
// defines: FILING_STATUSES[1] is 'filed', FILING_REVIEW_STATUSES[2] is
// 'rejected'.
const [, FILED_STATUS] = filings.FILING_STATUSES;
const [, , REJECTED_REVIEW] = filings.FILING_REVIEW_STATUSES;

// -- ID generation --------------------------------------------------------------

// Same convention as generateParticipantId (participants.js:65-67) and
// generateTransactionId (store.js:67-70): crypto.randomBytes(4).toString
// ('hex'), no built-in collision handling -- the caller checks.
const PROPOSAL_SET_ID_RE = /^pps-[0-9a-f]{8}$/;
const PROPOSAL_MEMBER_ID_RE = /^ppm-[0-9a-f]{8}$/;

function generateProposalSetId() {
  return `pps-${crypto.randomBytes(4).toString('hex')}`;
}

function generateProposalMemberId() {
  return `ppm-${crypto.randomBytes(4).toString('hex')}`;
}

// -- Argument assertions --------------------------------------------------------

function assertActor(fnName, actor, expected) {
  if (actor !== expected) {
    throw new Error(`${fnName}: actor must be '${expected}'`);
  }
}

// The only keys a caller may put on one proposed member. `status` is
// deliberately absent from this list: it is this module's own field,
// set to 'pending' by the builder, never something a caller supplies.
const MEMBER_FIELD_KEYS = ['roles', 'name', 'emails', 'phone', 'entityType', 'isSelfRepresented'];
const EMAIL_OBJECT_KEYS = ['address', 'scope', 'from'];

function assertOnlyKeys(fnName, label, obj, allowedKeys) {
  Object.keys(obj).forEach((key) => {
    if (!allowedKeys.includes(key)) {
      throw new Error(`${fnName}: ${label} contains unknown key ${JSON.stringify(key)}`);
    }
  });
}

// Validates one proposed member in the order laid out for
// buildProposalSet: shape and key names first, then each email object's
// own shape, then the exact rules addParticipant will apply at
// confirmation (via participants.assertParticipantFields, so a member
// that passes here is guaranteed to pass there too), then the
// name-or-email requirement, then no address repeated on this one
// member. Throws on the first problem; never returns a value, because
// the caller (buildProposalSet) already holds the member it validated
// and only needs to know validation did not throw.
function assertMember(fnName, member) {
  if (member === null || typeof member !== 'object' || Array.isArray(member)) {
    throw new Error(`${fnName}: each member must be a plain object`);
  }
  assertOnlyKeys(fnName, 'member', member, MEMBER_FIELD_KEYS);

  const { roles, name, emails, phone, entityType, isSelfRepresented } = member;

  // addresses is the plain-string array participants.assertParticipantFields
  // expects for its own `emails` field -- undefined when this member
  // carries no `emails` key at all, distinct from an empty array, which
  // would mean "an emails key was given but named nobody".
  let addresses;
  if (emails !== undefined) {
    if (!Array.isArray(emails)) {
      throw new Error(`${fnName}: member emails must be an array`);
    }
    emails.forEach((emailEntry) => {
      if (emailEntry === null || typeof emailEntry !== 'object' || Array.isArray(emailEntry)) {
        throw new Error(`${fnName}: each member email must be a plain object`);
      }
      assertOnlyKeys(fnName, 'member email', emailEntry, EMAIL_OBJECT_KEYS);

      if (!EMAIL_SOURCES.includes(emailEntry.from)) {
        throw new Error(`${fnName}: member email from must be one of ${EMAIL_SOURCES.join(', ')}`);
      }
      // hasOwnProperty, not !== undefined: an explicit null must reach
      // this same check and fail it, the same convention addParticipant
      // uses for its own optional fields, rather than being silently
      // treated as "scope not given".
      if (Object.prototype.hasOwnProperty.call(emailEntry, 'scope') && !EMAIL_SCOPES.includes(emailEntry.scope)) {
        throw new Error(`${fnName}: member email scope must be one of ${EMAIL_SCOPES.join(', ')}`);
      }
    });
    addresses = emails.map((emailEntry) => emailEntry.address);
  }

  participants.assertParticipantFields(fnName, { roles, name, emails: addresses, phone, entityType, isSelfRepresented });

  if (name === undefined && (addresses === undefined || addresses.length === 0)) {
    throw new Error(`${fnName}: member must have a name or at least one email`);
  }

  if (addresses !== undefined) {
    const seen = new Set();
    addresses.forEach((address) => {
      const normalized = normalizeEmailAddress(address);
      if (seen.has(normalized)) {
        throw new Error(`${fnName}: member has duplicate email address ${JSON.stringify(address)}`);
      }
      seen.add(normalized);
    });
  }
}

// Builds the stored member entry from a validated proposed member:
// absent, never null, for every optional field with no value, the same
// convention addParticipant's own entry construction follows
// (participants.js:192-208). emails, when present, is rebuilt in the
// exact { address, scope?, from } key order the stored shape specifies,
// rather than spread verbatim -- assertMember already limited each email
// object to those three keys, so this is a reordering, not a filter.
function buildMemberEntry(member) {
  const entry = { roles: [...member.roles] };

  if (member.name !== undefined) {
    entry.name = member.name;
  }
  if (member.emails !== undefined) {
    entry.emails = member.emails.map((emailEntry) => {
      const built = { address: emailEntry.address };
      if (Object.prototype.hasOwnProperty.call(emailEntry, 'scope')) {
        built.scope = emailEntry.scope;
      }
      built.from = emailEntry.from;
      return built;
    });
  }
  if (member.phone !== undefined) {
    entry.phone = member.phone;
  }
  if (member.entityType !== undefined) {
    entry.entityType = member.entityType;
  }
  if (member.isSelfRepresented !== undefined) {
    entry.isSelfRepresented = member.isSelfRepresented;
  }
  entry.status = 'pending';

  return entry;
}

function readExisting(fnName, agentId, transactionId, baseDir) {
  const previous = store.readTransaction(agentId, transactionId, { baseDir });
  if (previous === null) {
    throw new Error(`${fnName}: no transaction ${transactionId} for agent ${agentId}`);
  }
  return previous;
}

// -- buildProposalSet -----------------------------------------------------------

// Pure: returns { outcome, transaction?, setId? }, where `transaction` is
// the NEXT envelope, not saved, and never mutates `previous` (every write
// below is a spread onto a new object). See createProposalSet for the
// thin wrapper that actually reads and saves.
function buildProposalSet(previous, { transactionId, messageId, attachmentId, members, at, actor }) {
  assertActor('buildProposalSet', actor, 'system');

  if (!Array.isArray(members)) {
    throw new Error('buildProposalSet: members must be an array');
  }
  // Every member is validated in full before anything else -- a filing
  // that doesn't exist yet is not a reason to skip telling the caller
  // their member data was malformed; both are caller bugs, and this one
  // is cheaper to check first.
  members.forEach((member) => assertMember('buildProposalSet', member));

  const filingKey = filings.buildFilingKey(messageId, attachmentId);
  const previousFilings = previous.filings || {};
  const filing = previousFilings[filingKey];

  if (!filing) {
    throw new Error(`buildProposalSet: no filing record '${filingKey}' on transaction ${transactionId}`);
  }
  if (filing.status !== FILED_STATUS) {
    throw new Error(`buildProposalSet: filing '${filingKey}' is '${filing.status}', not '${FILED_STATUS}'`);
  }

  const previousProposals = previous.participantProposals || {};
  const existingSets = Object.values(previousProposals);

  if (filing.review === REJECTED_REVIEW) {
    return { outcome: 'filing_rejected' };
  }

  if (existingSets.some((set) => set.source.filingKey === filingKey)) {
    return { outcome: 'duplicate_filing' };
  }

  if (existingSets.some((set) => set.source.contentHash === filing.contentHash)) {
    return { outcome: 'duplicate_content' };
  }

  if (members.length === 0) {
    return { outcome: 'no_members' };
  }

  // Ids are checked for uniqueness across the WHOLE transaction, not
  // just within the set being created: a member id doubles as a stable
  // handle once a set is confirmed (TC_SPEC section 14, not this
  // commit), so a fresh id landing on one already used by another set's
  // member would be exactly the kind of silent collision
  // addParticipant's own id check (participants.js:222-227) exists to
  // catch for participant ids.
  const existingSetIds = new Set(Object.keys(previousProposals));
  const existingMemberIds = new Set();
  existingSets.forEach((set) => {
    Object.keys(set.members).forEach((id) => existingMemberIds.add(id));
  });

  const setId = generateProposalSetId();
  if (existingSetIds.has(setId)) {
    throw new Error(`buildProposalSet: generated set id '${setId}' is already in use on transaction ${transactionId}`);
  }

  const memberIds = [];
  const builtMembers = {};
  members.forEach((member) => {
    const memberId = generateProposalMemberId();
    if (existingMemberIds.has(memberId)) {
      throw new Error(`buildProposalSet: generated member id '${memberId}' is already in use on transaction ${transactionId}`);
    }
    existingMemberIds.add(memberId);
    memberIds.push(memberId);
    builtMembers[memberId] = buildMemberEntry(member);
  });

  const set = {
    status: 'open',
    createdAt: at,
    actor,
    source: {
      kind: 'document',
      filingKey,
      contentHash: filing.contentHash,
      filename: filing.filename,
      receivedAt: filing.receivedAt,
    },
    members: builtMembers,
  };

  // Ids only, no names or addresses: the same discipline
  // participant_added and participant_voided already follow
  // (participants.js:229,277), unlike participant_email_added, which is
  // the one existing event that does echo a raw value into its payload.
  const event = events.makeEvent({ at, actor, kind: 'proposal_set_created', payload: { setId, filingKey, memberIds } });

  const next = {
    ...previous,
    participantProposals: { ...previousProposals, [setId]: set },
    events: events.appendEvent(previous.events, event),
  };

  return { outcome: 'created', transaction: next, setId };
}

// -- createProposalSet ------------------------------------------------------------

function createProposalSet(agentId, transactionId, messageId, attachmentId, members, opts = {}) {
  const { at, actor, baseDir, now } = opts;

  const previous = readExisting('createProposalSet', agentId, transactionId, baseDir);
  const result = buildProposalSet(previous, { transactionId, messageId, attachmentId, members, at, actor });

  if (result.outcome !== 'created') {
    return { outcome: result.outcome };
  }

  const transaction = store.writeTransaction(agentId, result.transaction, { baseDir, now });
  return { outcome: 'created', transaction, setId: result.setId };
}

// -- buildMemberRejection ---------------------------------------------------------

// Pure, same mutation contract as buildProposalSet.
function buildMemberRejection(previous, { transactionId, setId, memberId, at, actor }) {
  assertActor('buildMemberRejection', actor, 'agent');

  if (!PROPOSAL_SET_ID_RE.test(setId)) {
    throw new Error('buildMemberRejection: setId must match the pps- id format');
  }
  if (!PROPOSAL_MEMBER_ID_RE.test(memberId)) {
    throw new Error('buildMemberRejection: memberId must match the ppm- id format');
  }

  const previousProposals = previous.participantProposals || {};
  const set = previousProposals[setId];
  if (!set) {
    throw new Error(`buildMemberRejection: no proposal set '${setId}' on transaction ${transactionId}`);
  }

  const member = set.members[memberId];
  if (!member) {
    throw new Error(`buildMemberRejection: '${memberId}' is not a member of proposal set '${setId}' on transaction ${transactionId}`);
  }

  if (set.status !== 'open') {
    return { outcome: 'set_closed' };
  }
  if (member.status === 'rejected') {
    return { outcome: 'already_rejected' };
  }

  const nextMember = { ...member, status: 'rejected', rejectedAt: at };
  // The set's own status is left exactly as it was, even when this
  // rejection empties out the last pending member: confirming or
  // discarding a set is a separate decision (TC_SPEC section 14, not
  // this commit), never an automatic side effect of a member's rejection.
  const nextSet = { ...set, members: { ...set.members, [memberId]: nextMember } };

  const event = events.makeEvent({ at, actor, kind: 'proposal_member_rejected', payload: { setId, memberId } });

  const next = {
    ...previous,
    participantProposals: { ...previousProposals, [setId]: nextSet },
    events: events.appendEvent(previous.events, event),
  };

  return { outcome: 'rejected', transaction: next };
}

// -- rejectProposalMember -----------------------------------------------------------

function rejectProposalMember(agentId, transactionId, setId, memberId, opts = {}) {
  const { at, actor, baseDir, now } = opts;

  const previous = readExisting('rejectProposalMember', agentId, transactionId, baseDir);
  const result = buildMemberRejection(previous, { transactionId, setId, memberId, at, actor });

  if (result.outcome !== 'rejected') {
    return { outcome: result.outcome };
  }

  const transaction = store.writeTransaction(agentId, result.transaction, { baseDir, now });
  return { outcome: 'rejected', transaction };
}

// -- buildSetConfirmation ----------------------------------------------------------

// Pure, same contract as buildProposalSet and buildMemberRejection. Marks the
// SET 'confirmed' and nothing else: it does not touch a participants map,
// does not read or write one, does not know a participantId exists.
// Recording each member's participantId is 4c's job when it composes this
// builder with buildParticipant into one atomic save (TC_SPEC section 14,
// not this commit); this builder's job stops at the set's own status.
//
// No wrapper. 4c composes this directly; there is no confirmProposalSet
// analogous to createProposalSet/rejectProposalMember in this commit.
function buildSetConfirmation(previous, { transactionId, setId, at, actor }) {
  assertActor('buildSetConfirmation', actor, 'agent');

  if (!PROPOSAL_SET_ID_RE.test(setId)) {
    throw new Error('buildSetConfirmation: setId must match the pps- id format');
  }

  const previousProposals = previous.participantProposals || {};
  const set = previousProposals[setId];
  if (!set) {
    throw new Error(`buildSetConfirmation: no proposal set '${setId}' on transaction ${transactionId}`);
  }

  if (set.status === 'confirmed') {
    return { outcome: 'already_confirmed' };
  }
  // Discarded means the agent already said this document is not this
  // deal's. A later confirm reversing that silently would be a caller bug,
  // not a double tap, so this throws rather than returning an outcome, the
  // same convention TC_SPEC 6.7 draws elsewhere between an expected repeat
  // and a contradictory transition.
  if (set.status === 'discarded') {
    throw new Error(`buildSetConfirmation: set '${setId}' is 'discarded' and cannot be confirmed on transaction ${transactionId}`);
  }

  const nextSet = { ...set, status: 'confirmed' };

  const event = events.makeEvent({ at, actor, kind: 'proposal_set_confirmed', payload: { setId } });

  const next = {
    ...previous,
    participantProposals: { ...previousProposals, [setId]: nextSet },
    events: events.appendEvent(previous.events, event),
  };

  return { outcome: 'confirmed', transaction: next };
}

// -- buildSetDiscard ----------------------------------------------------------------

// Pure, same contract as buildSetConfirmation. Marks the SET 'discarded',
// the "wrong deal" outcome: this filing was never about this transaction at
// all, distinct from an individual member being rejected while the rest of
// the set stands.
//
// No wrapper, same reasoning as buildSetConfirmation.
function buildSetDiscard(previous, { transactionId, setId, at, actor }) {
  assertActor('buildSetDiscard', actor, 'agent');

  if (!PROPOSAL_SET_ID_RE.test(setId)) {
    throw new Error('buildSetDiscard: setId must match the pps- id format');
  }

  const previousProposals = previous.participantProposals || {};
  const set = previousProposals[setId];
  if (!set) {
    throw new Error(`buildSetDiscard: no proposal set '${setId}' on transaction ${transactionId}`);
  }

  if (set.status === 'discarded') {
    return { outcome: 'already_discarded' };
  }
  // Same reasoning as buildSetConfirmation's mirror check: a confirmed set
  // is a settled fact, and discarding it out from under whatever depends on
  // that confirmation would be a caller bug, not a double tap.
  if (set.status === 'confirmed') {
    throw new Error(`buildSetDiscard: set '${setId}' is 'confirmed' and cannot be discarded on transaction ${transactionId}`);
  }

  const nextSet = { ...set, status: 'discarded' };

  const event = events.makeEvent({ at, actor, kind: 'proposal_set_discarded', payload: { setId } });

  const next = {
    ...previous,
    participantProposals: { ...previousProposals, [setId]: nextSet },
    events: events.appendEvent(previous.events, event),
  };

  return { outcome: 'discarded', transaction: next };
}

module.exports = {
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
};

module.exports._internal = {
  PROPOSAL_SET_ID_RE,
  PROPOSAL_MEMBER_ID_RE,
  generateProposalSetId,
  generateProposalMemberId,
};
