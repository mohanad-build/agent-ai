'use strict';

// frame-ancestors only, deliberately no script/style directives, because a
// full CSP would break the dashboard's inline markup.
function applySecurityHeaders(app) {
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    next();
  });
}

module.exports = { applySecurityHeaders };
