'use strict';

jest.mock('../src/operatorConfig');

const { loadOperator } = require('../src/operatorConfig');
const { _internal } = require('../src/digest');
const { resolveOperatorEmailForDeals } = _internal;

const OPERATOR_CONTACT_EMAIL = 'mohanad@getklosed.ca';
const AGENT = { agentId: 'agent-1', operatorId: 'op-1' };

afterEach(() => {
  jest.clearAllMocks();
});

test('no operatorId -> falls back to the operator contact address, loadOperator never called', () => {
  expect(resolveOperatorEmailForDeals({ agentId: 'agent-1' })).toBe(OPERATOR_CONTACT_EMAIL);
  expect(loadOperator).not.toHaveBeenCalled();
});

test('loadOperator throws -> falls back, does not throw', () => {
  loadOperator.mockImplementation(() => { throw new Error('ENOENT'); });
  expect(() => resolveOperatorEmailForDeals(AGENT)).not.toThrow();
  expect(resolveOperatorEmailForDeals(AGENT)).toBe(OPERATOR_CONTACT_EMAIL);
});

test('operator record loads with a real operatorEmail -> returns it', () => {
  loadOperator.mockReturnValue({ operatorId: 'op-1', operatorEmail: 'mo@example.com' });
  expect(resolveOperatorEmailForDeals(AGENT)).toBe('mo@example.com');
});

// loadOperator returns JSON.parse(raw); a config file whose content is
// literally "null" parses to null without throwing. Never let a malformed
// operator config file crash the deals section this feeds into.

test('loadOperator returns null -> falls back, does not throw', () => {
  loadOperator.mockReturnValue(null);
  expect(() => resolveOperatorEmailForDeals(AGENT)).not.toThrow();
  expect(resolveOperatorEmailForDeals(AGENT)).toBe(OPERATOR_CONTACT_EMAIL);
});

test('loadOperator returns undefined -> falls back, does not throw', () => {
  loadOperator.mockReturnValue(undefined);
  expect(() => resolveOperatorEmailForDeals(AGENT)).not.toThrow();
  expect(resolveOperatorEmailForDeals(AGENT)).toBe(OPERATOR_CONTACT_EMAIL);
});

test('loadOperator returns an empty object -> falls back, does not throw', () => {
  loadOperator.mockReturnValue({});
  expect(() => resolveOperatorEmailForDeals(AGENT)).not.toThrow();
  expect(resolveOperatorEmailForDeals(AGENT)).toBe(OPERATOR_CONTACT_EMAIL);
});
