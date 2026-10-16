'use strict';

const { buildActionLink } = require('../src/digest');

const AGENT = { googleSheetId: 'sheet-xyz' };
const AGENT_NO_SHEET = {};

function makeRow(overrides) {
  return {
    firstName:   'Sarah',
    lastInitial: 'K',
    rowIndex:    2,
    phone:       '+16475551234',
    leadId:      'lead@example.com',
    ...overrides,
  };
}

// -- HOT: preferred (tel) --------------------------------------------------

test('HOT with phone -> tel link, label "Call Sarah", isFallback=false', () => {
  const row = makeRow({ category: 'HOT' });
  const result = buildActionLink(row, AGENT);
  expect(result.label).toBe('Call Sarah');
  expect(result.url).toBe('tel:+16475551234');
  expect(result.isFallback).toBe(false);
});

// -- HOT: fallback (sheet) --------------------------------------------------

test('HOT with no phone, has sheet -> sheet link, isFallback=true', () => {
  const row = makeRow({ category: 'HOT', phone: '' });
  const result = buildActionLink(row, AGENT);
  expect(result.label).toBe('Open row');
  expect(result.url).toContain('sheet-xyz');
  expect(result.url).toContain('A2');
  expect(result.isFallback).toBe(true);
});

// -- HOT: terminal fallback (search instruction, no sheet) ------------------

test('HOT with no phone, no sheet, has leadId -> search instruction, no url', () => {
  const row = makeRow({ category: 'HOT', phone: '' });
  const result = buildActionLink(row, AGENT_NO_SHEET);
  expect(result).toEqual({ text: 'Search your inbox for: lead@example.com', isFallback: true });
});

// -- HOT: null result when nothing available ---------------------------------

test('HOT with no phone, no sheet, no leadId -> null', () => {
  const rowEmpty = makeRow({ category: 'HOT', phone: '', leadId: '' });
  const rowNull = makeRow({ category: 'HOT', phone: '', leadId: null });
  expect(buildActionLink(rowEmpty, AGENT_NO_SHEET)).toBeNull();
  expect(buildActionLink(rowNull, AGENT_NO_SHEET)).toBeNull();
});

// -- needs_review: preferred (sheet) -----------------------------------------

test('needs_review with sheet -> sheet link, isFallback=false', () => {
  const row = makeRow({ category: 'needs_review' });
  const result = buildActionLink(row, AGENT);
  expect(result.label).toBe('Open row');
  expect(result.url).toContain('sheet-xyz');
  expect(result.isFallback).toBe(false);
});

// -- needs_review: fallback (search instruction) -----------------------------

test('needs_review with no sheet -> search instruction', () => {
  const row = makeRow({ category: 'needs_review' });
  const result = buildActionLink(row, AGENT_NO_SHEET);
  expect(result).toEqual({ text: 'Search your inbox for: lead@example.com', isFallback: true });
});

// -- needs_review: null result when nothing available -------------------------

test('needs_review with no sheet, no leadId -> null', () => {
  const rowEmpty = makeRow({ category: 'needs_review', leadId: '' });
  const rowNull = makeRow({ category: 'needs_review', leadId: null });
  expect(buildActionLink(rowEmpty, AGENT_NO_SHEET)).toBeNull();
  expect(buildActionLink(rowNull, AGENT_NO_SHEET)).toBeNull();
});

// -- operatorEscalated: preferred (sheet, no fallback) -----------------------

test('operatorEscalated with sheet -> sheet link, isFallback=false', () => {
  const row = makeRow({ category: 'operatorEscalated' });
  const result = buildActionLink(row, AGENT);
  expect(result.label).toBe('Open row');
  expect(result.url).toContain('sheet-xyz');
  expect(result.isFallback).toBe(false);
});

test('operatorEscalated with no sheet -> null, even with a leadId (no search fallback for this category)', () => {
  const row = makeRow({ category: 'operatorEscalated' });
  expect(buildActionLink(row, AGENT_NO_SHEET)).toBeNull();
});

// -- path1b: preferred (sheet) ------------------------------------------------

test('path1b with sheet -> sheet link, isFallback=false', () => {
  const row = makeRow({ category: 'path1b' });
  const result = buildActionLink(row, AGENT);
  expect(result.label).toBe('Open row');
  expect(result.isFallback).toBe(false);
});

// -- path1b: fallback (search instruction) -----------------------------------

test('path1b with no sheet -> search instruction', () => {
  const row = makeRow({ category: 'path1b' });
  const result = buildActionLink(row, AGENT_NO_SHEET);
  expect(result).toEqual({ text: 'Search your inbox for: lead@example.com', isFallback: true });
});

// -- path1b: null result when nothing available --------------------------------

test('path1b with no sheet, no leadId -> null', () => {
  const rowEmpty = makeRow({ category: 'path1b', leadId: '' });
  const rowNull = makeRow({ category: 'path1b', leadId: null });
  expect(buildActionLink(rowEmpty, AGENT_NO_SHEET)).toBeNull();
  expect(buildActionLink(rowNull, AGENT_NO_SHEET)).toBeNull();
});

// -- Phone normalisation ------------------------------------------------------

test('phone with formatting "+1 (647) 555-1234" normalises to tel:+16475551234', () => {
  const row = makeRow({ category: 'HOT', phone: '+1 (647) 555-1234' });
  const result = buildActionLink(row, AGENT);
  expect(result.url).toBe('tel:+16475551234');
});

test('phone without leading "+" strips non-digits only -- no "+" prepended', () => {
  const row = makeRow({ category: 'HOT', phone: '647-555-1234' });
  const result = buildActionLink(row, AGENT);
  expect(result.url).toBe('tel:6475551234');
});

// -- category absent -> defaults to HOT behaviour -----------------------------

test('category absent in rowData -> defaults to HOT, uses tel link when phone present', () => {
  const row = makeRow({});  // no category field
  const result = buildActionLink(row, AGENT);
  expect(result.label).toBe('Call Sarah');
  expect(result.url).toBe('tel:+16475551234');
  expect(result.isFallback).toBe(false);
});

// -- Sheet URL structure -------------------------------------------------------

test('sheet link includes googleSheetId and rowIndex in the URL', () => {
  const row = makeRow({ category: 'operatorEscalated' });
  const result = buildActionLink(row, { googleSheetId: 'my-sheet-id' });
  expect(result.url).toBe(
    'https://docs.google.com/spreadsheets/d/my-sheet-id/edit#gid=0&range=A2'
  );
});
