'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();

const { loadAgent } = require('../agentConfig');
const agentState = require('../agentState');
const email = require('../email');
const { readContentProfile, setContentEngineEnabled } = require('../content/profile');
const { getStorageRoot } = require('../storagePaths');

function getAgentsDir() { return getStorageRoot(); }
const AGENT_FILE_BLOCKLIST = new Set(['example.json', '.gitkeep']);

function discoverAgentIds() {
  if (!fs.existsSync(getAgentsDir())) return [];
  return fs
    .readdirSync(getAgentsDir())
    .filter((f) => f.endsWith('.json') && !f.endsWith('.state.json') && !AGENT_FILE_BLOCKLIST.has(f))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
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
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; background: #f4f6f8; color: #222; }
  .container { max-width: 1400px; margin: 0 auto; padding: 1.5rem; }
  h1,h2,h3,h4 { margin-top: 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(440px, 1fr)); gap: 1.5rem; }
  .card { background: #fff; border: 1px solid #dde1e7; border-radius: 8px; padding: 1.25rem; }
  .card.error { border-color: #e74c3c; }
  .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: .75rem; }
  .card-header h3 { margin-bottom: 0; }
  .stat-row { display: flex; flex-wrap: wrap; gap: .4rem .9rem; margin: .75rem 0; font-size: .88rem; align-items: baseline; }
  .stat-item { display: flex; align-items: baseline; gap: .2rem; }
  .stat-label { color: #666; }
  .stat-val { font-weight: 700; }
  .stat-val.hot { color: #e74c3c; }
  .section { margin-top: .85rem; }
  .section h4 { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: #888; margin-bottom: .3rem; }
  .section ul { margin: 0; padding-left: 1.2rem; font-size: .84rem; line-height: 1.6; }
  .actions { margin-top: 1rem; display: flex; gap: .5rem; flex-wrap: wrap; }
  .meta { font-size: .8rem; color: #888; margin: .25rem 0; }
  .btn { display: inline-block; padding: .4rem .85rem; background: #1a73e8; color: #fff; text-decoration: none; border-radius: 4px; border: none; cursor: pointer; font-size: .875rem; }
  .btn:hover { background: #1558b0; }
  .btn-sm { font-size: .8rem; padding: .3rem .65rem; }
  .btn-danger { background: #e74c3c; }
  .btn-danger:hover { background: #c0392b; }
  .btn-link { background: none; border: none; color: #1a73e8; cursor: pointer; font-size: .85rem; padding: 0; text-decoration: underline; }
  .badge { display: inline-block; padding: .15rem .45rem; border-radius: 3px; font-size: .75rem; font-weight: 600; }
  .badge.live { background: #d4edda; color: #155724; }
  .badge.shadow { background: #fff3cd; color: #856404; }
  .badge.active { background: #cce5ff; color: #004085; }
  .badge.paused { background: #f8d7da; color: #721c24; }
  .badge.ok { background: #d4edda; color: #155724; }
  .badge.err-badge { background: #f8d7da; color: #721c24; }
  .err { color: #e74c3c; }
  .banner-ok { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; padding: .75rem 1rem; border-radius: 4px; margin-bottom: 1rem; }
  .form-row { margin-bottom: .9rem; }
  .form-row label { display: block; font-size: .875rem; font-weight: 600; margin-bottom: .3rem; }
  .form-row input[type=text], .form-row select, .form-row textarea { width: 100%; padding: .4rem .6rem; border: 1px solid #ccc; border-radius: 4px; font-size: .9rem; }
  .form-row textarea { resize: vertical; }
  .form-row small { font-size: .78rem; color: #888; }
  .readonly-field { font-size: .9rem; color: #555; background: #f8f9fa; padding: .35rem .6rem; border-radius: 4px; border: 1px solid #e0e0e0; display: block; word-break: break-all; }
  table { width: 100%; border-collapse: collapse; background: #fff; font-size: .875rem; }
  th, td { padding: .5rem .75rem; text-align: left; border-bottom: 1px solid #eee; }
  th { background: #f4f6f8; font-weight: 600; white-space: nowrap; }
  tr:hover td { background: #f9fbff; }
  .status-badge { display: inline-block; padding: .15rem .4rem; border-radius: 3px; font-size: .75rem; font-weight: 600; color: #fff; }
</style>
</head>
<body>
<div class="container">${body}</div>
</body>
</html>`;
}

// ---- Login ----

router.get('/login', (req, res) => {
  const error = req.query.error === '1';
  res.send(`<!DOCTYPE html>
<html><head><title>Dashboard Login</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f4f6f8; }
  .card { background: #fff; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,.1); min-width: 320px; }
  h2 { margin-top: 0; }
  label { display: block; font-size: .875rem; font-weight: 600; margin-bottom: .3rem; }
  input[type=password] { width: 100%; padding: .5rem .6rem; margin-bottom: 1rem; border: 1px solid #ccc; border-radius: 4px; font-size: 1rem; }
  button { width: 100%; padding: .6rem; background: #1a73e8; color: #fff; border: none; border-radius: 4px; font-size: 1rem; cursor: pointer; }
  button:hover { background: #1558b0; }
  .err { color: #e74c3c; margin-bottom: .75rem; font-size: .9rem; }
</style>
</head><body>
<div class="card">
  <h2>GetKlosed Dashboard</h2>
  ${error ? '<p class="err">Incorrect password.</p>' : ''}
  <form method="POST" action="/dashboard/login">
    <label for="password">Password</label>
    <input type="password" id="password" name="password" autofocus required />
    <button type="submit">Sign In</button>
  </form>
</div>
</body></html>`);
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
  HOT: '#e74c3c',
  awaiting_agent: '#e67e22',
  awaiting_response: '#f39c12',
  needs_review: '#9b59b6',
  warm: '#27ae60',
  cold: '#7f8c8d',
  new: '#2980b9',
};

const TS_RE = /^\[(\d{4}-\d{2}-\d{2}T[\d:.Z+-]+)/;

router.get('/', async (req, res) => {
  try {
    const agentIds = discoverAgentIds();
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
        return `<div class="card error"><h3>${escHtml(agentIds[i])}</h3><p class="err">Error loading agent: ${escHtml(result.reason.message)}</p></div>`;
      }
      const { agentId, agent, leadCounts, recentActivity, followUpPipeline, lastCycleRun, oauthHealthy } = result.value;

      const modeBadge = agent.mode === 'live'
        ? '<span class="badge live">LIVE</span>'
        : '<span class="badge shadow">SHADOW</span>';
      const activeBadge = agent.isActive
        ? '<span class="badge active">Active</span>'
        : '<span class="badge paused">Paused</span>';
      const oauthBadge = oauthHealthy
        ? '<span class="badge ok">Token OK</span>'
        : '<span class="badge err-badge">No Token</span>';

      const hotClass = leadCounts.HOT > 0 ? ' hot' : '';

      const pipelineHtml = followUpPipeline.length
        ? followUpPipeline.map((f) => `<li>${escHtml(f.name)} &mdash; touch ${f.followUpCount}/3</li>`).join('')
        : '<li><em>none</em></li>';

      const activityHtml = recentActivity.length
        ? recentActivity.map((a) => `<li>${escHtml(a.substring(0, 120))}</li>`).join('')
        : '<li><em>none</em></li>';

      return `<div class="card">
  <div class="card-header">
    <h3>${escHtml(agentId)}</h3>
    <div>${modeBadge} ${activeBadge} ${oauthBadge}</div>
  </div>
  ${lastCycleRun ? `<p class="meta">Last cycle: ${escHtml(lastCycleRun)}</p>` : ''}
  <div class="stat-row">
    <div class="stat-item"><span class="stat-label">HOT</span> <span class="stat-val${hotClass}">${leadCounts.HOT}</span></div>
    <div class="stat-item"><span class="stat-label">Awaiting Agent</span> <span class="stat-val">${leadCounts.awaiting_agent}</span></div>
    <div class="stat-item"><span class="stat-label">Awaiting Response</span> <span class="stat-val">${leadCounts.awaiting_response}</span></div>
    <div class="stat-item"><span class="stat-label">Needs Review</span> <span class="stat-val">${leadCounts.needs_review}</span></div>
    <div class="stat-item"><span class="stat-label">Warm</span> <span class="stat-val">${leadCounts.warm}</span></div>
    <div class="stat-item"><span class="stat-label">Cold</span> <span class="stat-val">${leadCounts.cold}</span></div>
    <div class="stat-item"><span class="stat-label">New</span> <span class="stat-val">${leadCounts.new}</span></div>
    <div class="stat-item"><span class="stat-label">Total</span> <span class="stat-val">${leadCounts.total}</span></div>
  </div>
  <div class="section">
    <h4>Follow-up Pipeline</h4>
    <ul>${pipelineHtml}</ul>
  </div>
  <div class="section">
    <h4>Recent Activity</h4>
    <ul>${activityHtml}</ul>
  </div>
  <div class="actions">
    <a href="/dashboard/agent/${encodeURIComponent(agentId)}/edit" class="btn btn-sm">Edit Agent</a>
    <a href="/dashboard/agent/${encodeURIComponent(agentId)}/leads" class="btn btn-sm">View Leads</a>
  </div>
</div>`;
    });

    res.send(pageWrap('GetKlosed Dashboard', `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
  <h1 style="margin:0">GetKlosed Dashboard</h1>
  <a href="/dashboard/logout" class="btn btn-sm">Logout</a>
</div>
<div class="grid">${cards.join('')}</div>`));
  } catch (err) {
    console.error('[dashboard] GET /:', err.message);
    res.status(500).send(err.message);
  }
});

// ---- Edit agent ----

router.get('/agent/:agentId/edit', (req, res) => {
  try {
    let agent;
    try { agent = loadAgent(req.params.agentId); } catch { return res.status(404).send('Agent not found'); }

    const { agentId } = req.params;
    const saved = req.query.saved === '1';
    const cadence = Array.isArray(agent.followUpCadence)
      ? agent.followUpCadence.join(', ')
      : (agent.followUpCadence || '3, 7, 14');
    const avoidPhrases = Array.isArray(agent.avoidPhrases)
      ? agent.avoidPhrases.join('\n')
      : (agent.avoidPhrases || '');

    const contentProfile = readContentProfile(agentId);
    const contentEngineFieldHtml = contentProfile === null
      ? `<div class="form-row"><label>Content Engine</label><span class="readonly-field">Not provisioned. Run <code>node scripts/enable-content-engine.js ${escHtml(agentId)}</code> to provision.</span></div>`
      : field('Content Engine Enabled', 'contentEngineEnabled', select('contentEngineEnabled', ['false', 'true'], String(contentProfile.contentEngineEnabled)));

    res.send(pageWrap(`Edit: ${agentId}`, `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
  <h2 style="margin:0">Edit Agent: ${escHtml(agentId)}</h2>
  <a href="/dashboard" class="btn btn-sm">&#8592; Back</a>
</div>
${saved ? '<div class="banner-ok">Changes saved.</div>' : ''}
<div class="card">
  <div class="form-row"><label>Agent ID</label><span class="readonly-field">${escHtml(agent.agentId || agentId)}</span></div>
  <div class="form-row"><label>Gmail Address</label><span class="readonly-field">${escHtml(agent.gmailAddress || '')}</span></div>
  <div class="form-row"><label>Google Sheet ID</label><span class="readonly-field">${escHtml(agent.googleSheetId || '')}</span></div>

  <form method="POST" action="/dashboard/agent/${encodeURIComponent(agentId)}/edit">
    ${field('Mode', 'mode', select('mode', ['shadow', 'live'], agent.mode))}
    ${field('Agent Active', 'isActive', select('isActive', ['true', 'false'], String(agent.isActive)))}
    ${field('Agent Phone', 'agentPhone', `<input type="text" name="agentPhone" value="${escHtml(agent.agentPhone || '')}" />`)}
    ${field('Escalation Email', 'escalationEmail', `<input type="text" name="escalationEmail" value="${escHtml(agent.escalationEmail || '')}" />`)}
    ${field('Follow-up Cadence', 'followUpCadence', `<input type="text" name="followUpCadence" value="${escHtml(cadence)}" placeholder="e.g. 3, 7, 14" /><small>comma-separated days</small>`)}
    ${field('Tone', 'tone', `<input type="text" name="tone" value="${escHtml(agent.tone || '')}" />`)}
    ${field('Email Length', 'emailLength', select('emailLength', ['short', 'medium', 'long'], agent.emailLength))}
    ${field('Uses Emojis', 'usesEmojis', select('usesEmojis', ['false', 'true'], String(agent.usesEmojis)))}
    ${field('Avoid Phrases', 'avoidPhrases', `<textarea name="avoidPhrases" rows="4">${escHtml(avoidPhrases)}</textarea>`)}
    ${field('Agent Signature', 'agentSignature', `<input type="text" name="agentSignature" value="${escHtml(agent.agentSignature || '')}" />`)}
    ${contentEngineFieldHtml}

    <div class="form-row" style="margin-top:1.25rem">
      <a href="/onboard/oauth/start?agentId=${encodeURIComponent(agentId)}" class="btn" style="background:#e67e22">Re-authorize Google Account</a>
    </div>
    <div class="form-row">
      <button type="submit" class="btn">Save Changes</button>
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
    if (!fs.existsSync(filePath)) return res.status(404).send('Agent not found');

    let agent;
    try { agent = loadAgent(agentId); } catch { return res.status(404).send('Agent not found'); }

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

    const profileForCE = readContentProfile(agentId);
    if (profileForCE !== null && (b.contentEngineEnabled === 'true' || b.contentEngineEnabled === 'false')) {
      const desired = b.contentEngineEnabled === 'true';
      if (profileForCE.contentEngineEnabled !== desired) {
        setContentEngineEnabled(agentId, desired);
      }
    }

    res.redirect(`/dashboard/agent/${encodeURIComponent(agentId)}/edit?saved=1`);
  } catch (err) {
    console.error('[dashboard] POST /agent/:id/edit:', err.message);
    res.status(500).send(err.message);
  }
});

// ---- Leads table ----

router.get('/agent/:agentId/leads', async (req, res) => {
  try {
    const { agentId } = req.params;
    let agent;
    try { agent = loadAgent(agentId); } catch { return res.status(404).send('Agent not found'); }

    let rows = [];
    try { rows = await email.readSheetRows(agent); } catch { /* render empty */ }

    const rowsHtml = rows.map((row) => {
      const aiOn = isAiEnabled(row);
      const isSoi = (row.leadCategory || '').toLowerCase() === 'soi';
      const sc = STATUS_COLOR[row.status] || '#555';
      const lastAction = (() => {
        if (!row.conversationHistory) return '';
        const lines = row.conversationHistory.split('\n').filter(Boolean);
        return (lines[lines.length - 1] || '').substring(0, 80);
      })();
      return `<tr>
  <td>${row.rowIndex}</td>
  <td>${escHtml(row.name || '')}</td>
  <td>${escHtml(row.leadId || '')}</td>
  <td><span class="status-badge" style="background:${sc}">${escHtml(row.status || '')}</span></td>
  <td>${aiOn ? 'Yes' : 'No'}
    <form method="POST" action="/dashboard/agent/${encodeURIComponent(agentId)}/leads/${row.rowIndex}/toggle-ai" style="display:inline;margin-left:.35rem">
      <button type="submit" class="btn-link">[toggle]</button>
    </form>
  </td>
  <td>${escHtml(row.source || '')}</td>
  <td>${escHtml(String(row.followUpCount || ''))}</td>
  <td>${escHtml(lastAction)}</td>
  <td>
    <form method="POST" action="/dashboard/agent/${encodeURIComponent(agentId)}/leads/${row.rowIndex}/toggle-soi" style="display:inline">
      <button type="submit" class="btn-link">${isSoi ? '[unmark SOI]' : '[mark SOI]'}</button>
    </form>
  </td>
</tr>`;
    }).join('');

    res.send(pageWrap(`Leads: ${agentId}`, `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
  <h2 style="margin:0">Leads: ${escHtml(agentId)}</h2>
  <a href="/dashboard" class="btn btn-sm">&#8592; Back</a>
</div>
<div style="overflow-x:auto">
  <table>
    <thead><tr>
      <th>Row</th><th>Name</th><th>Email</th><th>Status</th>
      <th>AI Enabled</th><th>Source</th><th>Follow-Up Count</th><th>Last Action</th><th>SOI</th>
    </tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="9"><em>No rows found.</em></td></tr>'}</tbody>
  </table>
</div>`));
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
    try { agent = loadAgent(agentId); } catch { return res.status(404).send('Agent not found'); }
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
    try { agent = loadAgent(agentId); } catch { return res.status(404).send('Agent not found'); }
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

module.exports = router;
