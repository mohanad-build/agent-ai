'use strict';
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const router = express.Router();

const AGENTS_DIR = path.resolve(__dirname, '..', '..', 'agents');

const COLUMN_HEADERS = [
  'Lead ID', 'Name', 'Phone', 'Source', 'Date Added',
  'Original Message', 'Status', 'Follow Up Count', 'Next Follow Up Day',
  'Last Follow Up Date', 'Reserved', 'Conversation History', 'Pending Question',
  'Gmail Thread ID', 'AI Enabled', 'Last Action Timestamp', 'Reminder Sent At',
  'Validation Status', 'Operator Escalated At', 'Lead Category',
];

function writeAgentAtomic(agentId, config) {
  const tmpPath = path.join(AGENTS_DIR, `${agentId}.tmp.json`);
  const finalPath = path.join(AGENTS_DIR, `${agentId}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n');
  fs.renameSync(tmpPath, finalPath);
}

function generateAgentId(name) {
  const base = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  let candidate = base;
  let suffix = 2;
  while (fs.existsSync(path.join(AGENTS_DIR, `${candidate}.json`))) {
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

const FORM_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Onboarding</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px 16px; }
    .container { background: #fff; max-width: 640px; margin: 0 auto; padding: 40px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
    h1 { font-size: 24px; margin-bottom: 8px; }
    .subtitle { color: #666; margin-bottom: 32px; font-size: 14px; }
    .field { margin-bottom: 20px; }
    label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; }
    .hint { font-size: 12px; color: #888; margin-top: 4px; }
    input[type=text], input[type=email], input[type=tel], input[type=number], select, textarea {
      width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 6px;
      font-size: 14px; outline: none; transition: border-color 0.15s;
    }
    input:focus, select:focus, textarea:focus { border-color: #3b82f6; }
    textarea { min-height: 80px; resize: vertical; }
    .radio-group { display: flex; gap: 24px; margin-top: 6px; }
    .radio-group label { font-weight: normal; display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .section-title { font-size: 16px; font-weight: 600; margin: 28px 0 16px; border-top: 1px solid #e5e7eb; padding-top: 20px; }
    .checkbox-row { display: flex; align-items: center; gap: 10px; }
    .checkbox-row input { width: auto; }
    .checkbox-row label { margin: 0; font-weight: normal; }
    button[type=submit] {
      width: 100%; padding: 12px; background: #1d4ed8; color: #fff;
      border: none; border-radius: 6px; font-size: 16px; font-weight: 600;
      cursor: pointer; margin-top: 16px; transition: background 0.15s;
    }
    button[type=submit]:hover { background: #1e40af; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Agent Onboarding</h1>
    <p class="subtitle">Fill out your profile, then connect your Google account to activate your agent.</p>
    <form action="/onboard" method="POST">

      <div class="section-title">Your Info</div>

      <div class="field">
        <label for="agentName">Full Name <span style="color:red">*</span></label>
        <input type="text" id="agentName" name="agentName" required placeholder="Sarah Ahmed">
      </div>
      <div class="field">
        <label for="firstName">First Name <span style="color:red">*</span></label>
        <input type="text" id="firstName" name="firstName" required placeholder="Sarah">
      </div>
      <div class="field">
        <label for="gmailAddress">Email Address <span style="color:red">*</span></label>
        <input type="email" id="gmailAddress" name="gmailAddress" required placeholder="sarah@gmail.com">
      </div>
      <div class="field">
        <label for="agentPhone">Phone Number <span style="color:red">*</span></label>
        <input type="tel" id="agentPhone" name="agentPhone" required placeholder="+16471234567">
      </div>

      <div class="section-title">Brokerage</div>

      <div class="field">
        <label for="brokerage">Brokerage Name <span style="color:red">*</span></label>
        <input type="text" id="brokerage" name="brokerage" required placeholder="Royal LePage">
      </div>
      <div class="field">
        <label for="brokerageLocation">Brokerage City <span style="color:red">*</span></label>
        <input type="text" id="brokerageLocation" name="brokerageLocation" required placeholder="Toronto, Ontario">
      </div>

      <div class="section-title">Communication</div>

      <div class="field">
        <label for="escalationEmail">Escalation Email <span style="color:red">*</span></label>
        <input type="email" id="escalationEmail" name="escalationEmail" required placeholder="sarah@gmail.com">
        <div class="hint">Where urgent leads or questions get forwarded. Usually the same as your email.</div>
      </div>
      <div class="field">
        <label for="agentSignature">Agent Signature <span style="color:red">*</span></label>
        <input type="text" id="agentSignature" name="agentSignature" required placeholder="Sarah | Royal LePage">
      </div>
      <div class="field">
        <label for="tone">Tone <span style="color:red">*</span></label>
        <input type="text" id="tone" name="tone" required placeholder="warm, professional, and concise">
      </div>
      <div class="field">
        <label for="emailLength">Email Length <span style="color:red">*</span></label>
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
        <div class="hint">Comma-separated. The AI will never use these phrases.</div>
      </div>

      <div class="section-title">Market Focus</div>

      <div class="field">
        <label for="targetMarket">Target Market</label>
        <input type="text" id="targetMarket" name="targetMarket" placeholder="first-time buyers in Toronto">
      </div>
      <div class="field">
        <label for="specialties">Specialties</label>
        <input type="text" id="specialties" name="specialties" placeholder="condos, investment properties">
        <div class="hint">Comma-separated.</div>
      </div>
      <div class="field">
        <label for="yearsExperience">Years of Experience</label>
        <input type="number" id="yearsExperience" name="yearsExperience" min="0" placeholder="5">
      </div>

      <div class="section-title">Agent Mode</div>

      <div class="field">
        <label>Mode</label>
        <div class="radio-group">
          <label><input type="radio" name="mode" value="shadow" checked> Shadow Mode (recommended)</label>
          <label><input type="radio" name="mode" value="live"> Live Mode</label>
        </div>
      </div>
      <div class="field">
        <div class="checkbox-row">
          <input type="checkbox" id="isContentEngineEnabled" name="isContentEngineEnabled" value="yes">
          <label for="isContentEngineEnabled">Enable Content Engine</label>
        </div>
      </div>

      <button type="submit">Save &amp; Connect Google Account</button>
    </form>
  </div>
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
    const agentName = (b.agentName || '').trim();
    const agentPhone = (b.agentPhone || '').trim();

    const splitArr = (val) =>
      (val || '').split(',').map((s) => s.trim()).filter(Boolean);

    const agentId = generateAgentId(agentName);

    const config = {
      agentId,
      operatorId: 'mo',
      agentName,
      firstName: (b.firstName || '').trim(),
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
      isContentEngineEnabled: b.isContentEngineEnabled === 'yes',
      googleRefreshToken: '',
      googleSheetId: '',
    };

    writeAgentAtomic(agentId, config);
    res.redirect(`/onboard/oauth/start?agentId=${encodeURIComponent(agentId)}`);
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
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
    return res.status(400).send('Missing code or state (agentId) in callback');
  }

  try {
    const oauth2Client = makeOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      return res.status(400).send('No refresh token received. Please try again.');
    }

    const agentPath = path.join(AGENTS_DIR, `${agentId}.json`);
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
    res.status(500).send(`Error: ${err.message}`);
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
        fs.readFileSync(path.join(AGENTS_DIR, `${agentId}.json`), 'utf-8')
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
  <title>You're All Set!</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px 16px; }
    .container { background: #fff; max-width: 640px; margin: 0 auto; padding: 40px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.1); text-align: center; }
    h1 { font-size: 28px; margin-bottom: 16px; color: #15803d; }
    .detail { font-size: 15px; color: #374151; margin: 8px 0; }
    .note { margin-top: 28px; padding: 16px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; font-size: 14px; color: #92400e; text-align: left; }
    .sheet-link { display: inline-block; margin-top: 24px; padding: 10px 20px; background: #1d4ed8; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; }
    .sheet-link:hover { background: #1e40af; }
  </style>
</head>
<body>
  <div class="container">
    <h1>You're all set!</h1>
    ${agentName ? `<p class="detail"><strong>Name:</strong> ${agentName}</p>` : ''}
    ${gmailAddress ? `<p class="detail"><strong>Email:</strong> ${gmailAddress}</p>` : ''}
    ${sheetLink}
    <div class="note">
      <strong>Shadow Mode Active</strong><br>
      Your agent is running in Shadow Mode. Emails will be reviewed before sending.
    </div>
  </div>
</body>
</html>`);
});

module.exports = router;
