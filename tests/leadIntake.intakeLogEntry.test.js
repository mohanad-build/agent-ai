'use strict';

const { buildIntakeLogEntry } = require('../src/leadIntake')._internal;

test('property present and non-empty — included in parenthetical after confidence', () => {
  const result = buildIntakeLogEntry({
    confidence: 0.95,
    propertyReference: '45 Maple',
    reasoning: 'clear lead inquiry',
  });
  expect(result).toBe('Heuristic intake (confidence 0.95, property: 45 Maple): clear lead inquiry');
});

test('property empty string — parenthetical contains confidence only, no extra comma', () => {
  const result = buildIntakeLogEntry({
    confidence: 0.95,
    propertyReference: '',
    reasoning: 'clear lead inquiry',
  });
  expect(result).toBe('Heuristic intake (confidence 0.95): clear lead inquiry');
});

test('property undefined — parenthetical contains confidence only', () => {
  const result = buildIntakeLogEntry({
    confidence: 0.95,
    reasoning: 'clear lead inquiry',
  });
  expect(result).toBe('Heuristic intake (confidence 0.95): clear lead inquiry');
});

test('property whitespace only — treated as empty, no property segment', () => {
  const result = buildIntakeLogEntry({
    confidence: 0.95,
    propertyReference: '   ',
    reasoning: 'clear lead inquiry',
  });
  expect(result).toBe('Heuristic intake (confidence 0.95): clear lead inquiry');
});

test('property with leading/trailing whitespace — trimmed to bare value in output', () => {
  const result = buildIntakeLogEntry({
    confidence: 0.95,
    propertyReference: '  45 Maple  ',
    reasoning: 'clear lead inquiry',
  });
  expect(result).toBe('Heuristic intake (confidence 0.95, property: 45 Maple): clear lead inquiry');
});

test('confidence invalid with property present — unknown fallback combined with property', () => {
  const result = buildIntakeLogEntry({
    confidence: 'bad',
    propertyReference: '45 Maple',
    reasoning: 'clear lead inquiry',
  });
  expect(result).toBe('Heuristic intake (confidence unknown, property: 45 Maple): clear lead inquiry');
});

test('reasoning missing — no reasoning provided fallback', () => {
  const result = buildIntakeLogEntry({
    confidence: 0.75,
    propertyReference: '',
  });
  expect(result).toBe('Heuristic intake (confidence 0.75): no reasoning provided');
});
