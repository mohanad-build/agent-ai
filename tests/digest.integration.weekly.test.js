'use strict';

jest.mock('../src/twilio');
jest.mock('../src/email');
jest.mock('../src/operatorState');
jest.mock('../src/agentState');
jest.mock('../src/agentConfig', () => ({
  loadAgent:               jest.fn(),
  getFollowUpCadence:      jest.fn().mockReturnValue([3, 7, 14]),
  findAgentByPhone:        jest.fn(),
  isLeadCategoryActionable: jest.fn().mockReturnValue(true),
}));

const fs             = require('fs');
const twilioMod      = require('../src/twilio');
const emailMod       = require('../src/email');
const agentStateMod  = require('../src/agentState');
const agentConfigMod = require('../src/agentConfig');
const { runWeeklyDigestForOperator } = require('../src/digest');

// MOCK_NOW: Sunday 2026-05-17T12:30:00.000Z = 08:30 EDT
// 7-day window: 2026-05-10T12:30:00.000Z  to  2026-05-17T12:30:00.000Z
const MOCK_NOW_ISO     = '2026-05-17T12:30:00.000Z';
const WEEKLY_IN_WINDOW = '2026-05-11T12:30:00.000Z';  // window start + 1d

const OPERATOR = {
  operatorId:    'test-op',
  operatorName:  'Test Operator',
  operatorEmail: 'op@example.com',
  operatorPhone: '+15555550101',
  timezone:      'America/Toronto',
  digestTime:    '08:00',
  gmailAddress:  'op@example.com',
};

const AGENT1 = {
  agentId:         'active-1',
  agentName:       'Active One',
  isActive:        true,
  mode:            'shadow',
  timezone:        'America/Toronto',
  agentEmail:      'active1@example.com',
  agentPhone:      '+15555550201',
  gmailAddress:    'active1@example.com',
  googleSheetId:   'sheet-active-1',
  followUpCadence: [3, 7, 14],
};

const AGENT2 = {
  agentId:         'active-2',
  agentName:       'Active Two',
  isActive:        true,
  mode:            'shadow',
  timezone:        'America/Toronto',
  agentEmail:      'active2@example.com',
  agentPhone:      '+15555550202',
  gmailAddress:    'active2@example.com',
  googleSheetId:   'sheet-active-2',
  followUpCadence: [3, 7, 14],
};

// One intake row for active-1 (created inside the 7-day window).
const ACTIVE1_ROW = {
  leadId:              'wlead-1@example.com',
  name:                'Weekly Lead One',
  phone:               '',
  source:              '',
  dateAdded:           '',
  originalMessage:     '',
  status:              'in_conversation',
  followUpCount:       '0',
  nextFollowUpDay:     '',
  lastFollowUpDate:    '',
  reserved:            '',
  conversationHistory: `[${WEEKLY_IN_WINDOW}] Heuristic intake (confidence 0.90): lead inquired`,
  pendingQuestion:     '',
  gmailThreadId:       '',
  aiEnabled:           '',
  lastActionTimestamp: WEEKLY_IN_WINDOW,
  reminderSent:        '',
  validationStatus:    '',
  operatorEscalated:   '',
  leadCategory:        '',
  rowIndex:            2,
};

// Splits body on `\n\n<em-dash> ` boundaries.
function parseSections(emailBody) {
  const EM = '—';
  const chunks = emailBody.split(`\n\n${EM} `);
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
let _fsSpy_existsSync;
let _fsSpy_readdirSync;

beforeEach(() => {
  _origMockNow = process.env.MOCK_NOW;
  process.env.MOCK_NOW = MOCK_NOW_ISO;

  _fsSpy_existsSync  = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
  _fsSpy_readdirSync = jest.spyOn(fs, 'readdirSync').mockReturnValue(['active-1.json', 'active-2.json']);

  agentConfigMod.loadAgent.mockImplementation(agentId => {
    if (agentId === 'active-1') return AGENT1;
    if (agentId === 'active-2') return AGENT2;
    throw new Error(`Unknown agent: ${agentId}`);
  });

  agentStateMod.getState.mockReturnValue({ weeklyPreflightSkips: 0, deactivatedAt: null });
  agentStateMod.resetWeeklyPreflightSkips.mockReturnValue(undefined);

  emailMod.readSheetRows.mockImplementation(agentCfg => {
    if (agentCfg.agentId === 'active-1') return Promise.resolve([ACTIVE1_ROW]);
    return Promise.resolve([]);
  });
  emailMod.sendNewEmail.mockResolvedValue();
  twilioMod.sendSMS.mockResolvedValue();
});

afterEach(() => {
  if (_origMockNow === undefined) {
    delete process.env.MOCK_NOW;
  } else {
    process.env.MOCK_NOW = _origMockNow;
  }
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Integration suite
// ---------------------------------------------------------------------------

describe('runWeeklyDigestForOperator integration', () => {
  // pollFn mock: active-1 = 3+2+1, active-2 = 1+1+0
  const mockPoll = jest.fn().mockImplementation(agentCfg => {
    if (agentCfg.agentId === 'active-1') {
      return Promise.resolve({ sentAsIs: 3, editedThenSent: 2, rejected: 1 });
    }
    return Promise.resolve({ sentAsIs: 1, editedThenSent: 1, rejected: 0 });
  });

  let capturedEmailArgs;

  beforeEach(async () => {
    mockPoll.mockClear();
    emailMod.sendNewEmail.mockImplementation(async (_cfg, opts) => {
      capturedEmailArgs = opts;
    });
    await runWeeklyDigestForOperator(OPERATOR, { pollFn: mockPoll });
  });

  test('sends exactly one email', () => {
    expect(emailMod.sendNewEmail).toHaveBeenCalledTimes(1);
  });

  test('email recipient is operator email', () => {
    const EM = '—';
    expect(capturedEmailArgs.to).toBe('op@example.com');
    // subject format: Weekly digest <em-dash> <start> to <end>
    expect(capturedEmailArgs.subject).toBe(`Weekly digest ${EM} May 10 to May 17`);
  });

  test('shadow mode catches section reflects aggregate of both agents', () => {
    const sections = parseSections(capturedEmailArgs.body);
    // sentAsIs: 3+1=4, editedThenSent: 2+1=3, rejected: 1+0=1
    expect(sections.shadow_mode_catches).toContain('Drafts sent as-is by agent: 4');
    expect(sections.shadow_mode_catches).toContain('Drafts edited then sent: 3');
    expect(sections.shadow_mode_catches).toContain('Drafts rejected: 1');
  });

  test('aggregate stats section is present', () => {
    const sections = parseSections(capturedEmailArgs.body);
    expect(sections.aggregate_stats).toContain('Leads handled:');
    expect(sections.aggregate_stats).toContain('Touches fired:');
  });

  test('per-agent breakdown includes both active agents', () => {
    const sections = parseSections(capturedEmailArgs.body);
    expect(sections.per_agent_breakdown).toContain('Active One');
    expect(sections.per_agent_breakdown).toContain('Active Two');
  });

  test('preflight skip counters reset for each active agent', () => {
    expect(agentStateMod.resetWeeklyPreflightSkips).toHaveBeenCalledTimes(2);
    expect(agentStateMod.resetWeeklyPreflightSkips).toHaveBeenCalledWith('active-1');
    expect(agentStateMod.resetWeeklyPreflightSkips).toHaveBeenCalledWith('active-2');
  });

  test('poll function invoked once per active agent', () => {
    expect(mockPoll).toHaveBeenCalledTimes(2);
  });
});
