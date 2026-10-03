# LEAD_IMPORT_SPEC.md - agent-ai

**Status:** LOCKED DESIGN, not built. Design locked in chat session 41 (2026-07-04). Implementation not started.

**For:** future Claude chats inside this Project. This is the authoritative design for how a newly onboarded agent gets the leads they already have onto their per-agent Sheet. PROJECT_STATE.md parked item 7.27.2 points here. If this doc and PROJECT_STATE ever conflict, the more recently dated one wins; otherwise this doc is authoritative for the import feature specifically.

---

## 0. The problem in one sentence

A new agent arrives with an existing book of leads (in a CRM, a spreadsheet, or their Gmail), and we need to get those leads onto their per-agent Sheet as easily as possible, WITHOUT the system acting on them before the agent has deliberately opted each one in.

## 1. The core constraint: safe landing beats easy ingestion

"Easy" has two halves that pull against each other. Half one is frictionless ingestion (get the leads out of wherever they live and onto the Sheet). Half two is safe landing (the system must not start firing follow-ups and AI replies on those leads the moment they hit the Sheet). Optimizing only the first half is a footgun.

An agent's existing book is relationships already in flight. If we import 200 old leads as `aiEnabled=TRUE, status=new`, the follow-up engine and reply detection treat them as fresh and start acting. That is the same brand-damage failure mode the SOI guard exists to prevent, at scale: auto-firing a re-engagement or an AI-polished reply into a relationship that already closed, or to the agent's friend's mom.

**Therefore: everything imported lands inert.** `aiEnabled=FALSE`, `source` = `import`, on a review status. Reply detection, the HOT categorizer, and the follow-up engine all skip `aiEnabled`-false rows (existing behavior). Imported leads are a static, AI-assessed record until the agent opts each one in. This mirrors the existing confidence-tiered intake default (low-confidence leads land FALSE for manual review) and the SOI hard guard. It is the system's safe-by-default philosophy applied to import.

## 2. Ingestion: CSV or pasted blob, Claude-normalized

Every CRM (Follow Up Boss, KvCore, Lofty, the Realtor.ca portal) exports CSV, and agents also keep messy personal spreadsheets. Rather than force agents onto a rigid template, accept arbitrary CSV or a pasted list and run it through Haiku to map their columns onto the schema (name, email, phone, source) and normalize formatting.

This is the single biggest "easy" lever: the agent does zero column-mapping work. The normalization layer also absorbs the messiness (inconsistent headers, combined name fields, phone formatting) that would otherwise be manual cleanup.

## 3. Email is the required key

Column A (`leadId`, the email) is the unique Map key for the entire `leadIndex` and the dedup system. A row with no email breaks dedup and sender-matching.

Many older leads are phone-only. For the MVP, **phone-only rows are skipped and reported back** for manual handling, rather than given a synthesized placeholder key. A synthesized key quietly pollutes the unique-key invariant and creates rows the reply system can never match on. Skip-and-report keeps the invariant honest and tells the agent exactly which leads need another path.

Open question that shifts this: how phone-heavy is a typical target agent's book. If it is phone-first, this decision needs revisiting (a follow-up-only record type, separate from the matchable-lead type, may be warranted). For now: skip and report.

## 4. Dedup by email, reusing existing logic

Import routes through the existing dedup, which keys on column A and preserves SOI status across re-engagements. Re-importing, or importing leads that overlap with already-intaken inbox leads, does not create duplicates. No new dedup logic.

## 5. Gmail-history enrichment

This is where the AI earns its keep and where the "know the history" problem gets solved.

### 5.1 The scan (no new scope)

For each imported lead, run a Gmail search scoped to that address (`from:lead@x.com OR to:lead@x.com`), date-bounded to roughly five years (`after:2020/07/01`, real estate is a long process). This uses the `gmail.modify` scope the agent already granted, which includes read access to the whole mailbox, not just recent mail. **No scope expansion, no change to the OAuth ask.** It is the same activity the product already does on fresh inbound, run backward over history. This matters given where the Google review sits: this feature adds zero new consent surface.

### 5.2 Distillation, not dumping

Do not put the raw transcript on the Sheet. Run each lead's history through Haiku and produce:

- A **distilled summary** ("inquired about 2BR Yorkville condos in March, viewed three, went quiet after an offer fell through in May"). Seeds column L as a single import entry, following the existing pattern where L carries activity context. No schema change.
- An **evidence-backed inferred status**. Seeds column G. The summary must QUOTE its evidence ("last email 2021, agent's message went unanswered") rather than just asserting a status, so the agent can overrule a bad guess in one glance.
- A **last-contact date**. Seeds column E.
- A **proposed SOI / closed flag**. If the history shows a completed transaction or a clearly personal relationship, propose `leadCategory=soi` on the way in. This is the highest-value thing the scan buys: it auto-sorts the agent's dead and personal contacts into the permanently-safe bucket instead of making the agent hand-sort hundreds of rows.

### 5.3 Tiered summarization by thread size

Five years means some leads (especially clients who became repeat clients) have many emails across multiple threads. You cannot stuff five years into one Haiku call and get a clean summary. Pattern:

- Fetch the thread list for the lead.
- If total messages are under a threshold, summarize in one pass.
- If over the threshold, summarize per-thread first, then summarize the summaries into the column L entry.

This keeps each call inside a sane context budget and the final summary coherent. Cost is bounded by how much history exists, which for a long-tail book is mostly a handful of emails per lead with a few heavy outliers.

**The threshold is the one number the implementation hangs on. Lock it before writing code.**

### 5.4 Reuse the live-intake pre-filter

Over five years the search will catch noise: newsletter subscriptions the lead's address triggered, forwarded chains, cc's on unrelated group threads. The pre-filter that already guards live intake (skip calendar domains, notification senders, bulk senders) must run on the scanned history too, BEFORE anything goes to Haiku. Otherwise we pay to summarize junk and occasionally get a summary poisoned by an unrelated thread. Reuse the existing filter, do not write a new one.

### 5.5 Report misses loudly

Matching is imperfect. The CSV email will not always match the address the lead actually corresponded from, and portal leads (Realtor.ca, Zillow) sometimes live only in the portal and never hit the agent's Gmail. When a scan finds nothing, the row lands with an explicit "no history found in Gmail" note, never a silent empty. The agent needs to know which leads got enriched and which did not.

### 5.6 Email-only is an honest limitation

Phone and SMS history is invisible to the Gmail scan. When contact happened over text or calls, the scan reconstructs only part of the picture, and the summary should say so rather than implying the email history is the whole relationship.

## 6. Opt-in and bulk-enable

The opt-in is the load-bearing action. Enrichment gives the agent a fully populated, AI-assessed Sheet to review; the opt-in is the agent saying "yes, this one is real, watch it for me."

For a large book, flipping leads on one at a time is friction that undoes the "easy" we are going for. So **bulk-enable belongs in the same design as import, not bolted on later**: select the leads the agent recognizes as live and activate them in one action, leaving the rest inert or SOI.

Behavioral contract, stated precisely:

- The AI updates the Sheet AT IMPORT (status / SOI / summary snapshot from the history).
- The AI does NOT keep updating imported-inert leads on its own. `aiEnabled=FALSE` gates reply detection, the HOT categorizer, and the follow-up engine.
- Once a lead is enabled, the AI updates it LIVE and normally from then on (HOT on a buying signal, cold on a stop signal, all standard path behavior).

So: enrichment populates, the agent opts in, the AI then watches the live ones. The inert default is what stands between the agent and an old lead who bought elsewhere sending a friendly "hope you're well" and getting auto-flipped to HOT with an SMS and an AI reply into a dead relationship.

## 7. Where it runs: operator CLI MVP, reusable-function discipline

### 7.1 MVP is operator CLI

There is no agent-facing dashboard today (see section 8). For the first paying agent the entire loop is operator-run white-glove, matching the Content Engine provisioning pattern:

- `scripts/import-leads.js <agentId> <file>` -- Claude-normalize the CSV, dedup by email via existing logic, append inert rows, report what landed and what was skipped (phone-only, dupes).
- `scripts/enrich-leads.js <agentId>` -- run the Gmail scan over the imported rows, tiered-summarize, write G / E / L, propose SOI, report matches and misses.

Keep the two decoupled: import lands the rows, enrichment enriches them. The scan is then re-runnable and optional, and a matching failure in the scan never blocks the import.

The agent hands over the CSV, the operator runs both, and the operator and agent go through the assessed Sheet together (or the agent says which are live and the operator bulk-enables). White-glove is the right amount of hands-on for a first customer.

### 7.2 Reusable-function discipline (critical)

Put the real work in reusable `src/` functions and make the CLI scripts thin wrappers:

- CSV normalization
- the Gmail scan
- the tiered summarization
- dedup
- row append
- bulk-enable

When the agent dashboard eventually arrives (section 8), its "import my leads" button and its "enable these leads" action call the EXACT SAME functions the scripts do. Nothing gets rewritten; the dashboard becomes a second caller. This is the `module.exports.fn` testability precedent from session 39 (dashboard internals exported for hermetic tests), applied deliberately from the start. It costs nothing extra now and is the difference between the agent dashboard reusing this feature versus reimplementing it.

## 8. Dependency: agent-facing dashboard is a separate epic

Today `app.getklosed.ca/dashboard` is the OPERATOR dashboard: one `DASHBOARD_PASSWORD` gates a view listing every agent, and only the operator logs in. There is no per-agent login and no agent-scoped view. Every "the agent flips the lead on from the dashboard" in this design is currently the operator doing it on the agent's behalf.

Mo confirmed (session 41) he wants agents to have their own dashboard eventually. That is a strategic epic, not an extension of the operator dashboard, because multi-tenant breaks everything the operator dashboard assumes: it needs per-agent identity, scoping (an agent sees only their own leads and config, a hard security boundary), session isolation, and a login/account model that does not exist today. Natural front door is "Sign in with Google" using the account the agent already OAuth'd. It sits behind the OAuth-verification gate and wants Stripe billing first. Sequence: after OAuth clears, after the first paying agent, alongside or after billing. See PROJECT_STATE parked 7.27.3.

This import feature does not depend on that epic shipping. It produces a good Sheet either way. The only requirement is section 7.2: build the logic as reusable functions so the epic can plug into it later.

## 9. Recon items to confirm before locking implementation

1. Does the system provision the agent's Sheet itself (the `drive.file` scope allows it), or does the operator seed the Sheet manually today? This decides where import rows get written.
2. Should `appendSheetRow` batch for bulk writes, or is looping the existing single-row append fine at these volumes?
3. The exact thread-size threshold for single-pass vs tiered summarization (section 5.3).

## 10. Open product questions (not blocking the MVP)

- How phone-heavy is a typical target agent's book (shifts section 3).
- Is the model white-glove-forever (agents never self-serve, "easy" means easy for the operator) or do agents eventually self-serve (the section 8 epic is real)? Mo leans toward agents having a dashboard, which is why section 7.2's reusable-function discipline is non-negotiable.

## 11. Summary of locked decisions

1. Everything imported lands inert (`aiEnabled=FALSE`, `source=import`, review status). Safe landing beats easy ingestion.
2. Ingestion is CSV or pasted blob, Claude-normalized onto the schema.
3. Email is the required key; phone-only rows are skipped and reported for the MVP.
4. Dedup by email, reusing existing logic.
5. Gmail-history enrichment within the existing `gmail.modify` scope: distilled column L summary + evidence-backed status (G) + last-contact date (E) + proposed SOI flag, tiered by thread size, pre-filtered against the live-intake noise filter, misses reported loudly, email-only limitation stated honestly.
6. Bulk-enable is part of this design, not bolted on later.
7. AI populates at import and updates live only after a lead is enabled; it never updates imported-inert leads on its own.
8. MVP is operator CLI (`import-leads.js`, `enrich-leads.js`); the real logic lives in reusable `src/` functions so the future agent dashboard reuses it.
9. Agent-facing dashboard is a separate post-billing epic (PROJECT_STATE 7.27.3); this feature does not block on it.
