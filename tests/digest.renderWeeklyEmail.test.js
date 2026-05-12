'use strict';

const { renderWeeklyEmail } = require('../src/digest');

// now is passed but not currently used by the weekly renderer — kept for API symmetry
const NOW = new Date('2026-05-12T08:00:00Z');

function makeAggregateStats(overrides) {
  return {
    windowStart: '2026-05-05T08:00:00Z',
    windowEnd: '2026-05-12T08:00:00Z',
    operatorTimezone: 'America/Toronto',
    leadsHandled: 42,
    avgResponseTime: '3.1h',
    warmToTourRate: null,
    touchesFired: 18,
    filtered: 24,
    escalations: 3,
    path1bRoundTrips: 5,
    preflightSkips: 2,
    shadowCatches: { sentAsIs: 4, editedThenSent: 2, rejected: 6 },
    reliability: { errors: 0, retries: 0, threadingSkipped: 0 },
    humanItems: [],
    ...overrides,
  };
}

function makeAgent(agentName, mode, flaggedReasons) {
  return {
    agentName,
    mode,
    leadsHandled: 10,
    responseTime: '2.5h',
    preflightSkips: 0,
    lastSheetInteraction: '1d ago',
    flaggedReasons: flaggedReasons || [],
  };
}

test('subject formatted correctly from windowStart and windowEnd in operator timezone', () => {
  const aggregateStats = makeAggregateStats({});
  const result = renderWeeklyEmail(aggregateStats, [], [], NOW);
  expect(result.subject).toBe('Weekly digest — May 5 to May 12');
});

test('warm-to-tour line omitted when warmToTourRate is null', () => {
  const aggregateStats = makeAggregateStats({ warmToTourRate: null });
  const result = renderWeeklyEmail(aggregateStats, [], [], NOW);
  expect(result.body).not.toContain('Warm-to-tour conversion rate');
});

test('warm-to-tour line present when warmToTourRate is a string', () => {
  const aggregateStats = makeAggregateStats({ warmToTourRate: '18%' });
  const result = renderWeeklyEmail(aggregateStats, [], [], NOW);
  expect(result.body).toContain('Warm-to-tour conversion rate: 18%');
});

test('per-agent breakdown contains both agents with correct mode labels', () => {
  const perAgentSections = [
    makeAgent('Alice R', 'shadow'),
    makeAgent('Bob K', 'live'),
  ];
  const result = renderWeeklyEmail(makeAggregateStats({}), perAgentSections, [], NOW);
  expect(result.body).toContain('Alice R [shadow]');
  expect(result.body).toContain('Bob K [live]');
});

test('churn risk section shows "All agents engaged" and criteria when no agents flagged', () => {
  const perAgentSections = [makeAgent('Alice R', 'shadow'), makeAgent('Bob K', 'live')];
  const result = renderWeeklyEmail(makeAggregateStats({}), perAgentSections, [], NOW);
  expect(result.body).toContain('— Churn risk signals —');
  expect(result.body).toContain('All agents engaged this week.');
  expect(result.body).toContain('Criteria:');
});

test('churn risk section lists flagged agents when flaggedReasons is non-empty', () => {
  const perAgentSections = [
    makeAgent('Bob K', 'live', ['Pre-flight skips +50% WoW']),
  ];
  const result = renderWeeklyEmail(makeAggregateStats({}), perAgentSections, [], NOW);
  expect(result.body).toContain('Bob K — Pre-flight skips +50% WoW');
  expect(result.body).not.toContain('All agents engaged this week.');
});

test('reliability section omitted when all aggregate reliability counts are 0', () => {
  const aggregateStats = makeAggregateStats({
    reliability: { errors: 0, retries: 0, threadingSkipped: 0 },
  });
  const result = renderWeeklyEmail(aggregateStats, [], [], NOW);
  expect(result.body).not.toContain('— Reliability —');
});
