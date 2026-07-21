'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();

const { loadAgent } = require('../agentConfig');
const agentState = require('../agentState');
const email = require('../email');
const {
  readContentProfile,
  writeContentProfile,
  updateContentProfile,
  setContentEngineEnabled,
  buildDefaultContentProfile,
  SchemaValidationError,
} = require('../content/profile');
const { extractVoiceForAgent } = require('../content/voiceExtract');
const { getStorageRoot } = require('../storagePaths');
const {
  ROOT_TOKENS,
  SHARED_HEAD_LINKS,
  SHARED_HEADER,
  SHARED_FOOTER,
  ARROW_SVG, // eslint-disable-line no-unused-vars
  renderErrorPage,
} = require('../brandChrome');
const { enableLeads } = require('../leadEnrich');
const { normalizeLeads, landLeads } = require('../leadImport');

function getAgentsDir() { return getStorageRoot(); }
const AGENT_FILE_BLOCKLIST = new Set(['example.json', '.gitkeep']);
const AGENT_ID_REGEX = /^[a-z0-9-]+\.json$/;

function moveAgentFilesToDeleted(agentId, opts = {}) {
  const baseDir = (opts && opts.baseDir) || getAgentsDir();
  const prefix = `${agentId}.`;
  const matched = fs.existsSync(baseDir)
    ? fs.readdirSync(baseDir).filter((f) => f.startsWith(prefix))
    : [];
  if (matched.length === 0) return [];

  const destDir = path.join(baseDir, '_deleted', `${agentId}-${Date.now()}`);
  fs.mkdirSync(destDir, { recursive: true });
  for (const f of matched) {
    fs.renameSync(path.join(baseDir, f), path.join(destDir, f));
  }
  return matched;
}

function discoverAgentIds() {
  if (!fs.existsSync(getAgentsDir())) return [];
  return fs
    .readdirSync(getAgentsDir())
    .filter((f) => AGENT_ID_REGEX.test(f) && !AGENT_FILE_BLOCKLIST.has(f))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

const NON_DASHBOARD_IDS = new Set(['welcome-sender']);
function filterDashboardIds(ids) {
  return ids.filter(id => !NON_DASHBOARD_IDS.has(id));
}

function isAiEnabled(row) {
  const v = row.aiEnabled;
  if (v === undefined || v === null || v === '') return true;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (s === 'false' || s === 'no' || s === '0') return false;
  return true;
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated === true) return next();
  res.redirect('/dashboard/login');
}

// ---- HTML helpers ----

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function select(name, options, current) {
  const opts = options
    .map((o) => `<option value="${o}"${String(o) === String(current) ? ' selected' : ''}>${o}</option>`)
    .join('');
  return `<select name="${name}">${opts}</select>`;
}

function field(label, name, inputHtml) {
  return `<div class="form-row"><label for="${name}">${label}</label>${inputHtml}</div>`;
}

function pageWrap(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(title)}</title>
  ${SHARED_HEAD_LINKS}
  <style>
    ${ROOT_TOKENS}
    /* dashboard-specific rules */
    .shell-wide { max-width: 1100px; margin: 0 auto; padding: 0 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin: 32px 0 24px; }
    .page-header h1 { margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
    .page-header h2 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.015em; }
    .page-actions { display: flex; gap: 12px; align-items: center; }
    .page-actions a { color: var(--muted); font-size: 14px; text-decoration: none; }
    .page-actions a:hover { color: var(--text); }
    .page-actions span { color: var(--muted-2); font-size: 14px; }

    /* Agent cards */
    .agent-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
    .agent-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
    .agent-card.error { border-color: #DC2626; }
    .agent-card .card-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
    .agent-card h3 { margin: 0; font-size: 18px; font-weight: 600; }
    .agent-card .badge-row { display: flex; gap: 4px; flex-wrap: wrap; }
    .agent-card .meta { color: var(--muted); font-size: 13px; margin: 0 0 14px; }
    .agent-card .stat-row { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; }
    .agent-card .stat { display: flex; flex-direction: column; gap: 2px; }
    .agent-card .stat-label { color: var(--muted-2); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
    .agent-card .stat-value { color: var(--text); font-size: 20px; font-weight: 700; }
    .agent-card .stat-value.hot { color: #DC2626; }
    .agent-card .section { margin-top: 14px; }
    .agent-card .section-label { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted-2); margin-bottom: 6px; }
    .agent-card .section ul { margin: 0; padding-left: 16px; font-size: 13px; color: var(--muted); line-height: 1.7; }
    .agent-card .card-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
    .agent-card .card-actions a { display: inline-block; padding: 8px 14px; border-radius: 8px; background: var(--surface-2); color: var(--text); text-decoration: none; font-size: 13px; font-weight: 500; border: 1px solid var(--border); }
    .agent-card .card-actions a:hover { background: var(--violet-soft); border-color: var(--violet); color: var(--violet-bright); }
    .agent-card .err { color: #DC2626; font-size: 14px; margin: 8px 0 0; }

    /* Pill badges (mode, active, oauth health) */
    .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; }
    .pill-live    { background: rgba(16,185,129,0.15); color: #10B981; border: 1px solid rgba(16,185,129,0.3); }
    .pill-shadow  { background: rgba(245,158,11,0.12); color: #F59E0B; border: 1px solid rgba(245,158,11,0.3); }
    .pill-active  { background: rgba(124,58,237,0.13); color: #8B5CF6; border: 1px solid rgba(124,58,237,0.3); }
    .pill-paused  { background: rgba(220,38,38,0.1);   color: #DC2626; border: 1px solid rgba(220,38,38,0.25); }
    .pill-ok      { background: rgba(16,185,129,0.12); color: #10B981; border: 1px solid rgba(16,185,129,0.25); }
    .pill-err     { background: rgba(220,38,38,0.1);   color: #DC2626; border: 1px solid rgba(220,38,38,0.25); }

    /* Edit page */
    .edit-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px 28px; max-width: 680px; }
    .form-row { margin-bottom: 16px; }
    .form-row label { display: block; color: var(--text); font-size: 14px; font-weight: 500; margin-bottom: 6px; }
    .form-row input, .form-row select, .form-row textarea { width: 100%; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; color: var(--text); font: inherit; font-size: 14px; }
    .form-row input:focus, .form-row select:focus, .form-row textarea:focus { outline: none; border-color: var(--violet); box-shadow: 0 0 0 3px var(--violet-soft); }
    .form-row textarea { resize: vertical; }
    .form-row small { color: var(--muted-2); font-size: 12px; display: block; margin-top: 4px; }
    .readonly-field { display: block; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; font-size: 14px; color: var(--muted); word-break: break-all; }
    .err-banner { color: #DC2626; font-size: 14px; margin: 0 0 12px; }
    .form-actions { margin-top: 24px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .btn { display: inline-block; padding: 10px 18px; border-radius: 8px; background: var(--violet); color: #fff; text-decoration: none; font-size: 14px; font-weight: 600; border: none; cursor: pointer; font-family: inherit; }
    .btn:hover { background: var(--violet-bright); }
    .btn-warn { background: #D97706; color: #fff; }
    .btn-warn:hover { background: #B45309; }
    .btn-danger { background: #DC2626; color: #fff; }
    .btn-danger:hover { background: #B91C1C; }

    /* Save banner */
    .banner-ok { background: var(--violet-soft); border: 1px solid var(--violet); color: var(--violet-bright); padding: 10px 14px; border-radius: 8px; margin-bottom: 20px; font-size: 14px; }

    /* Leads table */
    .leads-table { width: 100%; border-collapse: collapse; }
    .leads-table th { text-align: left; padding: 10px 12px; color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; border-bottom: 1px solid var(--border); }
    .leads-table td { padding: 12px; border-bottom: 1px solid var(--border); font-size: 13px; color: var(--text); vertical-align: top; }
    .leads-table tr:hover td { background: rgba(255,255,255,0.02); }
    .inline-form { display: inline-block; margin-left: 6px; }
    .inline-form button { background: var(--surface-2); border: 1px solid var(--border); color: var(--text); padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 500; cursor: pointer; font-family: inherit; }
    .inline-form button:hover { background: var(--violet-soft); border-color: var(--violet); color: var(--violet-bright); }

    /* Status badges */
    .status-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; }
    .status-badge--red-filled        { background: #DC2626; color: #fff; }
    .status-badge--amber-filled      { background: #F59E0B; color: #0a0a0a; }
    .status-badge--amber-dark-filled { background: #D97706; color: #fff; }
    .status-badge--violet-outline    { background: transparent; color: #8B5CF6; border: 1px solid #8B5CF6; }
    .status-badge--violet-filled     { background: #7C3AED; color: #fff; }
    .status-badge--emerald-filled    { background: #10B981; color: #0a0a0a; }
    .status-badge--cyan-filled       { background: #06B6D4; color: #0a0a0a; }
    .status-badge--gray-outline      { background: transparent; color: #8b8b93; border: 1px solid rgba(255,255,255,0.14); }
    .status-badge--red-outline       { background: transparent; color: #DC2626; border: 1px solid #DC2626; }
  </style>
</head>
<body>
  ${SHARED_HEADER}
  <main class="shell-wide">
    ${body}
  </main>
  ${SHARED_FOOTER}
</body>
</html>`;
}

// ---- Login ----

router.get('/login', (req, res) => {
  const error = req.query.error === '1';
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sign in: GetKlosed Dashboard</title>
  ${SHARED_HEAD_LINKS}
  <style>
    ${ROOT_TOKENS}
    .login-shell { display: flex; align-items: center; justify-content: center; min-height: calc(100vh - 200px); padding: 32px 24px; }
    .login-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 32px; max-width: 400px; width: 100%; }
    .login-card h2 { margin: 0 0 8px; font-size: 22px; font-weight: 700; letter-spacing: -0.015em; }
    .login-card p.sub { color: var(--muted); font-size: 14px; margin: 0 0 20px; }
    .login-card label { display: block; color: var(--text); font-size: 14px; font-weight: 500; margin-bottom: 6px; }
    .login-card input { width: 100%; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; color: var(--text); font: inherit; font-size: 14px; }
    .login-card input:focus { outline: none; border-color: var(--violet); box-shadow: 0 0 0 3px var(--violet-soft); }
    .login-card button { width: 100%; margin-top: 16px; padding: 12px; border-radius: 8px; background: var(--violet); color: #fff; font-size: 15px; font-weight: 600; border: none; cursor: pointer; font-family: inherit; }
    .login-card button:hover { background: var(--violet-bright); }
    .login-card .err { color: #DC2626; font-size: 13px; margin-top: 8px; }
  </style>
</head>
<body>
  ${SHARED_HEADER}
  <main class="login-shell">
    <div class="login-card">
      <h2>Sign in</h2>
      <p class="sub">Enter the dashboard password to continue.</p>
      <form method="POST" action="/dashboard/login">
        <label for="password">Password</label>
        <input type="password" name="password" id="password" required autofocus />
        ${error ? '<p class="err">Incorrect password.</p>' : ''}
        <button type="submit">Sign in</button>
      </form>
    </div>
  </main>
  ${SHARED_FOOTER}
</body>
</html>`);
});

router.post('/login', (req, res) => {
  if (req.body.password === process.env.DASHBOARD_PASSWORD) {
    req.session.authenticated = true;
    return res.redirect('/dashboard');
  }
  res.redirect('/dashboard/login?error=1');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/dashboard/login'));
});

// ---- Auth gate ----

router.use(requireAuth);

// ---- Main overview ----

const STATUS_KEYS = ['HOT', 'awaiting_agent', 'awaiting_response', 'needs_review', 'warm', 'cold', 'new'];
const STATUS_COLOR = {
  HOT:               'red-filled',
  awaiting_agent:    'amber-filled',
  awaiting_response: 'amber-dark-filled',
  needs_review:      'violet-outline',
  warm:              'emerald-filled',
  cold:              'gray-outline',
  new:               'cyan-filled',
  operatorEscalated: 'red-outline',
  path1b:            'violet-filled',
};

const TS_RE = /^\[(\d{4}-\d{2}-\d{2}T[\d:.Z+-]+)/;

router.get('/', async (req, res) => {
  try {
    const deletedId = req.query.deleted ? String(req.query.deleted) : null;
    const agentIds = filterDashboardIds(discoverAgentIds());
    const results = await Promise.allSettled(
      agentIds.map(async (agentId) => {
        const agent = loadAgent(agentId);
        let state = {};
        try { state = agentState.getState(agentId); } catch { /* use default */ }
        let rows = [];
        try { rows = await email.readSheetRows(agent); } catch { /* show zeros */ }

        const leadCounts = { total: rows.length };
        for (const s of STATUS_KEYS) leadCounts[s] = 0;
        for (const row of rows) {
          if (STATUS_KEYS.includes(row.status)) leadCounts[row.status]++;
        }

        const recentActivity = rows
          .filter((r) => r.conversationHistory && r.conversationHistory.trim())
          .map((r) => {
            const lines = r.conversationHistory.split('\n').map((l) => l.trim()).filter(Boolean);
            return lines[lines.length - 1] || '';
          })
          .filter(Boolean)
          .sort((a, b) => {
            const ta = TS_RE.exec(a);
            const tb = TS_RE.exec(b);
            if (ta && tb) return tb[1].localeCompare(ta[1]);
            if (ta) return -1;
            if (tb) return 1;
            return 0;
          })
          .slice(0, 5);

        const followUpPipeline = rows
          .filter((r) => r.status === 'awaiting_response' && r.followUpCount !== undefined && r.followUpCount !== null && r.followUpCount !== '')
          .map((r) => ({
            name: r.name || r.leadId,
            email: r.leadId,
            followUpCount: parseInt(r.followUpCount, 10) || 0,
          }));

        return {
          agentId,
          agent,
          leadCounts,
          recentActivity,
          followUpPipeline,
          lastCycleRun: state.lastDailyDigestRun || null,
          oauthHealthy: !!(agent.googleRefreshToken),
        };
      })
    );

    const cards = results.map((result, i) => {
      if (result.status === 'rejected') {
        return `<div class="agent-card error"><h3>${escHtml(agentIds[i])}</h3><p class="err">Error loading agent: ${escHtml(result.reason.message)}</p></div>`;
      }
      const { agentId, agent, leadCounts, recentActivity, followUpPipeline, lastCycleRun, oauthHealthy } = result.value;

      const modeBadge = agent.mode === 'live'
        ? '<span class="pill pill-live">Live</span>'
        : '<span class="pill pill-shadow">Shadow</span>';
      const activeBadge = agent.isActive
        ? '<span class="pill pill-active">Active</span>'
        : '<span class="pill pill-paused">Paused</span>';
      const oauthBadge = oauthHealthy
        ? '<span class="pill pill-ok">Token OK</span>'
        : '<span class="pill pill-err">No Token</span>';

      const hotClass = leadCounts.HOT > 0 ? ' hot' : '';

      const pipelineHtml = followUpPipeline.length
        ? followUpPipeline.map((f) => `<li>${escHtml(f.name)}: touch ${f.followUpCount}/3</li>`).join('')
        : '<li><em>none</em></li>';

      const activityHtml = recentActivity.length
        ? recentActivity.map((a) => `<li>${escHtml(a.substring(0, 120))}</li>`).join('')
        : '<li><em>none</em></li>';

      return `<div class="agent-card">
  <div class="card-top">
    <h3>${escHtml(agentId)}</h3>
    <div class="badge-row">${modeBadge} ${activeBadge} ${oauthBadge}</div>
  </div>
  ${lastCycleRun ? `<p class="meta">Last cycle: ${escHtml(lastCycleRun)}</p>` : ''}
  <div class="stat-row">
    <div class="stat"><span class="stat-label">HOT</span><span class="stat-value${hotClass}">${leadCounts.HOT}</span></div>
    <div class="stat"><span class="stat-label">Awaiting Agent</span><span class="stat-value">${leadCounts.awaiting_agent}</span></div>
    <div class="stat"><span class="stat-label">Awaiting Response</span><span class="stat-value">${leadCounts.awaiting_response}</span></div>
    <div class="stat"><span class="stat-label">Needs Review</span><span class="stat-value">${leadCounts.needs_review}</span></div>
    <div class="stat"><span class="stat-label">Warm</span><span class="stat-value">${leadCounts.warm}</span></div>
    <div class="stat"><span class="stat-label">Cold</span><span class="stat-value">${leadCounts.cold}</span></div>
    <div class="stat"><span class="stat-label">New</span><span class="stat-value">${leadCounts.new}</span></div>
    <div class="stat"><span class="stat-label">Total</span><span class="stat-value">${leadCounts.total}</span></div>
  </div>
  <div class="section">
    <p class="section-label">Follow-up Pipeline</p>
    <ul>${pipelineHtml}</ul>
  </div>
  <div class="section">
    <p class="section-label">Recent Activity</p>
    <ul>${activityHtml}</ul>
  </div>
  <div class="card-actions">
    <a href="/dashboard/agent/${encodeURIComponent(agentId)}/edit">Edit Agent</a>
    <a href="/dashboard/agent/${encodeURIComponent(agentId)}/leads">View Leads</a>
  </div>
</div>`;
    });

    res.send(pageWrap('GetKlosed Dashboard', `
${deletedId ? `<div class="banner-ok">Agent "${escHtml(deletedId)}" removed from the dashboard.</div>` : ''}
<div class="page-header">
  <h1>Dashboard</h1>
  <div class="page-actions">
    <span>Signed in</span>
    <a href="/dashboard/logout">Sign out</a>
  </div>
</div>
<div class="agent-grid">${cards.join('')}</div>`));
  } catch (err) {
    console.error('[dashboard] GET /:', err.message);
    res.status(500).send(err.message);
  }
});

// ---- Edit agent ----

router.get('/agent/:agentId/edit', (req, res) => {
  try {
    let agent;
    try { agent = loadAgent(req.params.agentId); } catch {
      return res.status(404).send(renderErrorPage(
        'Agent not found',
        'No agent matches that ID. It may have been removed or the URL is incorrect.',
        { href: '/dashboard', label: 'Back to dashboard' }
      ));
    }

    const { agentId } = req.params;
    const saved = req.query.saved === '1';
    const deleteError = req.query.delete_error === '1';
    const importErrorEmpty = req.query.import_error === 'empty';
    const ceProvisioned = req.query.ce_provisioned === '1';
    const ceSaved = req.query.ce_saved === '1';
    const ceVoiceExtracted = req.query.ce_voice === 'extracted';
    const ceError = typeof req.query.ce_error === 'string' ? req.query.ce_error : null;
    const cadence = Array.isArray(agent.followUpCadence)
      ? agent.followUpCadence.join(', ')
      : (agent.followUpCadence || '3, 7, 14');
    const avoidPhrases = Array.isArray(agent.avoidPhrases)
      ? agent.avoidPhrases.join('\n')
      : (agent.avoidPhrases || '');

    const contentProfile = readContentProfile(agentId);
    const contentEngineCardHtml = contentProfile === null
      ? `<div class="edit-card" style="margin-top: 20px;">
  <h2 style="margin: 0 0 6px; font-size: 18px; font-weight: 700;">Content Engine</h2>
  <p style="color: var(--muted); font-size: 14px; margin: 0 0 16px;">Not provisioned for this agent. Provisioning creates a live content profile with default settings.</p>
  <form method="POST" action="/dashboard/agent/${encodeURIComponent(agentId)}/content/provision">
    <div class="form-actions">
      <button type="submit" class="btn">Provision Content Engine</button>
    </div>
  </form>
</div>`
      : `<div class="edit-card" style="margin-top: 20px;">
  <h2 style="margin: 0 0 6px; font-size: 18px; font-weight: 700;">Content Engine</h2>
  <form method="POST" action="/dashboard/agent/${encodeURIComponent(agentId)}/content/save">
    ${field('Enabled', 'contentEngineEnabled', select('contentEngineEnabled', ['false', 'true'], String(contentProfile.contentEngineEnabled)))}
    ${field('Primary focus', 'primaryFocus', select('primaryFocus', ['buyers', 'sellers', 'both'], contentProfile.primaryFocus))}
    ${field('Content volume', 'contentVolume', select('contentVolume', ['max', 'balanced', 'minimum'], contentProfile.contentVolume))}
    ${field('Forbidden terms', 'forbiddenTerms', `<textarea name="forbiddenTerms" rows="4">${escHtml((contentProfile.forbiddenTerms || []).join('\n'))}</textarea><small>One per line, or comma-separated</small>`)}
    ${field('Forbidden topics', 'forbiddenTopics', `<textarea name="forbiddenTopics" rows="4">${escHtml((contentProfile.forbiddenTopics || []).join('\n'))}</textarea><small>One per line, or comma-separated</small>`)}
    <div class="form-actions">
      <button type="submit" class="btn">Save Content Engine settings</button>
    </div>
  </form>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid var(--border);" />
  <h3 style="margin: 0 0 6px; font-size: 15px; font-weight: 700;">Voice</h3>
  ${contentProfile.voiceDescriptor
    ? `<div class="form-row"><label>Current voice (tier: ${escHtml(contentProfile.voiceDescriptorTier)})</label><div class="readonly-field" style="color: var(--muted); white-space: pre-wrap;">${escHtml(contentProfile.voiceDescriptor)}</div></div>`
    : '<p style="color: var(--muted); font-size: 14px;">No voice descriptor yet.</p>'}
  <form method="POST" action="/dashboard/agent/${encodeURIComponent(agentId)}/content/voice">
    ${field('Self description', 'selfDescription', `<textarea name="selfDescription" maxlength="1000" rows="4">${escHtml(contentProfile.selfDescription || '')}</textarea><small>2 to 3 sentences describing this agent's voice. Leave blank to keep the default voice.</small>`)}
    <div class="form-actions">
      <button type="submit" class="btn">Extract / refresh voice</button>
    </div>
    <p style="color: var(--muted); font-size: 13px; margin: 8px 0 0;">This runs an AI extraction and may take a few seconds.</p>
  </form>
</div>`;

    res.send(pageWrap(`Edit: ${agentId}`, `
${saved ? '<div class="banner-ok">Changes saved.</div>' : ''}
${ceProvisioned ? '<div class="banner-ok">Content Engine provisioned.</div>' : ''}
${ceSaved ? '<div class="banner-ok">Content Engine settings saved.</div>' : ''}
${ceVoiceExtracted ? '<div class="banner-ok">Voice descriptor updated.</div>' : ''}
${ceError ? `<p class="err-banner">Content Engine error: ${escHtml(ceError)}</p>` : ''}
<div class="page-header">
  <h2>Edit Agent: ${escHtml(agentId)}</h2>
  <div class="page-actions">
    <a href="/dashboard">Back to dashboard</a>
  </div>
</div>
<div class="edit-card">
  <div class="form-row"><label>Agent ID</label><span class="readonly-field">${escHtml(agent.agentId || agentId)}</span></div>
  <div class="form-row"><label>Gmail Address</label><span class="readonly-field">${escHtml(agent.gmailAddress || '')}</span></div>
  <div class="form-row"><label>Google Sheet ID</label><span class="readonly-field">${escHtml(agent.googleSheetId || '')}</span></div>

  <form method="POST" action="/dashboard/agent/${encodeURIComponent(agentId)}/edit">
    ${field('Mode', 'mode', select('mode', ['shadow', 'live'], agent.mode))}
    ${field('Agent Active', 'isActive', select('isActive', ['true', 'false'], String(agent.isActive)))}
    ${field('Agent Phone', 'agentPhone', `<input type="text" name="agentPhone" value="${escHtml(agent.agentPhone || '')}" />`)}
    ${field('Escalation Email', 'escalationEmail', `<input type="text" name="escalationEmail" value="${escHtml(agent.escalationEmail || '')}" />`)}
    ${field('Follow-up Cadence', 'followUpCadence', `<input type="text" name="followUpCadence" value="${escHtml(cadence)}" placeholder="e.g. 3, 7, 14" /><small>Comma-separated days</small>`)}
    ${field('Tone', 'tone', `<input type="text" name="tone" value="${escHtml(agent.tone || '')}" />`)}
    ${field('Email Length', 'emailLength', select('emailLength', ['short', 'medium', 'long'], agent.emailLength))}
    ${field('Uses Emojis', 'usesEmojis', select('usesEmojis', ['false', 'true'], String(agent.usesEmojis)))}
    ${field('Avoid Phrases', 'avoidPhrases', `<textarea name="avoidPhrases" rows="4">${escHtml(avoidPhrases)}</textarea>`)}
    ${field('Agent Signature', 'agentSignature', `<input type="text" name="agentSignature" value="${escHtml(agent.agentSignature || '')}" />`)}

    <div class="form-actions">
      <button type="submit" class="btn">Save changes</button>
      <a href="/onboard/oauth/start?agentId=${encodeURIComponent(agentId)}" class="btn btn-warn">Re-authorize Google Account</a>
    </div>
  </form>
</div>
${contentEngineCardHtml}
<div class="edit-card" style="margin-top: 20px;">
  <h2 style="margin: 0 0 6px; font-size: 18px; font-weight: 700;">Import Leads</h2>
  <p style="color: var(--muted); font-size: 14px; margin: 0 0 16px;">Imported rows land inert (AI disabled) in the Sheet -- enable them from the leads table before the agent will work them.</p>
  ${importErrorEmpty ? '<p class="err-banner">No CSV was provided.</p>' : ''}
  <form method="POST" action="/dashboard/agent/${encodeURIComponent(agentId)}/import">
    ${field('Choose a CSV file (optional)', 'csvFile', '<input type="file" id="csvFile" accept=".csv,.tsv,.txt" />')}
    ${field('CSV / TSV Paste', 'csvText', '<textarea name="csvText" rows="10" placeholder="Paste CSV or TSV here, or choose a file above"></textarea>')}
    <p id="importClientError" class="err-banner" style="display: none;"></p>
    <div class="form-actions">
      <button type="submit" class="btn">Import leads</button>
    </div>
  </form>
  <script>
  (function () {
    "use strict";
    var fileInput = document.getElementById('csvFile');
    var textarea = document.querySelector('textarea[name="csvText"]');
    var clientError = document.getElementById('importClientError');
    var form = textarea ? textarea.form : null;

    if (fileInput && textarea) {
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          textarea.value = reader.result;
        };
        reader.readAsText(file);
      });
    }

    if (form && textarea) {
      form.addEventListener('submit', function (e) {
        if (textarea.value.length > 1500000) {
          e.preventDefault();
          if (clientError) {
            clientError.textContent = 'That paste is too large to submit. Import it from the CLI instead.';
            clientError.style.display = 'block';
          }
        }
      });
    }
  })();
  </script>
</div>
<div class="edit-card" style="margin-top: 20px; border-color: rgba(220,38,38,0.4);">
  <h2 style="margin: 0 0 6px; font-size: 18px; font-weight: 700;">Danger Zone</h2>
  <p style="color: var(--muted); font-size: 14px; margin: 0 0 16px;">Removing this agent takes it off the dashboard and stops processing. The Google Sheet and Google authorization for this agent are left intact.</p>
  ${deleteError ? '<p class="err" style="margin-bottom: 16px;">Agent ID did not match. Nothing was removed.</p>' : ''}
  <form method="POST" action="/dashboard/agent/${encodeURIComponent(agentId)}/delete">
    ${field('Type the agent ID to confirm', 'confirmId', `<input type="text" name="confirmId" placeholder="${escHtml(agentId)}" autocomplete="off" />`)}
    <div class="form-actions">
      <button type="submit" class="btn btn-danger">Delete agent</button>
    </div>
  </form>
</div>`));
  } catch (err) {
    console.error('[dashboard] GET /agent/:id/edit:', err.message);
    res.status(500).send(err.message);
  }
});

router.post('/agent/:agentId/edit', (req, res) => {
  try {
    const { agentId } = req.params;
    const filePath = path.join(getAgentsDir(), `${agentId}.json`);
    if (!fs.existsSync(filePath)) return res.status(404).send(renderErrorPage(
      'Agent not found',
      'No agent matches that ID. It may have been removed or the URL is incorrect.',
      { href: '/dashboard', label: 'Back to dashboard' }
    ));

    let agent;
    try { agent = loadAgent(agentId); } catch { return res.status(404).send(renderErrorPage(
      'Agent not found',
      'No agent matches that ID. It may have been removed or the URL is incorrect.',
      { href: '/dashboard', label: 'Back to dashboard' }
    )); }

    const b = req.body;

    if (b.mode !== 'shadow' && b.mode !== 'live') return res.status(400).send('Invalid mode');
    agent.mode = b.mode;

    agent.isActive = b.isActive === 'true';

    const phone = (b.agentPhone || '').trim();
    if (!phone) return res.status(400).send('agentPhone is required');
    agent.agentPhone = phone;

    const esc = (b.escalationEmail || '').trim();
    if (!esc.includes('@')) return res.status(400).send('escalationEmail must contain @');
    agent.escalationEmail = esc;

    const cadence = (b.followUpCadence || '')
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);
    if (cadence.length > 0) agent.followUpCadence = cadence;

    agent.tone = (b.tone || '').trim();

    if (['short', 'medium', 'long'].includes(b.emailLength)) agent.emailLength = b.emailLength;

    const emojisVal = (b.usesEmojis || '').toLowerCase();
    agent.usesEmojis = emojisVal === 'yes' || emojisVal === 'true';

    agent.avoidPhrases = (b.avoidPhrases || '')
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);

    agent.agentSignature = (b.agentSignature || '').trim();

    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(agent, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);

    res.redirect(`/dashboard/agent/${encodeURIComponent(agentId)}/edit?saved=1`);
  } catch (err) {
    console.error('[dashboard] POST /agent/:id/edit:', err.message);
    res.status(500).send(err.message);
  }
});

// ---- Content Engine helpers ----

function parseListField(raw) {
  return (raw || '')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function provisionContentEngine(agentId, opts = {}) {
  const baseDirOpts = opts.baseDir ? { baseDir: opts.baseDir } : {};
  if (readContentProfile(agentId, baseDirOpts) !== null) {
    return { ok: false, reason: 'already_provisioned' };
  }

  const newProfile = buildDefaultContentProfile(agentId, {
    contentEngineEnabled: true,
    contentEngineMode: 'live',
  });
  writeContentProfile(agentId, newProfile, baseDirOpts);
  await extractVoiceForAgent(agentId, baseDirOpts);
  return { ok: true };
}

function saveContentEngineConfig(agentId, body, opts = {}) {
  const baseDirOpts = opts.baseDir ? { baseDir: opts.baseDir } : {};
  const existing = readContentProfile(agentId, baseDirOpts);
  if (existing === null) return { ok: false, reason: 'not_provisioned' };

  let updated;
  try {
    updated = updateContentProfile(agentId, {
      primaryFocus:    body.primaryFocus,
      contentVolume:   body.contentVolume,
      forbiddenTerms:  parseListField(body.forbiddenTerms),
      forbiddenTopics: parseListField(body.forbiddenTopics),
    }, baseDirOpts);
  } catch (err) {
    if (err instanceof SchemaValidationError) return { ok: false, reason: 'invalid' };
    throw err;
  }

  const desired = body.contentEngineEnabled === 'true';
  if (updated.contentEngineEnabled !== desired) {
    setContentEngineEnabled(agentId, desired, baseDirOpts);
  }

  return { ok: true };
}

async function extractVoiceConfig(agentId, body, opts = {}) {
  const baseDirOpts = opts.baseDir ? { baseDir: opts.baseDir } : {};
  if (readContentProfile(agentId, baseDirOpts) === null) {
    return { ok: false, reason: 'not_provisioned' };
  }

  const selfDescription = ((body && body.selfDescription) || '').trim();
  if (selfDescription.length > 1000) {
    return { ok: false, reason: 'invalid' };
  }

  try {
    updateContentProfile(agentId, { selfDescription }, baseDirOpts);
  } catch (err) {
    if (err instanceof SchemaValidationError) return { ok: false, reason: 'invalid' };
    throw err;
  }

  let result;
  try {
    result = await extractVoiceForAgent(agentId, { ...opts, force: true });
  } catch {
    return { ok: false, reason: 'extract_failed' };
  }

  return { ok: true, extracted: result.extracted, tier: result.descriptor && result.descriptor.tier };
}

// ---- Content Engine provisioning and config ----

router.post('/agent/:agentId/content/provision', async (req, res) => {
  try {
    const { agentId } = req.params;
    try { loadAgent(agentId); } catch { return res.status(404).send(renderErrorPage(
      'Agent not found',
      'No agent matches that ID. It may have been removed or the URL is incorrect.',
      { href: '/dashboard', label: 'Back to dashboard' }
    )); }

    const result = await provisionContentEngine(agentId);
    if (!result.ok) {
      return res.redirect(`/dashboard/agent/${encodeURIComponent(agentId)}/edit?ce_error=${encodeURIComponent(result.reason)}`);
    }

    res.redirect(`/dashboard/agent/${encodeURIComponent(agentId)}/edit?ce_provisioned=1`);
  } catch (err) {
    console.error('[dashboard] POST /agent/:id/content/provision:', err.message);
    res.status(500).send(err.message);
  }
});

router.post('/agent/:agentId/content/save', (req, res) => {
  try {
    const { agentId } = req.params;
    try { loadAgent(agentId); } catch { return res.status(404).send(renderErrorPage(
      'Agent not found',
      'No agent matches that ID. It may have been removed or the URL is incorrect.',
      { href: '/dashboard', label: 'Back to dashboard' }
    )); }

    const result = saveContentEngineConfig(agentId, req.body);
    if (!result.ok) {
      return res.redirect(`/dashboard/agent/${encodeURIComponent(agentId)}/edit?ce_error=${encodeURIComponent(result.reason)}`);
    }

    res.redirect(`/dashboard/agent/${encodeURIComponent(agentId)}/edit?ce_saved=1`);
  } catch (err) {
    console.error('[dashboard] POST /agent/:id/content/save:', err.message);
    res.status(500).send(err.message);
  }
});

router.post('/agent/:agentId/content/voice', async (req, res) => {
  try {
    const { agentId } = req.params;
    try { loadAgent(agentId); } catch { return res.status(404).send(renderErrorPage(
      'Agent not found',
      'No agent matches that ID. It may have been removed or the URL is incorrect.',
      { href: '/dashboard', label: 'Back to dashboard' }
    )); }

    const result = await extractVoiceConfig(agentId, req.body);
    if (!result.ok) {
      return res.redirect(`/dashboard/agent/${encodeURIComponent(agentId)}/edit?ce_error=${encodeURIComponent(result.reason)}`);
    }

    res.redirect(`/dashboard/agent/${encodeURIComponent(agentId)}/edit?ce_voice=extracted`);
  } catch (err) {
    console.error('[dashboard] POST /agent/:id/content/voice:', err.message);
    res.status(500).send(err.message);
  }
});

// ---- Delete agent (soft) ----

router.post('/agent/:agentId/delete', (req, res) => {
  try {
    const { agentId } = req.params;
    const confirmId = req.body.confirmId || '';

    if (confirmId !== agentId) {
      return res.redirect(`/dashboard/agent/${encodeURIComponent(agentId)}/edit?delete_error=1`);
    }

    const moved = moveAgentFilesToDeleted(agentId);
    if (moved.length === 0) {
      return res.status(404).send(renderErrorPage(
        'Agent not found',
        'No agent matches that ID. It may have been removed or the URL is incorrect.',
        { href: '/dashboard', label: 'Back to dashboard' }
      ));
    }

    res.redirect(`/dashboard?deleted=${encodeURIComponent(agentId)}`);
  } catch (err) {
    console.error('[dashboard] POST /agent/:id/delete:', err.message);
    res.status(500).send(err.message);
  }
});

// ---- Import leads helpers ----

function parseImportBody(body) {
  const raw = body && body.csvText;
  const csvText = (typeof raw === 'string' ? raw : '').trim();
  return { csvText };
}

function renderImportResult(agentId, normalized, result) {
  const mappingJson = JSON.stringify(normalized.meta.mapping, null, 2);

  const manualRows = result.rows.filter((r) => r.status !== 'landed');
  const manualHtml = manualRows.length
    ? `<table class="leads-table"><thead><tr><th>Email</th><th>Status</th><th>Reason</th></tr></thead><tbody>${manualRows.map((r) => `<tr><td>${escHtml(r.email || '(none)')}</td><td>${escHtml(r.status)}</td><td>${escHtml(r.statusReason)}</td></tr>`).join('')}</tbody></table>`
    : '<p>No rows require manual attention.</p>';

  return `
<h3>Column Mapping</h3>
<pre>${escHtml(mappingJson)}</pre>
<div class="banner-ok">Landed ${escHtml(String(result.landed))} lead(s) for ${escHtml(agentId)}.</div>
<h3>Counts</h3>
<table class="leads-table"><thead><tr><th>Outcome</th><th>Count</th></tr></thead><tbody>
<tr><td>ok</td><td>${escHtml(String(result.counts.ok))}</td></tr>
<tr><td>skippedNoEmail</td><td>${escHtml(String(result.counts.skippedNoEmail))}</td></tr>
<tr><td>skippedUnparseable</td><td>${escHtml(String(result.counts.skippedUnparseable))}</td></tr>
<tr><td>skippedDupeInFile</td><td>${escHtml(String(result.counts.skippedDupeInFile))}</td></tr>
<tr><td>skippedDupeInSheet</td><td>${escHtml(String(result.counts.skippedDupeInSheet))}</td></tr>
</tbody></table>
<h3>Needs Manual Attention</h3>
${manualHtml}
<p style="margin-top: 20px;"><a href="/dashboard/agent/${encodeURIComponent(agentId)}/leads">View leads</a> -- landed rows are inert until enabled there.</p>`;
}

// ---- Import leads ----

router.post('/agent/:agentId/import', async (req, res) => {
  try {
    const { agentId } = req.params;
    let agent;
    try { agent = loadAgent(agentId); } catch { return res.status(404).send(renderErrorPage(
      'Agent not found',
      'No agent matches that ID. It may have been removed or the URL is incorrect.',
      { href: '/dashboard', label: 'Back to dashboard' }
    )); }

    const { csvText } = parseImportBody(req.body);
    if (!csvText) {
      return res.redirect(`/dashboard/agent/${encodeURIComponent(agentId)}/edit?import_error=empty`);
    }

    const normalized = await normalizeLeads(csvText);
    const result = await landLeads(agent, normalized);

    res.send(pageWrap(`Import Leads: ${agentId}`, `
<div class="page-header">
  <h2>Import Leads: ${escHtml(agentId)}</h2>
</div>
${renderImportResult(agentId, normalized, result)}`));
  } catch (err) {
    console.error('[dashboard] POST /agent/:id/import:', err.message);
    res.status(400).send(renderErrorPage(
      'Import failed',
      escHtml(err.message),
      { href: `/dashboard/agent/${encodeURIComponent(req.params.agentId)}/edit`, label: 'Back to edit page' }
    ));
  }
});

// ---- Bulk enable helpers ----

function isEnableEligible(row) {
  const source = String(row.source || '').trim().toLowerCase();
  const aiEnabled = String(row.aiEnabled || '').trim().toUpperCase();
  return source === 'import' && aiEnabled === 'FALSE';
}

function parseSelectedEmails(body) {
  const raw = body && body.emails;
  let list;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string') {
    list = [raw];
  } else {
    return [];
  }

  const seen = new Set();
  const result = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function renderEnableResult(agentId, result) {
  const blockedRows = result.rows.filter((r) => r.action === 'blocked');
  const notFoundRows = result.rows.filter((r) => r.action === 'not-found');

  const blockedHtml = blockedRows.length
    ? `<table class="leads-table"><thead><tr><th>Email</th><th>Reason</th></tr></thead><tbody>${blockedRows.map((r) => `<tr><td>${escHtml(r.email)}</td><td><span class="status-badge status-badge--amber-filled">blocked</span> ${escHtml(r.reason)}</td></tr>`).join('')}</tbody></table>`
    : '<p>None blocked.</p>';

  const notFoundHtml = notFoundRows.length
    ? `<table class="leads-table"><thead><tr><th>Email</th><th>Reason</th></tr></thead><tbody>${notFoundRows.map((r) => `<tr><td>${escHtml(r.email)}</td><td><span class="status-badge status-badge--gray-outline">not found</span> ${escHtml(r.reason)}</td></tr>`).join('')}</tbody></table>`
    : '<p>None.</p>';

  return `
<div class="banner-ok">Enabled ${escHtml(String(result.enabled))} lead(s) for ${escHtml(agentId)}.</div>
<h3>Blocked</h3>
${blockedHtml}
<h3>Not found</h3>
${notFoundHtml}
<p style="margin-top: 20px;"><a href="/dashboard/agent/${encodeURIComponent(agentId)}/leads">Back to leads</a></p>`;
}

// ---- Leads table ----

router.get('/agent/:agentId/leads', async (req, res) => {
  try {
    const { agentId } = req.params;
    let agent;
    try { agent = loadAgent(agentId); } catch {
      return res.status(404).send(renderErrorPage(
        'Agent not found',
        'No agent matches that ID. It may have been removed or the URL is incorrect.',
        { href: '/dashboard', label: 'Back to dashboard' }
      ));
    }

    const enableError = req.query.enable_error === 'empty';

    let rows = [];
    try { rows = await email.readSheetRows(agent); } catch { /* render empty */ }

    let anyEligible = false;
    const rowsHtml = rows.map((row) => {
      const aiOn = isAiEnabled(row);
      const isSoi = (row.leadCategory || '').toLowerCase() === 'soi';
      const sc = STATUS_COLOR[row.status] || 'gray-outline';
      const eligible = isEnableEligible(row);
      if (eligible) anyEligible = true;
      const lastAction = (() => {
        if (!row.conversationHistory) return '';
        const lines = row.conversationHistory.split('\n').filter(Boolean);
        return (lines[lines.length - 1] || '').substring(0, 80);
      })();
      return `<tr>
  <td>${eligible ? `<input type="checkbox" name="emails" value="${escHtml(row.leadId || '')}" form="bulkEnableForm">` : ''}</td>
  <td>${row.rowIndex}</td>
  <td>${escHtml(row.name || '')}</td>
  <td>${escHtml(row.leadId || '')}</td>
  <td><span class="status-badge status-badge--${sc}">${escHtml(row.status || '')}</span></td>
  <td>${aiOn ? 'Yes' : 'No'}<form method="POST" action="/dashboard/agent/${encodeURIComponent(agentId)}/leads/${row.rowIndex}/toggle-ai" class="inline-form"><button type="submit">[toggle]</button></form></td>
  <td>${escHtml(row.source || '')}</td>
  <td>${escHtml(String(row.followUpCount || ''))}</td>
  <td>${escHtml(lastAction)}</td>
  <td><form method="POST" action="/dashboard/agent/${encodeURIComponent(agentId)}/leads/${row.rowIndex}/toggle-soi" class="inline-form"><button type="submit">${isSoi ? '[unmark SOI]' : '[mark SOI]'}</button></form></td>
</tr>`;
    }).join('');

    const bulkEnableHtml = anyEligible
      ? `<form id="bulkEnableForm" method="POST" action="/dashboard/agent/${encodeURIComponent(agentId)}/leads/enable">
  ${enableError ? '<p class="err-banner">No leads were selected.</p>' : ''}
  <div class="form-actions">
    <button type="submit" class="btn">Enable selected</button>
  </div>
</form>`
      : '';

    res.send(pageWrap(`Leads: ${agentId}`, `
<div class="page-header">
  <h2>Leads: ${escHtml(agentId)}</h2>
  <div class="page-actions">
    <a href="/dashboard">Back to dashboard</a>
    <a href="/dashboard/agent/${encodeURIComponent(agentId)}/edit">Edit settings</a>
  </div>
</div>
<div style="overflow-x: auto;">
  <table class="leads-table">
    <thead><tr>
      <th></th><th>Row</th><th>Name</th><th>Email</th><th>Status</th>
      <th>AI Enabled</th><th>Source</th><th>Follow-Up Count</th><th>Last Action</th><th>SOI</th>
    </tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="10"><em>No rows found.</em></td></tr>'}</tbody>
  </table>
</div>
${bulkEnableHtml}`));
  } catch (err) {
    console.error('[dashboard] GET /agent/:id/leads:', err.message);
    res.status(500).send(err.message);
  }
});

// ---- Toggle AI ----

router.post('/agent/:agentId/leads/:rowIndex/toggle-ai', async (req, res) => {
  try {
    const { agentId, rowIndex } = req.params;
    const ri = parseInt(rowIndex, 10);
    let agent;
    try { agent = loadAgent(agentId); } catch { return res.status(404).send(renderErrorPage(
      'Agent not found',
      'No agent matches that ID. It may have been removed or the URL is incorrect.',
      { href: '/dashboard', label: 'Back to dashboard' }
    )); }
    const rows = await email.readSheetRows(agent);
    const row = rows.find((r) => r.rowIndex === ri);
    if (!row) return res.status(404).send('Row not found');
    const newValue = isAiEnabled(row) ? 'FALSE' : 'TRUE';
    await email.updateSheetRow(agent, ri, { aiEnabled: newValue });
    res.redirect(`/dashboard/agent/${encodeURIComponent(agentId)}/leads`);
  } catch (err) {
    console.error('[dashboard] POST toggle-ai:', err.message);
    res.status(500).send(err.message);
  }
});

// ---- Toggle SOI ----

router.post('/agent/:agentId/leads/:rowIndex/toggle-soi', async (req, res) => {
  try {
    const { agentId, rowIndex } = req.params;
    const ri = parseInt(rowIndex, 10);
    let agent;
    try { agent = loadAgent(agentId); } catch { return res.status(404).send(renderErrorPage(
      'Agent not found',
      'No agent matches that ID. It may have been removed or the URL is incorrect.',
      { href: '/dashboard', label: 'Back to dashboard' }
    )); }
    const rows = await email.readSheetRows(agent);
    const row = rows.find((r) => r.rowIndex === ri);
    if (!row) return res.status(404).send('Row not found');
    const newValue = (row.leadCategory || '').toLowerCase() === 'soi' ? '' : 'soi';
    await email.updateSheetRow(agent, ri, { leadCategory: newValue });
    res.redirect(`/dashboard/agent/${encodeURIComponent(agentId)}/leads`);
  } catch (err) {
    console.error('[dashboard] POST toggle-soi:', err.message);
    res.status(500).send(err.message);
  }
});

// ---- Bulk enable ----

router.post('/agent/:agentId/leads/enable', async (req, res) => {
  try {
    const { agentId } = req.params;
    let agent;
    try { agent = loadAgent(agentId); } catch { return res.status(404).send(renderErrorPage(
      'Agent not found',
      'No agent matches that ID. It may have been removed or the URL is incorrect.',
      { href: '/dashboard', label: 'Back to dashboard' }
    )); }

    const emails = parseSelectedEmails(req.body);
    if (emails.length === 0) {
      return res.redirect(`/dashboard/agent/${encodeURIComponent(agentId)}/leads?enable_error=empty`);
    }

    const result = await enableLeads(agent, { emails });

    res.send(pageWrap(`Enable Leads: ${agentId}`, `
<div class="page-header">
  <h2>Enable Leads: ${escHtml(agentId)}</h2>
</div>
${renderEnableResult(agentId, result)}`));
  } catch (err) {
    console.error('[dashboard] POST leads/enable:', err.message);
    res.status(500).send(err.message);
  }
});

module.exports = router;
module.exports.discoverAgentIds = discoverAgentIds;
module.exports.AGENT_ID_REGEX = AGENT_ID_REGEX;
module.exports.NON_DASHBOARD_IDS = NON_DASHBOARD_IDS;
module.exports.filterDashboardIds = filterDashboardIds;
module.exports.moveAgentFilesToDeleted = moveAgentFilesToDeleted;
module.exports.isEnableEligible = isEnableEligible;
module.exports.parseSelectedEmails = parseSelectedEmails;
module.exports.renderEnableResult = renderEnableResult;
module.exports.parseImportBody = parseImportBody;
module.exports.renderImportResult = renderImportResult;
module.exports.parseListField = parseListField;
module.exports.provisionContentEngine = provisionContentEngine;
module.exports.saveContentEngineConfig = saveContentEngineConfig;
module.exports.extractVoiceConfig = extractVoiceConfig;
