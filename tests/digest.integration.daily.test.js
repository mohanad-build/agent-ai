'use strict';

jest.mock('../src/twilio');
jest.mock('../src/email');
jest.mock('../src/agentState');

const twilioMod    = require('../src/twilio');
const emailMod     = require('../src/email');
const agentStateMod = require('../src/agentState');
const { runDailyDigestForAgent } = require('../src/digest');

// MOCK_NOW: Wednesday 2026-05-13T11:30:00.000Z = 07:30 EDT
// Window: 2026-05-12T11:30:00.000Z  to  2026-05-13T11:30:00.000Z (trailing 24h)
const MOCK_NOW_ISO = '2026-05-13T11:30:00.000Z';

// Fixed timestamps (in window unless noted)
const T_MINUS_2H  = '2026-05-13T09:30:00.000Z';  // in window
const T_MINUS_3H  = '2026-05-13T08:30:00.000Z';  // in window
const T_MINUS_4H  = '2026-05-13T07:30:00.000Z';  // in window
const T_MINUS_6H  = '2026-05-13T05:30:00.000Z';  // in window
const T_MINUS_26H = '2026-05-12T09:30:00.000Z';  // before window start (09:30 < 11:30 May 12)
const T_MINUS_48H = '2026-05-11T11:30:00.000Z';  // before window
const T_MINUS_60H = '2026-05-10T23:30:00.000Z';  // before window (= MOCK_NOW - 2.5d)
const T_MINUS_3D  = '2026-05-10T11:30:00.000Z';  // before window
const T_MINUS_5D  = '2026-05-08T11:30:00.000Z';  // before window

const AGENT = {
  agentId:        'test-agent',
  agentName:      'Test Agent',
  agentEmail:     'agent@example.com',
  agentPhone:     '+15555550199',
  agentSignature: 'Best, Test Agent',
  gmailAddress:   'agent@example.com',
  isActive:       true,
  mode:           'shadow',
  timezone:       'America/Toronto',
  digestTime:     '07:00',
  googleSheetId:  'fake-sheet-id',
  escalationEmail: 'mo@example.com',
  followUpCadence: [3, 7, 14],
};

let _rowCounter = 0;

function makeRow(overrides) {
  _rowCounter++;
  return {
    leadId:              `lead-${_rowCounter}@example.com`,
    name:                `Test Lead ${_rowCounter}`,
    phone:               '+15555550100',
    source:              '',
    dateAdded:           '',
    originalMessage:     '',
    status:              'in_conversation',
    followUpCount:       '0',
    nextFollowUpDay:     '',
    lastFollowUpDate:    '',
    reserved:            '',
    conversationHistory: '',
    pendingQuestion:     '',
    gmailThreadId:       '',
    aiEnabled:           '',
    lastActionTimestamp: T_MINUS_4H,
    reminderSent:        '',
    validationStatus:    '',
    operatorEscalated:   '',
    leadCategory:        '',
    rowIndex:            _rowCounter + 1,
    ...overrides,
  };
}

function makeColumnL(entries) {
  return entries.map(e => `[${e.timestamp}] ${e.text}`).join('\n');
}

// Splits body on `\n\n<em-dash> ` boundaries.
// Returns { opener, key1: content, key2: content, ... }
// Key = section title lowercased with non-alnum replaced by underscores.
function parseSections(emailBody) {
  const EM = '—';
  // When urgent rows exist the email leads directly with a section header (no opener).
  // Prepend \n\n so the split delimiter catches it too.
  const normalized = emailBody.startsWith(`${EM} `) ? `\n\n${emailBody}` : emailBody;
  const chunks = normalized.split(`\n\n${EM} `);
  const result = { opener: chunks[0].trim() };
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const titleEnd = chunk.indexOf(` ${EM}`);
    if (titleEnd === -1) continue;
    const title   = chunk.slice(0, titleEnd).trim();
    const content = chunk.slice(titleEnd + 2).replace(/^\n+/, '').trim();
    const key = title.toLowerCase()
      .replace(/[()]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    result[key] = content;
  }
  return result;
}

let _origMockNow;

beforeEach(() => {
  _origMockNow = process.env.MOCK_NOW;
  process.env.MOCK_NOW = MOCK_NOW_ISO;
  _rowCounter = 0;

  agentStateMod.getState.mockReturnValue({
    lastDailyDigestRun:   null,
    weeklyPreflightSkips: 0,
    lastTokenIssued:      0,
  });
  emailMod.readSheetRows.mockResolvedValue([]);
  emailMod.appendToConversationHistory.mockResolvedValue();
  emailMod.sendNewEmail.mockResolvedValue();
  twilioMod.sendSMS.mockResolvedValue();
});

afterEach(() => {
  if (_origMockNow === undefined) {
    delete process.env.MOCK_NOW;
  } else {
    process.env.MOCK_NOW = _origMockNow;
  }
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

function makeFixtureRows() {
  return [
    // 1. HOT: urgent (HOT) + hotLeads, trigger = T-2H (most recent)
    makeRow({
      name:                'Alice Harris',
      status:              'HOT',
      lastActionTimestamp: T_MINUS_2H,
      conversationHistory: makeColumnL([
        { timestamp: T_MINUS_48H, text: 'Heuristic intake (confidence 0.90): lead inquired' },
      ]),
    }),

    // 2. needs_review: urgent (needs_review), trigger = T-3H
    makeRow({
      name:                'Bob Martinez',
      status:              'needs_review',
      lastActionTimestamp: T_MINUS_3H,
      conversationHistory: makeColumnL([
        { timestamp: T_MINUS_48H, text: 'Heuristic intake (confidence 0.90): lead inquired' },
      ]),
    }),

    // 3. awaiting_agent 26h ago: urgent (path1b), trigger = T-26H
    makeRow({
      name:                'Carol White',
      status:              'awaiting_agent',
      lastActionTimestamp: T_MINUS_26H,
      conversationHistory: makeColumnL([
        { timestamp: T_MINUS_48H, text: 'Heuristic intake (confidence 0.90): lead inquired' },
      ]),
    }),

    // 4. operatorEscalated 3d ago (within 7d): urgent (operatorEscalated)
    makeRow({
      name:                'David Chen',
      status:              'in_conversation',
      lastActionTimestamp: T_MINUS_4H,
      operatorEscalated:   T_MINUS_3D,
      conversationHistory: makeColumnL([
        { timestamp: T_MINUS_48H, text: 'Heuristic intake (confidence 0.90): lead inquired' },
      ]),
    }),

    // 5. new + aiEnabled=FALSE + created in window: newToReview
    makeRow({
      name:                'Eva Patel',
      status:              'new',
      aiEnabled:           'FALSE',
      conversationHistory: makeColumnL([
        { timestamp: T_MINUS_2H, text: 'Heuristic intake (confidence 0.90): lead inquired' },
      ]),
    }),

    // 6. awaiting_response, Day 3 eligible in 12h: followUpsDue
    // refTimestamp = T-60H, nextTouchDay=3, eligibleAt = T-60H+72H = T+12H
    makeRow({
      name:                'Frank Kim',
      status:              'awaiting_response',
      followUpCount:       '0',
      lastActionTimestamp: T_MINUS_60H,
      conversationHistory: makeColumnL([
        { timestamp: T_MINUS_48H, text: 'Heuristic intake (confidence 0.90): lead inquired' },
      ]),
    }),

    // 7. Day 3 follow-up fired at T-6H (in window): followUpsFiredOvernight
    makeRow({
      name:                'Grace Okafor',
      status:              'in_conversation',
      lastActionTimestamp: T_MINUS_4H,
      conversationHistory: makeColumnL([
        { timestamp: T_MINUS_48H, text: 'Heuristic intake (confidence 0.90): lead inquired' },
        { timestamp: T_MINUS_6H,  text: 'Follow-up Day 3 sent (shadow)' },
      ]),
    }),

    // 8. background: in_conversation, no urgency signals
    makeRow({
      name:                'Henry Park',
      status:              'in_conversation',
      lastActionTimestamp: T_MINUS_4H,
      conversationHistory: makeColumnL([
        { timestamp: T_MINUS_48H, text: 'Heuristic intake (confidence 0.90): lead inquired' },
      ]),
    }),

    // 9. SOI: leadCategory=soi, no urgency triggers
    makeRow({
      name:                'Iris Ngozi',
      status:              'in_conversation',
      leadCategory:        'soi',
      lastActionTimestamp: T_MINUS_4H,
      conversationHistory: makeColumnL([
        { timestamp: T_MINUS_48H, text: 'Heuristic intake (confidence 0.90): lead inquired' },
      ]),
    }),

    // 10. new + aiEnabled=FALSE but column L first entry BEFORE window: not newToReview
    makeRow({
      name:                'James Wilson',
      status:              'new',
      aiEnabled:           'FALSE',
      conversationHistory: makeColumnL([
        { timestamp: T_MINUS_5D, text: 'Heuristic intake (confidence 0.90): lead inquired' },
      ]),
    }),
  ];
}

// ---------------------------------------------------------------------------
// Integration suite
// ---------------------------------------------------------------------------

describe('runDailyDigestForAgent integration', () => {
  let capturedEmailArgs;
  let capturedSmsArgs;

  beforeEach(async () => {
    emailMod.readSheetRows.mockResolvedValue(makeFixtureRows());
    emailMod.sendNewEmail.mockImplementation(async (_cfg, opts) => {
      capturedEmailArgs = opts;
    });
    twilioMod.sendSMS.mockImplementation(async (_cfg, body) => {
      capturedSmsArgs = body;
    });
    await runDailyDigestForAgent(AGENT);
  });

  test('sends SMS and email exactly once each', () => {
    expect(twilioMod.sendSMS).toHaveBeenCalledTimes(1);
    expect(emailMod.sendNewEmail).toHaveBeenCalledTimes(1);
  });

  test('subject line is canonical', () => {
    // urgent.length > 0 so subject names the top urgent lead (Alice, sorted by trigger timestamp)
    const EM = '—';
    expect(capturedEmailArgs.subject).toBe(`Your morning brief ${EM} Alice needs you today`);
  });

  test('SMS line 1 is canonical', () => {
    // intaken=1 (Eva, row 5), followUpsFired=1 (Grace, row 7), noiseFiltered=0
    const line1 = capturedSmsArgs.split('\n')[0];
    expect(line1).toBe('Handled 2 leads overnight: 1 new, 1 follow-ups, 0 filtered.');
  });

  test('urgent section contains all four urgent leads and excludes background row', () => {
    const sections = parseSections(capturedEmailArgs.body);
    expect(sections.needs_you_today).toContain('Alice');
    expect(sections.needs_you_today).toContain('Bob');
    expect(sections.needs_you_today).toContain('Carol');
    expect(sections.needs_you_today).toContain('David');
    expect(sections.needs_you_today).not.toContain('Henry');
  });

  test('newToReview section contains row 5 but not row 10', () => {
    const sections = parseSections(capturedEmailArgs.body);
    expect(sections.possible_new_leads_to_review).toContain('Eva');
    expect(sections.possible_new_leads_to_review).not.toContain('James');
  });

  test('followUpsDue section contains row 6', () => {
    const sections = parseSections(capturedEmailArgs.body);
    expect(sections.follow_ups_due_today).toContain('Frank');
  });

  test('followUpsFiredOvernight section contains row 7', () => {
    const sections = parseSections(capturedEmailArgs.body);
    // shadow mode agent: header is "Follow-ups fired overnight (shadow drafts)"
    const key = Object.keys(sections).find(k => k.startsWith('follow_ups_fired_overnight'));
    expect(key).toBeDefined();
    expect(sections[key]).toContain('Grace');
  });

  test('SOI row 9 absent from entire email body', () => {
    expect(capturedEmailArgs.body).not.toContain('Iris');
  });

  test('sendNewEmail called with html field that is a valid HTML string', () => {
    expect(typeof capturedEmailArgs.html).toBe('string');
    expect(capturedEmailArgs.html).toContain('<!DOCTYPE html>');
    expect(capturedEmailArgs.html).toContain('<body');
  });

  test('html field and body field both present in the same sendNewEmail call', () => {
    expect(capturedEmailArgs).toHaveProperty('body');
    expect(capturedEmailArgs).toHaveProperty('html');
    expect(capturedEmailArgs.body).not.toContain('<!DOCTYPE');
  });
});
