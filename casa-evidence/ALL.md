===== 1.1.1 =====

# 1.1.1 — Authentication is resistant to brute force attacks

## Determination
IMPLEMENTED

## Statement
The dashboard's `POST /login` route is gated by an `express-rate-limit` instance capped at 5 attempts per 15 minutes per IP, before the password comparison ever runs. Beyond the rate limiter, successful authentication additionally requires a second, independently rate-limited factor (see 1.3.4), so a brute-forced password alone is not sufficient to gain access.

## Evidence
`src/routes/dashboard.js:328-340`
```js
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});
```

`src/routes/dashboard.js:345-353`
```js
router.post('/login', loginLimiter, async (req, res) => {
  const submittedPassword = req.body.password;
  // Fail closed: an unset DASHBOARD_PASSWORD, or an empty submission,
  // must never be treated as a match. (The old `!==` comparison had a real
  // gap here - if DASHBOARD_PASSWORD were ever unset or empty, an empty
  // submitted password would satisfy `'' !== ''` being false and pass.)
  if (!submittedPassword || !process.env.DASHBOARD_PASSWORD || !safeCompare(submittedPassword, process.env.DASHBOARD_PASSWORD)) {
    return res.redirect('/dashboard/login?error=1');
  }
```

## Commit reference
24d80c6 (feat(security): harden dashboard session and login, CASA 2.2/2.3)


===== 1.1.2 =====

# 1.1.2 — System generated initial passwords or activation codes shall be securely randomly generated and expire after a short period

## Determination
IMPLEMENTED

## Statement
The MFA verification code sent at login is generated with Node's `crypto.randomInt` (CSPRNG-backed) over `[0, 1000000)`, zero-padded to 6 digits, and carries a 5-minute (`MFA_CODE_TTL_MS`) expiry enforced on every verification attempt.

## Evidence
`src/routes/dashboard.js:355-380`
```js
  // Break-glass: MFA_ENABLED must be explicitly 'false' to skip it. Unset or
  // any other value means MFA is required.
  if (process.env.MFA_ENABLED === 'false') {
    req.session.authenticated = true;
    return res.redirect('/dashboard');
  }

  const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');

  try {
    await twilioModule.sendSMSTo(
      process.env.DASHBOARD_MFA_PHONE,
      `Your GetKlosed dashboard verification code is ${code}. It expires in 5 minutes.`
    );
  } catch (err) {
    console.error('[dashboard] MFA SMS send failed:', err.message);
    return res.redirect('/dashboard/login?error=mfa_send_failed');
  }

  req.session.pendingMfa = {
    code,
    expiresAt: Date.now() + MFA_CODE_TTL_MS,
    attempts: 0,
  };
  res.redirect('/dashboard/verify');
});
```

`src/routes/dashboard.js:342-343`
```js
const MFA_CODE_TTL_MS = 5 * 60 * 1000;
const MFA_MAX_ATTEMPTS = 5;
```

## Commit reference
cc43725 (feat(security): SMS-based MFA on dashboard login, CASA 1.1.2/1.3.x/2.4.1)


===== 1.1.3 =====

# 1.1.3 — Passwords shall be stored in a form that is resistant to offline attacks

## Determination
NOT APPLICABLE

## Statement
There is no stored password corpus in this application - a single operator credential (`DASHBOARD_PASSWORD`) is read directly from an environment variable at request time and compared via a constant-time hash comparison (see 1.1.1/2.3.4-adjacent `safeCompare`). Nothing resembling a user table, password column, or password hash is ever written to disk or a database; there is no password hashing library (bcrypt/argon2/scrypt) in the dependency tree because there is nothing for one to hash. The classic "passwords stored offline-attack-resistant" control targets a credential database that could be exfiltrated and cracked offline - that scenario does not exist here.

## Evidence
Command: `grep -n "bcrypt\|argon2\|scrypt\|pbkdf2" package.json`
Output: (empty)

`src/routes/dashboard.js:345-353`
```js
router.post('/login', loginLimiter, async (req, res) => {
  const submittedPassword = req.body.password;
  // Fail closed: an unset DASHBOARD_PASSWORD, or an empty submission,
  // must never be treated as a match. (The old `!==` comparison had a real
  // gap here - if DASHBOARD_PASSWORD were ever unset or empty, an empty
  // submitted password would satisfy `'' !== ''` being false and pass.)
  if (!submittedPassword || !process.env.DASHBOARD_PASSWORD || !safeCompare(submittedPassword, process.env.DASHBOARD_PASSWORD)) {
    return res.redirect('/dashboard/login?error=1');
  }
```

## Commit reference
N/A - architectural fact, not a remediated control


===== 1.2.1 =====

# 1.2.1 — Default credentials shall not be present on publicly exposed interfaces

## Determination
IMPLEMENTED

## Statement
`DASHBOARD_PASSWORD` is read exclusively from `process.env` at request time, with no fallback literal anywhere in the codebase; an unset or empty value now fails the login closed rather than matching an empty submission (a real gap that existed before commit 43ab16e and was fixed as part of this control). `.env.example` ships with the value blank, not a placeholder credential.

## Evidence
`src/routes/dashboard.js:345-353`
```js
router.post('/login', loginLimiter, async (req, res) => {
  const submittedPassword = req.body.password;
  // Fail closed: an unset DASHBOARD_PASSWORD, or an empty submission,
  // must never be treated as a match. (The old `!==` comparison had a real
  // gap here - if DASHBOARD_PASSWORD were ever unset or empty, an empty
  // submitted password would satisfy `'' !== ''` being false and pass.)
  if (!submittedPassword || !process.env.DASHBOARD_PASSWORD || !safeCompare(submittedPassword, process.env.DASHBOARD_PASSWORD)) {
    return res.redirect('/dashboard/login?error=1');
  }
```

`.env.example:20-22`
```js
# Dashboard auth
DASHBOARD_PASSWORD=
SESSION_SECRET=
```

Command: `grep -rn "DASHBOARD_PASSWORD" --include="*.js" --include="*.example" . --exclude-dir=node_modules --exclude-dir=.git`
Output: only `.env.example:21:DASHBOARD_PASSWORD=` (empty) and the lines of `src/routes/dashboard.js` quoted above. No literal password string anywhere.

## Commit reference
43ab16e (fail-closed guard added); DASHBOARD_PASSWORD was already env-only since b165e9b


===== 1.3.1 =====

# 1.3.1 — Out of band verifier shall expire in a reasonable timeframe

## Determination
IMPLEMENTED

## Statement
The SMS-delivered MFA code carries a 5-minute (`MFA_CODE_TTL_MS = 5 * 60 * 1000`) expiry stored alongside it in `req.session.pendingMfa.expiresAt`. `POST /dashboard/verify` checks `Date.now() > pending.expiresAt` before accepting any submission and clears the pending state on expiry, forcing a fresh login.

## Evidence
`src/routes/dashboard.js:342-343`
```js
const MFA_CODE_TTL_MS = 5 * 60 * 1000;
const MFA_MAX_ATTEMPTS = 5;
```

`src/routes/dashboard.js:415-440`
```js
router.post('/verify', verifyLimiter, (req, res) => {
  const pending = req.session.pendingMfa;
  if (!pending) {
    return res.redirect('/dashboard/login');
  }

  if (Date.now() > pending.expiresAt) {
    delete req.session.pendingMfa;
    return res.redirect('/dashboard/login?error=mfa_expired');
  }

  const submitted = (req.body.code || '').trim();
  if (submitted === pending.code) {
    req.session.authenticated = true;
    delete req.session.pendingMfa;
    return res.redirect('/dashboard');
  }

  pending.attempts += 1;
  if (pending.attempts >= MFA_MAX_ATTEMPTS) {
    delete req.session.pendingMfa;
    return res.redirect('/dashboard/login?error=mfa_failed');
  }

  res.redirect('/dashboard/verify?error=1');
});
```

## Commit reference
cc43725 (feat(security): SMS-based MFA on dashboard login, CASA 1.1.2/1.3.x/2.4.1)


===== 1.3.2 =====

# 1.3.2 — Out of band verifier shall only be used once

## Determination
IMPLEMENTED

## Statement
On a correct code submission, `req.session.pendingMfa` is deleted in the same branch that sets `authenticated = true`, before the redirect. A second POST with the same code, replayed against the same session, finds no `pendingMfa` object and is bounced back to the login page rather than accepted.

## Evidence
`src/routes/dashboard.js:415-440`
```js
router.post('/verify', verifyLimiter, (req, res) => {
  const pending = req.session.pendingMfa;
  if (!pending) {
    return res.redirect('/dashboard/login');
  }

  if (Date.now() > pending.expiresAt) {
    delete req.session.pendingMfa;
    return res.redirect('/dashboard/login?error=mfa_expired');
  }

  const submitted = (req.body.code || '').trim();
  if (submitted === pending.code) {
    req.session.authenticated = true;
    delete req.session.pendingMfa;
    return res.redirect('/dashboard');
  }

  pending.attempts += 1;
  if (pending.attempts >= MFA_MAX_ATTEMPTS) {
    delete req.session.pendingMfa;
    return res.redirect('/dashboard/login?error=mfa_failed');
  }

  res.redirect('/dashboard/verify?error=1');
});
```

## Commit reference
cc43725 (feat(security): SMS-based MFA on dashboard login, CASA 1.1.2/1.3.x/2.4.1)


===== 1.3.3 =====

# 1.3.3 — Out of band verifier shall be securely random

## Determination
IMPLEMENTED

## Statement
The 6-digit MFA code is generated with Node's `crypto.randomInt`, a CSPRNG-backed API, over the range `[0, 1000000)` and zero-padded to 6 digits. No `Math.random()` or other non-cryptographic source is used anywhere in the MFA code path.

## Evidence
`src/routes/dashboard.js:355-380`
```js
  // Break-glass: MFA_ENABLED must be explicitly 'false' to skip it. Unset or
  // any other value means MFA is required.
  if (process.env.MFA_ENABLED === 'false') {
    req.session.authenticated = true;
    return res.redirect('/dashboard');
  }

  const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');

  try {
    await twilioModule.sendSMSTo(
      process.env.DASHBOARD_MFA_PHONE,
      `Your GetKlosed dashboard verification code is ${code}. It expires in 5 minutes.`
    );
  } catch (err) {
    console.error('[dashboard] MFA SMS send failed:', err.message);
    return res.redirect('/dashboard/login?error=mfa_send_failed');
  }

  req.session.pendingMfa = {
    code,
    expiresAt: Date.now() + MFA_CODE_TTL_MS,
    attempts: 0,
  };
  res.redirect('/dashboard/verify');
});
```

## Commit reference
cc43725 (feat(security): SMS-based MFA on dashboard login, CASA 1.1.2/1.3.x/2.4.1)


===== 1.3.4 =====

# 1.3.4 — Out of band verifier shall be resistant to brute force attacks

## Determination
IMPLEMENTED

## Statement
`POST /dashboard/verify` is gated by its own `express-rate-limit` instance (5 requests per 15 minutes per IP, a separate counting bucket from the login limiter). Independently, each individual code carries its own `attempts` counter capped at `MFA_MAX_ATTEMPTS = 5`; exceeding it clears the pending code and forces a brand-new password + code cycle rather than allowing continued guessing against the same code.

## Evidence
`src/routes/dashboard.js:328-340`
```js
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});
```

`src/routes/dashboard.js:342-343`
```js
const MFA_CODE_TTL_MS = 5 * 60 * 1000;
const MFA_MAX_ATTEMPTS = 5;
```

`src/routes/dashboard.js:415-440`
```js
router.post('/verify', verifyLimiter, (req, res) => {
  const pending = req.session.pendingMfa;
  if (!pending) {
    return res.redirect('/dashboard/login');
  }

  if (Date.now() > pending.expiresAt) {
    delete req.session.pendingMfa;
    return res.redirect('/dashboard/login?error=mfa_expired');
  }

  const submitted = (req.body.code || '').trim();
  if (submitted === pending.code) {
    req.session.authenticated = true;
    delete req.session.pendingMfa;
    return res.redirect('/dashboard');
  }

  pending.attempts += 1;
  if (pending.attempts >= MFA_MAX_ATTEMPTS) {
    delete req.session.pendingMfa;
    return res.redirect('/dashboard/login?error=mfa_failed');
  }

  res.redirect('/dashboard/verify?error=1');
});
```

## Commit reference
cc43725 (feat(security): SMS-based MFA on dashboard login, CASA 1.1.2/1.3.x/2.4.1); rate-limit dependency introduced in 24d80c6


===== 2.1.1 =====

# 2.1.1 — The application shall not reveal passwords or session tokens in URL parameters

## Determination
IMPLEMENTED

## Statement
Every `req.query.*` reference in the dashboard and onboarding routers is a non-secret UI flag (e.g. `error`, `saved`, `deleted`, `ce_error`) used to render a banner message, never a session ID, password, or token. The session itself is carried exclusively via the `connect.sid` cookie (see 2.3.1/2.3.2).

## Evidence
Command: `grep -n "req\.query\." src/routes/dashboard.js src/routes/onboard.js`
Output (representative, all non-secret UI flags):
```
src/routes/dashboard.js:299:  const errorMessage = LOGIN_ERROR_MESSAGES[req.query.error] || null;
src/routes/dashboard.js:386:  const error = req.query.error === '1';
src/routes/dashboard.js:473:    const deletedId = req.query.deleted ? String(req.query.deleted) : null;
src/routes/dashboard.js:626:    const saved = req.query.saved === '1';
src/routes/dashboard.js:1160:    const enableError = req.query.enable_error === 'empty';
```
No hit resembling `token`, `password`, `session`, or `secret` in any query-string read.

## Commit reference
N/A - this control has held since the original dashboard implementation (b165e9b) and was not modified by the CASA hardening batch


===== 2.2.1 =====

# 2.2.1 — Users shall have the ability to logout; logout and session expiration shall invalidate all stateful session tokens, including refresh tokens

## Determination
IMPLEMENTED

## Statement
`GET /dashboard/logout` calls `req.session.destroy()` (removing the server-side session record from the store) and, inside that callback, `res.clearCookie('connect.sid')` to also unset the browser's copy - the dashboard's stateful session token is fully invalidated on both ends. Session expiration is enforced independently via the cookie's `maxAge` (see 2.2.3-adjacent evidence). Note on scope: "refresh tokens" in this codebase refers to Google OAuth refresh tokens stored per-agent for background Gmail/Sheets automation - these are deliberately *not* tied to the admin dashboard session's lifecycle, since they belong to the agent's persistent automation, not to the interactive admin login. Logging an operator out of the dashboard does not, and by design should not, break an agent's ongoing background processing.

## Evidence
`src/routes/dashboard.js:442-447`
```js
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/dashboard/login');
  });
});
```

## Commit reference
24d80c6 (feat(security): harden dashboard session and login, CASA 2.2/2.3)


===== 2.2.2 =====

# 2.2.2 — The application shall provide the option (or act by default) to terminate all other active sessions after a successful password change

## Determination
NOT APPLICABLE

## Statement
There is no in-app password change flow. `DASHBOARD_PASSWORD` is a single operator credential set as an environment variable in the hosting platform (Railway); rotating it is an infrastructure operation outside the application, not a self-service in-app action. There is no route or form anywhere in the codebase for changing the dashboard password.

## Evidence
Command: `grep -rn "change-password\|changePassword\|password/change" src/routes/*.js`
Output: (empty)

## Commit reference
N/A - architectural fact, not a remediated control


===== 2.2.3 =====

# 2.2.3 — Non-revocable stateless authentication tokens must expire within 24 hours of being issued

## Determination
NOT APPLICABLE

## Statement
This application's session tokens are stateful and revocable, not non-revocable stateless tokens (e.g. self-contained JWTs) - `express-session` stores session state server-side, keyed by a signed session ID in the cookie, and any session can be immediately revoked via `req.session.destroy()` (see 2.2.1) independent of any expiry. The "non-revocable stateless" precondition this control targets does not describe this mechanism. As supplementary context: the session cookie does carry an explicit `maxAge` of 12 hours regardless, well under the 24-hour bound this control is concerned with.

## Evidence
`src/server.js:50-69`
```js
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
```

## Commit reference
N/A - architectural fact; the 12h maxAge itself was added in 24d80c6 for unrelated reasons (2.2.x session hardening)


===== 2.3.1 =====

# 2.3.1 — Cookie-based session tokens shall have the 'Secure' attribute set

## Determination
IMPLEMENTED

## Statement
The cookie config sets `secure: 'auto'`, which - in combination with `app.set('trust proxy', 1)` - resolves to `true` whenever the request is detected as HTTPS via `req.secure` (true in production behind Railway's proxy), and `false` only for local plain-HTTP development. Before this control, `secure` was hardcoded to `false` unconditionally, meaning the cookie could be sent over an unencrypted connection even in production.

## Evidence
`src/server.js:50-69`
```js
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
```

## Commit reference
24d80c6 (feat(security): harden dashboard session and login, CASA 2.2/2.3)


===== 2.3.2 =====

# 2.3.2 — Cookie-based session tokens shall have the 'HttpOnly' attribute set

## Determination
IMPLEMENTED

## Statement
The cookie config sets `httpOnly: true` explicitly. This was previously implicit (express-session's default), not stated in code; it is now an explicit, reviewable setting rather than a library-default assumption.

## Evidence
`src/server.js:50-69`
```js
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
```

## Commit reference
24d80c6 (feat(security): harden dashboard session and login, CASA 2.2/2.3)


===== 2.3.3 =====

# 2.3.3 — The application shall use session tokens rather than static API secrets and keys, except with legacy implementations

## Determination
IMPLEMENTED

## Statement
The dashboard's own user-facing authentication surface uses session-cookie tokens exclusively - there is no static bearer token or API key that grants dashboard access. The one static-shared-secret pattern in the codebase is the Twilio inbound SMS webhook, which validates the `X-Twilio-Signature` header against `TWILIO_AUTH_TOKEN` via HMAC signing rather than accepting a bare API key - this is the industry-standard legacy webhook-authentication pattern the control's "except with legacy implementations" clause carves out (a third party, Twilio, calling into this app, not a session-capable first-party client).

## Evidence
`src/routes/dashboard.js:100-103`
```js
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated === true) return next();
  res.redirect('/dashboard/login');
}
```

`src/webhook.js:543-554`
```js
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
```

## Commit reference
b165e9b (session-cookie dashboard auth); 4d77fb3 (Twilio signature validation, the legacy-carve-out case)


===== 2.3.4 =====

# 2.3.4 — Stateless session tokens shall use digital signatures, encryption, and other countermeasures to protect against tampering, enveloping, replay, null cipher, and key substitution attacks

## Determination
IMPLEMENTED

## Statement
The session cookie's client-visible value is HMAC-signed by `express-session` using `SESSION_SECRET` (the `connect.sid` cookie carries an `s:<sid>.<hmac>` format via the underlying `cookie-signature` library) - a tampered or forged session ID fails signature verification and is rejected before the session store is even consulted. `SESSION_SECRET` itself has no hardcoded fallback and the application refuses to start without it (closing what was previously a real gap: a hardcoded `'dev-secret-change-in-prod'` fallback, which would have made forged signatures trivial to produce if ever deployed unset).

## Evidence
`src/server.js:22-25`
```js
// Sessions (for dashboard auth only)
if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set. Refusing to start with an insecure default.');
}
```

`src/server.js:50-69`
```js
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
```

## Commit reference
24d80c6 (feat(security): harden dashboard session and login, CASA 2.2/2.3)


===== 2.4.1 =====

# 2.4.1 — Verify the application ensures a full, valid login session or requires re-authentication or secondary verification before allowing any sensitive transactions or account modifications

## Determination
IMPLEMENTED

## Statement
Every sensitive dashboard action (agent edit, delete, lead import, content-engine changes, lead enable/toggle) is gated by `requireAuth`, requiring a full, valid `req.session.authenticated === true` session before the handler runs at all. That session itself can only be established after a secondary, out-of-band verification factor (SMS MFA) in addition to the password, unless the explicit `MFA_ENABLED=false` break-glass is set - so establishing the "full, valid login session" in the first place already required secondary verification.

## Evidence
`src/routes/dashboard.js:100-103`
```js
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated === true) return next();
  res.redirect('/dashboard/login');
}
```

`src/routes/dashboard.js:355-380`
```js
  // Break-glass: MFA_ENABLED must be explicitly 'false' to skip it. Unset or
  // any other value means MFA is required.
  if (process.env.MFA_ENABLED === 'false') {
    req.session.authenticated = true;
    return res.redirect('/dashboard');
  }

  const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');

  try {
    await twilioModule.sendSMSTo(
      process.env.DASHBOARD_MFA_PHONE,
      `Your GetKlosed dashboard verification code is ${code}. It expires in 5 minutes.`
    );
  } catch (err) {
    console.error('[dashboard] MFA SMS send failed:', err.message);
    return res.redirect('/dashboard/login?error=mfa_send_failed');
  }

  req.session.pendingMfa = {
    code,
    expiresAt: Date.now() + MFA_CODE_TTL_MS,
    attempts: 0,
  };
  res.redirect('/dashboard/verify');
});
```

## Commit reference
b165e9b (requireAuth gate); cc43725 (feat(security): SMS-based MFA on dashboard login, CASA 1.1.2/1.3.x/2.4.1)


===== 3.1.1 =====

# 3.1.1 — The application shall enforce least privilege access control rules on a trusted service layer

## Determination
IMPLEMENTED

## Statement
Access control is enforced server-side via `router.use(requireAuth)`, a trusted-service-layer check that cannot be bypassed by manipulating client-side state (there is no client-side gate to tamper with; every route handler only runs after the server itself verifies `req.session.authenticated`). Honest scope note: this application has a single flat privilege level (one shared operator credential), not a tiered least-privilege role model - the *enforcement mechanism* is a trusted server-side layer as required, but the *policy* it enforces is coarse-grained. The specific consequence of that coarse-grained policy (no per-agent authorization) is tracked separately as an accepted risk under 3.1.4.

## Evidence
`src/routes/dashboard.js:100-103`
```js
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated === true) return next();
  res.redirect('/dashboard/login');
}
```

`src/routes/dashboard.js:451-452`
```js
router.use(requireAuth);
router.use(ensureCsrfToken);
```

## Commit reference
b165e9b (original placement); unchanged in position by the CASA hardening batch


===== 3.1.2 =====

# 3.1.2 — All user and data attributes and policy information used by access controls shall not be able to be manipulated by end users unless specifically authorized

## Determination
NOT APPLICABLE

## Statement
The application has no role or permission model at all - a single shared `DASHBOARD_PASSWORD` grants one flat level of access to everything behind `requireAuth` (see 3.1.4 for the resulting object-level authorization gap, tracked as an accepted risk). With no roles or policy attributes to forge, there is no role-trust vulnerability surface to close.

## Evidence
Command: `grep -rniE "req\.(body|query)\.(role|permission|isAdmin|admin)" src/`
Output: (empty)

## Commit reference
N/A - no change required


===== 3.1.3 =====

# 3.1.3 — Access controls shall fail securely including when an exception occurs

## Determination
IMPLEMENTED

## Statement
`requireAuth` is a synchronous function with a single boolean check and no `try/catch`; the only way execution reaches `next()` is the explicit `req.session.authenticated === true` condition. Any exception during that check (e.g. a malformed session object) propagates to Express's error machinery - and, since commit bb7bbd6, to a global handler that always responds with a generic error rather than any implicit success path - not to an accidental `next()` call.

## Evidence
`src/routes/dashboard.js:100-103`
```js
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated === true) return next();
  res.redirect('/dashboard/login');
}
```

`src/server.js:86-95`
```js
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
```

## Commit reference
b165e9b (requireAuth); bb7bbd6 (global error handler backstop, CASA 6.2.1)


===== 3.1.4 =====

# 3.1.4 — Sensitive resources shall be protected against Insecure Direct Object Reference (IDOR) attacks

## Determination
ACCEPTED RISK

## Statement
Every dashboard route that reads or mutates a specific agent's data takes `agentId` from `req.params`/`req.query`, and the file-path/existence validation added in c07c499 stops path traversal - but no route checks that the authenticated session is scoped to that specific agent. The single shared `DASHBOARD_PASSWORD` authenticates one operator identity that can read, edit, import leads into, or delete *any* agent by ID once logged in. This is a known, real gap, not fixed by this hardening batch: the product currently has exactly one operator (the sole administrator), so there is no second party whose data needs isolating from another logged-in party today. If a second operator/tenant is ever added, this becomes a hard blocker and must be revisited before that happens.

## Evidence
Command: `grep -n "router\.\(get\|post\)('/agent/:agentId" src/routes/dashboard.js`
Output (verbatim, 11 routes, all reachable by any authenticated session regardless of which agentId is in the URL):
```
613:router.get('/agent/:agentId/edit', (req, res) => {
783:router.post('/agent/:agentId/edit', verifyCsrfToken, (req, res) => {
930:router.post('/agent/:agentId/content/provision', verifyCsrfToken, async (req, res) => {
952:router.post('/agent/:agentId/content/save', verifyCsrfToken, (req, res) => {
974:router.post('/agent/:agentId/content/voice', verifyCsrfToken, async (req, res) => {
998:router.post('/agent/:agentId/delete', verifyCsrfToken, (req, res) => {
1059:router.post('/agent/:agentId/import', verifyCsrfToken, async (req, res) => {
1147:router.get('/agent/:agentId/leads', async (req, res) => {
1239:router.post('/agent/:agentId/leads/:rowIndex/toggle-ai', verifyCsrfToken, async (req, res) => {
1264:router.post('/agent/:agentId/leads/:rowIndex/toggle-soi', verifyCsrfToken, async (req, res) => {
1289:router.post('/agent/:agentId/leads/enable', verifyCsrfToken, async (req, res) => {
```
None of these carry a check binding the session to a specific agentId; `requireAuth` (100-103) is the only gate, and it is agent-agnostic by design.

## Commit reference
Not remediated. Flagged as a known gap during the original recon (this conversation) and explicitly deferred, not silently missed.


===== 3.1.5 =====

# 3.1.5 — Application shall enforce a strong anti-CSRF mechanism to protect authenticated functionality, and effective anti-automation or anti-CSRF protects unauthenticated functionality

## Determination
IMPLEMENTED

## Statement
Authenticated functionality: a session-backed CSRF synchronizer token (csurf is deprecated, so this is a small hand-rolled equivalent rather than adding a new dependency) is generated per session, rendered as a hidden `_csrf` field in every one of the 9 authenticated state-changing dashboard forms, and checked against the session's copy on the corresponding POST route before the handler body runs. Verified live: a request missing the token, or carrying a wrong one, is rejected with `403` before any state changes. Unauthenticated functionality (`/login`, `/verify`): both are gated by their own `express-rate-limit` instances (5 requests/15min each, independent counting buckets), which is the anti-automation mitigation the control explicitly accepts as an alternative to CSRF tokens for pre-session endpoints.

## Evidence
`src/routes/dashboard.js:115-133`
```js
function ensureCsrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  next();
}

function verifyCsrfToken(req, res, next) {
  const sessionToken = req.session.csrfToken;
  const submitted = req.body && req.body._csrf;
  if (typeof sessionToken === 'string' && typeof submitted === 'string' && sessionToken === submitted) {
    return next();
  }
  res.status(403).send(renderErrorPage(
    'Form expired',
    'This page\'s security token is invalid or expired. Please refresh the page and try again.',
    { href: '/dashboard', label: 'Back to dashboard' }
  ));
}
```

`src/routes/dashboard.js:157-159`
```js
function csrfField(req) {
  return `<input type="hidden" name="_csrf" value="${escHtml(req.session.csrfToken)}">`;
}
```

`src/routes/dashboard.js:451-452`
```js
router.use(requireAuth);
router.use(ensureCsrfToken);
```

`src/routes/dashboard.js:328-340`
```js
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});
```

## Commit reference
43ab16e (feat(security): CSRF protection, SameSite cookie, timing-safe password check, CASA 3.2.1); 24d80c6 (rate limiters on /login and /verify)


===== 3.1.6 =====

# 3.1.6 — Directory browsing shall be disabled unless deliberately desired

## Determination
IMPLEMENTED

## Statement
The only `express.static` mount serves `views/public` with no options object, and no directory-listing middleware (`serve-index` or similar) is a dependency anywhere in the project.

## Evidence
`src/server.js:71-72`
```js
// Static files
app.use(express.static(path.join(__dirname, '..', 'views', 'public')));
```

Command: `grep -rn "serveIndex" src/`
Output: (empty)
Command: `grep -n "serve-index" package.json`
Output: (empty)

## Commit reference
N/A - unchanged by the CASA hardening batch


===== 3.2.1 =====

# 3.2.1 — Application shall implement only secure and recommended OAuth 2.0 flows, such as the Authorization Code Flow or Authorization Code Flow with PKCE, avoiding deprecated flows like Implicit or Resource Owner Password Credentials

## Determination
IMPLEMENTED

## Statement
The Google OAuth client is built via `googleapis`'s `google.auth.OAuth2` and driven with `generateAuthUrl()` + `getToken(code)`, which is the Authorization Code grant (confirmed live: the captured redirect Location header includes `response_type=code`, not `token`, ruling out Implicit). There is no username/password grant call anywhere in the file, ruling out Resource Owner Password Credentials. This is a confidential, server-side client (holds `GOOGLE_CLIENT_SECRET` server-side), the correct client type for plain Authorization Code without PKCE - PKCE exists specifically for public clients that cannot securely hold a client secret, which does not describe this deployment.

## Evidence
`src/routes/onboard.js:46-52`
```js
function makeOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.OAUTH_REDIRECT_URI || 'http://localhost:3000/onboard/oauth/callback'
  );
}
```

`src/routes/onboard.js:315-336`
```js
router.get('/oauth/start', (req, res) => {
  const { agentId } = req.query;
  if (!agentId) {
    return res.status(400).send('Missing agentId');
  }
  if (!isValidAgentId(agentId)) {
    return res.status(400).send('Invalid agentId');
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = { nonce, agentId };

  const oauth2Client = makeOAuthClient();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: OAUTH_SCOPES,
    state: nonce,
  });

  res.redirect(authUrl);
});
```

## Commit reference
Pre-existing OAuth client implementation (b165e9b-era onboarding flow); unchanged in mechanism by the CASA hardening batch


===== 3.2.2 =====

# 3.2.2 — Ensure that the application securely validates the redirect_uri and state parameters during the OAuth 2.0 authorization process to prevent open redirect and CSRF vulnerabilities

## Determination
IMPLEMENTED

## Statement
`state`: `/oauth/start` generates a random 16-byte nonce via `crypto.randomBytes`, stores `{nonce, agentId}` in the session, and passes only the nonce as `state` to Google - not the raw `agentId` as before. `/oauth/callback` validates the returned `state` against the session value, derives `agentId` from the session (not the query string), and deletes the pending entry so the nonce is single-use. Verified live: wrong state, no session, and a replayed already-consumed nonce all return `400`; only a correct, unconsumed nonce proceeds. `redirect_uri`: sourced exclusively from `process.env.OAUTH_REDIRECT_URI` (hardcoded localhost fallback for local dev only) - never read from `req.query`, `req.body`, or any other request-derived value, so a client cannot redirect the OAuth callback anywhere other than the configured endpoint (closing the open-redirect angle of this control).

## Evidence
`src/routes/onboard.js:315-336`
```js
router.get('/oauth/start', (req, res) => {
  const { agentId } = req.query;
  if (!agentId) {
    return res.status(400).send('Missing agentId');
  }
  if (!isValidAgentId(agentId)) {
    return res.status(400).send('Invalid agentId');
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = { nonce, agentId };

  const oauth2Client = makeOAuthClient();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: OAUTH_SCOPES,
    state: nonce,
  });

  res.redirect(authUrl);
});
```

`src/routes/onboard.js:339-363`
```js
router.get('/oauth/callback', async (req, res) => {
  const { code, state } = req.query;
  const pending = req.session.oauthState;

  if (!code || !state || !pending || state !== pending.nonce) {
    return res.status(400).send(renderErrorPage(
      "Connection didn't complete",
      "It looks like the Google authorization step didn't finish. This can happen if you closed the window, denied access, or the link expired. Please start over.",
      { href: '/onboard', label: 'Start over' }
    ));
  }

  const { agentId } = pending;
  delete req.session.oauthState;

  // Defense in depth: agentId is session-derived (validated at /oauth/start
  // before it was stored), but re-check here since this is the point where
  // it starts getting interpolated into filesystem paths.
  if (!isValidAgentId(agentId)) {
    return res.status(400).send(renderErrorPage(
      "Connection didn't complete",
      'That agent ID contains characters that are not allowed.',
      { href: '/onboard', label: 'Start over' }
    ));
  }
```

Command: `grep -n "redirect_uri\|redirectUri" src/routes/onboard.js`
Output: only the constructor argument shown above (`makeOAuthClient`, line 50) - no other occurrence in the file.

## Commit reference
86431e8 (feat(security): make OAuth state a real CSRF nonce, CASA 3.2.2); redirect_uri sourcing was already env-only pre-existing


===== 3.3.1 =====

# 3.3.1 — Application administrative interfaces shall use appropriate multi-factor authentication to prevent unauthorized use

## Determination
IMPLEMENTED

## Statement
The dashboard is this application's sole administrative interface, and it requires SMS-based MFA for every login unless the explicit `MFA_ENABLED=false` break-glass is set. Verified live end to end against a real phone: password success triggers a real SMS with a CSPRNG-generated 6-digit code; a deliberately wrong code is rejected and the session stays unauthenticated (confirmed via `GET /dashboard` still bouncing to login); the real received code then correctly authenticates.

## Evidence
`src/routes/dashboard.js:355-380`
```js
  // Break-glass: MFA_ENABLED must be explicitly 'false' to skip it. Unset or
  // any other value means MFA is required.
  if (process.env.MFA_ENABLED === 'false') {
    req.session.authenticated = true;
    return res.redirect('/dashboard');
  }

  const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');

  try {
    await twilioModule.sendSMSTo(
      process.env.DASHBOARD_MFA_PHONE,
      `Your GetKlosed dashboard verification code is ${code}. It expires in 5 minutes.`
    );
  } catch (err) {
    console.error('[dashboard] MFA SMS send failed:', err.message);
    return res.redirect('/dashboard/login?error=mfa_send_failed');
  }

  req.session.pendingMfa = {
    code,
    expiresAt: Date.now() + MFA_CODE_TTL_MS,
    attempts: 0,
  };
  res.redirect('/dashboard/verify');
});
```

`src/routes/dashboard.js:415-440`
```js
router.post('/verify', verifyLimiter, (req, res) => {
  const pending = req.session.pendingMfa;
  if (!pending) {
    return res.redirect('/dashboard/login');
  }

  if (Date.now() > pending.expiresAt) {
    delete req.session.pendingMfa;
    return res.redirect('/dashboard/login?error=mfa_expired');
  }

  const submitted = (req.body.code || '').trim();
  if (submitted === pending.code) {
    req.session.authenticated = true;
    delete req.session.pendingMfa;
    return res.redirect('/dashboard');
  }

  pending.attempts += 1;
  if (pending.attempts >= MFA_MAX_ATTEMPTS) {
    delete req.session.pendingMfa;
    return res.redirect('/dashboard/login?error=mfa_failed');
  }

  res.redirect('/dashboard/verify?error=1');
});
```

## Commit reference
cc43725 (feat(security): SMS-based MFA on dashboard login, CASA 1.1.2/1.3.x/2.4.1)


===== 4.1.1 =====

# 4.1.1 — Application shall enforce the use of TLS for all connections and default to TLS 1.2+, defaulting to secure cipher suites and rejecting those with known vulnerabilities

## Determination
EVIDENCE GAP

## Statement
TLS termination for app.getklosed.ca is handled entirely by Railway's edge/proxy layer, outside this application's codebase - there is no TLS configuration to read or quote from the repository. This determination cannot be made from a code review.

## Evidence
EVIDENCE GAP. Missing artifact: an SSL Labs (ssllabs.com/ssltest) report for app.getklosed.ca, generated against the live production domain, covering protocol versions offered, cipher suite ordering/strength, certificate chain validity, and padding-oracle-relevant TLS behavior. Per your instruction, this is covered by an external scan you're generating separately.

## Commit reference
N/A - not a codebase change


===== 4.1.2 =====

# 4.1.2 — Connections to and from the server shall use trusted TLS certificates

## Determination
EVIDENCE GAP

## Statement
TLS termination for app.getklosed.ca is handled entirely by Railway's edge/proxy layer, outside this application's codebase - there is no TLS configuration to read or quote from the repository. This determination cannot be made from a code review.

## Evidence
EVIDENCE GAP. Missing artifact: an SSL Labs (ssllabs.com/ssltest) report for app.getklosed.ca, generated against the live production domain, covering protocol versions offered, cipher suite ordering/strength, certificate chain validity, and padding-oracle-relevant TLS behavior. Per your instruction, this is covered by an external scan you're generating separately.

## Commit reference
N/A - not a codebase change


===== 4.1.3 =====

# 4.1.3 — No instances of weak cryptography which meaningfully impact confidentiality or integrity of confidential data

## Determination
EVIDENCE GAP

## Statement
TLS termination for app.getklosed.ca is handled entirely by Railway's edge/proxy layer, outside this application's codebase - there is no TLS configuration to read or quote from the repository. This determination cannot be made from a code review.

## Evidence
EVIDENCE GAP. Missing artifact: an SSL Labs (ssllabs.com/ssltest) report for app.getklosed.ca, generated against the live production domain, covering protocol versions offered, cipher suite ordering/strength, certificate chain validity, and padding-oracle-relevant TLS behavior. Per your instruction, this is covered by an external scan you're generating separately.

## Commit reference
N/A - not a codebase change


===== 4.1.4 =====

# 4.1.4 — All cryptographic modules shall fail securely and errors are handled in a way that does not enable Padding Oracle attacks

## Determination
EVIDENCE GAP

## Statement
TLS termination for app.getklosed.ca is handled entirely by Railway's edge/proxy layer, outside this application's codebase - there is no TLS configuration to read or quote from the repository. This determination cannot be made from a code review.

## Evidence
EVIDENCE GAP. Missing artifact: an SSL Labs (ssllabs.com/ssltest) report for app.getklosed.ca, generated against the live production domain, covering protocol versions offered, cipher suite ordering/strength, certificate chain validity, and padding-oracle-relevant TLS behavior. Per your instruction, this is covered by an external scan you're generating separately.

## Commit reference
N/A - not a codebase change


===== 5.1.1 =====

# 5.1.1 — Protect against HTTP parameter pollution

## Determination
IMPLEMENTED

## Statement
`express.urlencoded` is configured with `extended: false` in both the main server and the webhook app, which routes parsing through Node's built-in `querystring` library rather than the more permissive `qs` library. `querystring` resolves duplicate parameter names to a predictable array rather than `qs`'s bracket/nested-object coercion, closing the ambiguous-parsing surface that HTTP-parameter-pollution attacks exploit (different application layers interpreting a duplicated parameter differently).

## Evidence
`src/server.js:18-20`
```js
// Body parsing
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(express.json());
```

## Commit reference
N/A - unchanged by the CASA hardening batch (pre-existing configuration)


===== 5.1.2 =====

# 5.1.2 — URL redirects and forwards are limited to allowlisted URLs or a warning is displayed when redirecting to untrusted content

## Determination
IMPLEMENTED

## Statement
Every `res.redirect()` call across the dashboard and onboarding routers targets either a hardcoded internal path, an internal path with an `encodeURIComponent(agentId)` component (agentId is validated against `AGENT_ID_BARE_REGEX` before this point), or a URL built entirely server-side by the `googleapis` SDK's `generateAuthUrl()` (client ID, scope, and a server-generated nonce - see 3.2.2). No redirect target is built from a raw, unvalidated request value.

## Evidence
Command: `grep -rn "res.redirect(" src/routes/*.js` (28 call sites total)
Output (representative sample; full list reviewed, no exceptions found):
```
src/routes/dashboard.js:102:  res.redirect('/dashboard/login');
src/routes/dashboard.js:1017:    res.redirect(`/dashboard?deleted=${encodeURIComponent(agentId)}`);
src/routes/onboard.js:335:  res.redirect(authUrl);  // SDK-built Google consent URL
```

## Commit reference
N/A - no exception found; agentId encoding predates but is reinforced by c07c499's agentId validation


===== 5.1.3 =====

# 5.1.3 — Avoid the use of eval() or other dynamic code execution features; where there is no alternative, any user input is sanitized and sandboxed before being executed

## Determination
NOT APPLICABLE

## Statement
The application has no feature that requires evaluating dynamic code strings at runtime, so the conditional "where there is no alternative" clause never triggers.

## Evidence
Command: `grep -rn "eval(\|new Function(" --include="*.js" . --exclude-dir=node_modules --exclude-dir=.git`
Output: (empty)

## Commit reference
N/A - no change required


===== 5.1.4 =====

# 5.1.4 — Protect against template injection attacks by ensuring that any user input being included is sanitized or sandboxed

## Determination
NOT APPLICABLE

## Statement
The application does not use a templating engine at all - the dashboard and onboarding UIs are plain JS template literals authored entirely by developers (never end-user-supplied template syntax evaluated at runtime), with a manual `escHtml()` helper applied at every interpolation site (see 5.1.7). With no templating engine processing user-controlled template strings, there is no server-side template injection (SSTI) attack surface to protect.

## Evidence
Command: `grep -n "ejs\|pug\|handlebars\|hbs" package.json`
Output: (empty)

## Commit reference
N/A - no change required


===== 5.1.5 =====

# 5.1.5 — Prevent Server-Side Request Forgery (SSRF)

## Determination
NOT APPLICABLE

## Statement
All outbound HTTP calls in the application go through fixed SDK clients (Twilio, Google APIs, Anthropic) with hardcoded/library-managed endpoints, not a raw `fetch`/`axios` call whose target URL is built from request input.

## Evidence
Command: `grep -rn "fetch(\|axios(\|http.get(\|https.get(" src/routes/*.js src/webhook.js src/gmail.js src/email.js`
Output: (empty)

## Commit reference
N/A - no change required


===== 5.1.6 =====

# 5.1.6 — Protect against XPath or XML injection attacks

## Determination
NOT APPLICABLE

## Statement
The application does not parse or query XML anywhere; no XML parsing library is a dependency, and there is no XPath evaluation of any kind in the codebase.

## Evidence
Command: `grep -n "xml" package.json`
Output: (empty)

## Commit reference
N/A - no change required


===== 5.1.7 =====

# 5.1.7 — Context-aware output escaping or sanitization protects against reflected, stored, and DOM based XSS

## Determination
IMPLEMENTED

## Statement
The dashboard and onboarding UIs are plain JS template literals (no templating engine dependency exists in `package.json`), with a manual `escHtml()` helper applied consistently to every user-influenced value interpolated into HTML (agent names, lead data, error messages, the CSRF token value itself), covering both reflected and stored XSS. For DOM-based XSS: the only client-side script in the dashboard (the CSV-import file reader) assigns `textarea.value = reader.result`, a safe property assignment, never `innerHTML`/`outerHTML`/`document.write` with untrusted content.

## Evidence
`src/routes/dashboard.js:157-159`
```js
function csrfField(req) {
  return `<input type="hidden" name="_csrf" value="${escHtml(req.session.csrfToken)}">`;
}
```

Command: `grep -n "ejs\|pug\|handlebars\|hbs" package.json`
Output: (empty) - confirms no auto-escaping templating engine is relied upon; escaping is explicit at every interpolation site via escHtml().
Command: `grep -n "innerHTML\|outerHTML\|document.write" src/routes/dashboard.js src/routes/onboard.js`
Output: (empty)

## Commit reference
N/A - unchanged by the CASA hardening batch (escHtml predates it)


===== 5.1.8 =====

# 5.1.8 — Protect against database injection attacks

## Determination
NOT APPLICABLE

## Statement
The application has no SQL or NoSQL database. Persistent data lives in Google Sheets (via the Google Sheets API, which takes structured range/value objects, not query strings) and local JSON files on the Railway Volume. There is no database client library in the dependency tree and no query string construction anywhere in the codebase.

## Evidence
Command: `grep -n "mysql\|postgres\|pg\b\|sqlite\|sequelize\|mongoose\|mongodb" package.json`
Output: (empty)

## Commit reference
N/A - no change required


===== 5.1.9 =====

# 5.1.9 — Protect against OS command injection

## Determination
NOT APPLICABLE

## Statement
The running application never shells out to a child process. `child_process` is not imported anywhere in `src/` or `scripts/`.

## Evidence
Command: `grep -rn "child_process\|execSync(\|spawn(\|exec(" src/ scripts/ --include="*.js" --exclude-dir=node_modules --exclude-dir=_throwaway | grep -v "\.exec("`
Output: (empty) - the only raw hits before filtering were RegExp.prototype.exec() calls (an unrelated string-matching method) and content inside scripts/_throwaway/'s own vendored node_modules, which is untracked, uncommitted scratch content outside the application.

## Commit reference
N/A - no change required


===== 5.1.10 =====

# 5.1.10 — Protect against local file inclusion or remote file inclusion attacks

## Determination
IMPLEMENTED

## Statement
Local file inclusion: every dashboard route (11 total) and both onboarding entry points that build a filesystem path from a client-supplied `agentId` now validate it against `AGENT_ID_BARE_REGEX = /^[a-z0-9-]+$/` before it reaches `loadAgent()` or any other path-building call - a value like `../../etc/passwd` is rejected with `400` before touching the filesystem (verified live). Remote file inclusion: there is no dynamic `require()`/module loading anywhere in the codebase whose argument is anything other than a hardcoded string literal, so there is no path by which a request could cause the server to load and execute a remote or attacker-supplied module.

## Evidence
`src/routes/dashboard.js:36-59`
```js
function getAgentsDir() { return getStorageRoot(); }
const AGENT_FILE_BLOCKLIST = new Set(['example.json', '.gitkeep']);
// Matches the on-disk filename form (<agentId>.json), used to filter
// directory listings in discoverAgentIds.
const AGENT_ID_REGEX = /^[a-z0-9-]+\.json$/;
// Matches a bare agentId (no extension), same character class as above.
// Used to validate req.params/req.query agentId values before they are
// interpolated into a filesystem path, so a value like "../../etc/passwd"
// or one containing a null byte is rejected before any fs call.
const AGENT_ID_BARE_REGEX = /^[a-z0-9-]+$/;

function isValidAgentId(id) {
  return typeof id === 'string' && AGENT_ID_BARE_REGEX.test(id);
}

function rejectInvalidAgentId(req, res) {
  if (isValidAgentId(req.params.agentId)) return false;
  res.status(400).send(renderErrorPage(
    'Invalid agent ID',
    'That agent ID contains characters that are not allowed.',
    { href: '/dashboard', label: 'Back to dashboard' }
  ));
  return true;
}
```

Command: `grep -rn "require(" src/ scripts/ --include="*.js" --exclude-dir=node_modules --exclude-dir=_throwaway | grep -vE "require\('[^']*'\)|require\(\"[^\"]*\"\)"`
Output: (empty) - every require() call site in the codebase uses a string literal, confirming no dynamic/user-influenced module path exists.

## Commit reference
c07c499 (feat(security): validate agentId before it hits any filesystem path, CASA 5.1.10)


===== 5.2.1 =====

# 5.2.1 — Protect against malicious file uploads by limiting uploads to expected file types and preventing direct execution of uploaded content

## Determination
NOT APPLICABLE

## Statement
No route on the server accepts a `multipart/form-data` file upload - `multer` (or any equivalent) is not a dependency, and no route parses multipart bodies. The dashboard's CSV-import UI has a client-side `<input type="file">`, but the file's text content is read into the browser via the `FileReader` API and placed into an ordinary form-encoded textarea field before submission; the file itself, as a binary/multipart object, never reaches the server.

## Evidence
Command: `grep -n "multer\|multipart" package.json`
Output: (empty)

## Commit reference
N/A - no change required


===== 6.1.1 =====

# 6.1.1 — The app only uses software components without known exploitable vulnerabilities

## Determination
ACCEPTED RISK

## Statement
`npm audit fix` (no `--force`) was run and resolved 10 of 11 known vulnerabilities at the time (all highs and lows, one moderate), all via transitive bumps within existing semver ranges with no `package.json` version pins changed. 4 moderate-severity vulnerabilities remain, all the same underlying advisory (a `uuid` buffer-bounds issue) propagating up one dependency chain: `uuid` → `gaxios` → `googleapis-common` → `googleapis`. The only fix path is `npm audit fix --force`, which npm reports would bump `googleapis` from the pinned `^144.0.0` to `178.0.0` - a 32-major-version jump in Google's auto-generated API client that `gmail.js`, `onboard.js`, and `email.js` all depend on for every Gmail/Sheets/OAuth call. This was deliberately not run without a dedicated regression pass across the whole Gmail/Sheets/OAuth surface, which has not yet happened.

## Evidence
Command: `npm audit --json` (summary)
Output:
```json
{
  "info": 0,
  "low": 0,
  "moderate": 4,
  "high": 0,
  "critical": 0,
  "total": 4
}
```
Command: `npm audit` (remaining detail)
Output:
```
fix available via `npm audit fix --force`
Will install googleapis@178.0.0, which is a breaking change
node_modules/uuid
  gaxios  6.4.0 - 6.7.1
  Depends on vulnerable versions of uuid
  node_modules/gaxios
  googleapis-common  <=7.2.0
  Depends on vulnerable versions of uuid
  node_modules/googleapis-common
    googleapis  33.0.0 - 149.0.0
    Depends on vulnerable versions of googleapis-common
    node_modules/googleapis

4 moderate severity vulnerabilities
```

## Commit reference
bb3802f (chore(deps): npm audit fix, CASA 6.1.1)


===== 6.2.1 =====

# 6.2.1 — Disable debug modes in production environments

## Determination
IMPLEMENTED

## Statement
No debug flag, verbose-mode switch, or `/debug`/`/dev`-style route exists anywhere in `src/`, and there is no `NODE_ENV`-gated branching in the codebase at all. This app takes the stronger, unconditional form of this control rather than an environment-gated toggle: every error-handling path (9 route-level catch blocks plus a global 4-argument error handler registered after all route mounts) always returns a fixed generic message and never `err.message`/`err.stack`, regardless of environment - so there is no debug-mode flag to accidentally leave on in production, because the generic-error behavior is not conditional in the first place. The one genuine dev-only bypass in the codebase - `WEBHOOK_SKIP_SIGNATURE_CHECK`, which skips Twilio signature validation - requires *both* the env flag to be explicitly `'true'` *and* the request `Host` header to match `localhost`/`127.0.0.1`/`*ngrok*`, so it is inert against the production domain even if left set.

## Evidence
`src/webhook.js:543-554`
```js
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
```

`src/webhook.js:39-47`
```js
function isLocalOrDev(host) {
  if (!host) return false;
  const h = host.toLowerCase();
  return h === 'localhost' ||
    h.startsWith('localhost:') ||
    h === '127.0.0.1' ||
    h.startsWith('127.0.0.1:') ||
    h.includes('ngrok');
}
```

`src/server.js:86-95`
```js
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
```

`src/routes/dashboard.js:605-609`
```js
  } catch (err) {
    console.error('[dashboard] GET /:', err.message);
    res.status(500).send('Something went wrong. Please try again.');
  }
});
```

Command: `grep -rn "DEBUG\b\|debug:\s*true\|NODE_ENV\s*===\s*['\"]development" --include="*.js" src/ --exclude-dir=node_modules`
Output: (empty)

## Commit reference
bb7bbd6 (feat(security): stop leaking err.message to clients on error responses, CASA 6.2.1); the WEBHOOK_SKIP_SIGNATURE_CHECK double-gate predates the hardening batch


===== 6.3.1 =====

# 6.3.1 — The origin header shall not be used for authentication or access control decisions

## Determination
IMPLEMENTED

## Statement
State-changing requests are authorized via a session-scoped CSRF synchronizer token (see 3.1.5), not via inspection of the `Origin` (or `Referer`) header, which is attacker-influenceable in several real-world configurations (stripped by proxies/extensions, spoofable in older browsers, absent on same-origin requests in some setups). No route reads either header for any access-control purpose.

## Evidence
Command: `grep -rn "headers.origin\|headers\['origin'\]\|headers\.referer\|headers\['referer'\]\|req\.get('Origin')\|req\.get('Referer')" src/`
Output: (empty)

## Commit reference
43ab16e (the CSRF token mechanism that makes an Origin-based check unnecessary)


===== 6.4.1 =====

# 6.4.1 — The application shall not be susceptible to subdomain takeovers

## Determination
EVIDENCE GAP

## Statement
This requires live DNS resolution against the production domains, which cannot be determined from a static code review.

## Evidence
EVIDENCE GAP. Missing artifact: `dig`/`nslookup` output for `getklosed.ca` and `app.getklosed.ca`, checked for CNAME records pointing at a deprovisioned or unclaimed third-party service (a classic dangling-CNAME subdomain takeover). Flagged in the original recon as needing an external DNS check outside this repository. Per your note, this one is already covered on your side.

## Commit reference
N/A - not a codebase change


===== 6.5.1 =====

# 6.5.1 — The application shall not log credentials or payment details; session tokens shall only be stored in logs in an irreversible, hashed form

## Determination
IMPLEMENTED

## Statement
A full sweep of every `console.log`/`console.error`/`console.warn` call across `src/` and `scripts/` for arguments that could contain `DASHBOARD_PASSWORD`, `SESSION_SECRET`, `TWILIO_AUTH_TOKEN`, `TOKEN_ENCRYPTION_KEY`, or a refresh-token value found no hit that prints an actual secret value: hits either print an env var *name* (not its value), a boolean presence check (`? 'yes' : 'no'`), or run through an explicit `[REDACTED]` `JSON.stringify` replacer before logging an agent config object. Separately, session identifiers/tokens (`req.sessionID`, `connect.sid`, or any session-object value) are never logged anywhere, in any form - the stricter "never log session tokens at all" trivially satisfies "only log them hashed." There is no payment-handling code anywhere in this application.

## Evidence
Command: `grep -rn "console\.\(log\|error\|warn\|info\)" --include="*.js" src/ scripts/ --exclude-dir=node_modules --exclude-dir=_throwaway | grep -iE "DASHBOARD_PASSWORD|SESSION_SECRET|TWILIO_AUTH_TOKEN|TOKEN_ENCRYPTION_KEY|refresh_token|refreshToken|googleRefreshToken"`
Output (full list, all safe):
```
src/server.js:33:  console.warn('TOKEN_ENCRYPTION_KEY is not set. Token encryption/decryption will fail if invoked.');
src/index.js:733:        console.log(`[${id}] skipped: no Google authorization (refreshToken empty)`);
scripts/test-load-agent.js:8:console.log('refreshToken:     ', agent.googleRefreshToken ? 'yes' : 'no');
scripts/test-paths-needsreview.js:129:  console.log('Agent config (googleRefreshToken redacted):');
scripts/test-paths-stopsignal.js:160:  console.log('Agent config (googleRefreshToken redacted):');
scripts/test-webhook.js:137:  console.log('Agent config (googleRefreshToken redacted):');
scripts/test-paths-hotsignal.js:128:  console.log('Agent config (googleRefreshToken redacted):');
scripts/setup-sheet.js:53:    console.error(`Agent "${agentId}" has no googleRefreshToken. Run scripts/authorize.js first.`);
scripts/test-paths-askagent.js:157:  console.log('Agent config (googleRefreshToken redacted):');
scripts/test-paths-answergeneral.js:159:  console.log('Agent config (googleRefreshToken redacted):');
scripts/test-twilio.js:111:      console.log('  401 = bad credentials. Re-check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env.');
```
Command: `grep -rn "console\.\(log\|error\|warn\)" src/ --include="*.js" | grep -iE "sessionid|session\.id|connect\.sid|req\.sessionID"`
Output: (empty)

## Commit reference
N/A - no change required; this pattern predates and was reconfirmed during the CASA hardening batch


===== 6.6.1 =====

# 6.6.1 — Browser storage is securely cleared during logout

## Determination
NOT APPLICABLE

## Statement
The dashboard's client-side JavaScript is minimal (a CSV-import file-reader helper and a client-side size-limit check on the import form) and does not use `localStorage` or `sessionStorage` anywhere - there is no browser-stored data that would need clearing on logout.

## Evidence
Command: `grep -rn "localStorage\|sessionStorage" --include="*.js" --include="*.html" views/ src/`
Output: (empty)

## Commit reference
N/A - no change required


===== 6.7.1 =====

# 6.7.1 — The application shall securely store access tokens, API keys, and other server side secrets

## Determination
IMPLEMENTED

## Statement
The one server-side secret this application persists to disk - the Google OAuth refresh token, per agent - is now encrypted at rest. `src/tokenCrypto.js` implements AES-256-GCM, with a random 12-byte IV per encryption call and an integrity-checked 16-byte auth tag, stored together as a single `enc:v1:`-prefixed base64 string so the existing `googleRefreshToken` JSON field shape is unchanged. Both real write sites (the live OAuth callback and the standalone `scripts/authorize.js` CLI) call `encryptToken()`; the read choke point (`gmail.js`'s `getOAuthClient`) and the one script that bypasses it (`scripts/setup-sheet.js`) call `decryptToken()`, which transparently passes through legacy plaintext for un-migrated agents. `src/tokenMigration.js` runs this migration automatically and idempotently at server boot whenever `TOKEN_ENCRYPTION_KEY` is set. Verified live against scratch copies of the real agents directory: full round-trip correctness, IV non-reuse, tampered-ciphertext rejection via the auth tag, and twice-run idempotency. Scope note: every *other* secret this application uses (`ANTHROPIC_API_KEY`, `TWILIO_AUTH_TOKEN`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY` itself) is read from environment variables at runtime and never written to disk by the application - their storage is Railway's platform-managed env var store, outside this codebase's control (a boundary similar to the TLS gap in Domain 4, not this control's target).

## Evidence
`src/tokenCrypto.js:1-66`
```js
'use strict';

// Encrypts/decrypts OAuth refresh tokens for at-rest storage in agent JSON
// files. AES-256-GCM, one string field in, one string field out, so the
// existing googleRefreshToken shape never has to change.

const crypto = require('crypto');

const PREFIX = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// Read and validate the key lazily, inside encryptToken/decryptToken at call
// time rather than at module load. A top-level throw here would fire the
// moment anything requires this module (gmail.js is required transitively by
// most of the Jest suite), breaking test collection before a single test
// runs. Same reasoning as twilio.js's lazy client init.
function getKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be set to encrypt or decrypt tokens.');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`TOKEN_ENCRYPTION_KEY must base64-decode to exactly 32 bytes (got ${key.length}).`);
  }
  return key;
}

// Always produces enc:v1: output. Nothing written going forward should stay
// plaintext, so there's no passthrough case here.
function encryptToken(plaintext) {
  if (typeof plaintext !== 'string' || !plaintext) {
    throw new Error('encryptToken requires a non-empty string');
  }
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, authTag, ciphertext]);
  return PREFIX + combined.toString('base64');
}

// Legacy plaintext tokens (real Google refresh tokens, typically starting
// with "1//") are returned unchanged. The key is only touched once the
// enc:v1: prefix is actually present, so this passthrough path works even
// when TOKEN_ENCRYPTION_KEY is unset.
function decryptToken(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) {
    return value;
  }
  const key = getKey();
  const combined = Buffer.from(value.slice(PREFIX.length), 'base64');
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = { encryptToken, decryptToken, ENC_PREFIX: PREFIX };
```

`src/gmail.js:6-12, 54-65`
```js
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { getNowIso } = require('./time');
const { getStorageRoot } = require('./storagePaths');
const { parseRecipientList } = require('./recipientParsing');
const { decryptToken } = require('./tokenCrypto');
...
function getOAuthClient(agentConfig) {
  if (oauthClientCache.has(agentConfig.agentId)) {
    return oauthClientCache.get(agentConfig.agentId);
  }
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  client.setCredentials({ refresh_token: decryptToken(agentConfig.googleRefreshToken) });
  oauthClientCache.set(agentConfig.agentId, client);
  return client;
}
```

`src/routes/onboard.js:377-381`
```js
    const agentPath = path.join(getAgentsDir(), `${agentId}.json`);
    const config = JSON.parse(fs.readFileSync(agentPath, 'utf-8'));
    config.googleRefreshToken = encryptToken(tokens.refresh_token);
    config.isActive = true;
    writeAgentAtomic(agentId, config);
```

`src/tokenMigration.js:1-69`
```js
// src/tokenMigration.js
//
// Core loop for migrating plaintext googleRefreshToken values in existing
// agents/<id>.json files to the enc:v1: format used by src/tokenCrypto.js.
// Idempotent, safe to run more than once - agents already migrated or with
// no token are skipped. Called from scripts/encrypt-existing-tokens.js (CLI)
// and from server.js (automatically at boot, when TOKEN_ENCRYPTION_KEY is set).

'use strict';

const fs = require('fs');
const path = require('path');

const { getStorageRoot } = require('./storagePaths');
const { discoverAgentIds } = require('./routes/dashboard');
const { encryptToken, ENC_PREFIX } = require('./tokenCrypto');

// Same tmp-file-then-rename shape as onboard.js's writeAgentAtomic, just
// parameterized by directory so this can point at a scratch copy in tests.
function writeAgentAtomic(agentId, config, agentsDir) {
  const tmpPath = path.join(agentsDir, `${agentId}.tmp.json`);
  const finalPath = path.join(agentsDir, `${agentId}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n');
  fs.renameSync(tmpPath, finalPath);
}

function migrateExistingTokens() {
  const agentsDir = getStorageRoot();
  const agentIds = discoverAgentIds();

  let migrated = 0;
  let alreadyMigrated = 0;
  let noToken = 0;

  for (const agentId of agentIds) {
    const filePath = path.join(agentsDir, `${agentId}.json`);
    const config = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const token = config.googleRefreshToken;

    if (typeof token !== 'string' || token === '') {
      noToken++;
      continue;
    }

    if (token.startsWith(ENC_PREFIX)) {
      alreadyMigrated++;
      continue;
    }

    config.googleRefreshToken = encryptToken(token);
    writeAgentAtomic(agentId, config, agentsDir);
    migrated++;
    console.log(`[tokenMigration] migrated: ${agentId}`);
  }

  const summary = { migrated, alreadyMigrated, noToken, total: agentIds.length };

  console.log('');
  console.log('=== summary ===');
  console.log(`agents directory:  ${agentsDir}`);
  console.log(`total agents:      ${summary.total}`);
  console.log(`migrated:          ${summary.migrated}`);
  console.log(`already migrated:  ${summary.alreadyMigrated}`);
  console.log(`no token (skipped): ${summary.noToken}`);

  return summary;
}

module.exports = { migrateExistingTokens };
```

`src/server.js:27-49`
```js
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
```

## Commit reference
f92a834 (feat(security): encrypt refresh tokens at rest + auto-migrate on boot, CASA 6.7.1)
