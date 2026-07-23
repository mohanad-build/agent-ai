'use strict';

const { renderEmailHtml, _internal } = require('../src/digest');
const { STYLE_TOKENS: T } = _internal;

// 2026-05-12 12:00 UTC = 08:00 EDT (America/Toronto) — Tuesday, May 12
const NOW = new Date('2026-05-12T12:00:00Z');

const BASE_AGENT = {
  timezone:      'America/Toronto',
  googleSheetId: 'sheet-abc',
};

function makeEmptySections() {
  return {
    urgent:                  [],
    hotLeads:                [],
    newToReview:             [],
    followUpsDue:            [],
    followUpsFiredOvernight: [],
    systemHandled: { intaken: 0, followUpsFired: 0, preflightSkips: 0 },
    reliability:   { errors: 0, retries: 0, threadingSkipped: 0 },
  };
}

// ── Return shape ──────────────────────────────────────────────────────────────

test('returns { subject, html } object', () => {
  const result = renderEmailHtml(makeEmptySections(), BASE_AGENT, NOW);
  expect(result).toHaveProperty('subject');
  expect(result).toHaveProperty('html');
  expect(typeof result.html).toBe('string');
});

// ── Subject line ──────────────────────────────────────────────────────────────

test('subject is date-formatted when no urgent rows', () => {
  const result = renderEmailHtml(makeEmptySections(), BASE_AGENT, NOW);
  expect(result.subject).toBe('Your morning brief — Tuesday, May 12');
});

test('subject names first urgent lead when urgent rows present', () => {
  const sections = makeEmptySections();
  sections.urgent = [{
    firstName: 'Sarah', lastInitial: 'K', category: 'HOT',
    propertyReference: '45 Maple', hoursAwaiting: null, rowIndex: 3,
    phone: '+16475551234', gmailThreadId: 'thread-abc', leadId: 'lead@example.com',
  }];
  const result = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(result.subject).toBe('Your morning brief — Sarah needs you today');
});

// ── STYLE_TOKENS applied ──────────────────────────────────────────────────────

test('buttonBackground token appears in HTML output', () => {
  const sections = makeEmptySections();
  sections.urgent = [{
    firstName: 'Sarah', lastInitial: 'K', category: 'HOT',
    propertyReference: '45 Maple', hoursAwaiting: null, rowIndex: 3,
    phone: '+16475551234', gmailThreadId: 'thread-abc', leadId: 'lead@example.com',
  }];
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).toContain(T.buttonBackground);
});

test('containerMaxWidth token appears in HTML output', () => {
  const { html } = renderEmailHtml(makeEmptySections(), BASE_AGENT, NOW);
  expect(html).toContain(T.containerMaxWidth);
});

test('fontStack token appears in HTML output', () => {
  const { html } = renderEmailHtml(makeEmptySections(), BASE_AGENT, NOW);
  expect(html).toContain(T.fontStack);
});

test('mutedTextColor token used on systemHandled section', () => {
  const { html } = renderEmailHtml(makeEmptySections(), BASE_AGENT, NOW);
  expect(html).toContain(T.mutedTextColor);
});

// ── Opener suppression ────────────────────────────────────────────────────────

test('opener (Handled … leads) suppressed when urgent rows present', () => {
  const sections = makeEmptySections();
  sections.urgent = [{
    firstName: 'Sarah', lastInitial: 'K', category: 'HOT',
    propertyReference: '45 Maple', hoursAwaiting: null, rowIndex: 3,
    phone: '+16475551234', gmailThreadId: 'thread-abc', leadId: 'lead@example.com',
  }];
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).not.toContain('Handled');
  expect(html).not.toContain('this morning');
});

test('opener renders when no urgent rows', () => {
  const { html } = renderEmailHtml(makeEmptySections(), BASE_AGENT, NOW);
  expect(html).toContain('Handled 0 leads overnight');
  expect(html).toContain('0 need you today');
});

// ── HOT category button ───────────────────────────────────────────────────────

test('HOT urgent row: tel: link button with "Call Sarah" label', () => {
  const sections = makeEmptySections();
  sections.urgent = [{
    firstName: 'Sarah', lastInitial: 'K', category: 'HOT',
    propertyReference: '45 Maple', hoursAwaiting: null, rowIndex: 3,
    phone: '+16475551234', gmailThreadId: 'thread-abc', leadId: 'lead@example.com',
  }];
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).toContain('href="tel:+16475551234"');
  expect(html).toContain('Call Sarah');
});

// ── needs_review category button ─────────────────────────────────────────────

test('needs_review urgent row: thread link button with "Open thread" label', () => {
  const sections = makeEmptySections();
  sections.urgent = [{
    firstName: 'John', lastInitial: 'D', category: 'needs_review',
    propertyReference: null, hoursAwaiting: null, rowIndex: 4,
    phone: '', gmailThreadId: 'thread-needs', leadId: 'jd@example.com',
  }];
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).toContain('href="https://mail.google.com/mail/u/0/#inbox/thread-needs"');
  expect(html).toContain('Open thread');
});

// ── operatorEscalated category button ────────────────────────────────────────

test('operatorEscalated urgent row: sheet link button with "Open row" label', () => {
  const sections = makeEmptySections();
  sections.urgent = [{
    firstName: 'Alice', lastInitial: 'B', category: 'operatorEscalated',
    propertyReference: '22 Oak', hoursAwaiting: null, rowIndex: 7,
    phone: '', gmailThreadId: '', leadId: 'ab@example.com',
  }];
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).toContain('href="https://docs.google.com/spreadsheets/d/sheet-abc/edit#gid=0&amp;range=A7"');
  expect(html).toContain('Open row');
});

// ── path1b category button ────────────────────────────────────────────────────

test('path1b urgent row: thread link button with "Open thread" label', () => {
  const sections = makeEmptySections();
  sections.urgent = [{
    firstName: 'Mike', lastInitial: 'T', category: 'path1b',
    propertyReference: null, hoursAwaiting: 26, rowIndex: 5,
    phone: '', gmailThreadId: 'thread-p1b', leadId: 'mt@example.com',
  }];
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).toContain('href="https://mail.google.com/mail/u/0/#inbox/thread-p1b"');
  expect(html).toContain('Open thread');
});

// ── Fallback button (HOT no phone → thread) ───────────────────────────────────

test('HOT row with no phone falls back to thread button labeled "Open thread"', () => {
  const sections = makeEmptySections();
  sections.urgent = [{
    firstName: 'Sarah', lastInitial: 'K', category: 'HOT',
    propertyReference: '45 Maple', hoursAwaiting: null, rowIndex: 3,
    phone: '', gmailThreadId: 'thread-fallback', leadId: 'lead@example.com',
  }];
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).toContain('href="https://mail.google.com/mail/u/0/#inbox/thread-fallback"');
  expect(html).toContain('Open thread');
  expect(html).not.toContain('tel:');
});

// ── Null action — no button rendered ─────────────────────────────────────────

test('when buildActionLink returns null (no phone/thread/sheet), no <a> button rendered', () => {
  const sections = makeEmptySections();
  // operatorEscalated with no googleSheetId → null from buildActionLink
  sections.urgent = [{
    firstName: 'Eve', lastInitial: 'C', category: 'operatorEscalated',
    propertyReference: '10 Pine', hoursAwaiting: null, rowIndex: 9,
    phone: '', gmailThreadId: '', leadId: 'ec@example.com',
  }];
  const agentNoSheet = { timezone: 'America/Toronto' };  // no googleSheetId
  const { html } = renderEmailHtml(sections, agentNoSheet, NOW);
  expect(html).toContain('Eve C');           // row text still present
  expect(html).not.toContain('<a href=');    // no button
});

// ── Hot leads section ─────────────────────────────────────────────────────────

test('hot leads section renders with Call button when phone present', () => {
  const sections = makeEmptySections();
  sections.hotLeads = [{
    firstName: 'Bob', lastInitial: 'R', propertyReference: '77 Elm',
    daysAgo: 2, whyHot: '', rowIndex: 6,
    phone: '+16475559999', gmailThreadId: 'thread-hot', leadId: 'br@example.com',
  }];
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).toContain('Hot leads to call today');
  expect(html).toContain('Bob R');
  expect(html).toContain('href="tel:+16475559999"');
  expect(html).toContain('Call Bob');
});

test('hot leads with null propertyReference shows fallback text', () => {
  const sections = makeEmptySections();
  sections.hotLeads = [{
    firstName: 'Bob', lastInitial: 'R', propertyReference: null,
    daysAgo: 1, whyHot: '', rowIndex: 6,
    phone: '+16475559999', gmailThreadId: '', leadId: 'br@example.com',
  }];
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).toContain('(property not captured)');
});

// ── Deduplication: urgent rowIndex excluded from hot leads ────────────────────

test('HOT lead in urgent is not also shown in hot leads section', () => {
  const sections = makeEmptySections();
  // rowIndex 3 appears in both urgent and hotLeads
  sections.urgent = [{
    firstName: 'Sarah', lastInitial: 'K', category: 'HOT',
    propertyReference: '45 Maple', hoursAwaiting: null, rowIndex: 3,
    phone: '+16475551234', gmailThreadId: 'thread-abc', leadId: 'lead@example.com',
  }];
  sections.hotLeads = [{
    firstName: 'Sarah', lastInitial: 'K', propertyReference: '45 Maple',
    daysAgo: 0, whyHot: '', rowIndex: 3,
    phone: '+16475551234', gmailThreadId: 'thread-abc', leadId: 'lead@example.com',
  }];
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  // "Hot leads to call today" section header should not appear since dedup removes the only row
  expect(html).not.toContain('Hot leads to call today');
});

// ── systemHandled always renders ──────────────────────────────────────────────

test('systemHandled section always present, shows Leads intaken count', () => {
  const { html } = renderEmailHtml(makeEmptySections(), BASE_AGENT, NOW);
  expect(html).toContain('What the system handled');
  expect(html).toContain('Leads intaken: 0');
});

test('noiseArchived > 0 renders the archived-noise anchor with muted styling', () => {
  const sections = makeEmptySections();
  sections.systemHandled.noiseArchived = 3;
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);

  expect(html).toContain('Noise archived: 3');
  expect(html).toContain('href="https://mail.google.com/mail/u/0/#label/agent-ai%2Fnoise"');
  expect(html).toContain('Review archived noise');
  expect(html).toContain(`color:${T.mutedTextColor}`);
});

test('noiseArchived = 0 renders the count but no archived-noise anchor', () => {
  const sections = makeEmptySections();
  sections.systemHandled.noiseArchived = 0;
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);

  expect(html).toContain('Noise archived: 0');
  expect(html).not.toContain('agent-ai%2Fnoise');
});

// ── Reliability ───────────────────────────────────────────────────────────────

test('reliability section renders when errors > 0', () => {
  const sections = makeEmptySections();
  sections.reliability = { errors: 2, retries: 1, threadingSkipped: 0 };
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).toContain('Reliability');
  expect(html).toContain('Errors: 2');
});

test('reliability section absent when all zero', () => {
  const { html } = renderEmailHtml(makeEmptySections(), BASE_AGENT, NOW);
  expect(html).not.toContain('Reliability');
});

// ── HTML structure ────────────────────────────────────────────────────────────

test('output is valid HTML with DOCTYPE, head, body', () => {
  const { html } = renderEmailHtml(makeEmptySections(), BASE_AGENT, NOW);
  expect(html).toContain('<!DOCTYPE html>');
  expect(html).toContain('<head>');
  expect(html).toContain('<body');
  expect(html).toContain('</body>');
  expect(html).toContain('</html>');
});

test('urgent row text and button both appear in output for HOT with property reference', () => {
  const sections = makeEmptySections();
  sections.urgent = [{
    firstName: 'Sarah', lastInitial: 'K', category: 'HOT',
    propertyReference: '45 Maple', hoursAwaiting: null, rowIndex: 3,
    phone: '+16475551234', gmailThreadId: 'thread-abc', leadId: 'lead@example.com',
  }];
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  // Row text: "Sarah K — wants to call you today — 45 Maple"
  expect(html).toContain('Sarah K');
  expect(html).toContain('wants to call you today');
  expect(html).toContain('45 Maple');
  // Button
  expect(html).toContain('Call Sarah');
});
