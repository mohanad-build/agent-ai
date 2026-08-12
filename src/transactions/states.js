'use strict';

const TABLE = {
  buyer_purchase: {
    states: ['conditional', 'firm', 'closed', 'collapsed'],
    initial: ['conditional', 'firm'],
    terminal: ['closed', 'collapsed'],
    edges: [
      ['conditional', 'firm'],
      ['firm', 'closed'],
      ['conditional', 'collapsed'],
      ['firm', 'collapsed'],
    ],
  },
  seller_sale: {
    states: ['conditional', 'firm', 'closed', 'collapsed'],
    initial: ['conditional', 'firm'],
    terminal: ['closed', 'collapsed'],
    edges: [
      ['conditional', 'firm'],
      ['firm', 'closed'],
      ['conditional', 'collapsed'],
      ['firm', 'collapsed'],
    ],
  },
  tenant_lease: {
    states: ['accepted', 'signed', 'possession', 'closed', 'collapsed'],
    initial: ['accepted'],
    terminal: ['closed', 'collapsed'],
    edges: [
      ['accepted', 'signed'],
      ['signed', 'possession'],
      ['possession', 'closed'],
      ['accepted', 'collapsed'],
      ['signed', 'collapsed'],
      ['possession', 'collapsed'],
    ],
  },
  landlord_lease: {
    states: ['accepted', 'signed', 'possession', 'closed', 'collapsed'],
    initial: ['accepted'],
    terminal: ['closed', 'collapsed'],
    edges: [
      ['accepted', 'signed'],
      ['signed', 'possession'],
      ['possession', 'closed'],
      ['accepted', 'collapsed'],
      ['signed', 'collapsed'],
      ['possession', 'collapsed'],
    ],
  },
  seller_listing: {
    states: ['preparing', 'live', 'suspended', 'closed', 'terminated'],
    initial: ['preparing', 'live'],
    terminal: ['closed', 'terminated'],
    edges: [
      ['preparing', 'live'],
      ['live', 'closed'],
      ['live', 'suspended'],
      ['suspended', 'live'],
      ['preparing', 'terminated'],
      ['live', 'terminated'],
      ['suspended', 'terminated'],
    ],
  },
  landlord_listing: {
    states: ['preparing', 'live', 'suspended', 'closed', 'terminated'],
    initial: ['preparing', 'live'],
    terminal: ['closed', 'terminated'],
    edges: [
      ['preparing', 'live'],
      ['live', 'closed'],
      ['live', 'suspended'],
      ['suspended', 'live'],
      ['preparing', 'terminated'],
      ['live', 'terminated'],
      ['suspended', 'terminated'],
    ],
  },
};

function deepFreeze(value) {
  Object.getOwnPropertyNames(value).forEach((key) => {
    const child = value[key];
    if (child && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  });
  return Object.freeze(value);
}

deepFreeze(TABLE);

const TRANSACTION_TYPES = Object.freeze(Object.keys(TABLE));

function assertKnownType(fnName, type) {
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(TABLE, type)) {
    throw new Error(`${fnName}: unknown type '${type}'`);
  }
}

function assertStateArg(fnName, argName, state) {
  if (typeof state !== 'string' || state.trim() === '') {
    throw new Error(`${fnName}: ${argName} must be a non-empty string`);
  }
}

function getStates(type) {
  assertKnownType('getStates', type);
  return TABLE[type].states;
}

function getInitialStates(type) {
  assertKnownType('getInitialStates', type);
  return TABLE[type].initial;
}

function isValidInitialState(type, state) {
  assertKnownType('isValidInitialState', type);
  assertStateArg('isValidInitialState', 'state', state);
  return TABLE[type].initial.includes(state);
}

function isTerminal(type, state) {
  assertKnownType('isTerminal', type);
  assertStateArg('isTerminal', 'state', state);
  return TABLE[type].terminal.includes(state);
}

function canTransition(type, fromState, toState) {
  assertKnownType('canTransition', type);
  assertStateArg('canTransition', 'fromState', fromState);
  assertStateArg('canTransition', 'toState', toState);

  const def = TABLE[type];

  if (!def.states.includes(fromState)) {
    return { valid: false, reason: `${fromState} is not a valid state for ${type}` };
  }
  if (!def.states.includes(toState)) {
    return { valid: false, reason: `${toState} is not a valid state for ${type}` };
  }
  if (def.terminal.includes(fromState)) {
    return { valid: false, reason: `${fromState} is a final state and cannot transition to another state` };
  }
  const edgeExists = def.edges.some(([from, to]) => from === fromState && to === toState);
  if (!edgeExists) {
    return { valid: false, reason: `Cannot move from ${fromState} to ${toState}` };
  }
  return { valid: true };
}

function listTransitions(type, fromState) {
  assertKnownType('listTransitions', type);
  assertStateArg('listTransitions', 'fromState', fromState);
  const def = TABLE[type];
  const reachable = def.edges.filter(([from]) => from === fromState).map(([, to]) => to);
  return Object.freeze(reachable);
}

module.exports = {
  TRANSACTION_TYPES,
  getStates,
  getInitialStates,
  isValidInitialState,
  isTerminal,
  canTransition,
  listTransitions,
};

module.exports._internal = { TABLE };
