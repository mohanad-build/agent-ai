# Reply Detection — Technical Specification

**Status:** Source of truth. This replaces the earlier spec doc dated before the OAuth2 pivot and the agent-config additions (kill switch, shadow mode, AI-enabled override, confidence field).

**Validated on:** Make.com prototype (categorization + Path 1A drafting). Being ported to Node.js, not redesigned.

---

## 1. System Purpose

When a real estate lead replies to an email from the agent's inbox, the system:

1. Detects the reply (Gmail polling)
2. Categorizes its intent using Claude (1 of 5 categories)
3. Routes it to the correct action path
4. Either responds automatically, alerts the agent via SMS, or escalates for human review

The agent never has to monitor their inbox manually. The system handles routine replies and only interrupts the agent when human input is genuinely needed.

---

## 2. Trigger and Inputs

**Trigger:** Polled email check, every 15 minutes, on each active agent's connected Gmail.

**Future upgrade path:** Gmail Push Notifications via Google Pub/Sub. Eliminates polling latency (sub-second instead of up to 15 min). Worth implementing once we have 5+ agents or a hot lead is missed because of polling delay. Don't invest in making polling faster (5 min, 2 min) — that's wasted work when the right fix is Push.

**Filter criteria for relevant replies:**

- Email is FROM the lead, NOT from the agent or system
- Sender's email matches a Lead ID (column A) in the agent's Google Sheet
- Lead's `AI Enabled` flag (column O) is `true`
- Agent's `isActive` flag in their config is `true`

Note: we deliberately do NOT require the email to be in an existing thread. If a lead ghosts and re-emails weeks later with a new subject, we still catch it via sender match.

**Inputs needed for processing:**

- Email content — use Gmail **Snippet** field, NOT Full text body. Avoids JSON control-character errors from email line breaks.
- Lead's name (column B)
- Lead's original inquiry (column F)
- Lead's current status (column G)
- Gmail Thread ID (column N) — for threading the reply correctly when sending

---

## 3. Per-Lead Rate Limit

**Rule:** Maximum one AI-initiated action per lead per 60 minutes.

**Why:** prevents spam if a lead sends 4 replies in 10 minutes. Without this, Path 1A would send 4 auto-replies and Path 1B would ping the agent 4 times.

**Implementation:** column P "Last Action Timestamp." Before any path executes, check if `now() - column P < 60 min`. If yes, queue the reply for the next poll cycle OR merge into `needs_review` if it's been more than one cycle.

---

## 4. Categorization (Claude Call #1)

Send the reply to Claude with a system prompt that returns raw JSON:

```json
{
  "category": "<one of 5>",
  "confidence": 0.0,
  "reasoning": "<brief explanation>"
}
```

**Confidence rule:** if `confidence < 0.7`, auto-downgrade to `needs_review` regardless of category. Calibration knob without re-prompting.

**The 5 categories:**

### 4.1 `answer_general`

Lead asked a general real estate education question.

Examples: "How long does buying take?", "What's pre-approval?", "How does the offer process work?", "What are closing costs?"

Action: AI can answer directly, no agent involvement (subject to Shadow Mode — see §10).

### 4.2 `answer_property_specific`

Lead asked about a specific listing OR something requiring real-time data.

Examples: "How many bedrooms?", "What's the square footage?", "What's the asking price?", "What's the market like in Yorkville right now?", "Are there bidding wars?"

Action: AI cannot answer safely. Escalate to agent via SMS round-trip (Path 1B).

### 4.3 `hot_signal`

Lead expressed action intent.

Examples: "Can we book a showing?", "I want to make an offer", "Let's schedule a call", "Are you free this weekend?"

Action: Urgent SMS to agent, mark lead HOT, pause follow-ups.

### 4.4 `stop_signal`

Lead declined or wants out.

Examples: "Not interested", "Already bought", "Please stop contacting me", "We went with another agent"

Action: Send polite acknowledgment, mark lead cold, pause all sequences.

### 4.5 `needs_review`

Anything ambiguous, emotional, or complex.

Examples: emotional context, multiple unrelated questions, complaints, legal/financial issues.

Action: Email full context to agent for manual handling.

**Categorization safety rule (in system prompt):**

When uncertain between `answer_general` and `answer_property_specific`, ALWAYS prefer `answer_property_specific`. Better to ping the agent than have AI guess at facts it doesn't have.

**Logging:** the full Claude response (category, confidence, reasoning) is appended to column L (Conversation History). When the system miscategorizes, we need the reasoning to debug the prompt.

---

## 5. Path 1A — `answer_general` (Fully Automated)

### Steps

1. Send a SECOND Claude call to draft the reply, using the agent's persona from `agentConfig`.
2. Strip em-dashes and en-dashes with `replace()` before sending. Belt and suspenders — banned in prompt AND post-processed.
3. Normalize the subject line: strip leading `Re:`, `RE:`, `Fwd:` before prepending `Re:`. Prevents `Re: Re: Re:` chains.
4. Send the email via Gmail API:
   - To: lead's email
   - Subject: `Re: <normalized subject>`
   - Body: the cleaned draft
   - Thread ID: existing thread (so it appears as continuation)
5. Update Google Sheet:
   - Status (column G): `in_conversation`
   - Conversation History (column L): timestamp + "AI replied to general question" + Claude's reasoning from §4
   - Last Action Timestamp (column P): now
6. If agent is in Shadow Mode (§10), email the draft to the agent instead of sending to lead.

### Drafting prompt requirements

- Use agent's name and brokerage from `agentConfig`
- 90–140 words, 2–3 paragraphs, conversational
- Start with "Hi `<FirstName>`,"
- Answer the question directly
- Include ONE piece of insider perspective (mechanism, leverage point, common mistake, or timing insight)
- Close with a personalized next step (call, strategy session, timeline mapping) — not "let me know"
- Sign off as "`<agentName>`, `<brokerage>`"

**Banned phrases:** "thanks for reaching out", "great question", "I hope this helps", "here's what separates successful buyers", "the real question is", "most people don't realize"

**Safety rules:**

- Never cite specific interest rates, mortgage rates, average prices, current market conditions, or statistics
- Never predict market direction
- Never invent inventory or competition data

**Expected iteration:** this drafting prompt will need multiple revision passes against real examples. Plan for prompt iteration as a scheduled step, not an afterthought.

---

## 6. Path 1B — `answer_property_specific` (SMS Round-Trip)

This is the "holy shit" demo moment — the sequence that makes agents pay $1,500/mo.

### Step 1 — Capture the lead's question

Update Google Sheet:
- Status (column G): `awaiting_agent_info`
- Pending Question (column M): the lead's question
- Conversation History (column L): timestamp + "Property question received: <snippet>"
- Last Action Timestamp (column P): now

### Step 2 — Agent gets an SMS via Twilio

```
<LeadName> just asked: "<their question, max 120 chars>"
Reply to this text with the answer and we'll send a polished email back.
```

Sent to: `agentPhone` from agent config.

The lead does NOT get any reply yet. We wait for the agent.

### Step 3 — Agent replies via SMS

This step runs in a SEPARATE module — **Agent SMS Reply Handler** — listening for inbound Twilio webhooks. When the agent texts something like "3BR plus a den, 1,850 sqft, $1.2M asking", the webhook fires and triggers Step 4.

### Step 4 — Claude composes a polished email

Claude receives:
- The lead's original question (from column M)
- The agent's short SMS answer
- The agent's persona (`agentConfig`)

Claude drafts a warm, professional email that:
- Addresses the lead by name
- Uses the agent's information accurately — no hallucination, no embellishment beyond what the agent texted
- Maintains the agent's voice and tone
- Closes with a soft next step
- Strips em-dashes

Email is sent via Gmail to the lead, in the existing thread.

**Critical drafting rules:**

- AI MUST NOT add facts beyond what the agent texted
- If agent texts "3BR", AI says "3 bedrooms" — does not invent "spacious 3BR with primary suite"
- If agent's answer is incomplete, AI can soft-pivot ("Sarah confirmed it's 3 bedrooms — happy to get more details on the layout if helpful")
- Same banned phrases as Path 1A
- Same em-dash strip
- Same agent voice

### Step 5 — Sheet updates

- Status (column G): `in_conversation`
- Pending Question (column M): cleared
- Conversation History (column L): "Agent provided info via SMS, polished email sent"
- Last Action Timestamp (column P): now

### Performance target

The whole loop should complete in under 5 minutes from agent SMS reply to lead receiving email. Agent never opens their laptop. Lead gets a professional response that sounds like the agent wrote it.

---

## 7. Path 2 — `hot_signal`

### Steps

1. Send urgent SMS to agent immediately:
   ```
   🔥 HOT LEAD: <LeadName> just said: "<snippet, max 100 chars>"
   Reply to <leadEmail> ASAP.
   ```
2. Send urgent email alert to agent (cc/bcc to brokerage if configured)
3. Update Google Sheet:
   - Status (column G): `HOT`
   - Conversation History (column L): timestamp + "HOT signal: <snippet>"
   - Last Action Timestamp (column P): now
4. Pause any active follow-up sequences for this lead — do not auto-nurture someone ready to act

No automated response to the lead. Agent handles personally. Speed matters.

---

## 8. Path 3 — `stop_signal`

### Steps

1. Send a brief polite acknowledgment to the lead (one-liner, AI-drafted):
   ```
   No problem, <FirstName>. I'll take you off the list. Wishing you the best with your search.
   <agentName>, <brokerage>
   ```
2. Update Google Sheet:
   - Status (column G): `cold`
   - Conversation History (column L): timestamp + "Lead requested to stop"
   - Last Action Timestamp (column P): now
3. Pause/cancel all follow-up sequences for this lead permanently
4. No SMS to agent (not urgent — visible in daily digest)

---

## 9. Path 4 — `needs_review`

### Steps

1. Email the agent with full context:
   - Lead name, email, phone
   - Original inquiry
   - The current reply that triggered review
   - Claude's reasoning for flagging it
2. Update Google Sheet:
   - Status (column G): `needs_review`
   - Conversation History (column L): timestamp + "Flagged for review: <snippet>"
   - Last Action Timestamp (column P): now
3. No automated response to the lead — agent handles directly
4. Optional SMS to agent if reply contains high-urgency keywords (lawyer, complaint, dispute, urgent)

---

## 10. Shadow Mode (Onboarding Safety)

**Purpose:** during a new agent's first week, the system categorizes and drafts but does NOT send to leads. Drafts go to the agent's email for review. After a week of "yeah, that's what I would've said," the agent (or Mo) flips to live.

**Why:** prevents a prompt bug from torching the agent's first 10 real lead interactions. This is a critical trust-building feature for sales — eliminates the highest-risk window.

**Implementation:** `mode` field on agent config, values: `shadow` or `live`.

**Behavior in Shadow Mode:**

- Path 1A: drafts the reply, emails it to `agentEmail` instead of sending to lead. Sheet updated normally.
- Path 1B: still SMSes the agent the lead's question. Agent's SMS reply is drafted as an email and sent to the agent for review, NOT to the lead.
- Path 2 (hot_signal): operates normally — these are agent-direct actions anyway, no lead-facing AI message.
- Path 3 (stop_signal): drafts the polite acknowledgment, emails it to agent for review, does NOT send to lead. Sheet still marks cold.
- Path 4 (needs_review): operates normally — already agent-direct.

**Default:** `shadow` for the first 7 days after onboarding, then prompt the agent to flip to `live`.

---

## 11. Manual Override (AI Enabled Per Lead)

**Purpose:** if the agent takes over a conversation manually, they need a "hands off" button so the system stops auto-replying to that lead.

**Implementation:** column O "AI Enabled" (boolean, default `true`). Before any path executes, check column O. If `false`, skip the lead entirely (still log the reply to column L for audit, but take no action).

**Why critical:** agents will not tolerate a system that keeps auto-replying after they've engaged personally. This is a trust must-have.

---

## 12. Kill Switch (Per Agent)

**Implementation:** `isActive` field on agent config (boolean).

**Behavior:** if `false`, the poller skips that agent entirely. No emails read, no actions taken.

**Use cases:** agent on vacation, family emergency, brokerage requested pause, maintenance on their data, account suspended for non-payment.

---

## 13. Google Sheet Column Reference

| Col | Field                  | Notes                                                                              |
|-----|------------------------|------------------------------------------------------------------------------------|
| A   | Lead ID                | Lead's email address, unique key                                                    |
| B   | Name                   |                                                                                    |
| C   | Phone                  |                                                                                    |
| D   | Source                 |                                                                                    |
| E   | Date added             |                                                                                    |
| F   | Original Message       |                                                                                    |
| G   | Status                 | `new` / `in_conversation` / `awaiting_agent_info` / `HOT` / `cold` / `needs_review` |
| H   | Follow Up Count        |                                                                                    |
| I   | Next Follow Up Day     |                                                                                    |
| J   | Last Follow Up Date    |                                                                                    |
| K   | (reserved)             |                                                                                    |
| L   | Conversation History   | Append-only log, includes Claude's categorization reasoning                         |
| M   | Pending Question       | Used by Path 1B during SMS round-trip                                              |
| N   | Gmail Thread ID        |                                                                                    |
| O   | AI Enabled             | Boolean, default true. False = system skips this lead                              |
| P   | Last Action Timestamp  | Used for per-lead rate limit (60 min cooldown)                                     |

---

## 14. Environment Variables

```
ANTHROPIC_API_KEY              # Claude API key
GOOGLE_CLIENT_ID               # OAuth app client ID (shared across all agents)
GOOGLE_CLIENT_SECRET           # OAuth app client secret (shared across all agents)
GOOGLE_SHEET_ID                # Default sheet ID (or per-agent in config — see below)
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_FROM_NUMBER             # Twilio number that sends SMS
AGENT_ID                       # Which agent config to load at runtime
POLL_INTERVAL_MINUTES          # Default 15
```

**NOT in `.env`:**
- Per-agent Gmail address — lives in `agents/<id>.json` as `gmailAddress`
- Per-agent Gmail OAuth refresh token — lives in `agents/<id>.json` as `googleRefreshToken`
- Per-agent phone number — lives in `agents/<id>.json` as `agentPhone`
- Per-agent Sheet ID (if agents have their own sheets) — `googleSheetId` in agent config overrides the default

This is the OAuth2 architecture, not service account. Service account would have used `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` and `GMAIL_USER` in `.env` — that's the OLD design before the personal-Gmail pivot. Do not reintroduce.

---

## 15. Agent Config Schema (`agents/<id>.json`)

```json
{
  "agentId": "string",
  "agentName": "string",
  "firstName": "string",
  "brokerage": "string",
  "brokerageLocation": "string",
  "gmailAddress": "string",
  "agentPhone": "string (E.164)",
  "agentSignature": "string",
  "tone": "string",
  "emailLength": "string",
  "usesEmojis": "boolean",
  "avoidPhrases": ["array of banned phrases for this agent"],
  "targetMarket": "string",
  "specialties": ["array"],
  "yearsExperience": "number",
  "neverDiscuss": ["array of topics to refuse"],
  "escalationEmail": "string",
  "googleRefreshToken": "string (OAuth refresh token, populated by scripts/authorize.js)",
  "isActive": "boolean (default true)",
  "mode": "string: 'shadow' or 'live' (default 'shadow' for first 7 days)",
  "googleSheetId": "string (optional, overrides default GOOGLE_SHEET_ID)"
}
```

---

## 16. Relationship to Other Modules

Reply Detection depends on:
- **Lead Intake** — adds leads to the Sheet so we can match senders
- **Follow-Up Sequence** — sends initial outreach so leads have something to reply to

It feeds into:
- **Agent SMS Reply Handler** — listens for agent's SMS responses to Path 1B questions, completes the round-trip with a polished email. Webhook-triggered, runs as a separate module from this polling-triggered one.
- **Hot Lead SMS** — may share Twilio infrastructure
- **Daily Digest** — pulls all activity logged in column L

---

## 17. Implementation Order

When porting from Make.com to Node, build in this order. Test each layer in isolation before moving on.

1. `agentConfig.js` — load and validate agent config (DONE — needs sanity test)
2. `prompts.js` — categorization prompt + drafting prompts, with template variables
3. `claude.js` — Anthropic SDK wrapper, em-dash strip, JSON response parsing
4. `google.js` — Gmail read/send, Sheets read/write, OAuth refresh token usage
5. `twilio.js` — SMS send
6. `index.js` — orchestrator: poll → categorize → route → act
7. End-to-end test with one fake lead in `mo-test`

Shadow Mode, kill switch, AI Enabled, rate limit, confidence field, subject normalization — all baked into the relevant modules from day 1, NOT bolted on later.

---

## 18. Anti-Patterns to Avoid

- **Don't second-guess the 5-category scheme.** Validated on Make.com. Changes to categorization invalidate the prototype.
- **Don't second-guess the SMS round-trip.** It's the differentiated product moment. Removing it for "simplicity" kills the sales pitch.
- **Don't paste all logic files and pray.** Layered testing — build, test, ship, next.
- **Don't pass Gmail full body to Claude.** Use Snippet. Newlines in JSON break things.
- **Don't trust the model to skip em-dashes.** Strip them post-generation.
- **Don't reintroduce service account auth.** OAuth2 with per-agent refresh tokens is the design.
