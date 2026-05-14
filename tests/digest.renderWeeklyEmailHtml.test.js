'use strict';

const { renderWeeklyEmailHtml, _internal } = require('../src/digest');
const { STYLE_TOKENS: T } = _internal;

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

// ── Return shape ──────────────────────────────────────────────────────────────

test('returns { subject, html } object', () => {
  const result = renderWeeklyEmailHtml(makeWeeklySections(), BASE_OPERATOR, NOW);
  expect(result).toHaveProperty('subject');
  expect(result).toHaveProperty('html');
  expect(typeof result.html).toBe('string');
});

// ── Subject line ──────────────────────────────────────────────────────────────

test('subject is "Weekly digest — May 10 to May 17"', () => {
  const result = renderWeeklyEmailHtml(makeWeeklySections(), BASE_OPERATOR, NOW);
  expect(result.subject).toBe('Weekly digest — May 10 to May 17');
});

// ── HTML structure ────────────────────────────────────────────────────────────

test('output is valid HTML with DOCTYPE, head, body', () => {
  const { html } = renderWeeklyEmailHtml(makeWeeklySections(), BASE_OPERATOR, NOW);
  expect(html).toContain('<!DOCTYPE html>');
  expect(html).toContain('<head>');
  expect(html).toContain('<body');
  expect(html).toContain('</body>');
  expect(html).toContain('</html>');
});

// ── STYLE_TOKENS applied ──────────────────────────────────────────────────────

test('containerMaxWidth token appears in HTML output', () => {
  const { html } = renderWeeklyEmailHtml(makeWeeklySections(), BASE_OPERATOR, NOW);
  expect(html).toContain(T.containerMaxWidth);
});

test('fontStack token appears in HTML output', () => {
  const { html } = renderWeeklyEmailHtml(makeWeeklySections(), BASE_OPERATOR, NOW);
  expect(html).toContain(T.fontStack);
});

test('mutedTextColor token used for stat lines', () => {
  const { html } = renderWeeklyEmailHtml(makeWeeklySections(), BASE_OPERATOR, NOW);
  expect(html).toContain(T.mutedTextColor);
});

test('sectionDividerColor appears on section headers', () => {
  const { html } = renderWeeklyEmailHtml(makeWeeklySections(), BASE_OPERATOR, NOW);
  expect(html).toContain(T.sectionDividerColor);
});

// ── Opener ────────────────────────────────────────────────────────────────────

test('opener summarises lead count and agent count', () => {
  const { html } = renderWeeklyEmailHtml(makeWeeklySections(), BASE_OPERATOR, NOW);
  expect(html).toContain('4 leads handled across 1 active agent this week.');
});

test('opener pluralises agents correctly', () => {
  const sections = makeWeeklySections({
    aggregate: { totalLeadsHandled: 10, totalTouchesFired: 12, totalFiltered: 3, totalPreflightSkips: 0 },
    perAgent: [
      { agentId: 'a1', agentName: 'A1', intaken: 5, followUpsFired: 6, noiseFiltered: 2, urgentCount: 0, weeklyPreflightSkips: 0 },
      { agentId: 'a2', agentName: 'A2', intaken: 5, followUpsFired: 6, noiseFiltered: 1, urgentCount: 0, weeklyPreflightSkips: 0 },
    ],
  });
  const { html } = renderWeeklyEmailHtml(sections, BASE_OPERATOR, NOW);
  expect(html).toContain('10 leads handled across 2 active agents this week.');
});

// ── Aggregate stats section ───────────────────────────────────────────────────

test('aggregate stats section renders with label-value pairs', () => {
  const { html } = renderWeeklyEmailHtml(makeWeeklySections(), BASE_OPERATOR, NOW);
  expect(html).toContain('Aggregate stats');
  expect(html).toContain('Leads handled: 4');
  expect(html).toContain('Touches fired: 6');
  expect(html).toContain('Filtered: 2');
});

// ── Shadow Mode catches section ───────────────────────────────────────────────

test('shadow catches section renders when shadowAgentsCovered > 0', () => {
  const { html } = renderWeeklyEmailHtml(makeWeeklySections(), BASE_OPERATOR, NOW);
  expect(html).toContain('Shadow Mode catches');
  expect(html).toContain('Drafts sent as-is by agent: 2');
  expect(html).toContain('Drafts edited then sent: 1');
  expect(html).toContain('Drafts rejected: 0');
});

test('shadow catches absent when no shadow data', () => {
  const sections = makeWeeklySections({ shadowAgentsCovered: 0, shadowAgentsTimedOut: 0 });
  const { html } = renderWeeklyEmailHtml(sections, BASE_OPERATOR, NOW);
  expect(html).not.toContain('Shadow Mode catches');
});

test('timeout note rendered when some agents timed out', () => {
  const sections = makeWeeklySections({
    shadowAgentsCovered: 1,
    shadowAgentsTimedOut: 1,
  });
  const { html } = renderWeeklyEmailHtml(sections, BASE_OPERATOR, NOW);
  expect(html).toContain('1 agent where Gmail polling timed out');
});

// ── Churn risk section ────────────────────────────────────────────────────────

test('churn risk section renders when agents at risk', () => {
  const sections = makeWeeklySections({
    churnRisk: [{ agentId: 'a1', agentName: 'Alice', reasons: ['needs_review unanswered >48h'] }],
  });
  const { html } = renderWeeklyEmailHtml(sections, BASE_OPERATOR, NOW);
  expect(html).toContain('Churn risk');
  expect(html).toContain('Alice (a1): needs_review unanswered &gt;48h');
});

test('churn risk section absent when no at-risk agents', () => {
  const { html } = renderWeeklyEmailHtml(makeWeeklySections({ churnRisk: [] }), BASE_OPERATOR, NOW);
  expect(html).not.toContain('Churn risk');
});

// ── Per-agent breakdown section ───────────────────────────────────────────────

test('per-agent breakdown renders agent name and stats', () => {
  const { html } = renderWeeklyEmailHtml(makeWeeklySections(), BASE_OPERATOR, NOW);
  expect(html).toContain('Per-agent breakdown');
  expect(html).toContain('Alice Agent (agent-1)');
  expect(html).toContain('Leads intaken: 3');
  expect(html).toContain('Follow-ups fired: 4');
});

// ── Footer ────────────────────────────────────────────────────────────────────

test('footer note about preflight reset is present', () => {
  const { html } = renderWeeklyEmailHtml(makeWeeklySections(), BASE_OPERATOR, NOW);
  expect(html).toContain('Pre-flight skip counters reset after this digest.');
});

// ── No action buttons ─────────────────────────────────────────────────────────

test('no <a> buttons rendered — weekly is stats-only', () => {
  const { html } = renderWeeklyEmailHtml(makeWeeklySections(), BASE_OPERATOR, NOW);
  expect(html).not.toContain('<a href=');
});

// ── HTML escaping ─────────────────────────────────────────────────────────────

test('special characters in agent name are HTML-escaped', () => {
  const sections = makeWeeklySections({
    perAgent: [{
      agentId: 'a1', agentName: 'Alice <Test> & Co',
      intaken: 0, followUpsFired: 0, noiseFiltered: 0, urgentCount: 0, weeklyPreflightSkips: 0,
    }],
  });
  const { html } = renderWeeklyEmailHtml(sections, BASE_OPERATOR, NOW);
  expect(html).toContain('Alice &lt;Test&gt; &amp; Co');
  expect(html).not.toContain('Alice <Test>');
});
