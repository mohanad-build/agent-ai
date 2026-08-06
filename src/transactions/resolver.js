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

// -- resolveChecklist -----------------------------------------------------------

function resolveChecklist(type, facts) {
  assertKnownType('resolveChecklist', type);
  assertFacts('resolveChecklist', facts);

  return rules.CATALOG[type].map((item) => annotateItem(item, facts));
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

// -- reResolve --------------------------------------------------------------------

function reResolve(previousItems, type, facts) {
  if (!Array.isArray(previousItems)) {
    throw new Error('reResolve: previousItems must be an array');
  }
  assertKnownType('reResolve', type);
  assertFacts('reResolve', facts);

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
