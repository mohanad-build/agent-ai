'use strict';

const twilio = require('../src/twilio');
const fn = twilio.TEMPLATES.leadPropertyQuestion;

describe('twilio.TEMPLATES.leadPropertyQuestion', () => {
  const base = ['Sarah Chen', 'sarah@example.com', 'Is it available?', 'Q47'];

  test('default: returning lead, no property', () => {
    expect(fn(...base)).toBe(
      '[Q47] Sarah Chen (sarah@example.com): "Is it available?"\n\nReply: Q47 <your answer>'
    );
  });

  test('first-touch only', () => {
    expect(fn(...base, { isFirstTouch: true })).toBe(
      '[Q47] Sarah Chen (new, sarah@example.com): "Is it available?"\n\nReply: Q47 <your answer>'
    );
  });

  test('property only', () => {
    expect(fn(...base, { propertyReference: '456 Elm St' })).toBe(
      '[Q47] Sarah Chen (sarah@example.com, about 456 Elm St): "Is it available?"\n\nReply: Q47 <your answer>'
    );
  });

  test('both first-touch and property', () => {
    expect(fn(...base, { isFirstTouch: true, propertyReference: '456 Elm St' })).toBe(
      '[Q47] Sarah Chen (new, sarah@example.com, about 456 Elm St): "Is it available?"\n\nReply: Q47 <your answer>'
    );
  });

  test('backward compat: no opts argument', () => {
    expect(fn('Bob', 'bob@example.com', 'Q?', 'T1')).toBe(
      '[T1] Bob (bob@example.com): "Q?"\n\nReply: T1 <your answer>'
    );
  });

  test('isFirstTouch false does not add new label', () => {
    expect(fn(...base, { isFirstTouch: false })).toBe(
      '[Q47] Sarah Chen (sarah@example.com): "Is it available?"\n\nReply: Q47 <your answer>'
    );
  });

  test('null propertyReference is ignored', () => {
    expect(fn(...base, { propertyReference: null })).toBe(
      '[Q47] Sarah Chen (sarah@example.com): "Is it available?"\n\nReply: Q47 <your answer>'
    );
  });
});
