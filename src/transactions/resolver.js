'use strict';

const rules = require('./rules');
// Reaches into states.js for the state vocabulary only (getStates), and takes
// nothing else from it: state transitions and terminal-state logic remain
// states.js's job. State is a positional argument here, never a fact: it is
// machine-tracked by states.js, while facts are agent-answered, and putting
// state in the fact bag would create two writers for one value that can
// disagree.
const states = require('./states');

// -- Constants --------------------------------------------------------------------

// note is agent-authored, explaining why an item was satisfied or left incomplete; the resolver never writes it.
const STATE_FIELDS = ['completed', 'completedAt', 'documents', 'note'];

// -- Argument assertions ------------------------------------------------------------

function assertKnownType(fnName, type) {
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(rules.CATALOG, type)) {
    throw new Error(`${fnName}: unknown type '${type}'`);
  }
}

function assertKnownState(fnName, type, state) {
  if (typeof state !== 'string' || !states.getStates(type).includes(state)) {
    throw new Error(`${fnName}: unknown state '${state}' for type '${type}'`);
  }
}

function assertFacts(fnName, facts) {
  if (facts === undefined) {
    throw new Error(`${fnName}: facts is required`);
  }
  if (facts === null || typeof facts !== 'object') {
    throw new Error(`${fnName}: facts must be a non-null object`);
  }
}

function assertRepresentedPersons(fnName, facts) {
  if (!('representedPersons' in facts) || facts.representedPersons === undefined) {
    return;
  }
  if (!Array.isArray(facts.representedPersons)) {
    throw new Error(`${fnName}: representedPersons must be an array`);
  }
}

function assertClientSatisfactions(fnName, facts) {
  if (!('clientSatisfactions' in facts) || facts.clientSatisfactions === undefined) {
    return;
  }
  if (facts.clientSatisfactions === null || typeof facts.clientSatisfactions !== 'object') {
    throw new Error(`${fnName}: clientSatisfactions must be a non-null object`);
  }
}

// -- resolveChecklist -----------------------------------------------------------

function resolveChecklist(type, state, facts) {
  assertKnownType('resolveChecklist', type);
  assertKnownState('resolveChecklist', type, state);
  assertFacts('resolveChecklist', facts);
  assertRepresentedPersons('resolveChecklist', facts);
  assertClientSatisfactions('resolveChecklist', facts);

  const baseItems = annotateCatalog(type, state, facts);

  if (facts.representationArrangement !== 'double_ended') {
    return baseItems;
  }

  // No pairing entry means this type is not a sell-side deal type (or is a
  // buy-side/listing type): there is no counterpart catalog to union with.
  // resolveChecklist stays a total function over any type+state+facts
  // input and resolves single-side rather than throwing here -- see
  // facts.js's assertRepresentationArrangementValidForType, which is the
  // actual enforcement point for data written through the normal API.
  // Throwing here instead would mean any transaction that reaches this
  // state through a path other than setFact/correctFact (a hand-edited
  // record, a future write path, data written before this check existed)
  // could never resolve its checklist again.
  const pairedType = states.buySideTypeForSellSide(type);
  if (!pairedType) {
    return baseItems;
  }

  // Reuses `state` for the paired type without a second assertKnownState
  // pass: the pairing map only pairs types sharing an identical state
  // vocabulary (see the comment on SELL_SIDE_TO_BUY_SIDE_TYPE in
  // states.js), and `state` was already validated against the base type's
  // table above, so it is valid for the paired type too.
  const pairedItems = annotateCatalog(pairedType, state, facts);
  return mergeDoubleEnded(baseItems, pairedItems);
}

function annotateCatalog(type, state, facts) {
  return rules.CATALOG[type]
    // terminalOnly items are the one deliberate exception to "the resolver
    // returns the annotated full set and never filters", see terminal.js for
    // why absence, not not_applicable, is the correct representation.
    .filter((item) => !item.terminalOnly || state === 'collapsed')
    .map((item) => withClientSatisfaction(annotateItem(item, facts), item, facts));
}

// required > indeterminate > not_applicable. A double-ended deal genuinely
// carries both sides' obligations, and under-asking on a FINTRAC record is
// the worse error, so the merge keeps whichever side's row is more
// demanding rather than deferring to the base (sell) side by default.
const APPLICABILITY_RANK = { required: 3, indeterminate: 2, not_applicable: 1 };

// Merges two already-annotated arrays by id. A shared id keeps exactly ONE
// row, taken WHOLESALE from whichever side ranks higher on
// APPLICABILITY_RANK, never stitched field-by-field: reason and
// pendingFacts describe why THAT row's applicability came out the way it
// did, and pairing a winning applicability from one side with a reason or
// pendingFacts from the other would describe a state neither side actually
// produced. On a tie (including the common case of two sides producing an
// identical annotation off a shared predicate, e.g. the condition items),
// the base-catalog row wins, arbitrarily but deterministically. Order is
// base catalog order first, exactly as resolveChecklist already returns
// it, then ids unique to the paired catalog in their own declaration order.
function mergeDoubleEnded(baseItems, pairedItems) {
  const baseIds = new Set(baseItems.map((item) => item.id));
  const pairedById = new Map(pairedItems.map((item) => [item.id, item]));

  const merged = baseItems.map((item) => {
    const counterpart = pairedById.get(item.id);
    if (!counterpart) {
      return item;
    }
    return APPLICABILITY_RANK[counterpart.applicability] > APPLICABILITY_RANK[item.applicability]
      ? counterpart
      : item;
  });

  const uniqueToPaired = pairedItems.filter((item) => !baseIds.has(item.id));
  return [...merged, ...uniqueToPaired];
}

function annotateItem(item, facts) {
  if (item.reads.length === 0) {
    return { ...item, applicability: 'required' };
  }

  const missing = item.reads.filter((name) => !(name in facts) || facts[name] === undefined);

  if (missing.length > 0) {
    return {
      ...item,
      applicability: 'indeterminate',
      reason: `waiting on ${missing.join(', ')}`,
      pendingFacts: missing,
    };
  }

  if (item.requiredWhen(facts)) {
    return { ...item, applicability: 'required' };
  }

  return {
    ...item,
    applicability: 'not_applicable',
    reason: item.notApplicableReason,
  };
}

// -- Per-person client satisfaction ------------------------------------------------

// satisfiedPersons and outstandingPersons are a separate axis from applicability:
// applicability says whether an item is in play at all, these say who has cleared
// it. Only clientScope 'event' items get them here; clientScope 'dated' needs a
// validity window, which needs a date, which this resolver has no clock to supply,
// so that is separate work.
//
// Emission is gated by applicability too: required emits both fields, unchanged.
// not_applicable emits satisfiedPersons only: evidence of who was checked before
// the item was ruled out survives, but nobody is named outstanding against an
// obligation that does not apply to them. indeterminate emits neither field, for
// the same reason the representedPersons-absent branch below emits neither: we
// do not yet know whether the obligation exists, so naming anyone against it
// would assert a fact we were never given.
function withClientSatisfaction(annotated, item, facts) {
  if (item.scope !== 'client' || item.clientScope !== 'event') {
    return annotated;
  }

  // Absent representedPersons means we were never told who is on the deal, so we
  // cannot say who is satisfied or outstanding: emit neither field. An empty array
  // is a different, real answer, that we were told there is nobody. Callers must
  // use absent, never [], to mean unknown, the same way null counts as present
  // for a fact elsewhere in this file.
  if (!('representedPersons' in facts) || facts.representedPersons === undefined) {
    return annotated;
  }

  if (annotated.applicability === 'indeterminate') {
    return annotated;
  }

  const satisfiedPersons = [];
  const outstandingPersons = [];
  facts.representedPersons.forEach((personId) => {
    if (isPersonSatisfied(facts.clientSatisfactions, personId, item.id)) {
      satisfiedPersons.push(personId);
    } else {
      outstandingPersons.push(personId);
    }
  });

  if (annotated.applicability === 'not_applicable') {
    return { ...annotated, satisfiedPersons };
  }

  return { ...annotated, satisfiedPersons, outstandingPersons };
}

function isPersonSatisfied(clientSatisfactions, personId, itemId) {
  if (clientSatisfactions === undefined) {
    return false;
  }
  const perPerson = clientSatisfactions[personId];
  if (perPerson === undefined || perPerson === null) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(perPerson, itemId);
}

// -- reResolve --------------------------------------------------------------------

function reResolve(previousItems, type, state, facts) {
  if (!Array.isArray(previousItems)) {
    throw new Error('reResolve: previousItems must be an array');
  }
  assertKnownType('reResolve', type);
  assertKnownState('reResolve', type, state);
  assertFacts('reResolve', facts);
  assertRepresentedPersons('reResolve', facts);
  assertClientSatisfactions('reResolve', facts);

  const newItems = resolveChecklist(type, state, facts);
  const previousById = new Map(previousItems.map((item) => [item.id, item]));

  const merged = newItems.map((item) => {
    const previous = previousById.get(item.id);
    if (!previous) {
      return item;
    }
    const carried = { ...item };
    STATE_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(previous, field)) {
        carried[field] = previous[field];
      }
    });
    return carried;
  });

  const newIds = new Set(newItems.map((item) => item.id));
  const carriedOver = previousItems
    .filter((item) => !newIds.has(item.id))
    .map((item) => {
      const appended = {
        ...item,
        applicability: 'no_longer_applicable',
        // This reason assumes the only way an item falls out of the new set is a
        // type change, which was true when resolveChecklist returned every
        // catalog item for the type unconditionally. terminalOnly items are now a
        // second way an item can fall out: they are filtered out of the new set
        // whenever state is not 'collapsed'. The string below is still safe today
        // only because 'collapsed' is terminal in all four state tables, so no
        // transition ever leaves it: a terminalOnly item that was present
        // (state was 'collapsed') can never later be re-resolved at a
        // non-collapsed state, since there is no edge out of 'collapsed' to reach.
        // If a state table ever adds one, this string will misreport why the item
        // disappeared.
        reason: `no longer applicable: transaction changed to type '${type}'`,
      };
      delete appended.pendingFacts;
      return appended;
    });

  return [...merged, ...carriedOver];
}

module.exports = {
  resolveChecklist,
  reResolve,
};
