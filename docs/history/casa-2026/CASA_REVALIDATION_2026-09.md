# CASA Revalidation: PASSED. GOOGLE APPROVED VERIFICATION 2026-09-28

**UPDATE 2026-09-28. DONE: GOOGLE APPROVED THE OAUTH APP VERIFICATION.** Email from API OAuth Dev Verification, 2026-09-28 06:01, in the existing verification thread: OAuth App Verification approved for project 774504010487 (Project ID agent-ai-494322) for `.../auth/gmail.modify`. `drive.file` is non-sensitive and never needed verification, so the approval covers every scope the app requests. It landed a week ahead of the Oct 5 deadline, and the Oct 1 TAC nudge was never needed.

**No reply was sent, and none of the email's quick-reply buttons ("Yes, please proceed.", "Yes, I confirm.", "I am no longer interested.") were used.** The email asks for a response only to BEGIN the annual reverification, and "Yes, please proceed" could plausibly start that now.

**Cloud Console, Google Auth Platform, Audience, checked 2026-09-28:** Publishing status **In production**, User type **External**, OAuth user cap 5 of 100, which no longer applies because the app requests only approved scopes. Nothing on that page was changed; "Back to testing" must never be clicked.

**What remains:** annual recertification with Google (respond in the verification thread when ready to begin) and CASA revalidation with TAC, both around September 2027; and keeping the Cloud Console Project Owner and Editor accounts current so Google's mail reaches Mo. **Follow-ons, recorded in PROJECT_STATE session 80:** the onboarding passcode gate (7.25.1), held until verification cleared, shipped the same day (`682de81`); and the recurring refresh-token deaths of the summer are expected to stop, so a recurrence now points at a different cause (7.58.13).

(Prior status, 2026-09-24, follows.)

**UPDATE 2026-09-24. STEP 6 IS DONE; THE CLOCK NOW BELONGS TO GOOGLE.** TAC, Sept 22: the LOV would go to Google within 12 to 48 hours. TAC, Sept 23: **the LOV has been submitted to Google**; expect an update within 5 to 6 business days (Sept 30 to Oct 1), and **do not contact Google directly**, which TAC says can delay the process. ESOF portal: all six steps Completed, banner "CASA completed successfully." **What to do:** nothing until Google writes. Do not START a conversation with Google. When Google's email arrives, reply in that thread with whatever it asks for (see AFTER THE LOV ISSUES, which is sequential with TAC's instruction, not in conflict). Watch the OAuth consent screen's verification status in Cloud Console too; it may change before the email. **If nothing has arrived by end of day Thursday Oct 1, nudge TAC in the existing thread, not Google.** Extensions go through TAC. Google's date is Oct 5. TAC's Gartner feedback link is optional and has no bearing on the outcome.

(Prior status, 2026-09-21, follows.)

**UPDATE 2026-09-21. PASSED.** Assessor: "completed the assessment and proceeded with the LOV." ESOF steps 1-5 Completed; step 6 LOV Submitted Pending (TAC to Google). The Sept 18 email was stale; the last paid round was never used. **Remaining: once step 6 flips, Mo replies in Google's original verification thread.** Evidence archived: answer files in git (`casa-evidence/*.md`), everything else in `casa-evidence-2026-09.zip` on Google Drive, SHA-256 in `casa-evidence/ARCHIVE.md`. Of the parked-after-LOV items below, session id rotation (`56cc1c7`), header hardening without CSP (`b5f1787`) and tracking `casa-evidence/` (`f7fc8bf`, answers only) are DONE.

---

(Historical, as of 2026-09-11 to 2026-09-18.)


Assessment ID **CASA-22333-11018**. **All eight failed rows resubmitted
2026-09-11** with comments and evidence images, plus a follow-up email to
TAC carrying the ZAP report, `requests.csv` and the supplemental report.
Google's date: **Oct 5 2026**. TAC: `casasupport@tacsecurity.com`, existing
"Welcome to TAC Security – CASA Assessment" thread.

**UPDATE 2026-09-18. TAC emailed "review completed, some checks failed, re-upload and let us know." The portal still shows the same eight Fails with the ROUND-ONE tester comments**, which contradict the Sept 11 evidence beside them (5.1.10 says no DAST scan; 6.5.1 says grep only). Read as not yet reviewed: either Submit CASA Assessment was never triggered on the revisions, or support sent the template off stale status. **Mo: the next submit is his last paid round, so the portal is NOT touched until TAC answers.** Email sent 2026-09-18 asking whether the revisions are in the assessor's queue or need Submit, and whether Submit consumes a round and how many remain. Nudge in-thread if no reply by Tuesday 2026-09-22. Before any final submit, check each row's image against the tester's exact objection, 6.7.1 first (access-control and monitoring evidence for Railway secrets; a members and 2FA screenshot).

**Previously: waiting on TAC's tester.** Portal steps remaining: Revalidation →
Report Generate → LOV Submitted.

Portal comment fields cap at **1500 characters**; images are **PNG/JPG
only**. Final text lives in `CASA_PASTE_SHEET.md`, images in
`casa-evidence/zap/png/`, one per control ID.

---

## WHAT TO WATCH FOR IN TAC'S RESPONSE

1. **Rule 43's two High alerts** are the likeliest challenge. They are
   disclosed head-on in row 40's comment and image. The defence is
   arithmetic: baseline body 58 bytes for slug `zap-zap`, flagged 64 for
   `onboard-zap-4`, 22 characters of fixed redirect text plus the slug
   accounting for both, and an empty evidence field on both alerts.
2. **Two questions TAC never answered:** how many revalidation rounds the
   plan includes, and whether 5.1.3 carries an objection beyond the visible
   comment. Re-asked 2026-09-10, still open.
3. **The header hardening observations** in the attached report (CSP,
   framing, content type options, X-Powered-By, SRI). Acknowledged in row
   43's comment as outside the three controls. If a tester tries to open
   them, they are cheap to fix but would force a rescan.
4. **The scan target was a non-production instance** of the deployed commit,
   per ADA's own procedure, and row 40 says so plainly. If challenged, the
   supporting fact is that `NODE_ENV` is read nowhere in the source.

---

## THE EIGHT ROWS AS SUBMITTED

| S.No | ID | Requirement | Evidence submitted |
|---|---|---|---|
| 10 | 2.2.1 | Logout / session expiration | Sweep, idle and absolute timeouts, encrypted store |
| 21 | 3.1.4 | IDOR | Principal, `requireAgentAccess`, scoped-deny test |
| 33 | 5.1.3 | `eval()` | Original evidence resubmitted; reviewer text was a pass |
| 40 | 5.1.10 | LFI / RFI | Authenticated ZAP scan, rule table, filesystem verification |
| 43 | 6.2.1 | Debug modes | Debug rule results, error handler source |
| 44 | 6.3.1 | Origin header | CORS rules, live production header check |
| 46 | 6.5.1 | Credential logging | Auth audit log capture |
| 48 | 6.7.1 | Server-side secrets | Access policy, masked variables, secrets-audit capture |

## THE SCAN, AS RUN

**Target: a local instance of `90ac5b7` (matches `origin/main`).** Isolated
env: fresh temp `STORAGE_ROOT`, throwaway `DASHBOARD_PASSWORD`,
`MFA_ENABLED=false`, fresh `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY`, every
Twilio, Anthropic and Google credential explicitly blanked so `.env` could
not fill them. One seeded agent `casa-scan`, shadow mode, no tokens.

**Tool: ZAP 2.17.0, native macOS, Automation Framework. No Docker.** DMG
SHA-256 verified against the GitHub release API before clearing quarantine.
Authentication by a replacer rule setting the Cookie header. CSRF field
`_csrf`, generated once per session (`dashboard.js:190-191`).

**FINAL FIGURES, 2026-09-11 re-run.** Earlier artifacts in `superseded/` and
`run1/`. **Never mix numbers between runs.**

- Total requests **15,835**; to authenticated routes **11,634**; HTTP 200
  among those **7,125**; **redirects to `/dashboard/login`: 0**.
- First authenticated 200 `04:25:44.328Z`, last `04:55:50.031Z`, plan end
  `04:56:00.169Z`. A session dies only at logout or timeout and cannot
  revive, so a 200 ten seconds before the end proves it held throughout.
- POSTs to `/dashboard/agent/*`: **4,594**; reached a handler **4,554**;
  CSRF-rejected **40**.
- Whole scan: **700** HTTP 400, **1,095** HTTP 404.
- Per-rule counts carry **`x-zap-scan-id`** in `requests.csv`, so TAC can
  recount: 6 Path Traversal **1,027**, 7 RFI **570**, 41 Git **0**, 42 SVN
  **16**, 43 File Inclusion **190**, 10045 **4**, 10095 **380**, 20017 **16**,
  40025 **249**, 40034 **5**, 40035 **52**, 40040 CORS **217**. ZAP's daemon
  log differs by 0.1-3.1% on some rules; cause investigated, not confirmed,
  **so the CSV is the headline figure and the gap is disclosed**.
- Filesystem: **3,751** files inside `STORAGE_ROOT`, **0** outside, **0
  directories created by any payload**. `_sessions` is created at boot by
  `ensureSessionDirLockedDown()` (`sessionStore.js:107`).
- **Rule 41 issued 0 requests: reported as NO RESULT, never as a pass.**
- Rule 10095: 0 alerts under Default Policy; 8 in the isolated supplemental
  run, all **HTTP 400** from `AGENT_ID_BARE_REGEX` (`dashboard.js:43`)
  rejecting the malformed agentId before any filesystem access. **Not
  status-0 connection failures** — that was the earlier run, and the wrong
  explanation nearly shipped.

## FOUR PROCESS RULES THIS JOB PAID FOR

**1. Never reopen a ZAP session file.** Run 1 finished cleanly, then
reopening its auto-named session with `-session` made ZAP create a new empty
session at the same path and overwrite the 134MB history. Run the daemon with
an explicit `-newsession`, execute the plan through the API, back up the
session directory, extract through the live API, then shut down.

**2. Evidence-grade output must be written to its final home at generation
time, not left in scratch.** Teardown deleted `scripts/_throwaway/`, which
held the only copy of the per-rule counts, and the `STORAGE_ROOT` that was
the filesystem evidence. **The re-run that fixed it is also what caught rule
43's two alerts**, which the first run would have shipped next to a comment
claiming zero.

**3. Seen is not captured.** This doc recorded Railway screenshots as
"captured and clean" when they had only been looked at. They did not exist on
disk. Found at submission time, when the cost of being wrong was highest.
**Record an artifact only when a file exists.**

**4. Grep rendered evidence for secrets before it leaves the machine.** The
retained daemon logs each contained one line echoing the replacer job's
configured cookie value. Caught and redacted.

## PARKED, AFTER THE LOV

**Status 2026-09-28:** session id rotation (`56cc1c7`), the security headers (`b5f1787`) and tracking the `casa-evidence/` answer files (`f7fc8bf`) all shipped in session 78. The shadow-mode backstop and the webhook `trust proxy` mismatch remain open.

- **No `req.session.regenerate()` anywhere in `src/`.** Session id not
  rotated on login (session fixation class). Real, small fix.
- Cheap header hardening: `app.disable('x-powered-by')`, `nosniff`,
  anti-framing. **CSP is the one that can break the dashboard.**
- Shadow mode is enforced at each caller, not inside `gmail.js`
  `sendReply`/`sendNewEmail` (`gmail.js:433,456`). TC-side backstop gap.
- The webhook sub-app sets `trust proxy` to `true` (`webhook.js:526`) against
  the parent's `1`.
- **`casa-evidence/` is still untracked in git.** It is the record of what was
  claimed to an auditor while a review is open. Track it.

---

## COMMITS SHIPPED (all pushed to `main`)

| Hash | Closes | What |
|---|---|---|
| `139e99e` | 2.2.1 | Periodic sweep on the session store, evicting expired records whether or not their id is presented again. |
| `1fdfcb4` | 3.1.4 | Principal on session with `allowedAgents`. `requireAgentAccess` mounted **once** on the `/agent/:agentId` prefix. Fail-closed. **404 not 403**, body byte-identical to a nonexistent agent. |
| `9d3753d` | 6.7.1 | Secrets audit logging at the single `decryptToken` call site (`gmail.js:63`). |
| `e6acae2` | 6.5.1 | Login audit logging, success and failure, reason codes only. |
| `b9a02e9` | 2.2.1 | Idle **and** absolute timeouts as independent checks against `authenticatedAt` / `lastSeenAt`. |
| `68716ed` | 2.2.1 / 6.7.1 | Encrypted file-backed session store replacing MemoryStore. |
| `90ac5b7` | — | Session store log hygiene, plus a real sweep bug. **This is the scanned commit.** |

Tests 2496 → 2521.

**`rolling` was deliberately NOT set to true.** It converts the absolute
limit into an idle one, undermining 2.2.3, a **Pass** on the basis of the 12h
absolute cap.

## THE READING THAT GOT THIS RIGHT

**The Tester Comment is the objection. The Remediation column is generic
OWASP boilerplate auto-attached to any failed control.** Proof: row 33's
tester comment raised no objection at all yet carried a full remediation list
and a Fail status.

**TAC would not re-run their scan.** They directed an independent
authenticated scan with a free tool, which removed the $450 Burp Pro
purchase. The reviewer had agreed the controls were implemented and rejected
only the KIND of evidence.

**Two recon claims were wrong and correcting them is what made this cheap.**
`NODE_ENV` is read nowhere in `src/`, and `cookie.secure` is `'auto'`. Both
supposed blockers to a local scan were false, which is what let the whole
thing run on a laptop instead of a staging environment.

**Pre-emption is right when discovery is likely and a liability when it is
not.** Mo overruled a recommendation to pre-empt an express-session warning
the reviewer could never have seen. The header findings are the opposite case
— discovery is certain because we handed over the report — so they are
acknowledged in row 43.

## AFTER THE LOV ISSUES

Mo must reply **directly to Google's verification email in the existing
thread** or the process stalls there. Due-date extensions go through the LAB,
not Google.

**Sequencing, 2026-09-24.** TAC's Sept 23 email asks that Google not be contacted
while the LOV is under review. That forbids STARTING a conversation, not answering
one: wait for Google's email, then reply in that thread. If Google is silent past
Oct 1, the nudge goes to TAC.

**Closed 2026-09-28.** Google's approval arrived in the thread and asked for nothing, so no reply was needed.
