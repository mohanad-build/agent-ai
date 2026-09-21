'use strict';

// Post-LOV hardening: cheap security headers (no CSP script/style rules) on
// every response, from every Express app instance this server creates -
// the parent app in src/server.js and the webhook sub-app in
// src/webhook.js's createApp(), which server.js mounts at '/' the way (a)
// below reproduces.

const http = require('http');
const express = require('express');

const { applySecurityHeaders } = require('../src/securityHeaders');
const { createApp } = require('../src/webhook');

function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function expectSecurityHeaders(res) {
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('x-frame-options')).toBe('DENY');
  expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
  expect(res.headers.get('x-powered-by')).toBeNull();
}

// Express's own default 404/error page generator (finalhandler) always
// overwrites Content-Security-Policy to "default-src 'none'" on its own
// generated error body (node_modules/finalhandler/index.js), regardless of
// what applySecurityHeaders already set - that's real Express behavior,
// not a gap in applySecurityHeaders. It leaves X-Frame-Options and
// x-powered-by alone, and happens to re-set X-Content-Type-Options to the
// same 'nosniff' value we already set.
function expectSecurityHeadersOnDefault404(res) {
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('x-frame-options')).toBe('DENY');
  expect(res.headers.get('x-powered-by')).toBeNull();
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('applySecurityHeaders', () => {
  it('sets the three headers and strips x-powered-by on a parent route, a mounted sub-app route, and a 404', async () => {
    // Sub-app first, mirroring src/webhook.js's createApp(): its own
    // Express instance, hardened independently, then mounted onto the
    // parent at '/' the way src/server.js mounts the real webhook app.
    const subApp = express();
    applySecurityHeaders(subApp);
    subApp.get('/sub-route', (req, res) => res.send('sub ok'));

    const parentApp = express();
    applySecurityHeaders(parentApp);
    parentApp.get('/parent-route', (req, res) => res.send('parent ok'));
    parentApp.use('/', subApp);

    const server = await startServer(parentApp);
    try {
      const port = server.address().port;

      const parentRes = await fetch(`http://127.0.0.1:${port}/parent-route`);
      expect(parentRes.status).toBe(200);
      expectSecurityHeaders(parentRes);

      const subRes = await fetch(`http://127.0.0.1:${port}/sub-route`);
      expect(subRes.status).toBe(200);
      expectSecurityHeaders(subRes);

      const notFoundRes = await fetch(`http://127.0.0.1:${port}/does-not-exist`);
      expect(notFoundRes.status).toBe(404);
      expectSecurityHeadersOnDefault404(notFoundRes);
    } finally {
      await stopServer(server);
    }
  });

  it('the real webhook createApp() strips x-powered-by and sets nosniff on any path', async () => {
    // createApp() has no boot-time env-var requirements or other side
    // effects beyond require('dotenv').config() at module load (a no-op
    // if .env is absent/already loaded) - confirmed by grepping
    // src/webhook.js for process.env reads, all of which are inside
    // route handlers, not at createApp()/module scope. Existing tests
    // (e.g. tests/webhook.smsIncoming.signature.test.js) already call it
    // the same way with no special setup.
    const app = createApp();
    const server = await startServer(app);
    try {
      const port = server.address().port;

      const res = await fetch(`http://127.0.0.1:${port}/any-path-not-defined`);
      expect(res.headers.get('x-powered-by')).toBeNull();
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    } finally {
      await stopServer(server);
    }
  });
});
