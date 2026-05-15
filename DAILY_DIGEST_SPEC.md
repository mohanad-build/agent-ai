# Daily Digest Spec

**Status: shipped (session 17 close-out).** Session 15 design, sessions 15-17 build. Companion to `REPLY_DETECTION_SPEC.md`.

Module: `src/digest.js`. Two entry points, one module: per-agent daily brief and operator weekly digest. Shares data-gathering helpers across both. As of session 17, both surfaces send `multipart/alternative` MIME with plaintext AND HTML parts; both share the same `buildActionLink` helper and design tokens.

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
| MIME structure | `multipart/alternative` (plaintext + HTML) | `multipart/alternative` (plaintext + HTML) |

**No Resend, no operations email, no transactional service.** Both digests self-send from existing Gmail OAuth tokens. Sunset: revisit when first paying agent onboards (parked operations-email item; see §11). Self-send through personal Gmail triggers aggressive CSS sanitization in Gmail's web client; the HTML rendering is designed to degrade cleanly rather than fight that.

**No open-rate tracking pixel.** Churn signals are action-based (see §6). Gmail-to-Gmail self-sends are not a meaningful open-rate signal anyway.

---

## 3. Per-agent daily brief — SMS

**Format goal:** demonstrate value every day, even on slow days. Never undersell.

### 3.1 Structure

One concatenated SMS (Twilio handles segmentation). Three lines:

```
Line 1: <opener>
Line 2: 🔥 <FirstName LastInitial> <context> <verb phrase> <suffix>
Line 3: Full brief in your inbox.
```

The opener (line 1) has three branches:
- **Automation was busy, urgent leads exist** — `Handled N leads overnight: X new, Y follow-ups, Z filtered.`
- **Automation was busy, no urgent leads** — same plus `... 0 need you today.`
- **Automation was quiet, urgent leads exist** — `${N} lead(s) need(s) you this morning.` (singular/plural agreement)

When no urgent rows exist, line 2 is omitted entirely. The SMS becomes 2 lines.

The fire emoji prefix on line 2 is always present when urgent exists. The verb phrase is category-determined (see §3.4). The suffix is `+ N more.` when there are additional urgent rows beyond the first, otherwise empty.

### 3.2 Examples

Active morning, one HOT urgent with property reference:
```
Handled 6 leads overnight: 3 new, 2 follow-ups, 1 filtered.
🔥 Sarah K (45 Maple) wants to call you today.
Full brief in your inbox.
```

Active morning, multiple urgent items:
```
Handled 12 leads overnight: 4 new, 5 follow-ups, 3 filtered.
🔥 Sarah K (45 Maple) wants to call you today + 2 more.
Full brief in your inbox.
```

Quiet morning, no urgent:
```
Handled 12 leads overnight: 0 new, 5 follow-ups, 7 filtered. 0 need you today.
Full brief in your inbox.
```

Automation quiet, urgent lead present:
```
2 leads need you this morning.
🔥 Daniel (HOT signal) wants to call you today + 1 more.
Full brief in your inbox.
```

Path 1B urgent with hours elapsed:
```
Handled 6 leads overnight: 2 new, 1 follow-ups, 3 filtered.
🔥 Mike T (Path 1B 26h) is waiting on you.
Full brief in your inbox.
```

### 3.3 "Handled overnight" stats — what counts

Three integers summed for the total:
- `intaken` — rows with `createdInWindow === true` (Lead Intake wrote a new row in the trailing 24h)
- `followUpsFired` — rows whose `lastFollowUpFire` annotation has a timestamp in window
- `noiseFiltered` — label-additions to `agent-ai/noise` in window minus row creations from `agent-ai/intaken` in the same window (Lead Intake's filtering effect)

Pre-flight skips are counted separately (weekly-only stat, surfaces in email body's "What the system handled" section).

### 3.4 Urgent flag — what triggers naming

A row appears in urgent (and gets named on SMS line 2) when one of:

| Trigger | Category | Verb phrase | SMS context format |
|---|---|---|---|
| `status === 'HOT'` | `HOT` | `wants to call you today` | `(propertyReference)` or `(HOT signal)` |
| `status === 'needs_review'` | `needs_review` | `needs review` | `(propertyReference)` or `(needs review)` |
| `operatorEscalated` set within 7d | `operatorEscalated` | `escalated to you` | `(propertyReference)` or `(escalated)` |
| `status === 'awaiting_agent'` AND `lastActionTimestamp > 24h ago` | `path1b` | `is waiting on you` | `(Path 1B Nh)` where N is hours elapsed |

Priority order when multiple triggers fire on the same row: HOT > needs_review > operatorEscalated > path1b. Row appears once in urgent at the highest-priority category.

Top-of-urgent sort is by trigger timestamp descending (most recent first). SMS names the top urgent only; "+ N more" suffix carries the rest.

---

## 4. Per-agent daily brief — email

### 4.1 Structure

Plaintext and HTML versions sent as `multipart/alternative`. Both carry the same sections in the same order. Both use `buildActionLink` (see §7.7) as the single source of truth for which URL each row points to.

Section order:
1. **Opener** (suppressed when urgent rows exist — section headers carry the tone)
2. **— Needs you today —** (urgent rows, max 5 displayed)
3. **— Hot leads to call today —** (rows with `status === 'HOT'`, with urgent-section rowIndexes filtered out)
4. **— Possible new leads to review —** (rows with `status === 'new' && aiEnabled === 'FALSE' && createdInWindow === true`)
5. **— Follow-ups due today —** (rows with eligibility window opening in next 24h)
6. **— Follow-ups sent overnight —** OR **— Follow-ups fired overnight (shadow drafts) —** (mode-dependent header; section appears only when there are fired follow-ups in window)
7. **— What the system handled —** (always renders, even when zeros)
8. **— Reliability —** (renders only when errors + retries + threading-skipped > 0)

The Hot leads section uses the `buildActionLink` filter against urgent rowIndexes to avoid showing the same row in two places.

### 4.2 Section rules

- Each urgent row renders as one line for the row text, followed by a stacked action button (HTML) or `→ ${label}: ${url}` line (plaintext) — see §7.7 for action-link rules.
- Hot lead rows additionally include `last touch Nd ago` after the property reference.
- When `urgentDisplayContext` returns a fallback string (`HOT signal`, `needs review`, `escalated`) AND `propertyReference` is null, the trailing context is dropped from the row text (avoid redundancy with the verb phrase).
- Path 1B's context (`Path 1B Nh`) is NEVER dropped — it carries hours-elapsed information not present in the verb.
- "What the system handled" zero-counts intentionally render (reassures the agent the system ran).

### 4.3 Subject line

When urgent rows exist: `Your morning brief — ${firstUrgent.firstName} needs you today`
When quiet morning: `Your morning brief — ${formatDailyDate(now, timezone)}` (e.g., `Your morning brief — Tuesday, May 12`)

The body uses a more specific verb phrase ("wants to call you today") inside row text; the subject's generic "needs you today" works for any category and reads well as a notification preview.

---

## 5. Operator weekly digest

### 5.1 Sections

Plaintext + HTML, like the daily digest. Operator-aggregate stats only; no per-lead rows and no action buttons.

1. **— What happened this week —** (aggregate counts across all agents: new leads intaken, follow-ups fired, leads escalated to needs_review, HOT signals, Shadow Mode catches)
2. **— Shadow Mode catches —** (count of cases where agent sent a message in same Gmail thread as an AI draft within 48h, ≥30% Jaccard token overlap)
3. **— Per-agent breakdown —** (each agent's name in bold, then their stat lines: leads intaken, leads needing escalation, follow-up activity, last-7-day churn indicators)
4. **— Reliability across agents —** (errors, retries, threading-skipped; aggregated)

### 5.2 Shadow Mode catch — operational definition

A "catch" is when:
- An AI draft was created (Shadow Mode wraps a draft into the agent's inbox)
- A sent message exists in the same Gmail thread within 48h
- Jaccard token overlap between the AI's draft body and the agent's sent body is ≥30%

The 30% threshold is a gut call; flagged for real-data tuning (parked 7.8.14). Polling via `pollSentFolderForDraftResolution` with 30s timeout per agent per cycle.

### 5.3 Per-agent digest engagement

Each agent block lists:
- Leads intaken this week
- Hot leads surfaced
- Follow-ups fired (sent or shadow-drafted)
- Pre-flight skips this week (counted from `weeklyPreflightSkips` state field; reset at end of weekly digest send)
- Shadow Mode catches (live mode skips this line)

If a stat is unavailable (warm-to-tour conversion is the canonical case), the line is omitted, not zero-filled.

---

## 6. Churn risk signals

Action-based, no open-rate dependency. Surfaced in the operator weekly digest's per-agent breakdown:

- **Pre-flight skip counter elevated** (agent doing manual sends, signaling distrust of AI threading) — strongest signal
- **No needs_review response in 48h** (agent leaving escalations untouched)
- **No Sheet interaction in 14 days** (no manual edits, no CALLED/RESUME commands)
- **aiEnabled flipped TRUE → FALSE on 3+ rows in a week** (agent turning AI off lead-by-lead)
- **Warm-to-tour conversion drop** (not tracked yet; parked 7.8.12)

---

## 7. Architecture

### 7.1 Module shape

`src/digest.js` exports:
- `runDailyDigestForAgent(agentConfig, options)` — main daily entry point
- `runWeeklyDigestForOperator(operatorConfig, options)` — main weekly entry point
- `categorizeRowsForDigest(rows, now)` — pure-logic bucketing into 5 row-bucket sections
- `gatherWindowData(agentConfig, startIso, endIso)` — fetches and annotates rows + state counters
- `buildActionLink(rowData, agentConfig)` — category-aware action link with smart fallback chain
- `renderEmail(sections, agentConfig, now)` — daily plaintext
- `renderEmailHtml(sections, agentConfig, now)` — daily HTML
- `renderWeeklyEmail(weeklySections, operatorConfig, now)` — weekly plaintext
- `renderWeeklyEmailHtml(weeklySections, operatorConfig, now)` — weekly HTML
- `renderSMS(stats, urgent)` — daily SMS only

Both entry points accept an `options` bag:
- `options.dryRun === true` — routes SMS to `operatorPhone` and email to `escalationEmail` instead of agent/operator's real destinations. Used for stage 10 live verification.
- `options.pollFn` — injection point for weekly's Shadow Mode catch polling. Allows tests to mock the Gmail polling step deterministically.

### 7.2 Scheduling

Entry points are called from `src/index.js`'s orchestrator hook. The hook checks `lastDailyDigestRun` and `lastWeeklyDigestRun` on agent and operator state, computes whether the configured digest time has elapsed since the last run, and fires accordingly. Pre-flight uses `MOCK_NOW` when present; production is real wall-clock.

Day-of-week check additional: weekly only fires on Sunday.

### 7.3 Failure handling

- Each digest send is wrapped in `_sendWithRetry`.
- On send failure: retry up to 2x with exponential backoff (10s, 60s — spec deviation from 3x; the 5-minute retry was dropped in step 7 because operator SMS fallback exists for the weekly case and the daily case is best-effort).
- If retries exhaust: log error, write to `agents/<agentId>.digest-errors.log` (append-only), and for the weekly digest specifically, send an operator SMS fallback notifying that the weekly email failed.
- `agentState.lastDailyDigestRun` is only updated on successful send. Retry on next cycle if all retries failed.

### 7.4 Data sources

| Section | Source |
|---|---|
| New leads (Tier 2 to review) | Sheet rows where `aiEnabled === 'FALSE'` and `createdInWindow === true` |
| Hot leads | Sheet rows where `status === 'HOT'` |
| Follow-ups due today | Sheet rows where eligibility window opens in next 24h (from `src/followUp.js` logic) |
| Follow-ups fired overnight | `lastFollowUpFire` annotation on rows with timestamp in window |
| Filtered counts | Lead Intake's `agent-ai/noise` label additions in window minus `agent-ai/intaken` row creations |
| Pre-flight skips | `weeklyPreflightSkips` counter on agent state, incremented by `src/followUp.js` on threading-mismatch skip |
| Path 1B in flight | Sheet rows where `status === 'awaiting_agent'` |
| Errors / reliability | Existing structured logs |
| Phone/threadId for action links | Forwarded by categorizer from raw row data |

### 7.5 Testing strategy

`MOCK_NOW` is the primary lever. The L-column timestamp fix (commit `12e3cf6`) ensures column L reads under `MOCK_NOW` match the rest of the data. Test approach:

- Unit tests for renderers (`renderSMS`, `renderEmail`, `renderEmailHtml`, `renderWeeklyEmail`, `renderWeeklyEmailHtml`) take a fixture data structure and assert against the rendered output. No mocks needed.
- Unit tests for `categorizeRowsForDigest` take a fixture row set and assert correct bucketing.
- Unit tests for `buildActionLink` cover all 4 categories × all fallback levels + edge cases (null returns).
- Unit tests for MIME multipart structure round-trip the message, parse it, assert two parts with correct content-types, UTF-8 round-trip for em-dash, arrow, fire emoji.
- Integration tests: set `MOCK_NOW` to a fixed morning, seed the Sheet with rows in various states, call `runDailyDigestForAgent`/`runWeeklyDigestForOperator`, assert send attempts and content via mocked Twilio/Gmail.
- Live verification: `options.dryRun` produces the digest and routes to operator destinations regardless of agent config. Used in session 17 across three iteration rounds to lock canonical strings.

### 7.6 Shadow Mode interaction

In Shadow Mode, the daily brief still sends. It includes the "Follow-ups fired overnight (shadow drafts)" section linking back to drafts in the agent's inbox. This is the daily reminder to review pending drafts before they pile up.

In Live mode, that section header changes to "Follow-ups sent overnight" and rows show send confirmation, not draft links.

### 7.7 Action-link helper and design tokens (added session 17)

#### Action-link helper

`buildActionLink(rowData, agentConfig)` returns `{ label, url, isFallback }` or `null`. Used by both plaintext and HTML renderers as the single source of truth for what link a row points to.

Per-category preference + smart fallback chain:

| Category | Preferred link | First fallback | Final fallback |
|---|---|---|---|
| HOT | `tel:${phone}` ("Call {firstName}") | Gmail thread ("Open thread") | Sheet row ("Open row") |
| needs_review | Gmail thread ("Open thread") | Sheet row ("Open row") | n/a |
| operatorEscalated | Sheet row ("Open row") | n/a | n/a |
| path1b | Gmail thread ("Open thread") | Sheet row ("Open row") | n/a |

Rationale: each category has a distinct "agent's actual next action." HOT → call. needs_review → read the inbound message. operatorEscalated → see what was flagged. path1b → reply to the AI's question in the thread. The fallback chain handles missing data (lead without phone, row created manually without a thread).

Categorizer change required by this helper: `urgent.push` and `hotLeads.push` forward `phone`, `gmailThreadId`, `leadId` from row data. No new Sheet columns; data already existed in `readSheetRows` output and was being dropped.

When `buildActionLink` returns `null` (every preference exhausted), the renderer skips the action line entirely — row text only.

#### Plaintext (Option A format)

Each urgent or hot-leads row spans 2 lines:
```
Daniel — wants to call you today
→ Call Daniel: tel:+16475551234
```

The `→` (U+2192) character is intentional and doesn't collide with the `—` section delimiter.

#### HTML

Stacked `<a>` button under each row text. Buttons are inline-styled `<a>` tags (NOT bulletproof-table-wrapped — see §11 parked item).

Design tokens (top of `src/digest.js`, `STYLE_TOKENS` const):
```
buttonBackground: '#1a1a1a'
buttonTextColor: '#ffffff'
buttonBorderRadius: '6px'
buttonPadding: '12px 20px'
buttonFontWeight: '600'
containerMaxWidth: '560px'
containerPadding: '24px'
fontStack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
bodyTextColor: '#1a1a1a'
mutedTextColor: '#666666'
sectionDividerColor: '#e0e0e0'
bodyBackground: '#ffffff'
fontSize: '16px'
lineHeight: '1.5'
```

Every visual choice references a token. Branding is a single-file change when ops email infrastructure (§11) lands.

Layout: centered 560px container, no card, no shadow. Mobile clients render full-width by ignoring max-width.

#### MIME multipart

`sendNewEmail` in `src/email.js` and `src/gmail.js` accepts optional `html` field. When provided, builds `multipart/alternative` MIME with plaintext FIRST and HTML SECOND (clients render the last part they support). Hand-rolled `encodeQuotedPrintable` with soft-line-break at 75 chars. Three mutually exclusive paths: plaintext-only (unchanged byte-for-byte, all non-digest callers preserved), multipart/alternative when html provided, multipart/mixed when attachments. HTML+attachments combination intentionally falls through to attachments path; no caller in the codebase sends both.

---

## 8. Open questions for next iteration

Resolved during sessions 15-17:
- ~~Aggregate response-time calculation~~ — deferred; not in v1
- ~~Warm-to-tour conversion~~ — parked (7.8.12) until status transition exists
- ~~Operations email infrastructure for branded sending~~ — parked (7.8.11), blocks branded button rendering

Still open:
- **Per-day vs weekly preflight skip framing in the daily digest** — currently the daily reads "Pre-flight skips this week: N" from the cumulative counter, which can be jarring on a Wednesday. Parked 7.8.15.
- **Daily digest section ordering tuning when urgent is empty but other sections have content** — does the email feel right when there's nothing urgent but follow-ups due? Not yet stressed under real volume.
- **HTML rendering in Gmail web for self-sent emails is degraded.** Branded sender domain (parked 7.8.11) should materially relax sanitization. Will need re-verification when ops email infra ships.

---

## 9. Build order (historical reference, sessions 15-17)

1. Pre-flight skip counter on agent state ✅ session 15
2. `src/digest.js` skeleton (2 entry points, 8 helpers) ✅ session 15
3. Renderers (`renderSMS`, `renderEmail`) + tests ✅ session 15
4. Lead Intake records `propertyReference` in column L ✅ session 15
5. `categorizeRowsForDigest` ✅ session 15
6. `newToReview` window gate via `createdInWindow` ✅ session 15
7. `gatherWindowData` + Path B systemHandled ✅ session 15
8. Step 6: daily entry point + scheduler hook ✅ session 16
9. Step 6b: weekly entry point + operator state pattern ✅ session 16
10. Step 7: retry + error logging + operator SMS fallback ✅ session 16
11. Step 8: Shadow Mode catch detection ✅ session 16
12. SOI gather-layer filter fix ✅ session 16
13. Step 9: integration tests ✅ session 16
14. Step 10a: copy iteration from live dry-run (commit `66a315f`) ✅ session 17
15. Step 10b: HTML email rendering with action links (commit `b24cc33`) ✅ session 17
16. Step 11: spec close-out + PROJECT_STATE refresh ✅ session 17

---

## 10. Out of scope (deferred to future spec sessions)

- Branded HTML rendering (filled dark buttons in Gmail web) — blocked on ops email infra
- Open-rate tracking pixels
- Inbound email-as-command (operator says "pause follow-ups for Sarah K") — bundled into ops email infra spec
- Web form / forward-to-add lead entry — deferred until first paying agents are 30 days live
- Soft-exit confirmation flow (Path 3) — deferred until Agent SMS Reply Handler is live
- Agent voice training feedback loop — deferred until ~50 drafts per agent of real signal exist

---

## 11. Known limitations / parked items

**Branded button rendering blocked on ops email infra (parked 7.8.11).** Self-send from personal Gmail OAuth triggers Gmail's most aggressive CSS sanitization. The bulletproof-table pattern documented as canonical for transactional email assumes a branded sender domain with proper SPF/DKIM/DMARC. Was attempted and reverted in session 17 — produced a worse rendering (highlighter effect on link text only) than the simple inline-styled `<a>`. The current inline-styled `<a>` renders as clean blue underlined link in Gmail web (CSS stripped) and as filled dark button in Apple Mail/Outlook (CSS preserved). Live verification with a real branded-from address is the next attempt at filled buttons.

**Phone E.164 normalization (parked).** Row 11 fixture stores `416-555-0188` without `+1`; `buildActionLink` emits `tel:4165550188`. iOS dialer handles correctly (assumes user country), but production data should be E.164. Real production data via Twilio will be E.164 already; fixture is the outlier.

**HTML+attachments combination path intentionally not implemented.** Falls through to multipart/mixed (attachments path) and HTML is ignored. No caller in current codebase sends both; digest never has attachments.

**Per-day vs weekly pre-flight skip framing (parked 7.8.15).** Daily digest reads "Pre-flight skips this week: N" — can be jarring mid-week. Future iteration should consider per-day vs weekly framing.

**Shadow Mode threshold tuning (parked 7.8.14).** The 30% Jaccard overlap threshold for catch detection is a gut call; needs real-data review after first week of paying-agent data.
