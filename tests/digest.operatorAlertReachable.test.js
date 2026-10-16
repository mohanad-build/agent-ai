'use strict';

jest.mock('../src/operatorConfig');

const { loadOperator } = require('../src/operatorConfig');
const { _internal } = require('../src/digest');
const { operatorAlertReachable } = _internal;

const AGENT = { agentId: 'agent-1', operatorId: 'op-1' };

afterEach(() => {
  jest.clearAllMocks();
});

test('no operatorId on the agent config -> false, loadOperator never called', () => {
  expect(operatorAlertReachable({ agentId: 'agent-1' })).toBe(false);
  expect(loadOperator).not.toHaveBeenCalled();
});

test('operatorId set but loadOperator throws (operator_load_failed) -> false, does not throw', () => {
  loadOperator.mockImplementation(() => { throw new Error('ENOENT'); });
  expect(() => operatorAlertReachable(AGENT)).not.toThrow();
  expect(operatorAlertReachable(AGENT)).toBe(false);
});

test('operator record loads but has no operatorEmail -> false', () => {
  loadOperator.mockReturnValue({ operatorId: 'op-1' });
  expect(operatorAlertReachable(AGENT)).toBe(false);
});

test('operator record loads with a real operatorEmail -> true', () => {
  loadOperator.mockReturnValue({ operatorId: 'op-1', operatorEmail: 'mo@example.com' });
  expect(operatorAlertReachable(AGENT)).toBe(true);
});

// loadOperator returns JSON.parse(raw); a config file whose content is
// literally "null" parses to null without throwing. Never let a malformed
// operator config file crash the digest.

test('loadOperator returns null (a config file that parses to literal null) -> false, does not throw', () => {
  loadOperator.mockReturnValue(null);
  expect(() => operatorAlertReachable(AGENT)).not.toThrow();
  expect(operatorAlertReachable(AGENT)).toBe(false);
});

test('loadOperator returns undefined -> false, does not throw', () => {
  loadOperator.mockReturnValue(undefined);
  expect(() => operatorAlertReachable(AGENT)).not.toThrow();
  expect(operatorAlertReachable(AGENT)).toBe(false);
});

test('loadOperator returns an empty object -> false, does not throw', () => {
  loadOperator.mockReturnValue({});
  expect(() => operatorAlertReachable(AGENT)).not.toThrow();
  expect(operatorAlertReachable(AGENT)).toBe(false);
});
