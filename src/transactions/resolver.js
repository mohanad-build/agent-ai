'use strict';

const rules = require('./rules');

// -- resolveChecklist -----------------------------------------------------------

function resolveChecklist(type, facts) {
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(rules.CATALOG, type)) {
    throw new Error(`resolveChecklist: unknown type '${type}'`);
  }
  if (facts === undefined) {
    throw new Error('resolveChecklist: facts is required');
  }
  if (facts === null || typeof facts !== 'object') {
    throw new Error('resolveChecklist: facts must be a non-null object');
  }

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

module.exports = {
  resolveChecklist,
};
