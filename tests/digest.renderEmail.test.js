'use strict';

const { renderEmail } = require('../src/digest');

// 2026-05-12 12:00 UTC = 08:00 EDT (America/Toronto, UTC-4 in May) — Tuesday, May 12
const NOW = new Date('2026-05-12T12:00:00Z');

const BASE_AGENT_CONFIG = {
  timezone: 'America/Toronto',
  googleSheetId: 'sheet-abc',
};

function makeEmptySections() {
  return {
    urgent: [],
    hotLeads: [],
    newToReview: [],
    followUpsDue: [],
    followUpsFiredOvernight: [],
    systemHandled: {
      intaken: 0,
      followUpsFired: 0,
      preflightSkips: 0,
    },
    reliability: { errors: 0, retries: 0, threadingSkipped: 0 },
  };
}

test('quiet day — subject is date-formatted, body has systemHandled only', () => {
  const sections = makeEmptySections();
  const result = renderEmail(sections, BASE_AGENT_CONFIG, NOW);

  expect(result.subject).toBe('Your morning brief — Tuesday, May 12');
  expect(result.body).toContain('— What the system handled —');
  expect(result.body).not.toContain('— Needs you today —');
  expect(result.body).not.toContain('— Hot leads to call today —');
  expect(result.body).not.toContain('— Reliability —');
  expect(result.body).toContain('0 need you today.');
  expect(result.body).toContain('Leads intaken: 0');
});

test('day with one urgent HOT lead — subject names the lead, Needs you today section renders', () => {
  const sections = makeEmptySections();
  sections.urgent = [{
    firstName: 'Sarah', lastInitial: 'K',
    category: 'HOT', propertyReference: '45 Maple',
    hoursAwaiting: null, rowIndex: 3,
  }];

  const result = renderEmail(sections, BASE_AGENT_CONFIG, NOW);

  expect(result.subject).toBe('Your morning brief — Sarah needs you today');
  expect(result.body).toContain('— Needs you today —');
  expect(result.body).toContain('Sarah K');
  expect(result.body).toContain('— What the system handled —');
  expect(result.body).not.toContain('Handled');
  expect(result.body).not.toContain('this morning');
});

test('reliability errors > 0 — Reliability section renders', () => {
  const sections = makeEmptySections();
  sections.reliability = { errors: 2, retries: 1, threadingSkipped: 0 };

  const result = renderEmail(sections, BASE_AGENT_CONFIG, NOW);

  expect(result.body).toContain('— Reliability —');
  expect(result.body).toContain('Errors: 2');
  expect(result.body).toContain('Retries: 1');
});

test('reliability all zero — Reliability section does not render', () => {
  const sections = makeEmptySections();
  const result = renderEmail(sections, BASE_AGENT_CONFIG, NOW);
  expect(result.body).not.toContain('— Reliability —');
});

test('Sheet links present when googleSheetId set — hot lead row includes full link', () => {
  const sections = makeEmptySections();
  sections.hotLeads = [{
    firstName: 'John', lastInitial: 'D',
    propertyReference: '45 Oak', daysAgo: 3, whyHot: 'called twice', rowIndex: 5,
  }];

  const result = renderEmail(sections, BASE_AGENT_CONFIG, NOW);

  expect(result.body).toContain(
    'https://docs.google.com/spreadsheets/d/sheet-abc/edit#gid=0&range=A5'
  );
});

test('Sheet links absent when googleSheetId undefined — no link in body, no throw', () => {
  const sections = makeEmptySections();
  sections.hotLeads = [{
    firstName: 'John', lastInitial: 'D',
    propertyReference: '45 Oak', daysAgo: 3, whyHot: 'called twice', rowIndex: 5,
  }];
  const agentConfigNoSheet = { timezone: 'America/Toronto' };

  const result = renderEmail(sections, agentConfigNoSheet, NOW);

  expect(result.body).not.toContain('https://docs.google.com/spreadsheets/d/');
  expect(result.body).toContain('John D');
});

test('shadow mode rows use shadow header; live mode rows use live header', () => {
  const sections = makeEmptySections();

  // Shadow
  sections.followUpsFiredOvernight = [{
    firstName: 'Jane', lastInitial: 'S', touchDay: 3, mode: 'shadow', rowIndex: 7,
  }];
  const shadowResult = renderEmail(sections, BASE_AGENT_CONFIG, NOW);
  expect(shadowResult.body).toContain('— Follow-ups fired overnight (shadow drafts) —');
  expect(shadowResult.body).toContain('Jane S — Day 3 — draft in inbox');

  // Live
  sections.followUpsFiredOvernight = [{
    firstName: 'Jane', lastInitial: 'S', touchDay: 7, mode: 'live', rowIndex: 7,
  }];
  const liveResult = renderEmail(sections, BASE_AGENT_CONFIG, NOW);
  expect(liveResult.body).toContain('— Follow-ups sent overnight —');
  expect(liveResult.body).toContain('Jane S — Day 7 — sent');
});

// ── Option A plaintext action lines ──────────────────────────────────────────

test('urgent HOT row with phone — body contains tel: action line', () => {
  const sections = makeEmptySections();
  sections.urgent = [{
    firstName: 'Sarah', lastInitial: 'K', category: 'HOT',
    propertyReference: '45 Maple', hoursAwaiting: null, rowIndex: 3,
    phone: '+16475551234', gmailThreadId: '', leadId: 'lead@example.com',
  }];
  const result = renderEmail(sections, BASE_AGENT_CONFIG, NOW);
  expect(result.body).toContain('→ Call Sarah: tel:+16475551234');
});

test('urgent needs_review with thread — body contains mail.google.com action line', () => {
  const sections = makeEmptySections();
  sections.urgent = [{
    firstName: 'John', lastInitial: 'D', category: 'needs_review',
    propertyReference: null, hoursAwaiting: null, rowIndex: 4,
    phone: '', gmailThreadId: 'thread-xyz', leadId: 'jd@example.com',
  }];
  const result = renderEmail(sections, BASE_AGENT_CONFIG, NOW);
  expect(result.body).toContain('→ Open thread: https://mail.google.com/mail/u/0/#inbox/thread-xyz');
});

test('hot lead with no phone or thread — body contains docs.google.com action line', () => {
  const sections = makeEmptySections();
  sections.hotLeads = [{
    firstName: 'John', lastInitial: 'D', propertyReference: '45 Oak',
    daysAgo: 3, whyHot: '', rowIndex: 5,
    phone: '', gmailThreadId: '', leadId: 'jd@example.com',
  }];
  const result = renderEmail(sections, BASE_AGENT_CONFIG, NOW);
  expect(result.body).toContain(
    '→ Open row: https://docs.google.com/spreadsheets/d/sheet-abc/edit#gid=0&range=A5'
  );
});

test('when buildActionLink returns null — no arrow action line rendered', () => {
  const sections = makeEmptySections();
  // operatorEscalated with no googleSheetId → buildActionLink returns null
  sections.urgent = [{
    firstName: 'Eve', lastInitial: 'C', category: 'operatorEscalated',
    propertyReference: '10 Pine', hoursAwaiting: null, rowIndex: 9,
    phone: '', gmailThreadId: '', leadId: 'ec@example.com',
  }];
  const agentNoSheet = { timezone: 'America/Toronto' };
  const result = renderEmail(sections, agentNoSheet, NOW);
  expect(result.body).toContain('Eve C');
  expect(result.body).not.toContain('→');
});

test('systemHandled with all zero counts renders exactly the three Path B lines', () => {
  const sections = makeEmptySections();
  const result = renderEmail(sections, BASE_AGENT_CONFIG, NOW);

  expect(result.body).toContain('— What the system handled —');
  expect(result.body).toContain('Leads intaken: 0');
  expect(result.body).toContain('Follow-ups fired: 0');
  expect(result.body).toContain('Pre-flight skips this week: 0');
  expect(result.body).not.toContain('Noise filtered:');
  expect(result.body).not.toContain('Business correspondence ignored:');
  expect(result.body).not.toContain('HOT alerts sent:');
});

test('systemHandled section renders the Noise filtered line when the field is present', () => {
  const sections = makeEmptySections();
  sections.systemHandled.noiseFiltered = 4;
  const result = renderEmail(sections, BASE_AGENT_CONFIG, NOW);

  expect(result.body).toContain('— What the system handled —');
  expect(result.body).toContain('Noise filtered: 4');
});
