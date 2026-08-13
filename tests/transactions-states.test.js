'use strict';

const {
  TRANSACTION_TYPES,
  getStates,
  getInitialStates,
  isValidInitialState,
  isValidState,
  isTerminal,
  canTransition,
  listTransitions,
} = require('../src/transactions/states');

const { TABLE } = require('../src/transactions/states')._internal;

describe('TRANSACTION_TYPES', () => {
  it('lists exactly the six locked transaction types in order', () => {
    expect(TRANSACTION_TYPES).toEqual([
      'buyer_purchase',
      'seller_sale',
      'tenant_lease',
      'landlord_lease',
      'seller_listing',
      'landlord_listing',
    ]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(TRANSACTION_TYPES)).toBe(true);
  });

  it('cannot be extended by push', () => {
    expect(() => TRANSACTION_TYPES.push('new_type')).toThrow();
    expect(TRANSACTION_TYPES).toEqual([
      'buyer_purchase',
      'seller_sale',
      'tenant_lease',
      'landlord_lease',
      'seller_listing',
      'landlord_listing',
    ]);
  });
});

describe('getStates', () => {
  it('returns the frozen states array for a known type', () => {
    const states = getStates('tenant_lease');
    expect(states).toEqual(['accepted', 'signed', 'possession', 'closed', 'collapsed']);
    expect(Object.isFrozen(states)).toBe(true);
  });

  it('throws for an unknown type', () => {
    expect(() => getStates('not_a_type')).toThrow(/getStates: unknown type/);
  });

  it('throws for a missing type', () => {
    expect(() => getStates(undefined)).toThrow(/getStates: unknown type/);
  });

  it('throws for a non-string type', () => {
    expect(() => getStates(123)).toThrow(/getStates: unknown type/);
  });
});

describe('getInitialStates', () => {
  it('returns the frozen initial-states array for a known type', () => {
    const initial = getInitialStates('tenant_lease');
    expect(initial).toEqual(['accepted']);
    expect(Object.isFrozen(initial)).toBe(true);
  });

  it('returns multiple initial states when the type allows more than one', () => {
    expect(getInitialStates('buyer_purchase')).toEqual(['conditional', 'firm']);
  });

  it('throws for an unknown type', () => {
    expect(() => getInitialStates('not_a_type')).toThrow(/getInitialStates: unknown type/);
  });
});

describe('isValidInitialState', () => {
  it('returns true for a declared initial state', () => {
    expect(isValidInitialState('buyer_purchase', 'conditional')).toBe(true);
    expect(isValidInitialState('buyer_purchase', 'firm')).toBe(true);
  });

  it('returns false for a non-initial state', () => {
    expect(isValidInitialState('buyer_purchase', 'closed')).toBe(false);
  });

  it('throws for an unknown type', () => {
    expect(() => isValidInitialState('not_a_type', 'conditional')).toThrow(/isValidInitialState: unknown type/);
  });

  it('throws for a non-string state', () => {
    expect(() => isValidInitialState('buyer_purchase', 123)).toThrow(/isValidInitialState: state must be a non-empty string/);
  });

  it('throws for a missing state', () => {
    expect(() => isValidInitialState('buyer_purchase', undefined)).toThrow(/isValidInitialState: state must be a non-empty string/);
  });
});

describe('isValidState', () => {
  it('returns true for every declared state, for all six types, derived from getStates', () => {
    TRANSACTION_TYPES.forEach((type) => {
      getStates(type).forEach((state) => {
        expect(isValidState(type, state)).toBe(true);
      });
    });
  });

  it('returns false for a state that belongs to a different type', () => {
    expect(isValidState('landlord_lease', 'preparing')).toBe(false);
    expect(isValidState('seller_sale', 'accepted')).toBe(false);
  });

  it('throws for an unknown type', () => {
    expect(() => isValidState('not_a_type', 'conditional')).toThrow(/isValidState: unknown type/);
  });

  it('throws for a non-string state', () => {
    expect(() => isValidState('buyer_purchase', 123)).toThrow(/isValidState: state must be a non-empty string/);
  });

  it('throws for a missing state', () => {
    expect(() => isValidState('buyer_purchase', undefined)).toThrow(/isValidState: state must be a non-empty string/);
  });
});

describe('isTerminal', () => {
  it('returns true for a declared terminal state', () => {
    expect(isTerminal('buyer_purchase', 'closed')).toBe(true);
    expect(isTerminal('buyer_purchase', 'collapsed')).toBe(true);
  });

  it('returns false for a non-terminal state', () => {
    expect(isTerminal('buyer_purchase', 'conditional')).toBe(false);
  });

  it('throws for an unknown type', () => {
    expect(() => isTerminal('not_a_type', 'closed')).toThrow(/isTerminal: unknown type/);
  });

  it('throws for a non-string state', () => {
    expect(() => isTerminal('buyer_purchase', null)).toThrow(/isTerminal: state must be a non-empty string/);
  });
});

describe('canTransition', () => {
  it('allows a declared edge', () => {
    expect(canTransition('buyer_purchase', 'conditional', 'firm')).toEqual({ valid: true });
    expect(canTransition('buyer_purchase', 'firm', 'closed')).toEqual({ valid: true });
  });

  it('refuses when fromState is not a state of the type, with a distinct reason', () => {
    const result = canTransition('buyer_purchase', 'not_a_state', 'firm');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not_a_state/);
    expect(result.reason).toMatch(/not a valid state/);
  });

  it('refuses when toState is not a state of the type, with a distinct reason', () => {
    const result = canTransition('buyer_purchase', 'conditional', 'not_a_state');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not_a_state/);
    expect(result.reason).toMatch(/not a valid state/);
  });

  it('refuses when fromState is terminal, with a distinct reason', () => {
    const result = canTransition('buyer_purchase', 'closed', 'firm');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/final state/);
  });

  it('refuses when both states are valid but the edge is not in the table', () => {
    const result = canTransition('buyer_purchase', 'conditional', 'closed');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Cannot move from conditional to closed/);
  });

  it('produces different reason strings across the four refusal cases', () => {
    const badFrom = canTransition('buyer_purchase', 'bogus_from', 'firm').reason;
    const badTo = canTransition('buyer_purchase', 'conditional', 'bogus_to').reason;
    const terminalFrom = canTransition('buyer_purchase', 'closed', 'firm').reason;
    const noEdge = canTransition('buyer_purchase', 'conditional', 'closed').reason;
    const reasons = new Set([badFrom, badTo, terminalFrom, noEdge]);
    expect(reasons.size).toBe(4);
  });

  it('throws for an unknown type', () => {
    expect(() => canTransition('not_a_type', 'conditional', 'firm')).toThrow(/canTransition: unknown type/);
  });

  it('throws for a non-string fromState', () => {
    expect(() => canTransition('buyer_purchase', 123, 'firm')).toThrow(/canTransition: fromState must be a non-empty string/);
  });

  it('throws for a non-string toState', () => {
    expect(() => canTransition('buyer_purchase', 'conditional', 123)).toThrow(/canTransition: toState must be a non-empty string/);
  });
});

describe('listTransitions', () => {
  it('returns the frozen list of reachable states', () => {
    const reachable = listTransitions('buyer_purchase', 'conditional');
    expect(reachable).toEqual(['firm', 'collapsed']);
    expect(Object.isFrozen(reachable)).toBe(true);
  });

  it('returns an empty frozen array for a terminal state', () => {
    const reachable = listTransitions('buyer_purchase', 'closed');
    expect(reachable).toEqual([]);
    expect(Object.isFrozen(reachable)).toBe(true);
  });

  it('throws for an unknown type', () => {
    expect(() => listTransitions('not_a_type', 'conditional')).toThrow(/listTransitions: unknown type/);
  });

  it('throws for a non-string fromState', () => {
    expect(() => listTransitions('buyer_purchase', 123)).toThrow(/listTransitions: fromState must be a non-empty string/);
  });
});

describe('structural invariants (iterate the table, do not hardcode)', () => {
  it('S1: every terminal state has zero outgoing edges, for every type', () => {
    TRANSACTION_TYPES.forEach((type) => {
      const def = TABLE[type];
      def.terminal.forEach((terminalState) => {
        const outgoing = def.edges.filter(([from]) => from === terminalState);
        expect(outgoing).toEqual([]);
      });
    });
  });

  it('S2: every state named in any edge is declared in that type\'s states list, for every type', () => {
    TRANSACTION_TYPES.forEach((type) => {
      const def = TABLE[type];
      def.edges.forEach(([from, to]) => {
        expect(def.states).toContain(from);
        expect(def.states).toContain(to);
      });
    });
  });

  it('S3: every initial state is declared in that type\'s states list', () => {
    TRANSACTION_TYPES.forEach((type) => {
      const def = TABLE[type];
      def.initial.forEach((state) => {
        expect(def.states).toContain(state);
      });
    });
  });

  it('S4: no initial state is terminal', () => {
    TRANSACTION_TYPES.forEach((type) => {
      const def = TABLE[type];
      def.initial.forEach((state) => {
        expect(def.terminal).not.toContain(state);
      });
    });
  });

  it('S5: every non-terminal state has at least one outgoing edge', () => {
    TRANSACTION_TYPES.forEach((type) => {
      const def = TABLE[type];
      def.states
        .filter((state) => !def.terminal.includes(state))
        .forEach((state) => {
          const hasOutgoing = def.edges.some(([from]) => from === state);
          expect(hasOutgoing).toBe(true);
        });
    });
  });

  it('S6: the table is frozen, mutating a returned array or the TABLE does not change it', () => {
    expect(Object.isFrozen(TABLE)).toBe(true);

    TRANSACTION_TYPES.forEach((type) => {
      const def = TABLE[type];
      expect(Object.isFrozen(def)).toBe(true);
      expect(Object.isFrozen(def.states)).toBe(true);
      expect(Object.isFrozen(def.initial)).toBe(true);
      expect(Object.isFrozen(def.terminal)).toBe(true);
      expect(Object.isFrozen(def.edges)).toBe(true);
      def.edges.forEach((edge) => {
        expect(Object.isFrozen(edge)).toBe(true);
      });
    });

    const states = getStates('buyer_purchase');
    const statesBefore = [...states];
    try { states.push('made_up_state'); } catch (e) { /* expected in strict engines */ }
    expect(states).toEqual(statesBefore);

    const edgesBefore = TABLE.buyer_purchase.edges.length;
    try { TABLE.buyer_purchase.edges.push(['closed', 'conditional']); } catch (e) { /* expected */ }
    expect(TABLE.buyer_purchase.edges.length).toBe(edgesBefore);

    try { TABLE.new_type = { states: [], initial: [], terminal: [], edges: [] }; } catch (e) { /* expected in strict engines */ }
    expect(Object.prototype.hasOwnProperty.call(TABLE, 'new_type')).toBe(false);
  });
});

describe('locked spec content (section 3)', () => {
  it('seller_sale adopts the buyer_purchase table verbatim: every edge permitted', () => {
    expect(canTransition('seller_sale', 'conditional', 'firm')).toEqual({ valid: true });
    expect(canTransition('seller_sale', 'firm', 'closed')).toEqual({ valid: true });
    expect(canTransition('seller_sale', 'conditional', 'collapsed')).toEqual({ valid: true });
    expect(canTransition('seller_sale', 'firm', 'collapsed')).toEqual({ valid: true });
  });

  it('landlord_lease adopts the tenant_lease table verbatim: every edge permitted', () => {
    expect(canTransition('landlord_lease', 'accepted', 'signed')).toEqual({ valid: true });
    expect(canTransition('landlord_lease', 'signed', 'possession')).toEqual({ valid: true });
    expect(canTransition('landlord_lease', 'possession', 'closed')).toEqual({ valid: true });
    expect(canTransition('landlord_lease', 'accepted', 'collapsed')).toEqual({ valid: true });
    expect(canTransition('landlord_lease', 'signed', 'collapsed')).toEqual({ valid: true });
    expect(canTransition('landlord_lease', 'possession', 'collapsed')).toEqual({ valid: true });
  });

  it('seller_sale and landlord_lease have the new initial state sets, in both directions', () => {
    expect(getInitialStates('seller_sale')).toEqual(['conditional', 'firm']);
    expect(isValidInitialState('seller_sale', 'conditional')).toBe(true);
    expect(isValidInitialState('seller_sale', 'firm')).toBe(true);
    expect(isValidInitialState('seller_sale', 'closed')).toBe(false);
    expect(isValidInitialState('seller_sale', 'collapsed')).toBe(false);

    expect(getInitialStates('landlord_lease')).toEqual(['accepted']);
    expect(isValidInitialState('landlord_lease', 'accepted')).toBe(true);
    expect(isValidInitialState('landlord_lease', 'signed')).toBe(false);
    expect(isValidInitialState('landlord_lease', 'possession')).toBe(false);
    expect(isValidInitialState('landlord_lease', 'closed')).toBe(false);
    expect(isValidInitialState('landlord_lease', 'collapsed')).toBe(false);
  });

  it('the removed states, including tenant_selected, are no longer valid states for seller_sale and landlord_lease', () => {
    ['preparing', 'live', 'suspended', 'terminated'].forEach((state) => {
      expect(getStates('seller_sale')).not.toContain(state);
      expect(getStates('landlord_lease')).not.toContain(state);
    });
    expect(getStates('landlord_lease')).not.toContain('tenant_selected');
  });

  it('mirror: the listing types still contain preparing, live, suspended, terminated -- the states moved, they did not vanish', () => {
    ['preparing', 'live', 'suspended', 'terminated'].forEach((state) => {
      expect(getStates('seller_listing')).toContain(state);
      expect(getStates('landlord_listing')).toContain(state);
    });
  });

  it('the split-eliminated transitions refuse across three distinct canTransition branches', () => {
    // Branch 1: not-a-valid-state. `live` did not lose an edge, it left the type.
    expect(canTransition('seller_sale', 'conditional', 'live')).toEqual({
      valid: false,
      reason: 'live is not a valid state for seller_sale',
    });
    expect(canTransition('landlord_lease', 'signed', 'live')).toEqual({
      valid: false,
      reason: 'live is not a valid state for landlord_lease',
    });

    // Branch 2: no-such-edge. Both states valid, no edge between them.
    expect(canTransition('seller_sale', 'conditional', 'closed')).toEqual({
      valid: false,
      reason: 'Cannot move from conditional to closed',
    });
    expect(canTransition('landlord_lease', 'accepted', 'possession')).toEqual({
      valid: false,
      reason: 'Cannot move from accepted to possession',
    });

    // Branch 3: terminal-state.
    expect(canTransition('seller_sale', 'closed', 'conditional')).toEqual({
      valid: false,
      reason: 'closed is a final state and cannot transition to another state',
    });
  });

  it('buy-side types have no terminated state, deliberately', () => {
    expect(getStates('buyer_purchase')).not.toContain('terminated');
    expect(getStates('tenant_lease')).not.toContain('terminated');
  });
});

describe('locked spec content (listing types)', () => {
  ['seller_listing', 'landlord_listing'].forEach((type) => {
    it(`${type}: every enumerated edge is permitted`, () => {
      expect(canTransition(type, 'preparing', 'live')).toEqual({ valid: true });
      expect(canTransition(type, 'live', 'closed')).toEqual({ valid: true });
      expect(canTransition(type, 'live', 'suspended')).toEqual({ valid: true });
      expect(canTransition(type, 'suspended', 'live')).toEqual({ valid: true });
      expect(canTransition(type, 'preparing', 'terminated')).toEqual({ valid: true });
      expect(canTransition(type, 'live', 'terminated')).toEqual({ valid: true });
      expect(canTransition(type, 'suspended', 'terminated')).toEqual({ valid: true });
    });

    it(`${type}: a representative non-edge is refused, with the states.js reason string`, () => {
      const result = canTransition(type, 'preparing', 'closed');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Cannot move from preparing to closed');
    });

    it(`${type}: closed and terminated are terminal with no outgoing edges`, () => {
      expect(isTerminal(type, 'closed')).toBe(true);
      expect(isTerminal(type, 'terminated')).toBe(true);
      expect(listTransitions(type, 'closed')).toEqual([]);
      expect(listTransitions(type, 'terminated')).toEqual([]);
    });

    it(`${type}: both preparing and live are valid initial states`, () => {
      expect(isValidInitialState(type, 'preparing')).toBe(true);
      expect(isValidInitialState(type, 'live')).toBe(true);
    });

    it(`${type}: a non-initial state is refused by isValidInitialState`, () => {
      expect(isValidInitialState(type, 'closed')).toBe(false);
      expect(isValidInitialState(type, 'suspended')).toBe(false);
      expect(isValidInitialState(type, 'terminated')).toBe(false);
    });
  });
});
