'use strict';

const prompts = require('../src/prompts');

describe('buildHeuristicClassifierPrompt', () => {
  test('returns { system, user } shape with string values', () => {
    const result = prompts.buildHeuristicClassifierPrompt(
      'Subject line',
      'Body text',
      'Sender Name',
      'sender@example.com'
    );
    expect(result).toHaveProperty('system');
    expect(result).toHaveProperty('user');
    expect(typeof result.system).toBe('string');
    expect(typeof result.user).toBe('string');
  });

  test('the three category names and JSON contract are unchanged', () => {
    const result = prompts.buildHeuristicClassifierPrompt('s', 'b', 'n', 'e');
    expect(result.system).toContain('"category": "<one of: lead | noise | business_correspondence>"');
    expect(result.system).toContain('"confidence": <number between 0.0 and 1.0>');
  });

  test('transactional mail routing language is present, naming each carve-out category', () => {
    const result = prompts.buildHeuristicClassifierPrompt('s', 'b', 'n', 'e');
    expect(result.system).toContain('TRANSACTIONAL MAIL ROUTING');
    expect(result.system).toContain('Security alerts');
    expect(result.system).toContain('Login codes, 2FA codes, or verification codes');
    expect(result.system).toContain('Password reset confirmations or requests');
    expect(result.system).toContain('Payment receipts and payment confirmations');
    expect(result.system).toContain('Invoices and billing notices');
    expect(result.system).toContain('Service or infrastructure alerts');
  });

  test('routing language explicitly says transactional mail is business_correspondence, not noise', () => {
    const result = prompts.buildHeuristicClassifierPrompt('s', 'b', 'n', 'e');
    expect(result.system).toContain('classify these as business_correspondence, NOT noise');
  });

  test('noise definition no longer instructs that receipts, invoices, or account notifications are noise', () => {
    const result = prompts.buildHeuristicClassifierPrompt('s', 'b', 'n', 'e');
    const noiseSectionMatch = result.system.match(/2\. noise([\s\S]*?)3\. business_correspondence/);
    expect(noiseSectionMatch).not.toBeNull();
    const noiseSection = noiseSectionMatch[1];
    expect(noiseSection).not.toContain('receipts');
    expect(noiseSection).not.toContain('account notifications');
    expect(noiseSection).not.toContain('subscription confirmations');
    expect(noiseSection).not.toContain('Your DocuSign document is ready');
    expect(noiseSection).not.toContain('Your monthly invoice');
  });

  test('business_correspondence definition now covers transactional/service mail', () => {
    const result = prompts.buildHeuristicClassifierPrompt('s', 'b', 'n', 'e');
    const bizSectionMatch = result.system.match(/3\. business_correspondence([\s\S]*?)NOT-A-LEAD ANTI-PATTERNS/);
    expect(bizSectionMatch).not.toBeNull();
    expect(bizSectionMatch[1]).toContain('transactional/service mail');
  });

  test('system contains no em-dashes or en-dashes', () => {
    const result = prompts.buildHeuristicClassifierPrompt('s', 'b', 'n', 'e');
    expect(result.system).not.toMatch(/[—–]/);
    expect(result.user).not.toMatch(/[—–]/);
  });

  test('subject, body, sender name, and sender email land in the user message', () => {
    const result = prompts.buildHeuristicClassifierPrompt(
      'subj-sentinel',
      'body-sentinel',
      'name-sentinel',
      'email-sentinel@example.com'
    );
    expect(result.user).toContain('subj-sentinel');
    expect(result.user).toContain('body-sentinel');
    expect(result.user).toContain('name-sentinel');
    expect(result.user).toContain('email-sentinel@example.com');
  });
});
