# OUTBOUND_TRACKING_SPEC.md - agent-ai

**Status:** LOCKED DESIGN, recon-confirmed (session 47). Not built. Implementation is session 48's priority thread.

**For:** the session-48 build. This is the authoritative design. Design was locked in chat and the code paths were confirmed by a read-only recon pass in session 47, quoted below where it matters. If this doc and PROJECT_STATE conflict, PROJECT_STATE 7.33.3 is the short pointer and this is the full version.

---

## 0. The problem in one sentence

The system is deaf to outbound: it reacts only to inbound replies and timers, so when the agent (in shadow mode) or the live AI sends a reply to a lead, nothing updates that lead's follow-up state, which leaves a re-engaged lead unable to re-arm its sequence and risks a double-touch when the timer later fires its own nudge on top of a message the agent already sent.

## 1. What exists today (recon-confirmed session 47)

Reading `src/index.js`, `src/followUp.js`, `src/gmail.js`, and `src/paths.js`:

- **The pre-flight threading check already half-solves the double-touch,** at `followUp.js:88-120`, inline per-row inside `runFollowUps`. It reads `row.gmailThreadId` (column N), calls `email.getThreadHistory`, finds the latest message by timestamp, and if the thread has activity newer than the last recorded touch it re-anchors `lastFollowUpDate` (column J) to that activity and SKIPS the nudge (`continue`), incrementing a weekly pre-flight-skip counter. Critically it does NOT reset column H (followUpCount) and does NOT write column L. So it stops the wrong nudge but never re-arms the sequence. It is a skip, not an update.

- **The send helpers already return the sent message id.** `sendReply` and `sendNewEmail` in `gmail.js` both `return res.data` from `gmail.users.messages.send`, whose body is `{ id, threadId, labelIds }`. `email.js` passes this straight through. The ONLY place the value is dropped is the call sites: `followUp.js:166-179` (the live nudge) and `paths.js:565-580` / `paths.js:409-424` (Path 1A and Path 3 live replies) each `await` the send with no assignment. Capturing the id is a one-line change at the call site, no signature change to gmail.js.

- **`applyMessageLabels` (`gmail.js:724-737`) works on sent messages.** It calls `gmail.users.messages.modify`, which operates on any message id visible in the agent's mailbox; sent messages carry the SENT label and are fully valid targets. `leadIntake.js` already relies on the same modify tolerance for inbound. Note: `applyMessageLabels` (and `listLabels`/`createLabel`) is NOT re-exported through `email.js`; `digest.js` reaches around by importing `./gmail` directly, and the tracking code does the same.

- **Live-AI replies and human replies are indistinguishable in Sent.** Once `agent.mode !== 'shadow'`, a Path 1A / Path 3 reply goes out via `email.sendReply` with a normal subject and body, identical to the agent typing and hitting send in Gmail. The only marked outbound is Shadow Mode's `[SHADOW DRAFT]` subject wrapper, which is a draft-to-self, not a lead-facing send. This is the finding that simplifies the whole design (section 3).

- **No label is applied at send time today.** Neither `followUp.js` nor `paths.js` touches labels. A fired nudge gets a Sheet update (H/J/G/P), a column-L append, and the send. So there is no existing hook to piggyback on; the system-nudge label is net-new, following the `ensureLabelsExist` pattern already established in `leadIntake.js`.

- **Column map (`gmail.js` COLUMN_MAP):** H = followUpCount, J = lastFollowUpDate (the primary cadence anchor), P = lastActionTimestamp (fallback anchor, written alongside J on every follow-up fire), L = conversationHistory, N = gmailThreadId, A = leadId (the lead's email, lowercased). The cadence math (`followUp.js:78-84`) measures from `row.lastFollowUpDate || row.lastActionTimestamp`.

## 2. The design in one paragraph

Add an orchestrator step that runs once per agent, right after `processAgent` and before `checkStaleQuestions`/`runFollowUps`, which scans the agent's Sent folder for messages to leads, ignores the follow-up engine's own nudges and anything already handled, and for each genuine outbound resets that lead's follow-up counter to zero, re-anchors the cadence clock to the send, and logs the send to the conversation history. The follow-up engine is changed in one place to label its own sends so the new step can tell a system nudge apart from a real reply.

## 3. Idempotency: two labels, no new sheet column

The recon collapsed the hard part. Because live-AI and human replies are indistinguishable and BOTH are genuine touches that should reset, the only outbound we ever need to exclude is the follow-up engine's own nudge. So:

- **`agent-ai/system-followup`:** applied by `followUp.js` to its own nudge at send time. Marks "the system sent this, do not treat it as a genuine reply."
- **`agent-ai/outbound-processed`:** applied by the new tracking step to a genuine outbound AFTER it resets that lead's state. Marks "already counted, do not reprocess next cycle."

The tracking step scans Sent to a lead, skips any message carrying EITHER label, and for a survivor performs the reset then stamps `outbound-processed`. Two labels, each a distinct job, both created via the same `ensureLabelsExist`-style pattern as leadIntake's four labels. No new COLUMN_MAP entry is required, which is why this is preferred over a "last processed outbound timestamp" column.

This is the load-bearing correctness property: without the `system-followup` exclusion, the tracking step would see the follow-up engine's own nudge (which writes J/P to now) as a fresh outbound next cycle and reset H forever, and the sequence would never reach cold. The label is what prevents the infinite-reset loop.

## 4. What resets, and what deliberately does not

On a genuine outbound to a lead (survives both label filters):

- **H (followUpCount) resets to 0.** A new waiting cycle has started from this send.
- **J (lastFollowUpDate) re-anchors to the send timestamp,** and **P (lastActionTimestamp) is written alongside** to match the existing follow-up-fire write pattern, so the Day 3/7/14 windows count fresh from the send.
- **L (conversationHistory) gets an appended entry** noting the outbound with a timestamp, via the same `appendToConversationHistory` shape the rest of column L uses (confirm the shape in a quick recon so the entry reads consistently).

What does NOT happen:

- **H is NOT incremented.** H is the nudge odometer for the current waiting cycle; the fact that a touch occurred belongs in L, not H. Incrementing H would corrupt the odometer's meaning.
- **Column T (leadCategory) is never touched.** Outbound tracking has nothing to say about SOI status.

### 4.1 The resume-vs-nudge refinement (PARKED, not built)

"The agent sent something" is really two events that want opposite handling. If the agent is REPLYING to something the lead said, that is re-engagement and the sequence should reset (the base fix above). If the agent is doing their OWN manual FOLLOW-UP on a still-silent lead, that is a nudge and H arguably should increment toward cold rather than reset. The system cannot cheaply tell the two apart (both are just an outbound from the agent), and Mo's read is that agents probably will not do their own follow-ups much. So the base fix resets on every genuine outbound, which is correct for the common case (re-engagement), and the increment-toward-cold refinement is parked until a real agent's behavior shows it matters. A lifetime "total touches ever" tally, if ever wanted, is a separate new column, not H.

## 5. Orchestrator step placement

Per-agent loop order today (`src/index.js`, in `main()`): guard on refresh token, `processAgent`, `checkStaleQuestions`, `runFollowUps`, `maybeRunDailyDigest`, `maybeRunAngleGeneration`, `maybeRunContentEngine`.

The new step slots in **after `processAgent` and before `checkStaleQuestions`**. Reason: `processAgent` reads the Sheet and processes inbound; running outbound tracking immediately after it, before the follow-up engine evaluates eligibility, means an outbound the agent sent between cycles has already reset H/J/L by the time `runFollowUps` reads the row in the same pass. Running it after `runFollowUps` would work but delays the reset by a full cycle.

## 6. The followUp.js send-time label change

In `runFollowUps`, the live-mode send at `followUp.js:166-179` currently discards the return. Change it to capture the sent message and label it:

- `const sent = await email.sendReply(agentConfig, {...});`
- then `gmail.applyMessageLabels(agentConfig, sent.id, [systemFollowupLabelId], [])` (importing `./gmail` directly, since `email.js` does not re-export label functions).

The label id is resolved via the same `ensureLabelsExist`/`listLabels`/`createLabel` + per-agent cache pattern leadIntake uses. Best-effort: a label failure must NOT break the send (log and proceed), same posture as leadIntake's label calls. Note the shadow-mode branch (`followUp.js:153-165`) sends a draft-to-self, not a lead-facing message, so it does not need the label; only the live nudge does. Path 1A / Path 3 sends in `paths.js` deliberately get NO label, because a live-AI reply SHOULD count as a genuine touch and reset the sequence.

## 7. The tracking step itself

A new module (suggested `src/outboundTracking.js`) exporting a per-agent function, `opts.baseDir`-aware, following the reusable-function discipline. Shape:

1. Read the Sheet rows once (`email.readSheetRows`).
2. Determine a scan window (messages sent since some recent bound, to keep the Sent query cheap; a trailing window of a few days is enough since processed messages are label-gated anyway).
3. Query Sent via `gmail.searchMessages(agentConfig, query, max)` with a query like `in:sent after:<bound>`, then `gmail.fetchMessage` per id to get `{ id, threadId, to, internalDate }`.
4. For each sent message: skip if it carries `agent-ai/system-followup` or `agent-ai/outbound-processed` (check labelIds, or apply-and-check per the leadIntake tolerance). Match it to a lead row by recipient address (`email.findRowByEmail(rows, to)`) and/or thread id.
5. On a match: reset H to 0, write J and P to the send time, append to L, then `applyMessageLabels` the `outbound-processed` stamp on that message.
6. Best-effort per message: one failure never aborts the batch (per-message try/catch), same posture as `enrichLeads`.

## 8. Matching an outbound to a lead row

Use `email.findRowByEmail(rows, email)` (`gmail.js:558`, the unfiltered linear scan by column-A email), NOT the `leadIndex` built in `processAgent`. The recon flagged this: `leadIndex` is built only from PROCESSABLE rows (validation, AI-enabled, SOI, and rate-limit filters applied), so a lead currently rate-limited or AI-disabled would be missing from it, yet that lead still needs its state updated when the agent emails them. Thread id (`msg.threadId`) is also available and can serve as a secondary match key; recipient address is the primary key and matches the existing reply-matching key shape (lowercased column A).

## 9. What NOT to do

- Do NOT reuse `pollSentFolderForDraftResolution` (`digest.js:1333-1389`). It is narrowly coupled to Shadow Mode `[SHADOW DRAFT]` catch-rate reporting and returns a classification tally, not per-message data. Reuse the PRIMITIVES it sits on (`gmail.searchMessages` + `gmail.fetchMessage`), not the function.
- Do NOT add a "last processed outbound" sheet column. The two-label scheme covers idempotency without schema change.
- Do NOT label Path 1A / Path 3 sends. They must count as genuine touches.
- Do NOT increment H. Reset only (section 4).
- Do NOT use the `leadIndex` for lookup (section 8).

## 10. Testing

Hermetic, following the established pattern. Mock `gmail.searchMessages`/`fetchMessage`/`applyMessageLabels` and `email.readSheetRows`/`updateSheetRow`/`appendToConversationHistory`. Cover, with load-bearing assertions ordered first:

- A genuine outbound to a lead resets H to 0, writes J and P to the send time, and appends L (assert the actual row writes, not just that a function was called).
- A message carrying `system-followup` is SKIPPED and H is untouched (this is the infinite-reset-loop guard; make it explicit).
- A message carrying `outbound-processed` is SKIPPED (no double-count).
- A survivor gets stamped `outbound-processed` after its reset.
- An outbound to a rate-limited/AI-disabled lead (absent from the processable set) is still matched and reset, proving the unfiltered `findRowByEmail` lookup is used.
- The follow-up engine's own nudge, once the send-time label is applied, is correctly excluded on the next cycle (integration-style, or assert the label is applied at send in a followUp.js test).

Break-the-fix each new test file with positive confirmation the destructive edit applied before running.

## 11. Session 48 recon prompt (paste FIRST, anchors may have drifted)

The design is locked; this only re-verifies the line-number anchors before code, since the file moves between sessions.

```
Recon only. Read-only. Do not edit, create, write, run tests, or commit. Stop and wait at the end.

Confirm these anchors from OUTBOUND_TRACKING_SPEC.md still hold in the current tree, quoting current line numbers where they have moved:

1. followUp.js: the live-mode nudge send (was 166-179) that awaits email.sendReply and discards the return. Confirm it still discards, and confirm the shadow-mode draft-to-self branch (was 153-165) is separate.
2. gmail.js: sendReply and sendNewEmail still return res.data ({id, threadId, labelIds}). applyMessageLabels signature (was 724-737). Confirm applyMessageLabels is NOT exported through email.js.
3. gmail.js: searchMessages and fetchMessage signatures, and findRowByEmail (was 558).
4. index.js: the per-agent loop order, confirming the slot right after processAgent and before checkStaleQuestions.
5. leadIntake.js: the ensureLabelsExist / listLabels / createLabel + per-agent label cache pattern, so the new labels follow it.
6. The appendToConversationHistory signature/shape, so the outbound L entry matches existing entries.
7. COLUMN_MAP: confirm H=followUpCount, J=lastFollowUpDate, P=lastActionTimestamp, L=conversationHistory, N=gmailThreadId, A=leadId.

Report as a numbered list. Then stop and wait.
```

## 12. Session 48 code prompt (paste AFTER recon confirms anchors)

```
Implementing outbound tracking per OUTBOUND_TRACKING_SPEC.md. This implements. Do NOT commit, do NOT git add -A. Split into TWO commits, stop for my diff review after each.

The recon you just ran holds. If any anchor moved, use the current line numbers.

COMMIT 1: follow-up engine labels its own sends.
- Add an agent-ai/system-followup label constant and ensure it exists via the leadIntake ensureLabelsExist pattern (reuse or mirror; do not duplicate the label-cache logic if it can be shared cleanly).
- In followUp.js's LIVE-mode nudge send, capture the sendReply return and apply the system-followup label to sent.id via gmail.applyMessageLabels (import ./gmail directly; email.js does not re-export it). Best-effort: a label failure logs and does not break the send. Leave the shadow-mode draft-to-self branch and all paths.js sends unlabeled.
- Tests: assert the label is applied to the sent id on a live nudge; assert the shadow branch does not apply it; assert a label failure does not throw. Break-the-fix.

COMMIT 2: the outbound-tracking step.
- New src/outboundTracking.js exporting a per-agent function, opts.baseDir-aware. It reads the Sheet once, scans Sent via gmail.searchMessages + gmail.fetchMessage over a trailing window, and for each sent message: skip if it carries agent-ai/system-followup or agent-ai/outbound-processed; else match to a lead row via email.findRowByEmail (NOT the leadIndex) by recipient address; on a match reset followUpCount (H) to 0, write lastFollowUpDate (J) and lastActionTimestamp (P) to the send time, append an outbound entry to conversationHistory (L) via appendToConversationHistory, then stamp agent-ai/outbound-processed on the message. Per-message try/catch so one failure never aborts the batch. Do NOT increment H. Do NOT touch column T.
- Wire it into index.js's per-agent loop right after processAgent and before checkStaleQuestions.
- Tests per spec section 10, load-bearing assertions first (genuine outbound resets H/J/P/L; system-followup skipped and H untouched; outbound-processed skipped; survivor gets stamped; a rate-limited/disabled lead is still matched via findRowByEmail). Mock all gmail/email I/O. Break-the-fix each new test file.

Constraints: no em-dashes or en-dashes anywhere. Restart the server before any browser check (routes/loop do not hot-reload). Do not commit. Show me the raw diff and test output after EACH commit, then stop.
```

## 13. Open questions and parked refinements

- **Scan window size:** a trailing few-day window keeps the Sent query cheap; since processed messages are label-gated, the window only needs to comfortably exceed one orchestrator cycle plus any realistic agent-offline gap. Pick a concrete value at build time (24 to 72 hours is reasonable); it is not load-bearing because the labels, not the window, prevent double-processing.
- **Resume-vs-nudge (4.1):** parked until a real agent does manual follow-ups and we see it matter.
- **Lifetime touch tally:** parked, would be a new column.
- **Thread-id as primary match key:** recipient address is primary for v1; thread id is available as a secondary key if address matching ever proves insufficient (e.g. an agent emailing a lead from a different address).

## 14. Summary of locked decisions

1. The system is deaf to outbound; add a per-agent tracking step that resets follow-up state on a genuine send.
2. On genuine outbound: reset H to 0, re-anchor J and P to the send, append to L. NOT increment H.
3. Idempotency is two labels: followUp.js stamps its own nudge `agent-ai/system-followup`; the tracking step stamps a handled outbound `agent-ai/outbound-processed`; it skips anything carrying either. No new sheet column.
4. Live-AI and human replies both count as genuine touches (they are indistinguishable, and correctly so); only the system nudge is excluded.
5. Step runs after processAgent, before checkStaleQuestions/runFollowUps.
6. Lookup uses the unfiltered findRowByEmail, not the leadIndex.
7. Reuse the primitives (searchMessages, fetchMessage, applyMessageLabels), not pollSentFolderForDraftResolution.
8. Two commits: send-time label first, tracking step second.
9. Resume-vs-nudge increment and lifetime tally are parked refinements.
