# STATE.md: where GetKlosed stands

Read this first. It is the short, current picture. Full history lives in `docs/history/`.
Last updated: session 89 (2026-10-19).

## What GetKlosed is

A system for Ontario real estate agents, built on their own Gmail. It answers and follows up leads,
sends a daily brief by email every morning and by SMS whenever something needs the agent, generates
weekly content (a paid add-on), and runs a transaction coordinator (TC) that tracks each deal's
checklist, files deal documents to Drive, and alerts the agent when something needs them. Mo runs
the business and is the operator.

The brief's SMS half follows one rule (Session 88): no text means we checked everything and nothing
needs the agent; any morning we could not see part of the picture sends a text saying what we could
not see.

## What is live in production

- Railway, deployed from `main`, at app.getklosed.ca. Agents on the Volume: `mo-test` (Mo's test
  agent), `assistant` (the command inbox), `welcome-sender` (sends the onboarding welcome email).
- Google OAuth verified 2026-09-28 for `gmail.modify` (restricted) and `drive.file`. CASA passed
  2026-09-21. Annual recertification and CASA revalidation due around September 2027.
- Lead side: Gmail intake, AI replies, follow-up sequences, hot-lead SMS, the daily agent brief, the
  weekly operator digest. Onboarding is passcode-gated; a dashboard exists for Mo.
- Content engine: built and running for `mo-test` in shadow mode. Remaining HARD GATE work waits
  for real agent voice samples.
- TC, Phase A foundations: deal store, full Ontario checklist catalog for six deal types, the
  resolver, the deal-open CLI, the document filing loop (inbox to Drive), participants and
  proposal sets, and the `assistant@` verbs CONFIRM, REJECT and WRONGDEAL. The `assistant@` taps
  DONE, RECEIPT and UNDO, live-verified 2026-10-06.
- Paying agents: none yet. TC deals in production: none yet.
- Production runs Node 18.20.8 (end of life); local development runs Node 22. See Next.
- Agent phones are validated at signup and on the dashboard edit; any failed agent text emails Mo
  (every hot lead, other kinds once a day); a welcome text goes out at signup and on a number change;
  cycles cannot overlap, and a cycle stuck 30 minutes restarts the process.

## Spec status: how far to trust each spec

Where a spec and the code disagree, the code wins. These labels come from a session 81 check.

- `TC_SPEC.md`: current. Version 23, maintained through session 80. Session 81's alert design lives in this file (above), not yet folded into the spec.
- `DAILY_DIGEST_SPEC.md`: shipped as of session 17. The digest has changed since (hot-lead decay, the CALLED tap, noise counts, session 81's Sheet outcomes and operator alert). Background only.
- `REPLY_DETECTION_SPEC.md`: undated. Background only.
- `CONTENT_ENGINE_SPEC.md`: a session 18 design draft. The engine was built afterwards and differs. Background only.
- `LEAD_IMPORT_SPEC.md` and `OUTBOUND_TRACKING_SPEC.md`: both say "not built", but both are built (`src/leadImport.js`, `src/outboundTracking.js`). Design-era. Background only.
- `CONTENT_ENGINE_PROVISIONING_SPEC.md`: says "not built"; not verified since. Check the code before relying on it.

## Session 89: brief copy fixes from the first live weekend, Commit A2

Tests 4174/173 to 4179/173. Branch `session-89`, not merged.

| Commit | What |
|---|---|
| `cd3c4f7` | The leads opener's total drops `noiseFiltered`: screened junk mail is no longer counted as "handled" leads. A noise-only night now reads "Leads: quiet overnight" instead of naming a filtered email as if it were a lead |
| `9321572` | "What the system handled": any row at zero is omitted, and the whole section (heading included) is omitted when every row would be zero. `noiseFiltered` and `noiseArchived` collapse into one line ("Emails screened out as not a lead: N (M moved out of your inbox)"), since archived is always a subset of filtered; the "Find them under the label agent-ai/noise" line is gated on `noiseFiltered`, not `noiseArchived`, since the label is applied to every screened email |
| `19f2e6a` | No em or en dashes in the daily brief: subjects read "Your morning brief: `<name>` needs you today" / "Your morning brief for `<date>`" (matching `dealsSubject`'s existing colon convention); plain-text section headers use "-- Title --" (matching `digestDeals.js`'s existing "-- Deals needing you --"); row separators use " - " |
| `fdc4faf` | Same treatment for the weekly digest to Mo. The dash scan over `src/digest.js` and `src/digestDeals.js` now returns zero |

Evidence: the three real `mo-test` briefs from the first live weekend (Oct 17-19) -- a noise-only
night read as if a lead had been filtered, and a quiet day printed four zero-count rows under a
heading that implied the system had done something.

DO NOT MERGE yet: this branch waits for the live check of Commit B (Session 88), running the
morning of 2026-10-20.

## Session 88: brief polish, Commit B (SMS only when something needs the agent)

Tests 4132/170 to 4156/171.

| Commit | What |
|---|---|
| `b0439dd` | `smsDecision(inputs) -> { send, reason }`, pure, the closed reason list: disabled, not_configured, dry_run_no_phone, needs_agent, couldnt_check, quiet. Fixes a reachable gap: a not_configured agent whose deals failed to load or came back unreadable used to go silent on SMS |
| `d4cf8f3` | Wired in, gating only the `twilio.sendSMS` dispatch; `renderSMS` still builds the body every morning. Uniform logging: "sms skipped (<reason>)" / "sms sending (<reason>)" |
| `f442bf1` | couldnt_check copy: Sheet-unavailable and deals-couldn't-load SMS lines made actionable; a new, additive unreadable-deal-file SMS line |
| `89f74c8` | Welcome text drops the implied daily cadence |
| `99e6898` | Pre-existing, separate from Commit B: the inactive-agent "skipped (inactive)" / "sms=n/a email=n/a" contradiction. The generic summary line is now suppressed whenever `result.skipped` is set |

The email brief is unchanged: it still goes out every morning exactly as before. Only the SMS half
of the daily brief gained a decision. The one send reason that can coexist with another: needs_agent
(an urgent lead or a deal alert) wins over couldnt_check when both apply, but couldnt_check's own
copy still renders in the body whenever its condition is true, regardless of which reason triggered
the send -- an unreadable deal file is additive with a real alert, never replaced by one.

Live check still open: nothing below has been watched on a real phone yet. Before a founding agent
relies on this, confirm a genuinely quiet morning produces no text, and that a couldnt_check morning
reads as intended on an iPhone.

Follow-up, same session, after the table above was written (missed by its own docs commit `b553017`
until now): every "Mo has been told" SMS and email line checked for honesty when the operator
config itself cannot be read.

| Commit | What |
|---|---|
| `33bbd35` | Drops "Mo has been told" from the SMS lines (Sheet unavailable, deals unavailable, unreadable deal files) when the operator alert that sentence promises cannot actually be sent |
| `7377b61` | `operatorAlertReachable` made total: wrapped so a malformed or missing operator config (`loadOperator` returning `null`, `undefined`, or an object with no `operatorEmail`) returns false instead of throwing. The same honesty check carried into every matching email line (`dealsErrorPlain`, `dealsErrorHtml`, `unreadableLine`, the Sheet-unavailable email) |
| `67ad2ec` | `resolveOperatorEmailForDeals` guarded the same way (never throws, falls back to the operator contact address). Precision fix on `alertOperatorSheetUnavailable` and `alertOperatorDealsUnavailable`: a `null` operator config now reports `no_operator_email` instead of the generic `error` (both functions already had an outer try/catch, so this was never a crash risk, only a reporting one) |

## Session 87: brief polish, Commit A (copy and layout only)

Tests 4116/170 to 4130/170.

| Commit | What |
|---|---|
| `823d0e6` | `pluralize(n, singular, plural)`; fixes "1 leads" and "1 follow-ups" in the opener line |
| `42c1eb1` | The leads opener reads "Leads: handled N overnight (...). None need you."; renderSMS puts the deals line ahead of the leads lines; "+ N more." names what it counts ("deals" or "leads") |
| `aa09926` | `SYSTEM_HANDLED_LABELS`: pre-flight skips dropped from the agent brief (stays in the weekly operator digest); "Noise filtered"/"Noise archived" reworded; "Leads intaken" to "New leads" |
| `69f9b69` | Every Gmail web link in the brief replaced with plain text the agent can act on in any mail app; `gmailSearchUrl` deleted (no callers left) |
| `7b9e9b8` | Leads opener omits zero-count parts from the parenthetical; a fully quiet night reads "Leads: quiet overnight" instead of naming zero of everything. Urgent branches untouched |

Recon found the item list in the prior session's Next section had one false claim: the per-deal
email-search link was said to be "already removed, session 85." It was not; it was built in session
84 (`d5ce367`) and still live going into this session. `69f9b69` removes it for real. The correction
is folded into the note above where that claim originally appeared.

Scope for this session: rendering only. No change to whether, when, or to whom anything sends. The
SMS-only-when-something-needs-the-agent change, the filtered-items-inline idea, and the confirmation
reply subject were all identified during recon as needing either a design decision or a data change
beyond rendering, and were left out on purpose; see Next and Parked below.

## Session 86: lead intake skips our own system senders; Track 2 reads subject and body, without quoted history

Tests 4099/170 to 4116/170.

| Commit | What |
|---|---|
| `baa1e44` | Rule 0b in `applyPreFilter` (`src/leadIntake.js`): any sender whose address domain is exactly `getklosed.ca` is pre-filter-blocked before classification, address only, never the display name |
| `5561789` | Track 2: skip the classifier when subject and body are both empty (was an Anthropic 400, then "didn't understand") |
| `f7a1873` | Track 2: strip quoted reply history before classifying; `src/replyText.js` (`stripQuotedReply`), extracted unchanged from digest.js's Shadow Mode catch detection |
| `1e5eb11` | Track 2: classify subject and body as labelled input, Re:/Fwd: stripped for classification only; ask "Which lead did you mean?" when a lead intent has no name |

Bug: assistant@'s DONE/RECEIPT/UNDO/CONFIRM/REJECT/WRONGDEAL/Track 1/Track 2 confirmations and the
onboarding welcome email (sent from `mohanad@getklosed.ca`) carry no In-Reply-To header and passed
every existing pre-filter rule, so lead intake could classify one as a new lead (a phantom Sheet
row) or archive it as noise before the agent ever saw it.

Latent on `mo-test`: every confirmation so far was read before the next intake cycle ran. Would
have hit any agent who left one unread.

Live-verified 2026-10-14: log line "pre-filter blocked ...: system sender", candidates=0, the reply
stayed in the inbox unread, no Sheet row written.

Track 2 live-verified 2026-10-14: a subject-only "pause follow-ups for Zed Nobody" with an empty
body got "No lead found matching 'Zed Nobody'" (Haiku read the subject; nothing changed).
Why the quote strip mattered: a reply to our own "didn't understand" email handed Haiku our
command menu ("pause or resume your account...") as if the agent wrote it.

## Session 85: overdue alerts fire once, on or after their threshold; the heads-up window widens to the day before and the day of

Tests 4048/170 to 4099/170.

| Commit | What |
|---|---|
| `a014592` | Condition heads-up fires the day before and the day of (daysUntil 1 or 0), not only 2 days before |
| `eb126cc` | `agentState.js`: a record of which TC deal alerts have already been delivered, per deal, pruned to active deals |
| `1b83421` | Overdue rules (deposit, additional deposit, condition passed) fire on the first brief on or after each threshold, once, using the delivered record; wired into the brief |
| `5c4598a` | `opened_in_error` terminal state on all six tables; `dealClosedReplyBody`'s reply case; the `mutual_release` pin test |
| `c6a9af0` | `transition-transaction.js`: `--reason` required for every terminal state except `closed`, rule-based via `isTerminal` |

Decisions:
- Condition heads-up: the day before and the day of, "due tomorrow" / "due today"; the 2-day heads-up removed. Mo's field call.
- Overdue rules (deposit, additional deposit, condition passed) fire on the first brief on or after each threshold, once; missed thresholds collapse into one alert with the real day count. Reverses session 81's "stateless by design": exact-day matching silently lost alerts for deals opened late or briefs that failed to send.
- Delivered record lives in the agent state file, grouped by deal, not in the deal file: the brief never writes compliance records, so it cannot race taps or filings.
- Keys include the governing date, so an amended condition or deposit date starts fresh.
- Recorded only after the EMAIL sends (the SMS lists only the top alert); never when deals could not be loaded ('error'); 'unreadable' still records and unreadable deals keep their history.
- today is computed inside the deals try: a bad timezone fails deals only, never the lead brief.

Live check status:
- Done 2026-10-09: the deals section renders on a real phone, counts the active deal, no false alert.
- PASSED 2026-10-10: LIVE TEST 2 alerted, in the SMS, the subject and the deals block; LIVE TEST 1 was correctly absent on day 4.
- Commits 1 to 4 merged to `main` at `136083c` on 2026-10-10.
- PASSED: Sunday 2026-10-11, both deals alerted (LIVE TEST 1 catch-up at day 5, LIVE TEST 2 repeat as predicted). Monday 2026-10-12, neither appeared. Tuesday 2026-10-13, LIVE TEST 1 alerted at day 7 and LIVE TEST 2 was silent. Catch-up, the delivery record and the next threshold are all verified live.

Finding (2026-10-10): the "Emails about <address>" link in the brief does nothing when tapped in
the Gmail iOS app; long-press shows a mail.google.com link that lands on a Google marketing page
when not signed in. Not a wrong-account risk only: tapping any link back into Gmail does nothing
inside the Gmail iOS app, so this covers every mail.google.com link in the brief, including the
lead thread link (`digest.js:143`). Decision (Mo, 2026-10-10): replace every Gmail web link in the
brief (the per-deal email search, "Review archived noise", the lead thread link) with plain text
the agent can act on in any mail app, e.g. "Search your inbox for: <address>" and the noise label's
name.

Notes for the record:
- Moving a computation out of a try block also moves its failure out of that block's fault
  isolation; check what can throw before hoisting.
- A sent SMS is not proof of delivery when the SMS summarizes; record delivery against the surface
  that carries everything.
- A jest auto-mock returns undefined for any new function on the mocked module; grep every
  jest.mock of a module before adding a required read from it.

opened_in_error: recon done, design locked, BUILT session 85 (`5c4598a`, `c6a9af0`).

Recon: absent from src/ and tests/. isTerminal is table-driven (states.js), so the matcher, deal
alerts, alertsForTransaction and transition-transaction.js's target validation handle a new
terminal state automatically. Three hand changes needed: dealClosedReplyBody (actionHandler.js)
throws on an unknown terminal state; transition-transaction.js requires --reason only for collapsed
and terminated; the mutual_release terminalOnly gate (resolver.js:108) checks state === 'collapsed'
by string.

Decisions (Mo, 2026-10-09):
a. opened_in_error is a new terminal state on all six types, reachable from every non-terminal
   state, no outgoing edges. Operator-initiated on the agent's request, never system.
b. --reason is required, so the history explains itself ("duplicate of txn-...", "wrong address").
c. DONE tap reply: "Nothing was changed. The file for <address> was opened by mistake and is no
   longer tracked."
d. Documents already filed to its Drive folder stay where they are; Mo moves them by hand. The
   system never moves or deletes filed documents.
e. A test pins mutual_release as absent on closed, terminated and opened_in_error (today that is
   luck, not design).

The --reason rule became "every terminal state except closed" (rule-based via isTerminal, so a
future terminal state requires a reason by default, not named by hand). The previously untested
terminated-without-reason case is now tested.

Live-verified 2026-10-13 on Railway: no --reason refused; dry run previewed and changed nothing;
--yes wrote state opened_in_error with the reason in the state_transitioned event; a RECEIPT tap
from an old brief got the opened-by-mistake reply from assistant@. Both LIVE TEST deals
(`txn-20261008-fa6b84f9`, `txn-20261009-5e534d51`) are now `opened_in_error` with reason "live test
deal".

Build plan: commit 5 = the state in all six tables + the reply case and its test.each row + the
mutual_release pin test (one commit, so the branch never has a state whose tap crashes); commit 6 =
--reason required; commit 7 = STATE.md and TC_SPEC 7.47.1 marked built.

## Session 84: Deals needing you (the TC alert pipeline reaches the daily brief)

Tests 3404/163 to 4048/170. Merged to `main`, not yet deployed.

| Commit | What |
|---|---|
| `f7b9e4c` | The deal alert aggregator (`src/transactions/dealAlerts.js`), danger-ranked and per-deal fault-isolated |
| `235d5dd` | One shared module for DONE/RECEIPT/UNDO subjects and links (`src/transactions/tapLinks.js`, `src/assistantAddress.js`) |
| `d5ce367` | Pure Drive, Gmail search and fell-through link builders for a deal |
| `ca1c14d` | Plaintext and HTML renderers for the deals needing you section, grouped by deal |
| `9df3f2e` | The SMS deals line and the deals subject line |
| `e41684a` | Wired the deals section into the daily brief: deals above the opener, the no-Sheet skip rules, `src/operatorAddress.js`'s fallback |
| `a8b6c67` | Email Mo when an agent's deals could not be loaded |
| `6ef09f1` | Every state change now records a `state_transitioned` event; `scripts/transition-transaction.js`, the operator command to move a deal's state |

Live-verified 2026-10-08: the tap module move itself changed nothing observable -- DONE, RECEIPT
and the Undo link all tapped from a real reply, on an iPhone, subject intact. NOT yet live-verified:
the brief's deals section on a real phone. A deposit alert deal is seeded on `mo-test` for the next
morning's brief (`txn-20261008-fa6b84f9`); it must be removed after the check. Also open for that
same check:
- Whether Gmail search treats the hyphen as a separator (a search for "21 main" finding a thread
  about "19-21 Main"). Not about the per-deal email-search link: this is about Gmail's own search
  matching, which still applies to whatever search text the agent types by hand. Correction (session
  87): this note previously said the per-deal email-search link was already removed in session 85.
  It was not; session 85 touched only the alert thresholds and heads-up window (see that section's
  own commit list). The link was still live, built in session 84 (`d5ce367`), until session 87 removed
  it for real (`69f9b69`, see below).

## How Mo collapses or closes a deal

1. Copy the transaction id from the agent's fell-through email body (the line reading `Deal: txn-...`).
2. Run `scripts/transition-transaction.js` with `--reason` as a dry run (no `--yes`).
3. Confirm the address in the preview is the right deal.
4. Run it again with `--yes` to write.

`--reason` is required when moving to any terminal state except `closed`; optional for `closed` and
every non-terminal move.

## Session 83: the DONE verb (DONE, RECEIPT, UNDO on `assistant@`)

Tests 3315/161 to 3404/163. Merged to `main` and deployed; live-verified 2026-10-06.

| Commit | What |
|---|---|
| `c052ea2` | docs: DONE verb design note (the alert tap states the fact it records) |
| `3ca8f2f` | `markItemComplete` refuses an item that is already complete |
| `0d0b617` | `chainEndingAt`: one chain lookup shared by the alerts and the RECEIPT tap |
| `d47584c` | Pure builders for completing and uncompleting an item; the checks live in the builders |
| `cb3c8f5` | docs: corrected the double-end finding in the DONE design note |
| `deb0bb7` | `taps.js`: one-save DONE, RECEIPT and UNDO compositions, outcomes only, never a partial write |
| `b2221c2` | docs: completedAt is the message date, every event's `at` is processing time, matching CONFIRM |
| `e289cf8` | `assistant@`: DONE, RECEIPT and UNDO verbs live, with a real Undo link on every completed reply |

Live check on a seeded `mo-test` deal: DONE on a fresh item; RECEIPT on a partial deposit chain;
the Undo link tapped from the reply, on an iPhone; DONE again on the same item, already done;
DONE on an unknown item, with its operator note; and "Done with the showing" reaching Track 2, not
the verb. Seed deal removed.

## Session 82: phone validation, text-failure alerts, welcome text, cycle guard

- Session 81's deploy verified live: the brief sent by SMS and email, no digest failures, no false
  Sheet alert.
- `unella-bolton` (the agent Google's reviewer created during OAuth review) deleted from the Volume.
- Railway's restart policy set to Always (the cycle-guard watchdog in this session depends on it).

Tests 3210/150 to 3315/161. Merged to `main` and deployed; verified live 2026-10-05: cycle-guard
lines every cycle, no orchestrator cycle error in a week, welcome text received.

| Commit | What |
|---|---|
| `179e71f` | docs: agent phone design note (valid at signup, loud when a text fails) |
| `b61a900` | `agentPhone.js`: `normalizeAgentPhone` turns North American numbers into +1 plus 10 digits |
| `066666c` | Onboarding and dashboard refuse phone numbers Twilio cannot text; onboarding stops writing per-agent `operatorPhone` |
| `efc1471` | Text-failure alerts: email Mo when an agent text fails (every hot lead, other kinds once a day) |
| `979883c` | Welcome text: sent in the background at signup and on a dashboard number change; the done page says it's on its way |
| `508320d` | Cycle guard: skip a tick while a cycle runs; a watchdog restarts the process when a cycle is stuck 30 minutes; the weekly digest counts restarts |

## Session 81: the TC alert foundation (merged to `main` and deployed at `720f007`)

Tests 2938/144 to 3210/150. Every commit reviewed from the raw diff before committing.

| Commit | What |
|---|---|
| `fa0c7ad` | Condition names are a closed list; `conditions` is validated |
| `4c2fe60` | `createTransaction` refuses `facts`, `items` and `events` |
| `389ea9b` | `omitWhenDoubleEnded`: paired-side steps that are the same step on a double-end are left out |
| `0f96126` | One deposit chain across all four deal types (holding side and paying side) |
| `9346261` | `src/calendarDate.js`: a calendar-date validator that refuses rollover dates |
| `fc25b22` | Date facts: `acceptedDate`, `conditionDates`, `additionalDepositDueDates` |
| `5599282` | Additional deposit receipt item, sales only |
| `35c1d55` | `set-fact` parses object values |
| `86b031b` | `checkFact`: setFact's rules without the write, with a parity test |
| `c47294e` | Deal-open takes conditions, dates and the additional deposit |
| `b0e2614` | Every remaining fact has a closed vocabulary |
| `1f3092f` | Deal-open takes the three APS facts (self-represented, entity, representation) |
| `d7bc9ba` | Today in the agent's timezone, and day counting on calendar dates |
| `bd10632` | The alert rules, as a pure module (`src/transactions/alerts.js`) |
| `1d6b110` | `readAllTransactionsSettled`: one bad deal file cannot blank the others |
| `726ec57` | Digest: a permanent Sheet failure no longer blanks the brief (four outcomes) |
| `3a77336` | Digest: the operator is emailed when an agent's Sheet cannot be read |
| `6d2ce4b` | `CLAUDE.md`: the standing instructions for building in this repo |
| `720f007` | docs: move the project docs into the repo, with a current STATE.md |

### TC alert design, locked in session 81

- The daily brief's TC section shows exceptions only. The full picture of every deal comes once a
  week, inside the Monday brief.
- Rules (each fires only while its row is required and not done):
  condition heads-up 2 days before its date; condition passed 1 and 4 days after; deposit and
  additional deposit overdue 2 and 7 days after their date; a failed filing in the 24 hours before
  the brief. Stateless: each threshold fires once; the Monday picture is the backstop.
- Superseded by `docs/designs/done-verb.md`: the tap states the fact it records, not "Got it" --
  "Waived or fulfilled" for a condition, "Deposit received" for an additional deposit, the stuck
  step's own label for a deposit step, and "Receipt in hand" for the whole deposit chain. A "fell
  through" response emails Mo instead, because a collapsed deal cannot be undone.
- The deposit is a three-step chain, the same on leases and sales. The receipt closes it. On a
  double-end only the holding side applies. Additional deposits: sales only in v1, at most one.
- The facts map holds only dates a person stated; a system writer is refused for dates.
- Blanks are allowed but never silent: deal-open prints what is still unanswered.
- Deal-open: one command answers everything from the APS. Example:
  `node scripts/open-transaction.js <agent> buyer_purchase conditional --address "12 Main St" --accepted 2026-10-01 --condition financing=2026-10-06 --no-additional-deposit --no-self-represented --entity individual --representation single`
- Sheet outcomes in the digest: ok; not configured (no warning, nothing sent if nothing to say);
  unavailable (honest line to the agent, an email to Mo); anything else retries.

## Next: the shortest path to a founding agent

1. Brief polish batch, Commit A (copy and layout only, Session 87): pluralization fixed ("1 leads"
   to "1 lead", "1 follow-ups" to "1 follow-up"); the leads opener now reads "Leads: handled N
   overnight (...). None need you." as its own statement (no cross-block suppression against the
   deals block's own "nothing needs you today"); the deals block and the SMS deal line now render
   before the leads lines in the SMS (email already had the order right); the SMS "+ N more." now
   says what it is counting ("+ N more deals." on the deals line, "+ N more leads." on the hot-lead
   line); "Pre-flight skips" dropped from the agent-facing brief, stays in the weekly operator
   digest unchanged; "Noise filtered" and "Noise archived" reworded to say what each mechanism
   actually does; "Leads intaken" to "New leads"; every Gmail web link in the brief (the per-deal
   email search, "Review archived noise", buildActionLink's thread fallback for HOT, needs_review
   and path1b) replaced with plain text the agent can act on in any mail app. The per-deal search
   link had NOT already been removed (see the correction above); it is now. Commits: `823d0e6`,
   `42c1eb1`, `aa09926`, `69f9b69`.
   Commit B (behavior, Session 88): Done. SMS only when something needs the agent -- see Session 88
   above for the invariant and the commit list. The email brief is unchanged.
   Commit A2 (copy, Session 89): Built, not yet merged -- see Session 89 above. Waits for the Commit
   B live check before merging, since both touch the same send path on the same morning.
   Still open, not part of any commit batch: filtered items listed inline when few (parked below,
   needs a capture design first); a human-readable confirmation reply subject (parked below, a real
   threading risk found during Commit A's recon). Sender move to `assistant@getklosed.ca` pulled out
   of this batch: needs (a) lead intake skipping our own getklosed.ca senders, now done (Session 86),
   and (b) a decision on what a reply to the brief itself should do -- today it would fall into
   Track 2, not anything brief-aware.
2. Live check: Done (Session 85/86, see above).
3. `opened_in_error` exit state: Done -- built and live-verified (Session 85/86, see above).
4. Move production from Node 18 to 22 (recommended before a real agent's deals are on the system).
5. Put one founding agent on the TC. Phase A convention: the agent forwards the accepted offer
   (APS); Mo opens the deal. Watch what lands in their inbox at acceptance (this designs Phase B).
6. Then: the Monday picture, and the proposal block (dormant until extraction feeds it).

Not on the shortest path: new product scope, the small-business side idea, Phase B deal detection.

## Parked

- Three one-off full-suite test failures across two sessions, every one in a file untouched by that
  session's own changes, every one passing standalone and on an immediate full-suite rerun:
  `tests/sessionStore.encryption.test.js` (session 87, once) and `tests/dashboard.loginAudit.test.js`
  (session 88, twice). Treating this as one suspected shared cause, not three coincidences: parallel
  Jest workers, a shared temp directory, or a timer/interval not cleaned up between runs.
  `dashboard.loginAudit.test.js` flaking twice in the same session is the stronger signal; worth a
  dedicated investigation (not attempted here, and not blocking Commit B).
- List filtered emails inline in the brief when there are only a few (Session 87 recon, item 5).
  Needs a capture design first: `dailyNoiseFiltered`/`dailyNoiseArchived` (`agentState.js`) are bare
  incrementing counters, no sender, subject or lead identity stored alongside them, so there is
  nothing to list yet. Not pure rendering; out of Commit A's scope on that basis alone.
- A human-readable confirmation reply subject, replacing the raw machine text ("Re: RECEIPT
  txn-... brokerage_deposit_receipt_received") the agent sees today (Session 87 recon, item 9).
  Deferred: `sendConfirmation` sends via `gmail.sendNewEmail`, which never sets threadId,
  In-Reply-To or References (confirmed by reading `buildRfc5322Message`, `gmail.js`), and neither
  does the agent's own original tap (a fresh `mailto:` compose, not a reply). Whatever groups the
  tap and its confirmation into one conversation on Gmail and the iPhone today is Gmail's own
  subject-plus-participants heuristic, which depends on the confirmation's subject matching the
  tap's subject (minus "Re:"). A human-readable subject would very likely break that grouping,
  splitting the tap from its own confirmation in the agent's inbox. Not verifiable from code alone;
  needs a live check before it is safe to change. See the next item, which would remove the
  dependency on that heuristic entirely.
- Thread the confirmation reply under the agent's original tap for real: send it with `threadId`
  (and `In-Reply-To`/`References`) the way `gmail.js`'s `sendReply` already does, instead of
  `sendConfirmation`'s current `gmail.sendNewEmail`. Would remove the subject-matching dependency
  above and make a human-readable subject safe to ship. Revisit together, after a founding agent is
  on the system (same gate as the sender move to `assistant@getklosed.ca` in Next, item 1).
- Fold session 81's alert design into `TC_SPEC.md` as version 24.
- An inactive agent logs "skipped (inactive)" followed by "sms=n/a email=n/a" every cycle for about
  an hour after its brief time, and the second line contradicts the first.
- Pre-existing, kept as-is by session 82's reminder-branch split: when the reminder text sends but
  the Sheet write fails, `reminderSent` is never recorded, so the reminder is sent again every cycle
  until the Sheet recovers.
- The onboarding done page writes the agent's name and Gmail address into the page unescaped (only
  the person who typed them sees it).
- The 30-minute watchdog assumes no healthy cycle runs that long. Watch the "cycle finished in Nm"
  log line; past about 15 minutes, move heavy weekly work (content generation) out of the main cycle.
- Weekly digest: an agent whose Sheet was not read shows as a row of zeros, identical to a quiet
  agent. The weekly test setup never exercises a successful gather: its mocked agentConfig module is
  missing isInboxCleaningEnabled, so every gather throws (visible as "gather failed ...
  isInboxCleaningEnabled is not a function" in the test output). Adding it to the mock is the likely
  fix.
- No brief at all for a whole morning (a transient error lasting the window) alerts nobody. Needs a
  small piece of state; then an SMS to Mo.
- Test fixtures that hand-list catalog rows (`tests/transactions-transitions.test.js`) break every
  time the catalog grows; derive setup from the catalog instead.
- Structural test: an item's `reads` is non-empty if and only if it has a `requiredWhen`.
- Stale header comments in `buyerPurchase.js` and `sellerSale.js`.
- `setFact` accepts `conditions` on non-sale types (deal-open refuses it).
- `createTransaction` still accepts `filings`, `participants` and other maps (fixtures rely on it).
- `tests/transactions-queries.test.js` builds `participants` as an array and `filings` flat.
- `--listing-id` and `--unit` given as the last argument are silently dropped.
- The store's timestamp validator accepts rollover dates (machine-written only, low risk).
- The digest scheduler's timezone code is duplicated three times; 'America/Toronto' is repeated as
  a literal; three ad-hoc day counters remain outside `calendarDate.js`.
- Suspension windows are designed but not built (matters for a future listing-expiry alert).
- What happens to a document that arrives before its deal exists, and a "this looks like a new
  deal" nudge to Mo. A `--deposit-received` flag on deal-open.
- Domain question for Mo: trusts and estates (`other_entity`) may need a separate FINTRAC entity
  record that the catalog does not have.
- `scripts/complete-item.js` defaults actor to `'agent'`, so Mo's own CLI completions are recorded
  as the agent's; deal-open correctly records `'operator'`.
- Catalog labels mix Title Case (the deposit steps) and sentence case (the deal sheet); agents see
  both in one reply.
- An undone row keeps its `completedAt` and `note` with `completed: false` (by design, so the
  history is kept); any reader must key on `completed`, never on a date or note being present.
- A dated "latest activity" line per deal in the Monday picture, and a STATUS verb on `assistant@`
  returning one deal's one-pager on demand. Both after a founding agent is on.
- `parseAddress` loses the street type when the address string contains "#<unit>" ("12 Main Street
  #4" parses as street "main street 4"). This also affects address matching for filing. Convention
  until fixed: units always go in `--unit` at deal-open, never inside `--address`.
- After a deal collapses, the matcher stops attaching documents to it, but a collapsed deal still
  produces paperwork the brokerage needs on file (mutual release, deposit return direction). Needs
  a design.
- Open proposal sets and queued filings are not gated on deal state: a set on a collapsed deal
  stays confirmable, and a queued document still files to its Drive folder. For opened_in_error this
  means a document matched minutes before the deal is marked can still upload to the wrong folder;
  small window (drain runs every 5 minutes), and gating needs its own design because a collapsed
  deal SHOULD still file its mutual release.
- The deals-unavailable email is per agent with no rollup: one systemic fault touching many agents
  sends Mo one email per agent per morning.
- If an agent's operator config cannot be loaded, the deals-unavailable email cannot be sent, and
  the agent's "Mo has been told" is untrue that morning. Logged as "deals alert NOT sent: reason=...".
- `headsUpDueWord` returns 'today' for any daysUntil other than 1; adding a heads-up threshold back
  requires changing its wording (test f in transactions-alerts covers it).
- Folding session 81's alert design into `TC_SPEC.md` v24 now also includes session 85's changes.
- `stripQuotedReply` does not handle Outlook's reply format (a "From: ... Sent: ..." header block,
  no ">" and no "wrote:"), so the quote reaches Haiku. Pinned by a test. Ask the founding agent
  which mail app they use; if Outlook, this moves up.
- `stripQuotedReply` mishandles bottom-posting: the "on ... wrote:" cut also removes new text typed
  below the quote. Fails safe in Track 2 ("didn't understand"). Inherited from digest.js.
- The "on ... wrote:" match is not anchored to the start of a line, so "pause follow-ups on Sarah,
  she wrote: ..." is cut at "on Sarah" and the lead name is lost. Fails safe ("which lead" or "no
  lead found").
- Reply Detection logs "unmatched sender" every cycle for an unread assistant@ confirmation.
  Harmless (left unread, correct), only log noise.
- `pause_account` acts on a single classification with no confirmation. A false positive silently
  stops the agent's follow-ups. Consider a confirm-reply step before a founding agent uses
  assistant@.

Carried from earlier sessions (details in `docs/history/PROJECT_STATE_to_session_80.md`, section 7
and the session 80 board): 7.58.1 to 7.58.14, 7.57.5 to 7.57.12, 7.56.x, 7.54.x, the `listingId`
adoption trap, `WEBHOOK_SKIP_SIGNATURE_CHECK` removal, 7.49.4.

## How we work

- `CLAUDE.md` is the rulebook for building. Two levels of care: full care for anything that sends,
  writes agent data or runs on the scheduler; light care for pure logic, tests and docs.
- Claude Code builds and keeps `docs/STATE.md` current as part of each milestone.
- The claude.ai Project syncs `docs/` and `CLAUDE.md` from GitHub, so the chat always knows the
  current state. The chat is for strategy, sales, design decisions and reviewing risky changes.
- Mo commits, pushes and deploys. Nothing reaches production without his review of the raw diff.
- After each push to `main`, sync the claude.ai Project's GitHub source by hand, or the next chat
  starts a session behind.

## Session 81 notes for the record

- Claude prediction errors: seven mutation expectations under-counted or mis-stated (commit 1 m1
  and m3, 2b m1, 4a m1, 4d-1 parity cases, 8 m3, 8b m4); one arithmetic error on DST edge cases in
  a recon. Lesson: predict reds by asking which tests would see a different outcome, and remember
  that a test comparing two paths cannot see a rule removed from code they share.
- Recon 5 twice claimed something did not exist when it did. Rule since: a claim of absence must
  show its grep.
- Production verified: Node 18.20.8 with full ICU computes Toronto dates correctly.
