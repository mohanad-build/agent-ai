'use strict';

const prompts = require('../src/prompts');

describe('buildPropertyExtractionPrompt', () => {
  test('returns { system, user } shape with string values', () => {
    const result = prompts.buildPropertyExtractionPrompt({
      originalMessage: 'I want to buy a house',
      conversationHistory: 'Lead: What about 123 Main St?',
      currentQuestion: 'Is it still available?',
    });
    expect(result).toHaveProperty('system');
    expect(result).toHaveProperty('user');
    expect(typeof result.system).toBe('string');
    expect(typeof result.user).toBe('string');
    expect(result.system.length).toBeGreaterThan(0);
    expect(result.user.length).toBeGreaterThan(0);
  });

  test('all three inputs land in the user message', () => {
    const result = prompts.buildPropertyExtractionPrompt({
      originalMessage: 'orig-msg-sentinel',
      conversationHistory: 'conv-hist-sentinel',
      currentQuestion: 'cur-q-sentinel',
    });
    expect(result.user).toContain('orig-msg-sentinel');
    expect(result.user).toContain('conv-hist-sentinel');
    expect(result.user).toContain('cur-q-sentinel');
  });

  test('null inputs render as (not on file)', () => {
    const result = prompts.buildPropertyExtractionPrompt({
      originalMessage: null,
      conversationHistory: null,
      currentQuestion: null,
    });
    const matches = (result.user.match(/\(not on file\)/g) || []).length;
    expect(matches).toBe(3);
  });

  test('empty string inputs render as (not on file)', () => {
    const result = prompts.buildPropertyExtractionPrompt({
      originalMessage: '',
      conversationHistory: '   ',
      currentQuestion: '',
    });
    const matches = (result.user.match(/\(not on file\)/g) || []).length;
    expect(matches).toBe(3);
  });

  test('system contains no em-dashes or en-dashes', () => {
    const result = prompts.buildPropertyExtractionPrompt({
      originalMessage: 'test',
      conversationHistory: 'test',
      currentQuestion: 'test',
    });
    expect(result.system).not.toMatch(/[—–]/);
    expect(result.user).not.toMatch(/[—–]/);
  });
});
