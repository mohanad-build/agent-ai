'use strict';

// CASA 3.1.4: object-level authorization on the /agent/:agentId routes.
// requireAuth answers "are you logged in"; requireAgentAccess answers "may
// you touch this specific agentId". These tests exercise the second
// question in isolation.

const http = require('http');
const express = require('express');

const mockLoadAgent = jest.fn((agentId) => {
  if (agentId === 'agent-a') {
    return { agentId: 'agent-a', mode: 'shadow', isActive: true, googleRefreshToken: '', googleSheetId: 'sheet-a' };
  }
  throw new Error(`no such agent: ${agentId}`);
});
jest.mock('../src/agentConfig', () => ({ loadAgent: (...args) => mockLoadAgent(...args) }));
jest.mock('../src/storagePaths', () => ({ getStorageRoot: () => require('os').tmpdir() }));

const dashboardRouter = require('../src/routes/dashboard');
const { requireAgentAccess, agentNotFoundPage } = dashboardRouter;

// Auto-discovered from the real router's route table (not hand-copied), so
// a route added to src/routes/dashboard.js later shows up here without
// anyone remembering to update a list by hand.
function discoverAgentRoutes(router) {
  const routes = [];
  for (const layer of router.stack) {
    if (layer.route && layer.route.path.startsWith('/agent/:agentId')) {
      for (const method of Object.keys(layer.route.methods)) {
        routes.push({ method, path: layer.route.path });
      }
    }
  }
  return routes;
}

const AGENT_ROUTES = discoverAgentRoutes(dashboardRouter);

// A minimal app: only requireAgentAccess in front of a dummy 200 handler
// per discovered route, so this exercises the boundary itself, not the
// business logic behind it (that logic has its own tests elsewhere).
function buildDummyApp(routes) {
  const app = express();
  app.use((req, res, next) => {
    req.session = JSON.parse(req.headers['x-test-session'] || 'null');
    next();
  });
  app.use('/agent/:agentId', requireAgentAccess);
  for (const { method, path } of routes) {
    app[method](path, (req, res) => res.status(200).send('reached'));
  }
  return app;
}

// The real router, for the one test that needs the real 404 render path
// (a genuinely missing agentId) to compare against.
function buildRealApp() {
  const app = express();
  app.use((req, res, next) => {
    req.session = JSON.parse(req.headers['x-test-session'] || 'null');
    next();
  });
  app.use('/dashboard', dashboardRouter);
  return app;
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

function fill(routePath, agentId, rowIndex) {
  return routePath.replace(':agentId', agentId).replace(':rowIndex', rowIndex || '2');
}

describe('route discovery', () => {
  it('found exactly the 11 /agent/:agentId routes recon documented', () => {
    // If this count changes, a route was added or removed under
    // /agent/:agentId - that is fine, but update this expectation
    // deliberately rather than treating a red here as noise.
    expect(AGENT_ROUTES.length).toBe(11);
  });
});

describe('operator principal (allowedAgents: "*")', () => {
  it('reaches every discovered /agent/:agentId route', async () => {
    const server = await startServer(buildDummyApp(AGENT_ROUTES));
    const session = JSON.stringify({ authenticated: true, principal: { type: 'operator', allowedAgents: '*' } });
    try {
      for (const route of AGENT_ROUTES) {
        const url = `http://127.0.0.1:${server.address().port}${fill(route.path, 'agent-a')}`;
        const res = await fetch(url, { method: route.method.toUpperCase(), headers: { 'x-test-session': session } });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('reached');
      }
    } finally {
      server.close();
    }
  });
});

describe('scoped principal enforcement (the core boundary)', () => {
  const EDIT_ROUTE = [{ method: 'get', path: '/agent/:agentId/edit' }];

  it('is DENIED with 404 on an agentId outside its allowedAgents', async () => {
    const server = await startServer(buildDummyApp(EDIT_ROUTE));
    const session = JSON.stringify({ authenticated: true, principal: { type: 'operator', allowedAgents: ['agent-a'] } });
    try {
      const url = `http://127.0.0.1:${server.address().port}${fill(EDIT_ROUTE[0].path, 'agent-b')}`;
      const res = await fetch(url, { headers: { 'x-test-session': session } });
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(agentNotFoundPage());
    } finally {
      server.close();
    }
  });

  it('is ALLOWED on the agentId it IS scoped to', async () => {
    const server = await startServer(buildDummyApp(EDIT_ROUTE));
    const session = JSON.stringify({ authenticated: true, principal: { type: 'operator', allowedAgents: ['agent-a'] } });
    try {
      const url = `http://127.0.0.1:${server.address().port}${fill(EDIT_ROUTE[0].path, 'agent-a')}`;
      const res = await fetch(url, { headers: { 'x-test-session': session } });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('reached');
    } finally {
      server.close();
    }
  });
});

describe('fail closed', () => {
  it('denies authenticated: true with no principal at all', async () => {
    const server = await startServer(buildDummyApp([{ method: 'get', path: '/agent/:agentId/edit' }]));
    // No principal at all - the shape of a session created before this
    // deploy shipped.
    const session = JSON.stringify({ authenticated: true });
    try {
      const url = `http://127.0.0.1:${server.address().port}/agent/agent-a/edit`;
      const res = await fetch(url, { headers: { 'x-test-session': session } });
      expect(res.status).toBe(404);
    } finally {
      server.close();
    }
  });
});

describe('enumeration resistance', () => {
  it('a denied request and a genuinely nonexistent agent produce a byte-identical 404 body', async () => {
    const server = await startServer(buildRealApp());
    try {
      const port = server.address().port;

      const deniedSession = JSON.stringify({
        authenticated: true,
        principal: { type: 'operator', allowedAgents: ['agent-a'] },
        authenticatedAt: Date.now(),
        lastSeenAt: Date.now(),
      });
      const deniedRes = await fetch(`http://127.0.0.1:${port}/dashboard/agent/agent-b/edit`, {
        headers: { 'x-test-session': deniedSession },
      });

      const wildcardSession = JSON.stringify({
        authenticated: true,
        principal: { type: 'operator', allowedAgents: '*' },
        authenticatedAt: Date.now(),
        lastSeenAt: Date.now(),
      });
      const missingRes = await fetch(`http://127.0.0.1:${port}/dashboard/agent/ghost-agent/edit`, {
        headers: { 'x-test-session': wildcardSession },
      });

      expect(deniedRes.status).toBe(404);
      expect(missingRes.status).toBe(404);
      expect(await deniedRes.text()).toBe(await missingRes.text());
    } finally {
      server.close();
    }
  });
});
