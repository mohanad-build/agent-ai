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
  throw new Error('SESSION_SECRET must be set — refusing to start with an insecure default.');
}
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: 'auto', // requires trust proxy above; true when HTTPS is detected via req.secure, false for local http dev
    httpOnly: true,
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
