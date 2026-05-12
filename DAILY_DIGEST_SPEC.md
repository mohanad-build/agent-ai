# Daily Digest Spec

Session 15 design. Companion to `REPLY_DETECTION_SPEC.md`.

Module: `src/digest.js`. Two entry points, one module: per-agent daily brief and operator weekly digest. Shares data-gathering helpers across both.

---

## 1. Scope

The Daily Digest module produces two distinct surfaces:

1. **Per-agent daily brief** — every paying agent receives one each morning. Two outputs per send: an SMS (the hook) and an email (the full breakdown). Designed around "what the system handled for you while you slept," not "what you need to do today."
2. **Operator weekly digest** — Mo receives one each Sunday morning. Email only. Aggregates across all agents. Includes per-agent breakdown so churn risk is visible per account.

What this module is NOT:
- An activity log. The morning brief is the emotional hook; the activity log is column L in the Sheet.
- A replacement for real-time alerts. HOT signal SMS, needs_review email, and CALLED/RESUME flows still fire in real time.
- A reporting tool. It's a habit — read every morning, trust over time.

---

## 2. Sending logistics

| | Daily per-agent | Operator weekly |
|---|---|---|
| Default time | 7:00 AM local | Sunday 8:00 AM local |
| Configurable | Per-agent override in `agentConfig.digestTime` | Per-operator override in operator config |
| Channels | SMS + email | Email only |
| Recipient | Agent's own email + agent's own phone | Operator's email (Mo, today) |
| From address | Agent's own Gmail (via existing OAuth) | Operator's own Gmail (via existing OAuth) |
| Time zone | `agentConfig.timezone`, default `America/Toronto` | Operator timezone, default `America/Toronto` |
| Coverage window | Trailing 24h (previous 7am → this 7am) | Trailing 7 days (previous Sunday 8am → this Sunday 8am) |

**No Resend, no operations email, no transactional service this session.** Both digests self-send from existing Gmail OAuth tokens. Sunset: revisit when first paying agent onboards (see parked operations-email item).

**No open-rate tracking pixel.** Churn signals are action-based (see §6). Gmail-to-Gmail self-sends are not a meaningful open-rate signal anyway.

---

## 3. Per-agent daily brief — SMS

**Format goal:** demonstrate value every day, even on slow days. Never undersell.

### 3.1 Structure

One concatenated SMS (Twilio handles segmentation). Three lines:

```
Line 1: <emoji optional> Handled <N> overnight: <quick stats>
Line 2: <urgent flag, if any>
Line 3: Full brief in your inbox.
```

### 3.2 Examples

**Active morning, one urgent item:**
```
Handled 8 leads overnight: 3 new, 2 follow-ups, 1 filtered.
🔥 Sarah K (45 Maple) wants to call you today.
Full brief in your inbox.
```

**Active morning, multiple urgent items:**
```
Handled 12 leads overnight: 4 new, 5 follow-ups, 3 filtered.
🔥 Sarah K wants a call today + 2 more need you.
Full brief in your inbox.
```

**Quiet morning, no urgent items:**
```
Handled 12 leads overnight: 0 new, 5 follow-ups, 7 filtered. 0 need you today.
Full brief in your inbox.
```

**Critical:** quiet mornings still send an SMS, but the framing is "here's the work the system did," not "nothing happened." This is the explicit answer to the concern that quiet SMSs would erode perceived value.

### 3.3 "Handled overnight" stats — what counts

Trailing 24h window. Counts derived from:

- `<new>` — new lead rows created by Lead Intake in the window
- `<follow-ups>` — follow-up fires in the window from `src/followUp.js` (any Day 3/7/14 touch that successfully sent)
- `<filtered>` — emails Lead Intake processed and classified as `noise` or `business_correspondence` in the window (the invisible work — this is what the SMS uses to fight the "nothing happened" perception)

### 3.4 Urgent flag — what triggers naming

The SMS names the top urgent item if any exist. Definition of "urgent" (any of):

- A row in status `HOT` or `needs_review` with no agent action since the trigger event
- A row in `awaiting_agent` (Path 1B pending question) older than 24h with no agent SMS reply
- A row where `operatorEscalated` (column S) is set within the window

**Ranking:** if multiple urgent items, name the most recent one first by trigger timestamp. Append `+ N more need you` if N ≥ 1.

**Format of the named item:**
```
🔥 <FirstName> <LastInitial> (<short context>) <verb phrase>.
```

Examples:
- `🔥 Sarah K (45 Maple) wants a call today.`
- `🔥 John D (HOT signal) needs you.`
- `🔥 Mike T (Path 1B 26h) is waiting on you.`

Short context is derived from path/category:
- HOT signal → `(HOT signal)`
- Path 1B awaiting agent → `(Path 1B Nh)` where N is hours elapsed
- needs_review → property reference if available, else `(needs review)`

If no urgent items, line 2 of the SMS is omitted and the stats line ends with `0 need you today.`

---

## 4. Per-agent daily brief — email

The full breakdown. Sent immediately after the SMS.

### 4.1 Structure

```
Subject: Your morning brief — <weekday>, <date>

<opener line, same as SMS line 1 verbatim>

— Needs you today —
<urgent items, full detail. Empty section if none.>

— Hot leads to call today —
<HOT-status rows. Each row: name, contact, last touch, why hot.>

— Possible new leads to review —
<Tier 2 mid-confidence rows created in the window with aiEnabled='FALSE'.
Each row: name, contact, source email subject, why flagged for review.>

— Follow-ups due today —
<Rows in awaiting_response where the next-touch eligibility window opens today.
Each row: name, days since last touch, which touch (Day 3/7/14), property reference.>

— Follow-ups fired overnight (shadow drafts) —
<Rows where a follow-up fired during the window.
Each row: name, which touch, link to draft in inbox.
Only present in Shadow Mode.>

— What the system handled —
<Counts: leads intaken, noise filtered, business_correspondence ignored,
HOT alerts sent, needs_review escalations, Path 1B SMS round-trips completed,
follow-ups fired, pre-flight skips (agent did it manually).>

— Reliability —
<Counts: threading-skipped follow-ups, errors, retries. Empty section if zero.>
```

### 4.2 Section rules

- **Empty sections are omitted** with a single exception: "What the system handled" always renders (zero-state framing reinforces value).
- **Section ordering is fixed.** Urgent first, action-needed sections next, system-work sections last. Agent should be able to read top-down and stop at any point with the most important things already covered.
- **Each row in actionable sections is one line** with the key fact bolded. Plain text email; no HTML tables. Optimized for mobile reading.
- **Links into the Sheet:** each row includes the Sheet row anchor as a clickable hyperlink (`#gid=0&range=A<rowIndex>`).

### 4.3 Subject line

`Your morning brief — <weekday>, <date>` on quiet days.
`Your morning brief — <FirstName> needs you today` on days with at least one urgent item. Subject pulls the same top urgent name as the SMS.

---

## 5. Operator weekly digest

Trailing 7 days (Sunday 8am → Sunday 8am). Email only, to Mo.

### 5.1 Sections

```
Subject: Weekly digest — <date range>

— Aggregate stats —
Leads handled across all agents
Average response time (lead reply → system action)
Warm-to-tour conversion rate (in_conversation → tour-booked, if tracked)
Total touches fired
Total filtered (noise + business_correspondence)
Total escalations (needs_review + Path 4)
Total Path 1B round-trips completed
Total pre-flight skips (agent did it manually)

— Shadow Mode catches —
Count of drafts that were either (a) sent as-is by agent or (b) edited then sent.
Drafts rejected (deleted without send) tracked separately.
"This is the number that justifies $500/month long-term."

— Per-agent breakdown —
For each active agent:
  Agent name | mode (shadow/live) | leads handled | response time |
  pre-flight skips | digest engagement | last Sheet interaction

— Churn risk signals —
Agents flagged if any of:
  - No needs_review response in 48h (escalation went unanswered)
  - No Sheet interaction in 14 days
  - Pre-flight skip count trending up week-over-week
  - aiEnabled flipped TRUE→FALSE on 3+ rows in the window
Section renders even when empty ("All agents engaged this week.")
followed by the criteria, so threshold tuning is visible.

— Reliability —
Errors, retries, threading-skipped follow-ups, failed SMS deliveries,
OAuth refresh failures. Aggregated across all agents.

— Things that need a human —
Manual ops items: agent OAuth tokens nearing expiry, Sheet schema
drift detections, etc. Empty section omitted.
```

### 5.2 Shadow Mode catch — operational definition

A shadow draft (follow-up or Path 1A reply) is a "catch" if a sent message appears in the same Gmail thread within 48h of the draft firing AND the agent's sent message has any text overlap with the draft. Specifically:

- **Sent as-is:** sent message body equals draft body (modulo whitespace/signature normalization).
- **Edited then sent:** sent message body has ≥30% token overlap with draft body (Jaccard similarity over word tokens after lowercasing and stripping punctuation).
- **Rejected:** no sent message in the thread within 48h, OR sent message has <30% overlap (agent wrote from scratch, system draft did not help).

Implementation requires a new helper, `pollSentFolderForDraftResolution(agentConfig, draftMetadata)`. Runs as part of the weekly digest data-gathering pass.

### 5.3 Per-agent digest engagement

Tracked via action signals (no open-rate pixel):
- `needs_review` email response time (lower is better, indicates engagement)
- Sheet interaction recency (Sheets API exposes last-edit timestamp per row, aggregated per agent)
- CALLED/RESUME SMS frequency (healthy at low frequency, concerning at high frequency)

A "disengaged" agent has stale Sheet interaction AND no recent CALLED/RESUME activity AND unanswered escalations. Any single signal is not enough; the combination is.

---

## 6. Churn risk signals

For the operator weekly's "Churn risk" section.

| Signal | Threshold | Severity |
|---|---|---|
| `needs_review` email unanswered | >48h | High |
| No Sheet interaction | >14 days | High |
| Pre-flight skip count trending up | >50% increase week-over-week | Medium |
| aiEnabled flipped TRUE→FALSE | ≥3 rows in the window | Medium |
| CALLED command frequency | >5x in window | Low (could be healthy) |
| OAuth token refresh failure | Any | High (operational, not churn) |

An agent is flagged in the section if they hit any High signal, or any two Medium signals.

The pre-flight skip count is the strongest "agent doing it manually" signal. Tracked per-agent per-week in a new field on the agent state file: `weeklyPreflightSkips`. Reset at the end of each weekly digest send.

---

## 7. Architecture

### 7.1 Module shape

```
src/digest.js
  module.exports = {
    runDailyDigestForAgent,    // per-agent daily entry point
    runWeeklyDigestForOperator, // operator weekly entry point
  }
```

Both entry points share internal helpers:
- `gatherWindowData(agentConfig, startIso, endIso)` — pulls Sheet rows touched in the window, filters by status changes and last-action timestamps
- `categorizeRowsForDigest(rows, now)` — sorts rows into the digest sections (urgent, hot, new-to-review, follow-ups-due, etc.)
- `renderSMS(stats, urgent)` — produces the SMS string
- `renderEmail(sections)` — produces the email plaintext body
- `pollSentFolderForDraftResolution(...)` — Shadow Mode catch detection (weekly only)

### 7.2 Scheduling

The orchestrator's existing cron-driven cycle already runs every N minutes. Add a time-of-day check at the top of `processAgent`:

```
const now = getNowDate();
if (shouldRunDailyDigest(agentConfig, now, agentState)) {
  await runDailyDigestForAgent(agentConfig);
  agentState.lastDailyDigestRun = getNowIso();
  saveAgentState(agentConfig, agentState);
}
```

`shouldRunDailyDigest` returns true if:
- The agent's configured digest time falls within the current cycle window (e.g., last run was before 7am and now is ≥7am in agent's local timezone)
- AND `agentState.lastDailyDigestRun` is not within the last 12h (idempotency guard against double-send if the orchestrator restarts mid-day)

Weekly digest scheduled the same way but checked at the operator level (single config), not per-agent. Day-of-week check additional: only fires on Sunday.

### 7.3 Failure handling

- Each digest send is wrapped in try/catch.
- On send failure: retry up to 3x with exponential backoff (10s, 60s, 5min). All retries within the same orchestrator cycle.
- If all retries exhaust: log error, write to a new `agents/<agentId>.digest-errors.log` file (append-only), email Mo with the error context (uses Mo's own Gmail OAuth, same self-send pattern).
- `agentState.lastDailyDigestRun` is only updated on successful send. Retry on next cycle if all three retries failed.

### 7.4 Data sources

| Section | Source |
|---|---|
| New leads (Tier 2 to review) | Sheet rows where `aiEnabled === 'FALSE'` and created in window |
| Hot leads | Sheet rows where `status === 'HOT'` |
| Follow-ups due today | Sheet rows where eligibility window opens in next 24h (from `src/followUp.js` logic) |
| Follow-ups fired overnight | Column L entries with timestamps in window matching `[<timestamp>] Day <N> follow-up` pattern |
| Filtered counts | Lead Intake's `agent-ai/noise` label additions in window + `agent-ai/intaken` minus row creations |
| Pre-flight skips | New counter on agent state, incremented by `src/followUp.js` when pre-flight check detects a manual send |
| Path 1B in flight | Sheet rows where `status === 'awaiting_agent'` |
| Errors / reliability | Existing structured logs |

### 7.5 Testing strategy

`MOCK_NOW` is the primary lever. The L-column timestamp fix (commit `12e3cf6`) ensures column L reads under MOCK_NOW match the rest of the data. Test approach:

- Unit tests for renderers (`renderSMS`, `renderEmail`) take a fixture data structure and assert against the rendered output. No mocks needed.
- Unit tests for `categorizeRowsForDigest` take a fixture row set and assert correct bucketing.
- Integration test: set MOCK_NOW to a fixed morning, seed the Sheet with rows in various states across the trailing 24h, call `runDailyDigestForAgent`, assert the SMS and email contents and that the send was attempted (mocked Twilio + Gmail).
- Live verification: dry-run mode that produces the digest but sends it ONLY to Mo's address (not the agent's), regardless of agent config. Used to verify content before live agents receive their first one.

### 7.6 Shadow Mode interaction

In Shadow Mode, the daily brief still sends. It includes the "Follow-ups fired overnight (shadow drafts)" section linking the agent back to the drafts in their inbox. This is the daily reminder to review pending drafts before they pile up.

In Live mode, that section header changes to "Follow-ups sent overnight" and the rows show send confirmation, not draft links.

---

## 8. Open questions for next iteration

Deferred to post-build review:

- **Aggregate response-time calculation.** Need a clean definition: lead-reply-arrival → system-action timestamp. Should this exclude time when AI was disabled? Should this exclude SOI leads? Probably yes to both.
- **Warm-to-tour conversion.** We don't currently track tours in the Sheet. Either add a status (`tour_booked`) or defer this stat until we do.
- **SMS character budget.** Twilio segments at 160 chars (or 70 for unicode). Long names + multi-urgent days could blow past one segment. Test against real data before tuning.
- **Email rendering across clients.** Plaintext is safe but eventually we may want light HTML. Defer until a paying agent asks.

---

## 9. Build order for session 15

1. ~~Column L MOCK_NOW fix~~ ✓ shipped (commit `12e3cf6`)
2. Pre-flight skip counter (small addition to `src/followUp.js` + `src/agentState.js`)
3. `src/digest.js` skeleton: module shape, entry points, internal helper signatures
4. Renderers (`renderSMS`, `renderEmail`, `renderWeeklyEmail`) with unit tests
5. `gatherWindowData` + `categorizeRowsForDigest` with unit tests
6. Scheduler integration in `src/index.js`
7. Failure handling + retry logic
8. `pollSentFolderForDraftResolution` (Shadow Mode catch helper, weekly-only)
9. Integration test under MOCK_NOW
10. Dry-run mode live verification against Mo's inbox
11. Commit, update PROJECT_STATE with new parked items and session 15 narrative

---

## 10. Out of scope for this session

- Operations email infrastructure (`operations@<domain>`, Resend, etc.) — see parked item
- Inbound email-as-command — see parked item
- Open-rate tracking pixel — see §2
- Onboarding & Light Management Page — already parked
- Email HTML rendering — see §8

---

## 11. Parked items to add to PROJECT_STATE after session 15

**[Session 15] Operations email infrastructure + inbound email-as-command.**
- **What:** Stand up `operations@<domain>` for outbound system emails (digests, alerts) from a branded address rather than personal Gmail, AND inbound agent-to-AI commands ("pause follow-ups for Sarah K," "draft an email to John"). Includes domain registration, DNS setup, Resend (or equivalent) integration, command parser, auth model, dispatch routing. Also unblocks native open-rate tracking on digest emails.
- **Why parked:** Domain registration + brand decision aren't pressing yet; digests work fine self-sent from existing Gmail at v1 scale. Inbound command parsing is its own design surface deserving a dedicated session.
- **Build trigger:** before first paying agent goes live (digests from personal Gmail look unprofessional to paying customers), OR when operator ergonomics demand email-as-command.

**[Session 15] Warm-to-tour conversion tracking.**
- **What:** Add a status transition or a Sheet column for tour-booked. Until then, the weekly digest's "warm-to-tour conversion" stat is unavailable.
- **Build trigger:** when an agent specifically asks, OR when 30+ days of data make the stat possible to backfill.

**[Session 15] Email HTML rendering for digests.**
- **What:** Plaintext digests are safe and readable but unbranded. Light HTML rendering (basic typography, single-color accents, mobile-responsive) makes the digest feel like a product.
- **Build trigger:** first paying agent feedback OR operations email infrastructure ships (since HTML deliverability is more sensitive than plaintext).
