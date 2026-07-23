'use strict';

jest.mock('../src/email');
jest.mock('../src/agentState');

const emailMod = require('../src/email');
const agentStateMod = require('../src/agentState');
const digestMod = require('../src/digest');
const { gatherWindowData } = digestMod;
const {
  splitName,
  parseColumnLFirstLineTimestamp,
  parseColumnLPropertyReference,
  computeNextTouch,
  findInWindowFollowUpFire,
} = digestMod._internal;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const START_ISO = '2026-05-11T12:00:00Z';
const END_ISO   = '2026-05-12T12:00:00Z';

const BASE_AGENT_CONFIG = {
  agentId: 'agent-1',
  mode: 'live',
  followUpCadence: [3, 7, 14],
};

function makeRawRow(overrides) {
  return {
    leadId: 'lead@example.com',
    name: 'Sarah Khan',
    phone: '',
    status: 'awaiting_response',
    followUpCount: '0',
    lastFollowUpDate: '',
    originalMessage: 'Inquiry',
    conversationHistory: '',
    aiEnabled: 'TRUE',
    lastActionTimestamp: '',
    operatorEscalated: '',
    leadCategory: '',
    dateAdded: '2026-05-12',
    rowIndex: 2,
    ...overrides,
  };
}

function inWindowFireHistory(touchDay) {
  return `[2026-05-12T08:00:00Z] Follow-up Day ${touchDay} sent (live)`;
}

beforeEach(() => {
  emailMod.readSheetRows.mockResolvedValue([]);
  agentStateMod.getState.mockReturnValue({ weeklyPreflightSkips: 0 });
});

// ── gatherWindowData ──────────────────────────────────────────────────────────

test('gatherWindowData: empty sheet → correct return shape with all counters zero', async () => {
  const result = await gatherWindowData(BASE_AGENT_CONFIG, START_ISO, END_ISO);
  expect(result.rows).toEqual([]);
  expect(result.stateCounters.systemHandled).toEqual({ intaken: 0, followUpsFired: 0, preflightSkips: 0, noiseFiltered: 0 });
  expect(result.reliability).toEqual({ errors: 0, retries: 0, threadingSkipped: 0 });
});

// ── noiseFiltered / digestCadence ─────────────────────────────────────────────

test('gatherWindowData: no opts → reads weeklyNoiseFiltered from state', async () => {
  agentStateMod.getState.mockReturnValue({ weeklyPreflightSkips: 0, dailyNoiseFiltered: 5, weeklyNoiseFiltered: 12 });
  const result = await gatherWindowData(BASE_AGENT_CONFIG, START_ISO, END_ISO);
  expect(result.stateCounters.systemHandled.noiseFiltered).toBe(12);
});

test('gatherWindowData: { digestCadence: "daily" } → reads dailyNoiseFiltered from state', async () => {
  agentStateMod.getState.mockReturnValue({ weeklyPreflightSkips: 0, dailyNoiseFiltered: 5, weeklyNoiseFiltered: 12 });
  const result = await gatherWindowData(BASE_AGENT_CONFIG, START_ISO, END_ISO, { digestCadence: 'daily' });
  expect(result.stateCounters.systemHandled.noiseFiltered).toBe(5);
});

test('gatherWindowData: systemHandled.noiseFiltered is present (0) when state has no counters, not omitted', async () => {
  agentStateMod.getState.mockReturnValue({});
  const result = await gatherWindowData(BASE_AGENT_CONFIG, START_ISO, END_ISO);
  expect('noiseFiltered' in result.stateCounters.systemHandled).toBe(true);
  expect(result.stateCounters.systemHandled.noiseFiltered).toBe(0);
});

// ── noiseArchived / isInboxCleaningEnabled ────────────────────────────────────

test('gatherWindowData: noiseArchived key omitted entirely when inboxCleaningEnabled is off', async () => {
  const result = await gatherWindowData(BASE_AGENT_CONFIG, START_ISO, END_ISO);
  expect('noiseArchived' in result.stateCounters.systemHandled).toBe(false);
});

test('gatherWindowData: noiseArchived present at 0 when inboxCleaningEnabled is on and state has no counters', async () => {
  agentStateMod.getState.mockReturnValue({});
  const result = await gatherWindowData({ ...BASE_AGENT_CONFIG, inboxCleaningEnabled: true }, START_ISO, END_ISO);
  expect('noiseArchived' in result.stateCounters.systemHandled).toBe(true);
  expect(result.stateCounters.systemHandled.noiseArchived).toBe(0);
});

test('gatherWindowData: row created in window via column L timestamp → intaken=1', async () => {
  const history = '[2026-05-12T08:00:00Z] Heuristic intake (confidence 0.90): inquiry';
  emailMod.readSheetRows.mockResolvedValue([makeRawRow({ conversationHistory: history, dateAdded: '' })]);
  const result = await gatherWindowData(BASE_AGENT_CONFIG, START_ISO, END_ISO);
  expect(result.stateCounters.systemHandled.intaken).toBe(1);
});

test('gatherWindowData: row created before window via column L timestamp → intaken=0', async () => {
  const history = '[2026-05-10T08:00:00Z] Heuristic intake (confidence 0.90): inquiry';
  emailMod.readSheetRows.mockResolvedValue([makeRawRow({ conversationHistory: history, dateAdded: '' })]);
  const result = await gatherWindowData(BASE_AGENT_CONFIG, START_ISO, END_ISO);
  expect(result.stateCounters.systemHandled.intaken).toBe(0);
});

test('gatherWindowData: row with in-window follow-up fire line → followUpsFired=1', async () => {
  emailMod.readSheetRows.mockResolvedValue([makeRawRow({ conversationHistory: inWindowFireHistory(3) })]);
  const result = await gatherWindowData(BASE_AGENT_CONFIG, START_ISO, END_ISO);
  expect(result.stateCounters.systemHandled.followUpsFired).toBe(1);
});

test('gatherWindowData: row with out-of-window follow-up fire → followUpsFired=0', async () => {
  const history = '[2026-05-09T08:00:00Z] Follow-up Day 3 sent (live)';
  emailMod.readSheetRows.mockResolvedValue([makeRawRow({ conversationHistory: history })]);
  const result = await gatherWindowData(BASE_AGENT_CONFIG, START_ISO, END_ISO);
  expect(result.stateCounters.systemHandled.followUpsFired).toBe(0);
});

test('gatherWindowData: preflightSkips sourced from agentState.getState()', async () => {
  agentStateMod.getState.mockReturnValue({ weeklyPreflightSkips: 7 });
  const result = await gatherWindowData(BASE_AGENT_CONFIG, START_ISO, END_ISO);
  expect(result.stateCounters.systemHandled.preflightSkips).toBe(7);
});

test('gatherWindowData: weeklyPreflightSkips missing from state → defaults to 0', async () => {
  agentStateMod.getState.mockReturnValue({});
  const result = await gatherWindowData(BASE_AGENT_CONFIG, START_ISO, END_ISO);
  expect(result.stateCounters.systemHandled.preflightSkips).toBe(0);
});

test('gatherWindowData: agentConfig.mode=shadow → row.lastFollowUpFire.mode=shadow', async () => {
  emailMod.readSheetRows.mockResolvedValue([makeRawRow({ conversationHistory: inWindowFireHistory(3) })]);
  const result = await gatherWindowData({ ...BASE_AGENT_CONFIG, mode: 'shadow' }, START_ISO, END_ISO);
  expect(result.rows[0].lastFollowUpFire.mode).toBe('shadow');
});

test('gatherWindowData: agentConfig.mode absent → lastFollowUpFire.mode defaults to live', async () => {
  emailMod.readSheetRows.mockResolvedValue([makeRawRow({ conversationHistory: inWindowFireHistory(7) })]);
  const configNoMode = { agentId: 'agent-1', followUpCadence: [3, 7, 14] };
  const result = await gatherWindowData(configNoMode, START_ISO, END_ISO);
  expect(result.rows[0].lastFollowUpFire.mode).toBe('live');
});

test('gatherWindowData: returned rows have firstName and lastInitial annotated from name', async () => {
  emailMod.readSheetRows.mockResolvedValue([makeRawRow({ name: 'John Doe' })]);
  const result = await gatherWindowData(BASE_AGENT_CONFIG, START_ISO, END_ISO);
  expect(result.rows[0].firstName).toBe('John');
  expect(result.rows[0].lastInitial).toBe('D');
});

test('gatherWindowData: returned rows have propertyReference extracted from column L', async () => {
  const history = '[2026-05-12T08:00:00Z] Heuristic intake (confidence 0.90, property: 45 Maple): inquiry';
  emailMod.readSheetRows.mockResolvedValue([makeRawRow({ conversationHistory: history })]);
  const result = await gatherWindowData(BASE_AGENT_CONFIG, START_ISO, END_ISO);
  expect(result.rows[0].propertyReference).toBe('45 Maple');
});

test('gatherWindowData: row with leadCategory=soi is excluded from returned rows', async () => {
  emailMod.readSheetRows.mockResolvedValue([makeRawRow({ leadCategory: 'soi' })]);
  const result = await gatherWindowData(BASE_AGENT_CONFIG, START_ISO, END_ISO);
  expect(result.rows).toHaveLength(0);
});

test('gatherWindowData: row with leadCategory=soi increments soiFiltered counter', async () => {
  emailMod.readSheetRows.mockResolvedValue([makeRawRow({ leadCategory: 'soi' })]);
  const result = await gatherWindowData(BASE_AGENT_CONFIG, START_ISO, END_ISO);
  expect(result.stateCounters.systemHandled.soiFiltered).toBe(1);
});

test('gatherWindowData: two rows with separate annotations → correct combined counts', async () => {
  const inWindowCreated = '[2026-05-12T08:00:00Z] Heuristic intake (confidence 0.90): inquiry';
  // Row 2: created a week ago (outside window), but has an in-window follow-up fire
  const oldCreatedWithFire = [
    '[2026-05-05T08:00:00Z] Heuristic intake (confidence 0.90): inquiry',
    '[2026-05-12T08:00:00Z] Follow-up Day 7 sent (live)',
  ].join('\n');
  emailMod.readSheetRows.mockResolvedValue([
    makeRawRow({ conversationHistory: inWindowCreated, dateAdded: '', rowIndex: 2 }),
    makeRawRow({ conversationHistory: oldCreatedWithFire, rowIndex: 3 }),
  ]);
  const result = await gatherWindowData(BASE_AGENT_CONFIG, START_ISO, END_ISO);
  expect(result.stateCounters.systemHandled.intaken).toBe(1);
  expect(result.stateCounters.systemHandled.followUpsFired).toBe(1);
  expect(result.rows).toHaveLength(2);
});

// ── splitName ─────────────────────────────────────────────────────────────────

test('splitName: "Sarah Khan" → firstName Sarah, lastInitial K', () => {
  expect(splitName('Sarah Khan')).toEqual({ firstName: 'Sarah', lastInitial: 'K' });
});

test('splitName: single token → firstName set, lastInitial empty', () => {
  expect(splitName('Sarah')).toEqual({ firstName: 'Sarah', lastInitial: '' });
});

test('splitName: "John Paul De Beaumont" → firstName John, lastInitial B (last token)', () => {
  expect(splitName('John Paul De Beaumont')).toEqual({ firstName: 'John', lastInitial: 'B' });
});

test('splitName: empty string → both empty', () => {
  expect(splitName('')).toEqual({ firstName: '', lastInitial: '' });
});

test('splitName: null → both empty', () => {
  expect(splitName(null)).toEqual({ firstName: '', lastInitial: '' });
});

// ── parseColumnLFirstLineTimestamp ────────────────────────────────────────────

test('parseColumnLFirstLineTimestamp: valid [ISO] on first line → returns Date', () => {
  const result = parseColumnLFirstLineTimestamp('[2026-05-12T08:00:00Z] Some entry');
  expect(result).toBeInstanceOf(Date);
  expect(result.toISOString()).toBe('2026-05-12T08:00:00.000Z');
});

test('parseColumnLFirstLineTimestamp: no brackets on first line → null', () => {
  expect(parseColumnLFirstLineTimestamp('No timestamp here')).toBeNull();
});

test('parseColumnLFirstLineTimestamp: empty string → null', () => {
  expect(parseColumnLFirstLineTimestamp('')).toBeNull();
});

test('parseColumnLFirstLineTimestamp: timestamp only on second line → null', () => {
  const history = 'First line no timestamp\n[2026-05-12T08:00:00Z] second line';
  expect(parseColumnLFirstLineTimestamp(history)).toBeNull();
});

// ── parseColumnLPropertyReference ─────────────────────────────────────────────

test('parseColumnLPropertyReference: property segment present → trimmed value', () => {
  const history = '[2026-05-12T08:00:00Z] Heuristic intake (confidence 0.90, property: 45 Maple): inquiry';
  expect(parseColumnLPropertyReference(history)).toBe('45 Maple');
});

test('parseColumnLPropertyReference: confidence only, no property segment → null', () => {
  const history = '[2026-05-12T08:00:00Z] Heuristic intake (confidence 0.90): inquiry';
  expect(parseColumnLPropertyReference(history)).toBeNull();
});

test('parseColumnLPropertyReference: first line not a Heuristic intake line → null', () => {
  expect(parseColumnLPropertyReference('[2026-05-12T08:00:00Z] Some other entry')).toBeNull();
});

test('parseColumnLPropertyReference: empty string → null', () => {
  expect(parseColumnLPropertyReference('')).toBeNull();
});

// ── computeNextTouch ──────────────────────────────────────────────────────────

test('computeNextTouch: awaiting_response followUpCount=0 cadence=[3,7] lastFollowUpDate set → nextTouchDay=3, eligibleAt computed', () => {
  const row = {
    status: 'awaiting_response', followUpCount: '0',
    lastFollowUpDate: '2026-05-09T12:00:00Z', lastActionTimestamp: '',
  };
  const result = computeNextTouch(row, [3, 7]);
  expect(result.nextTouchDay).toBe(3);
  const expected = new Date('2026-05-09T12:00:00Z').getTime() + 3 * 24 * 60 * 60 * 1000;
  expect(new Date(result.nextTouchEligibleAt).getTime()).toBe(expected);
});

test('computeNextTouch: followUpCount equals cadence.length → null, null (cadence exhausted)', () => {
  const row = {
    status: 'awaiting_response', followUpCount: '1',
    lastFollowUpDate: '2026-05-09T12:00:00Z', lastActionTimestamp: '',
  };
  expect(computeNextTouch(row, [3])).toEqual({ nextTouchEligibleAt: null, nextTouchDay: null });
});

test('computeNextTouch: non awaiting_response status → null, null', () => {
  const row = {
    status: 'HOT', followUpCount: '0',
    lastFollowUpDate: '2026-05-09T12:00:00Z', lastActionTimestamp: '',
  };
  expect(computeNextTouch(row, [3, 7])).toEqual({ nextTouchEligibleAt: null, nextTouchDay: null });
});

test('computeNextTouch: no refTimestamp → null, null', () => {
  const row = {
    status: 'awaiting_response', followUpCount: '0',
    lastFollowUpDate: '', lastActionTimestamp: '',
  };
  expect(computeNextTouch(row, [3, 7])).toEqual({ nextTouchEligibleAt: null, nextTouchDay: null });
});

// ── findInWindowFollowUpFire ──────────────────────────────────────────────────

test('findInWindowFollowUpFire: matching line in window → returns { timestamp, touchDay, mode }', () => {
  const history = '[2026-05-12T08:00:00Z] Follow-up Day 3 sent (live)';
  const startMs = new Date(START_ISO).getTime();
  const endMs   = new Date(END_ISO).getTime();
  const result = findInWindowFollowUpFire(history, startMs, endMs, 'live');
  expect(result).not.toBeNull();
  expect(result.touchDay).toBe(3);
  expect(result.mode).toBe('live');
  expect(result.timestamp).toBe('2026-05-12T08:00:00Z');
});

test('findInWindowFollowUpFire: matching line outside window → null', () => {
  const history = '[2026-05-09T08:00:00Z] Follow-up Day 3 sent (live)';
  const startMs = new Date(START_ISO).getTime();
  const endMs   = new Date(END_ISO).getTime();
  expect(findInWindowFollowUpFire(history, startMs, endMs, 'live')).toBeNull();
});

test('findInWindowFollowUpFire: multiple candidates in window → returns most recent by timestamp', () => {
  const history = [
    '[2026-05-11T14:00:00Z] Follow-up Day 3 sent (live)',
    '[2026-05-12T08:00:00Z] Follow-up Day 7 sent (live)',
  ].join('\n');
  const startMs = new Date(START_ISO).getTime();
  const endMs   = new Date(END_ISO).getTime();
  const result = findInWindowFollowUpFire(history, startMs, endMs, 'live');
  expect(result.touchDay).toBe(7);
});
