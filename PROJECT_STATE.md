# PROJECT_STATE.md - agent-ai

**Last updated:** end of Session 11 (2026-05-08)
**For:** future Claude chats inside this Project, so a brand-new conversation can pick up where the last one ended without re-asking Mo for context.

This is the single source of truth for everything that has happened, every decision that has been made, every thing parked for later, and everything still to do. If a new session starts and there is any conflict between what is in here and what Claude remembers, this document wins.

**Maintenance rule for future Claude:** When generating a new PROJECT_STATE at end of session, EDIT this file surgically. Do not rewrite from scratch. Read the existing version in context, preserve everything still accurate, change only what changed. This rule exists because regenerating from scratch wastes 10-15 minutes per session and burns Mo's usage. Mo set this rule at the end of session 6.

---

## 0. Quick orientation (read this first if you are a fresh session)

**Who:** Mo Mohamed. Real estate agent at Royal LePage Burloak in Burlington, Ontario. Building agent-ai as a side project that he eventually wants to turn into his primary business.

**What he is building:** A multi-tenant AI automation system for real estate agents. Each agent gets a system that reads their inbound leads, replies on their behalf in their voice, follows up on a schedule, alerts them on hot leads via SMS, and generates a daily digest of activity. Two pricing tiers: Starter ($500/month) and Starter+Content ($800/month, where the $300 add-on is a Weekly Content Engine that produces social posts and newsletters).

**Where he is in the build:** **Phase 1 (Reply Detection) is complete and live-tested. Phase 2 (Rest of Starter) is in active build, ~75% done.** Sessions 10-11 shipped three Phase 2 commits: SOI protection layer (`0e900be`, session 10), Lead Intake Tier 2 heuristic classifier (`15920ff`, session 11), and Follow-Up Sequences with CALLED/RESUME commands (`8fa8bda`, session 11). Phase 1 narrative continues unchanged below — session 9's webhook test passed end-to-end. After session 11, what's left in Phase 2: Daily Digest, end-to-end orchestrator integration test, and a handful of parked polish items. Lead Intake Tier 1 parsers (Realtor.ca etc.) deferred — Mo doesn't generate that traffic personally so we skip parsers until a real agent does.

After Phase 2 wraps, Phase 3 is the Content Engine (spec needed first), Phase 4 is the Onboarding page + Railway deploy + demo prep, then first paying agent. **Critical gates before first paying agent goes from shadow → live:** (1) a dedicated prompt iteration session against real lead-reply data, (2) Path 1B SMS must include property reference (Claude extraction at fire time), and (3) live verification of Lead Intake and Follow-Up Sequences against Mo's own Gmail before any agent depends on them. All three locked.

**How Mo works:** Solo developer, non-developer background, building everything via Claude Code in a terminal on his MacBook. He pastes terminal output, Claude reads it and gives him next-step Claude Code prompts to paste back. Claude is the architect and senior reviewer; Claude Code is the typing hands.

**Session opener convention (use every time Mo says "let's continue" or similar):** Open the response with this three-section checklist, then proceed to work. No process narration around it. If something is genuinely off (uncommitted changes, working dir mismatch, weird git state), add a `⚠️ Heads up` block above the three sections.

```
✅ Done last session
- <commit summary, hash>
- <commit summary, hash>

🔄 Working on now
- <single focus item for this session>

📋 Left in <current phase>
- [ ] <item>
- [ ] <item>

📋 Left after <current phase>
- [ ] <item>
- [ ] <item>
```

Mo set this convention at end of session 6. Real checklist with checkbox glyphs, grouped by phase, not a comma-cram. Three sections (done / now / left). Get to work after.

**How Claude should respond:**
- Senior-engineer mindset always. Real code review, not rubber-stamping. Flag duplication, structural rot, performance bottlenecks, maintainability risks.
- Explain in plain language. Mo is leveling up as a builder but isn't a backend specialist. When using technical terms (e.g. "module," "dispatcher," "idempotent," "race condition"), define them on first use in a session. Senior-engineer thinking stays; the vocabulary should match the audience. If a concept needs more than a sentence to explain, it gets a small explanation block, not a wall of jargon. (Mo's verbatim instruction, end of session 6.)
- Push back honestly when Mo is wrong. Volunteer the better way. Do not flatter.
- Verify reality, not API success. Tests must confirm the actual side effect (SMS delivered, email arrived, cell changed), not just that an API returned without throwing.
- No em-dashes anywhere in any file, ever. Absolute rule. Run `grep -n "[--]"` on every file Claude touches before considering the work done. NOTE: there are 3 intentional pre-existing em-dash matches in `src/prompts.js` (around lines 265, 366, 457) inside the prompt strings that *ban* em-dashes, where the literal character is the subject of the rule. These are correct and intentional. Do not "fix" them.
- When grepping for code, search `src/` broadly first. Don't guess at file locations or assume something lives where it "should", that bias caused a wrong-verdict moment in session 6. The row-builder in `src/gmail.js:420-437` was where row construction lived; it took two rounds of grepping to find it.
- Test passes ≠ production works. Always verify the field/contract Claude Code uses in the test exists in production code paths too. Session 6 caught a near-miss where Claude Code used `row.conversationHistory` correctly, but a less rigorous reviewer might have shipped it without confirming `gmail.js:COLUMN_MAP` actually populates that field.

**Current branch:** `main`. Three commits across sessions 10-11, all green. Latest is `8fa8bda` (Follow-Up Sequences + CALLED/RESUME). Git config still auto-generated (`mohanadmohamed@Mohanads-MacBook-Pro.local`); not blocking. (Fix anytime: `git config --global user.name "Mohanad Mohamed"` and `git config --global user.email "<email>"`.)

**Working directory on Mo's machine:** `~/Documents/agent-ai`

---

## 1. Product summary

### 1.1 What the product is

Real estate agents at brokerages like Royal LePage are drowning in lead replies. Most of those replies are mundane (general questions, polite stop signals, scheduling) and a few are critical (offers, hot interest). Agents miss the critical ones because they get buried.

agent-ai sits between the lead and the agent. It reads inbound replies in the agent's Gmail, classifies them, and either drafts a personalized reply on the agent's behalf, alerts the agent via SMS for hot leads, escalates ambiguous replies for human review, or politely closes out leads who have opted out. The system speaks in the agent's voice using a per-agent persona configuration.

The pitch to agents: "I will give you back the time you currently spend triaging your inbox, while making sure you never miss a deal-ready signal. Your first week is Shadow Mode, you will see every draft before it goes out, no risk."

### 1.2 Pricing tiers

- **Starter, $500/month:** Lead Intake, Qualification, Follow-Up Sequences (Day 3, 7, 14), Reply Detection (5 categories), Daily Digest, Hot Lead SMS. The full inbound-and-followup loop.
- **Starter + Content, $800/month:** Everything in Starter plus the Weekly Content Engine, a $300 add-on that produces weekly social posts, newsletter content, and market-update graphics. Spec for this is not yet written.

### 1.3 Target customer

Real estate agents at major Canadian brokerages, starting with Royal LePage (the broader brokerage; Mo's specific office is the Burloak branch but his beachhead access extends to other RLP offices) and expanding outward. The agent persona's brokerage field is "Royal LePage", not "Royal LePage Burloak" — agents identify with the parent brand for sign-offs and lead-facing communications. Most of these agents:
- Are in Ontario (Toronto and surrounding area)
- Use Gmail for their work email
- Use a CRM like Follow Up Boss, kvCORE, Wise Agent, BoldTrail, or LionDesk (or, more often, no CRM and a messy Gmail inbox — confirmed via session 11 Reddit research where multiple agents reported they "don't use CRMs and have their own systems," with Instagram and Facebook as primary lead sources)
- Have a personal phone number for SMS, which is also the number leads have
- Are not technical and do not want to be

The "no CRM" reality matters strategically: the competitive landscape for these agents isn't Lofty/CINC/Follow Up Boss (entrenched CRM platforms with high migration cost). It's the agent's messy Gmail and a notebook. That's a much easier substrate to displace.

### 1.4 The trust problem and how Shadow Mode solves it

The biggest selling risk: an agent signs up, the AI's first message is tone-deaf, the agent fires the product and tells everyone in their brokerage. Business dies before it starts.

**Shadow Mode** is the seatbelt. New agents are created with `mode: "shadow"`. For the first 7 days, the system does everything it would normally do (reads replies, categorizes, drafts) except it never sends to the lead. Every draft is sent to the agent instead, with `[SHADOW DRAFT]` prepended to the subject. After 7 days the agent (or Mo) flips the mode to `"live"` and the system starts sending to leads.

**Crystallized definition (session 6, Mo's verbatim):** "Shadow Mode reroutes lead-facing emails to the agent for review. SMS, sheet writes, column L logs, escalation emails are unchanged between modes."

That's the canonical rule. Only lead-facing emails change destination. Everything else is identical between Shadow and Live.

Shadow Mode lives in the path layer (paths.js), not in the email provider layer (gmail.js). gmail.js is a dumb provider; it sends to whoever you tell it to. Each path that drafts a lead-facing message branches:

```js
if (agent.mode === 'shadow') {
  const wrapped = buildShadowDraftWrapper(row.leadId, draftBody);
  await email.sendNewEmail(agent, agent.gmailAddress, wrapped.subject, wrapped.body);
} else {
  await email.sendReply(agent, row.leadId, msg, draftBody);
}
```

The `buildShadowDraftWrapper(leadEmail, draftBody)` helper lives in `src/paths.js`. It returns `{ subject: '[SHADOW DRAFT]', body }` where the body wraps the draft in a 3-line preamble: "This is a draft. The lead did NOT receive this message. / If you want to send your own version, reply at <leadEmail>. / --- / <draft>". Helper is path-agnostic (subject prefix is just `[SHADOW DRAFT]`, no path number) so agents see one consistent mental model. Reused by Path 3 and Path 1A; Path 1B doesn't use it because Path 1B has no lead-facing email.

Why this layering matters: if Outlook support is added later, Shadow Mode logic should not need to be reimplemented in `outlook.js`. It is a product policy, not a provider concern.

Paths 2 (hot_signal) and 4 (needs_review) are inherently agent-facing, so Shadow Mode does not apply to them. Path 1B has no lead-facing email at all, so Shadow Mode is also a no-op there. Paths 1A and 3 are lead-facing and respect Shadow Mode.

### 1.5 The pitch in one sentence (added session 11 from competitive research)

**"Speed-to-lead in Shadow Mode, then on autopilot."**

That is the wedge. Empirical anchor: the average human agent takes ~15 hours (917 minutes) to respond to a new lead, and leads contacted within 5 minutes are 21x more likely to qualify than those contacted after 30 minutes. This stat appears in nearly every "best AI tools for real estate" listicle and competitor pitch. It's the industry's most-cited number.

Three-part product narrative:
1. **Speed-to-lead** is the empirical promise. Replies in under 5 minutes during the agent's day.
2. **Shadow Mode** is the trust mechanism. First 7 days the agent reviews every draft before it sends.
3. **Then autopilot** is the aha moment. After 7 days the agent flips live and the system runs without daily attention.

If a feature does not ladder up to "speed-to-lead in Shadow Mode then autopilot," it is a Phase 4+ feature. This is the test for any new module.

Reread this section before every prompt-iteration session, every onboarding script, every demo deck.

### 1.6 Canadian-market positioning (added session 11)

Most US-recommended AI real estate tools simply do not work in Canada, and this is a real moat:

- **Zillow API:** US-only, no Canadian listings.
- **ATTOM Data:** US-only.
- **Homesage.ai:** all 50 US states, no Canadian provinces.
- **Realtor.com APIs:** US-only.
- **Predictive seller-likelihood tools (Offrs, Revaluate, SmartZip):** US-only, rely on US public records.
- **Voice AI (Retell, Synthflow, 11x):** technically work in Canada but telecom costs make outbound voice automation cost-prohibitive at the volume an individual agent generates.

The closest Canadian-native option for the inbox-triage problem we're solving is... nothing. The Reddit thread that prompted this research had zero Canadian tools mentioned across 47 comments.

Implication for positioning: Royal LePage and other Canadian-brokerage agents who want AI today don't have a Canadian-native option. We are early. A Toronto-area agent comparing tools sees mostly US products that either explicitly exclude Canada or have hidden gaps. agent-ai works in their market natively.

This is also why we will not invest in the Realtor.ca scraper Tier 1 parser ahead of need — the Canadian listing-data integration story is genuinely hard (no public API, scraping legally fragile, MLS direct access requires brokerage agreements). Wait until a real paying agent demands it. Until then the Tier 2 heuristic classifier handles direct emails fine.


---

## 2. Build status by module

Legend: ✅ done, 🔨 in progress, ⏭️ next planned, 📋 parked.

### 2.1 Foundation (done)

- ✅ Project scaffolding (`package.json`, `.env`, `.gitignore`, OAuth2 setup)
- ✅ Agent config schema (`agents/mo-test.json`, 24 fields, mode: shadow). Gitignored locally.
- ✅ `client_secret_*.json` and `.env` gitignored.
- ✅ `scripts/authorize.js` (OAuth flow, refresh-token capture)
- ✅ `scripts/setup-sheet.js` (creates and validates the per-agent Google Sheet)

### 2.2 Source modules

- ✅ `src/agentConfig.js` - load and validate agent JSON, throw on missing/invalid fields. **Session 10:** added `isLeadCategoryActionable(row)` helper, returns false only for exact case-insensitive 'soi' match (with trim), true for everything else including empty/undefined. Wired into `processAgent` Step 1 validation gate. **Session 11:** added `getFollowUpCadence(agent)` helper with default fallback `[3, 7, 14]`, validates that `agent.followUpCadence` is an array of positive integers; on invalid config, logs warning and returns default.
- ✅ `src/prompts.js` - all prompt builders (categorization, Path 1A draft, Path 1B draft, Path 3 draft, banned phrases helpers, sign-off block). **Session 5:** Path 1A accepts `conversationHistory`; Path 3 accepts `categorizerReasoning` for tone calibration; new `getMergedBannedPhrases(agentConfig)` returns deduped array. **Session 6:** added 6th categorizer category `conversation_continue` for replies that are not questions and not hot/stop (lead answering our prior question, sharing context, acknowledging). `answer_general` got a clarifying boundary sentence steering non-question replies into `conversation_continue` instead. Path 1A draft prompt got a new `FOLLOW UP QUESTION (OPTIONAL)` block instructing Claude to add ONE soft conversational follow-up when natural, with explicit skip conditions (emotional/hesitant messages, prior unanswered follow-up still pending, very simple questions, leads who are clearly ready to act). This is how multi-turn qualifying happens without column M state, Claude reads conversation history and asks the next natural question. **Session 11:** added `buildHeuristicClassifierPrompt` (3-class email triage for Lead Intake Tier 2: lead/noise/business_correspondence with explicit "default to business_correspondence when uncertain" rule and confidence floors); added `buildFollowUpDay3Prompt`, `buildFollowUpDay7Prompt`, `buildFollowUpDay14Prompt` for the Follow-Up Sequences module. Day 14 prompt has a Day 14-specific banned phrases list appended to the merged set: `'last follow-up'`, `'final message'`, `'last attempt'`, `'wrapping up'`, `'closing the file'` — Mo's verbatim rule that Day 14 must not signal closure to the lead.
- ✅ `src/claude.js` - Anthropic SDK wrapper. Has `categorize()` returning `{category, confidence, reasoning, downgraded, originalCategory}`, and `draft()` returning `{text, violations, attempts, escalate}`. Banned-phrase retry loop (max 3 attempts) lives here. Em-dash strip applied to all model output before return. **Session 11:** added `callRaw({ system, user, model?, maxTokens? })` low-level wrapper that returns raw model text without domain-specific parsing. Used by callers (Lead Intake heuristic classifier) that need a system+user prompt call but validate the response themselves. Defaults: model = `MODELS.CATEGORIZATION` (Haiku), maxTokens = 512. Refactor rationale: every Claude call goes through this module — no caller instantiates the SDK directly — so retry policy, error handling, and rate-limit semantics stay consistent across the codebase.
- ✅ `src/email.js` - Provider-agnostic dispatcher, 12 functions, all thin pass-throughs to gmail.js (or future outlook.js). Switch on `agentConfig.provider` (defaults to 'gmail'). Single seam for testing and provider swap.
- ✅ `src/gmail.js` - Gmail and Sheets implementation. OAuth client cache, MIME builder, fetchUnreadReplies (N+1 fetch, fine at our scale), getMessage, getThreadHistory, searchEmails, sendReply, sendNewEmail, markRead, getSignaturePresence, readSheetRows, updateSheetRow, appendSheetRow, appendToConversationHistory. **Session 5 fix:** non-ASCII characters in Subject headers (emoji, accented letters) are now wrapped in RFC 2047 encoded-word format (`=?UTF-8?B?<base64>?=`) via the new `encodeHeaderValue()` helper. Pure-ASCII subjects pass through unchanged. Helper is generic and exported in `_internal` so it can be reused for From/To/Cc display names later. **Session 10:** COLUMN_MAP gained `leadCategory: 'T'`; readSheetRows range A2:S → A2:T; appendSheetRow range corrected from stale `A:R` to `A:T` (the stale range was a latent bug — operatorEscalated column S was already in the schema from session 7 but appendSheetRow's range parameter pointed at R; no functional impact because the Sheets API uses range only for tab targeting, row data length determines actual cells written, but worth fixing for clarity). **Session 11:** added `extractTextBody(payload)` recursive MIME walker, `fetchUnreadInboxEmails(agentConfig)` (replies + Lead Intake fetch source), `listLabels`, `createLabel`, `applyMessageLabels(agentConfig, messageId, addLabelIds, removeLabelIds)` for Lead Intake's idempotency-via-label pattern.
- ✅ `src/twilio.js` - SMS send with retry (1 retry, 3s backoff). Templates: `hotLeadAlert`, `path1BAgentQuery`, `path1BReminder`, `urgentNeedsReview`, and `leadPropertyQuestion`. **Session 8 update:** `leadPropertyQuestion` signature changed from `(leadName, leadEmail, question)` to `(leadName, leadEmail, question, token)` to support token-based handler routing. New body format: `[${token}] ${leadName} (${leadEmail}): "${question}"\n\nReply: ${token} <your answer>`. **Session 5 fix:** `verifyDelivery(client, sid)` polls Twilio after `sendSMS`/`sendSMSTo` (3 attempts, 1 second apart), throws on `failed`/`undelivered`. Caught a real bug: Twilio API success does not equal carrier delivery. Now exported in `_internal`.
- ✅ `src/paths.js` - Path layer, **5/5 done as of session 6**. All paths follow the same contract: `async function pathX(agent, row, msg, cat) -> {ok, actions, skipped, errors}`. Paths catch their own errors and never throw. Only the critical step (Sheet update) determines `ok`. Exports: `pathHotSignal`, `HOT_SMS_CONFIDENCE_THRESHOLD`, `pathNeedsReview`, `URGENT_KEYWORDS`, `pathStopSignal`, `pathAnswerGeneral`, `pathAskAgent`, plus internal helper `buildShadowDraftWrapper(leadEmail, draftBody)` reused across Path 3 and Path 1A. Per-path notes:
  - `pathHotSignal` (Path 2, session 5): SMS gated by `HOT_SMS_CONFIDENCE_THRESHOLD = 0.85`.
  - `pathNeedsReview` (Path 4, session 6): keyword-gated urgent SMS. Keywords: `lawyer`, `attorney`, `complaint`, `dispute`, `legal action`. NO confidence gate on the urgent SMS, keyword presence alone determines firing. Decision rationale: hot_signal gating is about not falsely claiming a positive event; needs_review escalation gating would filter on the wrong signal.
  - `pathStopSignal` (Path 3, session 6): first path that uses Claude for drafting. Banned-phrase 3-retry loop via `claude.draft`. On exhaustion, falls back to a hardcoded safe template ("No problem, I'll take you off the list..."). Mode-gated email: shadow → agent's gmail with `[SHADOW DRAFT]` prefix and a 3-line preamble; live → `sendReply` to lead.
  - `pathAnswerGeneral` (Path 1A, session 6): handles BOTH `answer_general` AND `conversation_continue` categories. Reads `row.conversationHistory` (auto-populated from column L by `gmail.js`'s row builder, no separate sheet read). Status semantics differ: `warm` on Claude success, `needs_review` on fallback. Fallback template is a holding message ("Great question. Let me check on this and get back to you with a complete answer shortly.") AND fires an additional `[ESCALATION]` email to `escalationEmail` flagging that Claude failed.
  - `pathAskAgent` (Path 1B initiation, session 6, **refactored to queue model in session 8**): no Claude drafting. **NEW (session 8):** issues a fresh token via `agentState.issueToken(agentId)` first (Step 0), then reads existing column M, parses entries via `parsePendingQuestions`, appends `{token, question}`, serializes back, writes the full queue. SMS template now receives the token as a 4th arg. Status → `awaiting_agent`, sends SMS to agent (NO confidence gate), notification email to escalationEmail. Result includes `actions.tokenIssued` for observability. Order matters: token issuance happens before any Sheet write so a Sheet failure burns a token (gap, harmless) rather than orphaning a token in the Sheet without persistence. Deliberately no holding email to the lead. Function name `pathAskAgent` reflects what it does, not what category triggers it.
- ✅ `src/pendingQuestions.js` (**session 8, NEW**) - pure parser/serializer for the column M queue. Four functions: `parsePendingQuestions(cellValue)` → array of `{token, question}`, `serializePendingQuestions(entries)` → `[Q47] foo || [Q48] bar` string, `findEntryByToken(entries, token)` → entry or null (case-insensitive), `removeEntryByToken(entries, token)` → new array (immutable, case-insensitive). Strict regex `^\[Q(\d+)\]\s+(.+)$`. Known limitation: lead questions containing the literal `||` separator get truncated at the separator. No I/O, no logging, no external deps.
- ✅ `src/agentState.js` (**session 8, NEW**) - per-agent JSON state file at `agents/<agentId>.state.json` (gitignored). Three functions: `getState(agentId)` → state object (default `{ lastTokenIssued: 0 }` if file missing, throws on malformed JSON), `setState(agentId, state)` → atomic write via tmp-file-then-rename (prevents partial-write corruption), `issueToken(agentId)` → reads state, increments `lastTokenIssued`, writes back, returns `"Q<n>"`. Single-threaded sequential per-agent processing means no locking needed today. Created to hold agent-level metadata that doesn't fit in the row-based Sheet schema. Pivoted from earlier "Column T in Sheet" plan after realizing single-value agent metadata doesn't fit a row model.
- ✅ `src/webhook.js` (**session 9, NEW**) - Express server for inbound Twilio SMS, the Agent SMS Reply Handler. Loaded with `require('dotenv').config()` at top (the bug from commit 5: webhook.js doesn't auto-inherit env loading from index.js — every entrypoint needs its own `dotenv.config()` call). Single endpoint `POST /sms-incoming` accepts Twilio's `application/x-www-form-urlencoded` payload. **Security layers** (commit 2, `8afc25d`): (a) Twilio signature verification via `twilio.validateRequest()` against `req.protocol + req.get('host') + req.originalUrl`, with a hardened bypass that fires only when `WEBHOOK_SKIP_SIGNATURE_CHECK === 'true'` AND the host matches `localhost`/`127.0.0.1`/`*ngrok*` (case-insensitive substring); a startup warning logs to console when bypass is enabled; (b) idempotency via in-memory `Map<MessageSid, timestamp>` with 5-minute TTL and 60s cleanup interval (`.unref()`'d so it doesn't hold the Node process open in tests); (c) agent lookup via `findAgentByPhone(req.body.From)`; unknown phone returns 200 with empty TwiML and logs a warning. **Token parsing**: liberal regex `/Q\s*-?\s*(\d+)/gi` accepting `Q47`, `q47`, `Q47:`, `Q47 -`, `Q-47`, `Q 47`. Returns `{ type: 'none'|'single'|'multi', token }`. **Async dispatch pattern**: endpoint responds 200 with empty TwiML immediately, then `setImmediate(() => handleAgentReply(...).catch(...))` runs the real work. Twilio retry timeout (~15s) cannot be exceeded by Claude/Gmail latency. **Handler logic** (commit 3, `698436d`): (PATH ALPHA single-token-found) cross-row scan via `parsePendingQuestions` + `findEntryByToken`, build prompt via `buildPath1BDraftPrompt`, call `claude.draft` with `getMergedBannedPhrases`, on `result.escalate === true` send fallback SMS to agent and PRESERVE the queue entry (early return — never send escalated drafts), shadow-mode email via `buildShadowDraftWrapper` to `agent.gmailAddress` or live-mode `email.sendReply` to lead with thread-fetched subject (try/catch fallback to `Re: Your question`), defensively re-read the row before queue update (in case another Path 1B fired while drafting), remove just that token's entry, status → `warm` if remaining queue empty otherwise `awaiting_agent`, update column P, append column L. (PATH BETA token-not-found) and (PATH GAMMA no-token or multi-token) → `sendOpenQuestionsSuggestion(agent, body, reason, badToken)` SMSes the agent a list of all open tokens across all rows, formatted `<token> (<leadName>): "<question>"`, with three reason-specific opening lines. **All errors caught and logged** — `handleAgentReply` never throws because the 200 has already been sent. Exports: `createApp`, `handleAgentReply`, `sendOpenQuestionsSuggestion`. Live-tested end-to-end via real ngrok tunnel + real Twilio webhook + real SMS from Mo's phone, full pipeline confirmed.
- ✅ `src/index.js` - The orchestrator. **Session 11 expansion: 5-step pipeline.** Step 0 (NEW, session 11): `runLeadIntake(agent)` runs first, before Sheet validation, so newly-intaken rows are visible to downstream steps. Wrapped in try/catch — Lead Intake failures do not cascade. Step 1 (agent discovery, Sheet validation, filtering — now includes `isLeadCategoryActionable` SOI filter from session 10). Step 2 (fetch unread, categorize via Claude, log to column L). Step 3 (path dispatch via `executePath`, with the markRead-on-success contract). Step 4 (`checkStaleQuestions` scanning awaiting_agent rows for 2hr reminder and 24hr operator escalation). Step 5 (NEW, session 11): `runFollowUps(agent)` time-triggered follow-up dispatch, also wrapped in try/catch. Helper `sendOperatorEscalationEmail` lives here too. `processAgent` and `checkStaleQuestions` are both exported, guarded by `require.main === module` so smoke scripts can require them without auto-running main(). Note: main() currently double-loads agent config (once inside processAgent via id, once for checkStaleQuestions). Acceptable v1 cost; refactor parked. See section 7.4.
- ✅ `src/leadIntake.js` (**session 11, NEW**, commit `15920ff`) - Lead Intake Tier 2 heuristic classifier. Reads agent's unread Gmail inbox, applies code-level pre-filters (reply detection, calendar domain, empty/short body, idempotency labels), labels survivors with `agent-ai/processing` BEFORE classification (idempotency marker), classifies via Claude Haiku into one of three categories: `lead`, `noise`, `business_correspondence`. **Branching:** lead (confidence ≥ 0.6) → write Sheet row with `aiEnabled=FALSE` + `agent-ai/intaken` label + mark read. Noise (confidence ≥ 0.85) → `agent-ai/noise` label + mark read, no Sheet row. Business correspondence (default for everything else, including low-confidence lead/noise) → remove processing label, leave unread, no Sheet row. **Per-cycle cap:** 20 classifications max. **Dedup:** if classified-as-lead sender already exists in column A, append column-L re-engagement entry to existing row, no new row. **Architecture:** routes through `claude.callRaw` (added to claude.js this session) so all Anthropic calls share one wrapper. Uses existing `gmail.fetchUnreadInboxEmails`, `gmail.listLabels`, `gmail.createLabel`, `gmail.applyMessageLabels` helpers (added to gmail.js this commit). Tier 1 source-specific parsers (Realtor.ca etc.) explicitly deferred — Mo doesn't generate that traffic; ship parsers when a real agent does. **Live verification status:** OAuth scope and label-list verified via test script in session 11; full live run against Mo's inbox deferred to a focused session.
- ✅ `src/followUp.js` (**session 11, NEW**, commit `8fa8bda`) - Follow-Up Sequences engine. Time-triggered Day 3, Day 7, Day 14 follow-ups for leads in `awaiting_response` status who have not replied since the last outbound touch. **Eligibility per row:** status === 'awaiting_response' AND aiEnabled === TRUE AND followUpCount < cadence.length AND (now - lastFollowUpDate) >= cadence[followUpCount] days. **Pre-flight threading check:** before each fire, fetches the lead's Gmail thread; if any message is newer than `lastFollowUpDate`, updates the timestamp and skips the fire (catches manually-sent agent emails). **Cold flip:** after the final touch sends, status flips to `cold` immediately, not on a delay. **One-fire-per-cycle is structurally guaranteed:** touchIndex is derived from followUpCount, so a row can only ever fire its next-in-sequence touch regardless of elapsed time. **Per-agent configurable cadence** via `agent.followUpCadence` (default `[3, 7, 14]` if missing). Three new prompts in `src/prompts.js` (`buildFollowUpDay3Prompt`, `buildFollowUpDay7Prompt`, `buildFollowUpDay14Prompt`); Day 14 prompt explicitly avoids closing-language ("last follow-up", "wrapping up" etc. are in a Day 14-specific banned phrases list). Shadow Mode respected identically across all three touches. Stop conditions: any reply (categorize handles), `leadCategory=soi`, `manual_handling` status (set by CALLED command), `aiEnabled=FALSE`, stop_signal categorization. **Live verification deferred** to a focused session.
- ✅ `src/webhook.js` extension (**session 11**, commit `8fa8bda`) - new CALLED and RESUME SMS commands for manual lead handling. Dispatch order in `setImmediate` block: `^CALLED\s+\S` → `handleCalledCommand`, `^RESUME\s+\S` → `handleResumeCommand`, otherwise → existing `handleAgentReply` (Path 1B). **CALLED `<token>`:** sets row's status to `manual_handling`, logs column L, sends agent confirmation SMS. Token can be a Q-token (e.g. `Q47`) or lead email. Pauses follow-ups (status check excludes manual_handling). **RESUME `<token>`:** only operates if current status is `manual_handling`; flips to `awaiting_response`, resets `lastFollowUpDate` to now, resets `followUpCount` to 0. RESUME on non-manual-handling status sends "not in manual_handling" SMS. Helpers added: `parseCommandToken`, `lookupRowByCommandToken`. Exports expanded to include `handleCalledCommand` and `handleResumeCommand`.

### 2.3 Test scripts (`scripts/`)

- ✅ `scripts/test-load-agent.js` - validates agent JSON loads correctly
- ✅ `scripts/test-prompts.js` - prompt builder verification. **Session 5:** extended with CHECK 10 (Path 1A with conversationHistory) and CHECK 11 (Path 3 with categorizerReasoning). **Session 6:** added 8 automated assertions (CHECK 2A and CHECK 12) for the new categorizer category and Path 1A follow-up block. Also added `check()` helper plus pass/fail counters, replacing prior printf-style verification. 13 manual checks + 8 automated assertions total.
- ✅ `scripts/test-claude.js` - exercises Anthropic API
- ✅ `scripts/test-gmail.js` - exercises Gmail API
- ✅ `scripts/test-twilio.js` - exercises Twilio (sends a real test SMS)
- ✅ `scripts/test-paths-hotsignal.js` (session 5) - integration test for Path 2. 14 assertions, 2 scenarios.
- ✅ `scripts/test-paths-needsreview.js` (session 6) - 17 assertions, 2 scenarios (keyword present vs absent). Verifies SMS fires on keyword and skips when absent, regardless of confidence.
- ✅ `scripts/test-paths-stopsignal.js` (session 6) - 21 assertions, 2 scenarios (shadow with mo-test default, live with in-memory mode override). Verifies Gmail delivery to correct destination per mode. Uses Unicode escapes (`\u2014`/`\u2013`) for em-dash regex so source itself stays clean.
- ✅ `scripts/test-paths-answergeneral.js` (session 6) - 36 assertions across 3 scenarios (shadow with `answer_general`, live with `conversation_continue`, fallback via monkey-patched `claude.draft`). First test that uses a setup+restore pattern for column L mutation. First test that exercises both categories that route to a single path.
- ✅ `scripts/test-paths-askagent.js` (session 6, **expanded session 8**) - 36 assertions across 3 scenarios. Scenario A (high confidence 0.91), Scenario B (low confidence 0.62, asserts SMS fires regardless), Scenario C (queue append: two consecutive Path 1B fires on same row, asserts queue length 2 with two distinct tokens in correct order). Snapshots and restores `agents/mo-test.state.json` around the test body via try/finally. All 36 passed in session 8 live run against mo-test sheet.
- ✅ `scripts/test-pending-questions.js` (**session 8, NEW**) - 57 assertions covering all 4 functions in `pendingQuestions.js`. Pure unit test, no I/O. Documents the `||`-in-question truncation limitation as an explicit assertion.
- ✅ `scripts/test-agent-state.js` (**session 8, NEW**) - 14 assertions covering `getState`/`setState`/`issueToken`. Uses `__test_agent_state__` agent ID to avoid colliding with mo-test. Tests file creation, atomic write artifact (no `.tmp` leftover), malformed JSON catch, persistence across reads, monotonic token issuance. try/finally cleanup ensures no file leaks.
- ✅ `scripts/probe-sms-templates.js` (session 5) - manual probe for investigating Canadian carrier SMS filtering. NOT a test (no assertions). Initial run finding: filtering is more time/state-dependent than content-dependent. See Section 6.
- ✅ `scripts/smoke-orchestrator.js` (session 7) - manual smoke test that calls `processAgent(agent)` then `checkStaleQuestions(agent)` once against the live mo-test agent. Reads-by-human, no assertions. Used to verify step 3 dispatch (full pipeline: gates → categorize → executePath → markRead) and step 4 thresholds (backdated column P triggers branch A reminder; longer backdating + cleared Q triggers branch B escalation). Required exporting both functions from index.js with `require.main === module` guard.
- ✅ `scripts/test-webhook.js` (**session 9, NEW**) - 22-assertion integration test across 6 scenarios for `handleAgentReply`. Calls the handler directly, bypassing Express/signature/idempotency (those layers tested via live ngrok in session 9 closing). Scenarios: A=PATH ALPHA queue empties to warm, B=PATH ALPHA queue retains entries, C=PATH BETA bad token Sheet unchanged, D=PATH GAMMA no-token Sheet unchanged, E=PATH GAMMA multi-token Sheet unchanged, F=empty queue with stale token. Length-based assertion on column L (`lenA_after > lenA_before`) avoids brittleness across reruns where L is append-only and not cleared by `clearRow7`. Uses dedicated row 7 fixture (added to mo-test sheet during session 9, see Section 9.3) so it doesn't collide with rows 2-6 used by other tests. All 22 passed in session 9 live run; side effects (4 SMS to Mo's phone + 2 shadow draft emails) confirmed manually.
- ✅ `scripts/test-leadCategory-filter.js` (**session 10, NEW**) - 18 assertions covering `isLeadCategoryActionable` and the SOI filter integration into Step 1 validation. Pure unit test, no Sheet writes. Coverage: empty/undefined/null leadCategory passes; `'soi'`, `'SOI'`, `'Soi'` all filtered (case-insensitive); whitespace-padded `' soi '` filtered (after `.trim()`); non-soi values like `'cold_internet'` pass; the SOI skip-log call to column L is captured via stub.
- ✅ `scripts/test-leadIntake.js` + `scripts/test-leadIntake-fixtures.json` (**session 11, NEW**) - 57 assertions across pre-filter rules, classifier branching (lead/noise/business_correspondence with confidence thresholds), label application logic, dedup re-engagement path. 13 hand-crafted fixtures (3 leads, 3 business correspondence, 2 noise, 1 calendar pre-filter, 1 reply pre-filter, 1 ambiguous biz, 1 Day-14-style edge case, 1 subject-only lead). Mocks `gmail`, `email`, `claude.callRaw` via require-cache patching; zero live API calls. Defense-in-depth `claude.callRaw` mock returns benign business_correspondence response if any test path accidentally hits the live wrapper.
- ✅ `scripts/test-followUp.js` + `scripts/test-followUp-fixtures.json` (**session 11, NEW**) - 61 assertions covering eligibility gating (status, aiEnabled, count bounds, time check), threading-mismatch behavior (newer thread message updates timestamp and skips fire), shadow vs live send routing, per-touch correct prompt invocation, custom cadence, fire-only-once-per-cycle rule. 12 fixtures including overdue rows, manual_handling lead (no fire), SOI lead (no fire), shadow agent fire, custom `[5,10,20]` cadence agent. Mocks `email`, `claude`, `paths` via require-cache patching; zero live API calls.
- ✅ `scripts/test-webhook-called-resume.js` (**session 11, NEW**) - 44 assertions covering CALLED and RESUME SMS commands at the webhook handler level. Mocks `email`, `twilio` modules. Coverage: CALLED by email matches row, CALLED by Q-token matches row via pendingQuestions parse, CALLED with unknown token sends "not found" SMS, malformed CALLED sends format help SMS, RESUME on manual_handling resets state, RESUME on awaiting_response sends "not in manual_handling" SMS, regression check that `Q47 the answer is X` still routes to Path 1B handleAgentReply.

### 2.4 Phase 1 status: COMPLETE. Phase 2 status: IN PROGRESS (~75%)

Reply Detection module shipped end-to-end as of session 9. The webhook is built, tested with 22 assertions, and **verified live via real ngrok tunnel + real SMS from Mo's phone**. Full pipeline confirmed: phone → Twilio → ngrok → Express → signature bypass (dev mode) → idempotency check → agent lookup → token parse → cross-row Sheet scan → Claude draft → mode-aware Gmail send → `[SHADOW DRAFT]` arrives in Mo's inbox → row 7 in Sheet flips to `warm`.

Phase 1 deliverables:
- ✅ `src/agentConfig.js` `findAgentByPhone(phone)` helper (commit `6fc2965`)
- ✅ Express scaffold with signature verification, idempotency, agent lookup, token parsing (commit `8afc25d`)
- ✅ Handler logic for Path 1B agent reply: draft + send + queue update (commit `698436d`)
- ✅ 22-assertion integration test across 6 scenarios (commit `484cd57`)
- ✅ Live ngrok end-to-end test, dotenv fix discovered and shipped (commit `70ca8bf`)

Phase 2 progress (sessions 10-11):
- ✅ SOI protection layer: column T `leadCategory`, validation gate filter, manual-only flag, never auto-set by system (commit `0e900be`, session 10)
- ✅ Lead Intake Tier 2: heuristic classifier, 3-class branching, label-based idempotency, dedup re-engagement, `claude.callRaw` architectural addition (commit `15920ff`, session 11)
- ✅ Follow-Up Sequences: Day 3/7/14 time-triggered engine, contextual generation, per-agent configurable cadence, pre-flight threading check, cold flip on final touch + CALLED/RESUME manual handling commands (commit `8fa8bda`, session 11)
- ⏳ Daily Digest (`src/digest.js`) — next module
- ⏳ End-to-end orchestrator integration test (Phase 1 leftover)
- ⏳ Lead Intake Tier 1 parsers — deferred indefinitely; Mo doesn't generate Realtor.ca traffic personally, so we ship Tier 1 when a real agent does

### 2.5 Next planned (`⏭️`)

After session 11, two immediate priorities, then Phase 3:

- ⏭️ **Daily Digest (`src/digest.js`).** Surfaces what Lead Intake intaked overnight, what follow-ups fired, what Path 4 escalations need review. Format follows competitive research framing: "what I handled while you slept" — overnight stats, leads needing review, hot leads to call today, follow-ups due today. NOT a passive activity log. The morning brief that gets read every day is the emotional hook; the activity log is not. Operator weekly digest is also part of this module.
- ⏭️ **Live verification of Lead Intake AND Follow-Up Sequences against Mo's own inbox.** Both modules tested with synthetic fixtures only (57 + 61 assertions, all mocked). Before any real agent depends on either, run them live against Mo's Gmail in a focused session, manually validate every classification and every fire. This is the dogfood pass that surfaces prompt-tuning needs and pre-filter gaps.
- ⏭️ End-to-end orchestrator integration test (deferred from session 7, more important now that we have 5 orchestrator steps). Fuller automated test exercising the complete pipeline (Lead Intake → Sheet validation → categorize → dispatch → mark read → stale check → follow-ups) with assertions on the full-cycle side effects.

### 2.6 After Reply Detection (Sequence C, Mo's call) — updated session 11

- **Phase 2: Rest of Starter** (~75% done as of session 11)
  - ✅ Lead Intake Tier 2 (`src/leadIntake.js`, session 11) — heuristic classifier handling direct emails to the agent's inbox. Tier 1 source-specific parsers (Realtor.ca, RLP portal, Zillow) deferred indefinitely.
  - ✅ Qualification — folded into Lead Intake's classifier output (extracts name/email/phone/inquiry/property reference per email)
  - ✅ Follow-Up Sequences (`src/followUp.js`, session 11) — Day 3, 7, 14, contextually generated per-touch
  - ✅ CALLED/RESUME manual handling commands (session 11) — agent SMS to pause/resume automation per lead
  - ⏳ Daily Digest (`src/digest.js`) — next module
  - ⏳ Live verification of Lead Intake and Follow-Up Sequences against Mo's inbox
  - ⏳ End-to-end orchestrator integration test (Phase 1 leftover)
- **Phase 2.5: Web form for direct lead capture (added session 10, deferred from session 11)**
  - Hosted form on agent-ai.com that agents embed on Facebook/Instagram/website. Form submissions write directly to the Sheet, no email parsing. Pulled forward from Phase 4 in session 10 strategy conversation. Requires: hosted form (frontend), public webhook endpoint, spam protection, agent-specific form URLs, Railway deploy. ~8-12 commits. Locked as Phase 2.5 because it's significantly more work than Tier 2 and forces Railway earlier than originally planned.
- **Phase 3: Content Engine ($300/month add-on)**
  - Spec needed first (`CONTENT_ENGINE_SPEC.md`). Dedicated session, 1-2 hours of conversation. Scope: what content types, what inputs the agent provides, what cadence, what review/approval flow, what data sources. Specific anti-pattern to bake in per session 10 research: NO generic broadcast SMS like "did you know the market is moving?" — turns the agent's number into spam.
  - Build the module after spec.
- **Phase 4: Demo-ready packaging**
  - Onboarding & Light Management Page (Express + form + status view)
  - Deploy to Railway (likely earlier — Phase 2.5 forces this)
  - Demo to first agent prospects
- **Then:** onboard first paying agent.


---

## 3. Architecture overview

### 3.1 The flow at runtime

A poll cycle for one agent (5-step pipeline as of session 11):

1. **`processAgent(agentConfig)`** is called by the orchestrator.
2. **Step 0 (NEW, session 11):** `runLeadIntake(agent)` reads agent's unread Gmail inbox, applies code-level pre-filters (replies, calendar domains, empty/short body, idempotency labels), labels survivors with `agent-ai/processing`, classifies via Claude Haiku into one of three categories (lead/noise/business_correspondence). Leads (confidence ≥ 0.6) get a new Sheet row with aiEnabled=FALSE and `agent-ai/intaken` label. Noise (confidence ≥ 0.85) gets `agent-ai/noise` label and marked read. Business correspondence (default for everything else) is left untouched. Cap of 20 classifications per cycle. Wrapped in try/catch — failures don't cascade.
3. **Step 1:** Validate the agent's Sheet schema (columns A through T). Build a `leadIndex` Map keyed by lead email (column A) for O(1) lookups. Filter rows by `isAiEnabled`, `isLeadCategoryActionable` (NEW session 10, drops rows where leadCategory='soi'), and `isWithinRateLimit`. Filtered rows get column L skip-log entries.
4. **Step 2:** Fetch unread replies via `email.fetchUnreadReplies(agent)`. For each reply: look up the lead row by sender email; if no match, skip; if match, call `claude.categorize()` on the body. The categorizer returns `{category, confidence, reasoning, downgraded, originalCategory}`. If confidence is below 0.7, the category is downgraded to `needs_review`. Append `[<timestamp>] Categorized as <category> (<confidence>): <reasoning>` to the row's column L.
5. **Step 3:** Dispatch via `executePath(agent, row, msg, cat)`. Switch on `cat.category` - `answer_general` and `conversation_continue` both fall through to `pathAnswerGeneral`; unknown categories warn and route to `pathNeedsReview`. The path takes `(agent, row, msg, cat)` and returns `{ok, actions, skipped, errors}`.
6. **After path executes:** if `result.ok` is true, mark the email read. If false, leave the email unread for next-cycle retry. Summary log line includes `ok=` and `(skipped)` if the path returned non-empty `skipped` array.
7. **Step 4:** After processAgent returns for an agent, run `checkStaleQuestions(agent)`. Scans rows where `status === 'awaiting_agent'` and `lastActionTimestamp` is parseable. Two independent threshold branches per row, each with its own try/catch - Branch A (>=2hr, blank Q) fires `path1BReminder` SMS and writes ISO timestamp to column Q; Branch B (>=24hr, blank S) sends plain-text operator escalation email and writes ISO timestamp to column S. Both branches can fire in the same pass for a 24hr+ stale row that hadn't had its 2hr reminder yet.
8. **Step 5 (NEW, session 11):** `runFollowUps(agent)` time-triggered follow-up dispatch. Per row: if eligible (status=awaiting_response AND aiEnabled AND followUpCount < cadence.length AND days-since-lastFollowUpDate >= cadence[followUpCount]), pre-flight thread fetch (catches manual sends/lead replies categorize hasn't seen yet), Claude draft via the appropriate Day 3/7/14 prompt, mode-aware send (shadow → agent's inbox, live → reply to lead in thread), Sheet update (followUpCount++, lastFollowUpDate=now, status='cold' if final touch). One-fire-per-cycle structurally guaranteed.

### 3.2 The 6 reply categories

From `REPLY_DETECTION_SPEC.md` (which lives in Project knowledge, needs updating to reflect the 6th category, currently still showing 5). Session 6 added `conversation_continue` after discovering the original 5-category spec had no slot for non-question replies:

1. **`answer_general`** (Path 1A) - General question. AI drafts a personalized response and sends (or shadows). Uses full conversationHistory from column L. May add ONE soft follow-up question per the prompt's FOLLOW UP block.
2. **`answer_property_specific`** (Path 1B initiation) - Lead asks something only the agent knows (specifics about a listing, neighbourhood inside knowledge, the agent's own opinion). System cannot answer. Captures the question to column M, sets status to `awaiting_agent`, SMS the agent. Agent replies via SMS, Agent SMS Reply Handler module (parked) drafts a polished email from the agent's words and sends.
3. **`hot_signal`** (Path 2) - Lead expresses concrete action intent: book a showing, make an offer, schedule a call, ready to move forward. System updates status to `HOT`, sends agent an urgent email alert, SMS the agent ONLY if confidence ≥ 0.85.
4. **`stop_signal`** (Path 3) - Lead is opting out: bought elsewhere, paused, not interested. System sends a brief polite acknowledgement (Shadow Mode aware), updates status to `cold`. Tone is calibrated by `categorizerReasoning`.
5. **`conversation_continue`** (Path 1A) - Lead replied but is not asking a new question, not signaling hot/stop, not asking about a specific property. They are continuing the conversation: answering something we asked, sharing context, acknowledging, or making a casual statement. Examples: "Not pre-approved yet, working on it", "Yeah Riverdale mostly", "Thanks, that is helpful". Routes to the same path as `answer_general`, `pathAnswerGeneral` handles both. The category distinction is preserved in column L logs but doesn't change runtime behavior.
6. **`needs_review`** (Path 4) - Anything ambiguous, emotionally heavy, or that the categorizer is uncertain about. System emails the agent with full context for human review. Optional urgent SMS if the snippet contains keywords (`lawyer`, `attorney`, `complaint`, `dispute`, `legal action`).

### 3.3 The Sheet schema (per-agent Google Sheet)

Authoritative source: `src/gmail.js` COLUMN_MAP (around line 375). When in doubt, check the code.

| Col | Field name | Description |
|-----|------------|-------------|
| A | leadId | Lead email, unique identifier, used as Map key for leadIndex |
| B | name | Lead name |
| C | phone | Lead phone (optional, used in Path 2 alert email and SMS templates) |
| D | source | e.g. "Realtor.ca", "Zillow", "Website". **Session 11 added value `'inbox'`** for rows created by Lead Intake Tier 2 heuristic classifier. |
| E | dateAdded | First contact date |
| F | originalMessage | The lead's first message |
| G | status | `new`, `warm`, `cold`, `HOT`, `awaiting_agent`, `awaiting_response`, `needs_review`. **Session 11 added `manual_handling`** — set by CALLED SMS command, pauses follow-ups until RESUME clears it. |
| H | followUpCount | **Repurposed session 11.** Integer touch counter for Follow-Up Sequences. `'0'` = no touches sent; `'1'` = Day 3 fired; `'2'` = Day 7 fired; `'3'` = Day 14 fired (final). Used by `src/followUp.js` to compute next eligible touch. |
| I | nextFollowUpDay | Date, used by `followUp.js` (currently unused; followUp.js derives next-touch eligibility from cadence + count) |
| J | lastFollowUpDate | Date. Primary timestamp the Follow-Up Sequences engine compares against `now` to determine eligibility for the next touch. |
| K | reserved | (unused) |
| L | conversationHistory | Multi-line; pipe-delimited entries with timestamps. Auto-populated onto `row.conversationHistory` by gmail.js's row builder. |
| M | pendingQuestion | **Session 8: queue model.** Holds 0-N pending questions for this lead, joined with ` || ` (space-pipe-pipe-space), each entry formatted as `[Qn] <question text>`. Empty string means no pending questions. Path 1B writes (appends to existing queue), Agent SMS Reply Handler reads/removes-by-token. Path 1A does NOT touch this column. Parser/serializer in `src/pendingQuestions.js`. Single-purpose decision (only Path 1B writes) is preserved; what changed is the shape (scalar → list). Known limitation: lead questions containing the literal `||` separator get truncated at the separator (silent drop of the second part). Documented and tested. |
| N | gmailThreadId | Gmail thread ID for the lead's email thread (set when row is created during Lead Intake or Reply Detection) |
| O | aiEnabled | Boolean. If false, the row is skipped by Reply Detection and Follow-Up Sequences entirely. |
| P | lastActionTimestamp | When the system last did something with this row |
| Q | reminderSent | ISO timestamp when the 2hr Path 1B reminder SMS fired, or blank. Truthy check: `!row.reminderSent`. Header in the Sheet UI is `Reminder Sent At` (renamed from `Reminder Sent` in session 7). COLUMN_MAP key unchanged. |
| R | validationStatus | Set by Sheet validation in step 1; cleared when row is healthy, populated with error string when not |
| S | operatorEscalated | ISO timestamp when the 24hr operator escalation email fired, or blank. Truthy check: `!row.operatorEscalated`. Header: `Operator Escalated At`. Added in session 7 alongside step 4. |
| T | leadCategory | **Session 10.** Header: `Lead Category`. Values: `'soi'` or empty string. SOI = Sphere of Influence: agent's friends, family, past clients, personal network. Empty treated as default action-eligible. **Set manually only — system NEVER auto-writes this column.** Validation gate `isLeadCategoryActionable(row)` filters rows with `'soi'` (case-insensitive after trim). Filtered rows get column L skip-log entry. Dedup preserves SOI status across re-engagements. |

**Note:** Earlier session-7 parked item considered using column S for path execution status tracking. That speculative slot was overtaken when session 7 actually used S for `operatorEscalated` (the 24hr escalation timestamp). Column T was the next free slot and now holds `leadCategory`. There is no current path-execution-status column; the parked retry-on-failure idea remains parked but would need a different column letter.

**Single-purpose column M (decided session 6, schema-evolved session 8):** Earlier discussion considered using column M for two purposes, Path 1B's "waiting for agent" state AND Path 1A's "qualifying question we asked the lead" state. The double-use was rejected because it created semantic ambiguity. Path 1A drives multi-turn qualifying through conversation history (column L) + the FOLLOW UP block in the draft prompt instead. Column M stays single-purpose: Path 1B writes, Agent SMS Reply Handler reads/clears. **Session 8 evolution:** the *shape* of M changed from scalar (one question per row at a time) to list (queue of 0-N questions, separated by ` || `, each tokenized). The single-write-source rule still holds. Path 1A still does NOT touch M.

**Per-agent state file (session 8):** `agents/<agentId>.state.json` holds agent-level metadata that doesn't fit the row-based Sheet schema. Currently one field: `lastTokenIssued` (monotonic integer per agent). File is gitignored. Atomic writes via tmp-file-then-rename. Created on first `issueToken` call; if absent at start, treated as `{ lastTokenIssued: 0 }`. See `src/agentState.js`.

### 3.4 Data flow diagram (mental model)

```
[Step 0: Lead Intake] - session 11
Agent's unread Gmail inbox
    -> fetchUnreadInboxEmails (gmail.js)
    -> applyPreFilter (leadIntake.js): reply? calendar? short-body? labeled?
    -> apply 'agent-ai/processing' label (idempotency marker)
    -> claude.callRaw with buildHeuristicClassifierPrompt
    -> branch by category:
       - lead (>=0.6) -> appendSheetRow + 'agent-ai/intaken' label + markRead
       - noise (>=0.85) -> 'agent-ai/noise' label + markRead
       - business_correspondence (default) -> remove processing label, leave unread

[Steps 1-3: Reply Detection]
Lead's Gmail reply
    -> fetchUnreadReplies (gmail.js)
    -> orchestrator step 1 (index.js): validate, isAiEnabled, isLeadCategoryActionable, isWithinRateLimit
    -> orchestrator step 2 (index.js)
       -> claude.categorize() = {category, confidence, reasoning}
       -> appendToConversationHistory (column L)
    -> orchestrator step 3 (index.js)
       -> executePath -> pathHotSignal | pathNeedsReview | pathStopSignal | pathAnswerGeneral | pathAskAgent
          -> updates Sheet (status, lastActionTimestamp, etc.)
          -> may send email (sendReply or sendNewEmail, mode-aware)
          -> may send SMS (twilio.sendSMS, with verifyDelivery)
          -> Path 1B may issue token + write to column M queue
    -> markRead (gmail.js) on success

[Step 4: Stale Question Check]
checkStaleQuestions (index.js)
    -> for each awaiting_agent row, check 2hr/24hr thresholds
    -> may fire reminder SMS (column Q timestamp) or escalation email (column S timestamp)

[Step 5: Follow-Up Sequences] - session 11
runFollowUps (followUp.js)
    -> for each awaiting_response row:
       -> eligibility: aiEnabled AND followUpCount < cadence.length AND days-elapsed >= cadence[count]
       -> pre-flight thread check via getThreadHistory (catches manual sends)
       -> claude.draft via buildFollowUpDay3/7/14Prompt
       -> mode-aware send (shadow -> agent inbox, live -> reply to lead)
       -> updateSheetRow: followUpCount++, lastFollowUpDate=now, status='cold' if final touch
       -> appendToConversationHistory

[Out-of-band: Inbound Agent SMS]
Twilio webhook -> webhook.js
    -> dispatch order: CALLED -> RESUME -> handleAgentReply (Path 1B)
    -> CALLED <token>: status='manual_handling', pauses follow-ups
    -> RESUME <token>: status='awaiting_response', resets followUpCount=0 and lastFollowUpDate=now
    -> handleAgentReply: Claude draft of polished reply, send, queue update
```

### 3.5 Mode flag (Shadow vs Live)

`agent.mode` is either `"shadow"` or `"live"`. New agents are created with `"shadow"` for their first 7 days. The path layer is the only place that branches on this flag. Email provider layer (gmail.js) and SMS provider layer (twilio.js) are mode-unaware.

### 3.6 Per-agent persona

Each agent's persona (banned phrases, tone, sign-off, length preference, "AI cannot invent" additions) lives in their JSON config. Prompts.js loads this and bakes it into the system prompt at draft time. The persona never appears in the categorization prompt (categorization is persona-agnostic).


---

## 4. Locked decisions (will not be revisited unless something changes)

These are decisions that have been made through real discussion and will be honoured by future sessions. Each one notes the session it was made in for traceability.

### 4.1 Architecture decisions

**[Session 4] Provider abstraction.** `email.js` is a thin dispatcher that switches on `agentConfig.provider` (defaults to `gmail`). Each provider (gmail.js today, outlook.js eventually) implements the same 12-function contract. All actual logic lives in the provider; email.js is a switch statement. If logic creeps into email.js, it belongs in the provider instead.

**[Session 5] Path layer architecture.** New file `src/paths.js`. One function per category, naming pattern `pathHotSignal`, `pathNeedsReview`, `pathStopSignal`, `pathAnswerGeneral`, `pathAnswerPropertySpecific`. Contract: `async function pathX(agent, row, msg, cat) -> {ok, actions, skipped, errors}`. Paths catch their own errors and never throw. `ok` depends only on the critical step (Sheet update). Other steps (column L log, email, SMS) are best-effort, failures recorded in the `errors` array but do not flip `ok` to false.

**[Session 5] Shadow Mode lives in the path layer, NOT in gmail.js or email.js.** gmail.js stays a dumb provider. Each lead-facing path branches `if (agent.mode === 'shadow') sendNewEmail(agent.gmailAddress) else sendReply(lead.email)`. Reason: Shadow Mode is product policy, not a provider concern. If Outlook is added later, this logic does not get reimplemented.

**[Session 5] claude.js owns the banned-phrase retry loop.** It returns a clean draft or sets `escalate: true`. Path layer catches `escalate: true` and routes the row to needs_review. Orchestrator does not log retry attempts; the contract is just `{text, violations, attempts, escalate}`.

**[Session 4] OAuth client cache is module-level singleton state in gmail.js.** Fine for sequential agent processing. Means the orchestrator cannot easily run two test agents in parallel with the same agentId. Not a real issue today.

**[Session 5] Path execution ordering: log → executePath → markRead (Option A).** If the path fails, leave the email unread for retry on the next cycle. Idempotency notes per path so retry does not double-send. Column-S retry-tracking is parked (Option C upgrade) until we observe a real double-send incident.

**[Session 6] Row construction lives in `gmail.js`, not in agentConfig or index.js.** When rows are read from the sheet via `getAllLeads()` (around line 420 of gmail.js), the row builder iterates through every column index, looks up the column name from `COLUMN_NAMES_BY_INDEX`, and assigns `obj[name] = row[col]`. Every named column in `COLUMN_MAP` becomes a property on the row object. This means `row.conversationHistory`, `row.pendingQuestion`, `row.status`, etc. are auto-populated for every row that flows through the system. Paths do NOT need their own sheet reads to access these fields. Authoritative column-to-field mapping is `COLUMN_MAP` in `src/gmail.js` around line 375.

**[Session 6] Path 1A status semantics differ from other paths.** Most paths' `ok: true` means "we did the right thing." Path 1A's `ok: true` can mean two different things: actual draft sent (status=`warm`) OR fallback template sent because Claude failed (status=`needs_review`). `actions.draft` records which: `'claude'` or `'fallback_template'`. Don't pretend a fallback is a real success, the status field is honest. Fallback also fires an additional `[ESCALATION]` email to escalationEmail flagging that Claude failed.

**[Session 6] Test fixture restore pattern is mandatory for any test that mutates persistent sheet state.** Path 1A scenario A (writes column L) and Path 1B scenarios A and B (write column M) all explicitly restore the cells to their starting state after assertions. Without restore, subsequent test runs see leftover state and start failing in confusing ways. New convention: any test that writes to columns L, M, or P must restore them before exiting.

**[Session 9] Webhook is a separate process from the orchestrator.** Two long-running Node processes share infrastructure (agent configs, Sheet, Twilio account, Claude API) but run independently: (a) the orchestrator (`src/index.js`) runs every 15 min on a cron-like schedule, polls Gmail, processes inbound replies; (b) the webhook (`src/webhook.js`) is a continuously-listening Express server on port 3000 that responds to Twilio's inbound SMS POSTs in real time. Locally that's two terminal windows. On Railway (Phase 4) they'll be two services within the same project. They do NOT need to coordinate state — both write to the same Google Sheet, both read from the same agent JSON files, but they don't share memory. The in-memory `MessageSid` idempotency cache in webhook.js is webhook-process-only and ephemeral; that's fine because Twilio retries within the 5-min window all hit the same process.

**[Session 9] Cross-row token lookup is acceptable at our scale.** When a token-bearing inbound SMS arrives, the webhook scans ALL of an agent's Sheet rows looking for the matching token in column M. O(n) where n is the lead count. At our scale (mo-test has 5-7 rows; first paying agent likely has under 100 leads) this is fine. Parked optimization (token→row index) only matters at 1000+ leads per agent, see section 7.4.

**[Session 9] Multi-token replies trigger a clarification SMS, not a state mutation.** When the agent texts something like `Q47 Q48 here is the answer to both`, the handler does NOT try to split or guess. It detects multiple tokens in the body (regex match count > 1) and SMSes back: "Multiple tokens detected. Please reply to one at a time. Open questions: ..." Sheet state is unchanged. Reasoning: the failure mode of Option A (silently treat one as the answer, ignore the other) would put garbage into a polished email going to a real lead. Option C (split on tokens, route each chunk) has real complexity (token detection inside answer text is unreliable). Option B (refuse + clarify) costs one extra SMS the first time the agent does it; agents learn the pattern fast. Worst case wins by orders of magnitude. Locked.

**[Session 9] On `result.escalate === true` the queue entry is preserved, no email is sent.** Earlier (commit 3 review) caught a CC drift: the initial implementation logged the escalation and proceeded to send the draft anyway ("best-effort"). That violates the spec from session 5's `claude.draft` design — the escalate flag means Claude could not produce a clean draft after 3 retries, sending it to the lead is a brand risk. Corrected: when `escalate === true`, the handler logs the error, sends a fallback SMS to the agent ("Could not draft email for Q47. Please email <lead> directly. The question stays open in your queue."), and EARLY-RETURNS without modifying the queue. The agent can text another (cleaner) answer or handle manually. The queue entry stays so it doesn't get lost.

**[Session 9] Defensive re-read of column M before queue update.** The handler can take 5-10s for the Claude draft. During that window, another concurrent webhook call (or another orchestrator cycle running pathAskAgent) could append a new entry to the same row's column M. If the handler then writes back its stale snapshot minus the resolved token, the new entry is silently lost. **Pattern**: before writing the updated queue, re-read the row from the Sheet, parse fresh, remove the resolved token from THAT, serialize, write. Falls back to stale snapshot only if the re-read fails (logged as warn). At our scale (single agent, no parallel Path 1B fires while a webhook is in flight) this is unlikely to bite us today, but it's the kind of bug that shows up in production six months later when an agent has 5 active leads and never gets diagnosed.

### 4.2 Reply Detection decisions

**[Session 5] Path 1A passes full conversationHistory verbatim** (Option B from design discussion). All of column L is passed into the drafter prompt. Token cost is negligible at our volume; full history avoids losing thread continuity on long-lived leads. If column L grows unbounded over a 6-month-old lead, we revisit (probably move to summarize-older-than-N-entries, Option C).

**[Session 5] Path 3 uses categorizer's existing `reasoning` field for tone calibration**, NOT a separate `optOutReason`. Reuses signal we already pay for. The Soft-Exit Confirmation Flow parked feature does NOT require a structured `optOutReason` to be added now; that decision is deferred to when we actually build the soft-exit feature and have real data.

**[Session 5] HOT_SMS_CONFIDENCE_THRESHOLD = 0.85.** Separate from the global 0.7 confidence floor. If confidence is 0.7-0.85, the lead is still flagged HOT in the Sheet, the email alert still fires, but the SMS is skipped. Prevents SMS fatigue from borderline categorizations. Tunable in one place; can become per-agent later. Mo's specific concern: SMS interruptions need to mean something, the moment they do not, the agent stops trusting them.

**[Session 5] Duplicate Lead ID handling.** Implement during step 3 wire-up. `Map.set()` already takes last-write naturally. Add `console.warn` on overwrite (~3 lines).

**[Session 5] No tightening of categorization prompt now.** The categorizer is working in step 2 testing. Tighten the `hot_signal` definition with counter-examples (e.g. "vague interest like 'sometime' is NOT hot_signal") AFTER the first paying agent has a week of real reply data to tune against. Speculative pre-tuning is over-engineering.

**[Session 6] Sixth categorizer category: `conversation_continue`.** Original 5-category spec had no slot for non-question replies (lead answering our prior question, sharing context, acknowledging). These were defaulting to `needs_review`, which broke multi-turn conversation flow. New 6th category captures them. Routes to the same path as `answer_general` (`pathAnswerGeneral`). The split is preserved in column L logs but doesn't change runtime behavior. Both labels are valid inputs to `pathAnswerGeneral`.

**[Session 6] Multi-turn qualifying happens through conversation history, NOT through column M state.** Path 1A's draft prompt has a FOLLOW UP block instructing Claude to add ONE soft conversational follow-up question when natural. When the lead replies, Claude reads the prior question from column L conversation history and acknowledges/answers it. No state machine, no separate qualifying-question column needed. Column M stays single-purpose (Path 1B's "waiting for agent" state).

**[Session 6] Path 4 (needs_review) urgent SMS uses keyword filter only, NO confidence gate.** Keywords: `lawyer`, `attorney`, `complaint`, `dispute`, `legal action`. Originally proposed `urgent` as a keyword too, removed because it gets used casually and would create exactly the SMS spam problem the keyword filter is trying to avoid. Reasoning for no confidence gate: hot_signal gating is about not falsely claiming a positive event; needs_review is Claude saying "I don't know, escalate", gating that further on confidence filters on the wrong signal.

**[Session 6] Path 1B (pathAskAgent) sends NO holding email to the lead.** Originally proposed a "Great question, let me check on that" template message, pulled because if the agent ghosts the SMS, the holding email becomes a broken promise that damages the agent's reputation more than silence would. Lead hears nothing until the agent answers via the Agent SMS Reply Handler (parked). Step 4's role grows because of this, it should eventually have a lead-facing fallback after N hours of no agent response. Decide design when actually building Step 4.

**[Session 6] Path 1B SMS to agent has NO confidence gate.** Every Path 1B run sends the SMS regardless of `cat.confidence`. Reasoning: false-positive Path 1B SMS is mildly annoying, not embarrassing (unlike a false-positive HOT lead alert). Property-specific categorizations are also less prone to mis-trigger because the language is distinctive. Reflexively reused `HOT_SMS_CONFIDENCE_THRESHOLD` in initial design, caught and removed. Lesson: don't pattern-match on Path 2's gate, re-derive whether each path needs gating from the path's own risk profile.

**[Session 6] Agent SMS Reply Handler routing strategy: token-based (Option B).** Each Path 1B SMS will include a token like `[Q47]` in the subject line. Agent must include the token when replying with their answer. Handler parses the prefix to know which lead row the answer is for. Operator-controlled friction (Mo trains each agent during personal onboarding), not user-controlled. Rejected alternatives: last-asked-wins (breaks with multiple open questions), confirmation handshake (slow), queueing (extends silence window). Token approach is reliable by construction. **Build BLOCKER:** existing `leadPropertyQuestion` template in twilio.js needs updating to include the token before the handler can be built.

**[Session 7] Step 3 design choices.** Five locked: (1) Dispatch via a `switch` helper, not inline ifs. (2) `result.skipped` is treated as a non-failure - `ok=true && skipped.length>0` still markReads. (3) Unknown category defaults to `pathNeedsReview` with a warn (defensive against categorizer drift). (4) Per-lead rate limit and AI-Enabled gate live at row-validation time (already in place at lines ~227/233), NOT at message-level. Tradeoff: rate-limited replies aren't logged to column L this cycle; revisit if burst-reply patterns emerge in production. (5) markRead is gated on `result.ok` - failed paths leave the message unread for next-cycle retry. Duplicate column L log on retry is accepted as a known minor cost.

**[Session 7] Step 4 has NO lead-facing fallback.** Original session-6 design space included a "still gathering this info" message to the lead after N hours of agent silence. Pulled. Mo's reasoning: any auto-message implies the agent didn't know a basic answer, which damages reputation more than silence does. v1 has agent reminder at 2hr + operator escalation to Mo at 24hr. No lead-facing message at any threshold. If agent ghosts past 24hr, the operator (Mo) intervenes by phone - operator-as-safety-net rather than auto-recovery.

**[Session 7] Step 4 ISO-timestamp pattern for state columns.** Column Q (reminderSent) and Column S (operatorEscalated) both store an ISO timestamp on success, blank otherwise. Truthy check is `!row.<key>`. This replaced an earlier "boolean string 'true'" design. Two reasons: (a) the operator escalation email body benefits from "reminder fired at <ts>" detail, (b) timestamp-or-blank is consistent with how column P (lastActionTimestamp) already works. Headers in the Sheet UI are `Reminder Sent At` and `Operator Escalated At` to signal the timestamp semantics. COLUMN_MAP keys unchanged. New column-add convention worth noting: when Mo manually adds a column to a live agent sheet, the rename of any existing header (Q from `Reminder Sent` → `Reminder Sent At`) is also manual. setup-sheet.js only creates new sheets; it does not migrate live ones. Future schema migration tooling parked.

**[Session 7] OAuth refresh-failure auto-flips agent.isActive to false.** Existing behavior in gmail.js. When Google rejects a refresh token permanently (most common cause: Testing-mode 7-day inactivity revocation), the OAuth wrapper marks the agent inactive in agents/<id>.json and the orchestrator skips them on subsequent cycles. Recovery: re-run `node scripts/authorize.js <agentId>`, which writes a fresh refresh token AND re-flips isActive to true (verified session 7). No manual edit needed. **Production behavior is different**: once the OAuth consent screen is pushed from Testing to Production (parked roadmap, 4-6 week verification), refresh tokens last indefinitely. The 7-day-revocation problem is a Testing-mode-only papercut. For paying agents, expect tokens to last years between re-auths. If a token does break in production (password change, manual revoke, scope change), the auto-flip + re-auth flow still works; just needs a re-auth UI in the onboarding page (parked).

**[Session 9] HARD GATE: TWO prerequisites must complete BEFORE any agent flips from shadow to live mode.**

**Prerequisite 1: Prompt iteration session against real data.** Three known prompt-quality bugs were observed during session 9's live test: (a) Path 1B drafts use third-person voice ("Mo would be happy to arrange...") instead of first-person ("Happy to arrange..."), (b) greeting uses the lead's full column-B name ("Hi Webhook Test Lead") instead of parsing the first token ("Hi Sarah"), (c) Path 1B has no mechanism to detect when the agent's SMS answer is incomplete or placeholder text and wraps polished prose around whatever it gets. **None of these are handler bugs.** They live in `src/prompts.js`. **Fixing them requires real lead-reply data, not fake test data.** Tuning a prompt against `Q5 here is the answer to question one` will overfit. The right time is after Phase 2 ships (which generates real Path 1B fires during Mo's own dogfooding) and before the first paying agent's shadow-to-live transition. Mo flagged this as a non-negotiable in session 9 ("i want to make sure we fix the third person problem before we go live").

**Prerequisite 2: Path 1B SMS must include property reference.** Currently the SMS to the agent says `[Q47] Sarah Chen: "What's the kitchen like?"` with no indication of WHICH property the question is about. In shadow mode the agent can check the lead's email thread to figure it out. In live mode they're acting on the SMS alone — they may have multiple leads asking similar questions across multiple listings. The fix is best-effort Claude extraction at Path 1B fire time (see section 7.4 for full spec). Mo locked this as a hard gate session 9 ("add it and make sure we do it before we go live"). Cannot ship a paying agent to live mode without it.

**Both are structural, not optional.** A future session that proposes flipping a paying agent to live mode without first completing both prerequisites is making a known mistake. The two can be done in any order, possibly in the same iteration session — they touch related code (`src/prompts.js`, `src/paths.js` Path 1B SMS construction, possibly a new prompt builder for property extraction).

**[Session 9] Webhook security: 3-layer signature verification bypass for dev only.** See section 4.4 entry for full detail. Bypass requires env flag AND localhost/ngrok hostname AND startup warning logged. Production cannot accidentally fire the bypass even if the env flag leaks because production hostnames don't match the allowlist.

**[Session 9] Token format is `[Qn]` brackets at the start of column M entries, joined by ` || ` separator.** Locked at session 8, confirmed in session 9 live test. Strict regex `^\[Q(\d+)\]\s+(.+)$` for parsing. Webhook accepts a liberal regex on inbound SMS — `/Q\s*-?\s*(\d+)/gi` matches `Q47`, `q47`, `Q47:`, `Q47 -`, `Q-47`, `Q 47` and normalizes to uppercase `Q<n>`. Strict regex on storage, liberal on parse. Asymmetric on purpose.

**[Session 9] No proactive ad-running for agents.** Asked at end of session 9. Decision: not in scope, deliberate strategic call. Reasoning: (a) lead generation is a different business from lead handling, served by mature ad agencies that charge $1500-$5000/month, (b) adding ads dilutes the pitch ("agent-ai" stops being best-at-this-niche-thing), (c) agents who need ads either already have agencies or aren't lead-volume-constrained — they're follow-up-constrained, which is what we solve. Future option (parked, Phase 5+): partner with a real-estate-specialist ad agency for referral fees. Explicitly NOT building ad-running ourselves.

**[Session 9] Lead Intake (Phase 2) implementation: email parsing, NOT a hosted form.** Most agent leads already arrive as emails to their Gmail (Realtor.ca, Zillow, brokerage portals, ad-form-via-email). Lead Intake polls Gmail (reusing Reply Detection's infrastructure), filters for emails from known lead-source senders, parses out structured data, writes a row to the Sheet. Reply Detection takes over from there. Web form (Path B) deferred to Phase 4 as a fallback for sources email-parsing can't handle. CRM integrations (Path C: Follow Up Boss, kvCORE, BoldTrail) deferred to Phase 5+ when an agent specifically asks. Reasoning: zero workflow change for the agent, one infrastructure piece handles 80%+ of sources, graceful failure mode. **Updated session 11:** Tier 1 source-specific parsers (Realtor.ca etc.) deferred indefinitely because Mo doesn't generate that traffic personally; Tier 2 heuristic classifier ships first and is sufficient for direct-email leads. Web form (Path B) pulled forward from Phase 4 to Phase 2.5.

**[Session 10] SOI (Sphere of Influence) protection is a manual-only flag.** Column T `leadCategory` value `'soi'` filters a row out of the validation gate before any path can run. The system NEVER auto-writes this column. The agent marks SOI contacts manually in the Sheet. Empty/undefined leadCategory is treated as default action-eligible. Rationale: SOI contacts (past clients, friends, family, neighbours) have a fundamentally different relationship with the agent than cold internet leads. An auto-reply in AI-polished tone to your friend's mom is brand-damaging in a way that cannot be repaired by an apology. Defense-in-depth: the filter check is `.trim().toLowerCase() !== 'soi'` so whitespace-padded `' soi '` and case variants `'SOI'`, `'Soi'` all filter correctly. Dedup preserves SOI status across re-engagements (existing row's leadCategory is authoritative).

**[Session 11] Lead Intake design is 3-tier with tiers 1 deferred.** Tier 1: source-specific parsers (Realtor.ca, RLP portal, Zillow). Deferred indefinitely — build when a real agent demands it. Tier 2: Claude Haiku heuristic classifier for direct emails to the agent's inbox. Three classifications: `lead` (confidence ≥ 0.6 → write Sheet row, label `agent-ai/intaken`, mark read), `noise` (confidence ≥ 0.85 → label `agent-ai/noise`, mark read), `business_correspondence` (default, including low-confidence lead/noise → leave untouched in inbox). Tier 3: pre-filter that runs in code before any Claude call (skip replies, calendar domains, empty body + short subject, already-labeled emails). Pre-filter runs first; survivors go to Claude.

**[Session 11] Lead Intake idempotency via Gmail label, not in-memory state.** Before classification, every survivor gets `agent-ai/processing` label applied. Pre-filter excludes any email that already has `agent-ai/processing`, `agent-ai/intaken`, or `agent-ai/noise` label. If the process dies mid-classification, the email retains `agent-ai/processing`, gets blocked by pre-filter on next cycle, never reprocessed. One stale-labeled email is a worse outcome than a duplicate-classified email; we choose the former. Sweep job for stale processing labels is parked.

**[Session 11] Lead Intake auto-creates rows with `aiEnabled = FALSE`.** The agent reviews intaken leads (typically via Daily Digest, when that ships) and manually flips to TRUE for real leads. This is the safety mechanism for Tier 2 false positives — we'd rather miss a fast response on an intaken lead than accidentally fire AI replies on the agent's friend's email.

**[Session 11] Lead Intake routes Anthropic calls through `claude.callRaw`, not direct SDK.** Architectural cleanup mid-session 11: an initial implementation instantiated Anthropic SDK directly in `leadIntake.js`. Refactored to add a thin `claude.callRaw({ system, user, model?, maxTokens? })` wrapper in `claude.js` that returns raw text. All Anthropic calls in the codebase now go through `claude.js`. Single retry policy, single error handler, single Claude config touchpoint.

**[Session 11] Follow-Up Sequences are View 1 in shape, View 2 in spirit.** Time-triggered fixed cadence (Day 3, 7, 14) with each touch contextually generated by Claude using only data already in the Sheet plus the agent persona. NO external listing data, NO market data, NO invented facts. The wedge is voice and context, not data integration. Three locked rules:
1. Each touch references the lead's specific original inquiry (column F), not a generic re-ping.
2. No touch references the cadence position ("Day 3", "second follow-up", "still interested?", "haven't heard back").
3. Day 14 is warm, not closure-signaling. NO "last follow-up", "final message", "wrapping up" language. Defense-in-depth: Day 14 has its own banned-phrases list.

**[Session 11] Follow-Up cadence is per-agent configurable, default `[3, 7, 14]`.** Read from `agent.followUpCadence`. Default applies if missing or malformed. Rationale: some agents are religious about Day 5/12/30; per-agent config means we onboard them without code changes. Validation in `getFollowUpCadence(agent)` requires array of positive integers.

**[Session 11] Follow-Ups count from `lastFollowUpDate` (column J), not from inquiry date.** Each outbound touch resets the clock. Manual sends caught by pre-flight thread fetch: before firing, fetch the lead's Gmail thread; if any message is newer than `lastFollowUpDate`, update the timestamp and skip the fire this cycle. Sent-folder polling (the more thorough version) deferred.

**[Session 11] One follow-up per row per cycle, structurally guaranteed.** `touchIndex` is derived from `followUpCount`, not from elapsed time. A row with `followUpCount=0` and 30 days elapsed only fires `cadence[0]` (Day 3); the counter advances to 1, the row is done for this cycle. The next cycle will see `followUpCount=1` and only consider `cadence[1]`. Laptop-sleep scenario: if the system was offline for 14 days, on resume each row fires only its single next-in-sequence touch, not all overdue touches at once.

**[Session 11] Cold flip happens at the moment the final touch sends, not on a delay.** Status flips to `'cold'` in the same `updateSheetRow` call that records the Day 14 fire. There is no "wait N days after Day 14, then go cold" intermediate state. Reasoning: the next-cycle eligibility check would skip the row anyway (`followUpCount === cadence.length`); putting the cold flip on a delay just creates another state to track.

**[Session 11] CALLED and RESUME SMS commands for manual lead handling.** `CALLED <Q-token-or-leadEmail>` from agent → status='manual_handling', pauses follow-ups indefinitely. `RESUME <Q-token-or-leadEmail>` (only operates if status='manual_handling') → status='awaiting_response', followUpCount reset to 0, lastFollowUpDate reset to now. Sequence restarts from Day 3 on resume — when an agent pauses for a week, the lead's mental state changed; restarting from a fresh Day 3 is more contextually appropriate than firing a stale Day 7. Webhook dispatch order: CALLED check → RESUME check → fallback to handleAgentReply (Path 1B). Token can be Q-token or lead email.

**[Session 11] HARD GATE added: live verification of Lead Intake AND Follow-Up Sequences against Mo's own inbox before any paying agent depends on either.** Both modules tested with synthetic fixtures only (57 + 61 assertions, all mocked). Synthetic fixtures cannot surface prompt-tuning needs, classification edge cases on real-world emails, or pre-filter gaps. The dogfood pass against Mo's actual Gmail is the gate.

### 4.3 Build sequence decisions

**[Session 5] Sequence C (Mo's call):**
- **Phase 1:** Finish Reply Detection completely (steps 3 + 4 + Agent SMS Reply Handler).
- **Phase 2:** Rest of Starter (Lead Intake, Qualification, Follow-Up, Daily Digest).
- **Phase 3:** Content Engine ($300/month add-on, spec session needed first).
- **Phase 4:** Onboarding page, Railway deploy, demo.
- **Then:** onboard first paying agent.
- **Demo packaging:** full Starter + Content Engine bundle ready to demo when the onboarding page ships.

**[Session 4] Mo's Make.com scenarios continue to run in parallel** during the entire build. They handle real lead intake and follow-up for Mo's actual leads while the new system is built. Cutover to Node happens module-by-module, post-onboarding page, after thorough validation.

### 4.4 Coding/testing rules

**[Session 4 + reinforced Session 5] No em-dashes anywhere in any file.** Period. Test files, comments, doc strings, prompt strings, READMEs, everywhere. The rule is absolute on purpose: an exception for "just comments" erodes the rule. Run `grep -n "[--]"` on every file Claude touches before considering work done. Exception is the literal "Em-dashes (-) and en-dashes (-) are forbidden..." instruction lines inside the drafter prompts (those are *telling* the model what not to use, so they have to contain the literal characters).

**[Session 5] Tests must verify reality, not API success.** Integration tests that claim success when they only verified an API returned without throwing are bugs. Twilio API success does not equal carrier delivery; this is the class of bug `verifyDelivery()` was added to fix.

**[Session 5] Senior engineer mindset always.** Real code review. System-level thinking. Flag duplication, structural rot, performance bottlenecks, maintainability risks. Push back on "convenient now, expensive later" with the trade-off explained.

**[Session 5, refined Session 6 with Mo's verbatim text] Explain in plain language.** Mo is leveling up as a builder but isn't a backend specialist. When using technical terms (e.g. "module," "dispatcher," "idempotent," "race condition"), define them on first use in a session. Senior-engineer thinking stays; the vocabulary should match the audience. If a concept needs more than a sentence to explain, it gets a small explanation block, not a wall of jargon.

**[Session 6] Search broadly when grepping `src/`.** Don't guess at file locations or assume things live where they "should." Session 6 lost time on a wrong-verdict moment when row-construction code was hunted in agentConfig.js and index.js (where it "should" live based on a mental model) instead of being grepped for across all of src/ first. The actual location was `src/gmail.js:420-437`. Lesson: `grep -rn "<thing>" src/` first, narrow second.

**[Session 6] Test passing ≠ production working.** Always verify the field/contract Claude Code uses in a test exists in production code paths too. Session 6 caught a near-miss where Claude Code used `row.conversationHistory` correctly, but the `gmail.js:COLUMN_MAP` connection had to be verified separately to confirm the field is actually populated upstream. Tests using fixture-built objects can pass even when production runs would see undefined.

**[Session 4] After Claude Code edits to any file containing secrets or doing live API calls,** run a redacting `node -e` verification command (e.g. `JSON.stringify(obj, (k, v) => k === 'googleRefreshToken' ? '[REDACTED]' : v)`) before moving on. Never paste raw config or tokens.

**[Session 4] Prompts and prompt builders are tested via `scripts/test-prompts.js` first** before any code that consumes them is written. Pure modules get tested first, integration code after.

**[Session 8] Agent-level metadata lives in JSON state files, not in the Sheet.** The Sheet is row-based (one row per lead). Anything that's per-agent rather than per-lead doesn't fit cleanly. A single integer like `lastTokenIssued` doesn't belong as "the first cell of an otherwise-empty column." Pivoted from an earlier "Column T" plan to `agents/<agentId>.state.json` after working through the data shape. Easy to extend (more fields), gitignored automatically (matches the existing `agents/*.json` rule), atomic-write protected. The file is created on first write; if absent at read time, default state is returned without creating the file.

**[Session 8] Column M is now a queue, not a scalar.** The single-purpose decision (only Path 1B writes) from session 6 still holds. What changed in session 8: the *shape* of the cell value is now a list of 0-N entries, each formatted `[Qn] <question>`, joined by ` || `. Path 1B appends to the existing queue rather than overwriting. This was Mo's call for Option C (full queue model) over Option B (graceful degradation to needs_review on stacked questions). Build cost was real but contained: parser/serializer module + state file + path refactor. Tradeoff: never lose a question, demo story is bulletproof, at the cost of cross-row token-lookup complexity in the handler.

**[Session 8] Token-based handler routing implementation details locked.** `[Qn]` brackets at start of each entry, strict regex `^\[Q(\d+)\]\s+(.+)$`, case-sensitive on the literal `Q`, case-insensitive when matching tokens in the handler. Soft cap of 5 open questions in the wrong-token suggestion SMS, with overflow language. Wrong-token replies are no-ops on data (don't clear anything, just SMS the suggestion back). Webhook framework: Express. ngrok for local live testing. Token issuance is monotonic per-agent; gaps are harmless (a Sheet write failure between token issuance and Sheet update burns a token, which is fine).

**[Session 8] Burn-a-token-not-orphans on Sheet write failure.** Order in `pathAskAgent`: issue token first (writes to agentState file), then write the Sheet. If Sheet write fails, the token is already persisted but no row has it. That's fine: tokens are identifiers, gaps don't break anything (`Q47` then `Q49` is OK, no `Q48`). The opposite ordering (Sheet first, then token) would risk orphaning a token in the Sheet that wasn't recorded as issued, leading to potential duplicates if the next call re-issued the same number. Asymmetric tradeoff, picked the safe direction.

**[Session 8] Pressure-test recommendations against the actual data shape before greenlighting.** Architectural recommendations need to be cross-checked against the actual data model (row-based vs key-value, scalar vs list, etc.) before going to CC for build. Caught one mid-session pivot this way (column T → JSON state file). Mo's "fewer columns" instinct was the early signal that something was off. Lesson: when the user pushes back on a recommendation with concrete reasoning rooted in the data shape, take it seriously even if the technical case for the original recommendation seems strong.

**[Session 8] A2P 10DLC for Canadian-to-Canadian SMS is not blocked by needing US 10DLC registration.** Twilio Help Center chatbot says it's "US-only and not required for Canada-to-Canada"; their actual regulatory docs say messages "to US and CA numbers via A2P 10DLC must originate from registered brands" since July 2023. Contradictory surfaces. Empirically: Mo's outbound SMS from `+1 647` to `+1 647` numbers has been delivering reliably in session 7 and session 8 testing. Decision: park the A2P question; do not register until we have a written answer from a real Twilio support ticket; do not let SMS deliverability block Phase 1 work.

**[Session 9] Every entrypoint in the project must call `require('dotenv').config()` at the very top.** This is non-obvious because `node` does not auto-load `.env` files, and there's no shared bootstrap module that handles it. Every entrypoint that gets started directly via `node <file>` (or indirectly via Express, or via a test script) needs its own dotenv call as the first executable line. Session 9 found `src/webhook.js` was missing this, which caused the OAuth client to fail with `invalid_request: Could not determine client ID from request` during the live ngrok test even though every other file in the project worked fine. The bug was invisible until the webhook tried to call Google APIs because the test runner (`scripts/test-webhook.js`) DID load dotenv, so the test passed; the webhook running standalone via `node src/webhook.js` did not. **Rule for new entrypoints:** if it's a file that gets started by Node directly (not required by another file), the very first line is `require('dotenv').config();`. No exceptions.

**[Session 9] Webhook signature verification bypass uses three layers of defense, not one.** The bypass (for local ngrok testing) requires ALL of: (1) `WEBHOOK_SKIP_SIGNATURE_CHECK === 'true'` env flag explicitly set, (2) request `Host` header matches `localhost`/`127.0.0.1`/`*ngrok*` (case-insensitive substring), (3) startup warning logged to console. If even ONE of these doesn't apply, signature verification runs normally. Reasoning: a single-flag bypass is one accident away from production exposure (ops engineer copies a `.env` file from staging to production with the flag set). Defense-in-depth means the bypass cannot fire even if the flag accidentally leaks, because production hostnames don't match the allowlist. Locked at architecture level — adding a fourth layer (`NODE_ENV !== 'production'`) is parked in section 7.4 and welcome but not blocking.

**[Session 9] Async respond-then-process is the right pattern for Twilio webhooks.** Twilio expects a 200 within ~15 seconds. Drafting a polished email via Claude can take 5-10s; Gmail send adds 2-3s; Sheet writes add another 1-2s. Total handler time can approach the timeout. **Pattern**: the Express endpoint sends `200 OK` with empty TwiML immediately, then `setImmediate(() => handleAgentReply(...).catch(err => log))` runs the work async. Three consequences: (a) Twilio retries are blocked by the in-memory `MessageSid` idempotency cache (5-min TTL) — even if the async work crashes, retries hit the cache and no-op. (b) Async errors cannot be reported to Twilio (response is already sent). They go to logs and operator email instead. (c) `handleAgentReply` MUST NEVER throw — every code path is wrapped in try/catch internally. An unhandled rejection here is unrecoverable.

**[Session 9] The "demo moment" tests are different from unit/integration tests, and both matter.** The 22-assertion `test-webhook.js` proved the handler logic was correct. The live ngrok test proved the network plumbing (Twilio → ngrok → Express → middleware stack → endpoint) actually works. Either alone is insufficient: integration tests pass while production fails (e.g., the dotenv bug session 9 found), live tests don't catch logic bugs because they only run one happy path. **Rule:** for any new component that touches an external system at the network boundary (webhooks, scheduled jobs, public APIs), have BOTH a logic-level integration test AND a one-time live verification before declaring complete.

**[Session 9] When third-party documentation contradicts itself, prefer empirical evidence and document the contradiction.** Encountered three times in session 9: (a) ngrok status pages disagreed on whether the service was up — official page said up, StatusGator said major outage; we verified empirically that downloads worked and proceeded; (b) Twilio's chatbot vs regulatory docs on A2P 10DLC for Canadian-to-Canadian SMS (carryover from session 8); (c) the URL `bin.equinox.io` returned arm64 binary even when the URL contained `arm64` but Mo's machine was Intel — `uname -m` was the source of truth, not the URL. Pattern: when documentation surfaces conflict, the deployed reality is the tiebreaker. Document the contradiction so future sessions don't relitigate it.

**[Session 9] PROJECT_STATE updates work best when written as deltas to the existing file, not regenerated.** Mo set this rule end of session 6 ("i want to have to wait 10-15 mins everytime i need one. plus it eats up usage."). Session 9 confirmed: editing the working copy with `str_replace` operations took ~5 minutes total; rewriting from scratch in the chat would have taken 15-20 minutes. The value isn't just speed — surgical edits force the writer to identify what actually changed, which catches drift between sessions.


---

## 5. Things to never do

These are land mines. A future session that violates one of these is making a known mistake.

- **Never trust Twilio API success as proof of delivery.** `client.messages.create()` returning a `sid` only means Twilio accepted the request. The carrier can still reject with errors like 30044 (Canadian A2P filtering) AFTER the API returns. Always poll status via `client.messages(sid).fetch()` for terminal verdict. This is what `verifyDelivery()` does.

- **Never let an integration test claim success when it only verified the API returned without throwing.** Verify the actual side effect: SMS delivered, email arrived, Sheet cell changed. The assertion should be on reality, not on intent. (Session 5: this rule was earned the hard way - the original Path 2 test passed all assertions while the SMS was failing silently at the carrier. Mo's gut "I never got a text" caught it.)

- **Never put Shadow Mode logic in gmail.js or email.js.** It is product policy; it lives in the path layer.

- **Never invest more in SMS template content tuning.** Carrier filtering for unregistered Canadian SMS is rate/reputation-based, not content-based. The probe in `scripts/probe-sms-templates.js` confirmed this empirically (all 3 variants delivered cleanly minutes after the original was filtered twice). A2P registration is the actual fix, not template wording.

- **Never use em-dashes (-) or en-dashes (-) anywhere in any file.** The rule is absolute. Run `grep -n "[--]"` before considering any edit done. The only legitimate exception is the literal "Em-dashes (-) and en-dashes (-) are forbidden..." instruction inside drafter prompts, where the characters are being NAMED as forbidden.

- **Never dismiss business registration as "too much work" without checking what is actually involved.** Mo's instinct on this is wrong. Sole proprietorship in Ontario via ServiceOntario is $60 CAD, ~30 minutes online, processed in 2-3 days. It is much smaller than incorporation. He will need it for Stripe billing and business banking eventually. (Note: NOT required for Twilio A2P sole proprietor registration, see corrected facts in Section 7.)

- **[Session 6] Never reuse `HOT_SMS_CONFIDENCE_THRESHOLD` reflexively for other paths.** That gate was set for a Path 2-specific risk profile (false positives on hot signals are embarrassing). Each path that has SMS needs to derive its own gating from its own risk profile. Path 4 uses keyword filter, no confidence gate. Path 1B uses no gate at all. Pattern-matching from Path 2 is wrong by default; reason from first principles.

- **[Session 6] Never write a holding email to a lead without a guaranteed follow-up mechanism.** Path 1B initially proposed sending "Great question, let me check on that", pulled because if the agent ghosts the SMS, the holding email is a broken promise. Holding messages are only safe when paired with a fallback that fires on agent silence (currently parked in Step 4's design space).

- **[Session 6] Never modify the 3 pre-existing em-dash matches in `src/prompts.js`.** Lines around 265, 366, 457 contain literal em-dash characters inside the prompt strings that BAN em-dashes. The character is the subject of the rule. Removing them would break the prompts. Future Claude that sees these in a grep should report them and move on, not "fix" them.

- **[Session 6] Never let an Agent SMS Reply Handler use last-asked-wins routing.** Token-based (Option B) is the locked architecture. Last-asked-wins breaks silently when there are multiple open questions. Misrouting a property answer to the wrong lead is the worst failure mode in the entire system.

- **Never modify a working system as a side effect of another change.** If the categorization prompt is working in step 2, do not tweak it during Path 2 work just because it seems easy. Tweak it deliberately, with before/after comparisons, in its own commit. Scope discipline.

- **Never paste raw `agentConfig`, `.env`, or refresh tokens into terminal output or chat.** Always use a redactor. JSON.stringify with `(k, v) => k === 'googleRefreshToken' ? '[REDACTED]' : v` is the standard pattern.

- **Never mark a path as "done" without exercising all three external dependencies it touches** (Sheet, email, SMS). A load test only proves the file parses. A real integration test sends real messages and verifies real outcomes.

- **Never suggest switching SMS providers as a fix for Canadian deliverability.** All reputable providers (Twilio, MessageBird, Plivo, Telnyx, Bandwidth) face the same carrier filtering because the filtering happens at Bell/Rogers/Telus, not at the provider. Switching is wasted engineering time. The fix is registration with the existing provider.

- **Never assume a single test run that succeeds means the system is reliable.** Probabilistic carrier filtering can deliver one message and reject the next. Reliability claims need multiple runs across different windows. (Session 5 lesson: original template was rejected twice in Path 2 tests, then delivered cleanly in the probe minutes later. Single-run results are anecdotal.)

- **Never try to make the categorizer or any model "pick tone naturally from the message" for stop_signal.** The model is unreliable on this 10% of the time, and the failure mode is bad (cheery on a "we lost a family member" message, apologetic on a "we already bought" message). Use a structured tone signal (categorizer reasoning) instead. (Session 5: Mo's pushback was correct here; the original "let the drafter read tone from the message" recommendation was wrong.)

- **Never let the test file count drift from what the test actually exercises.** When updating assertions, update the assertion-counter and the summary message to match. Counting mismatches confuse future debugging.

- **[Session 7] Never trust Claude Code's `node --check` and grep verifications as proof of correctness.** Those checks confirm syntax and absence of forbidden characters. They do NOT confirm that CC built what was actually specified. Twice this session CC made independent decisions inside its build (ALLOWED_STATUSES expansion, COLUMN_HEADERS column-S name suggestion). One was a real fix, one was wrong. Always demand the actual `git diff` and read it before committing. CC's "ready to commit" is a signal to start review, not finish it.

- **[Session 7] Never specify an API signature in a build prompt without verifying it against the actual code first.** Claude (in chat) wrote `email.sendNewEmail(agent, toAddress, subject, body)` in a step-4 build prompt. The real signature is `email.sendNewEmail(agent, { to, subject, body })`. CC silently corrected it because it grepped the codebase. Lesson: when describing an API call CC should make, refer it back to existing usage ("matches the call shape in src/paths.js line 133") rather than spelling out a possibly-wrong signature. Saves a roundtrip when the signature in Claude's head is stale.

- **[Session 7] Never assume a smoke test that calls `processAgent` directly also exercises step 4.** `processAgent` does not call `checkStaleQuestions`. Only `main()` does. Smoke scripts that bypass `main()` and call `processAgent` directly need to also call `checkStaleQuestions` if they want full-pipeline coverage. The smoke-orchestrator.js extension done late in session 7 is the precedent.

- **[Session 7] Never store time as anything other than UTC ISO 8601 strings.** Column P, Q, S all store UTC. Conversion to local time happens at display only. Reasons: deterministic across server moves, DST-safe, sortable as plain strings, matches every other backend convention. Mo will see `2026-05-04T23:35:28.823Z` in the Sheet as 7:35 PM EDT and that's correct, not a bug.

- **[Session 8] Never put agent-level metadata in the Sheet's column structure.** The Sheet is row-based. A column where only the first cell is meaningful is an architectural smell. Use `agents/<agentId>.state.json` instead. Caught one mid-session pivot this way (column T proposal → JSON state file pivot). The state file is gitignored, atomic-write protected, and easy to extend.

- **[Session 8] Never trust the Twilio Help Center chatbot for compliance answers.** Found contradiction with the actual regulatory docs on A2P 10DLC for Canadian recipients. Chatbot said "US-only, not required for Canada-to-Canada"; docs said "all SMS to US and CA numbers via A2P 10DLC must originate from registered brands." Contradictory across Twilio's own surfaces. For any compliance/billing/regulatory question that affects production, open a real support ticket and get a written answer. Do not pay for registration based on chatbot output.

- **[Session 8] Never let a "test passed" claim stand without seeing the actual assertion lines.** Claude Code's terminal often collapses long output with "+N lines (ctrl+o to expand)". When the collapsed output isn't expanded before pasting, what reaches Claude (in chat) is just CC's summary. Several times this session, that summary was right but unverified. The fix is "ctrl+o then copy", or `cat /tmp/test-output.log` to dump the file and copy from there, or `2>&1 | tee` to write to disk. Always demand the actual assertion lines for new feature tests, or at minimum the tail end (final scenario + summary).

- **[Session 8] Never break a working integration commit-by-commit without sequencing the commits properly.** Session 8 commit 3 (`5c5bafc`) updated the SMS template signature. Between that commit and commit 4 (`fea966e`), the codebase was in a broken-runtime state: `paths.js:718` was calling the old 3-arg signature. The risk is real but bounded if you commit them in fast sequence and don't run smoke tests in between. Lesson: when a refactor splits across commits, document the broken intermediate explicitly in the first commit message so future revert decisions know the correct ordering ("revert commit 4 first, then commit 3").

- **[Session 9] Never start an entrypoint Node process without `require('dotenv').config()` at the top.** Session 9's webhook ran fine through the test runner (which loaded dotenv) but failed in production with `invalid_request: Could not determine client ID from request`. The webhook process had no env vars loaded at all. Every `node <file>` entry point must call dotenv first. No file-by-file judgment about whether it "needs" env vars — call it unconditionally as the first line.

- **[Session 9] Never do "best-effort" dispatch when claude.draft returns escalate=true.** Initial commit-3 implementation logged the warning and proceeded to send the draft. That's a brand risk: escalate=true means Claude couldn't produce a clean draft after 3 retries, so any "best-effort" output likely contains banned phrases. **Pattern is non-negotiable**: log error, send fallback SMS to agent, EARLY-RETURN, preserve the queue entry. The agent re-answers or handles manually. Caught and corrected during commit-3 review session 9. Don't relitigate this in future sessions.

- **[Session 9] Never flip an agent from shadow mode to live mode without a prompt iteration session against real data.** This is the hard gate from section 4.2. Three known prompt-quality bugs (third-person voice, full-name greeting, literal placeholder embedding) make the current Path 1B drafts unsuitable for real leads. The fix requires real lead-reply data, not fake test data. Future sessions that propose live-mode flips without this prerequisite are making a known mistake.

- **[Session 9] Never use a wildcard URL in the Twilio webhook config.** When the ngrok URL changes (every restart on free tier), the URL in Twilio's Phone Number config has to be updated manually. Don't try to set up a wildcard or a redirect. Just update it. ~10 seconds in the Twilio Console. Auto-update tooling parked.

- **[Session 9] Never trust ngrok status pages.** Saw three different status pages disagree about ngrok's state during session 9 (official "no incidents," StatusGator "major outage," IsDown "operational"). The deployable reality (downloading the binary worked, the tunnel worked) was the tiebreaker. Don't waste time trying to find the One True Status Source.

- **[Session 9] Never assume "Apple Silicon" because the hostname looks recent.** Mo's MacBook is named `Mohanads-MacBook-Pro` which suggested recent Apple Silicon hardware. It's actually Intel (`uname -m` returns `x86_64`). The arm64 ngrok binary downloaded fine but failed at runtime with `bad CPU type in executable`. **Source of truth for CPU architecture is `uname -m`, not the hostname or the year.** Apply to any binary download that has architecture-specific variants.

- **[Session 10] Never auto-write `leadCategory = 'soi'` from any code path.** The SOI flag is the agent's brand-protection guard. The system NEVER guesses, classifies, or auto-promotes a row to SOI. Only the agent typing `'soi'` into column T sets the flag. Lead Intake can hint at relationship types in its log entries, but it cannot set leadCategory. Auto-setting SOI defeats the protective purpose of the column.

- **[Session 10] Never auto-message a lead in the agent's SOI.** Once `leadCategory = 'soi'` is set, the validation gate filters that row out before any path runs. No Path 1A, no Path 3 polite cold-out, no follow-ups, no Lead Intake row creation, no anything. The cost of accidentally auto-replying to your friend's mom in a polished AI voice is brand damage that can't be repaired by an apology. Empty leadCategory is action-eligible (default); only the explicit `'soi'` value blocks. Defense-in-depth: dedup on re-engagement preserves SOI status across new emails from the same person.

- **[Session 10] Never send generic broadcast SMS or email like "did you know the market is moving?".** From session 11 Reddit research (u/USAI_DNS, marketer with 4 years of real estate automation experience): generic blasts turn the agent's number into spam and damage long-term deliverability. Every Content Engine output (Phase 3) MUST be either (a) personalized to a specific lead's profile/history, or (b) one-to-many social/newsletter content the lead opted into. SMS broadcasts are categorically banned — bake this into the Content Engine spec when written.

- **[Session 11] Never invent property data, market statistics, prices, listing info, or external facts in any prompt output.** Especially in Follow-Up Sequences. Every prompt has a CANNOT INVENT block listing things the model is not allowed to mention without being given them as inputs. Real estate agents will fire the product instantly if it claims "the property at 45 Maple is now reduced to $850K" when no such information exists. Voice and context are the wedge — never fake data.

- **[Session 11] Never use `--no-pager`-omitting commands when reviewing diffs or test output.** Always pipe through `| cat` or use `git --no-pager diff <file> | cat`. Claude Code's terminal UI collapses long output with `+N lines (ctrl+o to expand)` placeholders that reach Claude in chat as truncated summaries. Approval cannot happen on truncated output. Established as a standing protocol session 10.

- **[Session 11] Never approve a CC commit based on test counts alone.** "57 tests passing" can mean 57 distinct branch-coverage assertions or 57 trivial assertions about boilerplate. Demand the assertion text or representative samples. Sessions 10-11 ended up trusting CC's test counts without inspecting the assertions for ~889 lines of test code combined; that trust is provisional until a future session does an audit pass.

- **[Session 11] Never instantiate the Anthropic SDK directly outside `src/claude.js`.** Every Anthropic API call goes through `claude.js`'s wrappers (`categorize`, `draft`, `callRaw`). One retry policy, one error handler, one rate-limit semantics, one model-config touchpoint. If a new caller needs functionality `claude.js` doesn't expose, add a new exported wrapper rather than going around the module. (Session 11 caught and corrected this mid-build for Lead Intake.)

- **[Session 11] Never let a Day 14 follow-up signal closure to the lead.** No "last follow-up", "final message", "wrapping up", "closing the file", "removing you from my list", "this is my last attempt" or any urgency-by-rejection language. Day 14 is warm and low-stakes. The defense-in-depth banned-phrases list in `buildFollowUpDay14Prompt` is non-negotiable; never strip it. Reasoning: agents may resume sequences (RESUME command) or want to re-engage cold leads later, and any closure-signaling email forecloses on those options.

- **[Session 11] Never run Lead Intake or Follow-Up Sequences live for a paying agent without first running them live for Mo.** Both modules are tested with synthetic fixtures (mocked Gmail, mocked Claude, mocked Sheet). Real-world emails surface edge cases that fixtures don't. The dogfood pass is the gate. Future sessions that propose onboarding a paying agent without this prerequisite are making a known mistake.


---

## 6. Session 11 narrative (what happened, in order)

This section captures session 11 chronologically. Two commits: Lead Intake Tier 2 heuristic classifier (`15920ff`), Follow-Up Sequences with CALLED/RESUME commands (`8fa8bda`). Session ran multi-day (across two calendar days due to fatigue checkpoint), with a session 10 → session 11 boundary inside the conversation.

### 6.1 Day 1 morning: PROJECT_STATE drift continued from session 10

Working tree was clean from session 10's SOI commit. Picked up Lead Intake Tier 2 design conversation. Five Phase 2 design questions had been answered at the end of session 10 (per section 10.2 of session 10's PROJECT_STATE):
- Path A (email parsing) confirmed; Path B (web form) deferred to Phase 2.5 (newly created phase)
- Tier 2 heuristic classifier covers direct emails with no source-specific parser
- Pre-filter rules, confidence thresholds, label-based idempotency all locked

### 6.2 Critical mid-conversation user redirect: Reddit thread research

Mid-Phase-2-design conversation, Mo asked Claude to take a deep dive on a Reddit thread about AI tools agents actually use. Initially the URL was blocked from web fetch; Mo pasted the thread content directly. Key findings that landed in this PROJECT_STATE:

- **u/USAI_DNS** (real estate marketing automation, 4 years experience, 200K+ AI calls analyzed) provided the most actionable data: 35% conversion on saved-search-triggered outreach, 20% reply rate to property-match SMS, do-not-auto-message SOI rule, no-generic-broadcast-SMS rule.
- **u/LuxuryPresence_Aaron** confirmed wedge thesis: tools fail when they live in their own tab, win when they integrate with what agents already use.
- **u/numbruMC** confirmed the "buyers are liars" insight: don't trust self-reported timeline/budget on inquiry forms.
- **u/Ok-Mud5465** (NZ agent): "16 different apps" tool fatigue is real; voice automation cost-prohibitive in non-US markets.

Toronto-specific moat: most US-recommended AI real estate tools (Zillow, ATTOM, Homesage.ai, Offrs, Revaluate) don't cover Canada. The Reddit thread had zero Canadian-native tools mentioned.

Insights recorded for PROJECT_STATE update: the SOI rule (became the Section 5 hard rule and the locked decision in Section 4.2), the "speed-to-lead in Shadow Mode then autopilot" positioning (became Section 1.5), the Canadian-market positioning (became Section 1.6), the no-broadcast-SMS rule (Content Engine constraint).

### 6.3 SOI as the most important addition

Mo identified the SOI gap personally: agents have "Spheres of Influence" (past clients, friends, family, neighbours) who must NEVER receive AI-generated auto-replies. Brand damage from a polished-AI email to a friend's mom is irreversible. Locked: column T `leadCategory`, manual-only flag, never auto-set, validation gate filter applied before any path can run, dedup preserves SOI status across re-engagements. SOI commit landed end of session 10 as `0e900be`.

Mo's specific concern about SOI contact happening more on phone than email was correct and clarifying — the design doesn't need to handle SMS-based SOI for v1 because the system doesn't read inbound lead SMS yet. SOI rule is purely for inbox-arriving emails.

### 6.4 Lead Intake Tier 2 build

CC commit prompt for Lead Intake Tier 2 was the largest commit prompt of Phase 2. Multiple review rounds:

- **Round 1:** CC produced 416 lines of leadIntake.js, 13 fixtures, full test suite (57 assertions). Diffs partially collapsed in CC's UI.
- **Round 2:** Caught contradiction between spec (business_correspondence: remove processing label) and CC's first implementation (business_correspondence: keep processing label). CC's analysis correctly walked through the failure mode (email permanently trapped in `agent-ai/processing` label) and applied the fix.
- **Round 3:** Architectural concern raised: CC's first implementation instantiated Anthropic SDK directly. Refactored to add `claude.callRaw` wrapper to claude.js so all Anthropic calls share one entry point. Test mocks updated to mock `claude.callRaw` instead of the raw SDK.
- **Round 4:** Final approval after CC confirmed: zero tests actually exercise `runLeadIntake` end-to-end (all tests target helper functions or `processClassification` with pre-built classifications). Defense-in-depth `claude.callRaw` mock prevents accidental live-API hits. Logged as parked test-coverage gap.

Commit landed as `15920ff`.

### 6.5 Day 1 evening fatigue checkpoint, multi-day session boundary

Mo hit Claude Code usage limits at ~10pm. Working tree clean, Tier 2 committed. Decided to stop and resume next day. Session 10 → 11 boundary was actually mid-Lead-Intake-Tier-2 review; calling it session 11 is partly arbitrary, but the multi-day boundary makes the split natural for the narrative.

Full sleep, fresh start.

### 6.6 Day 2 morning: LLM Council framework introduced

Mo introduced the LLM Council framework (5 advisors: Contrarian, First Principles, Expansionist, Outsider, Executor → peer review → Chairman synthesis) and asked Claude to apply it whenever appropriate, not just when explicitly invoked.

Pushback from Claude: full council on every reply would 5x reply length and break collaboration on simple/execution questions. Negotiated: framework auto-fires on irreversible / strategic / multi-faceted decisions; normal mode for execution, factual questions, routine code review. Mo explicitly instructed it can override either way ("Council this" / "skip the council, just answer"). Locked as Section 8.19.

### 6.7 Day 2: Follow-Up Sequences design conversation

Used the LLM Council on the fundamental "what is a follow-up FOR" question. Three views: View 1 (polite re-ping), View 2 (value delivery), View 3 (qualification). Mo's instinct: View 2 only with REAL data, otherwise View 1.

Council analysis on "real data is unreachable in v1" (no Realtor.ca API, no MLS access, no Canadian listing feed): Chairman recommendation was View 1 in shape (time-triggered fixed cadence) with View 2 in spirit (each touch contextually generated against the lead's specific original inquiry, no external data invented). Mo locked it.

Followed by 8 design questions, all locked. Notable: Day 14 prompt MUST NOT signal closure to the lead — Mo's specific call. Per-agent configurable cadence with default `[3, 7, 14]`. CALLED/RESUME SMS commands for manual handling. Pre-flight thread fetch to catch manual sends.

Cadence-count question: Council analysis on "should we leave it at 3 follow-ups or extend." Locked at 3 for v1, parked the question of extending based on real conversion data (after 30 days of paying-agent runs).

### 6.8 Follow-Up Sequences build

Largest single commit of Phase 2. ~1742 line insertions across 8 files:
- `src/followUp.js` (200 lines, new)
- 3 new prompts in `src/prompts.js` (Day 3, Day 7, Day 14)
- `src/agentConfig.js` `getFollowUpCadence` helper
- `src/webhook.js` CALLED/RESUME handlers + dispatch
- `src/index.js` Step 5 wiring
- `scripts/test-followUp.js` (61 assertions)
- `scripts/test-followUp-fixtures.json` (12 fixtures)
- `scripts/test-webhook-called-resume.js` (44 assertions)

Review rounds:
- **Issue 1:** Day 14 prompt initially contained "This is the last outreach" and "wrapping up your outreach" language. Violated Mo's locked rule. CC fixed by reframing to neutral language and adding a Day 14-specific banned-phrases list.
- **Issue 2:** Diffs partially collapsed; demanded full file pastes. CC produced full text of `src/followUp.js` for inspection.
- **Issue 3:** Five verification questions answered correctly:
  - Q1: timestamp source = `lastFollowUpDate` (column J), fallback `lastActionTimestamp` (column P)
  - Q2: 8-days-elapsed-with-count-0 fires only Day 3 (touchIndex derived from followUpCount, structurally one-fire-per-cycle)
  - Q3: Day 14 final-touch updateSheetRow writes followUpCount='3', lastFollowUpDate=now, status='cold', lastActionTimestamp=now
  - Q4: threading pre-flight uses pre-existing `email.getThreadHistory` (no architectural smell, reuses session 9 helper)
  - Q5: Section 9 of test file specifically tests one-fire-per-cycle with followUpCount=1 + 20-days-elapsed → only one fire, count advances by 1

Approved and committed as `8fa8bda`.

### 6.9 OAuth scope verification

After Tier 2 commit, ran a quick `gmail.listLabels` test against Mo's mo-test agent to verify the existing `gmail.modify` OAuth scope grants label create/apply permissions (Lead Intake creates `agent-ai/processing`, `agent-ai/intaken`, `agent-ai/noise` labels on first run). First attempt failed with `invalid_request: Could not determine client ID` because the `node -e` one-liner ran from `/tmp/` which didn't have access to `.env` or `node_modules`. Second attempt from the project directory passed cleanly: 14 existing Gmail labels listed, no agent-ai/* labels yet (will be created on first runLeadIntake fire).

### 6.10 Live testing deferred

Mo asked about live testing Lead Intake. Recommendation: defer to a focused session, not stack live verification on top of three-commit fatigue. Live test creates real Gmail labels and writes real Sheet rows on classified leads — it's directional but not reversible without manual cleanup. Deferred to a focused session 12 or later.

### 6.11 PROJECT_STATE update during session 11

This section. Session 10 + 11 changes accumulated heavily before the update happened. Multi-wave surgical edit approach kept the file structurally intact.

### 6.12 End of session 11 deliverables

Three commits across sessions 10-11:
- `0e900be` SOI protection (session 10)
- `15920ff` Lead Intake Tier 2 (session 11)
- `8fa8bda` Follow-Up Sequences + CALLED/RESUME (session 11)

Phase 2 ~75% complete. Daily Digest is the next module. Live verification of Lead Intake AND Follow-Up Sequences against Mo's inbox is locked as a HARD GATE before any paying agent goes live.


---

## 6T. Session 10 narrative (what happened, in order)

Session 10 was short and focused: SOI protection layer build, plus the strategic Reddit research detour that produced positioning insights. One commit: `0e900be` (SOI protection / column T leadCategory).

### 6T.1 Session 10 opener and Phase 2 design questions

Mo opened with the standard session opener. Working state from session 9: Phase 1 complete, working tree clean. Phase 2 design conversation began with the 5 Lead Intake design questions per section 10.2 of session 9's PROJECT_STATE.

### 6T.2 Reddit thread research interrupt

Mo redirected mid-design to a Reddit thread on AI tools agents are actually using. Deep dive produced the SOI insight (which became the most important addition of session 10), the Canadian-market moat observation, and the "no generic broadcast SMS" rule. See sections 1.5, 1.6, and 4.2 for the specific decisions; see Reddit research notes in session 11 for the full thread analysis (since the actual research happened during the multi-day session 11 conversation but produced session 10's design choices).

### 6T.3 SOI gap identified

Mo's contribution: while reviewing the Reddit thread, identified that the system needed a hard guard against auto-replying to the agent's personal network. Locked: column T `leadCategory` value `'soi'` filters rows out at the validation gate. Manual-only flag. The system never auto-sets it.

### 6T.4 SOI build (Phase 2 commit 1)

Multi-round CC review, mostly clean. Notable touches:
- Schema change: column T `leadCategory`, COLUMN_MAP gains `leadCategory: 'T'`, range strings updated A2:S → A2:T everywhere
- Side-effect fix: `appendSheetRow` had stale `A:R` range from before column S was added in session 7. Updated to `A:T`. No functional bug because Sheets API uses range only for tab targeting (row data length determines actual cells written), but the stale range was misleading.
- New helper: `isLeadCategoryActionable(row)` returns false for case-insensitive trimmed `'soi'` match, true for everything else including null/undefined/empty
- Wired into Step 1 validation gate alongside `isAiEnabled` and `isWithinRateLimit`
- 18-assertion test (`scripts/test-leadCategory-filter.js`) covering case variants, whitespace handling, null/undefined defaults, log call capture

Mo manually added `Lead Category` header to cell T1 of the live mo-test Sheet after commit landed.

### 6T.5 End of session 10

Working tree clean, single commit `0e900be`. Plan to continue Phase 2 with Lead Intake Tier 2 next session.


---

## 6V. Session 9 narrative (what happened, in order)

This section captures session 9's decisions and discoveries chronologically. Five commits, all green: `findAgentByPhone` helper (`6fc2965`), Express webhook scaffold with signature verification + idempotency + agent lookup + token parsing (`8afc25d`), full handler logic with mode-aware Claude drafting + Gmail send + queue removal + status update (`698436d`), 22-assertion integration test (`484cd57`), dotenv fix discovered during live ngrok test (`70ca8bf`). Phase 1 (Reply Detection) is functionally complete and live-tested end-to-end.

### 6.1 Session opener and the "park this for later" rule

Mo opened with an "add this to the next PROJECT_STATE update" — a parked item for a per-agent toggle to disable Path 1B escalation email. Logged it before starting actual work, applying the section 8.12 "running notes" commitment from session 7. That parked item lands in section 7.4 of this update.

Then the standard session opener checklist. Session 9's working-on-now: webhook build. Got into design questions immediately.

### 6.2 Nine webhook design questions, locked one by one

Settled the design before code. Mo answered the obvious ones quickly and pushed back on two:

1. **Endpoint path**: `/sms-incoming`. Locked.
2. **Agent lookup by phone**: in-memory map built at server startup by scanning `agents/*.json` (excluding `*.state.json`). Helper `findAgentByPhone(phone)` in `src/agentConfig.js`. Locked.
3. **Token parsing on multi-token replies**: this was the one Mo pushed back on. Initial recommendation was Option A (strict first-token-wins, silently treat the rest as the answer). Mo asked "what if the agent answers two questions in one text?" — surfaced the ambiguity. Walked through three options: A=first-token-wins (silent garbage), B=detect+clarify SMS (one extra round-trip first time), C=split on tokens and route each chunk (complex). Recommended B, Mo locked B.
4. **Wrong-token / no-token response**: SMS agent with open questions, soft cap of 5. Locked.
5. **Bad agent (phone not in any config)**: log warning, ignore. Locked.
6. **Signature verification**: enabled by default, bypass via `WEBHOOK_SKIP_SIGNATURE_CHECK=true` env flag for local ngrok testing. Mo asked the right clarifying question ("does it mean the texts will say sum about twilio?") — translated the security check into plain language. Then locked the 3-layer defense: env flag + hostname allowlist + startup warning.
7. **Async respond-then-process**: 200 immediately, work via setImmediate. Locked.
8. **Idempotency**: 5-min in-memory MessageSid cache. Locked.
9. **Server lifecycle**: separate process from orchestrator. Locked.

### 6.3 Build sequence (5 commits across the session)

**Commit 1: `findAgentByPhone` helper (`6fc2965`).** ~20-line helper in `src/agentConfig.js`. Scans `agents/` directory, excludes `*.state.json`, returns matching agent or null. Per-file JSON parse errors logged and skipped (don't crash the lookup). Path resolution via `__dirname` so it works regardless of cwd. Reviewed and committed cleanly.

**Commit 2: Express scaffold (`8afc25d`).** Bigger commit — ~120 lines for the webhook server. Express setup, `/sms-incoming` endpoint, `twilio.validateRequest` signature check, hostname-allowlist bypass logic, in-memory `processedSids` Map with 5-min TTL and 60s cleanup interval (`.unref()`'d so it doesn't hold the Node process open in tests — CC added this proactively, correct call), `parseToken` regex `/Q\s*-?\s*(\d+)/gi` returning `{type: 'none'|'single'|'multi', token}`, agent lookup, idempotency check, and a single log line summarizing what would happen. Handler logic deferred to commit 3 — this commit just logs and returns 200.

CC initially produced 150+ lines of webhook code; session 9 review caught a few stylistic notes (string concatenation vs template literals, mixed in places) and one design subtle (the bypass guard checks both env flag AND hostname — if either fails, signature verification runs normally). All correct.

**Commit 3: Handler logic (`698436d`).** The meatiest commit of the session. ~250 lines added across `webhook.js` and the `buildShadowDraftWrapper` export from `paths.js`. Handler does: cross-row scan via `parsePendingQuestions` + `findEntryByToken`, build prompt, call Claude with banned phrases, mode-aware send, defensive re-read before queue update, status update, column L append. Three blocking issues caught in review and fixed before commit:
1. **Escalate handling drift**: CC's first cut logged `result.escalate === true` and proceeded with "best-effort" send. That contradicts the session 5 spec (escalated drafts contain banned phrases, can't go to leads). Fix: early return after logging + fallback SMS to agent, queue entry preserved.
2. **Stale snapshot on queue update**: CC used `matchedRow.pendingQuestion` (5-10s stale during Claude draft). Fix: defensive re-read from Sheet before computing the updated queue.
3. **Status update missing**: CC's `updateSheetRow` call omitted status. Fix: compute `newStatus = remainingEntries.length === 0 ? 'warm' : 'awaiting_agent'` and include in the update.

CC applied all three fixes cleanly. Re-reviewed, syntax + grep clean, committed.

**Commit 4: Integration test (`484cd57`).** 22 assertions across 6 scenarios. New row 7 fixture added to mo-test sheet to avoid colliding with rows 2-6 used by other tests. Test calls `handleAgentReply` directly, bypassing Express. Pattern: snapshot row state, run handler, assert post-state, restore via `clearRow7`. Length-based assertion on column L (`lenA_after > lenA_before`) replaced an initial brittle `includes()` check that would have passed on rerun even if the handler did nothing.

Live run: all 22 passed, 4 SMS arrived on Mo's phone (scenarios C, D, E, F), 2 shadow draft emails arrived in Mo's inbox (scenarios A, B). Mo's manual side-effect check confirmed.

Mo flagged the third-person voice in scenario A's shadow draft email ("Hi Webhook, Mo would be happy to arrange..."). Then in scenario B's draft, observed Claude wrapping prose around literal placeholder text ("the answer is here is the answer to question one"). Both real prompt-quality issues, both in `src/prompts.js`, both parked for the dedicated prompt iteration session against real data. Ground rule established: don't tune prompts against fake test data.

**Commit 5: Dotenv fix (`70ca8bf`).** Discovered during the live ngrok test (section 6.4). Single line: `require('dotenv').config();` at the top of `src/webhook.js`. Webhook had been running tests fine because the test runner loaded dotenv, but standalone `node src/webhook.js` started without env vars, and the OAuth client failed with `invalid_request`. Fix is universal — every Node entrypoint needs its own dotenv call.

### 6.4 Live ngrok end-to-end test

The "demo moment" verification. Several detours.

**Detour 1: ngrok install on Intel Mac.** `brew` not installed (so much for `brew install ngrok`). Direct download from `bin.equinox.io`. First attempt grabbed the arm64 binary — failed at runtime with `bad CPU type in executable`. `uname -m` returned `x86_64`. Re-downloaded the amd64 binary. Worked. Ngrok version 3.39.1 installed in `/usr/local/bin/`.

**Detour 2: ngrok signup blocked briefly.** `curl -I https://ngrok.com` hung. Tried browser, didn't load. Status pages disagreed (official: no incidents; StatusGator: major outage; IsDown: operational). Decided to wait. Mo came back ~10 min later, signup loaded fine, authtoken saved.

**Detour 3: Twilio Console URL configuration.** Existing webhook URL was Twilio's `demo.twilio.com` placeholder. Replaced with the ngrok URL. URL: `https://flounder-outsource-hardly.ngrok-free.dev/sms-incoming`. Note the `.ngrok-free.dev` TLD — newer ngrok subdomain format, not `.app`.

**Live test 1**: Mo texted `Q1 1850 sqft and 3 bedrooms` from his phone to `+16476925913`. Webhook log:
```
webhook: agent=mo-test messageSid=SMce... token=Q1 bodyPreview=...
webhook: readSheetRows failed for agent mo-test: invalid_request
```
Webhook found the agent and parsed the token correctly. Failed at the Sheet read. Same `invalid_request` error from earlier in the session — dotenv not loaded in webhook process. Wrote commit 5 (one-line fix), restarted webhook.

**Live test 2**: Same SMS again. Webhook log:
```
webhook: agent=mo-test messageSid=SMd5... token=Q1 bodyPreview=...
[webhook] agent=mo-test token=Q1: Claude draft ready (1 attempt(s))
[webhook] agent=mo-test token=Q1: shadow draft sent to agent (mohanadmohamed416@gmail.com)
```
Mo confirmed: shadow draft email arrived in inbox, row 7 in Sheet flipped to `warm` with empty M and updated P. **Phase 1 verified end-to-end.**

### 6.5 Strategic conversations after the test passed

Mo asked three big questions after the live test that shaped the parked-roadmap section:

**Q1: Lead Intake — does it pull leads from Facebook/Instagram ads, and can we run ads for agents?** Walked through the lead-source landscape (portals, brokerage CRM, ads, personal sites, referrals). Recommended Path A (email-parsing) for Phase 2 since most leads already arrive as emails. On running ads: explicit "no, not in scope" with the strategic reasoning (different business, dilutes pitch, wrong customer). Locked.

**Q2: What aspects/features am I missing?** Surfaced 7 gaps. Mo accepted 6 (operator weekly digest, shadow-mode feedback loop with thumbs up/down, pre-categorization filter, undo window scoped to stop_signal only, phone integration parked with stock answer, data-ownership stance, multi-agent same-brokerage). Pushed back on one (separate sheets per agent — confirmed already isolated by architecture). Also clarified Royal LePage signature, not Royal LePage Burloak.

**Q3: Confirmation SMS to agent on Path 1B success?** Discussed honestly: confirmation on every reply doubles SMS volume; option B (only when status flips to warm) is cleaner. Parked for Phase 2 with usage data as the trigger.

### 6.6 Maintenance rule paid off

Mo asked for the PROJECT_STATE update to be a downloadable file with surgical edits, not a regenerated rewrite. Section 8.10 maintenance rule from session 6 held up perfectly. Edits took ~5 minutes via `str_replace`. Same as session 8.

### 6.7 End of session

Five commits + this PROJECT_STATE update. Phase 1 done. Phase 2 starts next session.

Mo's energy held through ~3.5 hours of work. The third-person prompt issue and the literal placeholder embedding bug are real and need the prompt iteration session before any paying agent. Hard gate locked into section 4.2.

ngrok install (procedure documented in section 9 for next time), Twilio Console URL configured, mo-test row 7 added as the webhook test fixture (section 9.3 updated).

---

## 6X. Session 8 narrative (what happened, in order)

This section captures the actual decisions and discoveries of Session 8 in chronological order. Five commits, all green: pendingQuestions module (`d5ab451`), agentState module (`bd36fda`), SMS template signature change (`5c5bafc`), pathAskAgent refactor + test updates (`fea966e`). Plus one PROJECT_STATE update (this commit). Phase 1 is now ~85% complete; only the webhook itself remains.

### 6.1 Session opener and the A2P detour

Mo opened with "what's next." Posted the session-opener checklist and asked the integration-test-vs-handler-first question. Mo picked handler first.

Before any code, Mo's Twilio account state surfaced. Sessions 5-7 had assumed an A2P 10DLC registration was either filed or imminent. Session 8's screenshots showed: account onboarding complete (verified phone, paid account, etc.) but A2P 10DLC NOT registered. The "Brands" and "Campaigns" pages still showed "Get started > Register" buttons.

Detoured into A2P investigation. Twilio Help Center chatbot said US 10DLC is not required for Canada-to-Canada SMS. Web search of Twilio's actual regulatory docs contradicted that: "all SMS to US and CA numbers via A2P 10DLC must originate from registered brands" since July 2023. The two surfaces disagreed. Mo's empirical signal (SMS has been delivering reliably) tipped toward "park the question, don't register on contradictory advice." Decided: open a Twilio support ticket eventually for a written answer; meanwhile, don't let the question block Phase 1.

### 6.2 Six handler design questions, locked one by one

Settled the design before code:

1. **Webhook framework: Express.** Standard for "listen at this URL, run code." Reusable in Phase 4 for the Onboarding page.
2. **Token counter location: pivoted from "Column T" to JSON state file.** Initially recommended Column T to keep everything in the Sheet. After Mo's "fewer columns" instinct, pressure-tested the design and realized: a single integer doesn't fit a row-based schema. The "column where only the first cell is meaningful" is an anti-pattern. Pivoted to `agents/<agentId>.state.json`. Captured this as a working-style lesson (section 8.X).
3. **Token format: `[Q47]` brackets at start of cell, strict regex.** Considered `|||` triple-pipe delimiter for collision safety; ultimately picked brackets because they're conventional and visually obvious in the Sheet. Risk of lead questions starting with `[Anything]` is low; will fail cleanly if it happens.
4. **Open-questions cap on wrong-token suggestion: soft cap of 5 with overflow language.** Mo initially said "no cap"; pushed back with the SMS-segment-cost argument; Mo accepted the soft cap.
5. **Wrong-token replies: no-op on data, suggestion SMS only.** Locked.
6. **Stacked questions on one lead: Mo picked Option C (full queue model) over Option B (graceful degradation).** Walked through the cost (parser/serializer + state file + path refactor + cross-row token lookup in handler). Mo's reasoning: "I just do not want to have to do this robust work later if I have to, would rather get it done now." Honest tradeoff, picked it knowingly.

### 6.3 Build sequence, step by step

10-step build plan. Got through steps 1-6 this session.

**Step 1: `src/pendingQuestions.js`** (commit `d5ab451`). Pure parser/serializer. Four functions: `parsePendingQuestions`, `serializePendingQuestions`, `findEntryByToken`, `removeEntryByToken`. No I/O, no deps. Strict regex. CC's first cut had two minor issues (output formatting style with em-dashes in CC's tables, not in the file; minor stylistic asymmetry on falsy-token branches) , neither blocking. Greenlit.

**Step 2: `scripts/test-pending-questions.js`** (same commit). 57 assertions. Tests cover empty/null/undefined input, single/multi entries, malformed entries (silently skipped), brackets in question (greedy match works), the `||`-in-question truncation (documented as known limitation), case-sensitive on the `Q` literal, round-trip parse/serialize, immutability of `removeEntryByToken`. All passing.

**Step 3: pivoted from "add column T" to `src/agentState.js`** (commit `bd36fda`). Mid-stream pivot after thinking through "where does a single integer live in a row-based schema." Built three functions: `getState` (default if missing, throws on malformed JSON), `setState` (atomic tmp-file-then-rename), `issueToken` (read+increment+write+return). 14 assertions in `test-agent-state.js`. Snapshot/restore pattern via try/finally. Uses `__test_agent_state__` as a fake agent ID to avoid colliding with mo-test. Verified no leaked files after the run.

**Step 4 (commit 1 of 2): SMS template signature change** (commit `5c5bafc`). Updated `leadPropertyQuestion` from `(leadName, leadEmail, question)` to `(leadName, leadEmail, question, token)`. New body: `[Q47] Sarah Chen (sarah@example.com): "What's the square footage?"\n\nReply: Q47 <your answer>`. Mo picked the compressed one-line layout over the two-line version for SMS character economy. This commit deliberately broke `paths.js:718` runtime (3-arg call against a 4-arg template); commit 2 of 2 fixed it within the same session. Documented the broken intermediate state in the commit message.

**Step 4 (commit 2 of 2): pathAskAgent refactor + test updates** (commit `fea966e`). The big one. Three stages:
- Stage 1: Added `agentState` snapshot/restore to the test (try/finally).
- Stage 2: Replaced strict-equality column M assertions with queue-model assertions (token format regex, parsed entry token+question, cross-scenario token uniqueness).
- Stage 3: Added Scenario C , fire Path 1B twice in a row without resetting M between fires, verify queue length 2 with two distinct tokens in correct order.

Path code: token issuance (Step 0) wrapped in try/catch with early-return, then read-parse-append-serialize-write the queue, then SMS with token, then column L log includes the token for debug traceability. Existing best-effort patterns for column L / email / SMS preserved.

### 6.4 The live test run

Pre-flight check found row 2 still in session 7's leftover state: `awaiting_agent`, leftover pendingQuestion, backdated lastActionTimestamp, populated reminderSent. Mo manually cleared it before running.

Ran `node scripts/test-paths-askagent.js` against the live mo-test sheet. 36/36 passed. Tokens issued in sequence: Q1 (Scenario A) → Q2 (Scenario B) → Q3 + Q4 (Scenario C). All 4 SMS delivered, all 4 escalation emails sent. Queue parse for Scenario C verified two entries in order. State file lifecycle worked: snapshot was null (file didn't exist), restore deleted the file the test created.

Mo confirmed: SMS arrived on his phone in real-time. Twilio is working fine for Canadian-to-Canadian without A2P registration (today, at this volume).

### 6.5 PROJECT_STATE update process refinement

Mo asked to write the PROJECT_STATE as an editable file (this file) so the upload-to-Project workflow stays clean. Done.

Maintenance rule (from session 6) held up well: surgical edits, not regenerate-from-scratch. Touched ~15 sections, preserved the rest.

### 6.6 End of session

Five commits. Phase 1 is ~85% done. Webhook itself is the only major piece remaining.

Mo's energy was good throughout but session was long (3+ hours). Stopping after the PROJECT_STATE commit. Next session: webhook build (`src/webhook.js` + `scripts/test-webhook.js` + ngrok live test).


---

## 6Y. Session 7 narrative (what happened, in order)

This section captures the actual decisions and discoveries of Session 7 in chronological order. Five commits, step 3 and step 4 both shipped with smoke tests behind them, plus one pre-existing latent bug fixed.

### 7.1 Session opener and step 3 design

Picked up cleanly from session 6's PROJECT_STATE. The session-opener convention worked as designed - Mo said "let's continue," I posted the three-section checklist, no re-orientation needed.

Settled five step-3 design questions before writing code: (1) switch-style dispatch in a new `executePath` helper, (2) treat `skipped` as non-failure, (3) unknown category → pathNeedsReview defensive default, (4) build the rate-limit gate, (5) build the AI-Enabled gate. Mo greenlit all five. Two of those (4 and 5) turned out to be redundant - recon showed `isWithinRateLimit` and `isAiEnabled` already filter rows at validation time, so step 3 doesn't need its own gates. Adjusted on the fly without touching the original five-decision frame.

### 7.2 Recon-driven design pivots

Three rounds of "ask Claude Code to grep before writing code" surfaced things I would have missed:

**Round 1:** existing helpers (`isWithinRateLimit`, `isAiEnabled`) already gated rows. No new gates needed in step 3.

**Round 2:** the gates filter at row level, BEFORE messages are even fetched. Rate-limited replies don't get logged to column L this cycle. Spec section 3 wanted observation-without-action; current code is action-blocking by exclusion. Logged as a known tradeoff but not fixing now.

**Round 3:** post-categorization sequence was log → markRead → done. Step 3 needs markRead to MOVE - gate it on `result.ok`. Real edit, not just an addition.

This pattern is worth preserving in process going forward: design conversations work best when grounded in actual code reads, not memory of architecture. Several mid-design corrections this session came from sending CC to grep before settling.

### 7.3 Commit 1: ALLOWED_STATUSES fix (`ef7f1bd`)

CC was supposed to be writing step 3 when it noticed something extra: `ALLOWED_STATUSES` was missing `warm` (set by Path 1A) and `awaiting_agent` (set by Path 1B). Pre-existing latent bug from sessions 5-6 - would have invalidated rows on cycle 2 after a successful path run. Step 3 surfaced it because step 3 is what makes `processAgent` actually call those paths.

I almost rejected CC's proactive fix as scope creep. Asked Mo for verification recon. Recon proved the fix was real and necessary. Committed it FIRST (older), then step 3 on top - so reverting step 3 doesn't lose the latent-bug fix.

Lesson recorded: CC's opportunistic improvements get the same review scrutiny as anything I'd suggest. Sometimes catches real bugs, sometimes proposes drift.

### 7.4 Commit 2: Step 3 orchestrator dispatch (`7091305`)

`executePath` helper with the switch. Fall-through for `answer_general` / `conversation_continue` - both route to `pathAnswerGeneral`. Unknown category → pathNeedsReview with warn. markRead moved to gate on `result.ok`. Duplicate Lead ID `console.warn` added to leadIndex build. Per-reply summary log enriched with `ok=` and `(skipped)`.

CC catch worth noting: I wrote `result.skipped ? '(skipped)' : ''` in the prompt. Boolean check on an array. Empty array is truthy in JS. CC fixed to `result.skipped && result.skipped.length > 0`. Doc bug surfaced: PROJECT_STATE describes the path contract as `{ok, actions, skipped, errors}` without typing the fields. Adding type clarification.

### 7.5 Commit 3: Smoke test for step 3 (`3bf365e`)

Mo wanted to skip directly to step 4 after step 3 commit. I pushed for a smoke test first - shipped untested orchestrator code is a senior-eng red flag. Mo agreed (option C: quick manual smoke, not a full automated test).

Built `scripts/smoke-orchestrator.js` - 30-line wrapper around `processAgent`. Required exporting `processAgent` from `src/index.js`, guarded by `require.main === module` so direct invocation (`node src/index.js`) still runs main(). CC suggested the guard proactively; correct call.

First smoke run died with OAuth refresh failure. Refresh token had expired (Testing-mode 7-day inactivity revocation). Re-auth via `scripts/authorize.js`, which auto-flipped isActive back to true. Second run was green: row 2 categorized as `answer_general`, Path 1A drafted and shipped a `[SHADOW DRAFT]` to the agent inbox, status flipped to `warm`, column L logged, message marked read. End-to-end confirmation that step 3 dispatches correctly.

Two Path 1A polish items surfaced (deferred, not Phase 1 blockers): the sign-off block has the persona's `agentSignature` appended on top of the prompt-generated sign-off (duplication), and the greeting uses the full name from column B verbatim instead of parsing first name. "Hi Valid" instead of "Hi Valid Lead" is correct but coincidental - the row's name is literally "Valid Lead." Real names like "Sarah Chen" would produce "Hi Sarah Chen" which is wrong.

### 7.6 Step 4 design and the lead-facing fallback debate

Mo flagged the pre-deferred design question from session 6: does step 4 have a lead-facing fallback after N hours? My initial recommendation was yes, 24-hour threshold, hardcoded "still gathering this info" template. Mo pushed back: any such message implies the agent didn't know a basic answer, which damages reputation more than silence does.

Worked through three honest options. Mo's instinct (no lead-facing fallback) was the right one. Pivoted to operator-escalation-instead - at 24 hours, instead of messaging the lead, email the operator (Mo) so he can call the agent directly. Cheap to add, real diagnostic value during early-agent-onboarding.

Locked: agent reminder at 2hr + operator escalation at 24hr. No lead-facing message at any threshold.

### 7.7 Schema design for step 4's tracking columns

CC reported COLUMN_HEADERS state and proposed naming column S as `Reminder Sent At` (a timestamp). That was wrong - it pattern-matched on existing schema instead of building what we asked for. The actual design was column S = `operatorEscalated` (boolean tracking).

But CC's wrong suggestion exposed a real consistency win. Column Q stored `'true'` as a flag with no time info. The escalation email would benefit from "reminder fired at <ts>." Pivoted: BOTH Q and S store ISO timestamps, blank means not-yet-sent. Truthy check is `!row.<key>`. Headers became `Reminder Sent At` and `Operator Escalated At`.

Audit before changing column Q: grepped for every `reminderSent` reference in the codebase. Result: column Q was effectively dead code - defined in COLUMN_MAP, no read or write anywhere. Step 4 would be its first usage. Zero migration risk on existing data. Greenlit the rename.

### 7.8 Commit 4: Step 4 stale question handling (`45215eb`)

`checkStaleQuestions(agent)`, `sendOperatorEscalationEmail(agent, row)`, two new constants (`STALE_REMINDER_MS = 2hr`, `STALE_ESCALATION_MS = 24hr`), main() integration, COLUMN_MAP added `operatorEscalated: 'S'`, range update from `A2:R` to `A2:S`, setup-sheet.js header rename + new entry + `// 19 column headers` comment update.

Two findings during diff review:
- **False alarm:** I worried the COLUMN_HEADERS array was misordered. It was correctly appended.
- **My mistake:** I wrote the wrong `sendNewEmail` signature in the prompt - described it as positional 4-arg when it's actually 2-arg with options object. CC ignored my wrong instruction and wrote against the codebase convention. Recorded as "verify API signatures against code before specifying them in build prompts."
- **Real but parked:** main() now double-loads agent config (once via id inside processAgent, once via loadAgent before checkStaleQuestions). Acceptable for v1, refactor parked under section 7.4.

Mo manually updated the live mo-test Sheet: renamed Q1 to `Reminder Sent At`, added S1 `Operator Escalated At`. Five seconds.

### 7.9 Commit 5: Smoke test extension for step 4 (`767dc6c`)

Realized late: the smoke script called `processAgent` directly, not main(). So step 4 wouldn't fire from it. Two options to fix: extend the smoke script, OR run `node src/index.js` directly. Picked extend - kept the smoke pattern of one easy command.

3-line addition: `checkStaleQuestions(agent)` after processAgent, with a clear separator and a result line. Required exporting `checkStaleQuestions` alongside `processAgent`.

### 7.10 Step 4 smoke run

Mo prepped Row 2: status=`awaiting_agent`, populated column M with a fake property question, set column P to 2.5 hours in the past via `node -e "console.log(new Date(Date.now() - 2.5 * 60 * 60 * 1000).toISOString())"`, cleared Q and S.

Smoke ran clean: `reminders=1 escalations=0 errors=0`. SMS arrived on Mo's phone (good signal that A2P review queue isn't blocking us today either). Column Q got an ISO timestamp. Column L got a "2hr reminder SMS sent to agent" entry. Status stayed `awaiting_agent` (correct - step 4 doesn't change status).

Mo asked about the timestamp - `2026-05-04T23:35:28.823Z` showing as 7:38 PM. Walked through UTC vs local. Correct behavior, not a bug. Display formatting deferred to Phase 2 (Daily Digest will be the first place a human reads timestamps regularly).

### 7.11 Maintenance rule reinforcement

Mid-session, Mo reminded me: "make sure to remember to add things, I don't want to have to remind you." I had been noting items to add to PROJECT_STATE without proactively tracking them. Started keeping a running session-7 notes list explicitly. Items from that list landed in this update without needing a final reminder pass.

Worth promoting in section 8: when a future Claude says "I'll add this to running notes," that's a commitment, not a maybe.

### 7.12 End of session

Five commits:
- `ef7f1bd` ALLOWED_STATUSES latent-bug fix
- `7091305` Step 3 orchestrator dispatch
- `3bf365e` Smoke test for step 3
- `45215eb` Step 4 stale question handling
- `767dc6c` Smoke test extension for step 4

Phase 1 is 75% done. End-to-end integration test and Agent SMS Reply Handler remain.

Mo's A2P registration is still in 48-hour review. Will surface again at session 8 start.


---

## 6Z. Session 6 narrative (historical reference)

Preserved for traceability. Session 6 was Path 4 (`15fe659`), Path 3 (`f8557d8`), the conversation_continue 6th categorizer category (`4573512`), the Path 1A FOLLOW UP block (`1057377`), the Path 1A code (`2a5a136`), and Path 1B initiation (`266b07c`). Key decisions: 6th category, single-purpose column M, no holding email in Path 1B, token-based Agent SMS Reply Handler routing, Shadow Mode canonical definition, session-opener convention, surgical PROJECT_STATE editing rule. Locked decisions from session 6 are in section 4. Things-to-never-do from session 6 are in section 5.


## 6AA. Session 5 narrative (historical reference)

Preserved for traceability. Session 5 was Path 2 (`631ca8b`), the prompts.js extensions (`ed60935`), the email Subject mojibake fix (`0b2699b`), and the SMS template probe (`0981af8`). Key discoveries: Twilio API success ≠ carrier delivery; Canadian carriers filter unregistered traffic; carrier filtering is rate/reputation-based, not content-based. Locked decisions from session 5 are in section 4. Things-to-never-do from session 5 are in section 5.


---

## 7. Parked roadmap items (future work, in rough priority order)

These are real items that need to happen eventually but are intentionally deferred. Each one notes WHY it is parked and WHEN to revisit.

### 7.1 Infrastructure / production-readiness

**Twilio Canadian SMS deliverability , needs investigation, do NOT register without a written answer.**
- **What:** Earlier sessions assumed A2P 10DLC Sole Proprietor registration was the fix for intermittent Canada-to-Canada SMS filtering. **Session 8 reality:** Twilio's Help Center chatbot says A2P 10DLC is "US-only and not required for Canada-to-Canada"; their actual regulatory docs say "all SMS to US and CA numbers via A2P 10DLC must originate from registered brands" since July 2023. **Contradictory across Twilio's own surfaces.**
- **Status of Mo's account (verified session 8 via screenshots):** Twilio account onboarding complete (paid, identity verified, OTP'd), but A2P 10DLC NOT registered. The "Brands" and "Campaigns" pages still show "Get started > Register" buttons. Earlier session 6/7 PROJECT_STATE notes that said "registration is in 48-hour review" were wrong; nothing was actually filed.
- **Empirical signal session 8:** Outbound SMS from `+1 647` long code to Mo's `+1 647` mobile delivered reliably across all session 8 testing (4 messages during the live test-paths-askagent run, 2 during step 4 smoke last session). No filtering observed. So whatever the documentation says, real-world delivery is fine for our current volume.
- **Real fix:** open a Twilio support ticket asking specifically about Canadian-long-code-to-Canadian-recipient traffic and what registration (if any) is required for a sole proprietor sending under 100 SMS/day. Get a written answer. Do NOT register on contradictory documentation.
- **Costs if we eventually register:** $4 one-time Brand registration fee + $15 one-time Campaign vetting fee + $2/month Campaign fee. Sole Proprietor tier (Mo's case: no EIN/BN required, personal info works for the registration form).
- **Build trigger:** open the support ticket as a side task in the next 1-2 weeks. Decide based on the written answer. Re-evaluate seriously 4 weeks before first paying agent OR if we see a real deliverability incident in production.

**Business identity registration.**
- **What:** Mo registers as Ontario sole proprietorship via ServiceOntario.
- **Cost:** ~$60 CAD, ~30 minutes online, 2-3 days to process.
- **Why parked:** Not blocking the build right now. Also NOT a prerequisite for Twilio A2P sole proprietor registration (corrected in session 6, initial assumption was wrong).
- **Why still required eventually:** Stripe billing setup (accepting agent payments), business banking, brokerage compliance. None of these are urgent today.
- **Important:** Mo's reflexive "too much to do" is based on imagining incorporation. Sole proprietorship is much smaller. Push back if he dismisses again.
- **Build trigger:** when first paying agent approaches OR when Stripe integration starts. Surface again at that point.

**Anthropic API retry classification.**
- **What:** claude.js currently retries on ALL errors, including 4xx (auth failures, content policy violations, malformed prompts). Should classify by status code: skip retry on 4xx EXCEPT 429 (rate limit, which we should retry).
- **Why parked:** In practice, prompts are stable and API key is valid. Hasn't bitten us yet.
- **Build trigger:** before going live with paying agents OR first time we see a 400/401 in logs.

**Path execution status tracking (column S). [OBSOLETE as of session 7 — preserved for historical context.]**
- **What:** Originally proposed adding a column S to track per-row path execution: `pending`, `complete`, `failed`. Failed paths would get retried by reading column S, not by re-fetching from Gmail.
- **Why obsolete:** Session 7 actually used column S for `operatorEscalated` (the 24hr escalation timestamp). Column T was the next free slot and now holds `leadCategory` (session 10). This parked item's specific column-letter assignment is no longer accurate.
- **If still desired:** the underlying retry-state tracking idea remains valid; it would need a new column (U or beyond). Build trigger remains: first observed double-send incident.

### 7.2 Reply Detection refinements

**Tighten hot_signal categorization prompt.**
- **What:** Add counter-examples to the categorization prompt (e.g., "Vague interest like 'sometime' or 'eventually' is NOT hot_signal; that's answer_general or needs_review").
- **Why parked:** Speculative pre-tuning. Don't tweak a working categorizer without real data.
- **Build trigger:** after first paying agent has a week of real reply data; tune from observed mis-classifications.

**Per-agent confidence thresholds.**
- **What:** Make HOT_SMS_CONFIDENCE_THRESHOLD configurable per agent in agentConfig (some agents may want more/less aggressive SMS).
- **Why parked:** Premature without multi-agent data on what works.
- **Build trigger:** Phase 2 if multiple agents complain about SMS volume.

**Soft-exit confirmation flow (Path 3 sub-fork).**
- **What:** Sub-classify `stop_signal` into hard exits vs soft exits ("paused our search," "timing isn't right"). For soft exits, SMS the agent for confirmation before sending the polite ack.
- **Why parked:** Need real Path 3 data to know if soft-vs-hard is a meaningful distinction at our volume.
- **Build trigger:** after Agent SMS Reply Handler is live and Path 3 has been running for 2-4 weeks.

**[Session 6] Smart urgent-SMS classifier for Path 4 (needs_review).**
- **What:** Replace (or augment) the keyword filter (`lawyer`, `attorney`, `complaint`, `dispute`, `legal action`) with a second Claude call that judges urgency holistically. Would catch cases keywords miss like "I'm thinking about contacting the law society" and reject false positives like "my friend is a lawyer who recommended you."
- **Why parked:** Designing a Claude judgment prompt against speculative needs_review traffic is the wrong order. Need real data first. Also adds a second Claude call per Path 4 run, which is a real failure surface.
- **Build trigger:** first paying agent + 30 days live + 20+ real needs_review examples in column L. Then tune the prompt against actual data. Mo asked about this approach in session 6, instinct was good, just premature.

**[Session 6] Step 4 lead-facing fallback design.**
- **What:** Step 4 (2-hour reminder) currently designed as agent-facing only, nudge the agent if a Path 1B question has been awaiting too long. Should also have a lead-facing fallback that fires after N hours of no agent response. Something like: "Still gathering this info, want me to call you instead?" Would close the loop on Mo's concern about Path 1B sending no holding email, the lead eventually hears something.
- **Why parked:** Step 4 is not built yet. Decide design when actually building Step 4.
- **Build trigger:** when starting Step 4 implementation. Don't ship Step 4 without thinking through the lead-facing side.

**Push notifications for Gmail (instead of polling).**
- **What:** Use Gmail's push notification API to get real-time reply notifications instead of polling fetchUnreadReplies on a schedule.
- **Why parked:** Polling works fine at our scale (a few replies per agent per cycle). Push notifications add complexity (webhook endpoint, retry on missed push, race conditions with cycle-based dedup).
- **Build trigger:** if polling-cost or polling-latency becomes a real issue with multiple paying agents.

### 7.3 Onboarding and operations

**Lead import / migration for new paying agents.**
- **What:** Three migration paths: spreadsheet/CSV (column mapping import script), inbox extraction (AI pass over agent's Gmail), manual entry. Critical: per-lead status assignment (NEVER bulk as `new`), AI Enabled defaults to false on imports, expect more needs_review traffic week one.
- **Why parked:** Over-engineering for zero users. Manual onboarding hour with first 1-3 agents is high-value relationship-building anyway.
- **Build trigger:** after agent #2 or #3 when patterns are clear; build the import script then.
- **Long-term home:** part of Onboarding & Light Management Page.

**Spec the Weekly Content Engine.**
- **What:** Write `CONTENT_ENGINE_SPEC.md` analogous to `REPLY_DETECTION_SPEC.md`. Scope: what content types (blog posts? social posts? newsletters? market graphics?), what inputs the agent provides, what cadence, what review/approval flow, what data sources.
- **Why parked:** No spec yet, just a $300/month line item. Cannot build from a price tag.
- **Build trigger:** before Phase 3 starts (after Phase 2 is done). Dedicated spec session, 1-2 hours of conversation.

**Onboarding & Light Management Page.**
- **What:** Express form for agent intake (name, email, phone, persona settings, Sheet creation, OAuth flow). Status view showing recent activity per agent.
- **Why parked:** Until full Reply Detection + Starter is built and demoable, the page has nothing to onboard agents INTO.
- **Build trigger:** Phase 4 (after Content Engine is done).

**Paying-agent-readiness checklist (NOT in build queue but to surface 2-3 sessions before going live):**
- Google OAuth consent screen pushed from Testing → Production (4-6 weeks of Google verification, can run in parallel with Phase 2-3 build)
- Privacy policy and terms of service URLs (required for OAuth verification)
- Stripe billing setup
- Engagement letter / contract for the agent
- Manual lead import flow (or runbook for Mo)
- Twilio account upgraded from trial to paid

### 7.4 Code quality / nice-to-have

**Generic `encodeHeaderValue()` application to From/To/Cc.**
- **What:** When display-name support is added (e.g. `From: "François Lévesque" <francois@brokerage.com>`), apply the existing `encodeHeaderValue()` helper to those headers too.
- **Why parked:** Today From/To/Cc are always plain email addresses without display names.
- **Build trigger:** when first agent name with non-ASCII characters is onboarded.

**Test counter consistency.**
- **What:** `scripts/test-paths-hotsignal.js` reports `Total assertions: 14` but Section 1 has env-check assertions that aren't in the count. Counter mismatch.
- **Why parked:** Cosmetic. Not affecting test correctness.
- **Build trigger:** next time the test is touched.

**[Session 7] main() double-loads agent config.**
- **What:** `main()` calls `processAgent(id)` (which loads the agent internally) then immediately calls `loadAgent(id)` again to pass to `checkStaleQuestions(agent)`. Two reads of the same JSON file per cycle.
- **Why parked:** Not catastrophic - fast, no race conditions in single-threaded sequential processing. Cleanup means refactoring `processAgent` to take a loaded agent (signature change), then loading once in main().
- **Build trigger:** any time we add a third per-agent call in main(), so we don't go from double-load to triple-load.

**[Session 7] Sheet schema migration tooling.**
- **What:** `setup-sheet.js` only creates fresh sheets. It does NOT migrate existing sheets. Schema changes against live agent sheets require manual edits (rename headers, add columns) per agent.
- **Why parked:** Manual edits are five seconds per sheet at our scale. Today there's just mo-test.
- **Build trigger:** 3+ live agents AND a needed schema change.

**[Session 7] Operator escalation re-auth alert.**
- **What:** When the OAuth refresh-failure auto-flips an agent's `isActive` to false, today the only signal is in the orchestrator console output. In production, the operator (Mo) and/or the agent themselves should get an explicit alert (email or SMS) saying "your Google connection broke, please re-authorize."
- **Why parked:** Today Mo runs the orchestrator manually and sees the error. No external alerting needed.
- **Build trigger:** when Onboarding & Light Management Page is built (Phase 4). The re-auth flow lives there; the alert is the surface that points agents back into it.

**[Session 7] Time helper extraction (`isOlderThan(iso, ms)`).**
- **What:** Three sites in `src/index.js` now do the same `new Date(iso).getTime()` + NaN-guard + compare-against-`Date.now()` pattern: `isWithinRateLimit`, the 2hr branch in `checkStaleQuestions`, the 24hr branch in `checkStaleQuestions`. Extract to a shared utility (probably inline-export from index.js or a new `src/timeUtils.js`).
- **Why parked:** Pure refactor, no behavior change, doesn't block anything. Three sites is the threshold where extraction stops being premature.
- **Build trigger:** any time we add a fourth time-math site, OR clean up as a standalone commit between feature work.

**[Session 7] Path 1A polish items.**
- **What:** Two issues observed during step 3 smoke test: (a) sign-off block duplication - the prompt-generated sign-off has `agentSignature` appended on top, producing redundant identity lines; (b) greeting uses full name from column B verbatim. "Hi Sarah Chen" instead of "Hi Sarah" - wrong for any real name.
- **Why parked:** Cosmetic, not functional. PROJECT_STATE section 5 already says "drafting prompt will need multiple revision passes against real examples. Plan for prompt iteration as a scheduled step."
- **Build trigger:** prompt iteration session, after first paying agent has a week of real reply data.

**[Session 7] Path contract type documentation.**
- **What:** Path functions return `{ok, actions, skipped, errors}` per the locked contract. The shape of `skipped` and `errors` is unspecified. They are arrays. Empty array is truthy in JS, so naive boolean checks (`result.skipped ? ...`) silently break. Caught a real bug in step 3 build prompt.
- **Why parked:** Documentation-only, no code change. Add a comment in `src/paths.js` and update section 4.2 of PROJECT_STATE if not already done.
- **Build trigger:** opportunistic, next time `src/paths.js` is touched.

**[Session 7] verifyDelivery wired into twilio.sendSMS.**
- **What:** Session 5's `verifyDelivery` helper (polls Twilio for terminal carrier status) is exported from twilio.js but it's unclear if `sendSMS` itself calls it on every send. Step 4's reminder SMS reported `errors=0` but that's API success, not delivery success.
- **Why parked:** Probably already wired; needs verification, not new work. Audit during session 8 or whenever twilio.js is touched.
- **Build trigger:** next time we hit a "SMS reported success but Mo didn't get a text" incident, OR during session 8 audit.

**[Session 8] || in lead-question text gets truncated.**
- **What:** `pendingQuestions.parsePendingQuestions` splits cell value on the literal ` || ` separator. If a lead's question contains that exact string in the body (e.g. "den || home office combo"), the second part is silently dropped during the parse. Documented as a known limitation in test case 10 of `test-pending-questions.js`.
- **Why parked:** Real estate leads typing pipes is virtually impossible. Probability close to zero.
- **Build trigger:** first observed real occurrence. Fix would be escape-on-serialize / decode-on-parse for the separator.

**[Session 8] Single Path 1B Q-counter scope.**
- **What:** Token counter in `agents/<agentId>.state.json` is per-agent, never resets. After 10,000 questions per agent we're issuing Q10000+ which still works but starts consuming SMS body characters. At Mo's volume (2-3 paying agents x 10 inbound/day x 365), takes years to get there.
- **Why parked:** Nowhere near a real concern.
- **Build trigger:** if any agent's counter crosses Q5000, decide whether to reset or keep monotonic.

**[Session 8] Webhook agent lookup by phone number.**
- **What:** Today, agents are looked up by `agentId` (the file basename in `agents/`). The webhook will receive an inbound SMS with the agent's phone number in `From`. Need a helper that maps `+16477700344` → `mo-test`. Easiest implementation: scan all agent JSONs at startup, build an in-memory phone-to-id map. Re-build on file change (or just re-build per request at our scale).
- **Why parked:** Belongs IN the webhook build, not before it. Surfacing here so it doesn't get forgotten when the webhook session opens.
- **Build trigger:** webhook build (next session).

**[Session 8] Cross-row token lookup in webhook.**
- **What:** When a token-bearing inbound SMS arrives, the handler needs to find which row's column M contains that token. Today's design: scan all rows for the agent, parse each M cell, find the matching token. O(n) where n is the number of leads. Fine at our scale (< 100 leads per agent), gets expensive at 10k+ leads.
- **Why parked:** Not a real performance concern until many active leads per agent.
- **Build trigger:** any agent with 1000+ rows AND observed slowness.

**[Session 8] Agent SMS Reply Handler stacked-token edge cases.** ✅ **RESOLVED IN SESSION 9.** The webhook detects multi-token replies (regex match count > 1) and sends a clarification SMS back to the agent ("Multiple tokens detected. Please reply to one at a time. Open questions: ..."). Sheet state unchanged. Locked architecture, no longer parked.

**[Session 8] Open Twilio support ticket on Canadian A2P.**
- **What:** Get a written answer on whether sole-proprietor A2P 10DLC registration is required for `+1 647`-to-`+1 647` SMS at low volume.
- **Why parked:** Not blocking. SMS is delivering reliably without registration (verified again in session 9 live ngrok test — real SMS round-trip worked cleanly).
- **Build trigger:** before first paying agent OR if a real deliverability incident occurs.

**[Session 9] Path 1B SMS to agent doesn't surface the property being asked about. ⚠️ HARD GATE BEFORE LIVE MODE.**
- **What:** When Path 1B fires, the SMS to the agent shows the lead's name, email, and question, but NO indication of which property/listing the question is about. Agents with multiple active leads will have to mentally cross-reference or check their inbox to figure out what the lead is asking about. Real demo-killer.
- **Why structured-at-intake (storing a `propertyReference` column populated by Lead Intake) won't work:** Real conversations shift between properties. Lead inquires about 123 Main St → it's sold → agent suggests 456 Elm → lead asks "what's the kitchen like?" referring to 456 Elm. A static `propertyReference` populated at intake would say 123 Main St, which is wrong. Mo flagged this exact failure mode session 9.
- **Fix:** Best-effort Claude extraction at Path 1B fire time. Pass conversation history + originalMessage + current question to a small Haiku call: "What property is this lead currently asking about? Reply with the address/identifier or 'unclear'." Include the result in the SMS template: `[Q47] Sarah Chen (about 456 Elm St): "What's the kitchen like?"`. If extraction fails or returns 'unclear', omit that line — Path 1B's success doesn't depend on it. Wrap the call in try/catch with a clean fallback.
- **Why this is a HARD GATE before any paying agent flips shadow → live:** Mo's verbatim instruction session 9: "make sure we do it before we go live." Reasoning: an SMS that says "Sarah is asking about the kitchen" without specifying WHICH kitchen is actively confusing in production. In shadow mode the agent has visibility into the lead's email thread, so they can manually figure it out. In live mode they're acting on the SMS alone — context is critical. **This joins the prompt iteration session in section 4.2 as a non-negotiable prerequisite before live mode.**
- **Build cost:** ~30 minutes. One new prompt builder in `prompts.js`, one Claude call wired into `pathAskAgent`, SMS template adjusted to optionally include the property line.
- **Build trigger:** Phase 2 alongside Lead Intake (good time to think about property extraction logic generally), OR opportunistically before the prompt iteration session. Cannot defer past live mode.

**[Session 9] Per-agent toggle to disable Path 1B escalation email.**
- **What:** New field on `agentConfig`, e.g. `path1BEscalationEmail: true | false`, default `true`. In `pathAskAgent` step c, check the flag before sending. If `false`, skip the email send and log to column L as `[escalation email skipped per agent preference]` so the audit trail still shows the question came in.
- **Why parked:** Cosmetic preference, not blocking. Mo asked at start of session 9 after seeing the email arrive during the live test. Agent UX feature, not a Phase 1 deliverable.
- **Why default-on:** Existing behavior, zero migration risk. Agents who never knew about the toggle keep getting emails (audit trail). Agents who actively prefer SMS-only flip it off.
- **Build cost:** ~5 minutes. Add field to agentConfig schema validation, wrap email send in `if (agent.path1BEscalationEmail !== false)`, add column L log entry, update `agents/mo-test.json` schema docs.
- **Build trigger:** can ship anytime in Phase 2 cleanup OR as a between-feature opportunistic 5-minute commit.
- **Symmetric question worth answering when we build it:** should this be one toggle for all agent-facing notification emails (Path 4 needs_review escalation, Path 1A fallback escalation), or per-path? Recommend per-path. Different paths have different urgency profiles.

**[Session 9] Operator weekly digest / quality metrics dashboard.**
- **What:** A weekly summary email to Mo (the operator) showing system quality metrics: (a) categorization distribution per agent (% of replies in each of the 6 categories), (b) shadow-mode draft edit rate (how often did the agent rewrite the AI's draft before approving), (c) Path 1B response time (how long did the agent take to text back), (d) lead reply rate to Path 1A drafts (did the lead respond to our auto-reply, or did the conversation stall), (e) volume trends week-over-week. Source: column L is the ground truth, parse it for events.
- **Why parked:** No operational data yet. Worth building once Phase 2 ships and there's actual traffic to summarize.
- **Why this matters:** without metrics, you'll have anecdotal data only. Won't know if categorization accuracy is 95% or 75%. Will guess at whether shadow-to-live conversions happen because the drafts are good or because the agent stopped reviewing.
- **Build trigger:** Phase 2 alongside Daily Digest (same data infrastructure, different output).

**[Session 9] Shadow Mode calibration feedback loop.**
- **What:** When the agent reviews a `[SHADOW DRAFT]` email, they need a way to say "thumbs up" or "thumbs down with reason." Two implementation options:
  - **Option A (early/simple):** agent replies to the draft email with a keyword (`:thumbsup:` or `:thumbsdown: needs to be more direct`). New inbox-watching logic parses these. Simple, no infra needed.
  - **Option B (Phase 4):** clickable links in the email body posting to the hosted Onboarding & Light Management Page.
  - **Option C (Phase 4+):** web dashboard where agent sees recent drafts with thumbs buttons.
- **Why parked:** Path 1B drafting prompt has bigger known issues that aren't fixable without real data anyway (third-person voice, full-name greeting, literal placeholder). The feedback loop is the mechanism by which the prompt iteration session works against real data.
- **Build trigger:** Phase 2 or Phase 3, depending on whether Phase 4's hosted server is ready. Prefer Option A early, migrate to Option C once dashboard exists.
- **Mo's preference (session 9):** thumbs up/down with optional reason on thumbs-down.

**[Session 9] Pre-categorization email filter.**
- **What:** Before sending an inbound reply to Claude for categorization, run cheap heuristic filters: detect auto-replies (Subject contains "Out of office", "Auto-reply", "Vacation"; check X-Auto-Response headers), mailer-daemon bounces, forwarded threads (extract just the latest message), empty bodies / signature-only replies, replies from unrelated parties cc'd on the thread. These get either auto-routed (e.g., auto-reply → log and skip; bounce → mark lead invalid) or pre-stripped (forwarded → extract just latest message before sending to Claude).
- **Why parked:** Today's testing uses hand-crafted lead replies. Real Realtor.ca/Zillow lead replies will include all of the above in the wild.
- **Why this matters:** Without this layer, real production traffic will (a) waste Claude tokens categorizing garbage, (b) misroute real signal (out-of-office matching as `needs_review` forever), (c) potentially corrupt state (auto-reply from a lead's own assistant could keep the lead in `needs_review` indefinitely).
- **Build trigger:** Phase 2 alongside Lead Intake (same email-parsing infrastructure).

**[Session 9] Stop-signal undo window (5-min delay with cancel via SMS).**
- **What:** When the system is about to send a `stop_signal` polite-acknowledgment email to a lead, delay 5 minutes. During the delay, send the agent an SMS: "I'm about to send a stop-signal acknowledgment to <lead>. Reply STOP to cancel." After 5 min, send to lead. If agent replies STOP, cancel.
- **Why parked:** Phase 3 territory. Not blocking initial launch.
- **Why this matters:** Mo's concern: a misclassified stop_signal email is brand-damaging. "We already bought" might mean "we already bought a different property to renovate, but want to keep seeing your investment listings." The polite cold-list email is irreversibly bad in that scenario.
- **Why ONLY stop_signal, not all lead-facing emails (per Mo's session 9 decision):** Sending a confirmation email for every Path 1A draft is too much friction — defeats the "system runs on its own" value prop. Stop_signal is the highest-stakes path because it's irreversible from the lead's perspective.
- **Build trigger:** Phase 3.

**[Session 9] Phone call integration (manual flag).**
- **What:** No automated phone integration. Instead, give the agent a way to MANUALLY flag a lead's status as "phone call happened" so the system pauses follow-ups. Could be: agent texts a special command like `CALLED Q47` or `CALLED <leadEmail>` that updates the lead's status to `manual_handling`.
- **Why parked:** Real phone integration (Twilio call routing, call recording, call metadata feeding into digest) is genuinely Phase 5+ territory. The manual flag is a cheap Phase 2-3 stopgap so agents don't get auto-followups stepping on conversations the system can't see.
- **Stock answer for sales conversations:** "Phone is intentionally out of scope for v1. We focus on email and SMS — the channels with the worst signal-to-action ratio for agents. Phone calls usually mean the lead is already hot enough to take the call." Document this in the demo deck once it exists.
- **Build trigger:** Phase 2-3, alongside Follow-Up Sequences. The pause-followups logic is the natural integration point.

**[Session 9] Data ownership stance + engagement letter.**
- **What:** Decide formal stance on: who owns the lead data (agent), what happens to it on cancellation (deleted within 30 days), export-anytime guarantee, persona JSON ownership (the agent owns their voice profile), OAuth token revocation procedure on cancellation.
- **Why parked:** Doesn't matter until first paying agent.
- **Why this matters:** PIPEDA (Canadian privacy law) requires data-handling commitments in the contract. Sales objection from any sophisticated agent: "what happens to my client list if I cancel?"
- **Build trigger:** Phase 4, when drafting the engagement letter.

**[Session 9] Defense-in-depth for webhook signature bypass.**
- **What:** Add a third condition to the bypass logic: `process.env.NODE_ENV !== 'production'`. So bypass requires env flag AND localhost/ngrok hostname AND non-production env. Railway sets `NODE_ENV=production` automatically, so this gives free production-safety even if the env flag accidentally leaks.
- **Why parked:** The current 2-condition bypass (flag + hostname allowlist) is already strong. The third condition is belt-and-suspenders.
- **Build cost:** 2 lines.
- **Build trigger:** opportunistic, next time webhook.js is touched.

**[Session 9] Confirmation SMS to agent on Path 1B success.**
- **What:** Optionally send a brief confirmation SMS when the polished email goes out. Two flavors to decide between: (a) confirm on every reply (simple, double SMS volume), (b) confirm only when status flips to warm/queue empties (filtered, lower-noise, signals "lead's queue clear"). Lean toward (b) but decide with real usage data.
- **Build cost:** ~5 lines in webhook.js handleAgentReply, after the successful send but before the Sheet update.
- **Build trigger:** after first paying agent has used the system for 1-2 weeks and we have data on whether confirmation friction actually matters in practice.

**[Session 9] Stale Q/S timestamps suppress fresh reminders on re-fired Path 1B.**
- **What:** When a Path 1B question is resolved (queue empties via webhook) and later the same lead gets a new Path 1B fire, column Q (reminderSent) and S (operatorEscalated) may still hold ISO timestamps from the previous cycle. checkStaleQuestions's `!row.reminderSent` check then suppresses the reminder for the new question.
- **Fix:** have pathAskAgent clear Q and S when it writes to a row's M (correct location — start of cycle).
- **Build cost:** ~3 lines in pathAskAgent.
- **Build trigger:** opportunistic, next time pathAskAgent or checkStaleQuestions is touched.

**[Session 9] Path 1B drafting prompt: third-person voice, full-name greeting, literal placeholder embedding.**
- **What:** Three known prompt-quality bugs observed during commit-4 integration test:
  - **Voice:** prompt is ambiguous about whether Claude is writing AS the agent or ABOUT the agent. Output reads "Mo would be happy to arrange..." instead of "Happy to arrange..."
  - **Greeting:** uses full lead name verbatim ("Hi Webhook Test Lead") instead of parsing the first token. Same parked issue as Path 1A from session 7. Fix once in a shared helper, apply to both Path 1A and Path 1B.
  - **Literal embedding:** prompt has no mechanism to detect when agent's SMS answer is incomplete, garbled, or placeholder text. In scenario B the test SMS was `Q5 here is the answer to question one` and Claude wrote "the answer is here is the answer to question one" verbatim into the polished email.
- **Why parked:** All three are prompt-quality issues, not handler bugs. The webhook itself does exactly what it's specified to do.
- **HARD GATE:** This is the dedicated prompt iteration session that gates first-paying-agent's shadow-to-live transition (locked in section 4.2). Cannot ship to a paying agent in live mode without addressing.
- **Build trigger:** dedicated session against multiple realistic agent answers. Earliest reasonable trigger is after Phase 2 ships and Mo's own dogfooding generates real Path 1B fires. Do not fix in isolation against fake test data — that overfits.

**[Session 9] Multi-agent same-brokerage lead deduplication.**
- **What:** When two agents at the same brokerage onboard, a single lead inquiring about multiple listings could be routed to BOTH agents. Each system treats the lead as a fresh row. Both start follow-up sequences. Lead gets 2x the touches, possibly contradictory.
- **Why parked:** Each agent has their own Sheet and their own JSON config — strict tenant isolation. The architectural risk is contained to lead-overlap, not data leakage.
- **Build trigger:** Phase 5+ when Mo is at 5+ paying agents AND two of them are at the same brokerage AND overlap is observed. Fix is probably a brokerage-level dedup layer (shared "claimed lead" table), but the design depends on actual overlap patterns.

**[Session 9] Deploy webhook + orchestrator to Railway BEFORE first paying agent.**
- **What:** Don't onboard a paying agent to a system running on Mo's laptop. Deploy both processes (orchestrator on cron schedule + webhook as long-running server) to Railway during Phase 4.
- **Why parked:** Phase 4 territory.
- **Why this matters:** Once a real agent depends on the system, laptop reliability becomes a customer-impacting variable. Closed lid, sleep mode, bad WiFi — all of these turn into outages.
- **Build trigger:** Phase 4, alongside Onboarding page.

**[Session 9] Stock answer for "what about phone calls?" sales question.**
- **What:** Pre-written answer: "Phone is intentionally out of scope for v1. We focus on email and SMS — the channels with the worst signal-to-action ratio for agents. Phone calls usually mean the lead is already hot enough to take the call." Document in the demo deck once it exists.
- **Why parked:** No demo deck yet.
- **Build trigger:** Phase 4 demo prep.

**[Session 9] Pricing assumptions worth re-testing.**
- **What:** Three assumptions Mo's locked but hasn't actually validated: (a) $500/month is the right Starter price (might be too low — agents at Royal LePage make $80k-300k; $1500/month might be EASIER to sell because higher price implies higher value), (b) Content Engine is a $300 add-on (the spec doesn't exist yet, can't price what's not scoped), (c) Royal LePage Burloak agents are the ICP (they're the beachhead access, not necessarily the ideal customer profile — could be high-volume independents at boutique brokerages, or team leads managing 3-10 junior agents).
- **Why parked:** Doesn't matter until sales conversations start.
- **Build trigger:** before first 5 sales conversations. Test pricing live; ICP-test by interviewing 3-5 prospects across different segments.

### 7.5 Session 10/11 additions

**[Session 11] Audit test code for assertion quality (sessions 10-11 trust accumulating).**
- **What:** Sessions 10 and 11 shipped 18 + 57 + 61 + 44 = 180 test assertions across 4 test files (`test-leadCategory-filter.js`, `test-leadIntake.js`, `test-followUp.js`, `test-webhook-called-resume.js`). Mo and Claude (in chat) approved commits based on CC's self-reported test counts and targeted spot-checks of critical branches (e.g. case-insensitivity for SOI filter, one-fire-per-cycle for follow-ups, CALLED/RESUME state transitions). The full ~889 lines of test code were not visually inspected line-by-line.
- **Why parked:** No bugs observed; the spot-checks landed on the most important branches; CC's self-reporting has been honest and accurate across three commits.
- **Why this matters:** Test counts can be inflated with trivial assertions ("the function returned an object", "no error was thrown") that pass without meaningfully exercising behavior. A future session should do a dedicated audit pass to confirm each assertion tests real behavior, not boilerplate.
- **Build trigger:** before first paying agent goes live, OR if any module behavior surprises us in dogfooding. Combine with the prompt-iteration HARD GATE for efficiency.

**[Session 11] Lead Intake Tier 1 source-specific parsers (Realtor.ca, RLP portal, Zillow, others).**
- **What:** Originally Phase 2 work. Deferred to "ship when a real agent demands it" because Mo doesn't generate Realtor.ca traffic personally and we have nothing to test against. Tier 2 heuristic classifier handles direct emails fine.
- **Why parked:** Without real fixtures from the actual lead source, parsers are speculative and untestable.
- **Build trigger:** first paying agent who receives Realtor.ca / RLP portal / Zillow leads. Use their inbox as the fixture source and build the parser specific to whichever sources they actually use.

**[Session 11] End-to-end orchestrator integration test (Phase 1 leftover, more important now that 5 steps exist).**
- **What:** Automated test exercising the full pipeline (Lead Intake → Sheet validation → categorize → dispatch → mark read → stale check → follow-ups) with realistic fixtures and assertions on full-cycle side effects.
- **Why parked:** All five orchestrator steps are individually tested at the helper level. End-to-end integration is uncovered.
- **Why this matters:** Some bugs only show up at the seams — e.g. Lead Intake writing a row that subsequently fails validation in Step 1, or a follow-up firing on a row that was just marked SOI by manual edit, etc.
- **Build trigger:** as part of the live-verification HARD GATE pass before first paying agent. Live-test session is the right time to also build the integration test.

**[Session 11] Live verification of Lead Intake AND Follow-Up Sequences against Mo's inbox.**
- **What:** First time `runLeadIntake` and `runFollowUps` execute against Mo's real Gmail. Will create the three Gmail labels (`agent-ai/processing`, `agent-ai/intaken`, `agent-ai/noise`), classify up to 20 of Mo's actual unread emails per cycle, write rows to the mo-test Sheet for any classified-as-lead emails. Follow-up engine fires on existing mo-test rows that become eligible.
- **Why parked:** Synthetic-fixtures-only testing in sessions 10-11. Live testing is directional and not fully reversible without manual cleanup; deserves its own focused session.
- **HARD GATE:** No paying agent goes live without this pass first. See Section 4.2.
- **Build trigger:** dedicated session 12 or later, fresh focus.

**[Session 11] Lead Intake stale-`agent-ai/processing` label sweeper.**
- **What:** If Lead Intake crashes after labeling an email `agent-ai/processing` but before classifying or removing the label, that email is permanently blocked from re-processing (pre-filter excludes labeled emails by design). Eventually the agent's inbox could accumulate stale-processing labels.
- **Fix:** periodic sweeper job that finds emails labeled `agent-ai/processing` older than N hours and removes the label so they can be re-classified next cycle.
- **Why parked:** at our scale (1 agent, low volume) this almost certainly never fires. Stale-label cleanup is a Phase 4+ concern.
- **Build trigger:** observed accumulation of `agent-ai/processing` labels older than 24 hours in any agent's inbox.

**[Session 11] Lead Intake observability / digest entry for Tier 2 hits.**
- **What:** When Lead Intake intakes a new lead with `aiEnabled=FALSE`, the agent currently has no surface to learn about it except by opening the Sheet. Daily Digest (next module) needs a "Possible new leads — please review" section listing every row Lead Intake created in the last 24 hours.
- **Why parked:** Daily Digest doesn't exist yet.
- **Build trigger:** Daily Digest spec.

**[Session 11] Follow-up cadence revisit.**
- **What:** v1 ships fixed Day 3/7/14 cadence (configurable per-agent). After 30 days of paying-agent data, revisit whether to extend to 4-6 touches based on observed conversion shape.
- **Why parked:** No data yet. Extending pre-data is speculation.
- **Build trigger:** 30 days of paying-agent runs OR clear pattern in Mo's own dogfooding.

**[Session 11] Sent-folder polling for outbound activity detection.**
- **What:** Today the Follow-Up engine catches manual agent emails via pre-flight thread fetch (compares latest thread message timestamp to `lastFollowUpDate`). This catches manual replies in the existing thread but misses fresh outbound emails the agent sends to a lead in a NEW thread.
- **Fix:** poll the agent's Sent folder for each lead's email address, update `lastFollowUpDate` to the most recent sent-message timestamp matching the lead.
- **Why parked:** Pre-flight thread check covers ~90% of cases. Sent-folder polling is the more thorough version and adds Gmail API calls per cycle.
- **Build trigger:** observed instance of follow-up firing too soon because agent sent a brand-new email to lead.

**[Session 11] Day 14 follow-up subject line is awkward (truncated lead inquiry text).**
- **What:** `subject: 'Re: ' + (row.originalMessage || 'Your inquiry').slice(0, 80)`. Subject for follow-up replies uses the lead's original-inquiry body text, not the original email's subject. So a lead whose first message was "Hi, just wondering about 45 Maple St, can we schedule a showing?" gets a follow-up titled "Re: Hi, just wondering about 45 Maple St, can we schedule a showi" — truncated mid-word, awkward.
- **Fix:** either store and re-use the original email's subject (schema change), or use a generic fallback like "Re: Following up on your inquiry". Generic fallback is the cheaper fix.
- **Why parked:** Gmail threading is controlled by `threadId`, not subject text; this is a UX polish issue not a functional bug.
- **Build trigger:** during prompt-iteration HARD GATE session, OR opportunistic.

**[Session 11] Threading pre-flight check Gmail API cost at scale.**
- **What:** `runFollowUps` fetches the lead's Gmail thread for every follow-up-eligible row every cycle. ~1 Gmail API call per eligible row.
- **Cost analysis:** at 1 paying agent with 50 awaiting_response leads, ~5-20 are eligible per cycle. Negligible. At 50 agents x 50 leads = ~5000 calls/cycle. Approaching Gmail API quota concerns.
- **Fix options:** batch via Gmail's `users.messages.list` with `q=in:thread/<threadId>` (fewer calls, more complex), OR cache thread metadata (latest timestamp) per row in a new column.
- **Why parked:** at v1 scale (1 agent), trivially affordable.
- **Build trigger:** when paying agent count exceeds 10.

**[Session 11] CALLED/RESUME edge cases worth thinking about.**
- **What:** Several edge cases not currently tested or specced:
  - Agent sends `CALLED Q47` then immediately `RESUME Q47` within seconds (race condition).
  - Agent sends `CALLED Q47` for a lead that's already in `manual_handling` status (idempotent, currently re-applies same status with no-op effect).
  - Agent sends `RESUME Q47` for a lead in status `cold` (currently rejected with "not in manual_handling" SMS — but maybe should warm them back up?).
  - Agent sends `CALLED Q47` for a lead whose Path 1B question was already answered and queue is empty (currently looks up by Q-token, finds the row by historical pendingQuestion entry that may have been cleared).
- **Why parked:** Probability low at v1 scale; behavior is non-catastrophic in all cases.
- **Build trigger:** first observed weird interaction in real usage.

**[Session 11] Test counter consistency in test-leadIntake.js.**
- **What:** Section 9 inline test "Max 1 fire" cluster has check assertions but unclear whether the assertion-counter increments correctly. Mirror of the older session 8 issue with test-paths-hotsignal.js's counter-vs-assertion mismatch.
- **Why parked:** Cosmetic if the count is off; tests still verify what they're supposed to verify.
- **Build trigger:** opportunistic, next time the test file is touched.

**[Session 11] Persona drift / voice authenticity onboarding mechanism.**
- **What:** During agent onboarding, give the agent a way to paste 5-10 of their actual sent emails. Run those through Claude to extract voice patterns and auto-populate persona JSON fields (tone, signature style, common phrases).
- **Why parked:** Onboarding page doesn't exist yet (Phase 4). Manual persona setup works for 1-3 agents.
- **Why this matters:** the prompt-iteration HARD GATE is real. Tone-correctness is the main thing that makes or breaks the agent's first impression.
- **Build trigger:** Phase 4 onboarding page build.

**[Session 11] Predictive seller-likelihood / database revival feature (Phase 4+).**
- **What:** Monthly Claude pass over the agent's full lead list scoring re-engagement likelihood. Surface top N "leads worth re-pinging" in the digest. Comparable feature to Revaluate (US tool).
- **Why parked:** Phase 4+ territory; needs a stable Daily Digest first as the surface for outputs.
- **Why this matters:** From session 11 Reddit research (u/USAI_DNS): old leads not contacted in 60 days, contacted 5 times, ~10% convert. That's a meaningful retention/upsell story.
- **Build trigger:** after Daily Digest ships and 1+ paying agent has 30 days of accumulated lead data.

**[Session 11] Voice-note → transcribed-notes-and-tasks feature.**
- **What:** Agent records a 60-90 second voice note after a showing. System transcribes via Whisper, extracts client preferences, generates follow-up tasks, writes summary to the lead's row.
- **Why parked:** Phase 3 or Phase 4 feature. Whisper integration is straightforward but needs UX surface (mobile-friendly upload page, or email-attachment trigger).
- **Why this matters:** From session 11 Reddit research (u/LuxuryPresence_Aaron) — agents repeatedly cite voice-note → tasks as a high-value time-saver. ~2 days of build effort once the UX shape is decided.
- **Build trigger:** Phase 3 spec session, OR after first paying agent specifically asks.

**[Session 11] Saved-search / property-favorited event triggers (Phase 4+).**
- **What:** Move follow-ups from time-triggered to event-triggered for high-value signals. When a lead favorites a property or creates a saved search on the agent's IDX site, fire a contextual outreach immediately.
- **Why parked:** Requires IDX/website integration we don't have.
- **Why this matters:** From session 11 Reddit research (u/USAI_DNS): saved-search outreach converts at ~35%. The single most actionable data point in the entire Reddit thread.
- **Build trigger:** Phase 4+ when an agent's website or IDX feed becomes available as a data source.

**[Session 11] Internal Q&A bot for brokerage knowledge (Phase 5+ brokerage-tier upsell).**
- **What:** AI hooked up to a brokerage's Confluence/Drive docs so individual agents can ask "what's the Royal LePage policy on X" or "where's the listing agreement template" without bothering the broker. Different category from individual-agent Starter; this is a brokerage-level product.
- **Why parked:** Not the wedge. Sells to brokerages, not agents directly.
- **Why this matters:** If we ever sell into Royal LePage at the brokerage level (not individual agent level), this becomes part of the bundle. Differentiation from individual-agent competitors.
- **Build trigger:** first inbound conversation with a brokerage decision-maker (not an individual agent).

**[Session 11] Inbound lead SMS handling (Phase 5+).**
- **What:** Currently the system reads inbound EMAILS but not inbound SMS to the agent's Twilio number. A lead who texts the agent "is 45 Maple still available?" gets no automated response. Future: parse inbound SMS through similar pipeline (Tier 2 heuristic classifier or per-lead routing), with the same SOI guard.
- **Why parked:** Out of scope for Phase 1-2. Phone call integration is also out of scope (parked separately).
- **Build trigger:** Phase 5+ if real agents demand it.

**[Session 11] Future-proof leadCategory beyond just SOI.**
- **What:** Column T currently accepts only `'soi'` or empty. Future expansion may include `'cold_internet'`, `'active_client'`, `'past_client'` for richer agent-side organization and per-category behavior rules.
- **Why parked:** YAGNI for v1. Empty + `'soi'` is sufficient.
- **Build trigger:** when an agent specifically asks for richer lead categorization, or when a feature genuinely needs the distinction.

**[Session 11] Daily Digest design includes operator weekly digest.**
- **What:** Daily Digest module (next planned) needs to include not just the per-agent daily morning brief but also a weekly summary email to Mo (the operator) covering: leads handled, response time, conversion of warm-to-tour, places where Shadow Mode caught a draft Mo would have otherwise sent. The Shadow Mode catches are the number that justifies $500/month long-term.
- **Why parked:** part of Daily Digest spec, not a separate module.
- **Build trigger:** during Daily Digest build.


---

## 8. How Mo wants Claude to work

These are working-style preferences that have emerged across sessions. Future Claude instances should adopt these immediately on session start.

### 8.1 Senior engineer mindset
Real code review every time, not rubber-stamping. Think system-level, not file-level. Will this code still make sense after 6 months and 10 features? Flag duplication even when it would be faster to copy-paste. Push back when something is convenient now but expensive later, with the trade-off explained.

If Claude is doing this well, Mo will occasionally hear "I know you didn't ask, but I want to flag something about the broader architecture before we proceed." If he never hears that, Claude is not doing the job.

### 8.2 Plain language (Mo's verbatim instruction, end of session 6)
"Explain in plain language. Mo is leveling up as a builder but isn't a backend specialist. When using technical terms (e.g. 'module,' 'dispatcher,' 'idempotent,' 'race condition'), define them on first use in a session. Senior-engineer thinking stays; the vocabulary should match the audience. If a concept needs more than a sentence to explain, it gets a small explanation block, not a wall of jargon."

### 8.3 Verify reality, not API success
Tests must confirm the actual side effect (SMS delivered, email arrived, Sheet cell changed) before claiming green. The Twilio API returning a `sid` is not delivery proof. (Session 5 lesson: original Path 2 test passed all 14 assertions while the SMS was failing silently. Mo's gut catch saved us from shipping a silent-failure bug.)

### 8.4 Honest pushback, no flattery
Mo doesn't want comfort, he wants correctness. If he proposes something wrong, say so, explain why, and offer the better path. (Session 5 examples: Mo's Path 3 design pushback was right and Claude walked back the original recommendation; Mo's "too much work" dismissal of business registration was wrong and Claude pushed back with real numbers.)

### 8.5 One file at a time during code review
When Mo pastes source files for review, read each carefully and respond before he sends the next. Don't batch-process. The 5-minute pause to actually understand the contracts saves debug round-trips later.

### 8.6 Commit cadence
One logical change per commit. Each commit must be testable in isolation. Each commit must be revertable cleanly without taking other work with it. Multi-file changes are fine when the changes are logically one concern (e.g. Path 2 + verifyDelivery patch + test went together because the path implementation forced the discovery of the verifyDelivery need).

### 8.7 Em-dash discipline (absolute)
Run `grep -n "[em-dash-or-en-dash]"` (the literal regex character class containing both U+2014 and U+2013) on every file before considering an edit done. Zero exceptions in code, comments, prompt strings, test files, or docs. The rule is dumb and absolute on purpose; that's what makes it reliable. Exception (session 6 documented): `src/prompts.js` has 3 intentional em-dash matches inside the prompts that BAN em-dashes (around lines 265, 366, 457). Those are correct: the literal character is the subject of the rule. Don't "fix" them.

### 8.8 After Claude Code edits
Always run a syntax check, a redacting load test (for files with secrets), and the relevant test before claiming work is done. Specifically:
- `node --check <file>` to verify it parses
- `node -e "<redacted load test>"` to verify it requires correctly
- `node scripts/test-<thing>.js` to actually exercise it
- `git status` before staging to confirm only expected files are touched

### 8.9 Fatigue management
Sessions are 2-3 hours. Around the 90-minute mark, ask Mo how he's feeling. If he's tired or making mistakes, suggest stopping. End-of-session checklist runs better when both parties are sharp.

### 8.10 End-of-session deliverable
Update PROJECT_STATE.md by EDITING it surgically, not rewriting from scratch. Read the existing version in context, preserve everything still accurate, change only what changed. (Mo set this rule end of session 6: "i want to have to wait 10-15 mins everytime i need one. plus it eats up usage." Regenerating from scratch wastes Mo's time and burns usage.)

Include all session-6-or-later decisions, parked items, and corrections. Make it easy for the next session to read three things: (1) where the build is, (2) what Mo wants done next, (3) what's already been settled and shouldn't be re-litigated. The doc lives in Project knowledge so every new chat can read it.

### 8.11 Session opener convention (Mo set end of session 6)
When Mo says "let's continue" or similar, open the response with the three-section checklist (Done / Working on now / Left), real checkbox glyphs, grouped by phase, no surrounding process narration. See section 0 for the template. Get to work after.

### 8.12 Running notes commitment (Mo reinforced session 7)
Mo's verbatim mid-session reminder: "just remember to add things. I don't want to have to remind you." When Claude says "I'll add this to running notes" during a session, that's a commitment, not a maybe. Track items as they come up; don't rely on end-of-session memory pass to catch them all. The notes flow into PROJECT_STATE updates surgically without requiring Mo to surface them again.

### 8.13 Claude Code opportunistic improvements (session 7 working pattern)
CC sometimes proposes changes beyond the prompt scope. Sometimes these are valuable (catches latent bugs like ALLOWED_STATUSES in session 7), sometimes they introduce drift (column-S naming as a timestamp instead of escalation flag in session 7). Rule: anything CC suggests beyond the prompt scope gets reviewed at the same level as if Claude (in chat) had suggested it. Auto-accepting because CC mentioned it defeats layered review. Auto-rejecting because it wasn't asked for misses real fixes. Read the diff, ask "is this what we wanted?", decide explicitly.

### 8.14 Verification before commit (session 7 reinforcement)
"Ready to commit" from CC is a signal to start review, not finish it. Always demand the actual `git diff` before committing. Syntax checks (`node --check`) and grep verifications confirm absence of forbidden things; they do NOT confirm presence of correct things. Read the diff, eyeball the new code paths, confirm signatures match existing convention, then commit.

### 8.15 Pressure-test architectural recommendations against the data shape (session 8)
Before recommending a storage location, schema change, or interface, cross-check against the existing data model. Session 8 caught a bad recommendation (column T in Sheet for the token counter) by walking through "where does a single integer live in a row-based schema." The user's "fewer columns" instinct was the early warning sign. Lesson: when the user pushes back with concrete reasoning rooted in the data shape, take it seriously even if the original technical case seems strong. Pivot fast when it's wrong; document the pivot reason so future sessions don't re-make the same recommendation.

### 8.16 Diff-style output is the cleanest paste (session 8)
Mo's pastes worked best when CC's output was diff-format (e.g. from the `Update` tool). Diff lines preserved enough context to verify the change without requiring a separate `cat` of the full file. Worked less well: `sed`/`cat` output that exceeded ~50 lines, which CC's terminal collapsed under "+N lines (ctrl+o to expand)" and didn't make it into Mo's paste. Workarounds: (a) Mo hits ctrl+o on the terminal before copying, (b) CC writes to `/tmp/<file>` and then `cat`s it for fresh display, (c) Mo uses `tee` to write to disk then cats the file outside CC. Recognize the truncation pattern; if a "test passed" claim arrives without the actual assertion lines, ask for the file dump.

### 8.17 Honest mid-session pivots earn trust (session 8)
When Claude (in chat) makes a recommendation that's wrong, the right response is to say so plainly and pivot. Session 8 had two of these: column T → JSON state file (mid-design), and "A2P 10DLC will fix Canadian SMS" → "I changed my mind after re-reading docs." Mo's response to the pivots was positive ("i am happy that you caught it"), confirming that honest reversals are higher-trust than digging in. The cost of a pivot is small (re-explain, re-decide). The cost of NOT pivoting is shipping the wrong thing.

### 8.18 Translate jargon when Mo asks even basic questions (session 9)
Session 9 had several moments where Mo's question signaled that a piece of explanation went past him. Examples: "what do both questions mean" (port number, server lifecycle), "does it mean the texts will say sum about twilio" (signature verification), "are we sure there was a Q1?" (when the webhook log clearly said `token=Q1` but Mo wasn't reading log output as confidently as Claude). **Pattern:** when Mo asks for clarification, don't repeat the technical answer — translate. Section 8.2 already covers this for jargon-on-first-use, but session 9 reinforced that **Mo's clarifying questions are signal, not noise.** Treat each one as a reason to step back and explain the underlying concept in plain language, then return to the technical answer. A 5-minute translation saves a 30-minute confusion later.

### 8.19 Push back on stop-here suggestions only when there's real signal (session 9)
Twice in session 9 Claude (in chat) proposed stopping the session early: (a) before commit 4, suggesting we wrap because of fatigue, (b) when ngrok signup was briefly blocked, suggesting we defer commit 5. Mo overrode both — kept going with commits 4 and 5, which together completed Phase 1. **Rule:** suggesting a stop is fine as a check-in; Claude shouldn't be pushy about it. If Mo says "let's keep going," respect it. Mo is the one feeling his own energy. The fatigue-management default (section 8.9) is a soft warning, not a hard stop.

### 8.20 Live tests reveal bugs that integration tests miss (session 9)
The 22-assertion integration test passed. The live ngrok test failed (dotenv bug). Both were necessary. **Lesson:** for any new component that crosses the network boundary into a third-party system (webhook, scheduled job, external API consumer), plan for BOTH a logic-level integration test AND a one-time live verification. Integration tests catch logic bugs. Live tests catch environment/wiring bugs. Don't trust either alone. (This is also locked as a section 4.4 coding rule, but it's a working-style habit too.)

### 8.21 PROJECT_STATE updates as a downloadable file (session 9)
Mo asked for the session 9 update to be written as an editable file with surgical edits, then handed back to him as a downloadable artifact for upload to Project knowledge. This is the cleanest workflow: Claude edits the working copy with `str_replace`, packages it as a file, Mo downloads and uploads. Avoids long chat scrollback for next session's reader. **Pattern for future sessions:** unless Mo asks otherwise, deliver PROJECT_STATE updates as files, not inline.

### 8.22 LLM Council framework, used selectively (session 11)
For decisions that are irreversible, strategic, or multi-faceted, Claude runs a 5-advisor analysis: **Contrarian** (identifies failure modes and risks), **First Principles Thinker** (rebuilds from base assumptions), **Expansionist** (seeks maximum upside), **Outsider** (applies perspectives from unrelated fields), **Executor** (focuses on actionable three-step execution). Followed by peer review (each advisor challenges the others) and Chairman synthesis (a single recommendation).

**Auto-fire conditions** (Claude triggers council without being asked):
- Decision is irreversible or hard-to-reverse (e.g. customer-facing pricing, schema changes that touch live data, anything legal or PIPEDA-related)
- Multiple credible answers exist with real tradeoffs (e.g. "which Phase 3 module first," "should we offer the Content Engine as a discount or upcharge")
- Mo is explicitly asking a strategic / product / positioning question
- A parked item is being un-parked and decided
- Claude is about to recommend something that could shape the next 6+ months
- Mo asks "what should I do" or "what do you think" on something that isn't pure execution

**Stay in normal mode for:** execution requests (paste this prompt, run this command), factual questions (what's an SOI, what does column S do), choices between right answer and wrong answer (just give the right answer), mid-CC-review work, late-session fatigue.

**Mo's overrides:** "Council this" (run council even when Claude wouldn't auto-fire), "skip the council, just answer" (drop council mode even when auto-fire conditions are met), "skip the council, what do YOU think" (Chairman-only summary without advisor breakdown).

Locked session 11 after Mo proposed running it on every reply. Pushback was: full council on every reply 5x's response length and breaks collaboration on simple/execution questions. Selective application is the right calibration.

### 8.23 `--no-pager` for diff and test output requests (session 10/11)
Claude Code's terminal UI collapses long output with `+N lines (ctrl+o to expand)` placeholders. When the collapsed output is pasted into chat, Claude cannot review it. Standing protocol: **every diff and test-output request includes `git --no-pager diff <file> | cat` or `<command> 2>&1 | cat`**. The pipe through `cat` defeats both the pager AND the UI collapse.

For new files (which `git diff` doesn't show until staged), use `cat <path>` directly. If output is still collapsed, ask CC to paste raw file contents inline.

This is non-negotiable for commit approval. Approval cannot happen on truncated output.

### 8.24 Test code audit pending across sessions 10-11 (session 11)
Sessions 10 and 11 shipped 180 test assertions across 4 files (~889 lines of test code). Mo and Claude approved commits based on CC's self-reported test counts and spot-checks of the most important branches (case-insensitivity for SOI filter, one-fire-per-cycle for follow-ups, CALLED/RESUME state transitions, idempotency-via-label for Lead Intake). Full file-by-file inspection of all 180 assertions did NOT happen.

This is acceptable v1 quality risk because:
- CC's self-reporting has been honest across three commits.
- Spot-checks landed on the right branches.
- No bugs observed in any commit.

But it is provisional trust. A dedicated audit session before first paying agent goes live should confirm each assertion exercises real behavior, not boilerplate. See parked item 7.5 "Audit test code for assertion quality."


---

## 9. Environment and credentials

### 9.1 What's where

- **Mo's working directory:** `~/Documents/agent-ai`
- **Source code:** `src/`
- **Test scripts:** `scripts/`
- **Agent configs:** `agents/<agentId>.json` (gitignored)
- **`.env`:** project root (gitignored)
- **`client_secret_*.json`:** project root (gitignored)
- **Project knowledge in this Claude Project:** `PROJECT_STATE.md` (this file), `REPLY_DETECTION_SPEC.md`

### 9.2 Test agent

- **agentId:** `mo-test`
- **mode:** `shadow` (so Path 3 and Path 1A testing exercises Shadow Mode by default)
- **gmailAddress:** `mohanadmohamed416@gmail.com`
- **agentPhone:** `+16477700344` (Mo's verified number in Twilio trial)
- **escalationEmail:** Mo's gmailAddress
- **googleSheetId:** `1P6fdE9OcI9jt8qqvzmLTQp1_gEQzMSKhHWtAaXlATz0`
- **persona additions:** 4 "AI cannot invent" entries (mortgage approval odds, legal advice, specific interest rates, market predictions). Two of those overlap semantically with the baseline list; dedupe is exact-match (case-insensitive), so they stay as listed. Real-world test of dedupe.

### 9.3 Test rows in mo-test Sheet (rows 2-7)

Preserved across sessions for testing. Row 7 added in session 9 specifically for webhook testing.

- **Row 2:** `wpsmohanadmohamed@gmail.com` (Valid Lead). Used by Path 1B initiation tests (test-paths-askagent.js).
- **Rows 3-6:** Test fixtures for various categories from earlier sessions. Row 4 has `bad.status@example.com` with deliberate `foobar` status. Row 5 is `paused@example.com` with `manual_handling`. Row 6 is `recent.action@example.com` with `in_conversation`. Untouched in session 9.
- **Row 7 (NEW session 9):** `webhook-test@example.com`, "Webhook Test Lead", phone `14165551007`, source `Test`, originalMessage `Looking at properties in the Annex, hoping to learn more about the area`, aiEnabled=TRUE. **State at end of session 9:** after the live ngrok test, M7 cleared, G7=`warm`, P7=ISO timestamp from the live test, L7 has the test's "Path 1B reply sent for Q1" entry. **For session 10 start:** clear column G (status), column M (pendingQuestion), and column P (lastActionTimestamp) before re-running test-webhook.js. Column L can stay as audit trail. Webhook test is the canonical user of this row.

### 9.4 Twilio state

- **Account:** Paid (verified session 8 — onboarding checklist showed "Upgrade ✨" checked).
- **TWILIO_FROM_NUMBER:** `+16476925913` (Canadian `+1 647` long code, NOT registered for A2P 10DLC).
- **Verified caller IDs:** Mo's phone (`+16477700344`).
- **A2P 10DLC registration: NOT FILED.** Earlier session 6/7 PROJECT_STATE notes saying "in 48-hour review" were wrong. The A2P question is parked pending a real Twilio support ticket answer (see section 7.1).
- **Empirical deliverability through session 9:** Multiple SMS rounds in sessions 7, 8, 9 (including a real inbound SMS in the live ngrok test) all delivered cleanly. No filtering observed.
- **Twilio Phone Number webhook configuration:** Set during session 9 to point at the ngrok tunnel URL. Will need to be updated every time ngrok restarts (free-tier ngrok URLs change per session). For Phase 4 deploy, the webhook URL points at Railway's public URL and stays stable.
- **What the deliverability tells us:** at low volume to a Canadian-area-code recipient on Canadian Twilio number, messages get through even unregistered. Inbound delivery (SMS to your Twilio number) also works without registration.

### 9.5 Anthropic API

- **Model in use for categorization:** Haiku (cheap, fast, structured-output good)
- **Model in use for drafting:** Sonnet (higher quality for lead-facing prose)
- **API key:** in `.env` as `ANTHROPIC_API_KEY`

### 9.6 Google OAuth

- **Project status:** Testing mode (will need Google verification before going live with paying agents, 4-6 weeks)
- **Refresh token:** stored in agent JSON as `googleRefreshToken`. NEVER print this to terminal or chat. Always use redactor.
- **Client ID + Client Secret:** in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. **Critical:** every entrypoint that calls Google APIs must `require('dotenv').config()` at top to load these. Session 9 found `src/webhook.js` was missing this — a 1-line fix (commit `70ca8bf`) but the bug was invisible until production ngrok testing.

### 9.7 Git config issue

Auto-generated config (`mohanadmohamed@Mohanads-MacBook-Pro.local`) keeps nagging. Non-blocking. One-time fix Mo will do whenever:
```bash
git config --global user.name "Mohanad Mohamed"
git config --global user.email "<his real email>"
```

### 9.8 Agent state files (session 8)

- **`agents/<agentId>.state.json`:** per-agent state file holding agent-level metadata. Currently one field: `lastTokenIssued` (monotonic integer). Atomic-write protected (tmp-then-rename). Gitignored.
- **mo-test state:** session 9 live tests created and used `agents/mo-test.state.json`. Token counter is at some value > 0. The exact value doesn't matter — it'll keep incrementing. If you ever need to manually inspect it, `cat agents/mo-test.state.json`.

### 9.9 ngrok setup (session 9 NEW)

- **ngrok version:** 3.39.1, installed at `/usr/local/bin/ngrok`.
- **Architecture detail:** Mo's MacBook is INTEL (`x86_64`), not Apple Silicon — confirmed in session 9 via `uname -m`. The hostname `Mohanads-MacBook-Pro` is misleading. Use the **amd64** ngrok binary, not arm64. Download URL is `https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-darwin-amd64.zip`.
- **Authtoken:** saved in `~/Library/Application Support/ngrok/ngrok.yml`. One-time setup, persists across reboots.
- **Free tier limitation:** the ngrok URL changes every time `ngrok http 3000` is restarted. For local dev, just update the Twilio webhook URL whenever ngrok restarts (10 seconds in Twilio Console). For production, Phase 4 will deploy to Railway with a stable URL.
- **Webhook URL pattern:** `https://<random-words>.ngrok-free.dev/sms-incoming` — note `.ngrok-free.dev`, not the older `.ngrok-free.app`.

### 9.10 sarah-ahmed.json (legacy)

`agents/sarah-ahmed.json` exists in the agents directory (created April 24, 2026, before the active build). Mo isn't sure of its origin — possibly an early test agent. Not currently used by any code path. Can be ignored or deleted whenever.

---

## 10. Where to pick up next session

When Mo says "let's continue" or "what's next" at the start of session 12, open with the three-section checklist (per the convention in section 0), then proceed.

### 10.1 Suggested session 12 opener (drop in as the first response)

```
✅ Done last sessions (10-11)
- SOI protection layer: column T leadCategory, validation gate filter, manual-only flag (0e900be, session 10)
- Lead Intake Tier 2 heuristic classifier with 3-class branching, label-based idempotency, claude.callRaw architectural addition (15920ff, session 11)
- Follow-Up Sequences Day 3/7/14 with contextual generation, per-agent cadence, pre-flight thread check, cold flip on final touch (8fa8bda, session 11)
- CALLED/RESUME SMS commands for manual lead handling (part of 8fa8bda)
- LLM Council framework locked as Section 8.22 (selective auto-fire, not on every reply)
- PROJECT_STATE update for sessions 10 + 11

🔄 Working on now
- Live verification of Lead Intake AND Follow-Up Sequences against Mo's inbox (HARD GATE, before any paying agent depends on either)
  OR
- Daily Digest module (next planned, src/digest.js)

📋 Left in Phase 2 (rest of Starter)
- [ ] Live verification of Lead Intake against Mo's Gmail (HARD GATE)
- [ ] Live verification of Follow-Up Sequences against Mo's inbox (HARD GATE)
- [ ] Daily Digest module (per-agent daily morning brief + operator weekly digest)
- [ ] End-to-end orchestrator integration test (Phase 1 leftover, more important now with 5 steps)

📋 Left after Phase 2
- [ ] Phase 2.5: Web form for direct lead capture (added session 10, deferred from session 11)
- [ ] Phase 3: Content Engine spec + build (must include "no generic broadcast SMS" anti-pattern)
- [ ] Phase 4: Onboarding & Light Management Page + Railway deploy + demo
- [ ] HARD GATE: Prompt iteration session against real Path 1B data
- [ ] HARD GATE: Path 1B SMS must include property reference (Claude extraction at fire time)
- [ ] First paying agent
```

### 10.2 Live verification work (recommended next session focus)

Both Lead Intake and Follow-Up Sequences are tested with synthetic fixtures only. Live verification is the HARD GATE before any paying agent. Plan for ~1 hour focused session covering:

**Lead Intake live test:**
1. Run `node src/index.js` (or Lead Intake-only entry script) against mo-test.
2. First run will create three Gmail labels (`agent-ai/processing`, `agent-ai/intaken`, `agent-ai/noise`). Verify they appear in Gmail UI.
3. Process up to 20 of Mo's actual unread emails. Walk through every classification.
4. Validate: did obvious leads (if any) get classified as `lead`? Did newsletters get `noise`? Did real business correspondence stay untouched?
5. For any misclassification, document the email's distinguishing features for future prompt-tuning.
6. Confirm any classified-as-lead emails got a Sheet row with `aiEnabled=FALSE` and the right column-L log entry.

**Follow-Up Sequences live test:**
1. Pick an existing mo-test row (or create one) with `status=awaiting_response`, `aiEnabled=TRUE`, `followUpCount=0`, `lastFollowUpDate` set to 4 days ago.
2. Run orchestrator. Day 3 follow-up should fire.
3. In shadow mode (default): Mo's inbox receives the `[SHADOW DRAFT]` email. Read the draft critically — is the tone right? Does it reference the original inquiry? Any banned phrases?
4. If the draft is acceptable, manually advance the test row: set followUpCount=1, lastFollowUpDate to 8 days ago. Run again. Day 7 fires.
5. Repeat for Day 14. Confirm cold flip happens and the prompt does NOT signal closure.

**Both tests:**
- Keep notes on every prompt-quality observation. These feed the prompt-iteration HARD GATE session.
- Don't try to fix prompts in the live-test session. Note them, ship the test, fix in a dedicated prompt-iteration session.

### 10.3 Things to settle before Daily Digest build

Daily Digest is the natural next module if Mo wants to keep building rather than dogfood. Design questions to lock:

1. **What's in the daily morning brief?** Recommend: overnight intake count, leads needing review (Lead Intake hits with aiEnabled=FALSE), hot leads to call today (status=HOT), follow-ups due today, recent Path 4 escalations. Order by urgency.
2. **Time of day to send?** Default: 7am agent-local time. Per-agent configurable later.
3. **Format?** Email, not SMS. SMS is for urgent interrupts, not summaries. Markdown-rendered HTML for inbox readability.
4. **Operator weekly digest?** Mo gets a Sunday-night summary across all agents. Include: leads handled, response time, conversion of warm-to-tour, Shadow Mode catches.
5. **Empty digest behavior?** If nothing happened, send nothing (don't create noise). Log to console only.
6. **Content Engine integration?** No. Daily Digest is operational; Content Engine is marketing. Different products, different cadences.

### 10.4 What NOT to do session 12

- Don't tune Lead Intake or Follow-Up prompts against fake test data. The HARD GATE waits for live runs against real emails first.
- Don't run live Lead Intake without setting aside ~1 hour to walk through every classification. First-run side effects (Gmail labels created, Sheet rows written) are not easily reversible.
- Don't reset the token counter (`agents/mo-test.state.json`).
- Don't change SOI handling, Lead Intake architecture, or Follow-Up engine without strong reason. All three are working as designed.
- Don't skip the live verification "just to ship Daily Digest faster." The HARD GATE is locked.
- Don't paste raw email content with lead PII into chat or commit messages.

### 10.5 Things Mo may surface again

- A2P 10DLC support ticket. Still parked.
- Business registration via ServiceOntario. Becomes relevant when Stripe billing or banking comes up.
- OAuth re-auth — Testing-mode 7-day inactivity revocation. If session 12 opens after 7+ days of inactivity, expect to re-auth: `node scripts/authorize.js mo-test`. Last verified working: 2026-05-08.
- The web form (Phase 2.5). Mo's instinct in session 10 was to pull it forward; we deferred to after Daily Digest. May resurface.
- Pricing assumptions ($500/$800 tiers). Will surface when actual sales conversations approach. Lock-in not before.
- Phase 2.5 web form trigger to pull-forward decision: if Mo or a prospect specifically asks for it, revisit timing.

### 10.6 Test row state in mo-test Sheet at end of session 11

- **Row 2-6:** Untouched in sessions 10-11.
- **Row 7:** Webhook test fixture from session 9. State unchanged session 10-11. If running webhook tests again, clear column G/M/P first.
- **Cell T1:** `Lead Category` header added manually session 10. All existing rows have empty column T (default action-eligible).
- **No rows touched by Lead Intake or Follow-Up Sequences yet.** Both modules are mocked-tested only; no live runs against the Sheet.

### 10.7 Agent state file at end of session 11

- `agents/mo-test.state.json` exists with `lastTokenIssued > 0` from session 9's tests. Token counter keeps incrementing. Don't reset.
- No other state file fields added in sessions 10 or 11.

### 10.8 Twilio webhook URL configuration

- The Twilio Phone Number's webhook URL was set during session 9 to point at an ngrok tunnel that's no longer active.
- For Phase 2 work (Daily Digest, live verification of Lead Intake / Follow-Up), the webhook does NOT need to be running. Lead Intake and Follow-Up don't depend on it.
- If a future session re-runs the webhook for CALLED/RESUME testing or Path 1B, restart the tunnel and update the Twilio URL:
  1. Start ngrok: `ngrok http 3000`
  2. Copy the new URL
  3. Update Twilio Console → Phone Numbers → Active Numbers → click the number → "A MESSAGE COMES IN" → URL field → paste `https://<new-ngrok-subdomain>.ngrok-free.dev/sms-incoming`

---

## 11. Competitive landscape (snapshot from session 11 research)

This section locks the competitive context so future sessions don't re-research from scratch. Snapshot date: 2026-05-08.

### 11.1 Direct competitors (closest to agent-ai's wedge)

**Structurely** — voice-first AI ISA. Native Follow Up Boss and kvCORE integrations. Their AI "Aisa Holmes" sends an immediate text to every new lead, qualifies timeline and budget over SMS, books appointments. Starts at $179/month for 50 leads. **Where agent-ai beats them:** new-lead-only focus; no inbox triage of existing client relationships, no daily digest, no follow-up sequencing across the relationship lifecycle. Reply Detection module is doing something they explicitly don't.

**Lofty (formerly Chime)** — full-stack CRM + IDX + AI assistant "Alex." Their "Lofty AI Copilot" reads emails, adds tasks and appointments to calendar, sends follow-up communications. Closest analog to agent-ai's long-term vision. **Where agent-ai beats them:** Lofty is $300-$1000/month all-in-one, requires migrating off existing tools. agent-ai sits on top of Gmail; zero workflow change.

**Follow Up Boss with Ace AI** — CRM-native AI follow-up. Agent must be on FUB. Different distribution dynamic.

**alfred_ (get-alfred.ai)** — horizontal AI executive assistant. Triages inboxes overnight, drafts replies with calendar context, extracts tasks, daily brief. $24.99/month. **The closest tool to Reply Detection's core value prop, but horizontal — not real-estate-specific.** Doesn't know about Realtor.ca lead formats, no property-specific reply categories, no SMS-to-agent escalation, no Shadow Mode. Worth watching closely; if they pivot vertical, they become a real competitor.

### 11.2 Adjacent tools (different category, worth knowing exist)

- **Ylopo** — lead-gen-focused, paid-ads heavy. Different category.
- **CINC** — lead gen + nurture, partnered with Structurely. Team-focused.
- **Offrs** — predictive seller-likelihood scoring from public records. US-only.
- **Revaluate** — predictive move-likelihood scoring on existing CRM contacts. US-only.

### 11.3 Tools mentioned in session 11 Reddit research (informational)

Direct competitive threat = none. Adjacent / informational only:

- **Fello** — lead enrichment + database intelligence. Multiple agents recommended.
- **Homesage.ai** — property analytics and computer-vision-from-photos. $200/month+ credit-based. US-only (all 50 states, no Canada). **Could be a future API integration partner, not a competitor** — their data could feed agent-ai if a future Canadian-equivalent emerges.
- **WorkBeaver** — horizontal "AI digital intern" that learns desktop tasks by demonstration. $21.95/month. Generic browser/desktop automation, not real-estate-specific. Worth knowing it exists; agents who mention it usually use it for manual MLS data entry workarounds.
- **AgentVoice** — AI inbound call handling. Voice category, not the wedge.
- **Reimatch** — analytics/comps tool.
- **Marabot** — auto-posts listings to multiple social platforms. Adjacent to Content Engine.
- **PicAid** — turns realtor cellphone pics into professional photos. Adjacent.
- **Maggi Homes** — AI photo editing + photo-to-video.
- **Cirql** — database hygiene + auto-text/email writer. Closer to agent-ai's category; worth a brief look later.
- **PromptHatch** — prompt library for agents. Different category.
- **prolisting.ai** — German market, listing photo + exposé writing. Not relevant.
- **11x** — AI cold calling. Voice, not the wedge.
- **Trexia/Drexia (TX/CA)** — solo dev building state-specific real estate AI. Direct conceptual peer worth watching.
- **Centra AI** — claims to never miss inbound calls from Zillow/Realtor.com. Voice.
- **PREA / eesel AI** — internal Q&A bot for brokerage Confluence/Drive docs. Brokerage-tier opportunity (parked).

### 11.4 Canadian-market context (the moat)

The single most important fact in this section: **most US-recommended AI real estate tools simply do not work in Canada.** The session 11 Reddit thread had zero Canadian-native tools mentioned across 47 comments. Toronto-area Royal LePage agents who want AI today have effectively no Canadian-native option for the inbox-triage problem. agent-ai is early in this market, and the data-source moats (no Zillow API in Canada, no MLS direct without per-broker integration, telecom costs make voice automation cost-prohibitive) are genuinely hard barriers that will persist.

### 11.5 The pitch in one sentence (echo from Section 1.5)

"Speed-to-lead in Shadow Mode, then on autopilot." Anchor stat: 21x qualification likelihood for sub-5-minute lead responses (vs 30+ minutes). agent-ai is the only Canadian-native tool that delivers it.

### 11.6 Empirical data points worth remembering

From session 11 Reddit research, primarily u/USAI_DNS (4 years real estate marketing automation, 200K+ AI calls analyzed):

- Average human agent: 917 minutes (~15 hours) to respond to a new lead.
- Sub-5-minute response: 21x qualification likelihood vs 30+ minutes.
- Saved-search / property-favorited triggered outreach: ~35% conversion. **Highest-value signal in the research.**
- Old-leads-not-touched-60-days, called 5 times: ~10% conversion.
- AI-to-human live transfer under 2 minutes: 70% lift in appointment-set rate.
- Property-match SMS to leads who don't answer phone: ~20% reply rate.
- Generic broadcast SMS ("did you know the market is moving?"): turns numbers into spam, damages deliverability long-term. **Banned in agent-ai by policy.**
- Auto-messaging SOI (Sphere of Influence) contacts: brand-damaging, "you will literally make them hate you." **Banned in agent-ai by hard rule.**

### 11.7 Positioning sentence for sales conversations

"Structurely for the inbox you already have. Lofty without the migration. alfred_ that actually speaks real estate. And the only one of the three that works in Canada."

