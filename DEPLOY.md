# Deploying GetKlosed to Railway

## First deploy

1. Push repo to GitHub (already done)
2. Create a new Railway project, connect the GitHub repo
3. Railway auto-detects Node.js and runs `npm install` + `node src/server.js`
4. Set all env vars in Railway dashboard (see `.env.example`)

## Required env vars

| Var | Value |
|-----|-------|
| ANTHROPIC_API_KEY | From console.anthropic.com |
| GOOGLE_CLIENT_ID | From Google Cloud Console |
| GOOGLE_CLIENT_SECRET | From Google Cloud Console |
| OAUTH_REDIRECT_URI | https://YOUR-RAILWAY-DOMAIN/onboard/oauth/callback |
| TWILIO_ACCOUNT_SID | From Twilio console |
| TWILIO_AUTH_TOKEN | From Twilio console |
| TWILIO_FROM_NUMBER | Your Twilio number e.g. +16476925913 |
| DASHBOARD_PASSWORD | Choose a strong password |
| SESSION_SECRET | Random string, e.g. output of: openssl rand -hex 32 |

## After first deploy

1. Note your Railway public domain (e.g. `getklosed-production.up.railway.app`)
2. In Google Cloud Console, add two authorized redirect URIs:
   - `https://YOUR-RAILWAY-DOMAIN/onboard/oauth/callback`
   - `http://localhost:3000/oauth/callback` (keep existing, for local CLI use)
3. Update `OAUTH_REDIRECT_URI` env var in Railway with your actual domain
4. Update Twilio webhook URL to: `https://YOUR-RAILWAY-DOMAIN/sms-incoming`
5. Reply to the Google OAuth verification email with the onboard URL:
   `https://YOUR-RAILWAY-DOMAIN/onboard`

## Agent files on Railway

Agent JSON files (`agents/*.json`) are gitignored and do not deploy with the repo.
On Railway, agents are created via the `/onboard` flow which writes them to the
Railway volume. You must attach a Railway Volume to persist agent files across
deploys.

Add a Railway Volume:
- Mount path: `/app/agents`
- This persists all agent configs and refresh tokens across redeploys

## Twilio webhook

After deploy, update the Twilio phone number webhook URL in the Twilio console:
- URL: `https://YOUR-RAILWAY-DOMAIN/sms-incoming`
- Method: HTTP POST

## Local development

Copy `.env.example` to `.env` and fill in values. Run:
```
node src/server.js       # starts server + orchestrator loop
node src/index.js        # runs one orchestrator cycle only
node src/webhook.js      # starts webhook server only (legacy)
```
