'use strict';

const rules = require('./rules');

// -- Constants --------------------------------------------------------------------

// note is agent-authored, explaining why an item was satisfied or left incomplete; the resolver never writes it.
const STATE_FIELDS = ['completed', 'completedAt', 'documents', 'note'];

// -- Argument assertions ------------------------------------------------------------

function assertKnownType(fnName, type) {
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(rules.CATALOG, type)) {
    throw new Error(`${fnName}: unknown type '${type}'`);
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

function resolveChecklist(type, facts) {
  assertKnownType('resolveChecklist', type);
  assertFacts('resolveChecklist', facts);
  assertRepresentedPersons('resolveChecklist', facts);
  assertClientSatisfactions('resolveChecklist', facts);

  return rules.CATALOG[type].map((item) => withClientSatisfaction(annotateItem(item, facts), item, facts));
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

  const satisfiedPersons = [];
  const outstandingPersons = [];
  facts.representedPersons.forEach((personId) => {
    if (isPersonSatisfied(facts.clientSatisfactions, personId, item.id)) {
      satisfiedPersons.push(personId);
    } else {
      outstandingPersons.push(personId);
    }
  });

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

function reResolve(previousItems, type, facts) {
  if (!Array.isArray(previousItems)) {
    throw new Error('reResolve: previousItems must be an array');
  }
  assertKnownType('reResolve', type);
  assertFacts('reResolve', facts);
  assertRepresentedPersons('reResolve', facts);
  assertClientSatisfactions('reResolve', facts);

  const newItems = resolveChecklist(type, facts);
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
