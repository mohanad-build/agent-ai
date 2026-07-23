'use strict';

const { buildAgentContext } = require('../src/prompts');

const BASE_AGENT = {
  agentName: 'Mo Mohamed',
  brokerage: 'Test Brokerage',
  brokerageLocation: 'Toronto, Ontario',
  targetMarket: 'test leads',
  specialties: ['testing'],
  yearsExperience: 1,
  tone: 'warm, professional, and concise',
  usesEmojis: false,
};

describe('buildAgentContext voice', () => {
  test('full agentConfig renders first-person framing, not "on behalf of"', () => {
    const result = buildAgentContext(BASE_AGENT);
    expect(result).toContain('You are Mo Mohamed');
    expect(result).toContain('first person');
    expect(result).not.toContain('on behalf of');
  });

  test('blank brokerage AND blank brokerageLocation: no "undefined", no "at undefined"', () => {
    const result = buildAgentContext({ ...BASE_AGENT, brokerage: '', brokerageLocation: '' });
    expect(result).toContain('You are Mo Mohamed, a real estate agent.');
    expect(result).not.toContain('undefined');
    expect(result).not.toContain('at undefined');
  });

  test('brokerage present, brokerageLocation blank: renders " at <brokerage>", no "in undefined"', () => {
    const result = buildAgentContext({ ...BASE_AGENT, brokerage: 'Test Brokerage', brokerageLocation: '' });
    expect(result).toContain('You are Mo Mohamed, a real estate agent at Test Brokerage.');
    expect(result).not.toContain('undefined');
    expect(result).not.toContain('in undefined');
  });

  test('whitespace-only brokerage/brokerageLocation treated as absent', () => {
    const result = buildAgentContext({ ...BASE_AGENT, brokerage: '   ', brokerageLocation: '  ' });
    expect(result).toContain('You are Mo Mohamed, a real estate agent.');
    expect(result).not.toContain('undefined');
  });
});
