# STATE.md: where GetKlosed stands

Read this first. It is the short, current picture. Full history lives in `docs/history/`.
Last updated: session 81 (2026-10-02 to 2026-10-03).

## What GetKlosed is

A system for Ontario real estate agents, built on their own Gmail. It answers and follows up leads,
sends a daily brief by SMS and email, generates weekly content (a paid add-on), and runs a
transaction coordinator (TC) that tracks each deal's checklist, files deal documents to Drive, and
alerts the agent when something needs them. Mo runs the business and is the operator.

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
  proposal sets, and the `assistant@` verbs CONFIRM, REJECT and WRONGDEAL.
- Paying agents: none yet. TC deals in production: none yet.
- Production runs Node 18.20.8 (end of life); local development runs Node 22. See Parked.

## Spec status: how far to trust each spec

Where a spec and the code disagree, the code wins. These labels come from a session 81 check.

- `TC_SPEC.md`: current. Version 23, maintained through session 80. Session 81's alert design lives in this file (above), not yet folded into the spec.
- `DAILY_DIGEST_SPEC.md`: shipped as of session 17. The digest has changed since (hot-lead decay, the CALLED tap, noise counts, session 81's Sheet outcomes and operator alert). Background only.
- `REPLY_DETECTION_SPEC.md`: undated. Background only.
- `CONTENT_ENGINE_SPEC.md`: a session 18 design draft. The engine was built afterwards and differs. Background only.
- `LEAD_IMPORT_SPEC.md` and `OUTBOUND_TRACKING_SPEC.md`: both say "not built", but both are built (`src/leadImport.js`, `src/outboundTracking.js`). Design-era. Background only.
- `CONTENT_ENGINE_PROVISIONING_SPEC.md`: says "not built"; not verified since. Check the code before relying on it.

## Session 81: the TC alert foundation (on branch `session-81`, NOT yet merged or deployed)

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

### TC alert design, locked in session 81

- The daily brief's TC section shows exceptions only. The full picture of every deal comes once a
  week, inside the Monday brief.
- Rules (each fires only while its row is required and not done):
  condition heads-up 2 days before its date; condition passed 1 and 4 days after; deposit and
  additional deposit overdue 2 and 7 days after their date; a failed filing in the 24 hours before
  the brief. Stateless: each threshold fires once; the Monday picture is the backstop.
- Every alert will carry a "Got it" tap (`DONE` via `assistant@`) that ticks the item. A "fell
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

1. Merge `session-81` to `main`, deploy, and verify: a forced dry-run of the daily digest for
   `mo-test`, and a clean log line.
2. Finish the docs move: this folder, synced into the claude.ai Project from GitHub.
3. The "Got it" tap: the `DONE` verb on `assistant@`. Design note goes in `docs/designs/`.
4. The daily "Deals needing you" section: render the alerts with the tap, an email link and a Drive
   link; use the settled reader; an unreadable deal file gets an honest line.
5. Put one founding agent on the TC. Phase A convention: the agent forwards the accepted offer
   (APS); Mo opens the deal. Watch what lands in their inbox at acceptance (this designs Phase B).
6. Then: the Monday picture, and the proposal block (dormant until extraction feeds it).

Not on the shortest path: new product scope, the small-business side idea, Phase B deal detection.

## Parked (new in session 81)

- Fold session 81's alert design into `TC_SPEC.md` as version 24.
- Node 18 is end of life in production. Pin the Node version in the repo and move production to 22.
- Weekly digest: an agent whose Sheet was not read shows as a row of zeros, identical to a quiet
  agent. The weekly test setup never exercises a successful gather, so its totals and churn loops
  are untested.
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

## Session 81 notes for the record

- Claude prediction errors: seven mutation expectations under-counted or mis-stated (commit 1 m1
  and m3, 2b m1, 4a m1, 4d-1 parity cases, 8 m3, 8b m4); one arithmetic error on DST edge cases in
  a recon. Lesson: predict reds by asking which tests would see a different outcome, and remember
  that a test comparing two paths cannot see a rule removed from code they share.
- Recon 5 twice claimed something did not exist when it did. Rule since: a claim of absence must
  show its grep.
- Production verified: Node 18.20.8 with full ICU computes Toronto dates correctly.
