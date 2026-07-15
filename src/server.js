require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { createApp: createWebhookApp } = require('./webhook');
const { runCycle } = require('./index');
const onboardRouter = require('./routes/onboard');
const dashboardRouter = require('./routes/dashboard');

const app = express();

// Body parsing
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(express.json());

// Sessions (for dashboard auth only)
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }, // set true behind HTTPS proxy on Railway
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
