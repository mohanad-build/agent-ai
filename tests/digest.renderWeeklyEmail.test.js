'use strict';

const { renderWeeklyEmail } = require('../src/digest');

const NOW = new Date('2026-05-17T12:30:00Z');

const BASE_OPERATOR = {
  timezone:      'America/Toronto',
  operatorEmail: 'mo@example.com',
};

function makeWeeklySections(overrides) {
  return {
    windowStart:          '2026-05-10T12:30:00.000Z',
    windowEnd:            '2026-05-17T12:30:00.000Z',
    aggregate: {
      totalLeadsHandled:  4,
      totalTouchesFired:  6,
      totalFiltered:      2,
      totalPreflightSkips: 0,
    },
    perAgent: [
      {
        agentId: 'agent-1', agentName: 'Alice Agent',
        intaken: 3, followUpsFired: 4, noiseFiltered: 2, urgentCount: 1, weeklyPreflightSkips: 0,
      },
    ],
    churnRisk:           [],
    recentlyDeactivated: [],
    shadowCatches:        { sentAsIs: 2, editedThenSent: 1, rejected: 0 },
    shadowAgentsCovered:  1,
    shadowAgentsTimedOut: 0,
    ...overrides,
  };
}

// ── Restarts section (docs/designs/cycle-guard.md decision 4) ────────────

test('restartCount 0, no error: no Restarts section at all', () => {
  const { body } = renderWeeklyEmail(makeWeeklySections({ restartCount: 0, restartLogError: null }), BASE_OPERATOR, NOW);
  expect(body).not.toContain('-- Restarts --');
});

test('restartCount 3: exact section text, plural, hyphens not an em dash', () => {
  const { body } = renderWeeklyEmail(makeWeeklySections({ restartCount: 3, restartLogError: null }), BASE_OPERATOR, NOW);
  expect(body).toContain('-- Restarts --\n\n3 stuck-cycle restarts in the last 7 days.');
});

test('restartCount 1: singular wording', () => {
  const { body } = renderWeeklyEmail(makeWeeklySections({ restartCount: 1, restartLogError: null }), BASE_OPERATOR, NOW);
  expect(body).toContain('-- Restarts --\n\n1 stuck-cycle restart in the last 7 days.');
});

test('restartLogError set: the unreadable line, even when restartCount is also nonzero', () => {
  const { body } = renderWeeklyEmail(
    makeWeeklySections({ restartCount: 5, restartLogError: 'EACCES: permission denied' }),
    BASE_OPERATOR,
    NOW
  );
  expect(body).toContain('-- Restarts --\n\nThe restart log could not be read: EACCES: permission denied');
  expect(body).not.toContain('stuck-cycle restart');
});
