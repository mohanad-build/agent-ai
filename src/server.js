require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { createApp: createWebhookApp } = require('./webhook');
const { runCycle } = require('./index');
const onboardRouter = require('./routes/onboard');
const dashboardRouter = require('./routes/dashboard');

const app = express();

// Trust exactly one proxy hop (Railway's edge) so req.protocol/req.ip honour
// X-Forwarded-Proto/X-Forwarded-For from that hop, instead of falling back to
// the plain-http socket scheme or trusting an arbitrary forwarded chain.
app.set('trust proxy', 1);

// Body parsing
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(express.json());

// Sessions (for dashboard auth only)
if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set. Refusing to start with an insecure default.');
}

// Not a throw: existing agents already have plaintext tokens on the Volume,
// and gmail.js's decryptToken() passes those through untouched. Only a
// startup nudge for whoever forgot to set it before real encryption/
// decryption is needed. Lives here (not in tokenCrypto.js) so it never runs
// during Jest test collection, same scoping as the SESSION_SECRET throw above.
if (!process.env.TOKEN_ENCRYPTION_KEY) {
  console.warn('TOKEN_ENCRYPTION_KEY is not set. Token encryption/decryption will fail if invoked.');
} else {
  // Migrate any plaintext refresh tokens left on the Volume, so the
  // standalone script never has to be run by hand against real data.
  // Idempotent (already-migrated agents are skipped), so this is safe to
  // run on every boot. A failure here must never take the whole server
  // down - it degrades to "some agents still have plaintext tokens," which
  // decryptToken already handles via passthrough.
  try {
    const { migrateExistingTokens } = require('./tokenMigration');
    console.log('[server] running token migration check...');
    migrateExistingTokens();
  } catch (err) {
    console.error('[server] token migration failed:', err.message);
    if (err.stack) console.error(err.stack);
  }
}
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: 'auto', // requires trust proxy above; true when HTTPS is detected via req.secure, false for local http dev
    httpOnly: true,
    // 'lax', not 'strict': the OAuth callback (onboard.js) depends on the
    // session cookie being sent when Google redirects the browser back to
    // /onboard/oauth/callback via a top-level GET navigation from
    // accounts.google.com. That's a cross-site top-level navigation, which
    // 'strict' drops the cookie on entirely - it would silently break the
    // OAuth state-nonce check (commit 86431e8) since req.session.oauthState
    // would never be readable on the return trip. 'lax' still sends the
    // cookie on that navigation while blocking it on cross-site POST, which
    // is what actually matters for the dashboard's CSRF-protected forms.
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 12, // 12 hours
  },
}));

// Static files
app.use(express.static(path.join(__dirname, '..', 'views', 'public')));

// Mount SMS webhook routes (from existing webhook.js logic)
const webhookApp = createWebhookApp();
// Extract the router from the webhook app by mounting it
app.use('/', webhookApp);

// Mount onboarding and dashboard routes
app.use('/onboard', onboardRouter);
app.use('/dashboard', dashboardRouter);

// Health check
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Global error handler. Must be registered after all other app.use()/route
// mounts (Express picks it out by its 4-argument arity). Never send
// err.message or err.stack to the client; log the full error server-side
// and respond with a generic message instead.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[server] unhandled error:', err.message);
  if (err.stack) console.error(err.stack);
  const status = err.status || err.statusCode || 500;
  res.status(status).send('Something went wrong. Please try again.');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
});

// Orchestrator loop: run one cycle every 5 minutes
const CYCLE_INTERVAL_MS = 5 * 60 * 1000;
console.log('[server] orchestrator loop starting (interval: 5 min)');
setInterval(() => {
  runCycle().catch((err) => {
    console.error('[server] orchestrator cycle error:', err.message);
  });
}, CYCLE_INTERVAL_MS);

module.exports = { app };
