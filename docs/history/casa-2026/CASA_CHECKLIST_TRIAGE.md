# CASA ESOF Checklist Triage (48 items) — Updated after casa-hardening merge batch, 2026-08-28

Recon confirmed against the live repo (src/server.js, src/routes/dashboard.js,
src/routes/onboard.js, src/webhook.js, src/paths.js, src/storagePaths.js,
package.json). Every VERIFY item from the first pass resolved to a real
verdict. All seven commits below are pushed to `casa-hardening` (origin),
**not yet merged to main — no deploy triggered.**

---

## Confirmed CLEAN — no code needed, just write the comment

| # | ID | Requirement | Evidence |
|---|-----|---|---|
| 2 | 1.1.2 | Sys-generated initial passwords/codes expire | N/A — no such mechanism exists |
| 4 | 1.2.1 | No default credentials | `DASHBOARD_PASSWORD` empty in `.env.example`, read only from env at `dashboard.js:251`, no hardcoded fallback |
| 5-8 | 1.3.1-1.3.4 | Out-of-band verifier | N/A — grep confirms zero OTP/magic-link/verification-code auth mechanism anywhere (superseded by real SMS MFA, commit 6 — see below) |
| 9 | 2.1.1 | No secrets in URLs | Confirmed — all query params are non-secret UI flags |
| 15 | 2.3.3 | Tokens not static secrets | Twilio webhook validates `X-Twilio-Signature` via `twilio.validateRequest` (`webhook.js:543-554`); dev bypass is properly gated to localhost/ngrok only |
| 17 | 2.4.1 | Re-auth before sensitive actions | N/A — no such flow exists, reasonable for current app design |
| 19 | 3.1.2 | No client-supplied role/permission trusted | Confirmed, zero hits |
| 20 | 3.1.3 | Fail-closed on exception | Confirmed — `requireAuth` (`dashboard.js:76-79`) has no swallow path; only explicit `true` reaches `next()` |
| 23 | 3.1.6 | No directory browsing | Confirmed — bare `express.static`, no `serveIndex` |
| 27-30 | 4.1.1-4.1.4 | TLS/comms | Platform-managed (Railway/Cloudflare) — still worth one SSL Labs check, not code |
| 31-40 | 5.1.1-5.1.9 (except 5.1.10) | Data validation cluster | All confirmed clean: no `eval`, no XML lib, no `child_process`, no open redirect, no SSRF from user input in routes, output escaped via `escHtml()` helper throughout |
| 41 | 5.2.1 | File upload protection | N/A — no server-side upload endpoint; CSV "upload" is read client-side via `FileReader` and submitted as plain form text |
| 47 | 6.6.1 | Browser storage cleared on logout | N/A — zero `localStorage`/`sessionStorage` usage anywhere |

## RESOLVED — casa-hardening branch, commits 1-7 (pushed, not yet merged to main)

| Commit | Item(s) | What shipped |
|---|---|---|
| `24d80c6` — session/login hardening | 1 (`2.3.1` secure cookie + trust proxy), 5 (`1.1.1` rate limiting), 7 (`2.2.3` cookie `maxAge`), 8 (`2.2.1` explicit `clearCookie` on logout) | Bundled together per the original plan (trust-proxy interaction with `express-rate-limit` needed to be done in one commit). `2.3.2` (`httpOnly` explicit) not confirmed as part of this diff — see open item below. |
| `86431e8` | 3 (`3.2.2` OAuth CSRF nonce) | `state` is now a random server-recorded nonce validated on callback, not the raw `agentId` |
| `c07c499` | 9 (`5.1.10` agentId path validation) | `agentId` re-validated against the same regex before use in every route that builds a filesystem path from it |
| `bb7bbd6` | 11 (`6.2.1` generic error responses) | 500s no longer leak `err.message` to the client; real detail logged server-side only |
| `bb3802f` | 10 (`6.1.1` npm audit) | Fixed the auto-resolvable set. **4 moderate `googleapis`-chain vulnerabilities remain, fixable only via `--force` (breaking major version bump) — open decision below.** |
| `cc43725` | 6 (`3.3.1` MFA) | Decision made: **built real SMS-based MFA** on the dashboard login, not a compensating-control writeup |
| `f92a834` | 4 (`6.7.1` refresh token encryption at rest) | Decision made: **built encryption**, not a compensating-control writeup. `src/tokenCrypto.js` — AES-256-GCM, versioned (`enc:v1:`) envelope around the existing `googleRefreshToken` string field. Decryption wired into `gmail.js`'s `getOAuthClient` (the single real choke point — covers `content/actionHandler.js` for free). Encryption wired into both actual write sites: `onboard.js`'s OAuth callback and `scripts/authorize.js` (a second write site found during recon, not in the original brief). `scripts/setup-sheet.js` patched too — it built its own OAuth client directly and would've broken on ciphertext. `src/tokenMigration.js` runs automatically at boot when `TOKEN_ENCRYPTION_KEY` is set; idempotent, wrapped in try/catch (a migration failure degrades to "some agents stay plaintext," not an outage). `decryptToken()` deliberately passes through anything not prefixed `enc:v1:` as legacy plaintext rather than throwing — required so existing agents' real tokens don't break Gmail/Sheets access the instant this shipped, before migration runs. Key validation is lazy (checked at call time, not module-load) — a load-time throw would fire the moment Jest imports `gmail.js`, breaking test collection (same pattern already used for `twilio.js`'s lazy client init). Verified against scratch copies of `agents/`, including a same-hash idempotency proof on a second run, never against the live directory. Tests: 116/116 suites, 2409/2409 tests green at commit time. |

## Still open

**`6.1.1` — 4 moderate `googleapis`-chain vulnerabilities need `--force`.** That's a breaking major version bump — needs your call: force the upgrade and deal with any API breakage now, or accept/dispute the moderate-severity risk for now and revisit later.

**`2.3.2` (`httpOnly` explicit) and `6.5.1` (trim the Q-token log line) — not confirmed against the actual commit 1 / recent diffs.** Low priority, cheap fixes, but worth a quick check of whether they rode along with the session-hardening commit or still need a follow-up.

**`3.1.4` (IDOR framing) — still just a documentation item**, not a code gap: single shared dashboard password grants access to every agent's data by design (single-operator dashboard, agents don't get their own logins). Needs an honest comment in the CASA writeup framing this as intentional architecture, mitigated by MFA + rate limiting + secure cookies (all now real, not compensating-control writeups) rather than pretending per-agent authorization exists.

---

## Decisions that were open, now resolved

1. ~~MFA on the dashboard (3.3.1)~~ — **Built.** Real SMS-based MFA, not a compensating-control writeup.
2. ~~Refresh token encryption at rest (6.7.1)~~ — **Built.** AES-256-GCM + boot-time auto-migration, not a compensating-control writeup.
