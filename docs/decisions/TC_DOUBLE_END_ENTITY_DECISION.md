# TC — Per-client entity type on double-ends: Mo's field answer and what it forces

Decided 2026-08-31. This closes the question PROJECT_STATE_v24 §5 flagged as
"needs Mo, needs no code, and it is the only thing blocking the last piece of
the double-end." Not yet built — this is the design consequence, written down
so the next session starts from a decision rather than the question.

## The question and the answer

*On a double-end where the buyer is a numbered company and the seller is an
individual, does the deal file carry two separate sets — corporate records for
the buyer, individual records for the seller — or does the brokerage handle
the corporate side elsewhere?*

**Mo's answer: two separate sets, in the same file.** Each client carries
whatever their own status requires — corporate records (confirmation of
existence, directors, beneficial ownership) for the numbered company, ordinary
individual ID records for the seller — and both live inside the one deal file.

## What that forces

**Applicability is a per-person property, not a file property.** The current
`entityType` is one value for the whole transaction and structurally cannot
say "buyer is a corporation, seller is an individual." On a mixed double-end
both branches are wrong, and the failure is silent — no row surfaces to tell
the agent anything is off.

**The resolver's ordering is the actual blocker, not the fact's shape.**
`requiredWhen(facts)` runs once per catalog item, and only afterwards does
`withClientSatisfaction` fan that already-resolved item out across each
person. Applicability is therefore decided before the code knows *which*
person it is deciding for, so it can only see file-level facts. Reshaping
`entityType` into something richer does not help while the decision still
happens upstream of the fan-out. **The fan-out has to happen first, or
`requiredWhen` has to receive the person.**

## The scope of the change is narrower than it first looks

Only items that are both `scope: 'client'` and `clientScope: 'event'` need
per-person applicability.

- `scope: 'transaction'` items are genuinely file-level. Unchanged.
- `clientScope: 'dated'` items (e.g. `buyer_representation_agreement`) are
  skipped by `withClientSatisfaction` entirely and render as a single row.
  Unchanged.

So this is a targeted change to one branch of the resolver, not a rewrite of
applicability.

## The rejected interim is back on the table, and now works

PROJECT_STATE_v24 §2 records that resolving mixed-entity rows `indeterminate`
was designed and REJECTED, on the grounds that §4.6 derives the agent's
questions from `pendingFacts`, and no fact existed that the agent could set to
clear it — so it would be a permanently unanswerable row on every double-ended
file.

**Per-participant entity type creates exactly that fact.** The agent can
answer "this buyer is a corporation," the row resolves, and the objection
disappears. Whether `indeterminate` is still worth having as an interim once
per-person applicability exists is a separate call, but it is no longer
blocked on the thing that killed it.

## Where the data hangs

Participants (TC_SPEC 6) are already built end to end as of session 66 —
store, derivation, authorization gate, two CLI verbs. Per-participant entity
type belongs on that record. No new store is needed.

## Not decided here

- The exact signature change: `requiredWhen(facts, person)` for client-scoped
  items, versus a separate per-person predicate, versus moving the fan-out
  above resolution. All three reach the same place; the choice should be made
  against the real call sites rather than in the abstract.
- Whether existing single-entity files migrate (file-level `entityType`
  copied down onto each participant) or whether absence is read as
  "inherit the file value" at read time.
- Which specific catalog items actually differ between corporate and
  individual clients. Worth a recon pass over the paired catalogs before
  building — the last two times this project assumed a catalog difference
  without opening the files, one of the two claimed items turned out to be
  byte-for-byte identical.
