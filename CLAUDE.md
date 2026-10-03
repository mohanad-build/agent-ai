# CLAUDE.md

GetKlosed (repo: agent-ai) is a Node.js system for Ontario real estate agents. It answers and follows up leads from the agent's Gmail, sends a daily brief by SMS and email, generates weekly content, and runs a transaction coordinator (TC) that tracks each deal's checklist, files documents to Drive, and alerts the agent when something needs them. Production runs on Railway from the main branch. Mo (the operator) runs the business and makes every product decision.

## Commands
- Full test suite: `npx jest`. Read the totals line; never add counts by hand.
- One file: `npx jest tests/<file>.test.js`
- Deal CLIs live in `scripts/`: open-transaction, set-fact, complete-item, satisfy-person, review-filing, list-participants.

## Where things are
- `src/transactions/`: the TC. store (deal files), facts, items, filings, proposals, participants, resolver (the checklist), alerts, queries, and `rules/` (the catalog per deal type, conditions, deposit, fact keys, fact vocabularies).
- `src/digest.js`: the daily agent brief and the weekly operator digest.
- `src/content/`: the content engine.
- `src/index.js`: the scheduler loop.
- `src/calendarDate.js`: calendar dates, today in a timezone, day counting.
- `docs/`: specs and design notes. Read the relevant one before building.
- Local `agents/` holds runtime data. Never edit it. Tests use temp directories.

## How to work in this repo
1. Never stage, commit, push or deploy. Mo does that after reading the diff.
2. Read before editing. Quote file:line for what you rely on. If you claim something does not exist, show the grep and its empty output.
3. Stop and report, rather than improvise, when: what you read contradicts the task; an existing test must change; a result is unexplained; a file outside the stated scope must change.
4. Touch only the files the task needs. List every file you changed.
5. Tests: expected values are hand-written literals, never computed with the code under test. Setup fixtures may be built any way. Every rejection test checks the message and that nothing was written.
6. Every new check gets a mutation: break it on purpose, one at a time, prove the edit landed with grep, run the tests, then restore and confirm with git diff. Predict reds by asking which tests would see a different outcome, and name any extra red with its cause.
7. No em dashes or en dashes anywhere: code, comments, test names, commit messages, user-facing text. Check added lines with `git --no-pager diff -U0 | perl -CSD -ne 'print "$.: $_" if /^\+/ && /[\x{2013}\x{2014}]/'` and run the same perl check on new untracked files.
8. Never print .env, tokens, or any real agent or operator email address or phone number.
9. Comments explain why, not what.
10. Finish with a report: git status, full-suite totals before and after, each mutation (grep proof, failing tests, restore proof), and the dash check. Do not paste the diff; Mo reads it himself.

## Two levels of care
- Full care: anything that sends to an agent or operator, writes an agent's data, touches Gmail, Sheets or Drive, or runs on the scheduler. Read first, report your plan, and wait for approval before editing.
- Light care: pure logic, tests, refactors with no live effect, docs. Read, implement, verify and report in one pass. Stop only on the rule 3 triggers.
- When unsure, treat it as full care.

## Domain rules that shape the code
- Deal types: buyer_purchase, seller_sale, tenant_lease, landlord_lease (deals); seller_listing, landlord_listing (listings). A double-ended deal is the sell-side type with the buy-side catalog merged in.
- The agent can always override. The TC records; it never appoints itself the authority.
- A row the agent cannot act on is not a row.
- A fact has three possible answers: a value, an explicit none ([] or false), or not answered yet (absent, which resolves as indeterminate). Every fact has a closed shape enforced by setFact; checkFact runs the same rules without writing.
- The facts map holds only dates a person stated. A system writer is refused for date facts.
- Blanks are allowed but never silent: always surface what is still unanswered.
- Actors are agent, operator (Mo) and system.
- Today is computed in the agent's own timezone. Days are counted on calendar dates.

## Engineering lessons worth not relearning
- Absent and false mean different things. Keep them distinct.
- Open the file before describing it. Most past errors came from reasoning about code instead of reading it.
- A mutation must be able to reach the behaviour it claims to test. A check that cannot fail proves nothing.
- A test that compares two code paths cannot catch a rule removed from code both paths share.
- When a rule gets stricter, look for fixtures that silently relied on the old looseness.
