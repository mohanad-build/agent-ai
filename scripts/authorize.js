// scripts/authorize.js
// One-time OAuth authorization script to generate a refresh token for an agent.
// Usage: node scripts/authorize.js <agent-id>
// Example: node scripts/authorize.js mo-test
//
// What it does:
//   1. Reads client_secret_*.json from project root for the OAuth app creds
//   2. Opens browser to Google consent screen
//   3. Catches the redirect on localhost:3000
//   4. Exchanges the code for a refresh token
//   5. Writes the refresh token into agents/<agent-id>.json

const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const { google } = require('googleapis');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const AGENTS_DIR = path.join(PROJECT_ROOT, 'agents');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/spreadsheets',
];
const REDIRECT_URI = 'http://localhost:3000/oauth/callback';
const PORT = 3000;

// --- Parse args ---
const agentId = process.argv[2];
if (!agentId) {
  console.error('❌ Missing agent ID.');
  console.error('   Usage: node scripts/authorize.js <agent-id>');
  console.error('   Example: node scripts/authorize.js mo-test');
  process.exit(1);
}

const agentConfigPath = path.join(AGENTS_DIR, `${agentId}.json`);
if (!fs.existsSync(agentConfigPath)) {
  console.error(`❌ Agent config not found: ${agentConfigPath}`);
  console.error(`   Create agents/${agentId}.json first.`);
  process.exit(1);
}

// --- Find client_secret file ---
const files = fs.readdirSync(PROJECT_ROOT);
const secretFile = files.find(
  (f) => f.startsWith('client_secret_') && f.endsWith('.json')
);
if (!secretFile) {
  console.error('❌ No client_secret_*.json file found in project root.');
  process.exit(1);
}
const credentials = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, secretFile), 'utf-8')
);
const { client_id, client_secret } = credentials.web;

console.log(`\n✅ Loaded OAuth credentials from ${secretFile}`);
console.log(`   Agent being authorized: ${agentId}\n`);

// --- Build OAuth client ---
const oauth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  REDIRECT_URI
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline', // required to get a refresh token
  prompt: 'consent',       // forces consent screen + refresh token every time
  scope: SCOPES,
});

// --- Start temp server to catch redirect ---
const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = url.parse(req.url, true);
    if (parsedUrl.pathname !== '/oauth/callback') {
      res.writeHead(404);
      res.end();
      return;
    }

    const code = parsedUrl.query.code;
    if (!code) {
      res.end('❌ No authorization code in redirect. Check terminal.');
      console.error('❌ No code received.');
      server.close();
      return;
    }

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      res.end('❌ No refresh token received. Check terminal.');
      console.error('❌ Google did not return a refresh token.');
      console.error('   Try revoking access at https://myaccount.google.com/permissions');
      console.error('   then run this script again.');
      server.close();
      return;
    }

    // Write refresh token into agent config
    const agentConfig = JSON.parse(fs.readFileSync(agentConfigPath, 'utf-8'));
    agentConfig.googleRefreshToken = tokens.refresh_token;
    fs.writeFileSync(
      agentConfigPath,
      JSON.stringify(agentConfig, null, 2) + '\n'
    );

    res.end(`
      <html>
        <body style="font-family: sans-serif; padding: 40px;">
          <h1>✅ Authorization complete</h1>
          <p>Refresh token saved to <code>agents/${agentId}.json</code>.</p>
          <p>You can close this tab and return to your terminal.</p>
        </body>
      </html>
    `);

    console.log('\n========================================');
    console.log('✅ SUCCESS');
    console.log('========================================');
    console.log(`Refresh token written to: agents/${agentId}.json`);
    console.log('You can now close this script with Ctrl+C.\n');

    server.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    res.end('Error. Check terminal.');
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log('🔐 Open this URL in your browser (the one logged into your test Gmail):\n');
  console.log(`   ${authUrl}\n`);
  console.log('Waiting for you to complete authorization...');
  console.log('(If browser shows "Google hasn\'t verified this app" → click Advanced → Go to agent-ai (unsafe) — this is expected for Testing-mode apps.)\n');
});
