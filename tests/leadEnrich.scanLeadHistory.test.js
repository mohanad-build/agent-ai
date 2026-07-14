'use strict';

const { scanLeadHistory, SCAN_MAX_MESSAGES, _internal } = require('../src/leadEnrich');
const { buildScanQuery } = _internal;

const FIXED_NOW = new Date('2026-07-14T12:00:00.000Z');
const agentConfig = { agentId: 'test-agent' };

function msg({ id, from = '', to = '', subject = '', body = '', internalDate = 0 }) {
  return { id, from, to, subject, body, internalDate };
}

function mockDeps({ ids = [], fetchImpl, noiseImpl } = {}) {
  const searchMessages = jest.fn().mockResolvedValue(ids);
  const fetchMessage = jest.fn(fetchImpl || (async (config, id) => msg({ id })));
  const isNoiseSender = jest.fn(noiseImpl || (() => ({ pass: true, reason: '' })));
  return {
    email: { searchMessages, fetchMessage },
    leadIntake: { isNoiseSender },
  };
}

describe('buildScanQuery', () => {
  test('query shape: exact string with parens and date derived from fixed now', () => {
    const query = buildScanQuery('lead@example.com', FIXED_NOW, 5);
    expect(query).toBe('(from:lead@example.com OR to:lead@example.com) after:2021/07/14');
  });

  test('yearsBack is respected in the computed date', () => {
    const query = buildScanQuery('lead@example.com', FIXED_NOW, 2);
    expect(query).toBe('(from:lead@example.com OR to:lead@example.com) after:2024/07/14');
  });
});

describe('scanLeadHistory', () => {
  test('empty leadEmail throws, searchMessages NEVER called', async () => {
    const { email, leadIntake } = mockDeps();
    await expect(
      scanLeadHistory(agentConfig, '   ', { email, leadIntake, now: FIXED_NOW })
    ).rejects.toThrow();
    expect(email.searchMessages).not.toHaveBeenCalled();
  });

  test('zero ids -> found:false, note says no history found, fetchMessage NEVER called', async () => {
    const { email, leadIntake } = mockDeps({ ids: [] });
    const result = await scanLeadHistory(agentConfig, 'lead@example.com', { email, leadIntake, now: FIXED_NOW });

    expect(result.found).toBe(false);
    expect(result.note).toBe('no history found in Gmail');
    expect(result.messages).toEqual([]);
    expect(email.fetchMessage).not.toHaveBeenCalled();
  });

  test('happy path: kept messages sorted ascending by internalDate', async () => {
    const fetched = {
      id1: msg({ id: 'id1', internalDate: 3000 }),
      id2: msg({ id: 'id2', internalDate: 1000 }),
      id3: msg({ id: 'id3', internalDate: 2000 }),
    };
    const { email, leadIntake } = mockDeps({
      ids: ['id1', 'id2', 'id3'],
      fetchImpl: async (config, id) => fetched[id],
    });

    const result = await scanLeadHistory(agentConfig, 'lead@example.com', { email, leadIntake, now: FIXED_NOW });

    expect(result.found).toBe(true);
    expect(result.messages.map((m) => m.id)).toEqual(['id2', 'id3', 'id1']);
    expect(result.note).toBe('');
  });

  test('a noise message (isNoiseSender pass:false) is excluded and counted in filteredAsNoise', async () => {
    const fetched = {
      id1: msg({ id: 'id1', from: 'lead@example.com', internalDate: 1000 }),
      id2: msg({ id: 'id2', from: 'noise@calendly.com', internalDate: 2000 }),
    };
    const { email, leadIntake } = mockDeps({
      ids: ['id1', 'id2'],
      fetchImpl: async (config, id) => fetched[id],
      noiseImpl: (m) => (m.from === 'noise@calendly.com'
        ? { pass: false, reason: 'calendar domain: calendly.com' }
        : { pass: true, reason: '' }),
    });

    const result = await scanLeadHistory(agentConfig, 'lead@example.com', { email, leadIntake, now: FIXED_NOW });

    expect(result.messages.map((m) => m.id)).toEqual(['id1']);
    expect(result.counts.filteredAsNoise).toBe(1);
    expect(result.counts.kept).toBe(1);
  });

  test('all messages noise -> found:false with "filtered as noise" note, not "no history found"', async () => {
    const { email, leadIntake } = mockDeps({
      ids: ['id1', 'id2'],
      noiseImpl: () => ({ pass: false, reason: 'calendar domain: calendly.com' }),
    });

    const result = await scanLeadHistory(agentConfig, 'lead@example.com', { email, leadIntake, now: FIXED_NOW });

    expect(result.found).toBe(false);
    expect(result.note).toBe('all 2 messages filtered as noise');
    expect(result.note).not.toBe('no history found in Gmail');
  });

  test('one fetchMessage throws -> that message skipped, the rest still returned', async () => {
    const { email, leadIntake } = mockDeps({
      ids: ['id1', 'id2'],
      fetchImpl: async (config, id) => {
        if (id === 'id1') throw new Error('fetch failed');
        return msg({ id, internalDate: 500 });
      },
    });

    const result = await scanLeadHistory(agentConfig, 'lead@example.com', { email, leadIntake, now: FIXED_NOW });

    expect(result.messages.map((m) => m.id)).toEqual(['id2']);
    expect(result.counts.fetched).toBe(1);
    expect(result.counts.rawIds).toBe(2);
  });

  test('ids length === SCAN_MAX_MESSAGES -> truncated:true', async () => {
    const ids = Array.from({ length: SCAN_MAX_MESSAGES }, (_, i) => `id${i}`);
    const { email, leadIntake } = mockDeps({ ids });

    const result = await scanLeadHistory(agentConfig, 'lead@example.com', { email, leadIntake, now: FIXED_NOW });

    expect(result.truncated).toBe(true);
    expect(result.note).toContain('truncated');
  });

  test('counts reconcile: fetched === filteredAsNoise + kept', async () => {
    const { email, leadIntake } = mockDeps({
      ids: ['id1', 'id2', 'id3'],
      noiseImpl: (m) => (m.id === 'id2' ? { pass: false, reason: 'noise' } : { pass: true, reason: '' }),
    });

    const result = await scanLeadHistory(agentConfig, 'lead@example.com', { email, leadIntake, now: FIXED_NOW });

    expect(result.counts.fetched).toBe(result.counts.filteredAsNoise + result.counts.kept);
  });
});
