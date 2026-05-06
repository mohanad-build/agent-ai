// src/webhook.js
//
// Express webhook server for inbound Twilio SMS.
// Handles signature verification, idempotency, agent lookup, and token parsing.
// Draft/send/Sheet-update logic is deferred to a later commit.

const express = require('express');
const twilio = require('twilio');
const { findAgentByPhone } = require('./agentConfig');

const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

// In-memory idempotency store: Map<MessageSid, timestamp>
const processedSids = new Map();

// Purge entries older than TTL every 60 seconds.
setInterval(() => {
  const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;
  for (const [sid, ts] of processedSids) {
    if (ts < cutoff) processedSids.delete(sid);
  }
}, 60 * 1000).unref();

// Returns true if the host is safe to allow signature bypass.
function isLocalOrDev(host) {
  if (!host) return false;
  const h = host.toLowerCase();
  return h === 'localhost' ||
    h.startsWith('localhost:') ||
    h === '127.0.0.1' ||
    h.startsWith('127.0.0.1:') ||
    h.includes('ngrok');
}

// Parses the SMS body for [Qn] tokens. Liberal match: Q followed by optional
// whitespace/dash then digits, case-insensitive.
// Returns { type: 'none'|'single'|'multi', token: string|null }
function parseToken(body) {
  if (!body || typeof body !== 'string') return { type: 'none', token: null };
  const matches = [...body.matchAll(/Q\s*-?\s*(\d+)/gi)];
  if (matches.length === 0) return { type: 'none', token: null };
  if (matches.length === 1) return { type: 'single', token: 'Q' + matches[0][1] };
  return { type: 'multi', token: null };
}

function createApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  app.post('/sms-incoming', (req, res) => {
    const host = req.get('host') || '';
    const signature = req.get('X-Twilio-Signature') || '';
    const url = req.protocol + '://' + req.get('host') + req.originalUrl;
    const params = req.body;

    // Signature verification (bypassable for localhost/ngrok in dev only).
    const skipVerification =
      process.env.WEBHOOK_SKIP_SIGNATURE_CHECK === 'true' && isLocalOrDev(host);

    if (!skipVerification) {
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const valid = twilio.validateRequest(authToken, signature, url, params);
      if (!valid) {
        res.status(403).send('Forbidden');
        return;
      }
    }

    // Idempotency check.
    const messageSid = params.MessageSid;
    if (messageSid) {
      const seen = processedSids.get(messageSid);
      if (seen && Date.now() - seen < IDEMPOTENCY_TTL_MS) {
        res.type('text/xml').status(200).send(EMPTY_TWIML);
        return;
      }
    }

    // Agent lookup.
    const from = params.From;
    const agent = findAgentByPhone(from);
    if (!agent) {
      console.warn(`webhook: unknown agent phone ${from}, ignoring`);
      res.type('text/xml').status(200).send(EMPTY_TWIML);
      return;
    }

    // Mark as processed before dispatching so a crash mid-handler does not
    // allow the same message to be re-processed on retry.
    if (messageSid) {
      processedSids.set(messageSid, Date.now());
    }

    // Token parsing.
    const body = params.Body || '';
    const { type, token } = parseToken(body);

    if (type === 'multi') {
      console.log(`webhook: multi-token detected for agent ${agent.agentId}`);
      res.type('text/xml').status(200).send(EMPTY_TWIML);
      return;
    }

    const tokenDisplay = type === 'single' ? token : 'null';
    const bodyPreview = body.slice(0, 60);
    console.log(
      `webhook: agent=${agent.agentId} messageSid=${messageSid} token=${tokenDisplay} bodyPreview=${bodyPreview}`
    );

    // Handler logic (draft, email, Sheet update) deferred to next commit.

    res.type('text/xml').status(200).send(EMPTY_TWIML);
  });

  return app;
}

if (require.main === module) {
  const port = process.env.WEBHOOK_PORT || 3000;

  if (process.env.WEBHOOK_SKIP_SIGNATURE_CHECK === 'true') {
    console.log(
      'WARNING: signature verification bypass enabled. DEV MODE ONLY. Do not run this way in production.'
    );
  }

  const app = createApp();
  app.listen(port, () => {
    console.log(`webhook: listening on port ${port}`);
  });
}

module.exports = { createApp };
