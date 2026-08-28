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

// Which listing type sits behind each deal type. seller_sale and
// landlord_lease are the two deal types a listing can sit under (store.js's
// LISTING_ELIGIBLE_TYPES already agrees on that set; a test pins the two
// lists together so they cannot drift apart). buyer_purchase and
// tenant_lease open at the deal with nothing behind them, and the listing
// types themselves are not deals, so neither has an entry here. Flat string
// map, no nested values, so a plain Object.freeze is enough; TABLE needs
// deepFreeze only because it nests arrays.
const DEAL_TO_LISTING_TYPE = Object.freeze({
  seller_sale: 'seller_listing',
  landlord_lease: 'landlord_listing',
});

// Sell-side deal type to its buy-side counterpart, for the double-ended
// union in resolver.js (TC_SPEC 7.1.2b): a double-ended deal opens as one
// sell-side transaction, and its checklist must additionally carry the
// buy-side catalog's obligations. Keys are exactly LISTING_ELIGIBLE_TYPES
// (store.js): in this domain "sell-side" and "can have a listing linked"
// are the same set by construction (only the side listing the property can
// have a listing attached), so that set is the anchor, the same one
// DEAL_TO_LISTING_TYPE above is pinned against, and a test pins this map's
// keys against it too, so the two lists cannot drift apart. The union in
// resolver.js additionally relies on both sides of each pairing sharing an
// identical state vocabulary (buyer_purchase/seller_sale both use
// conditional/firm/closed/collapsed; tenant_lease/landlord_lease both use
// accepted/signed/possession/closed/collapsed) so that a single `state`
// argument, already validated against the sell-side type, is valid for the
// buy-side type too without a second validation pass. A test pins that
// invariant as well.
const SELL_SIDE_TO_BUY_SIDE_TYPE = Object.freeze({
  seller_sale: 'buyer_purchase',
  landlord_lease: 'tenant_lease',
});

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

function isValidState(type, state) {
  assertKnownType('isValidState', type);
  assertStateArg('isValidState', 'state', state);
  return TABLE[type].states.includes(state);
}

function isTerminal(type, state) {
  assertKnownType('isTerminal', type);
  assertStateArg('isTerminal', 'state', state);
  return TABLE[type].terminal.includes(state);
}

// Returns the listing type paired with a deal type, or undefined for a deal
// type with no listing behind it. Unlike a missing pairing, an unknown type
// is a caller bug: throws, matching every other lookup in this file.
function listingTypeForDeal(dealType) {
  assertKnownType('listingTypeForDeal', dealType);
  return DEAL_TO_LISTING_TYPE[dealType];
}

// Returns the buy-side type paired with a sell-side deal type, or undefined
// for any type with no pairing (buy-side types themselves, and the listing
// types). Unlike a missing pairing, an unknown type is a caller bug: throws,
// matching listingTypeForDeal above.
function buySideTypeForSellSide(sellSideType) {
  assertKnownType('buySideTypeForSellSide', sellSideType);
  return SELL_SIDE_TO_BUY_SIDE_TYPE[sellSideType];
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
  isValidState,
  isTerminal,
  listingTypeForDeal,
  buySideTypeForSellSide,
  canTransition,
  listTransitions,
};

module.exports._internal = { TABLE, DEAL_TO_LISTING_TYPE, SELL_SIDE_TO_BUY_SIDE_TYPE };
