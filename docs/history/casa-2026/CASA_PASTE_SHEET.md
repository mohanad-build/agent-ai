# CASA Paste Sheet — 8 rows, portal order

Operational sheet. Open beside the ESOF **Evidence** tab and work down.
Full reasoning lives in `CASA_REVALIDATION_2026-09.md`.

**The portal comment field caps at 1500 characters.** Every comment below was
measured programmatically, worst case 1,477 including line breaks counted as
two characters. Count noted per row. **If you edit a comment, re-count it.**

**Figures are from the 2026-09-11 re-run** (`casa-evidence/zap/`). Earlier
artifacts are in `superseded/` and `run1/`. Do not mix numbers between runs.

**Before starting:** paste row 10, reload the page, confirm the text
survived. If it did not, the portal saves only on Submit and all eight must
be done in one sitting.

**Do not click Submit until all eight rows have BOTH a comment and an
uploaded image.**

**The 1500-character cap moved detail into the images. They are load-bearing.**
Row 40's image in particular MUST carry the rule 43 forensic pair, rule 41
labelled no-result, and the backup-file explanation.

**The portal accepts PNG/JPG only.** The ZAP HTML report and `requests.csv`
go in the TAC email thread.

---

## ROW 10 — 2.2.1 — Logout / session expiration  (1,452 chars)

**Image:** code evidence PNG (session store, sweep, timeout checks)

```
REVISED SUBMISSION addressing both points raised: server-side invalidation on expiration, and refresh tokens.

1. EXPIRATION. An expired record was previously pruned only when the same session ID was presented again, so it could persist until restart. A periodic sweep now runs against the session store on a fixed interval and removes every record whose expiry has passed, whether or not it is presented again. Verified by test: a session is created, the clock advanced past the cookie maximum age, one sweep executed, and the store asserted to hold no record for that ID. Mutation testing confirms the test is load-bearing.

2. TIMEOUTS. Absolute (12h from authentication) and idle (30 min) are enforced independently on every authenticated request, against separate timestamps on the session rather than cookie mechanics. A rolling cookie was deliberately not used: it would convert the absolute limit into an idle one.

3. REFRESH TOKENS. The application issues no session refresh token. Dashboard authentication is a server-side session with a cookie identifier and no refresh mechanism. The only refresh tokens present are per-agent Google OAuth API credentials: not session tokens, not held by the operator's browser, granting no application access. Encrypted at rest and independently revocable. See 6.7.1.

4. STORAGE. Sessions persist in a file-backed store encrypted at rest under a dedicated key. No session field reaches disk in plaintext.
```

---

## ROW 21 — 3.1.4 — IDOR  (1,383 chars)

**Image:** code evidence PNG (principal, requireAgentAccess, scoped-deny test)

```
REVISED SUBMISSION. The prior submission recorded this as an accepted risk on the basis of a single-operator design. We accept the reviewer's finding that this does not satisfy the requirement, and have implemented an object-level authorization boundary.

1. A principal is established on the session at authentication, carrying an explicit set of agents it may act on.

2. A dedicated middleware, requireAgentAccess, is mounted once on the /agent/:agentId prefix. All eleven routes reading or writing agent-scoped data inherit it, so a route added later is covered by default rather than by the author remembering. Authentication and authorization remain separate middlewares answering separate questions.

3. Fail-closed: a session bearing no principal is denied even where otherwise authenticated. Pre-existing sessions were invalidated at deployment, not grandfathered.

4. A denied request returns 404, not 403, with a body byte-identical to the response for a nonexistent agent, so an unauthorized caller cannot enumerate agent identifiers. Asserted by test.

5. The controlling test is the scoped-principal case: a principal entitled only to agent-a is DENIED on agent-b and ALLOWED on agent-a, showing the boundary is enforced by the authorization decision rather than being incidental to there being one operator. Removing the check fails that test and the fail-closed test.
```

---

## ROW 33 — 5.1.3 — eval() / dynamic code execution  (375 chars)

**Image:** the original evidence PNG, unchanged.
Source: `~/Downloads/casaevidenceimages/5.1.3.png`, copy into
`casa-evidence/zap/png/`.

```
The reviewer's determination for this requirement reads "designated as NOT APPLICABLE" with no objection raised. Resubmitting the original evidence unchanged for status closure. Re-verified against current HEAD: a repository scan for eval( and new Function( returns zero results. If there is an objection beyond the visible comment, please let us know and we will address it.
```

---

## ROW 40 — 5.1.10 — Local / remote file inclusion  (1,464 chars)

**Image — the most important one in the set. MUST carry:**
- coverage figures and the first/last authenticated 200 timestamps
- the per-rule table with `x-zap-scan-id` counts
- **the rule 43 forensic pair**: baseline msg 88 (slug `zap-zap`, length 58)
  beside flagged msg 12417 (slug `onboard-zap-4`, length 64), both bodies,
  the empty evidence field, and the 68%-against-75% otherinfo line
- **rule 41 labelled NO RESULT, not pass**
- **rule 10095**: 0 alerts under Default Policy; 8 in the isolated
  supplemental run, all HTTP 400 from `AGENT_ID_BARE_REGEX`
  (`dashboard.js:43`) rejecting the malformed agentId before any filesystem
  access. **Not status-0 connection failures.**
- the filesystem verification, `_sessions` noted as boot-created

```
REVISED SUBMISSION: authenticated DAST evidence per TAC's direction of 2026-09-10. OWASP ZAP 2.17.0, spider and active scan against commit 90ac5b7, the commit deployed to production. Per ADA procedure the target was a non-production instance of that build; NODE_ENV is read nowhere in the source, so both run identical code paths.

AUTHENTICATED COVERAGE, session cookie applied to every request: 15,835 requests total, 11,634 to authenticated routes, 7,125 of those HTTP 200, and 0 redirects to /dashboard/login.

First authenticated 200 at 04:25:44Z, last at 04:55:50Z, ten seconds before the scan ended. A session is destroyed only at logout or timeout and cannot be restored, so a 200 in the final seconds proves it held throughout. 4,554 of 4,594 authenticated POSTs reached a handler, the other 40 correctly rejected by the CSRF check.

RESULTS. Rules 6 Path Traversal (1,027 requests), 7 Remote File Inclusion (570), 43 File Inclusion (190), 42 SVN (16), 10045, 20017, 40034 and 40035 all ran. Only rule 43 alerted, twice; both are scanner artifacts. Each response is Express's fixed redirect template, differing from baseline only by the agent slug derived from the submitted name, with the length delta matching the slug exactly. No file content appears and ZAP's evidence field is empty for both. Pairs attached.

FILESYSTEM. Onboarding traversal payloads produced 3,751 files inside the storage root, 0 outside, and 0 directories created by any payload.
```

---

## ROW 43 — 6.2.1 — Debug modes in production  (1,436 chars)

**Image:** debug rule table, the 400 and 404 counts, error handler source at
`server.js:102-107`

```
REVISED SUBMISSION providing authenticated DAST evidence from the same OWASP ZAP 2.17.0 scan described under 5.1.10, whose environment, authentication and proof of authenticated coverage apply here.

RESULTS. No finding for debug or error message disclosure.

  10023 Debug Error Messages          0 alerts
  90022 Application Error Disclosure  0 alerts
  10056 X-Debug-Token Leak            0 alerts
  40025 Proxy Disclosure  249 req,    0 alerts

The first three are passive and therefore inspected all 15,835 recorded responses, including the 700 HTTP 400 and 1,095 HTTP 404 responses, which are likeliest to carry diagnostic output.

NO DEBUG MODE EXISTS. NODE_ENV is read nowhere in the application source, so no branch produces different error output in one environment than another. Error handling is centralised in a single handler registered after all routes, which logs the message and stack trace server-side and returns a fixed string: 'Something went wrong. Please try again.' The message, stack trace and exception type never appear in a client response, in any environment, because no code path includes them. Registered last, it overrides the framework's default handler, the component that would otherwise return stack traces.

The attached report also carries Low and Medium header hardening observations (CSP, framing, content type options, technology disclosure, SRI). None relates to debug mode or error disclosure.
```

---

## ROW 44 — 6.3.1 — Origin header  (1,427 chars)

**Image:** CORS rule table, the real production response headers from
`casa-evidence/zap/production-origin-check.txt`, the zero-match source search

```
REVISED SUBMISSION providing authenticated DAST evidence from the same OWASP ZAP 2.17.0 scan described under 5.1.10, plus direct verification against production.

RESULTS. No finding for CORS misconfiguration or arbitrary origin trust.

  10098 Cross-Domain Misconfiguration  all 15,835 responses, 0 alerts
  40040 CORS Header                    217 requests, 0 alerts
  10017 Cross-Domain JS Inclusion      0 alerts

Rule 40040 is active: it issues requests carrying attacker-controlled Origin values and inspects the response for a reflected or overly permissive access control header. It needed the ZAP beta rule set, installed and run rather than skipped.

PRODUCTION VERIFICATION.

  GET https://app.getklosed.ca/dashboard/login
  Origin: https://evil.example

The response carried no Access-Control-Allow-Origin, no Access-Control-Allow-Credentials, and no Access-Control-* header of any kind. The Origin was neither reflected nor acknowledged.

IN CODE. No CORS middleware in the dependency set or source tree, no code setting any Access-Control-* header, and no code reading Origin or Referer, verified by searching the full source tree for each string with zero matches. The Origin header therefore cannot inform an access control decision, because no code reads it. State-changing requests are additionally protected by a session-bound CSRF token on every authenticated POST, backed by SameSite on the session cookie.
```

---

## ROW 46 — 6.5.1 — Credential and payment logging  (1,427 chars)

**Image:** Railway logs filtered on `login`, time range "Last month",
showing the Sept 8-9 sequence. **Crop to the log panel**, not the whole
browser window. Verified 2026-09-11: the three quoted lines are present
verbatim.

```
REVISED SUBMISSION. The prior submission provided source-code evidence only. This provides the written description and the captured log sample the requirement specifies.

1. WHAT IS LOGGED. The login path previously emitted nothing on success, which would have made a capture an empty window. Explicit authentication audit logging was added. The attached capture includes a live sequence of two failed password submissions followed by a success:

  [auth] login failure | reason=bad_password | 2026-09-09T22:10:24.674Z
  [auth] login failure | reason=bad_password | 2026-09-09T22:10:27.741Z
  [auth] login success | principal=operator | 2026-09-09T22:10:47.225Z

A failed multi-factor code emits reason=bad_mfa_code.

2. NEVER LOGGED. No record contains the password, the multi-factor code, the session identifier or the operator telephone number, in any form, hashed or otherwise. These are not written at all rather than obscured. Enforced by test: the test asserts none of those values appears in any log output during a full authentication.

3. SESSION TOKENS are transmitted only in a Secure, HttpOnly, SameSite cookie and never written to logs, so irreversible storage does not arise.

4. PAYMENT DETAILS. Not applicable. The application does not collect, process, transmit or store payment data. No payment path exists.

5. LOG ACCESS is restricted to the single platform workspace member, password plus TOTP. See 6.7.1.
```

---

## ROW 48 — 6.7.1 — Server-side secrets  (1,459 chars)

**Image:** three captures composed into one PNG — Railway workspace
People page (one member, Admin, 2FA On); Variables page, **all values
masked, no eye icon clicked**; logs filtered on `secrets-audit`, range
"Last month". **Crop each to the panel.** Verified 2026-09-11: the quoted
`decryptToken` line is present verbatim. All agent identifiers shown are
test agents.

```
1. STORAGE. Per-agent Google OAuth refresh tokens are encrypted at rest with AES-256-GCM under a versioned envelope. No plaintext token persists in application storage. Session state is separately encrypted under an HKDF-derived key. All other secrets are held only in the platform's encrypted environment-variable store; none appears in the repository. The cookie-signing secret, session store key and credential key are three distinct values.

2. ACCESS CONTROL. Access to the production secret store is restricted to the workspace owner. The workspace has exactly one member, the sole operator. No service accounts, CI integrations or third parties hold credentials. Sign-in requires a password plus a TOTP second factor; recovery codes are stored offline. Values are masked by default and require an explicit reveal.

3. ROTATION. Every secret is rotatable without code change, and third-party credentials are revocable at source. The token encryption key is versioned in the envelope, making rotation a forward migration. On suspected exposure: revoke at source, update the value, redeploy.

4. MONITORING. Every decryption of a stored credential emits an audit record naming the agent and the time, never the value, any portion of it, or its length:

  [secrets-audit] decryptToken called agentId=mo-test context=getOAuthClient ts=2026-09-08T23:48:45.709Z

The workspace has one member, so any change to the secret store is attributable by construction.
```

---

## EMAIL TO TAC AFTER SUBMITTING

Portal images only, comments capped at 1500 characters, so the artifacts and
the caveats go in the existing thread. Attach the ZAP HTML report,
`requests.csv`, and the supplemental report. Name assessment
CASA-22333-11018 and rows 40, 43, 44. State plainly:

1. Rule 43's two High alerts are scanner artifacts, with the baseline and
   flagged request/response pair included so the tester can confirm it.
2. Rule 41 issued zero requests and is reported as a no-result, not a pass.
3. The backup-file alerts in the supplemental run returned HTTP 400 because
   the application rejected the malformed identifier before any filesystem
   access.
4. Per-rule request counts are recountable from `requests.csv` via the
   `x-zap-scan-id` column.

## AFTER SUBMISSION

Portal steps remaining: Revalidation → Report Generate → LOV Submitted.
Once the Letter of Validation issues, **reply directly to Google's
verification email in the existing thread** or the process stalls there.
Google's date: **Oct 5 2026**. Extensions go through the LAB, not Google.
