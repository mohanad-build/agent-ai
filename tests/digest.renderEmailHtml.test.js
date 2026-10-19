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
  const sections = makeEmptySections();
  sections.systemHandled.intaken = 1;
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
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
  expect(html).toContain('Leads: quiet overnight.');
  expect(html).toContain('None need you');
});

test('systemHandled totals to exactly 1 lead, singular "lead", "follow-ups" stays plural at zero', () => {
  const sections = makeEmptySections();
  sections.systemHandled.intaken = 1;
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).toContain('Leads: handled 1 overnight (1 new). None need you.');
});

test('exactly 1 follow-up fired, total other than 1, singular "follow-up", plural "leads"', () => {
  const sections = makeEmptySections();
  sections.systemHandled.intaken = 2;
  sections.systemHandled.followUpsFired = 1;
  sections.systemHandled.noiseFiltered = 3;
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).toContain('Leads: handled 3 overnight (2 new, 1 follow-up). None need you.');
});

test('noise-only night: noiseFiltered > 0, intaken and followUpsFired both 0, opener reads quiet overnight', () => {
  const sections = makeEmptySections();
  sections.systemHandled.noiseFiltered = 1;
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).toContain('Leads: quiet overnight. None need you.');
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

test('needs_review urgent row: Sheet row button with "Open row" label, no Gmail link', () => {
  const sections = makeEmptySections();
  sections.urgent = [{
    firstName: 'John', lastInitial: 'D', category: 'needs_review',
    propertyReference: null, hoursAwaiting: null, rowIndex: 4,
    phone: '', gmailThreadId: 'thread-needs', leadId: 'jd@example.com',
  }];
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).toContain('href="https://docs.google.com/spreadsheets/d/sheet-abc/edit#gid=0&amp;range=A4"');
  expect(html).toContain('Open row');
  expect(html).not.toContain('mail.google.com');
});

test('needs_review urgent row with no Sheet: search-your-inbox instruction, no button', () => {
  const sections = makeEmptySections();
  sections.urgent = [{
    firstName: 'John', lastInitial: 'D', category: 'needs_review',
    propertyReference: null, hoursAwaiting: null, rowIndex: 4,
    phone: '', gmailThreadId: 'thread-needs', leadId: 'jd@example.com',
  }];
  const agentNoSheet = { timezone: 'America/Toronto' };
  const { html } = renderEmailHtml(sections, agentNoSheet, NOW);
  expect(html).toContain('Search your inbox for: jd@example.com');
  expect(html).not.toContain('<a href=');
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

test('path1b urgent row: Sheet row button with "Open row" label, no Gmail link', () => {
  const sections = makeEmptySections();
  sections.urgent = [{
    firstName: 'Mike', lastInitial: 'T', category: 'path1b',
    propertyReference: null, hoursAwaiting: 26, rowIndex: 5,
    phone: '', gmailThreadId: 'thread-p1b', leadId: 'mt@example.com',
  }];
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).toContain('href="https://docs.google.com/spreadsheets/d/sheet-abc/edit#gid=0&amp;range=A5"');
  expect(html).toContain('Open row');
  expect(html).not.toContain('mail.google.com');
});

// ── Fallback button (HOT no phone → thread) ───────────────────────────────────

test('HOT row with no phone falls back to a Sheet row button labeled "Open row", no Gmail link', () => {
  const sections = makeEmptySections();
  sections.urgent = [{
    firstName: 'Sarah', lastInitial: 'K', category: 'HOT',
    propertyReference: '45 Maple', hoursAwaiting: null, rowIndex: 3,
    phone: '', gmailThreadId: 'thread-fallback', leadId: 'lead@example.com',
  }];
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).toContain('href="https://docs.google.com/spreadsheets/d/sheet-abc/edit#gid=0&amp;range=A3"');
  expect(html).toContain('Open row');
  expect(html).not.toContain('tel:');
  expect(html).not.toContain('mail.google.com');
});

test('HOT row with no phone and no Sheet falls back to the search-your-inbox instruction', () => {
  const sections = makeEmptySections();
  sections.urgent = [{
    firstName: 'Sarah', lastInitial: 'K', category: 'HOT',
    propertyReference: '45 Maple', hoursAwaiting: null, rowIndex: 3,
    phone: '', gmailThreadId: 'thread-fallback', leadId: 'lead@example.com',
  }];
  const agentNoSheet = { timezone: 'America/Toronto' };
  const { html } = renderEmailHtml(sections, agentNoSheet, NOW);
  expect(html).toContain('Search your inbox for: lead@example.com');
  expect(html).not.toContain('mail.google.com');
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

test('hot leads row with cooling=true renders the cooling marker', () => {
  const sections = makeEmptySections();
  sections.hotLeads = [{
    firstName: 'Bob', lastInitial: 'R', propertyReference: '77 Elm',
    daysAgo: 25, whyHot: '', rowIndex: 6,
    phone: '+16475559999', gmailThreadId: '', leadId: 'br@example.com',
    cooling: true,
  }];
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).toContain('last touch 25d ago (cooling, no activity 21d+)');
  expect(html).toContain('href="mailto:assistant@getklosed.ca?subject=CALLED%20br%40example.com');
  expect(html).toContain('Called Bob? Tap to clear and add a note');
});

test('hot leads row with cooling=false does not render the cooling marker', () => {
  const sections = makeEmptySections();
  sections.hotLeads = [{
    firstName: 'Bob', lastInitial: 'R', propertyReference: '77 Elm',
    daysAgo: 2, whyHot: '', rowIndex: 6,
    phone: '+16475559999', gmailThreadId: '', leadId: 'br@example.com',
    cooling: false,
  }];
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).not.toContain('cooling');
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

test('systemHandled with all zero counts omits the section entirely, heading included', () => {
  const { html } = renderEmailHtml(makeEmptySections(), BASE_AGENT, NOW);
  expect(html).not.toContain('What the system handled');
  expect(html).not.toContain('New leads:');
});

test('leads unavailable (permission): warning opener, no Handled text, only noiseFiltered in systemHandled', () => {
  const sections = makeEmptySections();
  sections.systemHandled = { noiseFiltered: 3 };
  sections.leads = { status: 'unavailable', errorKind: 'permission' };
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);

  expect(html).toContain("Couldn't read your lead sheet this morning (access denied), so leads aren't in this brief.");
  expect(html).not.toContain('Handled');
  expect(html).toContain('Emails screened out as not a lead: 3');
  expect(html).not.toContain('New leads:');
  expect(html).not.toContain('Follow-ups fired:');
});

test('leads not_configured: What the system handled is omitted entirely, header included', () => {
  const sections = makeEmptySections();
  sections.systemHandled = { preflightSkips: 0, noiseFiltered: 0 };
  sections.leads = { status: 'not_configured', errorKind: null };
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);

  expect(html).not.toContain('What the system handled');
  expect(html).not.toContain('Emails screened out as not a lead:');
});

test('agent brief never mentions pre-flight skips, even when the counter is present on sections', () => {
  const sections = makeEmptySections();
  sections.systemHandled.preflightSkips = 5;
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).not.toContain('Pre-flight');
});

test('noiseFiltered > 0, noiseArchived 0: no bracket, label line still renders, muted styling', () => {
  const sections = makeEmptySections();
  sections.systemHandled.noiseFiltered = 3;
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);

  expect(html).toContain('Emails screened out as not a lead: 3');
  expect(html).not.toContain('moved out of your inbox');
  expect(html).toContain('Find them under the label agent-ai/noise');
  expect(html).not.toContain('<a href="https://mail.google.com');
  expect(html).toContain(`color:${T.mutedTextColor}`);
});

test('noiseFiltered > 0, noiseArchived > 0: bracket renders with the archived count on the same line', () => {
  const sections = makeEmptySections();
  sections.systemHandled.noiseFiltered = 3;
  sections.systemHandled.noiseArchived = 2;
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);

  expect(html).toContain('Emails screened out as not a lead: 3 (2 moved out of your inbox)');
  expect(html).toContain('Find them under the label agent-ai/noise');
});

test('noiseArchived > 0 with noiseFiltered 0 (should not happen in practice): row and label line both stay hidden, gated on noiseFiltered not noiseArchived', () => {
  const sections = makeEmptySections();
  sections.systemHandled.noiseArchived = 2;
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);

  expect(html).not.toContain('moved out of your inbox');
  expect(html).not.toContain('agent-ai/noise');
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
  // Row text: "Sarah K — flagged hot — 45 Maple"
  expect(html).toContain('Sarah K');
  expect(html).toContain('flagged hot');
  expect(html).toContain('45 Maple');
  // Button
  expect(html).toContain('Call Sarah');
});

test('CALLED affordance renders a mailto link for a HOT row with a leadId', () => {
  const sections = makeEmptySections();
  sections.urgent = [{
    firstName: 'Sarah', lastInitial: 'K', category: 'HOT',
    propertyReference: '45 Maple', hoursAwaiting: null, ageHours: null, rowIndex: 3,
    phone: '+16475551234', gmailThreadId: 'thread-abc', leadId: 'sarah@example.com',
  }];
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).toContain('href="mailto:assistant@getklosed.ca?subject=CALLED%20sarah%40example.com');
  expect(html).toContain('&amp;body=');
  expect(html).toContain('Called Sarah? Tap to clear and add a note');
  expect(html).not.toContain('sms:');
  expect(html).not.toContain('Tip: text CALLED');
});

test('CALLED affordance is absent for a HOT row with an empty leadId', () => {
  const sections = makeEmptySections();
  sections.urgent = [{
    firstName: 'Sarah', lastInitial: 'K', category: 'HOT',
    propertyReference: '45 Maple', hoursAwaiting: null, ageHours: null, rowIndex: 3,
    phone: '+16475551234', gmailThreadId: 'thread-abc', leadId: '',
  }];
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).not.toContain('CALLED');
});

test('CALLED affordance is absent for a needs_review row, even with a leadId', () => {
  const sections = makeEmptySections();
  sections.urgent = [{
    firstName: 'John', lastInitial: 'D', category: 'needs_review',
    propertyReference: null, hoursAwaiting: null, ageHours: null, rowIndex: 5,
    phone: null, gmailThreadId: 'thread-xyz', leadId: 'john@example.com',
  }];
  const { html } = renderEmailHtml(sections, BASE_AGENT, NOW);
  expect(html).not.toContain('CALLED');
});
