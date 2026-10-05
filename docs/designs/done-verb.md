# DONE: the alert tap on assistant@

Session 83. Design locked in chat.

## Why

Session 81's alerts (src/transactions/alerts.js) will reach the agent in
the daily brief. Each alert needs a one-tap way for the agent to record
that the thing is done, through assistant@, the same way CONFIRM works.

Session 81 called the tap "Got it". That label is replaced. To an agent,
"Got it" means "I've seen this", but the tap records completion. An agent
tapping it on a condition heads-up would mark the condition cleared with
no waiver on file, and would switch off the condition-passed alerts that
exist to catch exactly that.

## Decisions

1. The tap states the fact it records. Condition alerts: "Waived or
   fulfilled". Additional deposit alerts: "Deposit received". There is no
   acknowledgment-only tap: alerts are stateless, so not tapping already
   means "seen, not done".
2. A deposit alert carries two taps.
   a. The stuck step, by its own label. DONE <transactionId> <itemId>,
      using the alert's stuckAt, never its itemId (the receipt). Ticks
      that one row. The deposit is three steps so that a slip sitting
      unforwarded is visible; ticking the receipt would hide that gap.
   b. "Receipt in hand". RECEIPT <transactionId> <receiptItemId> ticks
      every incomplete step of the chain ending at that receipt, in ONE
      save. A receipt cannot exist without the earlier steps, so the tap
      states them. Phase A completes nothing automatically, so every
      deposit alert will show step one as stuck even when the deposit is
      fully receipted; without this tap an agent taps three times over a
      week for one deposit. The receipt id must be the last step of a
      deposit chain for that deal type, or the verb refuses.
3. UNDO <transactionId> <itemId> [<itemId> ...] reverses exactly the rows
   a tap completed, in ONE save, under markItemIncomplete's rules. Every
   confirmation reply carries an Undo link naming those rows. The event
   log keeps both events.
4. markItemComplete refuses an item that is already complete. Today it
   silently overwrites, so a double tap would erase when the item was
   really done. The guard lives in the record, not the caller. A tap on a
   done row replies "Already marked done on <date>". The CLI must now
   undo before re-completing, which keeps the history.
5. A completion by tap writes actor 'agent', completedAt the tapped
   message's date, and the note "Confirmed by the agent's tap on
   assistant@". No new field.
6. Stale taps are refused with a plain reply and nothing written: the
   deal is in a terminal state, or the row is not currently required.
   The checklist is resolved at tap time, because the alert may be days
   old.
7. Same machinery as CONFIRM: subject-line parse, strict token
   validation, synchronous read then write with no await between, the
   sender's own agentId picks the folder, every reply carries an html
   part.
8. Out of scope here: rendering the taps in the brief (the next item,
   "Deals needing you"), and the "fell through" response, which emails
   Mo and is designed with that section.

## Order

1. markItemComplete refuses an already-complete item.
2. The one-save compositions: complete a chain's remaining steps, and
   uncomplete a list of rows.
3. DONE, RECEIPT and UNDO on assistant@, live-verified on a seeded
   mo-test deal. No brief links point at them until "Deals needing you".

## Recon findings carried to commits 2 and 3

- On a double-ended deal the paying chain is not in the resolved
  checklist (resolver.js omitWhenDoubleEnded). RECEIPT checks the receipt
  id and every chain step against the resolved rows, never the static
  catalog arrays. Decision 6's "currently required" check covers this;
  the refusal reply is the same.
- No exported chain lookup exists; alerts.js derives private id arrays.
  Commit 2 adds one export in rules/deposit.js (the chain ending at a
  given receipt id) and alerts.js switches to it, so the alert and the
  tap cannot disagree about what the chain is.
- gmail.js turns a missing internalDate into 0. Commit 3 never writes
  that as completedAt: it falls back to processing time and logs one
  line saying so.
- CONFIRM stamps its write with processing time, not the message date.
  DONE, RECEIPT and UNDO use the message date per decision 5; CONFIRM is
  left as is.
