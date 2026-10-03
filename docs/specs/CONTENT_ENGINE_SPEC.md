# Content Engine Spec

Session 18 design. Companion to `REPLY_DETECTION_SPEC.md` and `DAILY_DIGEST_SPEC.md`.

Module: `src/content/` (multi-file). One paid add-on per agent: produces a weekly batch of marketing content (Reels + blog) grounded in live Canadian real estate data, in the agent's voice, with editorial control.

Phase 3 of the build sequence. Toggle-gated, opt-in per agent, billable separately from Starter.

---

## 1. Scope

The Content Engine produces a single weekly surface:

1. **Weekly content batch** — every Content-Engine-enabled agent receives one each Monday morning. Up to 2 Reel packages (script + Instagram caption) + 1 blog/newsletter post. Agent reviews, approves, edits, regenerates, or swaps angle. Output is copy-paste ready; the agent posts/publishes elsewhere.

What this module IS:
- A marketing-content generator grounded in **real, current, cited Canadian real estate data**.
- A voice-profiled writer that produces visibly different output per agent.
- An editorial tool with default picks and an override menu, not a hands-off auto-poster.

What this module is NOT:
- An outreach tool. Reaching individual leads is what Follow-Ups (`src/followUp.js`) does. Content Engine produces marketing assets the agent publishes broadly.
- An auto-publisher. v1 is approve → copy-paste. No email send, no social API, no scheduler.
- A generic "AI for real estate agents" wrapper. The data layer is the moat — without live Canadian-source statistics, this is a ChatGPT shell.
- A hyperlocal-pocket tool. Audience is "anyone interested in Canadian/Toronto real estate," not "people in M4M postal code." See §2.2.

---

## 2. Product decisions (locked)

### 2.1 Differentiation model

Content is differentiated across agents via three layers stacked on the same underlying data:

1. **Angle selection.** Each cycle the engine generates a menu of 5-8 candidate angles from the week's data. The engine picks N strongest defaults for each agent based on their profile. Two agents in the same market with different profiles get different defaults.
2. **Voice profiling.** Each agent uploads 3-5 voice samples (past content they felt represented them) during onboarding. Claude extracts a voice descriptor (tone, sentence rhythm, signature phrases, what they refuse to say) and applies it to every render.
3. **Editorial override.** Agent can swap the engine's pick for any other angle on the menu, regenerate the same angle with fresh prose, or edit by hand. Choices flow back into voice profile signal over time.

The data is shared across agents (one TRREB pull serves everyone). The angles, the picks, and the prose are per-agent.

### 2.2 Audience scope

Content is written for **anyone interested in buying or selling a home in Canada / Toronto** — informed homebuyer/seller, not hyperlocal sphere or audience-segmented.

Rationale: agent doesn't have to maintain a CRM segmentation, recipients vary across the agent's posting surfaces (YouTube viewers, blog readers, IG followers — wildly different audiences), and broad-but-data-grounded content avoids the commodity trap so long as the data layer holds up its end.

Out of scope for v1:
- Audience-segment variants (first-time buyer / move-up seller / investor) — deferred to stage 2.
- Hyperlocal / FSA-level content — deferred indefinitely; no agent has asked.

### 2.3 Renderers (v1)

Two logical outputs, three renderers:

| Output | Renderer | Format |
|---|---|---|
| Reel package (×2/week max) | `renderReelScript` + `renderInstagramCaption` | 60-90 sec talking-head script with hook/body/CTA + companion IG caption with hashtag block |
| Blog/newsletter post (×1/week) | `renderBlogPost` | 600-800 words, Markdown formatted, H2 sections, target keyword, meta description, copy-paste ready |

Each Reel ships as a script + caption pair, treated as one logical output. An agent who films the Reel needs the caption to post with it; producing one without the other breaks the "show up done" promise.

Explicitly out of scope for v1 (deferred to stage 2 or 3):
- Market-update PDF / one-pager (stage 2 — distinct effort, high perceived value)
- LinkedIn long-form post (stage 2 — small marginal add)
- Email-to-past-clients renderer (probably not — overlaps with Follow-Ups; agent can reuse blog/newsletter output for past-client emails)
- Listing-specific reactive content (stage 3 — different trigger model)
- Image generation / B-roll generation
- Multi-language

### 2.4 Cadence

- **Weekly batches**, delivered Monday morning at 7:00 AM local.
- **Up to 2 Reels + 1 blog per batch**, with graceful degradation: on quiet data weeks, engine produces 1 Reel + 1 blog and notes "light news week" in the review email. The engine refuses to produce filler.
- **Strongest-pick flagging:** in each batch, one Reel is flagged as the recommended priority so agents who only film one per week know which to film.
- **Agent volume override** in profile: `contentVolume: 'max' | 'balanced' | 'minimum'` controls how many renders the agent receives. Default `'max'` (up to 2 Reels + 1 blog), `'balanced'` (1 Reel + 1 blog), `'minimum'` (best 1 piece only, type chosen by engine).

### 2.5 Agent editorial controls

Per-piece controls available in the review surface:

- **Approve** — done, copy-paste ready.
- **Edit inline** — agent edits text; original + edited version both persisted to `contentState.json` for future voice-tuning signal.
- **Regenerate this piece** — same angle, fresh Claude call, different prose. Soft cap: 5 regenerations per piece per cycle. After cap, review surface prompts agent to edit or swap angle instead.
- **Swap angle** — pick a different angle from this week's menu. Engine generates a new piece using the picked angle, voice profile applied.

The full angle menu (all 5-8 candidates the engine considered) is persisted to `agents/<agentId>.contentState.json` for the cycle so swap actions don't re-run angle generation.

### 2.6 Toggle / billing posture

- `agentConfig.contentEngineEnabled` boolean field, **absent-as-false** (this is paid add-on, not core; existing agents are not auto-opted in).
- Top of `runContentEngineForAgent` checks the flag and bails silently if false.
- When billing layer exists, subscription state flips this field. v1 is manually toggled in agent config.
- Toggle is reversible without data loss: turning off pauses generation; voice profile and history persist for re-enable.

### 2.7 Compliance posture

- **Every statistic in output carries its source + as-of-date in a footer.** Both for trust (legitimate journalism move, makes content feel authoritative) and for legal cover (Royal LePage compliance, financial-advice-adjacent topics).
- **Data layer refuses stale data.** Each data point has an expected refresh cadence; if a point is past its staleness threshold, the engine doesn't use it. Better to produce one less Reel than to publish stale numbers.
- **Disclaimer block included on rate-related content.** "For informational purposes only. Consult a licensed mortgage broker for personalized advice." Auto-appended when output references mortgage rates or financial figures.
- **Forbidden topics / phrases** from agent profile (`forbiddenTerms: string[]`) are passed into every renderer prompt as hard exclusions.
- **No real-person quotes.** Renderers must not attribute quotes to specific bank economists, journalists, or analysts. Stats yes (with source). Quoted opinions no.

---

## 3. Data layer

The moat. Without this, the engine is a ChatGPT wrapper.

### 3.1 Sources (v1)

Canadian / Toronto scope. Refresh cadences and pull strategies locked:

| Source | Refresh | Strategy | Notes |
|---|---|---|---|
| Bank of Canada — overnight rate, statements, GoC 5-year bond yield | Daily (bond yield), event-driven (rate decisions, 8/yr) | BoC Valet API (free, JSON) | Bond yield drives fixed mortgage rates; weekly content angle |
| CREA HPI — national + Toronto Board | Monthly (mid-month release) | CREA public data CSV download | National + Toronto cuts |
| TRREB Market Watch — monthly | Monthly (first week) | PDF parse from TRREB site | Toronto board detail |
| TRREB weekly stats | Weekly (Friday) | PDF/HTML parse | Week-over-week movement angles |
| StatCan — CPI | Monthly (mid-month) | StatCan API (free) | Drives rate-expectation angles |
| StatCan — Labour Force Survey | Monthly (first Friday) | StatCan API | Employment → housing demand angle |
| StatCan — building permits | Monthly | StatCan API | Supply story |
| Ratehub / lender rate trackers | Weekly | Scrape | Current 5-year fixed rate snapshot |

Deferred to stage 2 (when first paying agent demands it OR scope grows):
- Big 6 bank quarterly earnings commentary on housing (quarterly, manual or scraped)
- Provincial Ontario policy news (event-driven)
- Federal budget / fall economic statement (periodic events)
- Urbanation rental market data
- Teranet / Altus Group housing index

### 3.2 Cache structure

```
data/market/
  canada/
    YYYY-MM.json          monthly snapshot, normalized
    YYYY-WW.json          weekly snapshot (bond yields, weekly TRREB)
  toronto/
    YYYY-MM.json
    YYYY-WW.json
  raw/
    boc/                  raw API responses, retained for audit
    trreb/
    crea/
    statcan/
```

Region-keyed (`canada`, `toronto`), not agent-keyed. One pull serves all agents.

### 3.3 Canonical data point schema

Every value in the cache is wrapped:

```json
{
  "metric": "boc_overnight_rate",
  "value": 3.75,
  "unit": "percent",
  "asOf": "2026-05-08T00:00:00Z",
  "source": "Bank of Canada",
  "sourceUrl": "https://www.bankofcanada.ca/...",
  "refreshCadence": "event_driven",
  "staleThresholdDays": 90,
  "confidence": "high"
}
```

The `staleThresholdDays` field is the publish gate. If `now - asOf > staleThresholdDays`, the engine refuses to use this point.

### 3.4 Pull architecture

**Critical design decision:** data pulls run as a separate scheduled job, NOT inside the per-agent orchestrator loop.

- New file `src/content/pullData.js` exposes `runDataPullCycle()`.
- Invoked by a separate scheduled task (cron entry on Mo's machine for dev; Railway scheduled task for production).
- Default cadence: every 6 hours during weekdays, every 12 hours weekends. Each invocation pulls all sources whose `refreshCadence` is overdue.
- Failures per-source are isolated: TRREB scrape breaking does not block BoC API from refreshing.
- Each pull writes raw + normalized + appends a structured log entry to `data/market/_pullLog.jsonl`.

Per-agent content generation reads only from the normalized cache. Never makes its own API calls to data sources.

### 3.5 Data freshness monitoring

A new operator-level check: weekly digest already exists (Sunday). Add a `dataFreshness` section that lists any source whose last successful pull is past expected interval.

This is the "TRREB changed their PDF format" early warning. Without it, the engine silently publishes stale numbers and we find out from an angry agent.

---

## 4. Angle generation

The most important Claude call in the system. Stat → angle is where boring numbers become content.

### 4.1 The angle object

```
{
  id: 'angle-2026-05-15-001',
  weekStartIso: '2026-05-11T00:00:00Z',
  headline: 'BoC held but mortgages dropped anyway',
  thesis: 'The Bank of Canada held the overnight rate Wednesday, but 5-year GoC bond yields fell 22bps the same week, driving fixed mortgage rates lower at three of the Big 6.',
  dataPoints: [
    { metric: 'boc_overnight_rate', asOf: '2026-05-07' },
    { metric: 'goc_5yr_yield', asOf: '2026-05-15' },
    { metric: 'big6_5yr_fixed_rate', asOf: '2026-05-15' }
  ],
  audienceFocus: 'buyers',
  surpriseScore: 0.78,
  evergreen: false,
  forbidsRateAdvice: true
}
```

- `headline`: short, hook-ready phrase. Used in review email.
- `thesis`: 1-2 sentence summary the renderers expand into full content.
- `dataPoints`: which cached metrics this angle uses (also drives the source footer).
- `audienceFocus`: which segment this angle leans toward (informs default-pick selection per agent profile).
- `surpriseScore`: Claude-estimated "is this actually interesting" rating, 0-1. Drives strongest-pick ranking.
- `forbidsRateAdvice`: if true, renderers must auto-append the rate disclaimer block.

### 4.2 Generation flow

Once per week (Monday 4:00 AM local, before the first batch goes out):

1. Pull the canonical data slice for `canada` + `toronto`, last 14 days of changes.
2. Single Claude call with the data slice + an angle-generation prompt → 5-8 candidate angles.
3. Persist the full menu to `data/market/_angles/YYYY-WW.json` (shared across agents).
4. Per-agent default-pick selection (cheap, deterministic, no Claude call) — see §4.3.

### 4.3 Default-pick selection (per-agent)

Deterministic scoring, no Claude call. Inputs: agent's profile (`audienceFocus`), recent approval history (don't repeat themes the agent just used), and `surpriseScore`.

Formula:
```
score = surpriseScore
      + 0.2 if angle.audienceFocus === agent.primaryFocus
      - 0.3 if same theme used in agent's last 2 batches
      - 0.1 if angle.forbidsRateAdvice and agent has historically rejected rate content
```

Top N picked: 2 for `contentVolume: 'max'`, 1 for `'balanced'`, 1 for `'minimum'`. Blog default is the single highest-scoring angle suitable for long-form (`evergreen: true` weights up here).

The remaining 4-6 angles stay on the menu, available for swap.

---

## 5. Renderers

Three renderers, each its own file, each with its own prompt. Same pattern as `digest.js`'s `renderSMS` / `renderEmail` / `renderWeeklyEmail`.

### 5.1 `renderReelScript`

Input: angle + voice profile + agent profile.

Output structure (plain text, copy-paste ready):
```
HOOK (0-5s):
<one-line hook, written for the ear, must work without context>

BODY (5s-60s):
<3-beat structure: what happened, why it matters, what to do about it>
<written conversationally, second person, short sentences>

CTA (60-75s):
<agent's signature CTA pattern from voice profile>

B-ROLL SUGGESTIONS:
- <suggestion 1>
- <suggestion 2>

SOURCES:
<source footer with as-of dates>
```

Target length: 60-90 seconds spoken (~150-225 words). Format optimized for filming on a phone — no stage directions beyond hook/body/CTA boundaries.

Prompt iteration phase planned (see HARD GATEs §8).

### 5.2 `renderInstagramCaption`

Input: angle + voice profile + already-rendered Reel script (for thematic alignment).

Output structure:
```
<hook line — must work in IG's first-line truncation, before "more">

<2-3 short paragraphs expanding the angle>

<CTA line>

<hashtag block: 10-15 tags, mix of broad + Toronto-specific>
```

Target length: 100-180 words. First line is the highest-value real estate; renderer must produce a hook that lands before the `... more` cutoff.

Treated as a required companion to every Reel — script and caption render together as one Reel package.

### 5.3 `renderBlogPost`

Input: angle + voice profile + agent profile.

Output structure (Markdown):
```
# <Title — SEO-aware, includes target keyword>

<Hook paragraph — pulls reader in, no clichés>

## <H2 section 1>
<2-3 paragraphs, weaves in primary data point, cites source inline>

## <H2 section 2>
<2-3 paragraphs, secondary data point, expands the thesis>

## <H2 section 3 — what this means for you>
<takeaways for buyers/sellers, ends with CTA>

---

**Sources:**
- <citation 1>
- <citation 2>

*Suggested meta description:* <140-160 chars>
*Suggested target keyword:* <phrase>
```

Target length: 600-800 words. Optimized for paste-into-blog-or-newsletter; works in Markdown blog CMS, Substack, Beehiiv, Mailchimp, ConvertKit, or pasted as plain text into Gmail.

Prompt iteration phase planned (see HARD GATEs §8).

---

## 6. Agent onboarding (one-time, ~5-10 min)

Captured during Content Engine activation. Stored as `agents/<agentId>.contentProfile.json`.

```json
{
  "agentId": "agent-jane",
  "contentEngineEnabled": true,
  "primaryFocus": "buyers",
  "voiceSamples": [
    { "type": "video_transcript", "content": "..." },
    { "type": "blog_post", "content": "..." },
    { "type": "email", "content": "..." }
  ],
  "voiceDescriptor": "<Claude-extracted, populated on activation, refreshable>",
  "forbiddenTerms": ["hustle", "grindset", "literally"],
  "forbiddenTopics": ["politics", "competing brokerages"],
  "contentVolume": "max",
  "cadence": "weekly",
  "deliveryDay": "monday",
  "deliveryTime": "07:00",
  "timezone": "America/Toronto",
  "activatedAt": "2026-05-15T14:00:00Z"
}
```

Fields explained:
- `primaryFocus`: `'buyers' | 'sellers' | 'both'`. Influences default-pick weighting, not content topic restriction.
- `voiceSamples`: 3-5 pieces of past content the agent feels sounds like them. Plain text OK; long-form welcome.
- `voiceDescriptor`: extracted on activation by a one-time Claude call against the samples. Refreshable on demand (e.g., agent rotates style).
- `forbiddenTerms` / `forbiddenTopics`: hard exclusions passed to every renderer.
- `contentVolume`: `'max' | 'balanced' | 'minimum'`. See §2.4.
- `cadence`: `'weekly'`. Reserved for future (`'biweekly'` may be added).

No brand assets in v1 — agent is copy-pasting/reading the content; sign-off and branding are theirs to add at publish time.

---

## 7. Review surface

The Monday-morning email an agent receives.

### 7.1 Channel

Email only. Sent from agent's own Gmail via existing OAuth, addressed to themselves. Mirrors the digest pattern.

No SMS for Content Engine — the batch is not urgent, requires desktop review (filming a Reel from a phone screen reading off another phone is unwieldy), and an SMS hook adds noise without value.

### 7.2 Subject and structure

```
Subject: Your content batch — <weekday>, <date> — <N> pieces ready

<one-line opener: "Light news week. Here's one strong angle." OR "Solid news week — 3 pieces ready.">

— This week's batch —

#1 REEL (recommended priority this week)
Angle: <headline>
Why this one: <one-sentence why-it-matters>

  [Script]
  <full script>

  [Instagram caption]
  <full caption>

  Sources: <citation list>
  [Approve] [Edit] [Regenerate] [Swap angle ▾]

#2 REEL
Angle: <headline>
Why this one: <one-sentence>

  [Script]
  <full script>

  [Instagram caption]
  <full caption>

  Sources: <citation list>
  [Approve] [Edit] [Regenerate] [Swap angle ▾]

#3 BLOG / NEWSLETTER POST
Angle: <headline>

  [Post]
  <full Markdown post>

  Sources: <citation list>
  Suggested target keyword: <phrase>
  [Approve] [Edit] [Regenerate] [Swap angle ▾]

— Other angles available this week —
(use Swap angle on any piece to switch to one of these)
- <angle headline 1>
- <angle headline 2>
- <angle headline 3>
- <angle headline 4>

— Heads up —
<optional: data freshness warnings, content engine status notes>
```

### 7.3 Approval / regeneration flow (v1)

v1 is **email-driven, lightweight**. No web dashboard yet (deferred to Onboarding & Light Management Page, Phase 4).

The email includes [Approve] / [Edit] / [Regenerate] / [Swap angle ▾] as **mailto:** links with structured subject lines (e.g., `mailto:agent-ai-content@<domain>?subject=APPROVE+angle-2026-05-15-001+reel`). An inbound handler parses the subject line and executes the action.

This piggybacks on the existing email-as-command infrastructure (parked item 7.8.11 in PROJECT_STATE). **The Content Engine review-action mailto: pattern requires the operations email domain to be set up first**, which means parked item 7.8.11 is a hard dependency on this build. See §8 HARD GATEs.

Interim option for first paying agent before ops email lands: agent replies to the review email with the action ("Approve all" / "Regenerate #2" / "Swap #1 to angle 3") and a separate parser handles plaintext replies. Less elegant, but unblocks shipping.

### 7.4 Regeneration soft cap

Per piece, per cycle: **5 regenerations max**. Tracked on `agents/<agentId>.contentState.json`:

```json
{
  "currentBatchId": "batch-2026-W20",
  "regenCounts": {
    "reel-001": 2,
    "reel-002": 0,
    "blog-001": 1
  },
  "swapCounts": {
    "reel-001": 1,
    "reel-002": 0,
    "blog-001": 0
  }
}
```

On the 6th regen attempt: the regenerated email reply still arrives, but the resulting message body is:
```
Hi <agent first name>,

You've regenerated <piece> 5 times this batch. The engine is happy to keep
generating, but at this point it's likely the angle itself isn't landing
rather than the prose. Two suggestions:

1. Swap angle: <link to swap-angle menu>
2. Edit by hand: reply with the version you'd like and the engine will
   capture the diff for voice-tuning signal.

If you genuinely want another regen attempt, reply "REGEN OVERRIDE <piece>".
```

The override path exists so the cap is friction, not a hard wall. Costs are tracked separately — if a single agent hits override repeatedly, flag in operator weekly digest.

---

## 8. HARD GATEs before first paying agent uses Content Engine

These must be cleared before any paying agent's Content Engine flag is flipped to `true`. Similar pattern to the Path 1A drafter HARD GATEs.

1. **Operations email infrastructure (parked PROJECT_STATE 7.8.11).** Content Engine review surface depends on a branded sender domain + inbound email parsing for the mailto: action pattern. This must ship before Content Engine has any agent in paid status. **Interim workaround** (plaintext-reply parser) acceptable for Mo's own dogfooding only.

2. **Renderer prompt iteration — all three renderers.** Same iteration loop as the Follow-Up + Path 1A HARD GATEs. Each renderer (`renderReelScript`, `renderInstagramCaption`, `renderBlogPost`) needs at least 3 distinct angle fixtures + 3-5 dry-run cycles to surface and fix prompt-quality issues before paying agents see output. Known-likely issues:
   - Reel scripts that read like blog posts (sentences too long for the ear)
   - IG captions that bury the hook past the truncation point
   - Blog posts with AI tells: "In conclusion," "It's important to note that," tri-colon listicles, "navigating the market"
   - Voice profile bleed: agent A's distinctive phrases leaking into agent B's output

3. **Data layer freshness verification.** Before Content Engine ships to any agent, every data source must have a verified successful pull within its expected interval AND a tested staleness-refusal path. The "TRREB changed their PDF format and we published stale numbers" failure mode is the single biggest reputation risk.

4. **Compliance check with Royal LePage** (or equivalent brokerage authority). 15-30 minute conversation with the brokerage compliance/marketing contact, covering: required disclaimers on rate content, brand-asset standards (even though v1 doesn't generate visual assets, content content has implicit brand impact), pre-approval requirements for agent-published content. Cheap to do; expensive to skip.

5. **Cost ceiling sanity check.** Per-agent monthly Claude API cost projection at `contentVolume: 'max'` should be < 5% of subscription price ($300/mo × 5% = $15/agent/mo budget). At ~10 Claude calls per batch × 4 batches/month × ~$0.10/call average = $4/agent/mo baseline. Soft cap on regenerations protects against worst case. Verify with first 4 weeks of real-agent usage before opening to additional agents.

---

## 9. Architecture

### 9.1 Module shape

```
src/content/
  pullData.js              data layer: pulls + caches all sources, region-keyed
  cache.js                 read/write helpers for data/market/
  angles.js                Claude call: data slice → menu of 5-8 candidate angles
  selectDefaults.js        deterministic per-agent default-pick scoring
  renderReelScript.js      Claude call: angle + voice → 60-90s script
  renderInstagramCaption.js Claude call: angle + voice + script → IG caption
  renderBlogPost.js        Claude call: angle + voice → 600-800 word blog post
  reviewEmail.js           composes the Monday review email
  actionHandler.js         inbound mailto: action parsing + dispatch
  state.js                 read/write helpers for agents/<id>.contentState.json
  profile.js               read/write helpers for agents/<id>.contentProfile.json
  voiceExtract.js          Claude call: voice samples → voice descriptor
  engine.js                orchestrator: runContentEngineForAgent(agentConfig)
data/
  market/
    canada/YYYY-WW.json
    toronto/YYYY-MM.json
    _angles/YYYY-WW.json   shared per-week angle menu
    _pullLog.jsonl
    raw/<source>/
agents/
  <agentId>.contentProfile.json
  <agentId>.contentState.json
```

Per-agent orchestrator loop in `src/index.js` gains a `maybeRunContentEngine(agentConfig)` call alongside `runFollowUps`, `maybeRunDailyDigest`. Same rhythm, same toggle pattern. Bails early on most cycles (the time-gate + idempotency check is cheap).

### 9.2 Scheduling

Three distinct schedules:

1. **Data pull cycle** — runs every 6h weekdays, 12h weekends, independent of per-agent loop. Cron or Railway scheduled task. Entry point: `runDataPullCycle()`.
2. **Weekly angle generation** — runs Monday 4:00 AM local, populates `data/market/_angles/YYYY-WW.json`. Entry point: `generateWeeklyAngles()`. Triggered from data pull cycle's Monday early-morning run.
3. **Per-agent batch send** — runs in the existing per-agent loop, time-gated to Monday 7:00 AM ± 1h grace window. Entry point: `runContentEngineForAgent(agentConfig)`. Idempotency via `agentState.lastContentBatchSent` timestamp.

The per-agent step is fast because all expensive work (data pulls, angle generation) already happened upstream. Per-agent batch is just: pick defaults → run renderers → compose email → send.

### 9.3 Failure handling

- Each renderer call wrapped in try/catch.
- Per-piece failure does not block batch — if `renderBlogPost` fails 3x, the batch ships with the Reels and a note "Blog post couldn't be generated this week — engine will retry on next batch."
- Batch send wrapped same as digest: 3 retries with exponential backoff. On exhaust: log + email Mo.
- `agentState.lastContentBatchSent` only updates on successful batch send.

### 9.4 Testing strategy

Same Jest + MOCK_NOW pattern as digest:

- **Unit tests for renderers** take a fixture angle + fixture voice profile and assert structural properties (length range, presence of hook/body/CTA, no banned terms, sources cited). Cannot assert prose quality — that's the prompt iteration HARD GATE.
- **Unit tests for `selectDefaults`** — deterministic scoring, fully testable. Cover the boost/penalty cases.
- **Unit tests for `cache.js`** — read/write + staleness checks.
- **Unit tests for `angles.js`** — mock Claude response, assert parsing/validation.
- **Integration test** — set MOCK_NOW to Monday morning, seed cache + angle menu, call `runContentEngineForAgent`, assert email contents and send attempt (mocked Gmail).
- **Live dry-run** — `options.dryRun: true` produces the batch but addresses only Mo's inbox. Used for the prompt-iteration HARD GATE.

### 9.5 Shadow Mode interaction

Content Engine has its own Shadow Mode equivalent: `contentEngineMode: 'shadow' | 'live'` (default `'shadow'` on activation).

- In shadow: review emails send only to Mo + agent. Agent reviews 2-3 cycles before flipping to live.
- In live: review emails send to agent only. Mo no longer auto-CC'd unless agent opts in.

Distinct from `isAiEnabled` (which controls Reply Detection's shadow vs. live for outbound emails). Independent toggles.

---

## 10. Out of scope for this session

- Auto-publish to email lists (Mailchimp, ConvertKit, Beehiiv)
- Auto-publish to social (Buffer, Hootsuite, Later)
- Web dashboard for review (deferred to Onboarding & Light Management Page, Phase 4)
- Image / B-roll generation
- Listing-specific reactive content
- Audience-segment variants (first-time buyer / move-up seller / investor)
- Hyperlocal / FSA-level data
- Multi-language
- LinkedIn long-form renderer (stage 2)
- Market-update PDF / one-pager renderer (stage 2)
- Big 6 bank quarterly earnings data source (stage 2)
- Provincial / federal policy news as data source (stage 2)
- Voice-tuning feedback loop processing the captured edit diffs (stage 3 — capture in v1, process later)
- Cost dashboard / per-agent API spend tracking (stage 2)

---

## 11. Build order for session 18+

This is a multi-session build. Suggested ordering by dependency, not by session boundary:

1. `src/content/cache.js` — read/write helpers + canonical schema validation. Foundational, testable in isolation.
2. `src/content/pullData.js` — one source at a time. Start with BoC Valet API (easiest, JSON, free). Then CREA, StatCan, then TRREB scrape last (hardest, most likely to break).
3. Data freshness monitoring section in operator weekly digest.
4. `src/content/profile.js` + `voiceExtract.js` — agent profile read/write + one-time voice extraction Claude call.
5. `src/content/angles.js` + `selectDefaults.js` — weekly angle generation + deterministic pick.
6. `src/content/renderReelScript.js` skeleton + prompt v0 + unit test fixtures.
7. `src/content/renderInstagramCaption.js` skeleton + prompt v0.
8. `src/content/renderBlogPost.js` skeleton + prompt v0.
9. `src/content/reviewEmail.js` — composes the Monday email from rendered pieces.
10. `src/content/state.js` — regen/swap counters, idempotency.
11. `src/content/engine.js` — `runContentEngineForAgent` orchestrator.
12. Scheduler hook in `src/index.js` — `maybeRunContentEngine`.
13. Integration test under MOCK_NOW.
14. Live dry-run round 1 against Mo's inbox.
15. **HARD GATE: prompt iteration cycle** — 3 distinct angles, 3-5 dry-runs, refine all three renderer prompts.
16. Action handler (`actionHandler.js`) — depends on operations email infrastructure being live.
17. Final live verification + commit + PROJECT_STATE update.

---

## 12. Parked items to add to PROJECT_STATE after Content Engine ships

**[Session 18] Audience-segment variants for Content Engine.**
- **What:** Optionally render each piece in multiple variants tuned for distinct audience segments (first-time buyer / move-up seller / investor / past client). Same angle, different framing.
- **Why parked:** Adds 3x render cost per piece. v1's single-variant "informed homebuyer/seller" framing covers most agent needs.
- **Build trigger:** when a paying agent specifically requests segment variants, OR when usage data shows agents are heavily editing the default variant in a directional way that suggests they want a specific segment.

**[Session 18] Market-update PDF / one-pager renderer.**
- **What:** Monthly visually-formatted PDF summarizing key Canadian/Toronto stats. Agent uses as listing-presentation leave-behind, open-house handout, WhatsApp-group share. High perceived value.
- **Why parked:** Distinct effort — needs PDF templating + design-quality layout. v1 ships text content only.
- **Build trigger:** after first 30 days of v1 usage, OR when an agent explicitly asks for "something I can hand out."

**[Session 18] LinkedIn long-form renderer.**
- **What:** 400-600 word LinkedIn-shaped variant of the blog post. Hook-driven, no H2s, ends with engagement question.
- **Why parked:** Marginal add over blog renderer; agent can paste blog post into LinkedIn article composer for now.
- **Build trigger:** opportunistic — first time the blog renderer prompt iterates significantly, add LinkedIn as a sibling.

**[Session 18] Voice-tuning feedback loop for Content Engine.**
- **What:** Process captured `original → edited` diffs from `contentState.json` to evolve the agent's voice descriptor over time. Same pattern as the parked Path 1A drafter voice-tuning item.
- **Why parked:** Needs 30+ days of real edit signal per agent. v1 captures the data; processing happens later.
- **Build trigger:** ~50 captured diffs per agent of real signal, OR voice drift visibly degrading output.

**[Session 18] Big 6 bank quarterly earnings data source.**
- **What:** Quarterly content angle around RBC/TD/BMO/Scotia/CIBC/NBC earnings commentary on Canadian housing. Strong angle source 4x/year.
- **Build trigger:** when angle quality stalls in slow data weeks AND/OR when an agent specifically asks about bank commentary.

**[Session 18] Cost dashboard / per-agent Claude API spend tracking.**
- **What:** Operator-level visibility into Claude API costs broken down per agent. Validates the 5%-of-subscription cost ceiling assumption (HARD GATE 5).
- **Build trigger:** when Mo onboards the 3rd paying Content Engine agent, OR if any single agent exceeds $20/month in API cost.

**[Session 18] Content Engine integration with Onboarding & Light Management Page (Phase 4).**
- **What:** Web UI for profile editing, voice sample upload, regen/swap actions (replacing the mailto: action handler).
- **Why parked:** Onboarding page is already its own Phase 4 deliverable.
- **Build trigger:** when Onboarding page work begins.

---

## 13. Open questions for next iteration

Deferred to post-build review (likely after first 30 days of dogfooding):

- **Cadence vs. data reality.** Is "up to 2 Reels + 1 blog weekly" actually achievable across 52 weeks/year without filler, given the Canadian data calendar? Re-evaluate after 12 weeks of real angle generation. May tune defaults down to "1 Reel + 1 blog weekly" if quality is uneven.
- **Voice profile decay.** Does the voice descriptor extracted from initial samples still match the agent's current style after 90 days? May need scheduled re-extraction from recently-approved content.
- **The "approve all" reflex.** If most agents approve every piece without edit, is that a sign the content is great, or that the review UX makes editing too friction-y? Watch the approve-without-edit rate; healthy is probably 50-70%, not 95%+.
- **Single best stat per week.** Some weeks one stat is overwhelmingly the story (BoC week, federal budget week). Should the engine collapse to 1 piece those weeks rather than 2 Reels + 1 blog around variants of the same theme?
- **Render in agent's vs. Claude's vocabulary balance.** Voice profiling pushes prose toward the agent's voice. But agents may not have crisp ways to explain bond-yield mechanics. Where's the line between "in their voice" and "borrowing Claude's vocabulary because the agent's voice can't explain this clearly"? Worth a dedicated review after first paying agent.
