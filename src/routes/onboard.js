'use strict';
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const { getStorageRoot } = require('../storagePaths');

const router = express.Router();

function getAgentsDir() { return getStorageRoot(); }

const COLUMN_HEADERS = [
  'Lead ID', 'Name', 'Phone', 'Source', 'Date Added',
  'Original Message', 'Status', 'Follow Up Count', 'Next Follow Up Day',
  'Last Follow Up Date', 'Reserved', 'Conversation History', 'Pending Question',
  'Gmail Thread ID', 'AI Enabled', 'Last Action Timestamp', 'Reminder Sent At',
  'Validation Status', 'Operator Escalated At', 'Lead Category',
];

function writeAgentAtomic(agentId, config) {
  const tmpPath = path.join(getAgentsDir(), `${agentId}.tmp.json`);
  const finalPath = path.join(getAgentsDir(), `${agentId}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n');
  fs.renameSync(tmpPath, finalPath);
}

function generateAgentId(name) {
  const base = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  let candidate = base;
  let suffix = 2;
  while (fs.existsSync(path.join(getAgentsDir(), `${candidate}.json`))) {
    candidate = `${base}-${suffix++}`;
  }
  return candidate;
}

function makeOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.OAUTH_REDIRECT_URI || 'http://localhost:3000/onboard/oauth/callback'
  );
}

const {
  ROOT_TOKENS,
  SHARED_HEAD_LINKS,
  SHARED_HEADER,
  SHARED_FOOTER,
  ARROW_SVG,
  renderErrorPage,
} = require('../brandChrome');

const FORM_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GetKlosed: Onboard your agent</title>${SHARED_HEAD_LINKS}
  <style>${ROOT_TOKENS}
    .page-heading { padding: 48px 0 32px; }
    .page-heading h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 10px; }
    .subhead { font-size: 15px; color: var(--muted); line-height: 1.6; }
    .form-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 32px; margin-bottom: 16px; }
    .form-section { margin-bottom: 28px; }
    .form-section:last-child { margin-bottom: 0; }
    .form-section h2 { font-size: 12px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; color: var(--muted); margin-bottom: 20px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
    .field { margin-bottom: 18px; }
    .field:last-child { margin-bottom: 0; }
    .field label { display: block; font-size: 14px; font-weight: 500; color: var(--text); margin-bottom: 6px; }
    .field .required { color: var(--violet-bright); margin-left: 3px; }
    .field input[type=text],
    .field input[type=email],
    .field input[type=tel],
    .field input[type=number],
    .field select,
    .field textarea {
      width: 100%; padding: 10px 14px;
      background: var(--surface-2); color: var(--text);
      border: 1px solid var(--border); border-radius: 8px;
      font-family: var(--font); font-size: 14px;
      outline: none; transition: border-color 0.15s, box-shadow 0.15s;
      -webkit-appearance: none; appearance: none;
    }
    .field input::placeholder, .field textarea::placeholder { color: var(--muted-2); }
    .field input:focus, .field select:focus, .field textarea:focus { border-color: var(--violet); box-shadow: 0 0 0 3px var(--violet-soft); }
    .field textarea { min-height: 80px; resize: vertical; }
    .field select { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238b8b93' d='M6 8L1 3h10z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 36px; cursor: pointer; }
    .field .help { font-size: 12px; color: var(--muted); margin-top: 5px; line-height: 1.5; }
    .radio-group { display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
    .radio-option { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; cursor: pointer; transition: border-color 0.15s; }
    .radio-option input[type=radio] { accent-color: var(--violet); width: 16px; height: 16px; flex-shrink: 0; cursor: pointer; margin-top: 2px; }
    .radio-option:has(input:checked) { border-color: var(--violet); background: var(--violet-soft); }
    .radio-option .radio-label { display: block; font-size: 14px; font-weight: 500; }
    .radio-option .radio-desc { display: block; font-size: 13px; color: var(--muted); margin-top: 3px; line-height: 1.45; }
    .btn-submit { width: 100%; margin-top: 8px; }
    .submit-note { text-align: center; font-size: 12px; color: var(--muted); margin-top: 12px; line-height: 1.5; }
    @media (max-width: 600px) {
      .form-card { padding: 20px; }
      .page-heading { padding: 32px 0 20px; }
      .site-footer .shell-narrow { flex-direction: column; align-items: flex-start; }
    }
  </style>
</head>
<body>
${SHARED_HEADER}
  <main>
    <div class="shell-narrow">
      <div class="page-heading">
        <h1>Connect your inbox</h1>
        <p class="subhead">We'll set up the AI on your Gmail and create your lead tracking sheet. Takes about 10 minutes.</p>
      </div>

      <form action="/onboard" method="POST">
        <div class="form-card">

          <div class="form-section">
            <h2>Your info</h2>
            <div class="field">
              <label for="firstName">First Name<span class="required">*</span></label>
              <input type="text" id="firstName" name="firstName" required placeholder="Sarah">
            </div>
            <div class="field">
              <label for="lastName">Last Name<span class="required">*</span></label>
              <input type="text" id="lastName" name="lastName" required placeholder="Ahmed">
            </div>
            <div class="field">
              <label for="gmailAddress">Email Address<span class="required">*</span></label>
              <input type="email" id="gmailAddress" name="gmailAddress" required placeholder="sarah@gmail.com">
            </div>
            <div class="field">
              <label for="agentPhone">Phone Number<span class="required">*</span></label>
              <input type="tel" id="agentPhone" name="agentPhone" required placeholder="+16471234567">
            </div>
          </div>

          <div class="form-section">
            <h2>Brokerage</h2>
            <div class="field">
              <label for="brokerage">Brokerage Name<span class="required">*</span></label>
              <input type="text" id="brokerage" name="brokerage" required placeholder="Royal LePage">
            </div>
            <div class="field">
              <label for="brokerageLocation">Brokerage City<span class="required">*</span></label>
              <input type="text" id="brokerageLocation" name="brokerageLocation" required placeholder="Toronto, Ontario">
            </div>
          </div>

          <div class="form-section">
            <h2>Communication</h2>
            <div class="field">
              <label for="escalationEmail">Escalation Email<span class="required">*</span></label>
              <input type="email" id="escalationEmail" name="escalationEmail" required placeholder="sarah@gmail.com">
              <div class="help">Where urgent leads or questions get forwarded. Usually the same as your email.</div>
            </div>
            <div class="field">
              <label for="agentSignature">Agent Signature</label>
              <input type="text" id="agentSignature" name="agentSignature" placeholder="Sarah | Royal LePage">
              <div class="help">Optional. If left blank, we'll use your existing Gmail signature.</div>
            </div>
            <div class="field">
              <label for="tone">Tone<span class="required">*</span></label>
              <input type="text" id="tone" name="tone" required placeholder="warm, professional, and concise">
            </div>
            <div class="field">
              <label for="emailLength">Email Length<span class="required">*</span></label>
              <select id="emailLength" name="emailLength">
                <option value="short" selected>Short</option>
                <option value="medium">Medium</option>
                <option value="long">Long</option>
              </select>
            </div>
            <div class="field">
              <label for="usesEmojis">Uses Emojis</label>
              <select id="usesEmojis" name="usesEmojis">
                <option value="no" selected>No</option>
                <option value="yes">Yes</option>
              </select>
            </div>
            <div class="field">
              <label for="avoidPhrases">Avoid Phrases</label>
              <textarea id="avoidPhrases" name="avoidPhrases" placeholder="Just checking in, thanks for reaching out"></textarea>
              <div class="help">Comma-separated. The AI will never use these phrases.</div>
            </div>
          </div>

          <div class="form-section">
            <h2>Market focus</h2>
            <div class="field">
              <label for="targetMarket">Target Market</label>
              <input type="text" id="targetMarket" name="targetMarket" placeholder="first-time buyers in Toronto">
            </div>
            <div class="field">
              <label for="specialties">Specialties</label>
              <input type="text" id="specialties" name="specialties" placeholder="condos, investment properties">
              <div class="help">Comma-separated.</div>
            </div>
            <div class="field">
              <label for="yearsExperience">Years of Experience</label>
              <input type="number" id="yearsExperience" name="yearsExperience" min="0" placeholder="5">
            </div>
          </div>

          <div class="form-section">
            <h2>Agent mode</h2>
            <div class="field">
              <label>Mode</label>
              <div class="radio-group">
                <label class="radio-option">
                  <input type="radio" name="mode" value="shadow" checked>
                  <div>
                    <span class="radio-label">Shadow Mode (recommended)</span>
                    <span class="radio-desc">AI drafts every reply for you to review and send. Nothing goes out without your approval.</span>
                  </div>
                </label>
                <label class="radio-option">
                  <input type="radio" name="mode" value="live">
                  <div>
                    <span class="radio-label">Live Mode</span>
                    <span class="radio-desc">AI sends replies directly. You'll still get notified for anything urgent.</span>
                  </div>
                </label>
              </div>
            </div>
          </div>

        </div>

        <button type="submit" class="btn-primary btn-submit">
          Save &amp; Connect Google Account
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <p class="submit-note">By continuing, you'll be redirected to Google to grant Gmail and Sheets access.</p>
      </form>
    </div>
  </main>
${SHARED_FOOTER}
</body>
</html>`;

// GET /onboard
router.get('/', (req, res) => {
  res.send(FORM_HTML);
});

// POST /onboard
router.post('/', (req, res) => {
  try {
    const b = req.body;
    const firstName = (b.firstName || '').trim();
    const lastName = (b.lastName || '').trim();
    const agentName = (firstName + ' ' + lastName).trim();
    const agentPhone = (b.agentPhone || '').trim();

    const splitArr = (val) =>
      (val || '').split(',').map((s) => s.trim()).filter(Boolean);

    const agentId = generateAgentId(agentName);

    const config = {
      agentId,
      operatorId: 'mo',
      agentName,
      firstName,
      lastName,
      brokerage: (b.brokerage || '').trim(),
      brokerageLocation: (b.brokerageLocation || '').trim(),
      gmailAddress: (b.gmailAddress || '').trim(),
      agentPhone,
      agentSignature: (b.agentSignature || '').trim(),
      tone: (b.tone || '').trim(),
      emailLength: b.emailLength || 'short',
      usesEmojis: (b.usesEmojis || 'no').toLowerCase() === 'yes',
      avoidPhrases: splitArr(b.avoidPhrases),
      targetMarket: (b.targetMarket || '').trim(),
      specialties: splitArr(b.specialties),
      yearsExperience: parseInt(b.yearsExperience, 10) || 0,
      aiCannotInvent: [],
      escalationEmail: (b.escalationEmail || '').trim(),
      ccEmails: [],
      bccEmails: [],
      digestTime: '07:00',
      timezone: 'America/Toronto',
      isActive: true,
      mode: b.mode === 'live' ? 'live' : 'shadow',
      provider: 'gmail',
      operatorPhone: agentPhone,
      googleRefreshToken: '',
      googleSheetId: '',
    };

    writeAgentAtomic(agentId, config);
    res.redirect(`/onboard/oauth/start?agentId=${encodeURIComponent(agentId)}`);
  } catch (err) {
    res.status(500).send(renderErrorPage(
      "We couldn't save your details",
      'Something went wrong saving your onboarding info. Please try again, or email mohanad@getklosed.ca if it keeps happening.',
      { href: '/onboard', label: 'Try again' }
    ));
  }
});

// GET /onboard/oauth/start
router.get('/oauth/start', (req, res) => {
  const { agentId } = req.query;
  if (!agentId) {
    return res.status(400).send('Missing agentId');
  }

  const oauth2Client = makeOAuthClient();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
    state: agentId,
  });

  res.redirect(authUrl);
});

// GET /onboard/oauth/callback
router.get('/oauth/callback', async (req, res) => {
  const { code, state: agentId } = req.query;
  if (!code || !agentId) {
    return res.status(400).send(renderErrorPage(
      "Connection didn't complete",
      "It looks like the Google authorization step didn't finish. This can happen if you closed the window or denied access.",
      { href: '/onboard', label: 'Start over' }
    ));
  }

  try {
    const oauth2Client = makeOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      return res.status(400).send(renderErrorPage(
        'We need a fresh connection',
        'Google did not send us a refresh token, which usually means this Gmail account has connected to GetKlosed before. Please revoke the existing GetKlosed access at https://myaccount.google.com/permissions and try again.',
        { href: '/onboard', label: 'Try again' }
      ));
    }

    const agentPath = path.join(getAgentsDir(), `${agentId}.json`);
    const config = JSON.parse(fs.readFileSync(agentPath, 'utf-8'));
    config.googleRefreshToken = tokens.refresh_token;
    config.isActive = true;
    writeAgentAtomic(agentId, config);

    // Set up the Google Sheet (non-fatal if it fails)
    try {
      oauth2Client.setCredentials(tokens);
      const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

      const createRes = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: `${config.agentName} Leads` },
        },
      });
      const spreadsheetId = createRes.data.spreadsheetId;
      const firstSheet = createRes.data.sheets[0];
      const internalSheetId = firstSheet.properties.sheetId;
      const tabName = firstSheet.properties.title;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tabName}!A1:T1`,
        valueInputOption: 'RAW',
        requestBody: { values: [COLUMN_HEADERS] },
      });

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: internalSheetId,
                  gridProperties: { frozenRowCount: 1 },
                },
                fields: 'gridProperties.frozenRowCount',
              },
            },
            {
              repeatCell: {
                range: {
                  sheetId: internalSheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: COLUMN_HEADERS.length,
                },
                cell: { userEnteredFormat: { textFormat: { bold: true } } },
                fields: 'userEnteredFormat.textFormat.bold',
              },
            },
            {
              updateDimensionProperties: {
                range: {
                  sheetId: internalSheetId,
                  dimension: 'COLUMNS',
                  startIndex: 0,
                  endIndex: COLUMN_HEADERS.length,
                },
                properties: { pixelSize: 180 },
                fields: 'pixelSize',
              },
            },
          ],
        },
      });

      config.googleSheetId = spreadsheetId;
      writeAgentAtomic(agentId, config);
    } catch (sheetErr) {
      console.error(`[onboard] Sheet setup failed for ${agentId}:`, sheetErr.message);
    }

    res.redirect(`/onboard/done?agentId=${encodeURIComponent(agentId)}`);
  } catch (err) {
    res.status(500).send(renderErrorPage(
      'Something went wrong',
      'We hit an error while finishing your setup. Please try again, or email mohanad@getklosed.ca with this error: ' + (err && err.message ? err.message : 'unknown'),
      { href: '/onboard', label: 'Try again' }
    ));
  }
});

// GET /onboard/done
router.get('/done', (req, res) => {
  const { agentId } = req.query;
  let agentName = '';
  let gmailAddress = '';
  let googleSheetId = '';

  if (agentId) {
    try {
      const config = JSON.parse(
        fs.readFileSync(path.join(getAgentsDir(), `${agentId}.json`), 'utf-8')
      );
      agentName = config.agentName || '';
      gmailAddress = config.gmailAddress || '';
      googleSheetId = config.googleSheetId || '';
    } catch (_) {
      // non-fatal -- render page without agent details
    }
  }

  const sheetLink = googleSheetId
    ? `<a class="sheet-link" href="https://docs.google.com/spreadsheets/d/${googleSheetId}/edit" target="_blank">Open Your Leads Sheet</a>`
    : '';

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GetKlosed: All set</title>${SHARED_HEAD_LINKS}
  <style>${ROOT_TOKENS}
    .success-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 40px 32px; margin-top: 48px; }
    .success-icon { width: 56px; height: 56px; background: var(--violet-soft); border: 1px solid var(--violet); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 24px; }
    .success-icon svg { width: 28px; height: 28px; }
    .success-card h1 { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 10px; }
    .success-card .subhead { font-size: 15px; color: var(--muted); line-height: 1.6; margin-bottom: 32px; }
    .steps-label { font-size: 12px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; color: var(--muted); margin-bottom: 16px; }
    .step-list { display: flex; flex-direction: column; gap: 16px; }
    .step-item { display: flex; gap: 16px; align-items: flex-start; }
    .step-number { width: 26px; height: 26px; border-radius: 50%; background: var(--violet); color: #fff; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
    .step-body { flex: 1; }
    .step-body strong { display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px; }
    .step-body p { font-size: 14px; color: var(--muted); line-height: 1.55; }
    .sheet-link { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; padding: 8px 16px; background: var(--violet); color: #fff; text-decoration: none; border-radius: 8px; font-size: 13px; font-weight: 600; transition: background 0.15s; }
    .sheet-link:hover { background: var(--violet-bright); }
    .contact-note { margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--border); font-size: 13px; color: var(--muted-2); }
    .contact-note a { color: var(--muted); text-decoration: none; }
    .contact-note a:hover { color: var(--text); }
    @media (max-width: 600px) {
      .success-card { padding: 24px 20px; }
      .site-footer .shell-narrow { flex-direction: column; align-items: flex-start; }
    }
  </style>
</head>
<body>
${SHARED_HEADER}
  <main>
    <div class="shell-narrow">
      <div class="success-card">
        <div class="success-icon">
          <svg viewBox="0 0 28 28" fill="none">
            <path d="M6 14.5l5.5 5.5 10-11" stroke="var(--violet-bright)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h1>You're all set${agentName ? ', ' + agentName.split(' ')[0] : ''}.</h1>
        <p class="subhead">GetKlosed is now connected${gmailAddress ? ' to ' + gmailAddress : ''} and ready to start handling your leads.</p>

        <p class="steps-label">What happens next</p>
        <div class="step-list">
          <div class="step-item">
            <div class="step-number">1</div>
            <div class="step-body">
              <strong>Send your first lead.</strong>
              <p>We'll start drafting replies within 5 minutes of new emails arriving in your inbox.</p>
            </div>
          </div>
          <div class="step-item">
            <div class="step-number">2</div>
            <div class="step-body">
              <strong>Review your tracking sheet.</strong>
              <p>Every lead, reply, and follow-up gets logged here for you to review.</p>
              ${sheetLink}
            </div>
          </div>
          <div class="step-item">
            <div class="step-number">3</div>
            <div class="step-body">
              <strong>Watch the digest.</strong>
              <p>You'll get a daily summary email and SMS for anything urgent.</p>
            </div>
          </div>
        </div>

        <p class="contact-note">Questions or issues? Email <a href="mailto:mohanad@getklosed.ca">mohanad@getklosed.ca</a>.</p>
      </div>
    </div>
  </main>
${SHARED_FOOTER}
</body>
</html>`);
});

module.exports = router;
