# TRANSACTION_COORDINATOR_SPEC.md - agent-ai

**Status:** DESIGN v23. **`assistant@` IS READY FOR THE DIGEST TO PUT LINKS IN FRONT OF AN AGENT: TAPS RUN IN THE ORDER SENT, FAILED REPLIES ARE LOGGED, AND EVERY REPLY CARRIES AN HTML PART. Section 14 step 12 is DONE; 6.7's residual-risk note is closed; 6.7.5 records the reply-format finding; section 14 gains the v23 honest read, and the digest section is the next TC work.** v23 drafted session 80 (2026-09-25 and 2026-09-28), five TC-path commits on `session-80`, each fast-forwarded to `main` and deployed: `6c13343` oldest-first processing, `1179668` no address in the retry label, `4fe521c` failed-reply logging, `e975070` and `7caa23e` the html part. Three further commits that session were onboarding security (PROJECT_STATE 7.25.1), not TC. Tests 2893 to 2938 across 140 to 144 suites. Google approved OAuth verification for `gmail.modify` on 2026-09-28. Prior status, v22 follows. **Status (v22):** DESIGN v22. **THE SUBJECT VERBS ARE BUILT, DEPLOYED AND LIVE-VERIFIED: THE FIRST REAL PARTICIPANTS HAVE BEEN CREATED IN PRODUCTION. Section 6.7.5 is BUILT and records the design; 6.7.2 closes the refusal surface; the 6.7 residual-risk note is corrected; section 14 marks 4c-2 done and inserts oldest-first processing ahead of the digest.** v22 drafted session 79 (2026-09-24), three commits on `session-79`, fast-forwarded to `main` at `73269bd` and deployed: `5815950` id validators exported, `9645d33` role labels, `73269bd` CONFIRM / REJECT / WRONGDEAL on `assistant@`. Tests 2805 to 2893 across 140 suites. Prior status, v21 follows. **Status (v21):** DESIGN v21. **THE CONFIRM AND WRONG-DEAL COMPOSITIONS ARE BUILT, AND `assistant@` IS HARDENED FOR THE VERBS. Section 6.7.2 is amended and now BUILT; 6.7.5 records the mailbox work; section 14 gains 4c-1c.** v21 drafted session 77 (2026-09-18), eight commits on `session-77` (five mailbox commits `afd29fd`, `4710f48`, `227052d`, `da8a6e2`, `5e6f62d`, see 6.7.5 and PROJECT_STATE session 77), plus these three, none on `main`, no Railway deploy: `e9d29e8` 4c-1a, `a49b45f` 4c-1b `confirmProposalSet`, `399eaea` 4c-1c `markWrongDeal`. Tests 2668 to 2709 across 134 to 136 suites. **Production behaviour unchanged: both compositions are uncalled until 4c-2.** Prior status, v20 follows. **Status (v20):** DESIGN v20. **THE TWO EXTRACTIONS ARE DONE, THE SET STATUS WRITERS EXIST, AND EVERY BUILDER IN THE CODEBASE WAS READING AN IDENTIFIER IT SHOULD HAVE BEEN PASSED. Sections 6.7.1 and 6.7.2 are amended, 6.7.4 and 6.7.5 are new, section 14's participant order goes from twelve steps to fourteen with 4c split in two.** v20 drafted session 76 (2026-09-17), six commits on the `session-76` branch, none on `main`, no Railway deploy: `f56b806` 4a, `366bc13` 7.53.10, `5cdd34d` 4b, `b834d3f` and `76990bd` the `transactionId` fix across three modules, `2fd14ab` the set status writers. Tests 2640 to 2668 across 134 suites. **Production behaviour is unchanged: every new module is pure and uncalled, and the three wrappers touched keep their signatures and their return values.** Prior status, v19 follows. **Status (v19):** DESIGN v19. **THE PROPOSAL STORE IS BUILT, THE PARTICIPANT VOCABULARIES ARE CLOSED, AND THE CONFIRM STEP NEEDS TWO EXTRACTIONS FIRST. Sections 6.2 and 6.6 are amended, 6.7 is amended and partly built, section 14's order goes from seven steps to twelve.** v19 drafted session 75 (2026-09-15), four commits, pushed to the `session-75` branch and then to `main` at session close (deployed, no production behaviour change since nothing live calls the new code): `bbd2d32` roles, `865de2c` shared field validation, `28b3f91` entity types, `0fc32ec` the proposal store. Tests 2555 to 2640 across 133 to 134 suites. Prior status, v18 follows. **Status (v18):** DESIGN v18. **THE PARTICIPANT MODEL HAS A CORRECTION PATH AND A SECOND WRITER, AND THE REASON IT NEEDED BOTH IS THAT IT HAS NO CREATION PATH AT ALL. Sections 6.5, 6.6 and 6.7 are new. Sections 4.5, 6.1 and 6.4 are amended.** v18 drafted session 74 (2026-09-14), which shipped three commits to `main`: `b2a96fd` participant voiding, `39a2af2` the email-normalization leaf extracted out of `matcher.js`, `923640c` adding an email to an existing participant. Tests 2521 to 2555 across 132 to 133 suites, full `npx jest` green at every commit. **Production behaviour is unchanged: two new modules with no live callers, and one behaviour-preserving refactor whose own suite required no edits.**

**THE HEADLINE IS A RECON FINDING, NOT A COMMIT. `addParticipant` HAS ZERO CALLERS OUTSIDE THE TEST SUITE.** Not production, not CLI. Session 66's board recorded the participant model as built "end to end" with two CLI verbs, and both verbs READ. Nothing writes. So no participant can exist on any live path, and everything downstream inherits that: `representedPersons` derivation, per-person satisfaction, the per-person applicability work of session 71, the authorization gate. All built, all correct, all fed by hand-edited JSON. **This is the filing review axis of session 67 repeating: built, correct, no door.**

**AND IT MEANS 4.5 WAS NEVER UNBLOCKED.** Session 63 abandoned the listing-to-offer transfer because there was no persisted completion state to move. 4.3 shipped in session 64 and every board since has recorded 4.5 as unblocked. **4.3 was never the blocker.** The completion signal the resolver treats as authoritative for a client/event item is `outstandingPersons`, derived from `clientSatisfactions`, and `markPersonSatisfied` throws unconditionally through `assertRepresented` because no participant can exist. Session 63's instinct was right and its stated cause was wrong, and the wrong cause is what got carried forward for ten sessions. Full statement in 4.5.

**THE SEVENTH, EIGHTH AND NINTH TIMES THIS DOCUMENT OR A STATED PREMISE HAS BEEN WRONG ABOUT THE CODE.** 4.5's blocker, above. 4.5's scope: this document says the filter transfers the RECO Guide and the FINTRAC client records, but the FINTRAC items are declared in `buyerPurchase.js` and `sellerSale.js`, which are DEAL types; the two listing catalogs declare no client-scoped items of their own and inherit exactly one. **4.5 transfers one item, not a set.** And one premise was Claude's rather than this document's: a recon prompt asserted three direct readers of `transaction.participants` and there are six.

**THE FALSE-MATCH RISK THIS SESSION WENT LOOKING FOR IS DEFUSED BY A DIFFERENT PARKED ITEM, and neither item knew about the other.** PROJECT_STATE 7.51.7 says quoted reply chains become a false-match risk the moment signal B goes live, because signal A reads an untrimmed body. B did go live when the accumulator was wired in session 72. **But signal A cannot read a body at all:** `parseGmailMessage` returns no body field across all five call sites, and `intake.js` builds the matcher view with a `body` that is permanently `undefined`. So A is decided by the subject line alone and the quoted history never reaches the scanner. **7.51.1 silently defuses 7.51.7.** Both were written onto the same board in the same session and contradict each other; neither was read next to the other until now. **The consequence is the thing to carry: wiring the body into the matcher view is what ARMS 7.51.7.** It looks like a one-line fix and it is not. See 6.7's closing note.

**Status (historical, v17):** DESIGN v17. **THE FILING LOOP IS CLOSED END TO END. An agent's documents now file themselves: arrival pass matches, drain pass fetches and uploads, filing record records. Section 7.15 is new. Sections 7.7, 7.13, 7.14 and 10.2 are amended, and 7.49 is a new parked list.** v17 drafted session 72 (2026-09-08/09), which shipped three TC commits to `main`: `e1cea0a` the drain pass plus the `attempts` incrementer plus the three seen-time fields, `38f2cdb` the 7.13 fix and the merged touchpoint loop, `04de5a5` the shared agent-discovery module. Tests 2445 to 2499. Four further commits that session were CASA security work, not TC.

**THE HEADLINE IS NOT THE DRAIN PASS. IT IS THAT v16 STATED A FALSE FACT THAT WAS ABOUT TO START FIRING.** v16 wrote, as the basis of Pass 1's whole re-entrancy design, that "`recordDocumentSeen` is an idempotent no-op on re-entry." It threw on any terminal status. That was harmless only while `filed` was unreachable — and the drain pass is the commit that makes `filed` reachable. Uncorrected, **every successfully filed document would have thrown every five minutes forever**, swallowed by a try/catch and logged. Full statement in 7.14. **That is the fifth time in four sessions this document has been wrong about the code, and every one was caught by opening the artifact rather than by reasoning about it.**

**Three further corrections to this document, all the same shape.** 10.2's filename `<date received> - from <sender>` was written against a record that stored neither a sender nor the message's own date — the identical failure to session 71's "persists its folder id" against a field that did not exist. 7.13's parked defect turned out to have a **second, undescribed half that was the worse one**: the name-backfill branch mutates a compliance record while the event reports `addresses: []`, so the audit trail omitted a real change. And `queries.readAllTransactions` never threaded `baseDir`, invisible until a test used real modules instead of mocks.

**THE PROCESS FINDING THAT SHOULD OUTLIVE THE CODE, and it belongs in PROJECT_STATE 4.4 rather than here: SEVEN TIMES IN ONE SESSION A TEST LOOKED LIKE COVERAGE AND DELIVERED NONE.** A regression test that mocked the seam the bug lived in. A test that only reddened because it was run against the unfixed code first. An assertion that could not distinguish stale data from fresh. A consolidation that lost three behaviours while the test count reconciled exactly. A store-agnostic helper that read through a pruning-on-read API to check whether pruning happened. A logFn spy installed after the value under test had already been captured at module load. And a sweep test whose deliberate isolation of one reaper made it structurally blind to two reapers racing. **Seven mechanisms, one shape: suite green, defect untouched. Every one was caught by asking what would make this fail, and none by running anything.**

**Status (historical, v16):** DESIGN v16. **THE ORCHESTRATOR'S ARRIVAL PASS IS BUILT AND `src/transactions/` HAS A LIVE CALLER FOR THE FIRST TIME SINCE SESSION 55. The A5 prerequisite nobody had sized — no Drive folder id persisted anywhere — was found and closed in the same session. Section 7.14 is new. Sections 10.2 and 14 are amended, and section 14 carries two corrections to claims this document has repeated since session 64.** v16 drafted session 71 (2026-09-02), which shipped four commits to `main`: `f26c8e7` the orchestrator arrival pass, `4960fb4` an atomic agent-config writer, `c90dde8` the digest agent-discovery filter, `f70e24a` the Drive folder ids. Tests 2409 to 2445 across 116 to 122 suites, full `npx jest` green at every commit. **The freeze is over and all four are pushed.**

**What changed from v15, in one paragraph, and two of the four items are corrections to this document rather than new design.** The orchestrator split into TWO PASSES along a seam that already existed in the code — every `src/transactions/` module is synchronous and everything touching the network is async — which turns 7.7's concurrency constraint from a rule someone must remember into a condition that is structurally unreachable. The arrival pass shipped; the drain pass is next and is now the smallest of the series. **CORRECTION ONE: `src/gmailAttachments.js` EXISTS AND IS WELL TESTED.** This document states twice, in section 14's Phase A progress for sessions 64 and 65, that nothing in `src/` fetches attachment bytes and that "attachment bytes" is the first remaining item on the filing run. `fetchAttachmentBytes` has been built, tested and uncalled the whole time. **CORRECTION TWO: NOTHING PERSISTED A DRIVE FOLDER ID ANYWHERE**, not on the agent config and not on the transaction envelope, so 10.2's "created at deal-open" was unbuildable as written. That is now `driveParentFolderId` and `driveFolderId`, and 10.2's naming rule is amended to always use the deal-open date. **And the session-70 board's claim that the section 3 double-end question is unresolved is STRUCK:** it was closed in session 69 and is 7.1.2b.

**Status (historical, v15):** DESIGN v15. **THE LAST DOUBLE-END GAP IS DECIDED AND NOT BUILT: per-client entity type on mixed double-ends. New section 4.6a.** v15 drafted session 70 (2026-08-31). Mo's field answer — two separate record sets in one file, each client carrying whatever their own status requires — makes applicability a per-person property and identifies the resolver's ORDERING as the blocker rather than the shape of `entityType`. Scope is one branch of the resolver. The `indeterminate` interim that v14 recorded as rejected is viable again, because per-participant entity type creates the very fact whose absence killed it. Nothing else in v14 changed.

**Status (historical, v14):** DESIGN v14. **THE DOUBLE-END QUESTION IS RESOLVED AND BUILT, AND IT COST FAR LESS THAN v13 EXPECTED. Section 7.1.2b is REWRITTEN from the top open design item into a locked design. Sections 4.1.5, 5.2.1, 7.13, 14, 16 and 17 are amended. Sections 4.1.6 and 5.2.3 are new.** v14 drafted session 69 (2026-08-27), which shipped eight commits: `dd5fd3e` the `data_form` catalog item, `1270dfa` the observed-address accumulator, `ffe281f` a null guard in `findListingCandidates`, `e5958f7` the read path (which turned out never to have been committed at all), `9b7dfcc` the representation-arrangement fact and catalog union, `3843eb1` the wholesale-row invariant, `d65f730` the cause-agnostic `no_longer_applicable` reason, and `8e8eb51` the multiple representation agreement item. Tests 2346 to 2409 across 115 to 116 suites, full `npx jest` green at every commit. **All eight are committed locally and pushed to the `session-69` branch, NOT to `main`, under the CASA deployment freeze.**

**What changed from v13, in one paragraph, and the headline is a problem that shrank under measurement.** v13 framed the double-end as a section 3 question that might force collapsing the six-type model, and listed what collapsing "would have to answer" about two client relationships on one file. Two of those worries dissolved. Mo's field answer settled the first: on a double-end each client is treated as their own, with a separate FINTRAC individual identification record and a separate RECO information guide, which is exactly what `withClientSatisfaction`'s uniform per-person iteration already does. Recon settled the second: every id in `seller_sale` also appears in `buyer_purchase`, so the "union" of the two catalogs is the sell-side catalog plus exactly one item, and that one item (`buyer_representation_agreement`) is `clientScope: 'dated'` and therefore never fans out per person at all. So no role vocabulary changed, no set-once field was touched, and no per-item person scoping was built. What did change is that a fact may now shape the item SET rather than one item's applicability, which is a genuinely new role for a fact and is section 4.1.6. One real gap survives and is stated rather than papered over: `entityType` is a single value for the whole file and cannot say that the buyer is a corporation while the seller is an individual.

**Status (historical, v13):** DESIGN v13. **THE MATCHING RULE IS COMPLETE END TO END AND HAS NO CALLER. Sections 7.1.1, 7.1.2, 7.3 and 7.12 are amended. Sections 7.1.3 and 7.1.4 are new. 6.1 gains a dependency it cannot satisfy.** v13 drafted session 68 (2026-08-24), which shipped four commits: `7b8117d` the per-candidate signal evaluation, `9598b05` the candidate set and collision resolution, `src/transactions/queries.js` the read path, and `scripts/review-filing.js` the CLI verb that finally opens 7.3's review axis. Tests 2274 to 2346 across 112 to 115 suites, full `npx jest` green at every commit. **The first two commits are pushed. The last two are committed locally and UNPUSHED under the CASA deployment freeze.**

**What changed from v12, in one paragraph, and the two biggest items are both corrections rather than additions.** The tiebreak in 7.1.2 was nearly widened to "paired types plus a matching address", which reads as safe and is not: a `landlord_listing` on unit 302 and a `landlord_lease` on unit 505 in one tower are a paired type set at one compared-equal address and are two different apartments, so widening it would file one unit's paperwork into another unit's compliance record. Mo's field answer that double-ending is common ESPECIALLY WITH LEASES is what made that counterexample the likely case rather than the exotic one. The second correction is bigger and is not resolved here: SkySlope opens ONE deal file on a double-end, while the six-type model produces THREE transactions, which means the three-way collision the matcher refuses may be a modelling artifact rather than a real ambiguity. That is a section 3 question and it now outranks the orchestrator. Beyond those, signals gained an ABSENCE rule (a signal that could not be evaluated is absent from the return, never false), the read path landed with the index question closed by evidence rather than parked, and signal D stopped being unreachable.

**Status (historical, v12):** DESIGN v12. **6.1 IS REWRITTEN FROM A ONE-SHOT INTO AN ACCUMULATOR, SIGNAL E IS PROMOTED FROM PARKED TO SPECCED, 7.3's REVIEW AXIS IS BUILT, AND SIGNAL D HAS AN IMPLEMENTATION. Sections 6.1, 7.3 and 7.8 are amended. Sections 7.10 through 7.13 are new.** v12 drafted session 67 (2026-08-21), which shipped eleven commits: the first-position street-type pin, the empty-street guard in `parseAddress`, `extractCity`'s last-segment rule and district stripping, `addressScan.js`, the filing review axis, `hasConfirmedFilingOnThread`, the `To`/`Cc` recipient parse, the `recipientParsing.js` extraction, `messageAddresses.js`, and `observedAddresses.js`. Tests 2182 to 2274 across 107 to 112 suites, full `npx jest` green at every commit. **PRODUCTION BEHAVIOUR UNCHANGED: every commit is a pure module, a new field on a record nothing has ever written, or an additive parse.**

**What changed from v11, in one paragraph, and most of it came from reading real artifacts rather than reasoning about them.** Four real agreements and their filenames were read with `pdftotext` for the first time, and the corpus corrected four things this spec asserted. The scanning entry point turned out not to need a window width at all: the window is decided by the text's own grammar and a frozen terminator list, so the number nobody could have defended does not exist. Signal C is much weaker than assumed, because only one of four received filenames carries an address and the naming convention in this spec was Mo's own rather than the wire's. Signal E (read the document) was un-parked, because the objection that killed it, that an APS carries five or six addresses, is false: each sampled agreement carries exactly one, with Address for Service blank throughout. And 6.1 was reframed: it cannot bootstrap, because seeding participants from a thread requires knowing which transaction the thread belongs to, which requires matching, which requires participants. It is an accumulator that runs on threads already carrying a confirmed filing, gated exactly as signal D is.

**THE SEQUENCING QUESTION THIS SESSION RAISED AND DID NOT RESOLVE.** 6.1's storage is now complete and entirely dormant, because the accumulator has no trigger until the matcher exists. Recon showed signal B had four commits of prerequisites while signals A and C had none. **A fair reading is that the matcher should have been built first**, and that building it now would turn signal B's absence into a measurable gap rather than a designed-around one. The board has had 6.1 ahead of the matcher since session 66; that ordering deserves a deliberate re-decision at the next session open rather than inheritance.

**Status (historical, v11):** DESIGN v11. **THE PARTICIPANT MODEL IS BUILT, `representedPersons` DERIVES FROM IT, AND THE ADDRESS HALF OF MATCHING IS BUILT. Section 6 is REWRITTEN. Sections 7.1 and 4.3 are amended. Sections 6.2, 7.8 and 7.9 are new.** v11 drafted session 66 (2026-08-18), which shipped nine commits: `4628a5d` attachment bytes and content hash, `6f5500b` the address parser, `4341237` the address comparator, `63a7aa0` participant records, `64cf261` deriving `representedPersons` from participants, `769ad76` closing the old fact write path, one commit adding name resolution to the satisfy-person CLI (hash not captured in session), `c10ac62` the list-participants verb, and `fe0028d` candidate listing reporting at deal open. Tests 2063 to 2182 across 107 suites, full `npx jest` green at every commit.

**What changed from v10, in one paragraph:** matching stopped being one undifferentiated problem and split into parts that could be built. The address half is now real code: a parser producing a structured comparison form and a comparator with absence-tolerant field rules. The participant model went from a design note to a built structure, which unblocked the matching signal that depends on it and closed a two-homes problem that had been recorded as a known limitation since v9. `representedPersons` is no longer a stored fact at all; it derives from participants, `clientSatisfactions` re-keys to participant ids, and `setFact` refuses the key with the same reasoning that already excluded `clientSatisfactions`. The session also produced the first TC commit that CHANGED existing behaviour rather than adding an inert module, and it went in without a regression.

**Status (historical, v10):** **THE DRIVE FILING PIPELINE HAS ITS RECORD, ITS RETRY LAYER AND ITS CLIENT. Sections 7.1, 7.2, 7.3, 10 and 15 are amended, section 7.7 is new, and the `data_form` catalog gap is closed by design.** v10 drafted session 65 (2026-08-14), which shipped three commits (`1d071a0` the filing record with three document event kinds, `eeeea50` a retry helper for the Google calls gaxios does not retry, `a7813b9` a thin Drive client), sized the attachment-bytes gap by recon, and burned down every Drive unknown against a live probe. Tests 2010 to 2063 across 103 suites. **CORRECTION TO v9's OWN NUMBER: v9 recorded 2010 tests across 99 suites; a real full run in session 65 measured 2010 across 100. The test count was right and the suite count was one low.** v10 also locked the `indeterminate` UX (section 4.6, new), corrected `hasSelfRepresentedParty` to be extractable in one direction, added `data_form` to both listing catalogs, and STRUCK the SPIS as a catalog item on Mo's field evidence.

**What changed from v9, in one paragraph:** the filing pipeline stopped being a plan and became three modules. The load-bearing findings were both negative and both would have cost a build session each: `googleapis` calls `.pipe()` on a non-string `media.body`, so a raw `Buffer` throws before any HTTP request and needs `Readable.from`; and `googleapis-common` has been setting `retry: true` on every Google call in this codebase all along, except that gaxios does not retry POST, which is exactly what Drive folder creation and upload are. Filing was also given a durable record that does NOT depend on the Gmail label, because that label fires a message's one shot before any downstream work has succeeded. Nine filing decisions were locked from Mo's answers, of which the two that shape the most code are that unmatched attachments do NOTHING (making matching a gate rather than a router) and that the transaction folder is created at deal-open with whatever is known and never renamed.

**Status (historical, v9):** **THE RESOLVER HAS A PRODUCTION CALLER AND THE TC WRITES TO DISK. Section 4.3 is BUILT, not designed. Sections 2, 7.4, 7.6, 14 and 18 are amended.** v9 drafted session 64 (2026-08-13), which closed the fact-storage blocker end to end: the fact writer, the item writer, the per-person satisfaction writer, the read path, the close path wired to the checklist it resolves itself, and three CLI verbs. Ten commits: `852fcd6`, `6762e9c`, `ac31973`, `5c26081`, `1c27795`, `b73c7e8`, `7ff50da`, `75056de`, `3a073dc`, `b4838e0`. Tests 1880 to 2010 across 99 suites. v9 also locked the address on the envelope with an optional `unit`, the event vocabulary at eight kinds, names as person identifiers, two counts on the close record, the extractability boundary in 7.6, and a second deal-open trigger in section 2. v8 drafted sessions 62 and 63 **The LISTING IS NOW ITS OWN TRANSACTION TYPE. Section 3 is REDESIGNED and the sell-side overload is GONE. Section 4.2 is REWRITTEN.** v8 drafted sessions 62 and 63 (2026-08-12), which closed 7.45.1 by construction rather than parking it again: six transaction types, three state tables, the listing as the durable record with offers as siblings underneath it, the relist locked at ONE transaction on Mo's field evidence, 4.2's premise reversed, the universal spine split, an optional `listingId` linking an offer to its listing, and the FACT STORAGE shape settled in full (section 4.3). Six commits: `9ee2b5b`, `08ce3a6`, `00f81dd`, `26a4c37`, `f41fe06`, `939fa0b`. Tests 1825 to 1880. v7 drafted session 61 (2026-08-10), which reframed the close override into a general event log after recon found that nothing had ever gated closing, shipped the event envelope, the close payload builder, the transition service (the first TC module that writes to disk) and the open-transaction CLI (the first TC caller with a human on the other end), and produced the first real deal file in the product's history. v6 drafted session 60 (2026-08-07), which shipped catalog sections 5.4, 5.6 and 5.7, added STATE as a resolver argument, established that the resolver may FILTER for terminal items, and closed 5.6 as DELIBERATELY EMPTY. v5 drafted session 59 (2026-08-06), which settled PER-PERSON SATISFACTION for client-scoped items, separated APPLICABILITY from COMPLETION as distinct axes, amended Rule 1 from confirm-before-apply to APPLY AND NOTIFY with only outward-facing actions gated, folded in the three session-58 amendments (per-person satisfaction with shared evidence, the deposit as data rather than a capped rule, Form 400 and the Ontario Standard Lease as two obligations with `source` naming the authority), and shipped sections 5.1, 5.2 and 5.3 as real catalog data. v4 drafted session 56 (2026-07-28), which added the per-type INITIAL STATE SETS to section 3 (section 3 as locked in v3 enumerated edges but never said which states a transaction may be BORN in), fixed the suspension window from a single pair to an ARRAY, and shipped the state machine module. v1 drafted session 42 (2026-07-17). v2 drafted 2026-07-24. v3 drafted session 55 (2026-07-28), which closed the last three section-15 recon items, settled every open design question, and shipped the first line of TC code. **Sections 3, 4.1 and 5 are now LOCKED**, no longer proposals. All other sections carry decisions locked from chat. **The Stripe gate is REMOVED**: Stripe now comes after TC and the dashboard. Incorporation and E&O coverage are still required before this feature is SOLD, which was always the gate, and they block nothing about building it.

**Built so far:** `src/transactions/store.js` (`4554b72` session 55, moved to its directory by `980b74d` session 56), the per-agent transaction store; `src/transactions/states.js` (`16fbf87`, session 56), the section 3 state machines; `src/transactions/resolver.js` (`f37ecb6` and `e2a6d38`, session 57, extended by `cc0a272` and `ed427d2` in session 59), the section 4 checklist resolver; and `src/transactions/rules/` (sessions 57 to 60), the item catalog, with all four transaction types resolvable and **every section of the item catalog complete**. `resolver.js` was extended again by `f8d8e29` (session 60), which changed both public signatures to carry state. Everything is inert: nothing in `src/` or `scripts/` calls any of it. The move to `src/transactions/` was done while the store had zero callers, on the reasoning that section 13 lists ten TC modules and `src/content/` is the existing precedent for a feature that owns that many files. **NEW IN v7:** `src/transactions/events.js` (`237d4b7` and `673d89e`, session 61), the event envelope, actor vocabulary and close payload builder; `src/transactions/transitions.js` (`a64f45a`, session 61), the state write path and the log's first writer; and `scripts/open-transaction.js` (`89be93e`, session 61), manual deal-open with an explicitly required `baseDir`. **THE MODULES ARE NO LONGER INERT.** `transitionTransaction` calls the store and `states.js`; `open-transaction.js` calls both through its own testable core. `states.js` now has TWO non-test callers and `canTransition` has its first. **NEW IN v8:** `src/transactions/rules/sellerListing.js` and `landlordListing.js` (`08ce3a6`, session 62), the two listing catalogs. `states.js` gained two tables and `isValidState` (`08ce3a6`, `939fa0b`). `store.js` gained `listingId` validation and `LISTING_ELIGIBLE_TYPES` (`f41fe06`). `universal.js` was reduced to one item (`00f81dd`). `seller_sale` and `landlord_lease` were retabled as deal records (`26a4c37`). **NEW IN v9:** `src/transactions/facts.js` (`ac31973`), `src/transactions/items.js` (`5c26081`), `src/transactions/checklist.js` (`1c27795`, split by `b73c7e8`), `src/transactions/satisfactions.js` (`3a073dc`), and `src/transactions/rules/factKeys.js` (`ac31973`), the hand-maintained fact-key list. `scripts/set-fact.js`, `scripts/complete-item.js` and `scripts/satisfy-person.js` (`b4838e0`). `store.js` gained state validation against the type's state machine (`852fcd6`) and the required `address` plus optional `unit` (`6762e9c`). `events.js` grew from one event kind to eight and `buildCloseOutstandingPayload` gained `indeterminateCount` (`7ff50da`) and per-person completion (`75056de`). `transitions.js` no longer takes `items` as an option; it resolves the checklist itself (`7ff50da`).

**THE RESOLVER HAS A PRODUCTION CALLER (session 64).** `resolveTransactionChecklist(agentId, transactionId, opts)` in `src/transactions/checklist.js` reads a stored transaction and returns its resolved checklist; `resolveChecklistForTransaction(transaction)` is the pure half for a caller that already holds one. Facts, per-item completion state and per-person satisfaction all persist. Eight event kinds exist. `transitionTransaction` resolves the checklist itself at close, so the compliance record cannot be omitted by a caller who forgets to supply it.

**THE ARTIFACT THAT SHOULD DRIVE THE NEXT PHASE OF DESIGN.** A freshly opened `buyer_purchase` resolves to eighteen rows, twelve `indeterminate`. Three facts (`entityType`, `hasSelfRepresentedParty`, `conditions`) collapse all twelve to zero and leave five real obligations; `conditions` alone clears ten. **The distance between a useless checklist and a useful one is three questions.** Any surface that renders this should show the questions, not the unknowns: the resolver already attaches `pendingFacts` naming exactly what each indeterminate row is waiting on.

**For:** future Claude chats inside this Project, regardless of model. This is the authoritative design for the Transaction Coordinator, a priced add-on that manages the agent's deal file AFTER a client is signed, as distinct from the lead pipeline which manages everything BEFORE. If this doc and PROJECT_STATE ever conflict, the more recently dated one wins; otherwise this doc is authoritative for the transaction feature specifically.

**What changed from v4, in one paragraph:** the catalog stopped being a proof set and became real data, and two design questions that had been implicit got answered explicitly. Client-scoped items are satisfied PER REPRESENTED PERSON, because a couple signing one RECO Guide is one form and two satisfactions, and a checklist that cannot say which spouse is missing cannot represent the gap that actually occurs. That decision forced a second one: APPLICABILITY and COMPLETION are different axes, and routing per-person satisfaction through `reads` would have made the resolver say it did not know whether the Guide applied, which is false. Rule 1 was amended a second time, from confirm-every-field to apply-and-notify, on the reasoning that a confirmation gate which gets rubber-stamped is worse than no gate: values are applied and displayed freely, and only OUTWARD-FACING actions (a chase to a third party, a client one-pager, a deadline reminder) require confirmation. The deposit stopped being a rule the system enforces and became data it records. Form 400 and the Ontario Standard Lease were separated into two obligations, which settled that `source` names the AUTHORITY behind an obligation rather than the publisher of a form. Sections 5.1, 5.2 and 5.3 shipped.

**What changed from v5, in one paragraph:** the catalog finished, and finishing it was mostly SUBTRACTION. Section 5.4 shipped as eight condition items on a single `conditions` fact, with the dates and the statutory status certificate clock deliberately left out of a resolver that has no clock. Section 5.6 emptied completely: every closing bullet the spec had guessed at turned out to be a brokerage task, a date field, an optional contact reference, or a soft nudge the resolver has no vocabulary for. Section 5.7 reduced to one item. The one structural change is that STATE is now a positional argument to both resolver functions, and `terminalOnly` items are ABSENT from the resolved set rather than not-applicable, which makes the resolver filter for the first time. Two new universal facts about the product came out of it: the deal sheet is the first universal item whose authority is the brokerage rather than a regulator, and the commission review is the moment the whole feature exists to pre-empt.

**What changed from v2, in one paragraph:** the state machines are enumerated and locked (no wildcards, listing suspension added, a missing landlord collapse path fixed), the checklist gained two lifetimes and three evidence kinds, FINTRAC was reclassified from a document class to an external system after Mo confirmed those records live only in Fintracker, the relist boundary was set at the AGREEMENT rather than the property, form generation was declined on OREA licensing grounds while storage and pre-fill were kept, and the Stripe gate was removed. The recon that closed sections 15.2 through 15.4 also reshaped the build order: extraction model tier turned out to be downstream of two missing plumbing pieces, and deal-open detection has a one-shot-per-message constraint nobody had noticed.

**What changed from v1, in one paragraph:** v1 was a checklist with a filing pipeline. v2 is an email-driven deal assembler. The system already reads every inbound email for lead intake; v2 extends that stream to detect deal-open events, pre-assemble the entire transaction (property, participants, conditions, dates with source evidence), propose completions when clearing documents arrive, and draft the chase emails a human assistant would send. Rule 1 was amended from "the AI never reads a date" to "the AI never commits a date," which is the change that makes all of this possible without changing the liability posture. The product positioning also changed: this feature is the centerpiece of the "replace the desk half of a $3,000 to $5,000 per month assistant" pitch, not a compliance checkbox tool.

---

## 0. The problem and the product vision

### 0.1 The problem in one sentence

An agent with several deals in flight has no single place that knows what each deal is still waiting on, so things get missed, and the things that get missed most are the small ones (leases) because the commission does not justify the attention.

### 0.2 The vision in one sentence

The agent forwards nothing, files nothing, and types almost nothing: the deal file assembles itself from the email stream the system already reads, and the agent's job reduces to confirming what the system proposes.

### 0.3 The demo moment

An accepted APS arrives in the agent's inbox. Within one orchestrator cycle, the system proposes a fully assembled deal file: property identified, transaction type detected, participants cast into roles from the thread, conditions detected, every date extracted and displayed next to the contract clause it came from, Drive folder created, document filed. One screen, one confirm. This is the moment that sells founding agents, and every build decision below should be tested against whether it protects or dilutes it.

### 0.4 Positioning: the assistant replacement

A full-time licensed or unlicensed assistant in the GTA costs roughly $45,000 to $60,000 per year plus payroll costs, which is $3,750 to $5,000 per month. The GetKlosed full stack (Starter $500 + Content Engine $300 + Transaction Coordinator $250) is roughly $1,050 per month. The honest pitch: "the desk half of an assistant, for a quarter of the cost, and it never takes a sick day." Say out loud what it does not replace: showings, staging errands, open houses, in-person work. "Keep the runner, fire the desk" is a stronger claim than overpromising, and overpromising is the single fastest way to lose an agent in a small community.

### 0.5 Competitive context (snapshot 2026-07-24, re-verify before major pivots)

AI contract reading is now baseline in the TC software category, not a differentiator. ListedKit (AI assistant "Ava") extracts dates, parties, and terms from purchase agreements in minutes and advertises Canada-specific contract training. DocJacket extracts contract data and drafts communications for human approval. Dotloop, SkySlope, and Open To Close lead on brokerage-grade document management and compliance but require manual data entry. Two structural gaps remain across the entire category, and they are GetKlosed's differentiators:

1. **Nobody owns the agent's outbox.** Every competitor is a checklist that reminds the agent. None of them can chase the lawyer, nudge the mortgage broker, or update the client, because they do not send email as the agent. GetKlosed already does, with a per-agent voice profile and Shadow Mode. Section 8 is the feature no competitor can copy without rebuilding their product.
2. **Nobody knows Ontario.** The US platforms will never build a RECO Information Guide acknowledgement checkbox, a FINTRAC Receipt of Funds predicate, or an Ontario Standard Lease item. Section 5 is a compliance moat.

## 1. The liability posture (read this before anything else)

This is the section that constrains every other section. Lead follow-up failing means a missed email. Transaction coordination failing means a missed condition, a collapsed deal, a RECO complaint, and an E&O carrier looking for someone to point at. The economics are brutally asymmetric: we capture an add-on fee per month, we sit next to a five-figure commission and a client's housing.

An engagement-letter limitation of liability binds the agent who signed it. It does not bind the buyer, the seller, the brokerage, or RECO, none of whom signed anything with us. The contract is necessary and insufficient. Three things actually reduce exposure, and the third is the one that lives in this doc:

1. Incorporate. (Not an engineering task. Blocking for launch of this feature, not for the build.)
2. E&O / tech liability coverage. (Same.)
3. **Design so the AI is never the sole custodian of a deadline.** This is free, and it is the real protection.

Three hard rules follow, and nothing in this spec may violate them.

### 1.1 Rule 1 (AMENDED v2): the AI never COMMITS a deadline

v1 said the AI never infers a deadline and the agent types every date by hand. That rule protected the right thing with the wrong mechanism, and it shipped a product behind the category baseline (section 0.5). The amended rule:

**The AI extracts and pre-fills every date, but each extracted date renders next to the verbatim clause text it came from, and no date exists in the system until the agent confirms it, field by field, against the source document.**

Why this is safer than typing, not merely faster:

- Manual transcription has its own error rate. An agent fat-fingering 14 into 24 produces a wrong date with zero evidence trail.
- An extracted date confirmed against a displayed excerpt produces a per-date audit record: agent confirmed "irrevocable until 11:59pm on July 14" against clause text X at timestamp Y. That is a materially better E&O story than "the agent typed something."
- The confirmation is per field, never a bulk "accept all." A bulk accept recreates the original risk in one click and is banned.

Implementation constraints that are part of the rule, not optional polish:

- Every extracted date persists with `{value, sourceExcerpt, sourceDocumentId, extractedAt, confirmedBy, confirmedAt}`. An unconfirmed date renders as PROPOSED everywhere it appears and is never used to compute a reminder.
- If extraction fails or confidence is low, the field renders empty with the document page reference, and the agent types it. Falling back to v1 behaviour is always acceptable; silently guessing is never acceptable.
- The extraction call is best-effort. A failed extraction never blocks deal-open; it degrades to manual entry.

#### 1.1.1 Rule 1 AMENDED AGAIN (v5): apply and notify, gate the outward-facing action

The v2 amendment required per-field confirmation before an extracted date entered the system. Mo pushed back in session 59 with a workflow objection that turned out to be a safety argument: an agent facing ten fields taps confirm on all ten without reading them, and the system has then collected an attestation that means nothing while telling itself the value was verified. **A confirmation gate that gets rubber-stamped is worse than no gate**, and it is the same reasoning that banned bulk accept in the first place.

The line moved, and it now falls here:

**A value may be APPLIED and DISPLAYED without confirmation. It may not be ACTED ON OUTWARDLY without one.**

- **Applied** means the extracted closing date goes into the deal, renders on the checklist, and the agent sees a notification naming what changed: "closing date changed from Sept 15 to Oct 1" with a correct-this affordance. No gate.
- **Acted on outwardly** means a chase email to a lawyer citing that date, a client-facing status one-pager, or a deadline reminder. None of those fire off a value nobody has looked at. At that point the system is not displaying a date, it is ASSERTING one to a third party, and a wrong extraction reaches the agent via someone else.

This preserves what Rule 1 was actually protecting. Rule 1's concern was the AI COMMITTING a deadline, not the AI showing one.

Three implementation constraints survive the amendment unchanged, and they are what make it safe:

- **The source excerpt still renders next to the value.** This is what makes correcting cheap rather than another verification task. The agent glances at the clause the number came from instead of opening the PDF.
- **Unconfirmed values are marked visibly**, as a state rather than a blocker. The agent opening the deal and glancing at flagged fields IS the confirmation, happening as a byproduct of normal work rather than as a gate in front of it.
- **The per-date evidence record is unchanged.** `{value, sourceExcerpt, sourceDocumentId, extractedAt, confirmedBy, confirmedAt}` still persists; `confirmedBy` and `confirmedAt` are simply null for longer.

**Price is treated as a date for this purpose**, not because it is a deadline but because it feeds commission and the client one-pager, so it carries the same outward-facing exposure.

**One case still PROPOSES rather than applies: a name coming off the deal.** A wrong date displayed is recoverable at a glance. Quietly dropping a person from `representedPersons` re-resolves the checklist underneath the agent and changes what the compliance items ask for. There is also a genuine ambiguity that extraction cannot settle: an amendment removing a name may mean the person is off the deal, or it may mean title is being taken differently while they remain a client. Those want different responses.

### 1.2 Rule 2: the AI proposes, the agent confirms

Filing, checklist completion, state changes, deal-open, participant casting, chase emails, and client communications are all suggestions until the agent accepts them. This is Shadow Mode applied to the deal file, and it is the same trust mechanism that makes HOT_SMS_CONFIDENCE_THRESHOLD work: the moment an automated assertion stops meaning something, the agent stops reading them. Rule 2 is the load-bearing rule; Rule 1's amendment is safe precisely because Rule 2 exists.

### 1.3 Rule 3: assistant on top of the brokerage deal file, never the system of record

The brokerage remains the system of record for compliance. We are the thing that tells the agent what the brokerage is about to chase them for. Product copy must never imply otherwise, and the digest wording must not imply completeness we cannot guarantee.

The pitch that survives all three rules: "never let a deal fall through because someone forgot." The pitch that does not: "we are your compliance system of record."

## 2. Scope boundary: when a transaction exists

A transaction opens when the agent has a signed engagement to work a specific property or a specific accepted agreement. Before that, the contact is a lead, and the lead pipeline already handles it.

This boundary is load-bearing. Earlier review documents proposed lifecycle states named `Draft` and `Searching`. Those are not transaction states, they are the lead pipeline's status column wearing a costume. Building them here would duplicate a working state machine and split the truth about a contact across two systems.

Open triggers, per type:

| Type | Opens at | Rationale |
|---|---|---|
| `buyer_purchase` | Accepted APS | Before acceptance, it is a lead being shown properties. |
| `seller_sale` | Listing agreement signed | The agreement is the engagement; work starts immediately. |
| `tenant_lease` | Accepted Agreement to Lease | Mirrors buyer side exactly. |
| `landlord_lease` | Listing agreement signed (lease) | Mirrors seller side exactly. |

The asymmetry is real and intentional: the representation side (seller, landlord) opens at engagement because the work starts there, and the acquiring side (buyer, tenant) opens at acceptance because everything prior is search, which the lead pipeline owns.

**Deliberately excluded from v1:** offer-submitted / irrevocable-running tracking on the buyer side. It is a real deadline but it runs in hours, the agent is glued to their phone for it, and it is not a coordination problem. If an agent asks, revisit.

**A lead links to a transaction, it does not become one.** The lead row keeps its identity and gains a `transactionId` reference. This preserves the existing sheet contract and lets a repeat client have three transactions over six years against one lead row.

**A SECOND DEAL-OPEN TRIGGER (session 64, Mo's field evidence): the deposit sometimes arrives before the agreement.** This section and 7.4 both assume an accepted APS is what opens a deal. Mo's department sometimes receives the deposit first. On a deposit-first deal the first thing the system sees is money, and the transaction opens with every fact absent and the whole checklist `indeterminate`. Nothing in the storage model breaks, because facts arrive independently and the checklist re-resolves on every read, but **detection has TWO triggers rather than one and the calibration fixture set must contain the deposit-first shape**, not only accepted instruments.

## 3. Transaction types and states (LOCKED session 55, REDESIGNED session 62)

**SECTION 3 WAS REDESIGNED IN SESSION 62. The modelling problem opened in session 61 is CLOSED, and it was closed by splitting the record rather than by splitting the field.**

The problem, restated so the fix reads as a fix: the sell-side `state` field carried TWO lifecycles at once, a listing and a deal. That is why `conditional -> live` read as the deal recovering and `firm -> collapsed` read as the whole file dying, and neither was what actually happens.

**The resolution came from Mo's brokerage practice, not from the spec's own reasoning.** Asked what SkySlope does, Mo: the offer and the listing are separate files; the listing paperwork transfers to the offer paperwork; if the offer falls through the listing is active again and the listing transaction is still there. So the LISTING is the durable record and OFFERS come and go underneath it.

**Six types, not four.** Two new listing types; the four existing types keep their names and become pure deal records.

| Type | What it is |
|---|---|
| `seller_listing` | the sell-side engagement |
| `landlord_listing` | the lease-side engagement |
| `seller_sale` | one accepted offer on a `seller_listing` |
| `landlord_lease` | one accepted lease deal on a `landlord_listing` |
| `buyer_purchase` | unchanged, opens at the deal |
| `tenant_lease` | unchanged, opens at the deal |

**Three state tables, not four, and they got SIMPLER.** The two listing types share one table. The two purchase-side deal types share `buyer_purchase`'s table verbatim. The two lease-side deal types share `tenant_lease`'s table verbatim.

**THE THREE APPARENT MISSING EDGES NOW EXIST BY CONSTRUCTION.** `seller_sale conditional -> collapsed`, and `landlord_lease` collapsing from `accepted` and from `signed`, were symptoms of the overload and v7 correctly said they must not be added individually. Adopting the deal tables cures the disease; the edges arrive with the table.

**AND THE THREE RESUME EDGES VANISHED.** `conditional -> live`, `tenant_selected -> live` and `signed -> live` were the old model straining to express a LISTING decision through a DEAL field. Under the split the deal collapses, terminal, and the listing was `live` the whole time. There is nothing to resume. `tenant_selected` disappeared entirely: it was the landlord-side name for `accepted`.

**Suspension lives on the listing types only** (3.6). Buy and tenant sides have nothing to suspend, and neither do the deal records now.

**`terminated` lives on the listing types only.** v7 explained why buy-side had no `terminated` in terms of the section 2 scope boundary: sell-side opened at the ENGAGEMENT and so carried a pre-deal phase in which the engagement itself could die. That reasoning is intact and now lands in the right place. The engagement is the listing record.

**What this did to the scope axis: NOTHING, and that is the payoff.** An earlier proposal in session 62 was a third `scope` value, `listing`. It proved unnecessary. The RECORD TYPE does the partitioning: an item declared in a listing catalog is a listing obligation, an item in a deal catalog is a deal obligation. `scope: client | transaction` survives untouched, and `transaction` keeps meaning "this record" whether the record is a listing or a deal.

**AUTO-CLOSE: section 3's "the AI never applies a transition" is AMENDED.** That absolutism was locked in session 55 and predates the session-59 amendment of Rule 1 to apply-and-notify. Closing a listing whose deal just closed is not outward-facing: nothing is sent, nobody is chased. So it APPLIES, logs as `system`, and the agent sees it. Agent-initiated termination of a listing remains an agent transition with confirmation. The general rule stands for everything outward-facing; this is one carve-out with a stated reason, not a loosening.

All four types ship in v1. The argument against staging them dissolved once the checklist became resolver-driven (section 4): a fourth type is a data file, not code.

**Leases ship in v1 and are not an afterthought.** Mo's rationale: leases are high volume and low commission, so agents track them worst precisely because each one does not justify the attention. That is an underserved workflow with a high forget-rate and effectively zero competition, because nobody builds for the small deal. It is a wedge inside the wedge, and a lease agent who trusts the system across twelve small deals hands over their purchase deals.

States are agent-owned. The AI may recommend a transition and surface it in the digest; it never applies one.

**Type and subtype are both agent-mutable and both trigger re-resolution (4.1).** An agent who opened a file as the wrong type must be able to fix it without losing work.

**No wildcards. Every edge below is enumerated.** An `any -> X` shorthand silently includes terminal-to-terminal and self edges, breaking the invariant that terminal states have no outgoing edges, and it is only correct until someone adds a state, with nothing enforcing that. `states.js` transition validation needs the real list.

**Why buy-side has no `terminated` and sell-side does, recorded so it does not read as an oversight.** It falls out of the section 2 scope boundary. Sell-side transactions open at the ENGAGEMENT (listing agreement), so they carry a pre-deal phase in which the thing that can die is the engagement itself: that is what `terminated` means. Buy-side transactions open at the DEAL (accepted offer or Agreement to Lease), so a deal exists by definition at open and collapse is the only failure mode available. A buy-side `terminated` would describe ending a client relationship with no transaction attached, which is a lead-pipeline event, not a TC state. The client-scoped items survive that ending through the relink in 4.1, which is the correct mechanism for it.

**Initial states are a SET per type, not a single value (LOCKED session 56).** The edge
tables below say how a transaction MOVES; they do not say where it may be BORN. Those are
different questions and v3 answered only the first. A transaction may open in any state
listed as initial for its type, and in no other:

| Type | Initial states |
|---|---|
| `buyer_purchase` | `conditional` \| `firm` |
| `seller_sale` | `conditional` \| `firm` |
| `tenant_lease` | `accepted` |
| `landlord_lease` | `accepted` |
| `seller_listing` | `preparing` \| `live` |
| `landlord_listing` | `preparing` \| `live` |

`buyer_purchase` opens at `firm` when the accepted offer carried no conditions, which 3.1
already said.

**Sell-side opens at `live` because of ONBOARDING, and this is the case that forced the set.**
An agent signing up with GetKlosed already has listings on MLS. Forcing those files to open at
`preparing` and immediately transition to `live` writes a transition into the file that never
happened, and any clock keyed to file creation then counts prep days that are fiction. The
alternative, refusing to track those listings at all, loses exactly the deals a new agent most
wants tracked in their first month. Mo confirmed importing already-live listings is how an
agent would realistically start.

**Opening at `live` does not skip the prep checklist, and that is deliberate.** The resolver
produces required items independent of state (section 4), so a listing imported at `live` still
resolves the listing agreement, the data form, and the SPIS as required and incomplete. The
agent gets asked whether those documents exist. That is the product working, not a gap.

**The set is deliberately no wider than this.** An agent joining mid-deal with an already
`conditional` sale is also real, but a file born at `conditional` carries irrevocable, condition,
and closing dates the system never extracted and the agent never confirmed against evidence,
which is Rule 1 territory. Importing mid-flight deals, if it ships, should be an explicit import
path that marks the file's early history as unverified, NOT a quietly widened initial-state set.
Widening the set later is cheap; un-widening it once files exist in those states is not.

### 3.1 The two LISTING types: `seller_listing` and `landlord_listing`

One table, shared:

`preparing` -> `live` -> `closed` (terminal)
`live` -> `suspended` -> `live`
`preparing` | `live` | `suspended` -> `terminated` (terminal)

`closed` means a deal under this listing closed. `terminated` means the engagement ended without a sale or lease: expired, cancelled, or withdrawn.

**`suspended -> terminated` is a DIRECT edge, added deliberately in session 62.** Routing it through `live` would work, and 3.4's `signed -> live -> terminated` is precedent for two-transition endings. It was rejected here because a suspension often ends BECAUSE the seller is done, not because the property is going back to market, and passing through `live` writes a return-to-market that never happened. That is the same objection that made `live` an initial state.

**A listing terminated from suspension ends with its last suspension window OPEN**, `resumedAt: null`, permanently. That is correct and must not be tidied: writing a `resumedAt` would record a resumption that never happened. 3.6's second invariant (`state === 'suspended'` iff the last window is open) holds during the listing's life; a listing terminated from suspension is the one permitted resting place with an open window. Any elapsed-time consumer must handle an open window on a terminal file without treating the clock as still running.

### 3.2 The two PURCHASE deal types: `buyer_purchase` and `seller_sale`

One table, shared. `seller_sale` adopted `buyer_purchase`'s table verbatim in session 62.

`conditional` -> `firm` -> `closed` (terminal)
`conditional` | `firm` -> `collapsed` (terminal)

Opens directly at `firm` when the accepted offer carried no conditions.

`seller_sale` no longer has `preparing`, `live`, `suspended` or `terminated`. Those are listing states.

### 3.3 The two LEASE deal types: `tenant_lease` and `landlord_lease`

One table, shared. `landlord_lease` adopted `tenant_lease`'s table verbatim in session 62.

`accepted` -> `signed` -> `possession` -> `closed` (terminal)
`accepted` | `signed` | `possession` -> `collapsed` (terminal)

`accepted` is the Agreement to Lease. `signed` is the executed Ontario Standard Lease, which is a separate instrument and a separate item (section 5.5). `possession` is keys delivered.

`possession -> collapsed` stays enumerated even though a post-keys collapse is exotic (lease voided, fraud). It costs nothing and avoids a file with no exit if it ever happens.

**`tenant_selected` is GONE.** It was the landlord-side name for `accepted` and had no independent meaning once the listing lifecycle moved off this type.

### 3.4 Refusal reasons are three distinct branches, and they are pinned

`canTransition` refuses for three different reasons and session 63 pinned all three, after a near-miss worth recording. The instruction written for that commit said to assert `seller_sale conditional -> live` refuses with the no-such-edge reason. That is FALSE: `live` is not a state of `seller_sale` at all any more, so it hits the not-a-valid-state branch. CC caught it. Asserting the weaker reason would have pinned an untrue account of what the split did.

- **not-a-valid-state**, the accurate claim for the split-eliminated transitions: `live` did not lose an edge, it left the type.
- **no-such-edge**, both states real, no edge between them.
- **terminal-state**, no outgoing edges from a terminal state.

The same trap applies to `tenant_selected -> live`: the FROM state is gone, so that is a not-a-valid-state case too, and the honest assertion is that `getStates('landlord_lease')` does not contain `tenant_selected`.


### 3.6 Listing suspension (`seller_listing` and `landlord_listing` only, MOVED session 62)

`live` -> `suspended` -> `live`, non-terminal in both directions, plus the direct `suspended -> terminated` added in 3.1. Deal records have nothing to suspend; neither do the buy and tenant sides.

**Session 63 recon: the suspension window is entirely DESIGN-ONLY.** `grep` for `suspensions`, `suspendedAt` and `resumedAt` across `src/`, `scripts/` and `tests/` returns zero hits. Everything below is specification with no implementation behind it, which is why moving suspension between types cost nothing outside `states.js`.

**Why this is modelled despite being rare.** Mo's read is that suspensions happen, not very often but not uncommon. That is precisely the frequency that makes an unmodelled state dangerous: rare enough that nobody builds for it, common enough that an agent hits it, and when they do the system has no honest answer and starts drifting from reality on a live file.

**Suspension freezes the clocks, not just the label. This is the load-bearing half.** A suspended listing that keeps counting days on market, keeps firing chase cadences, and keeps nagging about an expiry that is itself suspended is worse than not modelling suspension at all, because the system is now confidently wrong rather than merely silent. The state carries a suspension window (`suspendedAt`, `resumedAt`), and every time-driven consumer reads elapsed-excluding-suspension rather than raw wall clock.

**Suspension is the same agreement, so it is the same record** (see 4.2). A suspension that outlives its own listing expiry is genuinely ambiguous, and the system surfaces it for an agent decision rather than transitioning on its own. That is Rule 2 doing exactly what it exists for.

**The window is an ARRAY, not a single pair (CORRECTED session 56).** v3 wrote the state as
carrying `suspendedAt` and `resumedAt`, singular. A listing suspended twice is not exotic in
the way `possession -> collapsed` is exotic, and with a single pair the second suspension
silently overwrites the first, at which point the clock is wrong in the confidently-wrong way
this whole section exists to prevent. The shape is:

```
suspensions: [ { suspendedAt, resumedAt } ]
```

with `resumedAt: null` on the open window. Two invariants: at most one open window, and
`state === 'suspended'` if and only if the last window is open. Elapsed-excluding-suspension is
then a sum over closed windows plus the open one, which is the same arithmetic a single pair
would have needed anyway.

**The elapsed-time helper is NOT in `states.js` and that was a deliberate call.** Session 56
recon found three separate day-difference implementations already in the repo (`digest.js:280`,
`leadIntake.js:277`, `content/cache.js:163`) plus two week-math ones, with `src/time.js`
holding only a now-source and no elapsed helper at all. Writing the suspension clock inside
`states.js` would have made a fourth copy and would have put a clock inside a module whose
whole value is being pure. The clock-freezing helper is its own later commit, and it should
either extend `time.js` or extract a shared day-diff rather than add to the pile.

### 3.5 Property subtype

Orthogonal to type, set at open, drives resolver rules: `freehold` | `condo` | `other`. Condo is the one that matters (section 5.4).

## 4. The checklist resolver (the architectural core)

**This is the whole feature.** Everything else, including the v2 assembly pipeline, is plumbing that feeds it.

The checklist is not four static templates. It is a pure function:

```
resolveChecklist(transaction) -> ChecklistItem[]
```

resolving over `(type, side, entityType, propertyType, hasSelfRepresentedParty, hasConditions, depositRecipient, ...)`.

The reason this must be an engine and not templates came from the FINTRAC side: the applicable FINTRAC records differ by side and by entity type within a single transaction type. If items are conditional within a type, no type can have a static template, so the engine is mandatory. Given the engine, adding a type costs a data file.

**Properties:**

- Pure. No I/O, no clock, no Claude call. Fully unit-testable, hermetic.
- Rules are declarative data, not branching code. Each item carries a `requiredWhen` predicate.
- **Every item carries a `source` field**: `TRESA` | `FINTRAC` | `RTA` | `APS` | `brokerage` | `agent`. This is not decoration. When the resolver hides an item, the agent must be able to ask why it is not there and get an answer. Silent absence is the same failure class as a silent catch-all swallow: the system quietly did nothing and nobody knows.
- Items the resolver excludes are not deleted from the UI, they are rendered as not-applicable with the reason. An agent who cannot see that FINTRAC was correctly skipped on a lease will assume the system forgot.

### 4.1 Re-resolution on fact change (the sharp edge)

The agent opens a transaction as `tenant_lease`, later corrects the type to `buyer_purchase`. Four FINTRAC items must appear. Completed items that survive the change must NOT be reset.

Contract:

- Re-resolve produces the new applicable set.
- Items present in both old and new sets keep their completion state and any linked documents.
- Items only in the new set arrive incomplete.
- Items only in the old set are marked `no_longer_applicable`, retaining their completion state and documents. **They are never hard-deleted.** A completed item with a filed document that vanishes because the agent fixed a typo is a data-loss bug that looks like a feature.

This transition is the piece most likely to be subtly broken and is a mandatory break-the-fix target.

**Re-resolution also fires on:** type or subtype change, every non-terminal state transition listed in section 3 (including both suspension edges), and the arrival of a confirmed fact that a `requiredWhen` predicate reads.

### 4.1.1 Two item lifetimes (LOCKED session 55)

The checklist has items with two different lifetimes and the original resolver modelled only one. Some items are per-TRANSACTION: the APS, the conditions, the deposit records. They are born and die with the deal. Others are per-CLIENT-RELATIONSHIP: the RECO Information Guide, the representation agreement. When a buyer's conditional deal collapses and they open a new transaction three months later, re-presenting the Guide and re-signing a representation agreement is wrong, and to the agent it reads as the system forgetting the client.

Catalog items therefore carry `scope: transaction | client`. Client-scoped items split further:

- **`clientScope: event`** satisfied once, forever. The RECO Information Guide was provided and explained; that happened, and it does not un-happen. It inherits to every future transaction with that client.
- **`clientScope: dated`** carries a validity window. A representation agreement resolves satisfied only if today falls inside the window of the most recent agreement, and resolves incomplete-and-required if it has lapsed.

Lapsed agreements are RETAINED as linked history, never hard-deleted, same principle as the item rule above. The resolver reads the most recent window.

**Buyer/tenant `collapsed` is terminal-with-relink.** The transaction ends, and the client-scoped items survive on the client through the `transactionId` linkage back to the lead row. This is deliberately NOT a resume edge like seller's `conditional -> live`, because there is no engagement left to resume on the buy side (section 3).

**The listing agreement is `scope: transaction`, the buyer representation agreement is `scope: client`, and they are NOT mirror images despite sounding parallel.** A listing agreement is property-specific: that address, that term, that price. It cannot inherit to the seller's next listing. A buyer representation agreement is client-specific and covers any property in an area for its term. Same split on the lease side: the landlord's authority to lease is transaction-scoped, the tenant representation agreement is client-scoped. This is written out explicitly because "seller rep agreement" and "buyer rep agreement" sound parallel enough that a future reviewer will try to give them the same scope.

**Client-scoped satisfaction is PER REPRESENTED PERSON, and the evidence is SHARED (LOCKED session 58, built session 59).** This amends "satisfied once, forever" to "satisfied once PER REPRESENTED PERSON, forever." A couple can sign their names on the same RECO Guide: the obligation runs to each person the agent represents, but it does not require a separate form each. So one form, N signatures, N satisfactions.

**The payoff is a gap nothing else can see.** If the agent represents two people and only one signed, the item is complete for one and incomplete for the other, and the checklist can say so by name. A per-deal or per-set model cannot represent that. It matters most when a spouse is added partway through, after the first has already signed. An earlier proposal to attach satisfaction to the SET of people named on the instrument was rejected for exactly this reason.

**Identity is the PERSON, not the household.** A household entity was rejected because it requires the agent to declare households, which is data entry, and the product's premise is that the agent types almost nothing. It also survives messy endings that a household record does not.

**THE IDENTIFIER IS AN OPEN DECISION WITH A KNOWN TRAP.** The resolver treats a person identifier as an opaque string and never interprets one. Email is the obvious choice, because column A already keys on it and it is the only stable human identifier the system currently holds. **Email is WRONG.** Spouses routinely share one inbox, so email-as-identity collapses two represented people into one, which is precisely the case this design exists to catch. This decision belongs to whoever builds participant discovery (section 6.1), with that constraint attached.

**How it renders: ONE ROW PER DOCUMENT.** Mo's brokerage practice, and the design follows it. Admins see one line for the instrument, mark it incomplete when a signature is missing, and leave a note explaining why. The per-person data is EVIDENCE UNDERNEATH the row, not a display shape. An earlier proposal to expand one catalog item into N resolved instances was rejected on this ground: two rows for one piece of paper is wrong by the workflow it is meant to serve.

**As built (`ed427d2`, session 59).** Two optional facts, `representedPersons` (an array of identifiers) and `clientSatisfactions` (keyed person, then item id, each value an opaque record the resolver never reads inside). Client-scoped `event` items gain two output fields, `satisfiedPersons` and `outstandingPersons`, partitioned in input order with no deduplication. Three rules are load-bearing:

- **Absent `representedPersons` emits NEITHER field.** Not empty arrays. An empty `outstandingPersons` reads as "nobody is outstanding", which is a claim the system was never given the facts to make. This is the session-49 failure class (asserting an unobserved fact) applied to a compliance record.
- **An empty array is a DIFFERENT, real answer**, meaning "we were told there is nobody." Callers must use absent, never `[]`, to mean unknown. This mirrors the existing rule that `null` counts as PRESENT for a declared fact.
- **Neither field is carried forward by `STATE_FIELDS`.** They are resolver-derived and recomputed on every resolve. A stale `outstandingPersons` surviving a re-resolution is exactly the bug the explicit copy-forward exists to prevent.

**`clientScope: 'dated'` is deliberately NOT covered.** Evaluating a validity window requires a date, and this resolver has no clock by design (no requires at all). That is its own commit and the clock question deserves settling on its own terms rather than inside a per-person change.

**A fourth `STATE_FIELDS` entry, `note`, shipped alongside it (`cc0a272`, session 59).** The note is agent-authored and the resolver never writes it. It is what carries "missing Sarah's signature", and it is what makes the resolve-versus-satisfy split below work at all: without somewhere to record WHY something satisfied an item, the deal file cannot explain itself.

**OPEN, deliberately not guessed:** the ordering dependency between the RECO Guide and the representation agreement. The rep agreement establishes who is represented, and the Guide obligation attaches to represented persons.

### 4.1.2 Date extraction is live everywhere except deal-driving deadlines

All extracted dates are live and editable with NO confirmation gate, with one exception: Rule 1's per-field confirmation applies to DEAL-DRIVING DEADLINES only, meaning irrevocable, condition, and closing dates.

The `clientScope: dated` expiry is deliberately outside the gate. It is a relationship-freshness hint, not a deal deadline; agents usually close well before a representation agreement lapses; and the brokerage remains the compliance system of record per Rule 3. A misread expiry is therefore a tracker error, not a filing error. **Do not re-add the confirm gate here.** It was considered and rejected with this reasoning.

### 4.1.3 Three kinds of evidence (LOCKED session 55)

Items carry `evidence: document | attestation | external_system`.

- **`document`** is backed by a filed instrument. Completion detection can fire from the email stream.
- **`attestation`** has no artifact at all. The agent confirms it; there is nothing to file and nothing to extract.
- **`external_system`** is an attestation whose record lives in a named third-party tool, carried as `external_system: <name>`.

**Chase drafting must never chase a third party for a document that does not exist.** An item with no `document` evidence produces a nudge to the agent and nothing else. That is the whole reason this field exists rather than being inferred from whether a file happens to be attached.

### 4.2 One transaction equals one continuous engagement (REWRITTEN session 62, replaces the v7 agreement-boundary rule)

**The v7 rule was: the boundary is the AGREEMENT, so a terminate-and-relist is a NEW transaction with the prior linked as history. That is now REVERSED, on field evidence.**

Mo, describing how his brokerage actually files it: a cancellation and a new listing agreement both get uploaded to the SAME transaction, and the MLS number is updated. Only the listing agreement does not carry over. The data form, the client identification, the property, the seller: all continuous. Just the dates, maybe the price, and the MLS number change.

**The new rule.** A transaction is scoped to a continuous engagement with one client on one property. Successive instruments within it are dated and filed.

- **Extension or amendment:** SAME record. Unchanged from v7.
- **Suspension then resume:** SAME record. Unchanged from v7.
- **Cancellation then relist under a new listing agreement:** SAME record. Both instruments are filed, the cancellation form dates the boundary, MLS number and dates update, re-resolution fires, completed items survive. **This is the reversal.**
- **A genuinely different property, or a different client:** new record.

**Why v7's commission reasoning does not survive.** v7 said two agreements in one transaction makes the file ambiguous about which one governs, and that the ambiguity sits next to the money. The premise is false in practice: the cancellation form resolves the ambiguity on paper, which is how the brokerage already reads it. And Rule 3 says the brokerage is the system of record, so a model that splits the record to answer a question the brokerage already answers on paper is the system appointing itself an authority it does not have.

**Reconciling with session 61, so v8 does not read as drift.** Session 61 recorded Mo confirming that terminate-and-relist is a NEW LISTING AGREEMENT. That confirmation was about the INSTRUMENT and it was correct. The leap from "new instrument" to "new record" was the spec's, never checked against how the file is kept. Session 61's finding survives intact; only the inference fails.

**The rule that keeps this consistent with offers being siblings.** A relist produces a record with IDENTICAL CONTENT: same property, same seller, same data form, only the instrument and the MLS number change. An offer produces a record with GENUINELY DIFFERENT CONTENT: different buyer, price, conditions, dates. Proliferating near-identical records is noise; proliferating genuinely distinct records is history. That is the same principle behind never shrinking `conditions`.

### 4.1.4 Applicability and completion are DIFFERENT AXES (LOCKED session 59)

This is the decision that kept per-person satisfaction from corrupting the resolver, and it is easy to get wrong in a way that looks reasonable.

- **`reads` and `requiredWhen` govern APPLICABILITY.** Does this item apply to this deal at all? Answers are `required`, `not_applicable`, or `indeterminate`.
- **Per-person satisfaction governs COMPLETION.** Who has cleared it?

The RECO Guide declares `reads: []` and always resolves `required`. Adding `representedPersons` to its `reads` would have been the natural-looking move, and it would have made an unentered client list resolve the Guide as `indeterminate`, which asserts that the system does not know whether the Guide applies. **That is false. The Guide always applies.** What is unknown is whether it is satisfied.

The same distinction runs through the whole catalog: an item may be `required` and entirely un-started, or `not_applicable` and still carry the evidence of who was checked before it was ruled out. **The resolver decides what APPLIES. The agent decides what SATISFIES it.** That split is also what settled the Form 400 question in 5.5, where two brokerages accepting different instruments to close is a satisfaction question, not a resolution question, and therefore produces no branching in the catalog.

Corollary: `completed` stays a plain boolean, agent-owned, carried forward by `STATE_FIELDS`. **`resolveChecklist` has never set `completed` and must not start.** Making it a per-person map was considered and rejected: two shapes of the same field means every downstream consumer has to learn which items answer "complete?" differently, which is cheap now and expensive in six months.

### 4.1.5 State is an ARGUMENT, and the resolver may filter (LOCKED session 60)

Both public functions carry state: `resolveChecklist(type, state, facts)` and
`reResolve(previousItems, type, state, facts)`.

**State is positional, never a fact.** Facts are agent-answered; state is machine-tracked by
`states.js` and validated on the store envelope. Putting state in the fact bag would create two
writers for one value that can disagree, and the whole point of the fact bag is that it holds
things the agent told us. An unknown state for the type THROWS, because it is a caller bug rather
than a normal answer. The resolver reaches into `states.js` for `getStates` and takes nothing else
from it.

**`terminalOnly: true` items are ABSENT from the resolved set unless state is `collapsed`.** This
is the ONE deliberate exception to the section 4 rule that the resolver returns the annotated full
set and never filters, and the reason is not tidiness. A not-applicable mutual release still renders
as a row carrying a reason, and on a deal that is closing fine, a row saying "mutual release, not
applicable, the deal has not collapsed" reads as the system floating the possibility that it might.
Absence is the requirement, not merely not-required. A fourth applicability value was considered and
rejected: `optional` would have to mean something to every downstream consumer, and this is the only
item that needs it.

**THE `no_longer_applicable` REASON STRING IS NOW CAUSE-AGNOSTIC (AMENDED v14, `d65f730`, closes 7.41.5).**
The string used to say the transaction changed type, which was true only because the resolver returned
every catalog item for the type, so an item could fall out for exactly one reason. `terminalOnly` made
that two, and v13 kept the string on the argument that `collapsed` is terminal in all four state tables
so a `terminalOnly` item that was present can never be re-resolved at a non-collapsed state. **Section
4.1.6's arrangement fact made it three, and that third cause has NO such protection: it is freely
reversible via `correctFact`.** An agent flipping a deal out of `double_ended` would have seen rows
claiming the transaction changed type when nothing of the sort happened.

`reResolve` receives only the CURRENT type, state and facts plus `previousItems`. It holds no previous
type and no previous facts, so it cannot tell the causes apart, and giving it that context means a
signature change rippling through roughly ninety test call sites to improve one explanatory string.
**So the string states what the function actually knows, that the item is not part of the current
checklist for this transaction, rather than guessing a cause.** Two existing tests asserted the old
string indirectly by matching on the type name it interpolated, which a literal-text grep did not find;
both were updated as a direct consequence of the deliberate change.

### 4.1.6 A FACT MAY SHAPE THE ITEM SET (NEW v14, BUILT session 69, `9b7dfcc`)

**This is a new ROLE for a fact and it had no precedent.** Every other fact is read inside an item's
`requiredWhen` and decides that one item's APPLICABILITY. `representationArrangement` is read by
`resolveChecklist` itself and decides WHICH CATALOG or catalogs are resolved at all. Before v14 the
only set-shaping logic in the resolver was the `terminalOnly` filter in 4.1.5, and that is
state-driven rather than fact-driven. Recon confirmed zero precedent before this was built, so it is
recorded as a deliberate widening rather than discovered later as an inconsistency.

**Subtype was considered as the home and is NOT available.** Section 3.5 and the section 17 decision
list both describe type and subtype as agent-mutable and both triggering re-resolution. A grep of
`src/`, `scripts/` and `tests/` returns ZERO hits for any subtype concept: no envelope field, no
validation, no resolver read, no CLI flag. **Subtype is spec-only, the same category the review axis
occupied until session 67.** Building subtype machinery to host a single consumer would be the 7.41.6
hazard, so the arrangement is a fact.

**THE VALUES.** `'single'` (a normal one-sided deal), `'double_ended'` (ONE agent representing both
sides), and `'designated'` (TWO agents at the same brokerage, which produces two separate single-sided
transactions and therefore never unions). ABSENT is the normal state and resolves exactly as before.
Only `'double_ended'` unions.

**THE PAIRING MAP.** `SELL_SIDE_TO_BUY_SIDE_TYPE` in `states.js`, `seller_sale` to `buyer_purchase`
and `landlord_lease` to `tenant_lease`, following the `listingTypeForDeal` precedent including a test
pinning it against a list it cannot drift away from. A double-end opens as the SELL-side type, which
is the side that may carry `listingId`, so the existing 7.9 linking machinery works unmodified.

**THE MERGE: ANNOTATE TWICE, THEN PICK ONE ROW WHOLESALE.** Both catalogs are resolved independently
through the existing annotate path and the results are merged by id, taking the higher applicability
with precedence `required` > `indeterminate` > `not_applicable`. Composing `requiredWhen` predicates
was rejected: annotating twice reuses machinery that already works and `pendingFacts` falls out for
free. **The obligation applies if EITHER side's rule says it does**, because a double-end genuinely
carries both sides' obligations and under-asking on a FINTRAC record is the worse error. Order is base
catalog order first, then ids unique to the paired catalog in their own declaration order, so with the
fact absent every existing exact-id-set expectation is unchanged.

**THE WHOLESALE-ROW INVARIANT, and why it has a synthetic test (`3843eb1`).** A merged row takes EVERY
field from one side and is never stitched field by field. `reason` and `pendingFacts` describe why that
row's applicability came out as it did, and so do `satisfiedPersons` and `outstandingPersons`, which
`withClientSatisfaction` already paired with their own side's applicability under the session-62
emission rule before the merge ever runs. Stitching would let a `not_applicable` side's
`satisfiedPersons` or a `required` side's `outstandingPersons` land on the other's winning row. **No id
in the real catalog can currently produce a required-versus-not-applicable split on a client-scoped
item**, so the invariant is pinned with hand-built rows through a test-only export rather than left to
be discovered when a future catalog row makes it reachable.

**THE WRITE BOUNDARY REFUSES A DOUBLE-END ON AN UNPAIRED TYPE.** `setFact` and `correctFact` reject
`'double_ended'` on a type with no buy-side pairing, the same shape as `store.js` permitting
`listingId` only on certain types. The resolver additionally degrades to single-side resolution rather
than throwing on such a transaction, because a throw at resolve time would mean a stored deal can
never resolve again, which is the failure `queries.js` was written to avoid.

**WHAT THIS DOES NOT SOLVE, and it is a real gap rather than an oversight.** `entityType` is a SINGLE
value for the whole file. On a double-end where the buyer is a corporation and the seller is an
individual, one value cannot say both, and both branches are wrong: set it to `corporation` and the
resolver demands articles of incorporation from the individual seller; leave it and the corporate
buyer's FINTRAC corporation record is never asked for, which is a missing record on a compliance file.
**It cannot be fixed by reshaping the fact alone.** `requiredWhen(facts)` runs ONCE per item, before
`withClientSatisfaction` fans out to people, so a predicate has no person context to ask whether THIS
client is a corporation. Per-client facts require per-person applicability, which is a resolver
architecture change. **An interim of resolving those items `indeterminate` under a double-end was
designed and rejected:** section 4.6 derives the agent's question set from `pendingFacts`, and there is
no fact the agent could set to clear it, so it would be a permanently unanswerable row on every
double-ended file. `hasSelfRepresentedParty` and `brokerageReceivedFunds` are deal-level and are not
affected. Open in section 16 pending Mo's field answer on what a mixed-entity double-end actually
carries.

### 4.6 The `indeterminate` UX (NEW v10, LOCKED session 65)

A freshly opened `buyer_purchase` resolves to eighteen rows, twelve `indeterminate`, and three facts collapse all twelve. The resolver already attaches `pendingFacts` naming what each row waits on. **So the question was never how to render "unknown". It was what the UNIT of the surface is: the row, or the question.**

**1. The unit is the QUESTION, not the row.** Twelve rows saying unknown reads as broken software on day one and is also just wrong: the agent does not have twelve problems, he has three unanswered questions. The surface groups indeterminate rows under the fact they wait on and shows what each unlocks.

**2. `indeterminate` NEVER folds into either other count, on any surface.** Never counted as outstanding, because that asserts an obligation the system was never told about. Never counted as satisfied, because that is the "all clear" section 11 forbids. **A transaction with any indeterminate row CANNOT render as clear.** The close path already does this correctly with separate `outstandingCount` and `indeterminateCount`; this generalises it. It most needs to be a rule rather than a per-surface decision because the failure is SILENT: a deal with zero facts set has zero outstanding rows and would otherwise read as a clean file.

**3. Copy.** A group header plus one line per question, with the unlock count doing the persuading (for example, "3 answers will finish setting up this deal", then the questions, then `(unlocks 10 items)`). **The zero-state line is "Nothing outstanding, nothing unanswered"** and renders only when both counts are zero and nothing is unconfirmed. Questions are phrased PER TYPE where the fact means different things by type, per the session-59 warning on `hasSelfRepresentedParty`.

**4. Skip and "none" are structurally different and the intake must make confusing them impossible.** `conditions: []` means the agreement contained none; absent means nobody has said. **Every intake question needs three outcomes: a value, an explicit none, and a not-now that writes nothing.** No defaults, no pre-checked boxes, and a closed window is not an answer.

**5. An indeterminate row NEVER generates a chase.** Chases go to third parties; these facts are answerable only by the agent. Indeterminate is agent-facing, permanently.

**6. Deal-open asks; the digest carries what deal-open did not get**, as questions rather than rows, until they are answered. No second surface.

**CONSEQUENCE A: the question set is DERIVED, never a hardcoded list.** `entityType`, `hasSelfRepresentedParty` and `conditions` are merely what `pendingFacts` names on a fresh `buyer_purchase`. A `landlord_listing` names a different set, and any future catalog item reading a new fact silently adds a question. **Intake collects the union of `pendingFacts` across the resolved checklist, deduplicated, sorted by how many rows each unlocks.** Nobody maintains a second list; the catalog stays the only place a fact requirement is declared.

**CONSEQUENCE B: the never-render-clear guard extends to UNCONFIRMED.** Once extraction pre-fills `conditions` those rows resolve and stop being indeterminate, so the guard stops firing even though no human has looked at the value. Rule 1 as amended says an applied-but-unconfirmed value may be displayed but not acted on outwardly, and telling an agent a file is clean is acting on it. **So: never render clear while anything is indeterminate OR unconfirmed. Two counts, two lines, one suppression.** It follows that a question does not disappear when extraction fills a fact; it becomes a CONFIRM row, which is Rule 1's existing surface rather than a new one.

**THE HEADER STRING IS THEREFORE COMPUTED, NOT WRITTEN.** Phase A reads "3 answers will finish setting up this deal". The same deal in Phase B with a clean extraction reads "2 to confirm, 1 to answer". Same three lines, same unlock counts, different verbs. **Nobody should hardcode the word "answers" into a template.**


### 4.6a PER-CLIENT ENTITY TYPE ON MIXED DOUBLE-ENDS (NEW v15, DECIDED session 70, NOT BUILT)

v14's section 2 closed the double-end but left one gap open and named it the live one: **`entityType` is a single value for the whole file and cannot say the buyer is a corporation while the seller is an individual.** Both branches are wrong on a mixed double-end and the wrong one is silent. This section records the field answer that resolves it and the change it forces. Standalone writeup: `claude/TC_DOUBLE_END_ENTITY_DECISION.md`.

**MO'S FIELD ANSWER, session 70.** Asked whether a double-end with a numbered-company buyer and an individual seller carries two separate record sets in one file, or whether the brokerage handles the corporate side elsewhere: **two separate sets, same file.** The one deal file holds corporate records for the company side — confirmation of existence, directors, beneficial ownership — and ordinary individual ID records for the person side. Each client carries whatever their own status requires.

**THEREFORE APPLICABILITY IS A PER-PERSON PROPERTY, AND THE BLOCKER IS THE RESOLVER'S ORDERING RATHER THAN THE FACT'S SHAPE.** `requiredWhen(facts)` resolves once per catalog item, and only afterwards does `withClientSatisfaction` fan that already-resolved item out across each person. Applicability is therefore decided **before the code knows which person it is deciding for**, so it can only ever see file-level facts. **Reshaping `entityType` into something richer does not help while the decision sits upstream of the fan-out.** Either the fan-out moves above resolution, or `requiredWhen` receives the person. This is the same lesson as 7.45.2: the fact was never the problem, the sequencing was.

**SCOPE IS NARROWER THAN IT LOOKS.** Only items that are both `scope: 'client'` and `clientScope: 'event'` need per-person applicability. `scope: 'transaction'` items are genuinely file-level and are unchanged. `clientScope: 'dated'` items — `buyer_representation_agreement` among them — are skipped by `withClientSatisfaction` entirely and render as a single row, so they are unchanged too. This is a targeted change to one branch of the resolver, not a rewrite of applicability.

**THE REJECTED `indeterminate` INTERIM IS VIABLE AGAIN, AND 4.6 IS WHY IT WAS REJECTED.** v14 recorded that resolving mixed-entity rows `indeterminate` was designed and REJECTED because 4.6 derives the agent's questions from `pendingFacts`, and **no fact existed that the agent could set to clear it** — a permanently unanswerable row on every double-ended file, which violates 4.6's rule that the unit is the QUESTION and 4.6's CONSEQUENCE A that the question set is derived rather than hardcoded. **Per-participant entity type creates exactly that fact.** The agent answers "this buyer is a corporation", `pendingFacts` names it like any other, the row resolves, and the objection disappears. Whether the interim is still worth having once per-person applicability exists is a separate call, but it is no longer blocked on the thing that killed it.

**THE DATA HAS A HOME ALREADY.** Participants (section 6) have been built end to end since session 66 — store, derivation, authorization gate, two CLI verbs. Per-participant entity type belongs on that record. **No new store is needed.**

**DELIBERATELY NOT DECIDED HERE, and all three should be settled against the real call sites rather than in the abstract:**

1. The signature change — `requiredWhen(facts, person)` for client-scoped items, a separate per-person predicate, or moving the fan-out above resolution. All three reach the same place.
2. Migration of existing single-entity files — copy the file-level `entityType` down onto each participant, or read absence as "inherit the file value" at read time.
3. **Which specific catalog items actually differ between corporate and individual clients. RECON THIS BEFORE BUILDING.** Section 7.51 and the session-69 board both record this project claiming a catalog difference without opening the files, and one of two claimed items turning out byte-for-byte identical. A claim covering N items needs N citations.

### 4.7 `hasSelfRepresentedParty` is extractable in ONE DIRECTION (CORRECTED session 65)

Session 64 established that a fact requiring the ABSENCE of a document is not machine-readable, and applied it to this fact in both directions. **That was wrong, and Mo caught it: "if the cooperating side has information why would it always be asked? thats dumb, should only be asked if it is blank."**

The rule is one-directional:

- **Setting it TRUE** requires establishing that no document exists, which is absence across a document set the system has not seen. **Not extractable.**
- **Setting it FALSE** requires a document that DOES exist: the Confirmation of Co-operation and Representation naming a co-operating brokerage. **Positive evidence, on a form the system will already have. Extractable.**

**So the question fires only when nothing positively establishes representation.** Co-op brokerage present, the fact pre-fills false with the form as its excerpt and no question is asked. Co-op field blank or no form yet, the question fires. Phase A asks it because Phase A has no extraction at all, but it stops being a PERMANENT question and becomes a FALLBACK one.

The three-way relationship among the deal-open facts, restated for Phase B planning: `hasSelfRepresentedParty` is asked whenever the negative evidence is absent; `conditions` is extractable in principle and is the ten-row unlock, but sits behind HARD GATE B because the DocuSign-flattened APS defeats linear extraction (section 15 item 5); `entityType` is extractable-ish and is the dangerous middle, since reading "2648391 Ontario Inc." is reading a naming convention rather than a stated fact, and a numbered company trading under a personal-sounding name breaks it silently. **Both of the latter pre-fill and neither asserts.**

## 4A. The transaction event log (NEW v7)

**Why this section exists at all, and it is not what the parked item predicted.** 7.42.1 was recorded as
the close override: a brokerage grants an exception, the agent must be able to close while our checklist
still shows items outstanding, and the note said this was a `states.js` change that might already be
permitted. **Recon found there was no block anywhere.** `canTransition` and `isTerminal` had ZERO
non-test callers, `resolver.js` took only `getStates`, `store.js` imported neither `states.js` nor
`resolver.js`, and nothing gated a write on completeness. The system had not appointed itself the
authority because the system had not appointed itself anything. **So the item is not an unblocking job.
It is a decision about what closing with items open RECORDS, taken before anything exists that could
block it.**

**Mo's reframing made it general.** Asked whether an AI-extracted value logs as `system`, he said yes and
added that the log "should show what happened and who did it." That makes closing-with-items-open an
EVENT rather than a special field, and it gives the product the spine it was missing: Rule 1 is
apply-and-notify and Rule 2 is propose-then-confirm, and neither is honest history unless the file
records which one happened.

### 4A.1 The envelope

Four fields: `at` (canonical UTC ISO string), `actor`, `kind`, `payload`. Stored as `events: []` on the
transaction record, arriving through the store's passthrough, so **ZERO store change**. The store
validates seven envelope fields and inspects nothing else, which is the property that made this free.

**The actor vocabulary is THREE values and stays three:** `agent`, `system`, `operator`.

- The agent acting through `assistant@` is `agent`. It is their instruction arriving by a different door.
- `operator` is Mo doing brokerage-admin work on the agent's behalf, which is real in his day job and
  would otherwise log as the agent. That would be the log lying about exactly the thing it exists to
  record.
- Third parties get nothing until the chase engine exists.
- **Which system path did the work lives in the KIND, never in the actor.** `system` reading an email,
  `system` re-resolving after a fact changed, and `system` filing a document to Drive are three kinds,
  not three actors. This is what stops `actor` becoming a taxonomy.

**Rule 1 produces TWO entries, not one.** The system applies a value off an instrument and displays it
unconfirmed: that is a `system` entry. The agent later confirms it: that is an `agent` entry. Collapsing
them means the log cannot answer whether a person ever verified the value, which is the only question
anyone asks six months on. **A file where the confirm entry never arrived is visibly a file nobody
checked.**

**Rule 2's declined proposals write NOTHING.** Completion detection proposing that a waiver cleared the
financing condition is not a fact about the deal until the agent confirms. The flip is an `agent` entry.
A log full of things the agent declined is noise.

**Filing a document and extracting a value are different KINDS.** One puts bytes somewhere. The other
changes what the file claims is true. Only the second needs a confirm entry behind it.

**ENVELOPE GENERAL, VOCABULARY NARROW.** `EVENT_KINDS` ships with exactly ONE entry,
`closed_with_items_outstanding`. **Every future kind arrives with its own writer**, so no kind is ever
designed against an imaginary consumer. Same discipline that closed catalog section 5.6 deliberately
empty.

**`makeEvent` is the ONLY constructor.** `appendEvent` does not validate its event, deliberately. A
second validation site means two places know the event shape, which is what the module exists to
prevent, and any cheap guard is a weak proxy. This is a DISCIPLINE CLAIM, recorded here rather than
enforced in code: every writer goes through `makeEvent`.

**Canonical UTC only.** The strict round trip `new Date(at).toISOString() === at` rejects valid offset
forms like `-04:00`. Deliberate: `getNowIso()` produces exactly the accepted shape, and one canonical
string means events sort lexicographically.

**Append is read-modify-write, last-write-wins.** `writeTransaction` is a whole-record write. Individual
writes ARE atomic (temp-file-then-rename in `writeTransactionFile`), so no reader ever sees a
half-written file and an events array cannot be lost mid-write. But the check-then-write sequence is
unguarded and two concurrent writers to one transactionId share a single `.tmp` path. One agent per file
today, so it holds. Recorded rather than discovered later.

**The module is PURE.** `at` is injected by the caller, never read from a clock, same reasoning that kept
the suspension clock out of `states.js`. Zero requires.

### 4A.2 Closing with items outstanding

**Outstanding is `applicability === 'required'` AND `completed` falsy.** `not_applicable` and
`no_longer_applicable` are excluded. **`indeterminate` rides in the snapshot but never in the count.** An
indeterminate item is one where the fact behind it was never answered, so calling it outstanding
overstates what we know, and asking an agent for data entry on the way out of a closing file gets
nothing. It should be rare on a file that ran normally, and **the snapshots measure whether it actually
is**, which would be a signal about the fact-collection surface rather than about the deal.

**SNAPSHOT, not ids.** The record carries id, label and applicability as they stood at close. Recording
ids alone means reading the file six months later re-resolves against whatever the catalog says THEN,
and the catalog is code that changes. The agent would see a reconstruction rather than what they
actually overrode.

**The event is written only when `outstandingCount > 0`.** A clean close writes nothing. The log records
exceptions, not routine.

**The warning surface is `closed` ONLY.** Not `collapsed`, not `terminated`. A dead deal has outstanding
items by definition and warning there is pure noise.

**The honesty constraint stands and is not reopened:** "3 items outstanding on our checklist", never "you
are missing required paperwork". We cannot see the brokerage file and the exception may already be
granted. Same failure class as the Fintracker detect-if-present rule.

**Warning COPY is deliberately NOT decided in v7.** There is no surface to decide it against, and
deciding copy without a consumer is the 7.41.6 hazard.

### 4A.3 The transition service

`transitionTransaction(agentId, transactionId, toState, opts)`, where `opts` carries `at`, `actor`,
optional `items`, `baseDir` and `now`.

- **A missing transaction THROWS.** That is a caller bug, same class as an unknown type, not an
  agent-facing refusal.
- **A refused edge RETURNS `{ valid: false, reason }`** with the `states.js` string passed through
  unwrapped, because that string is agent-facing copy. Matches the `{ valid }` idiom `states.js`
  established.
- **A close with items outstanding is NOT a refusal.** It succeeds and writes the event. That is Rule 3,
  and it is the whole reason the log was built first.
- **The service does NOT call the resolver.** `items` is supplied by the caller, which keeps the resolver
  out of this module and the caller in charge of where items come from.
- **`events` is ABSENT from the record, not empty, when no event was built.** Writing `events: []` onto
  every transition would use the store's passthrough to invent structure on files that never had it.
- **Spread-and-patch, never in-place mutation.** The repo has two read-modify-write idioms:
  `agentState.js` spreads immutably, `content/state.js` mutates the object `read` returned. The first was
  chosen because `appendEvent` is pure and returns a frozen array, so mutation would fight a contract
  shipped in the same session. `readTransaction` returns raw `JSON.parse` output with nothing frozen, so
  in-place mutation would appear to work.

### 4A.4 Manual deal-open (`scripts/open-transaction.js`)

The first TC caller with a human on the other end, and the first module in the build to produce an
artifact anyone can look at.

**`baseDir` is REQUIRED and the refusal lives in the exported CORE, not the `require.main` block.** That
is the only way a test can prove the refusal exists. Every other script in `scripts/` puts argument
handling in the untestable half, which is exactly why none of them refuse anything. The CLI half resolves
`--base-dir`, then `STORAGE_ROOT`, then refuses, and **never calls `getStorageRoot()`**.

**The reason is specific to deal files.** `getStorageRoot()` falls back to `process.cwd()`, which is
correct for a server booting from a fixed working directory and wrong for a hand-run tool. A deal file
is a compliance record and must never land in a directory the caller did not name. This is a DELIBERATE
divergence from the other five testable-core scripts, commented in both halves so a future reader does
not fold it back into line.

**The core validates the initial state via `isValidInitialState` and names the valid initial states in
its error.** The store deliberately does not enum-validate `state`, so this check exists nowhere else,
and it is what makes the CLI more than a wrapper over `createTransaction`.

### 4.3 FACT STORAGE (designed session 63, **BUILT session 64**). This was the blocker; it is now closed.

**Session 63 recon established the starting point, and it is a blank page.** Nothing calls `resolveChecklist` or `reResolve` outside their own tests. No facts store, no items store, no `clientSatisfactions` store. The only persisted event kind is `closed_with_items_outstanding`. **There is no per-item completion state on disk for any transaction.** The store holds an envelope and passes unknown keys through untouched.

#### The governing rule

**The file stores WHAT IT WAS TOLD and WHAT THE AGENT DID. It never stores what the catalog concluded.**

A checklist row carries two kinds of information. What the row IS (its label, its source, whether it applies) is derived from the catalog plus the facts, and falls out of `resolveChecklist`. What the agent DID to it (ticked, on this date, with this document, with this note) is not derivable from anything: it happened.

So the file must persist facts AND completion, and must persist nothing derived. A file that stored `applicability: 'required'` would remember an answer instead of the question, and would go stale the moment a predicate changed. Storing only what was told means a catalog fix propagates to every existing file automatically.

**`reResolve` was built for exactly this and has never had a caller.** It recomputes everything from the catalog, then overlays the four carried fields by matching item ids. That is the read path.

#### The shape

```
transaction file
  envelope: transactionId, agentId, type, state, listingId, schemaVersion, createdAt, updatedAt
  facts:    { entityType: 'corporation', conditions: ['financing'] }
  items:    { <itemId>: { completed, completedAt, documents, note } }
  events:   [ { at, actor, kind, payload } ]
```

**One file, not two.** A deal file that can be half-present is worse than a larger one.

**Facts are BARE VALUES. Provenance lives in the event log, once.** This reversed mid-conversation and the reversal is the interesting part. Mo initially chose facts-carry-provenance, then said the log should record what a value was and what it became. Those two together put the same truth in two homes, which is how they come to disagree. The log alone satisfies Rule 1's requirement that a file missing the confirm entry is visibly one nobody checked. The cost is that "has anyone confirmed this" is a scan rather than a field read; the log is short and per-transaction, and silent divergence in a compliance record is the worse price.

**Items are keyed by id, not an array.** `reResolve` matches by id; a map makes "did the agent touch this" a lookup, and makes two records for one item impossible.

**Items store ONLY the four fields `reResolve` carries:** `completed`, `completedAt`, `documents`, `note`. Nothing else. Everything else on a resolved item is derived.

#### Writes

**Setting a fact and logging it is ONE write.** A fact changed with no event is a value nobody can account for. The fact writer owns the event; the caller does not get the option.

**Item completion gets an event too.** Mo: an agent being able to read the log and know exactly what happened with this deal is never a bad thing. Log volume was considered and accepted. This is Rule 1's argument applied one level down.

**Every change event carries BEFORE and AFTER.**

#### Three edges settled at design time so they are not decided by accident during implementation

1. **FIRST SET IS NOT A CHANGE.** Setting `entityType` for the first time has no before. Writing `before: null` would assert we were told it was null, which is the assert-what-you-were-not-told failure this project keeps hitting. Either two event kinds, or omit `before` entirely. **Absent, never null**, consistent with `resolver.js:119` and with `listingId`.
2. **UNCOMPLETING IS A REAL EVENT.** Tick then untick is a correction, not a deletion. Without the event the file shows the item as never completed and the fact that someone believed otherwise is gone. Same argument as never shrinking `conditions`.
3. **RULE 1'S TWO ENTRIES ARE STRUCTURAL HERE.** An AI-extracted value writes a `system` event; agent confirmation writes a SEPARATE `agent` event. A fact can exist and be unconfirmed, and confirmation is a distinct log entry rather than a flag on the fact. The file missing the confirm entry is visibly one nobody checked, which is exactly what Rule 1 asks for, at no extra cost because the log carries everything anyway.

#### Known limitation, recorded rather than solved

Per-person satisfaction lives in `clientSatisfactions`, which is a FACT, while item completion lives in `items`. Those are two different homes for two different things and they can disagree until both are written by the same path. Session 62 established there is no writer for `clientSatisfactions` anywhere, so the `not_applicable` branch of `withClientSatisfaction` is a contract with no producer: it cannot be wrong today and cannot be proven right either.

#### Still open

**The ADDRESS may belong on the ENVELOPE rather than in the fact bag.** No `requiredWhen` reads it, so it is IDENTITY rather than a fact in the resolver's sense, and two open files cannot be told apart without it. `listingId` set the precedent in `f41fe06`: identity fields are validated envelope fields, facts are not.

**Incremental date entry** (section 16) still needs walking through: does the agent confirm all dates at deal-open, or incrementally as conditions are negotiated? It complicates the re-resolution contract and it lands directly on this section.

#### Build order

At least three commits: the fact writer with its events, the item-state writer with its events, and the read path that reassembles a checklist by calling `reResolve` with what was stored. Plus new event kinds, of which there is currently exactly one. This is the sequence that finally gives the resolver a production caller and unblocks the close CLI.

#### 4.3.1 AS BUILT (session 64)

**Three writers, all the same shape as `transitions.js`: read, validate, compute the patch, spread onto previous, write once.** Every one of them writes the value and its event in a SINGLE write. A fact changed with no event is a value nobody can account for.

**`src/transactions/facts.js`.** `setFact`, `confirmFact`, `correctFact`.

- Fact keys are validated against `FACT_KEYS` in `src/transactions/rules/factKeys.js`, a **hand-maintained list that cannot be derived**. `item.reads` covers only the keys the resolver checks for presence before calling `requiredWhen`; `requiredWhen` bodies dereference `facts.x` directly and those keys appear in no `reads` array. Five keys: `hasSelfRepresentedParty`, `entityType`, `conditions`, `brokerageReceivedFunds`, `representedPersons`. A test asserts every string in every item's `reads` across all six types is present in the list, which pins the half that CAN be checked mechanically; the `requiredWhen` half cannot be, and the comment says so rather than pretending otherwise.
- **`clientSatisfactions` is DELIBERATELY ABSENT from `FACT_KEYS`, and a test pins the exclusion.** It is completion state that happens to live in the facts bag, not a plain fact, and a single `{ before, after }` pair cannot describe one person clearing one item. It has its own writer (below). The comment names the alternative and why it was rejected, so nobody "completes" the enumeration later.
- **`undefined` is REFUSED as a value.** `JSON.stringify` drops an undefined value on the way to disk, so the write silently vanishes, and the resolver treats absent and present-but-undefined identically so nothing downstream notices. Pinned by a test that reads the file back. `null` IS permitted: the resolver explicitly does not treat it as missing.
- **First set OMITS `before`; a subsequent set includes it.** One kind, `fact_set`, in both cases, because whether it was a first set is derivable from whether `before` is present. Consumers that ask "what happened to this key" then need one filter rather than a union forever.
- **Evidence rides on `system` writes only.** `setFact` takes an optional evidence argument, puts it in the payload unexamined when the actor is `system`, and THROWS when the actor is `agent` or `operator`. Provenance lives in the log once, and a hand-typed fact has no excerpt. The evidence object's own shape is 7.6's problem; nothing produces one yet.
- **`fact_confirmed` carries the VALUE, not just the key.** A bare `{ key }` read months later appears to confirm whatever the fact currently says, which may have changed twice since. That would make the log lie about the exact thing it exists to record.
- **`fact_corrected` is a separate kind from `fact_set`, and the split rule generalises: split on what is NOT derivable, merge on what is.** A date that MOVED (an amendment superseded it) and a date that was NEVER RIGHT (extraction misread it) produce identical payloads and mean opposite things, so a reader cannot tell them apart without a kind. `before` is always present. **The actor is always `agent`, pinned by test: the system cannot correct itself, because it does not know it was wrong.** Even a better re-read is a proposal, and the agent is still the writer.
- An `agent` `fact_set` needs no confirm entry, because the agent setting it IS the confirmation. Rule 1's two-entry structure applies to `system` writes, which is what makes a system write with no matching confirm visibly one nobody checked.

**`src/transactions/items.js`.** `markItemComplete`, `markItemIncomplete`. Stored `items` is a map keyed by item id holding ONLY the four `STATE_FIELDS`: `{ completed, completedAt, documents, note }`. Nothing derived, no label, no applicability, no source.

- **Item ids are NOT unique across types**, so the transaction is READ before the id is validated against `CATALOG[transaction.type]`. That is the opposite order from `facts.js`, where the key set is type-independent, and it is correct: nothing writes until every check passes either way.
- **`completedAt` is REQUIRED and never defaulted to the event's `at`.** When the thing happened and when it was recorded are different facts, and an agent ticking Friday's item on Monday needs both. Format is not validated, because nothing in this codebase validates `completedAt` today and inventing a rule mid-implementation is out of scope.
- `documents` and `note` are optional and absent-never-empty. An explicitly passed empty-string note IS stored, because `reResolve` has a test asserting empty-string notes carry forward.
- **Uncompleting sets `completed` to false and LEAVES `completedAt`, `documents` and `note` in place.** It is not a deletion: someone believed the item was complete with that evidence, and the file records what happened.
- Re-completing an already-complete item is allowed and writes a new event. Note that the entry is rebuilt, so a re-complete that omits `documents` drops them from the item's stored state while the log retains them. Consistent with the file storing what it was told, and worth knowing rather than discovering.
- **The module takes NO position on applicability**, and says so in a comment. Whether a `not_applicable` or `terminalOnly` item may be marked complete is an open design question; recon confirmed the codebase has no opinion today, and the writer stores what it is told.

**`src/transactions/satisfactions.js`.** `markPersonSatisfied`, `markPersonUnsatisfied`. The producer `clientSatisfactions` never had, which is why `withClientSatisfaction` was dormant on every real file.

- **Person identifiers are NAMES as the instrument spells them.** Mo's answer settled the shape: SkySlope keeps no client information because it has no relationship with the client, and his admins put the names on the files themselves. Compared with STRICT equality against `representedPersons`, never trimmed, lowercased or fuzzy-matched, because the names must agree with what the brokerage files under.
- **A `personId` not in `representedPersons` THROWS**, and this validation is load-bearing rather than defensive. The resolver iterates `representedPersons` and NEVER the satisfaction keys, so an orphan satisfaction is silently ignored: the typo would store data nobody reads, and the person it was meant for stays outstanding forever with no error anywhere. **That silent-orphan behaviour is pinned by its own test**, so a future change to this validation goes red. An absent `representedPersons` throws with a message saying there is nobody to satisfy yet.
- The item must be `scope: 'client'` and `clientScope: 'event'`. A transaction-scoped item throws, because that item's completion lives in `items`. **`clientScope: 'dated'` throws, naming the missing clock** rather than guessing at a window.
- The record is `{ at, actor }` and nothing else, because `isPersonSatisfied` reads only `hasOwnProperty` and never looks inside.
- **Unsatisfying DELETES the item key rather than storing a tombstone**, because presence is the representation and a null record would still count as satisfied. If the person's map empties, the person key goes too. The event records that it happened, so nothing is lost from the log. Note that `clientSatisfactions` can therefore shrink to `{}` but never back to absent: absent-never-empty holds on first write and not on last delete.
- **The writer and the resolver are allowed to disagree, on purpose, and a test pins it.** A person can be marked satisfied on `fintrac_corporation_identification_record` before `entityType` is set, in which case the fact is written and the resolved row still emits neither `satisfiedPersons` nor `outstandingPersons` because it is `indeterminate`. The writer records what it was told; the resolver decides what to show.

**`src/transactions/checklist.js`, the read path.** `resolveTransactionChecklist(agentId, transactionId, opts)` reads and delegates; `resolveChecklistForTransaction(transaction)` does no I/O.

- **THE LOAD-BEARING LINE IS THE MAP-TO-ARRAY CONVERSION.** `reResolve` wants an array whose elements carry `id`, and the stored map holds the id only as the KEY. `Object.values` would satisfy `reResolve`'s only shape check (`Array.isArray`), collapse `previousById` to a single entry keyed `undefined`, match nothing, and return EVERY item as freshly incomplete **with no error at all**. `Object.entries` plus reattaching the key is what avoids it, and the test that proves it fails under an `Object.values` implementation.
- **Every stored id is converted and passed through, never filtered against the catalog.** An id the catalog no longer carries reaches `reResolve` and comes back `no_longer_applicable`, losing its label (since `carriedOver` spreads the stored entry, which never had one) but keeping the record. Filtering would silently discard a completion the agent recorded, the same mistake as shrinking `conditions`. The labelless row is accepted and deliberate.
- `facts` defaults to `{}` and `items` to `[]` in this module, once. `reResolve` is called unconditionally rather than branching to `resolveChecklist` on a first read: one code path is worth more than a saved allocation, and a branch on "first time or not" is a branch that can be wrong.
- **The split into a pure function exists so `transitionTransaction` can resolve from the transaction it already read.** No cycle: `checklist.js` requires `store` and `resolver`; `resolver` requires `rules` and `states`; neither requires `transitions`.

**The close record, as built (`7ff50da`, `75056de`).** `transitionTransaction` no longer takes `items` as an option, because a caller who forgot it closed the deal silently with no record, which is the one thing this event exists to prevent. It resolves the checklist itself.

- **TWO COUNTS, never merged.** `outstandingCount` is required-and-not-complete. `indeterminateCount` is unknown, counted regardless of completion. The event fires when EITHER is above zero, so a clean close writes nothing and the presence of this event means something went out the door unresolved. Outstanding 2 with 0 unknown is an agent who worked the file and skipped two things, a compliance gap; outstanding 2 with 11 unknown is a file nobody ever filled in, a data gap. One number cannot tell those apart, and the person reading it during a complaint is the one who most needs to.
- **Completion for a row reads the PRESENCE of `outstandingPersons`**: empty means complete, absent falls back to `item.completed`. `withClientSatisfaction` never writes `item.completed`, so without this a client-scoped item that every represented person had cleared counted as outstanding, and both spouses receiving the RECO Guide produced a record saying the obligation was unmet. Presence rather than scope, because the resolver already decides when to emit and re-deriving that rule here would put it in two places. A `not_applicable` item emits `satisfiedPersons` alone and correctly falls through.
- **Label validation runs only for items that become rows.** It ran on every item, so a carried-over `no_longer_applicable` id, which has no label, made the transaction **impossible to close at all**. Label is only ever read on a row.
- The guard stays on `toState === 'closed'` specifically, not on terminality. A collapse or a termination is not a close, and recording a compliance override there would assert a decision the agent never made. This also means a future fifth terminal state cannot silently pick it up.

**A SEQUENCING CONSTRAINT that fell out of writing the tests, and it applies to real files.** `buyer_purchase` has THREE `client/event` items (`reco_information_guide`, `fintrac_individual_identification_record`, `fintrac_third_party_determination`). **All three switch their completion signal from `item.completed` to per-person satisfaction the moment `representedPersons` exists as a fact.** On a real file that reads as three completed items un-ticking themselves for no visible reason. Per-person satisfaction had to be writable before names could arrive on real transactions, which is why `3a073dc` precedes any extractor.

**The eight event kinds:** `closed_with_items_outstanding`, `fact_set`, `fact_confirmed`, `fact_corrected`, `item_completed`, `item_uncompleted`, `person_satisfied`, `person_unsatisfied`. `EVENT_KINDS` is an allowlist and `makeEvent` throws on anything else, so no writer can quietly invent a name.

**CLI verbs (`b4838e0`):** `scripts/set-fact.js`, `scripts/complete-item.js`, `scripts/satisfy-person.js`, each a testable core plus a `require.main` argv block, subprocess-tested following `scripts.enableLeads.test.js`. **`at` is not a flag: the writers take a clock because tests inject one, and the CLI stamps what a human would never type.** Fact values parse conservatively (`true`, `false`, `null`, and a leading bracket are typed; everything else stays a string) and **numbers are deliberately NOT parsed**, because no `FACT_KEYS` entry holds one and silently turning `'12'` into `12` surfaces as a resolver mismatch months later. If a numeric fact is ever added, revisit alongside it.

**STILL OPEN in 4.3.** `clientScope: 'dated'` window evaluation, which needs the resolver clock question settled. An `unsetFact` path, which would have to decide whether removing the last fact drops the `facts` key or leaves `{}`. An event for editing a note or adding a document to an already-completed item, which is real (better evidence arrives late) and wants its own writer. And whether a correction should record when the wrong value was believed true, which `before` plus the original `fact_set` timestamp already reconstructs.

### 4.4 `listingId` links an offer to its listing (BUILT session 63, `f41fe06`)

**Optional, deliberately.** An agent may bring a deal to GetKlosed whose listing predates the product. Refusing that offer because we never saw the listing loses exactly the file the agent most wants tracked. Same onboarding reasoning that made `live` an initial state.

- **Absent** means no linked listing. Valid on all six types.
- **`null` and `''` are REJECTED**, distinctly from absent. Absent-never-null is already how this codebase says unknown.
- **Present** is valid on `seller_sale` and `landlord_lease` only. `buyer_purchase` and `tenant_lease` open at the deal with no listing behind them, and a listing does not point at a listing. A present `listingId` on the other four is a validation error naming the type.
- **Format** reuses `TRANSACTION_ID_RE`. No second regex.

**This is the first exception to the store's pass-unknown-keys-through rule, and the rule was SHARPENED rather than abandoned.** The store validates only what the envelope can answer ABOUT ITSELF. Format and type-permission qualify: neither requires reading anything outside the object. Existence and target-type do NOT qualify, because they need a filesystem read, and that is the caller's job. Arbitrary unknown keys still pass through untouched.

**Same-agent only, by construction.** `readTransaction` builds its path from `agentId`, and no index resolves a `transactionId` to its owning agent. A co-listing across two agents has no read path today. Confirmed in session 63 recon rather than assumed.

### 4.5 The TRANSFER of client items from listing to offer (DESIGNED. **STILL BLOCKED, and the "unblocked session 64" claim below was wrong for ten sessions. Corrected v18 by recon.**)

**THE BLOCKER WAS NEVER 4.3.** Session 63 abandoned this because there was no persisted completion state to transfer, and 4.3 shipping in session 64 was read as clearing it. It did not. The authoritative completion signal for a client/event item is `outstandingPersons.length === 0`, derived from `clientSatisfactions`, and `events.js` states in its own comment that `withClientSatisfaction` never writes `item.completed`. `clientSatisfactions` is written only by `markPersonSatisfied` and `markPersonUnsatisfied`, both of which pass through `assertRepresented`, which throws when a transaction has no participants. **No live path creates a participant** (v18 headline), so that throw fires unconditionally and the thing 4.5 exists to move cannot exist. **4.5 is blocked behind the participant creation path, which is 6.7, and it moves to seventh in the v18 build order.**

**AND IT TRANSFERS ONE ITEM, NOT A SET.** The prose below says the filter carries the RECO Guide and the FINTRAC client records. Recon of the catalogs: `fintrac_*` items are declared in `buyerPurchase.js` and `sellerSale.js`, both DEAL types. `sellerListing.js` and `landlordListing.js` declare no `scope: 'client'` items of their own and inherit exactly one, `reco_information_guide`, through the universal spread. **A listing transaction has one client-scoped item.** This does not kill the feature, since the filter is one predicate and the catalog will grow, but "small" was already the argument for doing it and it is smaller than the board believed.

**A DIVERGENCE FOUND IN THE SAME RECON, PARKED.** `assertKnownItemId` checks only that an id exists in the type's catalog, with no scope check, so `scripts/complete-item.js` can write `items.reco_information_guide` on a listing transaction today. That write is inert, because the resolver never trusts `items.completed` for a client/event item. And with zero participants the resolver emits neither `satisfiedPersons` nor `outstandingPersons`, so nothing contradicts it either. **One item, two completion stores, the writable one ignored and the authoritative one silent.** Same family as the abandoned-filing invisibility in 7.49.4.

**A SECOND TRAP, AND IT IS THE ADOPTION PROBLEM AGAIN.** `listingId` has exactly one writer, a flag on `scripts/open-transaction.js`, settable only at creation and deliberately never linkable afterward. 4.5's entire trigger is that field. **If the agent does not pass it when opening the offer, seeding never happens and cannot be repaired.** That is the same failure shape as expecting an agent to fill in a participant roster, and the answer is probably the same shape too: inferred and confirmed rather than typed. Not designed here; recorded so it is not discovered later.

**Original v10 text, kept for the design decisions which are unchanged:**

Mo's rule, from the field: anything that is just between the agent and the client carries over; anything involving the other side gets redone.

Mapped onto the catalog, this needs no new machinery. Filtering the listing's items to `scope: 'client'` transfers the RECO Guide and the FINTRAC client records, and drops the listing agreement, which is correct because a new listing agreement is the whole point of a relist and an offer has no listing agreement of its own. The filter is one predicate; the catalog does the rest.

**Decisions locked session 63:**
- Seeding writes an EVENT on the offer, actor `system`, naming the source listing. An item arriving already completed with no entry explaining why is exactly the file nobody checked.
- **Creation-only.** An item completed on the listing AFTER the offer opened does not flow through. Re-seeding is parked deliberately.
- No `listingId` means no seeding; the offer resolves fresh. A normal path, not an error.

**THIS WAS ATTEMPTED IN SESSION 63 AND CORRECTLY ABANDONED.** It was planned as commit 4 of 4 and the recon sank it: there is no persisted completion state anywhere to transfer. The filter would filter nothing and the events would record inheritance of nothing. It is blocked on 4.3, not merely sequenced after it.

## 5. Item catalog (LOCKED session 55, catalog COMPLETE session 60, PARTITIONED session 62)

Researched against current Ontario requirements as of 2026-07-17. Re-verify before locking implementation rather than re-researching from scratch.

### 5.1 The universal spine (SPLIT session 62, `00f81dd`)

**THE SPINE IS NOW ONE ITEM, NOT THREE.** `universal.js` carried `reco_information_guide`, `srp_disclosure` and `deal_sheet`. Only the first is genuinely universal. The other two are DEAL obligations that sat in the spine because every transaction type happened to be a deal type. The listing types are the first records that are not deals, and that is what exposed it.

`srp_disclosure` and `deal_sheet` now live in each of the four DEAL type files. The two listing catalogs spread the spine normally.

**Order was load-bearing in that refactor and is worth recording.** The id-list assertions are order-sensitive, output order is catalog declaration order (`resolveChecklist` does `.filter().map()` with no sort anywhere), and the spine's internal order is `reco_information_guide`, `srp_disclosure`, `deal_sheet`. The commit prompt named them in the wrong order in prose; CC caught it in recon before writing anything. The two items are re-declared at indices 1 and 2 in SPINE order.

**Why `srp_disclosure` is a deal obligation:** on a listing with no offer yet, there is no other side to be unrepresented.

**THE REPRESENTATION-INSTRUMENT ASYMMETRY (session 62).** After the split, `seller_sale` and `landlord_lease` have NO representation instrument at all. `REPRESENTATION_INSTRUMENT_IDS` lost two entries rather than having them repointed. A listing agreement is property-specific and belongs to the listing; a buyer or tenant representation agreement is client-scoped and travels with the client, so the buy and tenant sides keep theirs. This asymmetry was previously only in prose (4.1.1) and is now visible in the code.

**Historical note on the v7 three-item spine:**

**THREE items as of session 60.** The first two are TRESA and are the items brokerages actually chase. The third, the deal sheet, was added in session 60 and is the first universal item whose authority is the BROKERAGE rather than a regulator; its full reasoning is in 5.6, because that is the conversation it came out of.

1. **RECO Information Guide** provided, explained, acknowledgement recorded. Post-TRESA, before an agent provides services to a client or assistance to a self-represented party, they must give a copy of the Guide and explain it, and agents must maintain their own records verifying the Guide and forms were provided, explained, and any acknowledgements received. This replaced OREA Form 810. `source: TRESA`.
2. **Written representation agreement**, with remuneration method present. TRESA prohibits brokerages from entering agreements with a buyer or seller for the purpose of trading real estate unless the agreement is in writing, and representation agreements must clearly identify the method used to determine remuneration. "Trade" covers leases, so a tenant is a "buyer" for this purpose. The instrument differs by type (Buyer Representation Agreement / Listing Agreement / Tenant Representation Agreement / Listing Agreement for lease) but the item always fires. `source: TRESA`.

That both universals are TRESA and both are compliance is the product insight: the US platforms do not know what a RECO Information Guide acknowledgement is and will never build a checkbox for it.

**BUILT sessions 57 to 59, and one gap was found in the building.** Both universals ship in `src/transactions/rules/universal.js` and spread into all four types. The representation agreement does NOT: `a9fd906` moved it out of the universal spine, because the instrument name differs by type and because the listing agreement is `scope: transaction` while the buyer and tenant agreements are `scope: client` (see 4.1.1). Four per-type items: `buyer_representation_agreement` and `tenant_representation_agreement` at client/dated, `listing_agreement` and `listing_agreement_lease` at transaction scope with no `clientScope` key at all.

**The gap: the item said "an agreement exists" when the requirement is "an agreement exists AND identifies the remuneration method."** A grep of `src/transactions/` for remuneration or commission returned zero hits across all four items. Those are two parts of one obligation, and the second is the one brokerages actually get caught on, because a written agreement with a vague or missing remuneration clause looks complete on any checklist that only asks whether the document is on file. Fixed in `448a251` by naming both parts in the LABEL, since the label is the only place an item states what satisfies it. **A separate remuneration item was rejected:** the clause is a field inside the agreement, not a second artifact, so there is nothing to file against a second row, and "agreement on file but remuneration blank, sent back" is exactly what the `note` field is for.

### 5.2 Near-universal conditional

**Self-represented party disclosure.** Fires on any type when an SRP is in the deal. The Guide and the Information and Disclosure to Self-represented Party form must both be provided before an agent provides any assistance to a self-represented party. `source: TRESA`. `requiredWhen: hasSelfRepresentedParty`.

**BUILT.** Ships as `srp_disclosure` in `universal.js`, `scope: transaction`, `evidence: document`, `reads: ['hasSelfRepresentedParty']`, spread into all four types. This and the FINTRAC corporation record were the only two conditional items in the catalog until session 59.

### 5.2.1 `data_form` (NEW v10, listing catalogs only, DESIGNED session 65, **BUILT session 69**, `dd5fd3e`)

**Closes parked 7.46.1.** Shipped exactly as designed, appended to both listing catalogs. **One correction surfaced at build time:** the design note said to follow how `deal_sheet` is declared "in `universal.js`", which was wrong on two counts. `deal_sheet` left `universal.js` in session 62's spine split and is declared per deal type, and the codebase's unconditional shape is `reads: []` with `requiredWhen` OMITTED, not `requiredWhen: null`. `annotateItem` short-circuits on `reads.length === 0` and never dereferences `requiredWhen`, so a `null` there would have been inert noise that the next reader copies as if it meant something. The data form was named in section 3's prose and never became an item.

- **Types:** `seller_listing` and `landlord_listing` only. **Unconditional on both**: Mo confirmed a data form is needed for a lease as well.
- **Scope:** `transaction`. It is property-specific, so it does not travel with the client and the 4.5 client-scope transfer never touches it.
- **Evidence:** `document`, **seller-signed**.
- **Source:** `brokerage`, following the `deal_sheet` precedent. Mo's test for it was "we don't close the deal file without the listing paperwork, which that includes," which is a brokerage rule rather than a statute.
- **Id:** `data_form`, deliberately NOT `trreb_data_form`. Signature is a TRREB brokerage, but an Ontario-wide product will onboard agents on other boards whose equivalent form serves the same purpose, and a board-neutral id costs nothing. The LABEL can name whatever the agents call it.

**IT DOES NOT GO ON THE DEAL CATALOGS, and Mo's answer is why.** SkySlope carries the listing documents forward into the offer file automatically, so the agent has no obligation on the offer side, and **a row the agent cannot act on is not a row** (the same test that killed the final walkthrough and the keys row). This also means there is nothing here for the 4.5 transfer filter to carry: the item never exists on the offer catalog to begin with. The listing record still exists after the offer opens per the session-62 split, so the row lives on the file where the work happened.

**Separately: the compliance ROW and the FIELD EXTRACTION are two different things.** The row asks whether a signed data form is in the file. The Path 1B idea from session 55 reads the same document's CONTENTS (taxes, condo fees, inclusions) behind a field-level whitelist. That is a v2 feature and does not change this item.

### 5.2.2 The SPIS is NOT a catalog item (STRUCK session 65, closes 7.46.2)

The Seller Property Information Statement (OREA Form 220) is referenced in section 3's prose and was parked as a catalog gap. **It is struck, and the reason is stronger than a preference.**

Mo works in the deals department at Signature. Every listing file the brokerage processes crosses his desk. **He did not recognise the acronym.** A form his admins chase would not be one he has to ask about; never having seen it means agents there are not using it, and there is no room for a row. The form is optional, sellers can decline, and some brokerages actively discourage it on liability grounds.

**It got into section 3's prose from research, not from the desk.** It stays there as a named instrument, and it stays permanently outside the Path 1B whitelist per the session-55 constraint. Neither of those requires it to be a row. If it ever turns up in a real listing file, it comes back as an item and we will know why.

### 5.2.3 `multiple_representation_agreement` (NEW v14, BUILT session 69, `8e8eb51`)

**Closes the catalog half of 7.43.1**, which has been open since session 59 as "the single highest-risk piece of paper in a double-end and the thing RECO discipline decisions are actually about."

- **Types:** all four DEAL catalogs (`buyer_purchase`, `seller_sale`, `tenant_lease`, `landlord_lease`). NOT the listing catalogs: a double-end is established at offer time, not at listing time. Declared per type following the `deal_sheet` and `srp_disclosure` precedent rather than spread from the spine.
- **Scope:** `transaction`. One agreement covering the situation, signed by both clients. It is not per-person.
- **Evidence:** `document`.
- **Source:** `TRESA`. Multiple representation requires written consent from both clients before the agent may act, which is statutory rather than a brokerage rule, and it matches the justification already used for the buyer and tenant representation agreements.
- **`reads: ['representationArrangement']`, `requiredWhen` fires on `'double_ended'` ONLY.**

**WHY `'designated'` DOES NOT FIRE IT, and the under-ask is deliberate.** Mo's session-59 answer was that a two-agent same-brokerage deal may also require the form, depending on the designated representation arrangement. That turns on a BROKERAGE-level property, not a per-deal one, which is exactly the branching decision 33 kept out of the catalog. Nothing creates a `'designated'` transaction today either. So the case we understand is built and the case that needs a fact we do not have is parked, with the reasoning in a code comment and an explicit test pinning that `'designated'` does not fire it, so the omission is pinned rather than incidental.

**A CONSEQUENCE THAT MOVED A MEASURED NUMBER.** Because the item reads the arrangement, a fresh `buyer_purchase` now resolves THIRTEEN indeterminate rows rather than twelve. That is intended: it makes "is this a double-end?" a deal-open question, and unlike the `entityType` gap in 4.1.6 it is clearable, since the agent can answer it. Section 4.6's derived question set picks it up for free.

### 5.3 FINTRAC (purchase and sale only, granular, `evidence: external_system`)

**Every FINTRAC item below carries `evidence: external_system: fintracker`. There is no document, and there never will be.** Mo confirmed session 55 that FINTRAC records are completed exclusively in the Fintracker app (PropTx-powered, TRREB-distributed), and that brokerage compliance reviews them in the app: no PDF ever enters the deal file.

Consequences, all locked:

- Nothing to extract, nothing to file, and **completion detection can never fire from an instrument** for these items.
- The resolver's value here is completely unchanged, because the REMINDER was always the point. The leases-are-exempt suppression below remains the cleanest proof of the resolver in the whole catalog.
- **This is a privacy win worth saying out loud in sales and in the engagement letter.** Client identity documents are the most sensitive data class in the transaction, and GetKlosed provably never touches them. With a CASA DAST scan and SAQ pending, "we do not store client identity documents, that lives in Fintracker" is a clean answer to a question that would otherwise cost real remediation work.
- Section 7.5 completion detection and the submit-deal-to-brokerage feature both exclude FINTRAC by construction.

**On the Fintracker confirmation email: DETECT IF PRESENT, NEVER REQUIRE.** Fintracker usually emails the agent when a record is submitted. If that confirmation lands, the system proposes the item complete with the email as evidence. If nothing lands, the item stays a manual tick and **the system says nothing about why.** It must never infer non-completion from an absent email. We see one inbox; the mail may be filtered, or sent to a different address than the one the agent gave Fintracker. Inferring an unobserved event is the failure class this project has already been bitten by, and a checklist that accuses an agent of skipping FINTRAC because a machine email hit spam is a product they stop trusting immediately. Store the FACT only (record submitted for this client on this date, linked to the transaction), never body contents, which keeps the no-identity-data claim absolute rather than mostly true.

**FINTRAC does not apply to leases at all.** Real estate brokers have no obligations for property management activity: brokers acting as agents for rental and lease transactions are not subject to the PCMLTFA and its regulations. The boundary is transaction type, not property type. A life lease is a lease for this purpose even though it feels like a purchase.

So `tenant_lease` and `landlord_lease` resolve zero FINTRAC items. This is the cleanest proof of the resolver in the whole catalog: same agent, same client, same week, entirely different applicable set based on transaction type alone.

For `buyer_purchase` and `seller_sale`:

| Item | requiredWhen | Trigger point |
|---|---|---|
| Individual Identification Information Record, per individual client | always | Buyer: offer submitted and/or deposit made. Seller: on accepting an offer. |
| Third-party determination | rides with the info record | With the info record. |
| Corporation / Entity Identification Record | `entityType === 'corporation'` | Before or with the entity Receipt of Funds Record. |
| Receipt of Funds Record | see below | On receipt of deposit funds. |
| Unrepresented party information record + ID | `hasUnrepresentedParty` | Since 2025-10-01, licensees must verify the identity of unrepresented parties and keep an information record on them. |

**Receipt of Funds Record predicate, stated precisely** (Mo's correction, with the edge):

Responsibility falls to the buyer's agent when all parties are represented, per the July 2008 amendments. So:

```
requiredWhen: (side === 'buyer')
           || (side === 'seller' && hasUnrepresentedBuyer && brokerageReceivedFunds)
```

A listing agent taking a deposit from an unrepresented buyer inherits the obligation. That edge is exactly why this is a predicate and not a checkbox.

**Exceptions that resolve the item to not-applicable with a reason** rather than hiding it: no Receipt of Funds Record is required when funds go directly to a lawyer or another party not licensed for trading in real estate, or when received from a financial entity or public body, or when a Large Cash Transaction Record is required instead.

Retention: five years on all of it. Not a checklist item, a note on the item group.

**BUILT session 59 (`1ad09c8` buy side, `ea26dc2` sell side), and three things were settled in the building.**

**1. `side` is not a fact, and the compound predicate dissolved.** The spec wrote the Receipt of Funds predicate as `(side === 'buyer') || (side === 'seller' && hasUnrepresentedBuyer && brokerageReceivedFunds)`. But `buyer_purchase` IS the buy side and `seller_sale` IS the sell side per the section 2 scope boundary, and `CATALOG` is keyed by type. Introducing a `side` fact would create a value that can disagree with `type`, for nothing. **The same item id is therefore DECLARED DIFFERENTLY IN EACH FILE:** unconditional on `buyer_purchase` (`reads: []`, no predicate), and conditional on `seller_sale` (`reads: ['hasSelfRepresentedParty', 'brokerageReceivedFunds']`, both must be true). Same id both sides, so state survives if the agent corrects the transaction type. This is the only place in the catalog where one id behaves differently in two files, and the asymmetry is pinned by a cross-type test.

**2. FINTRAC's "unrepresented party" and TRESA's "self-represented party" are the SAME FACT.** Both describe one human in one situation: the other side has no agent. Shipping two near-identical facts would make the confirm surface ask the agent the same question twice in different words. So `fintrac_unrepresented_party_record` reads `hasSelfRepresentedParty`, the fact `srp_disclosure` already uses.

**Carry this warning:** the fact means something DIFFERENT by type. On `buyer_purchase` it means the seller is unrepresented; on `seller_sale` it means the buyer is unrepresented. That is safe today because the catalogs are separate files and each is internally consistent, and it is the right trade against asking the agent twice, but it reads as obviously fine now and confusing later. Anything that surfaces this fact to an agent must phrase it per type.

**4. CORPORATE CLIENT IDENTIFICATION IS CLIENT-SCOPED (session 62, `9ee2b5b`), and it was wrong until then.** `fintrac_corporation_identification_record` was `scope: 'transaction'` while its sibling `fintrac_individual_identification_record` was `client/event`. Both identify the client for FINTRAC, which Mo confirmed is not redone per transaction, so a numbered company selling two properties would have had the individual record inherit and the corporation record not. The corporation record is now `scope: 'client'`, `clientScope: 'event'`, predicate and `reads` unchanged.

**5. ARTICLES OF INCORPORATION is a new item (session 62, `9ee2b5b`).** Mo named it alongside the corporation record: both are needed when the client is a corporation. `fintrac_articles_of_incorporation`, same `entityType === 'corporation'` predicate, same `client/event` scope, `evidence: external_system`, Fintracker. It does NOT become a document item: the no-PDF-enters-the-deal-file rule above holds. On whether the system can know a client is a corporation, Mo's framing was "we do not have to demand it, just let them know it might be needed" -- which is `indeterminate`, already built. Absent `entityType` means the item renders as a visible row, uncounted at close, not demanded.

**6. THIS CHANGE MADE A LATENT RESOLVER DEFECT REACHABLE (session 62, same commit).** The corporation record became the FIRST catalog item that is both client-scoped and conditionally resolved. `withClientSatisfaction` attached `satisfiedPersons` and `outstandingPersons` without inspecting applicability, so a not-applicable corporation record would have emitted `outstandingPersons: ['p1','p2']`, asserting two people failed an obligation that does not apply to them. Nothing had exposed it because every prior client/event item has `reads: []` and always resolves required. Emission is now gated by applicability: **required emits both; `not_applicable` emits `satisfiedPersons` only**, preserving evidence of who was checked without naming anyone outstanding; **`indeterminate` emits neither**, on the same reasoning already written at `resolver.js:114-118` for absent `representedPersons`. `no_longer_applicable` needs no branch: it is assigned in `reResolve` after resolution and structurally cannot reach `withClientSatisfaction`.

**7. `externalSystem` is `'Fintracker'`, capitalised.** Earlier prose in this section wrote it lowercase. It is a product name and will appear in agent-facing chase copy, so the capitalised form wins and every one of the nine FINTRAC items across both types carries it identically.

**THE EXCEPTIONS ARE DEFERRED, DELIBERATELY.** The exceptions listed above (funds to a lawyer, funds from a financial entity or public body, a Large Cash Transaction Record required instead) were NOT built, for two reasons. Each exception is another entry in `reads`, and every added read keeps the item `indeterminate` until the agent answers it: six questions before an item will say anything is a worse product than an item that fires and gets ticked off. More importantly, **`notApplicableReason` is a SINGLE STRING per item**, so an item with four possible causes can state only one, and naming the wrong cause is the assert-what-you-were-not-told failure this project keeps getting bitten by. That needs either a reason function or per-branch reasons, which is an item-shape change. On the sell side the largest exception is already covered incidentally: funds going to a lawyer means `brokerageReceivedFunds` is false, so the item correctly does not fire.

**The lease exemption is now enforced by a test**, asserting that neither lease type resolves any item with `source: 'FINTRAC'`. This is the cleanest proof of the resolver in the whole catalog and it is pinned rather than assumed.

### 5.4 Conditions (buyer_purchase, seller_sale). BUILT session 60 (`a57ec8d`), AMENDED from the v5 text.

Eight items, all `source: 'APS'`, `scope: 'transaction'`, `evidence: 'document'`, all reading one
fact, `conditions`. They ship in `rules/conditions.js` and spread into `buyer_purchase` and
`seller_sale` identically, because the listing side tracks the same clearing instruments as the buy
side. Mo confirmed the listing file carries the waivers and notices too.

`conditions` is an array of `'financing' | 'inspection' | 'status_certificate' | 'sale_of_property' |
'solicitor_approval' | 'insurance' | 'well_septic'`. **The v5 abbreviation `sop` was spelled out**,
because an abbreviation that reads as standard-operating-procedure in a fact array is a bug waiting
for a new reader. Absent means indeterminate. `[]` is a real answer meaning the deal is firm and all
eight resolve not-applicable.

The eight: `financing_condition`, `inspection_condition`, `sale_of_property_condition`,
`solicitor_approval_condition`, `insurance_condition`, `well_septic_condition`,
`status_certificate_receipt`, `status_certificate_review`. **Solicitor approval and insurance were
missing from the v5 table** and Mo named both as main-line conditions; well and septic is rarer but
real.

**THE DATES ARE NOT IN THE RESOLVER, and this reverses the v5 framing.** v5 called a condition a
triple of date, document and clearing instrument, and gave the status certificate four sub-items
including a derived 10-day statutory clock. **A row is an obligation you satisfy; you do not satisfy
a date.** Condition dates are deal-driving deadlines on the transaction record and keep Rule 1's
confirm gate. The 10-day supply window and the lawyer review window are chase-engine arithmetic
(section 8), not resolver output, because the resolver has no clock by design.

**The status certificate is TWO rows, not four.** Mo: received, and reviewed-slash-cleared. **There
is no ORDERED row**, and two independent reasons converged on that. Mo's file does not carry one,
and brokerage admin never sees the ordering step at all, which makes ordering agent workflow rather
than a compliance obligation. Both rows read the same condition name: one condition, two obligations.

**The compound predicate dissolved, same as `side` did in 5.3.** v5 gated the status certificate on
`propertyType === 'condo' && conditions.includes('status_cert')`. If the agent recorded a status
certificate condition, the property is a condo. The second read buys nothing except the ability to
hold the item indeterminate while waiting on an answer nobody needs to give. `propertyType` has zero
hits anywhere in `src/transactions/`.

**`source: 'APS'` and the status certificate will look wrong to a future reader. It is not.** The
status certificate is a creature of the Condominium Act and the 10-day supply window and fee cap are
statutory, so `RTA`-style regulatory sourcing looks natural. But the CORPORATION's duty to supply is
statutory; the AGENT's duty to obtain and review comes entirely from the condition clause in the
agreement. No condition, no obligation, no row. Per decision 32, `source` names the authority behind
the obligation, and that authority is the APS. **Do not add a seventh enum value.** `APS` was already
in the allowlist and unused, so nothing was widened.

**THE CLEARING INSTRUMENT IS THREE THINGS, NOT TWO, and one of them is ambiguous.** v5 modelled
`waiver | notice_of_fulfilment`. Mo: amendments are used all the time to clear conditions, and also
to change them, for instance extending an expiry date. So the labels name all three. **A structured
`clearingInstrument` field was NOT added.** It would be a fifth `STATE_FIELDS` entry with its own
break-the-fix, and nothing consumes the structured value until the 7.5 detector exists to pre-select
it. Which instrument satisfied a row is what the `note` field is for.

**The amendment is a DEAL-MUTATION instrument and section 7.5 cannot route it by document type.**
Every other instrument the detector watches maps to one item: a waiver clears a condition that
exists. An amendment may clear a condition, may move a condition date, may change price, chattels or
the closing date, and may touch nothing the checklist holds. **Mo was explicit that amending things
other than conditions is common, not an edge case.** So an amendment must never propose a completion.
It goes through Rule 1 instead: an amendment that moves a confirmed deal-driving deadline
re-proposes that date as unconfirmed rather than silently overwriting a value the agent already
verified, and ignoring it is worse, because the file would then show a date the deal no longer has.
Section 4.2 already anticipates half of this for listing extensions.

**`conditions` records what the AGREEMENT CONTAINED, never what is still open.** It is tempting to
shrink the array as conditions clear. That would resolve the row not-applicable and destroy the
evidence that the condition ever existed or that it was cleared. The row survives with `completed`
true. Same axis split as 4.1.4.

**A LOUD-FAILURE HELPER, and it is the reason this section needed code at all.** The resolver's
presence check treats `null` as PRESENT, so `conditions: null` reaches the predicate, where
`.includes()` would throw an unhelpful `TypeError`. A module-internal `hasCondition(facts, name)`
throws with a message naming the fact and its actual type, special-casing `null` so it does not
report as `object`. **An `Array.isArray(...) && ...` guard was explicitly rejected**: returning false
would resolve all eight rows not-applicable with the reason "no financing condition in the
agreement", which is a fact nobody supplied, on the rows that decide whether a deal is firm.

**DEFERRED, deliberately.** Agent-defined free-text conditions (the v5 table's "Other" row) are
7.41.4, agent-added paperwork, and are confirm-surface work rather than resolver work. Whose
condition it is, buyer-side or seller-side, is not modelled: the flat array does not distinguish, and
the item fires either way.

### 5.5 Lease-specific (RTA, not FINTRAC). BUILT session 58 (`114c5cf`), AMENDED from the v4 text.

`landlord_lease` and `tenant_lease` swap the entire FINTRAC block for a much smaller RTA block. **The v4 version of this section was wrong in two places and Mo's brokerage vocabulary corrected both.**

**AMENDMENT 1: THE DEPOSIT IS DATA, NOT A RULE, and this REVERSES an earlier position.** The v4 guard rail said the system must never PRESENT a security or damage deposit item, which is correct. Claude then slid from there into the system ENFORCING a one-rental-period cap, which nobody specified. **Mo pushed back with field evidence: prepaid multi-month deposits ("first and last 6 months") happen all the time, he has seen security deposits too, and it is whatever Form 400 says.** A tracker that refuses to record what the agreement actually says is not protecting anyone; it is wrong about the deal in front of it, and Rule 3 already makes the brokerage the system of record.

**LOCKED: no cap, no count field, no validation, no warning copy.** Deposit amount and type ride in as facts off the agreement. The useful residue survives in a narrower form: **the system RECORDS deposit terms and never PROPOSES them.** No catalog item suggests a deposit type or amount not already in the agreement, which is Rule 2 anyway. **The negative assertion SHIPPED** and iterates all of `CATALOG`: no item may carry security or damage in its id or label.

*Recorded for accuracy, not as product direction:* the one-rental-period cap and the security/damage prohibition are real Ontario law; the contrary practice is widespread because it is almost never litigated; and the exposure sits with the landlord, not the agent papering Form 400.

**AMENDMENT 2: Form 400 and the Ontario Standard Lease are TWO OBLIGATIONS, not one.** The v4 text listed the Standard Lease as a flat RTA item and collapsed two different obligations with different owners. Mo: his brokerage only requires Form 400 to close; the Standard Lease must be done between landlord and tenant but the brokerage does not need it; and sometimes there is no Form 400, in which case the brokerage needs the Standard Lease or a commission agreement.

**Mo's resolution is cleaner than the disjunction it replaced: BOTH items always fire, always ask for both, and if an agent uploads a commission agreement instead it satisfies the item with a note.** What varies between brokerages is what they will ACCEPT to close, which is a SATISFACTION question, not a RESOLUTION question (see 4.1.4). That killed a proposed per-brokerage `source: 'brokerage'` tier before it was built, and no branching entered the catalog.

**`source` NAMES THE AUTHORITY, NOT THE PUBLISHER.** `VALID_SOURCES` is a six-value allowlist (`TRESA`, `FINTRAC`, `RTA`, `APS`, `brokerage`, `agent`). `OREA` was specified for Form 400 and was wrong independent of the allowlist: every permitted value names WHY THE OBLIGATION EXISTS. Form 400 is on the file because the brokerage requires it to close and pay commission; the RTA mandates the Standard Lease, not Form 400. So Form 400 is `source: 'brokerage'`. Allowlist NOT widened.

**THE ITEM SET AS SHIPPED, and the per-side asymmetry is the point.** The two sides are NOT mirror images.

- **Both types:** `agreement_to_lease` (Form 400, `brokerage`), `ontario_standard_lease` (`RTA`).
- **Landlord side:** `signed_lease_copy_delivered` (`RTA`), `deposit_slip_received`, `deposit_forwarded_to_accounting`, `brokerage_deposit_receipt_issued`, `first_month_rent_received`, `keys_delivered`.
- **Tenant side:** `signed_lease_copy_received`, `deposit_obtained_from_tenant`, `deposit_delivered_to_listing_agent`, `brokerage_deposit_receipt_received`, `first_month_rent_paid`, `keys_received`.

**THE DEPOSIT IS THREE BEATS, NOT ONE, and the gap between them is what gets dropped.** The agent gets a deposit slip; the brokerage must send it to accounting to issue an official receipt; a listing agent holding the slip still needs to forward it, and a tenant agent gets the slip from the tenant and forwards it to the listing agent. **A slip sitting in an inbox, never forwarded, is invisible today and looks identical to a closed loop.** One item cannot represent that; three can. It also makes the AI's job EASIER, because it never has to be certain a document is a slip versus a receipt: Rule 2 means it only proposes, and distinct labels give a one-tap correction. The receipt appears on BOTH sides from opposite ends, which is why participants are modelled by role.

**The 21-day rule** (landlord must give the tenant a copy of any written lease within 21 days after the tenant signs, with the teeth on the tenant side) **is in the LABEL, not a date field**, because no clock exists in the resolver. This is exactly the shape of item the product exists for: nobody chases it, it has a real consequence, and it is invisible until it bites.

### 5.6 Closing. DELIBERATELY EMPTY as of session 60 (`dce1533`).

**There are no closing items. This is a result, not an oversight, and it is written out at length so
that a future reader does not restore the v5 list.**

Every one of the eight v5 bullets was run against one test, does the agent's file record this as an
agent obligation, and none survived:

- **Closing date and requisition date are transaction FIELDS.** A row is something you satisfy. The
  closing date is one of the three deal-driving deadlines keeping Rule 1's confirm gate. The
  requisition date the v5 text already flagged as lawyer-owned, with a warning that the copy must not
  imply we own it, which is an argument against the row existing rather than a note about wording.
- **Trade record and commission paperwork are handled by brokerage admin, not the agent.** Mo's
  brokerage keeps and processes these; the agent does not touch them.
- **Lawyer details are optional contact reference.** Mo's file has a contacts subsection holding both
  sides' lawyers, the client, and the co-operating brokerage. **None of it is required to fill.** It
  is a lookup area, not a checklist. It belongs to section 6 participants.
- **No final walkthrough row and no keys row.** Neither reaches the file.
- **No insurance binder.** Mo: that sits with the lawyer and the lender.
- **The utilities and address-change reminder has nowhere to live.** Applicability is three-valued,
  `required | not_applicable | indeterminate`. There is no `optional`. The resolver's only way to
  surface a courtesy nudge is to call it required, which asserts an obligation that does not exist,
  on the section where the agent is already busiest. It also mislabelled `source: 'agent'`, which is
  reserved for agent-added paperwork, not system-authored nudges. A fourth applicability value is an
  item-shape change and does not ride along with catalog data.

**The principle: closing is when the brokerage VERIFIES obligations that already exist, not when new
obligations appear.** Everything the file checks at closing was created back in 5.1 through 5.4. The
lease types end at the executed lease and have no closing set at all.

**One item did come out of this conversation, and it went into the universal spine instead:
`deal_sheet`.** Mo's brokerage requires a deal sheet on every deal including referrals, and the agent
can submit it with the rest of the paperwork rather than at closing, which is why it is not a closing
item. It is the **first universal item whose authority is the brokerage rather than TRESA**, and
probably the most reliably chased of the three, because it is the one attached to the commission.
The label is `Deal sheet or brokerage submission summary on file` and deliberately does not say only
"deal sheet": Mo only knows his own brokerage's term, but every brokerage requires some submission
summary before releasing commission. The obligation is universal, the instrument name is not.
Decision 33 applies, so no `brokerageRequiresDealSheet` fact and no per-brokerage branching.

**THE COMMISSION REVIEW IS THE PRODUCT THESIS, stated from the other side.** Mo, on what happens at
closing: the deal is checked to make sure everything is marked complete before any commission is paid
out. Agents do not lie awake over TRESA. They lie awake over a held cheque. **Every row the TC
resolves is something standing between the agent and getting paid**, which is a better pitch than
compliance and should be carried into the sales material.

### 5.7 Terminal-state items. BUILT session 60 (`f8d8e29`).

**One item: `mutual_release`**, `source: 'brokerage'`, `terminalOnly: true`, spread into all four
types, ABSENT from the resolved set unless state is `collapsed` (see 4.1.5 for why absent rather than
not-applicable).

Mo's framing is the requirement: the mutual release should not be required, or even brought up,
unless the deal falls through. The trigger is a state transition, which `states.js` already models,
so the agent's "deal fell through" action is a transition that re-resolves and makes the row appear.
The system never decides a deal died.

**DEPOSIT DISPOSITION WAS REJECTED, reversing the v5 text.** Mo: the brokerage requires only the
mutual release, then it releases the funds and informs the co-operating side for pickup. The agent
submits the release and waits. **A row for something the agent cannot act on sits outstanding forever
and teaches agents to ignore the checklist.** Pinned by a negative assertion across the whole catalog,
matching the security-deposit test in 5.5, so it does not get added back.

**Detecting a mutual release from email is the most dangerous case in section 7.5.** Every other
instrument the detector watches confirms something already true. A mutual release means someone is
PROPOSING that the deal ends, and it typically arrives unsigned, going out for signature. Detecting
one on a deal that is being renegotiated and will close fine is the worst false positive in the
product. It must propose the transition and never take it, and it wants a higher confidence bar than
the other instruments. Same asymmetry as deal-open detection.

## 6. Participants (REWRITTEN v11, BUILT session 66)

Modeled with roles, not a bag of email addresses. "Waiting on the buyer's lawyer" beats "waiting on john.lawyer@gmail.com", and FINTRAC record-keeping is per-person-per-role, so the resolver needs the role model regardless of how the summaries read.

Roles: `client` (buyer/seller/tenant/landlord), `co_client`, `opposing_party`, `opposing_agent`, `client_lawyer`, `opposing_lawyer`, `mortgage_broker`, `inspector`, `condo_manager`, `brokerage_admin`, `other`.

`emails` is an array because the single biggest matching failure is a participant corresponding from an address other than the one on file.

### 6.0 The five decisions that shaped the model (LOCKED session 66, from Mo's answers)

**TRANSACTION-SCOPED, not agent-scoped.** A participant record belongs to one deal. The same lawyer on thirty deals is thirty records. The alternative, an agent-level roster that transactions reference, would let a lawyer accumulate email addresses across deals and make section 7.1 matching improve on its own, which is a real loss. It was rejected because correcting a name would then change history on closed files, and a deal file must be a snapshot of who was involved AT THE TIME, which is what a brokerage audit asks for. **The consequence is that section 6.1 auto-discovery is not optional polish: it is what buys back the accumulation this decision gives up.**

**KEYED BY A GENERATED ID, not by name.** Ids are `per-` plus 8 hex characters, following `generateTransactionId`'s convention (`crypto.randomBytes(4)`, no collision handling). Names were the alternative and they were rejected on a specific failure: with a name as the key, fixing a typo silently orphans every satisfaction record keyed to the old spelling, the item returns to outstanding, and nothing says why. **A system where correcting a spelling can lose a FINTRAC verification record is a system that will eventually lose one.** The cost is that a human must look an id up, which is what section 6.3's verbs exist for.

**`roles` IS AN ARRAY.** One person can hold two roles on one transaction: a self-represented seller who is also the property manager is one human with two hats, not two records (Mo's field evidence). An agent representing both sides is expressible for the same reason, though that is multiple representation with its own disclosure obligation and its own parked item.

**ROLES ARE SET-ONCE.** A role never changes mid-deal (Mo: lawyers may change, that is about all, and an agent cannot become the listing agent on a relist because that is a brand new transaction). So a replaced lawyer means the old participant STAYS on the file and a new one is added. Both remain. There is no `updateParticipantRole` and none should be added: a changed role is a new participant, not a mutation of an old one. Same discipline as never shrinking `conditions`.

**ROLE COMBINATIONS ARE NOT VALIDATED.** A lawyer cannot lawfully represent both sides, and the system could refuse to record it. It does not. Rule 3 says the TC predicts what SkySlope will bounce; it is not the regulator, and a guard that fires on a legitimate edge would block the agent from recording what actually happened. The shape is allowed and visible rather than refused.

### 6.1 Participant auto-discovery (REWRITTEN v12. The v2 design was a one-shot at deal open. It cannot work.)

**IT CANNOT BOOTSTRAP. IT ACCUMULATES.** To seed participants from a thread you must know which transaction the thread belongs to. To know that, you must match. To match on signal B you need participants. **So auto-discovery can only ever run on threads that already matched by other means.** The v2 text fired it once, when the deal-open detector fires. That is wrong twice over: 7.4 is not built, and manual deal-open through `scripts/open-transaction.js` has no thread to scan at all.

The correct shape is a **continuous accumulator on already-matched threads.** First contact on any thread comes from signal A plus signal C, or from the agent. After that, everyone on the thread is known and later messages match more easily.

**THE GATE IS SIGNAL D's GATE, and it costs nothing new.** Seed only from threads carrying an AGENT-CONFIRMED filing, the exact condition signal D already uses, for the exact reason stated there: one wrong match must not propagate down a whole thread. Without that gate a bad match seeds bad participants which cause more bad matches, which is positive feedback on an error written to a compliance record. `hasConfirmedFilingOnThread` (7.12) is that gate and it is built.

**THE v2 TEXT CONTAINS A BUG THAT WOULD COLLAPSE THE MATCHING RULE.** It says sender and recipient addresses are candidates. **The agent's own address is a recipient on every thread of every transaction.** Seed it and signal B is true for every message against every transaction, which silently reduces two-of-three to one-of-three, and A-alone and C-alone were both excluded by name in 7.1.1 for stated reasons.

**THE EXCLUSION LIST CANNOT BE WRITTEN, AND THAT IS A FINDING RATHER THAN A GAP.** Asked which addresses are structurally on every deal thread, Mo named deals administrator, listings, offers, front desk, design, lawyers, co-operating brokerage agent and admin, and clients. That is the entire cast of a deal. There is no subset that is always present and never deal-specific except one. **So: exclude the agent's own address, nothing else.** Brokerage departments appear on many threads but not all, and often on the ones that matter; excluding them throws away real signal.

That leaves the brokerage-department problem unsolved rather than excluded, and that is the right answer. **Signal B's stated weakness is that it is not discriminating** (a lawyer acts on several of an agent's deals at once). Brokerage departments are the same shape, more so. That is not a reason to exclude them; it is the reason B alone was never sufficient. `deals@brokerage` firing B on six open transactions is fine, because each still needs a second signal, and A and C are address-anchored so they can only fire for the transaction the message is actually about. The only address that breaks two-of-three is one that is ALWAYS true, and only the agent's own does that.

**ROLES ARE NOT INFERRED. THIS IS THE LOAD-BEARING DIVERGENCE FROM v2.** The v2 text inferred roles from domains and signature blocks via Haiku, degrading to `other`. Two problems. **Roles are set-once** (6.0), so a wrongly-inferred role is permanent and correcting it means adding a second participant while the wrong one stays on the file forever. That is a durable silent write produced by a guess, which is exactly the cost structure that rejected `listingId` auto-linking in 7.9. **And it would put a model call inside the matching path**, which 7.1.1 deliberately keeps pure.

**SO THE ADDRESSES ARE SEPARATED FROM THE PEOPLE.** What signal B needs is addresses; roles matter for chase drafting and FINTRAC, not for matching. `observedAddresses` (7.13) is a new top-level map recording addresses seen on threads with a confirmed filing, and signal B reads participants' `emails[]` OR observed addresses. **Participants stay exactly what they are today: a human-asserted cast, audit-quality.** Observed addresses are machine-observed evidence, honestly labelled. No guessed role, no model call, no durable wrong write, and an auditor reading the file sees a curated cast plus a correspondence log, both of which are true statements.

**ATTRIBUTION TO A PERSON IS NEVER ATTEMPTED.** Mo: the lawyer is sometimes cc'd and sometimes not, and the sender may be their assistant or their admin. So an unfamiliar address arrives cold often enough to matter, and guessing which human it belongs to would be a write. It is recorded as an observed address and nothing more. Promoting an observed address onto a participant's `emails[]` is an agent action, not an inference.

**THAT AGENT ACTION DOES NOT EXIST, AND IT CANNOT BE ADDED WITHOUT CUTTING AGAINST THIS MODULE'S OWN HEADER (found session 68).** Recon established that `addParticipant` is the ONLY writer of `participants[].emails[]` anywhere in `src/` or `scripts/` (`participants.js:117-120`), and it writes only at participant CREATION. There is no code path to add an email to an existing participant record, and `participants.js`'s header states the module ships an add path only, on the reasoning that ROLES are set-once. **Nothing ever decided that EMAILS were set-once; the module made them so as a side effect of the roles rule.** A replaced lawyer being a new participant is a sound rule about roles. An address learned about an EXISTING participant three weeks into a deal is not a new person and should not require inventing one.

So 6.1's promotion step is specified against a verb that has never been built. **This is a real gap in 6.1's design, not merely a missing CLI**, and it must be settled before 6.1 can be called complete. Until then `emails[]` can only ever hold what a human typed at the instant a participant was created, which on an auto-discovered participant is nothing, and `observedAddresses` is not a supplementary source for signal B but the ONLY live one.

**THE VERB IS BUILT AS OF v18 (`923640c`). See 6.6.** `addParticipantEmail` is the promotion step: appending an address to an existing participant is precisely the agent saying "that observed address is Dave," which is a judgment and not an inference, exactly as this section requires. `emails[]` was never decided to be set-once and is no longer treated as such. **What is still NOT closed is that `observedAddresses` remains the only live source for signal B, because `addParticipant` has no live caller either** (v18 headline). 6.1 is now blocked on participant CREATION rather than on promotion, which is 6.7.

**WHAT 6.1 ACTUALLY BUYS, stated honestly against the corpus.** It does NOT close the attachment-only case in general. The lawyer's "Documents / please see attached" message matches only when the filename carries an address, which in the sampled corpus is one file in four. **The pair 6.1 really unlocks is A plus B**, because Mo says the address is in the subject most of the time and B is the half that can be built. The attachment-only case stays broken until signal E (7.11) reads the document, where the address demonstrably is.

#### 6.1 as written in v2, SUPERSEDED, kept for cross-reference

The email thread already contains the cast. When the deal-open detector fires (section 7.4), the assembler scans the triggering thread and proposes the participant list:

- Sender and recipient addresses are candidates.
- Email domain and signature blocks suggest roles: a law-firm domain or "Barrister & Solicitor" signature proposes `client_lawyer` or `opposing_lawyer` (side inferred from which client the thread references), a brokerage domain proposes `opposing_agent`, a lender or broker signature proposes `mortgage_broker`.
- Every address observed in the thread seeds the `emails[]` array of the participant it is cast to, which directly improves section 7.1 matching for the life of the deal.

Rule 2 applies in full: the cast list is a proposal on the deal-open confirmation screen. The agent corrects roles, merges duplicates, and removes bystanders before confirming. Auto-discovery buys pre-population, never commitment. Role inference runs on the same Haiku path as classification; a failed inference degrades to `other` with the address attached, never to omission.

### 6.2 The participant record (NEW v11, BUILT session 66, `63a7aa0`)

`src/transactions/participants.js`. A new top-level `participants` map on the transaction, alongside `facts`, `items` and `filings`.

**No store change was required.** `validateEnvelope` is a positive checklist, not a closed schema, and `store.js` states in its own comment that every other key passes through untouched. Shape validation for `participants` is a deliberate later decision, not something this commit skipped.

**Shape:** `{ roles, name?, emails?, phone?, entityType?, isSelfRepresented? }`. `roles` is required and must be a non-empty array of non-empty strings. Every other field is ABSENT when it has no value, never null, following `listingId` and `unit`. Explicitly passing null throws; passing undefined omits the key entirely.

**First write is LAZY**, `participants: { ...(previous.participants || {}), [id]: entry }`, matching `items`, `filings` and `clientSatisfactions`. `createTransaction` is not changed and seeds nothing.

**One event kind, `participant_added`**, through `makeEvent` as always. `EVENT_KINDS` is now twelve.

**`name` IS OPTIONAL AND THAT IS LOAD-BEARING.** Auto-discovery (6.1) will often produce a bare email address with no name attached, and a required name would mean it could not propose that participant at all. The consequence is that a represented participant can exist whom no name lookup can ever reach, which is why 6.3's verbs matter and why the resolver in 6.3 reports a nameless count rather than a bare miss.

**AMENDED v19: THE FIELDS ARE NOW VALIDATED AGAINST CLOSED VOCABULARIES, AND THE VALIDATION IS SHARED.**

- **`roles` must come from `PARTICIPANT_ROLES`** (`bbd2d32`): the eleven roles above plus `property_manager`, twelve in total, exported and frozen. Exact comparison, no trimming or lowercasing; a duplicate role within one array is refused. Errors name the value with `JSON.stringify` so whitespace is visible. **Role COMBINATIONS are still not validated** (6.0); only the vocabulary is.
- **`entityType` must come from `ENTITY_TYPES`** (`28b3f91`): `individual`, `corporation`, `other_entity`. Absent still means unknown. `other_entity` covers estates, trusts and partnerships. **This is the participant field only.** `facts.entityType`, which the corporate FINTRAC items read, is a separate unconstrained deal-level fact; its rules test for `'corporation'`, so the spellings agree, but nothing enforces it (PROJECT_STATE 7.53.1).
- **`assertParticipantFields(fnName, fields)` is exported** (`865de2c`) and holds every check `addParticipant` applies to its six fields, with messages prefixed by the caller's name. The proposal store calls the same function, so a proposal accepted at creation cannot be refused at confirmation.
- **Why now:** no participant exists in production, so tightening costs nothing. **Adding a value to either list is safe at any time; removing or renaming one is not**, because a stored participant can already hold it.

### 6.3 `representedPersons` DERIVES from participants (NEW v11, BUILT session 66, `64cf261` and `769ad76`)

**This is the first TC commit that changed existing behaviour rather than adding an inert module.** It was free because a Railway check confirmed `$STORAGE_ROOT` still contained no `mo-test.transactions/` directory, so no persisted record needed migrating. **That window closes the moment the orchestrator files a document for real.**

**`deriveRepresentedPersons(participants)`** returns the ids of participants whose `roles` include `client` or `co_client`, via a shared `isRepresented` predicate so no two call sites can disagree about who counts.

**IT RETURNS `undefined`, NEVER AN EMPTY ARRAY, and this is the single most important line in the module.** `resolver.js` treats an absent `representedPersons` as a distinct meaningful state: we were never told who is on the deal, so it emits neither `satisfiedPersons` nor `outstandingPersons`. An empty array would flow through as "zero people outstanding" and render a deal nobody has been named on as ALL CLEAR. Absent means unknown; empty would mean known-to-be-nobody, and the derivation is never in a position to assert that. A test pins the distinction and a break-the-fix confirmed it fails loudly when violated.

**An earlier plan to make absence THROW was wrong and was reversed in design.** With participants opening empty by decision, absence is the ordinary condition of every deal early in its life, including at close. Making it throw would have blown up the checklist read path for any deal before someone was named.

**`checklist.js` deletes any stale stored `facts.representedPersons` before deriving.** The derivation is the only source. That delete line matters only on the undefined branch, where a stale array would otherwise leak through and produce a false all-clear, and it has its own test for exactly that case.

**The authorization gate moved.** `satisfactions.js` used to check `representedPersons.includes(personId)`. It now asks the participant record directly, with three distinct error messages because they are three different mistakes: no participants at all, an id naming nobody, and an id naming someone who holds no qualifying role.

**`representedPersons` is REMOVED from `FACT_KEYS`,** so `setFact`, `confirmFact` and `correctFact` all refuse it. This follows the precedent already in `factKeys.js` for `clientSatisfactions`: each has its own writer, and `setFact` would be a second competing writer for a value that already has a real one. A generic "unknown fact key" message was accepted over a pointer at `addParticipant`, because matching the existing exclusion exactly is worth more than a marginally better error string.

### 6.4 CLI verbs (NEW v11, BUILT session 66)

**`resolveParticipantByName(participants, name)` RETURNS A RESULT OBJECT, IT DOES NOT THROW.** This follows `compareAddresses`: the module returns data and the caller decides what a miss means. A dashboard will eventually render an ambiguity as a picker rather than catch an exception and parse names back out of a message string.

- Exactly one match: `{ resolved: true, id }`
- No match: `{ resolved: false, reason: 'not_found', namelessCount }`
- More than one: `{ resolved: false, reason: 'ambiguous', candidates }`
- **No LIVE match but a voided one (NEW v18, `b2a96fd`): `{ resolved: false, reason: 'voided', id, voidReason }`**

**IT TAKES THE TRANSACTION, NOT THE PARTICIPANTS MAP (AMENDED v18).** Voiding moves a participant between two maps (6.5), so telling "no longer on this deal" apart from "there is no Dave here" requires reading both. **An optional third `voidedParticipants` parameter was rejected**: a caller that omits it gets `not_found` where the answer was `voided`, with nothing failing, which is the exact silent-degradation class 6.5 is designed to make unrepresentable. A required parameter does not fix it either, since a transaction with no voided participants legitimately has nothing to pass. **The honest parameter is the thing that owns both maps.** The function needs two collections that must agree; passing the envelope makes disagreement impossible to express.

**The voided lookup is scoped by `isRepresented`, matching the live path**, and a test asserts that a voided NON-represented participant returns `not_found` rather than `voided`, so the scoping is asserted rather than incidental.

**`satisfy-person.js` still REFUSES a voided person.** It refuses with an accurate message that names the void reason, instead of a misleading "not found". You cannot satisfy an item against someone who is no longer party to the deal; the change is what the refusal says, not what it does.

**KNOWN LIMITATION, ACCEPTED v18 AND DELIBERATELY NOT FIXED.** The id-shaped argument path short-circuits before resolution and reaches `assertRepresented`, which reads only the live map. **So a voided id and a never-existed id produce the same message on the id path.** Fixing it would mean editing `satisfactions.js` and abandoning `satisfy-person.js`'s own documented design that an id-shaped argument is passed through unvalidated and its failure belongs to the writer. Exposure is low: `list-participants.js` stops printing voided people, so the only sources of a voided id are an old terminal scrape or the event log.

**Scoped to REPRESENTED participants only.** A lawyer named Jane Smith must not resolve, because the writer would reject that id one layer down with a different error and by then the name the caller typed is gone from the message. One error, at the layer where the name still exists.

**Matching is trim-and-lowercase equality, nothing looser.** The old strict-equality rule was protecting a STORED value; now the name is only a lookup handle and the id is what persists, so the strictness bought nothing. Substring and prefix matching were rejected because they make behaviour depend on who else is on the file: a name that resolves cleanly today would go ambiguous next month when a co-client is added.

**`namelessCount` exists so the CLI cannot lie by omission.** Without it, the tool would report "no participant named John Smith" on a deal where John is sitting there with no name recorded.

**`scripts/satisfy-person.js`** takes an id or a name. An argument matching `PARTICIPANT_ID_RE` passes through unvalidated; anything else resolves. Success prints both name and id. A known consequence: a case-mangled id is no longer id-shaped, so it routes to name resolution and fails there instead of at the writer. The guarantee that a wrong-case id never silently matches still holds.

**`scripts/list-participants.js`** is read-only and shows ALL participants with represented ones marked, because a lawyer cannot be satisfied but you may still need their id. It is how a nameless participant is reached at all. A test asserts the transaction file is byte-identical after running.

### 6.5 VOIDING a participant (NEW v18, BUILT session 74, `b2a96fd`)

**WHY THIS EXISTS AT ALL, AND IT IS A CONSEQUENCE OF 6.7 RATHER THAN OF 6.0.** Created-once was written for a world where creation was deliberate: a human typed a participant, so a wrong one was rare and permanence was cheap. **Once an extractor proposes participants off a flattened PDF, wrong ones are routine**, and a model where every mistake is permanent accumulates garbage on a record with a five-year retention duty. Mo's call, and it is right. **The correction path therefore ships BEFORE the creation path**, which is why this is commit one of the v18 order and 6.7 is commit four.

**FOUR THINGS CAUSE A VOID, and they collapse into two.** The extractor misread the document; the agent tapped confirm too fast; the role was wrong (the person belongs, the label does not, and since roles are set-once per 6.0 the fix is void-and-recreate). Those three are CORRECTIONS: the record should read as if the mistake never happened. The fourth is real succession, a lawyer replaced mid-deal, where nothing was ever wrong and the file should show that Dave was here from March to April and then Susan took over. **Mo wants the succession case tracked even though brokerage records could also answer it.**

**SO THE REASON HAS EXACTLY TWO VALUES**, a frozen exported vocabulary: recorded-in-error and no-longer-on-deal. **Two buttons, not a form field.** The system cannot infer which it is: a voided lawyer followed by a new lawyer looks identical whether the first was a hallucination or a real person who got fired. Only the agent knows. Same line this model holds everywhere: observe what is observable, ask for what is not.

**VOIDING MOVES THE PARTICIPANT. IT IS NOT A FLAG.** The entry is deleted from `participants` and written into a sibling top-level `voidedParticipants` map, keeping the record unchanged and gaining the void time, actor and reason.

**A FLAG WAS REJECTED, AND SO WAS AN ACCESSOR, AND THE REASONING IS THE POINT.** `participants` is a plain map on the envelope and recon found SIX direct readers, all reading it raw: `collectKnownAddresses`, `assertRepresented`, `deriveRepresentedPersons`, `checklist.js`, `resolveParticipantByName`, and `scripts/list-participants.js`. A `voided` flag means all six keep counting voided people until someone remembers to filter each one. Adding a live-only accessor and migrating the six is better and still not enough: **the raw map stays readable, so consumer seven gets written against it and nothing complains.** That is the `digest.js` agent-discovery pattern, a convention that holds until someone does not know about it. **Moving makes the correct set the only set.** All six readers became correct with no code change, because the map they already read now contains exactly the right entries, and reading history requires naming a different key on purpose.

**IDS MUST STAY UNIQUE ACROSS BOTH MAPS.** `clientSatisfactions` is keyed by person id, so a void freeing an id for reuse would silently re-point an old satisfaction at a new person. `addParticipant` asserts against both maps before writing, with a test that forces the collision by mocking `crypto.randomBytes`.

**`clientSatisfactions` IS NOT TOUCHED.** Entries for a voided person stay where they are and point into the voided map. That is deliberate: the satisfaction genuinely happened, and resolving it needs the voided record, which is exactly why the record was kept rather than deleted. Same reasoning that keeps lapsed representation agreements as linked history.

**THE ACTOR IS ALWAYS THE AGENT, NEVER SYSTEM.** Voiding is a judgment. Asserted separately rather than relying on the event vocabulary.

**THE REASON DRIVES DISPLAY ONLY.** Nothing derives from it, nothing keys off it, no consumer reads it. So unlike every other field on a participant it could safely be made editable after the fact, which is worth having in a model where agents are tapping fast. Not built.

**NO LINK FROM A REPLACEMENT TO THE PERSON THEY REPLACED.** A link forces an ordering between confirming Susan and voiding Dave, and the event log already carries the sequence with timestamps. History reads off the log and costs no field.

**THE COST, STATED.** Every reader now depends on the store returning the right set rather than on filtering, so a future writer that forgets to move rather than flag reintroduces the whole problem. The mandatory break-the-fix targets exactly that: making the void COPY instead of MOVE reddens the live-map test AND the `collectKnownAddresses` test together.

**PARKED, NOT FIXED.** The voided entry is built as `{ ...liveEntry, at, actor, reason }`. If a participant record ever carries its own `at` or `actor` from creation, the void's values overwrite them and the created-at is lost from the record. The `participant_added` event still carries it, so nothing is unrecoverable, but the field names should be checked when `addParticipant`'s entry shape is next touched.

### 6.6 ADDING an email to an existing participant (NEW v18, BUILT session 74, `923640c`)

**THIS IS 6.1's PROMOTION VERB.** Add-only: it appends to `emails[]` and never replaces, reorders or removes. Roles remain set-once; `emails[]` never was, and this stops treating them as though they were.

**A VOIDED PARTICIPANT REFUSES, distinctly from an unknown id.** A voided person is history and history does not take new facts.

**DUPLICATE IS A NO-OP THAT WRITES NOTHING.** No event, no store write, no `updatedAt` churn. **This is the 7.13 zero-net-change-write problem**, which was promoted from cleanup to a blocker for exactly this reason, and it must not be reintroduced. It returns a discriminated outcome following the accumulator's convention rather than throwing, because a duplicate is not a caller error the way a bad reason or an unknown id is: it is a fact the caller already told this transaction, so there is nothing to refuse and nothing to write.

**STORE AS GIVEN, COMPARE NORMALIZED.** The stored value keeps the agent's own casing, matching `addParticipant`'s existing behaviour. The duplicate check runs both sides through `normalizeEmailAddress`, **the same helper `collectKnownAddresses` now uses**, so "already has this address" cannot disagree with what signal B would treat as a match.

**THAT HELPER IS A NEW LEAF MODULE (`39a2af2`), AND THE ALTERNATIVE WAS THE MISTAKE THIS CODEBASE ALREADY PAID FOR.** `normalizeAddress` was private and unexported inside `matcher.js`, so nothing could compare by the same rule without copying it. Copying a one-line primitive is how `digest.js` ended up with a drifted agent-discovery filter that loaded companion files as agents on every run. **It did NOT go into `address.js`**, which owns street addresses: reusing that name for email normalization relocates the existing "address" ambiguity rather than removing it. One leaf, one export, no `_internal`, per session 66's `parseRecipientList` precedent. `matcher.js` changed by one import and three renamed call sites, its exports untouched, and its own suite passed unedited. **The break-the-fix that matters: removing the lowercasing reddens a PRE-EXISTING matcher test**, which is what proves the extraction is wired into behaviour rather than sitting beside it.

**CORRECTED v19: THE ACTOR MAY BE AGENT, SYSTEM OR OPERATOR.** The v18 text below said agent or system. The function has no actor restriction of its own; `events.makeEvent`'s `ACTORS` check is the only one, and that list includes `operator`. The code is right, since the operator is who adds addresses during white-glove onboarding. The tenth recorded case of this document being wrong about the code. **As written in v18:** THE ACTOR MAY BE AGENT OR SYSTEM, deliberately unlike voiding. Recording an address seen on a message is not a judgment call, and the accumulator (7.13) is a plausible future caller writing as system.

**NOT BUILT, DELIBERATELY:** no remove-email path, no CLI, and no wiring to the accumulator.

**A LATENT INCONSISTENCY, PARKED.** `assertEmails` validates that `email.trim()` is non-empty but stores the untrimmed value, so an address with surrounding whitespace can be stored today. Harmless now that both sides compare through one helper.

### 6.7 THE PROPOSAL AND CONFIRM MODEL (NEW v18, DESIGNED session 74. AMENDED v19: THE STORE IS BUILT session 75, `0fc32ec`. THE CONFIRM STEP IS NOT.)

**THE PROBLEM IS ADOPTION, AND IT IS MO's, FROM THE FIELD.** Participants are the one part of this system that requires an agent to sit down and enter data, and **an agent will not do it.** A form nobody fills is worse than no form, because it looks like coverage. This is the same test that killed the final walkthrough row and the keys row: a row the agent cannot act on is not a row.

**BUT THE THING WORTH PRESERVING IS NOT "A HUMAN TYPED IT". IT IS THAT THE RECORD NEVER ASSERTS A FACT NOBODY OBSERVED.** Those are separable, and this system already separates them: `indeterminate` exists precisely so the resolver can say what it is waiting on instead of guessing. **So: AI PROPOSES, THE AGENT CONFIRMS, AND CONFIRMING IS ONE TAP, NOT A FORM.**

**THE TRIGGER IS THE ACCEPTED AGREEMENT, NOT DEAL OPEN.** Mo's field answer: clients and the other side are known once a deal is agreed. So the moment the information becomes knowable and the moment the document lands in the inbox are the same moment. That splits the problem along a line that matches practice:

- **DEAL PARTIES COME FROM THE DOCUMENT.** The APS names buyer, seller, both brokerages and both agents. **This is signal E's machinery (7.11) pointed at a second purpose, which is an argument for building 7.11 sooner than the board has it.** Session 63's finding stands: DocuSign-flattened OREA forms defeat linear text extraction, so this is the vision-based or coordinate-aware path, not a text parse.
- **LAWYERS COME FROM THE EMAIL STREAM.** They are usually not on the APS and show up afterward. That is 6.6 plus 6.1's accumulator, and it is the honest source for them.

**PROPOSALS LIVE IN THEIR OWN STORE, NOT AS A STATUS ON THE PARTICIPANT RECORD.** Three reasons, and the first is the strongest. Participants feed the authorization gate and `representedPersons` derivation, so a half-real participant means **every consumer has to learn a state it was never designed for**. Keeping proposals separate leaves `addParticipant`'s created-once invariant untouched, so there is no retrofit onto a live compliance structure, which is the `filings` schema-window precedent. And proposals are disposable in a way participants are not: a wrong proposal is deleted, a participant can only be voided.

**CONFIRMING IS WHAT CALLS `addParticipant`.** That is the creation path this model has never had.

**THE SURFACE IS A TAP, AND THAT CONSTRAINS THE EXTRACTOR.** The proposal must be small enough to be right or wrong at a glance: "File this deal's participants: John Smith (seller), Jane Doe (buyer), Dave Chen (other agent). Confirm?" One tap for all three, with a way to fix a single wrong one. A screen would allow richer structure and walks straight back into the adoption problem.

**CORRECTION HAPPENS BEFORE CONFIRMATION, NOT AFTER, AND THAT IS FORCED BY 6.5.** A confirmed participant cannot be deleted, only voided, so a single tap confirming three people is unrecoverable if one is wrong. The shape: the digest lists the three with a REJECT link on each and one CONFIRM link for the set. Reject removes that person from the proposal store; confirm creates whoever is still standing when it arrives. **The irreversible action is always the last one, and it only ever applies to a set the agent has already pruned.** Common case one tap, worst case two. Both are `assistant@` subject-line verbs with an id, which is machinery that already shipped for CALLED, so this needs no new infrastructure.

**RESIDUAL RISK, ACCEPTED:** two emails sent seconds apart can arrive out of order, and a CONFIRM landing before a REJECT creates the person the agent meant to reject. Real, small, and there are cheap answers if it ever bites.

**v22 CORRECTION: THE RISK IS NOT SMALL, AND THE CAUSE IS OURS.** Session 79's live verification found that `assistant@` processes each fetched batch NEWEST FIRST, in all three rounds. So the reversal needs no network reordering: any REJECT and CONFIRM that land in the same five-minute cycle run backwards, and rejecting one person then confirming the rest is the most likely way an agent uses the digest. The cheap answer is required, not optional: sort each batch oldest first before processing (PROJECT_STATE 7.57.1), landing before the digest section puts these links in front of an agent (section 14, step 12). **CLOSED v23 (session 80, `6c13343`, live-verified 2026-09-25).** Recon confirmed the `assistant@` loop is sequential, so sorting a copy of each fetched batch by `internalDate` at the `actionHandler.js` call site fixes it; two subjects sent in order within one cycle were logged in that order. The fetch is shared with the lead path, which stays unsorted by decision (PROJECT_STATE 7.58.1), and a backlog above the 100-message fetch cap can still reorder across cycles (7.58.2).

**AN UNCONFIRMED PROPOSAL'S ADDRESS MAY SATISFY SIGNAL B.** `observedAddresses` already feeds B with no human confirmation at all, and an address extracted from an executed agreement is strictly better evidence than one that merely appeared on a thread. Refusing the proposal would hold the better-evidenced source to a higher bar than the worse one.

**THE PROPOSAL RECORD SHOULD CARRY THE PERSONAL-VERSUS-ORGANIZATIONAL FLAG EVEN THOUGH THE MATCHER IGNORES IT** (see 6.8). Adding it later is a retrofit onto a live structure, and `filings` is the precedent for why that hurts.

#### 6.7.1 THE STORE AS BUILT, AND THE DECISIONS THAT SHAPED IT (NEW v19, session 75, `0fc32ec`)

`src/transactions/proposals.js`. **No live callers, no CLI.** Every decision below was argued from the agent's side and the engineer's side (PROJECT_STATE 8.42).

**WHERE: `participantProposals`, A SIBLING MAP INSIDE THE TRANSACTION FILE.** "Own store" in the v18 text means not a status on the participant record, and a sibling map satisfies that exactly the way `voidedParticipants` does: the six raw readers of `participants` never see it. **A separate file was rejected** for two reasons. It would sit inside `<agentId>.transactions/` where every directory reader must learn to skip it, which is the digest agent-discovery bug by a new route. **And confirm must create participants and close the set in ONE save**; two files mean a crash between writes leaves a confirmable set, and a second confirm mints fresh participant ids, creating a duplicate person that only voiding removes. Proposals also cannot exist without a deal, and soft-delete already sweeps the file.

**THE SHAPE.**

```
participantProposals: {
  'pps-xxxxxxxx': {
    status: 'open',                  // open | confirmed | discarded
    createdAt, actor: 'system',      // createdAt copied from the event's at
    source: { kind: 'document', filingKey, contentHash, filename, receivedAt },
    members: {
      'ppm-xxxxxxxx': {
        roles, name?, emails?: [{ address, scope?, from }],
        phone?, entityType?, isSelfRepresented?,
        status: 'pending',           // pending | rejected
        rejectedAt?                  // copied from the event's at
      }
    }
  }
}
```

Member fields use the participant record's own names, so confirmation copies rather than translates. Optional fields are absent, never null. `filingKey` is `filings.buildFilingKey(messageId, attachmentId)`; filings carry no id field of their own. Frozen exported lists: `PROPOSAL_SET_STATUSES`, `PROPOSAL_MEMBER_STATUSES`, `PROPOSAL_SOURCE_KINDS` (`document` only), `EMAIL_SCOPES` (`personal`, `organizational`), `EMAIL_SOURCES` (`document`, `message`, `lead_sheet`). **`discarded` is written by nothing yet**; it is in the list now so no stored set can ever hold a status the code does not know.

**A SET IS SEALED.** Members can be rejected, never added; anything found later is a new set. **Agent's view:** a one-tap confirm must only create people the agent saw, and deals change after the APS (an amendment adds a spouse to title, an assignment changes the buyer). The v18 phrase "whoever is still standing when it arrives" is therefore read as whoever of the ORIGINAL members is still pending.

**REJECTED MEMBERS ARE KEPT, MARKED REJECTED. THIS SUPERSEDES THE v18 TEXT ABOVE** that says reject removes the person. A deletion leaves no record of the answer, so the next extraction of the same people re-asks the agent, and an agent who keeps rejecting the same misread name stops reading the digest. A rejected member never becomes a participant, which is the sense of "disposable" that matters. **A set whose members are all rejected stays `open`**; confirming it confirms only the filing.

**CREATION RULES, in order.** Actor must be `system`. Every member is validated before anything else: only the six known keys (so an extractor writing `email` for `emails` is refused, not silently dropped); each email an object with only `address`, `scope`, `from`, where `from` is required; then `participants.assertParticipantFields` on the member, **the identical rules `addParticipant` applies**; a name or at least one email is required (a participant may have neither per 6.2, but a proposal line reading "(buyer)" gives the agent nothing to judge); no email repeated within one member after normalization, while the same address on two members is allowed because spouses share addresses. Then the filing: missing or not at `filed` throws, because those are caller bugs. **Then outcomes that write nothing and emit nothing:** `filing_rejected` (the agent already said the document is not this deal's), `duplicate_filing` (a retry), `duplicate_content` (the same bytes from a second sender, worth counting because it measures how often person matching will matter), `no_members`. A filing whose review is already `confirmed` is accepted.

**WHY ONLY `filed`.** The digest can link the document only once it is in Drive, and an agent who doubts a name wants to open it before tapping. `contentHash` also exists only at `filed`, and duplicate detection depends on it.

**REJECTION RULES.** Actor must be `agent`, matching voiding. Malformed ids, an unknown set, or a member not in that set throw. A closed set returns `set_closed`; a member already rejected returns `already_rejected`; neither writes. Expected answers return outcomes, caller bugs throw.

**PURE BUILDERS, THEN A THIN SAVE.** `buildProposalSet` and `buildMemberRejection` take an envelope and return the next one without reading or writing the store and without mutating their input; `createProposalSet` and `rejectProposalMember` read, build, and write only on `created` or `rejected`. **The first module in this codebase shaped this way, deliberately, so 4c can run several builders against one in-memory envelope and save once.** A deep-freeze purity test is the only test that catches a builder mutating its input, because every wrapper reads a fresh envelope and would hide it.

**EVENTS, IDS ONLY.** `proposal_set_created { setId, filingKey, memberIds }` and `proposal_member_rejected { setId, memberId }`. Names and addresses already live in the set and rejected members stay there; repeating a possibly misread name in the audit log adds a copy of personal information and no information. `EVENT_KINDS` is now nineteen.

**IDS.** `pps-` and `ppm-` plus 8 hex, local generators on the `generateParticipantId` convention. Member ids are unique across every member of every set on the transaction, since a reject names a member by id. At confirmation a member gets a fresh `per-` id through `addParticipant`'s own generator and collision check; the two id spaces never mix.

#### 6.7.2 CONFIRM AND WRONG DEAL, DESIGNED v19, AMENDED v20 AND v21, BUILT v21 (4c-1a, 4c-1b, 4c-1c)

**ONE TAP CONFIRMS THE FILING AND THE SET, IN ONE SAVE.** **Agent's view:** a document filed to the wrong deal produces a proposal of real clients from a different deal, and a busy agent recognises the names and reads past the address. The digest line names the document and property, each person with a reject link, and two actions: Confirm and Wrong deal. **Engineer's view:** 6.1 already refuses to learn anything from a thread until the filing is agent-confirmed; proposals get the same protection without a second surface nobody will use.

- **Confirm:** creates every still-pending member through `addParticipant`'s builder, marks the filing confirmed, marks the set `confirmed`, and records on each member the `participantId` it became. One read, three builders, one save. A second confirm on a confirmed set changes nothing and replies "already filed", covering the double tap. A filing already confirmed from the CLI is tolerated; a rejected filing is refused with a reason the agent can read (`confirmFiling` throws on any review other than `needs_review` today, so 4c must handle this deliberately).
- **Wrong deal:** rejects the filing and sets the set to `discarded`. Nobody is created.
- **All members rejected, then confirm:** the filing is confirmed and no one is created.

**PREREQUISITES, found by session 75 recon.** `addParticipant` and `confirmFiling`/`rejectFiling` each read and write inside one call with no pure builder. **4a and 4b extract those builders with no behaviour change** before 4c composes them. **The store has no lock or version check** (PROJECT_STATE 7.53.5): one save buys all-or-nothing on a crash, not protection against a concurrent CLI write. 4c's recon must confirm the store's reads and writes are synchronous, so one read-build-write cannot be interleaved within the process.

**THE 4c DESIGN PASS RAN IN SESSION 76. WHAT FOLLOWS IS ITS OUTPUT, AND 4c IS TWO COMMITS:** the composition is 4c-1 and the verbs are 4c-2 (6.7.5).

**THE COMPOSITION.** Read once. Refuse outright if the filing review is `rejected`. Skip `buildFilingConfirmation` if it is already `confirmed`, run it if `needs_review`. Then `buildParticipant` per still-pending member, then `buildSetConfirmation`, then one save.

**THE SET STATUS IS READ FIRST, BEFORE ANY PARTICIPANT IS BUILT.** `buildSetConfirmation` returns `already_confirmed` on a double tap, but by then the participants would already exist in the envelope. **A second tap would create a duplicate of every person, and duplicates can only be removed by voiding.**

**THE FILING REVIEW BRANCH BELONGS TO 4c, NOT TO THE BUILDER.** `buildFilingConfirmation` throws on any review other than `needs_review` and must keep doing so: `scripts/review-filing.js` is a different caller, and a CLI user confirming an already-confirmed filing made an error and should hear about it. Loosening the guard to serve 4c would silently loosen the CLI. **This is the first place the v20 decision to keep the two filing builders separate pays.**

**`participantIds` GOES ON `buildSetConfirmation` RATHER THAN A FIFTH BUILDER.** This section requires each confirmed member to record which participant it became, and 6.7.4's builder deliberately knows nothing about participants. It takes a map of member id to `per-` id instead, so one builder owns the set's write rather than two builders touching the same map.

**`facts.entityType` IS NOT TOUCHED BY 4c, AND PROJECT_STATE 7.53.1 IS RESTATED AS A MODELLING ITEM.** Setting it makes confirm a second writer for a value that already has one, which is why `representedPersons` was removed from `FACT_KEYS`. Checking it produces the exact failure this section names as the worst on this path: the agent taps confirm and gets an error back for data the system produced itself. **Agent's view:** the miss is real, since a corporate buyer whose fact stays unset means the corporate FINTRAC items never appear and the brokerage bounces the file. But one deal-level value cannot describe an individual buyer with a corporate co-buyer, and writing the fact from one participant papers over a modelling error with a guess, which is the shape that killed `listingId` auto-linking and role inference. **The likely correct answer is that corporate applicability should read participants rather than a deal fact**, which is a section 4 change with its own design pass.

**RESOLVED v21 (Mo's field answer): TOLERATE.** A CLI confirmation says only that the document is on the right deal; it adds nobody, and the agent's tap is the only path that creates those people. Refusing strands the set forever.

**BUILT v21.** `e9d29e8` (4c-1a): `buildSetConfirmation` takes a REQUIRED `participantIds` map that must cover exactly the pending members, and writes each as `status: 'confirmed'` with its `participantId`; `confirmed` joins `PROPOSAL_MEMBER_STATUSES`; `participants.isParticipantId` is public; `buildMemberRejection` throws on a confirmed member. `a49b45f` (4c-1b): `confirmProposalSet` in `src/transactions/confirmSet.js`. `399eaea` (4c-1c): `markWrongDeal` in `src/transactions/wrongDeal.js`. Both compositions: one read, builders chained through one envelope, one save, actor `agent`, one `at`, set status read first. Member emails pass address-only; `from` and `scope` stay on the permanent proposal record. The filing is found through `set.source.filingKey` and confirmed or rejected with the record's own `messageId` and `attachmentId`; the key is never parsed. Stale and missing inputs return outcomes so 4c-2 can reply in words (`already_confirmed`, `set_discarded`, `filing_rejected`, `already_discarded`, `set_confirmed`, `filing_confirmed`, `set_not_found`, `transaction_not_found`); a set whose filing is missing throws.

**THE AGREE-OR-REFUSE PRINCIPLE (v21).** A tap that agrees with a recorded answer goes through; one that contradicts it is refused as an outcome and never overwrites. So CONFIRM tolerates a CLI-confirmed filing and WRONGDEAL refuses one (`filing_confirmed`), and WRONGDEAL on a confirmed set is refused (`set_confirmed`) rather than voiding people. **Agent's view:** both links sit in one digest, so a stale tap is as likely as a late realization, and auto-voiding off an ambiguous tap can remove real clients. **Engineer's view:** an override is the only option that destroys correct data silently. Surfacing the two refusals to a human was open (PROJECT_STATE 7.55.3); **CLOSED v22**: every refusal replies to the agent and emails the operator, see 6.7.5.

#### 6.7.3 WHERE PROPOSED EMAILS COME FROM (NEW v19, Mo's two sources, not built)

- **The document** (`from: 'document'`). The APS rarely carries any: in the real agreements counted for 7.11, brokerages appear by name and phone and lawyer fields were blank.
- **The email the document arrived in** (`from: 'message'`). **An address attaches to a named person ONLY when the header display name equals the APS name after trimming and lowercasing.** **Agent's view:** the APS usually comes from the co-op agent, the lawyer, or the deals desk, often from an assistant, and a loose guess puts the co-op agent's address on the buyer, where a later chase or milestone email goes to the wrong person under the agent's name. A miss costs an empty field; a wrong hit costs a wrong contact on a compliance record. Unmatched header addresses still reach signal B through the accumulator once the filing is confirmed. Built with commit 5.
- **The lead Sheet** (`from: 'lead_sheet'`). The strongest source for clients, because the lead corresponded from it. **Only through the lead-to-deal `transactionId` link of section 2, never a name search**, which is how the digest reported the wrong Daniel in session 49. **That link was never built** (PROJECT_STATE 7.53.3). Covers buyer deals best; sellers, referrals and co-buyers rarely have a lead row.

**`scope` IS ON PROPOSALS ONLY FOR NOW.** Adding an optional `scope` to participants when 6.8 is built is safe, because absent reads as unknown, which is what the matcher assumes today.

**GATE BEFORE COMMIT 5: PERSON MATCHING ACROSS DOCUMENTS.** Duplicate detection is by filing and content hash. A re-exported APS has a new hash and would propose the same people again, and confirming both creates duplicates. Deliberately deferred by Mo; safe only while nothing produces proposals (PROJECT_STATE 7.53.2).

#### 6.7.4 SET STATUS WRITERS, BUILT v20 (session 76, `2fd14ab`)

`PROPOSAL_SET_STATUSES` carried `confirmed` and `discarded` from the store's first commit and nothing wrote either: creation writes `open` (`proposals.js:305`) and member rejection writes a MEMBER status (`proposals.js:380`). Both set-level terminal states were unreachable, confirmed by recon rather than assumed.

`buildSetConfirmation` and `buildSetDiscard` are pure builders on the house shape: no store access, no clock, no mutation of `previous`, `transactionId` passed rather than derived, and separate builders rather than one parameterized by status, for the same reason `buildFilingConfirmation` and `buildFilingRejection` are separate. **Neither has a wrapper**, because 4c-1 composes them directly.

**BOTH RETURN A DISCRIMINATED OUTCOME**, unlike `buildParticipant`. The rule is not "builders have no outcome key"; it is that a discriminant with one possible value gives the caller a branch that cannot be false. `buildParticipant` throws on every failure path, so its key would be single-valued. These two have a real non-writing answer, so the key earns its place and 4c-1 must branch on it.

**GUARDS, on the module's own convention that expected answers return outcomes and caller bugs throw.** A set already at the requested status returns `already_confirmed` or `already_discarded` and writes nothing, matching the `already_rejected` precedent: that is a double tap, which an agent produces by tapping twice or by opening a stale digest.

**A SET AT THE OTHER TERMINAL STATUS THROWS.** **Agent's view:** these two are opposite answers to whether a document belongs to this deal. Discarded means the agent said wrong deal, and a later confirm silently reversing that is the same failure that made rejected members get kept rather than deleted. **Engineer's view:** before this guard both builders accepted the contradictory transition, flipping a terminal status and stacking a second terminal event on the first, so the audit log held two contradictory answers with no record that anything unusual had happened. With both guards in place only a set at `open` reaches the event-appending branch in either builder, so no set can carry two terminal events.

`EVENT_KINDS` is now twenty-one: `proposal_set_confirmed` and `proposal_set_discarded`, ids-only payloads per the module convention.

#### 6.7.5 THE SUBJECT VERBS, DESIGNED v20, BUILT AND LIVE v22 (4c-2, `73269bd`)

**THE CHANNEL ALREADY EXISTS AND IS LIVE.** `src/content/actionHandler.js` reads `assistant@getklosed.ca` every orchestrator cycle (`src/index.js:766-767`, on the five-minute `setInterval` in `server.js:116-122`), resolves the sender against agent configs, dispatches three ways, and replies through `sendConfirmation`. Section 14's tier-4 line treating `assistant@` TC verbs as future work is stale.

**SUBJECT-LINE PARSED, NEVER TRACK 2.** Track 2 classifies free text with Haiku, which is an `await` between a transaction read and its write. `src/transactions/` is synchronous precisely to make that hazard unreachable, and `drain.js` documents the remedy where an await is unavoidable: re-read immediately before writing, never trust a snapshot across an await. A transaction verb parses by regex like Track 1's `APPROVE` and `REGEN`, dispatches synchronously, and has no async step between read and write.

**THE VERBS.** `CONFIRM <transactionId> <setId>`, `REJECT <transactionId> <setId> <memberId>`, `WRONGDEAL <transactionId> <setId>`.

**BOTH IDS ARE CARRIED, AND THE REASON IS NOT SCAN COST.** Set ids are made unique per transaction by `buildProposalSet`'s collision check against one envelope, exactly like participant `per-` ids. **They are not globally unique.** Scanning every transaction for a bare set id searches a namespace for a value only ever made unique within one scope, and the failure that buys is one deal's people filed onto another deal. With both ids present the set is looked up only inside the named transaction, and a set id absent from it is a loud refusal rather than a silent search that might find the wrong one. **Agent's view:** no cost, since the digest generates the link and nobody types an id.

**THE DIGEST PRECEDENT TO COPY** is `calledAffordanceHtml` (`digest.js:249-257`), the one existing affordance where tapping a digest link triggers a backend write, via a `mailto:` to `assistant@` with a pre-filled subject.

**THE AUTH GAP, RECORDED AND PARKED.** `actionHandler.js:363-366` establishes sender identity by pulling the From address with a regex and comparing it to an agent's `gmailAddress`. Nothing reads SPF, DKIM or DMARC. Every write verb on that mailbox rests on this, and 4c's is not the weakest: `PAUSE ACCOUNT` takes no ids at all. **A DMARC guard was designed and withdrawn on two recon findings:** `dmarc=pass` does not mean the agent sent it, since any legitimately authenticated mail passes, and we have one sender's traffic pattern to calibrate against, so a fail-closed guard risks silently refusing a real agent's verb on their first forwarded message. See PROJECT_STATE session 76, section 4.

**v21, THE MAILBOX BEFORE THE VERBS (session 77).** The Authentication-Results verdict is parsed (`afd29fd`) and logged per message, and used ONLY to decide whether to reply to an unrecognized sender (`da8a6e2`, 7.54.8), never to authorize a verb: the From match above remains the recognized-sender gate for 4c-2. Every confirmation `assistant@` sends is marked `Auto-Submitted: auto-replied` (`5e6f62d`), so an agent's out-of-office reply no longer reaches Track 2 as a command. Automated inbound mail is detected (`227052d`). See PROJECT_STATE session 77, sections 1 and 2B.

**LIVE AS OF 2026-09-21 (session 78, no design change, no version bump).** All five mailbox commits reached `main` with the `session-77` fast-forward and are deployed. 7.54.8 was verified in production: a first message from a non-agent address got the one fixed reply, a second within 24 hours was held (`decision=skipped reason=cooldown`). **The trust samples 4c-2's design should read start on this date:** every `assistant@` message now logs one `[auth-results]` line (verdicts and sending domain, never an address). Pull them from the Railway logs before the 4c-2 design pass. The pre-existing `unrecognized sender` line and three other `actionHandler.js` lines no longer print an address (`597b395`); they log `messageId=` instead, so line references to `actionHandler.js` in this section may be off by a few lines. See PROJECT_STATE session 78, sections 2 and 3.

**BUILT v22 (session 79, `73269bd`, deployed and live-verified).** What shipped, and the decisions behind it.

**THE CLAIM AND PARSE.** A subject is a verb only if it matches `^\s*(CONFIRM|REJECT|WRONGDEAL)\s+txn-` on the RAW subject: anchored, case-insensitive, no Re:/Fwd: stripping. A claimed subject is parsed strictly: exactly 3 tokens for CONFIRM and WRONGDEAL, 4 for REJECT, each id checked by the public validators `store.isTransactionId`, `proposals.isProposalSetId` and `proposals.isProposalMemberId` (`5815950`). A claimed subject that fails gets "Nothing was changed. We couldn't read that request." plus an operator note. An unclaimed subject falls through to the existing flow untouched. **Agent's view:** nobody writes a transaction id in a sentence, so "Confirm our showing tomorrow" is never swallowed, and a mangled link gets a plain answer instead of a Haiku guess. **Engineer's view:** the claim test is one unambiguous shape, and everything past it fails loudly. The anchor also stops a reply to our own confirmation ("Re: CONFIRM ...") from firing a write twice. The branch sits between CALLED and Track 1, recognized senders only, with no automation check, matching CALLED.

**FOUR PHASES, EACH ISOLATED, AND NOTHING REACHES THE CATCH-ALL.** (1) WRITE: the composition, synchronous, one `now` per message (`confirmProposalSet` and `markWrongDeal` take `{ now }`; `rejectProposalMember` takes `{ now, at, actor: 'agent' }`). A throw here is honestly "Nothing was changed", because the save is the last throwable step in all three. (2) DESCRIBE: one `readTransaction` immediately after, with no await between, supplying the address, names, roles and set status. (3) REPLY to the agent. (4) NOTE to the operator. **The rule that shaped it: after a successful write, nothing may say "Nothing was changed."** A describe failure (including `readTransaction` returning `null`) after a write falls back to a true "Done."; a failed agent reply is logged and the note still goes; an unexpected throw gets "We got your request, but couldn't confirm whether it went through," because the backstop cannot know which is true.

**REFUSALS AND FAILURES NOTE THE OPERATOR.** Contradictions (`set_discarded`, `filing_rejected`, `set_confirmed`, `filing_confirmed`, REJECT's `set_closed` on a confirmed set), not-found, parse failures and errors each send a best-effort, Auto-Submitted note from `assistant@` to `loadOperator(agentConfig.operatorId).operatorEmail`: agent id, messageId, verb, ids, outcome, error. Ids only, never names or addresses. Agreements (`already_*`, REJECT's `set_closed` on a discarded set) and successes send none. **Agent's view:** voiding is operator-only, so a refused tap needs a person, and the agent is told one has been told. **Engineer's view:** a log line only works if someone reads logs.

**THE REPLIES FOLLOW FOUR RULES.** Name the deal by `transaction.address`, never an id. On `confirmed`, list each new participant as name (else first email, else "someone with no name recorded") plus `formatRoles` in parentheses. Every no-op starts "Nothing was changed." Never tell the agent to reply, since a reply lands in Track 2; the fix path is `OPERATOR_CONTACT_EMAIL`. Participant emails are strings and proposal member emails are `{ address }` objects, so each has its own fallback. Role labels are relative (`client` is "your client", `opposing_lawyer` is "other side's lawyer") and `formatRoles` is total (`9645d33`), because it runs after the save.

**`sendConfirmation` RETURNS ITS SEND RESULT.** `_sendWithRetry` never throws; the new branch reads `{ ok }`. The 20 existing callers still ignore it (PROJECT_STATE 7.57.2). **v23:** the count was 25 (23 ignored, 2 read); the four on the `processEmail` paths now read it and log a failure with the messageId and a fixed context word (`4fe521c`).

**LIVE-VERIFIED 2026-09-24** against a seeded mo-test transaction, deleted afterwards: parse failure, not found, `rejected`, `wrong_deal_recorded`, `confirmed` (the first real participants), `set_discarded`, `set_confirmed` and `set_closed` on a discarded set, each with the exact reply and the right note behaviour. **Not verified live:** `filing_rejected` and `filing_confirmed`, which need a CLI review first; covered by hermetic tests. **Found live:** newest-first batch processing (see the 6.7 residual-risk correction), bodies hard-wrapped near 70 characters, and the confirmed list in member-id order rather than proposal order (PROJECT_STATE 7.57.1, 7.57.4, 7.57.5).

**v23, EVERY REPLY CARRIES AN HTML PART, AND WHY (session 80, `e975070`, `7caa23e`).** Measured, not assumed: mail sent from the `assistant@` Workspace account has its `text/plain` part rewrapped at word boundaries near 70 characters in transit, whatever the Content-Transfer-Encoding (7bit, quoted-printable and base64 all wrapped, the `Content-Transfer-Encoding` header was dropped, and a 150-character line with no spaces never wrapped), while an HTML part arrives untouched. Our builder was proven innocent offline. `sendConfirmation` and the unrecognized-sender reply now send `html: plainTextToHtml(body)` beside the plain part: escape all five HTML characters, then each line break becomes `<br>`, nothing else. **Not markdown:** REGEN and SWAP replies carry Claude-generated content the agent approves before posting, so it must render literally. **Agent's view:** every reply reads as one clean message on a phone, which matters most once the digest's links generate them. **Engineer's view:** the builder's html path is the one the digests already use, and the new module is pure with exact-literal tests. Also v23: the retry label no longer carries an address (`1179668`), and 7.57.1 is closed (6.7 above). 7.57.5, the confirmed-list order, remains open and belongs with the digest work.

### 6.8 SIGNAL B's TIERING, and the shared-inbox problem (NEW v18, DESIGNED session 74, DEFERRED)

**THE PROBLEM IS NOT THAT AN ADDRESS IS SHARED. IT IS THAT IT IS NOT DEAL-IDENTIFYING.** Signal B answers "does this message belong to this transaction." `closings@firm.ca` answers it with no information, yet B counts it as a full signal, and `computeMet` clears the bar on A plus B alone. **A shared inbox turns a two-signal match into a one-and-a-half-signal match with nothing noticing.** This is already live: `observedAddresses` can accumulate a shared inbox today with no participant model involved. 6.7 makes it more likely, not new, since an APS extraction will happily propose a brokerage's main office address.

**COUNTING ACROSS TRANSACTIONS WAS CONSIDERED AND REJECTED.** Multiplicity and non-identifying are not the same thing. A client's personal Gmail appears on both their sale and their purchase, which is two transactions for a maximally identifying address; a brokerage inbox on its first deal counts one and looks pristine, which is exactly when the guard is wanted. **The signal is backwards at both ends**, and being learned, it changes behaviour over time for reasons invisible in a diff.

**THE DESIGN, IF IT IS EVER BUILT:** distinguish an address attached to a named PERSON from one attached to an ORGANIZATION. A personal hit satisfies B as today. An organizational hit is CORROBORATING ONLY: it can strengthen a match that has another basis but cannot be one of the two signals that clears the bar. That kills the A-plus-B false match without weakening any true match, because a real thread from a law firm carries the address in the subject or a matching filename anyway. It is a property of the address, decidable when it is proposed, so it is visible and testable rather than emergent, **and the agent already knows the answer.** The confirmation tap of 6.7 can carry it.

**DEFERRED ON MO's FIELD ANSWER, and the mechanism is stronger than either argument.** Mo: the firm's admin usually knows how to handle the deal or routes it to the right person. And structurally, **B alone never matches anything.** Both A and C are anchored to a property address, so a shared inbox can only participate in a match that something address-bearing already pointed at one transaction: a subject naming deal X's address gives X both A and B while giving Y and Z only B, which does not clear the bar. **The shared address never picks the deal, it only corroborates a pick something else made.** Routing compounds this, since the handoff puts the individual's address on the thread and the accumulator learns it, diluting the shared inbox over time.

**THE TRIPWIRE, AND IT IS THE SAME ONE AS 7.51.7.** All of that holds because signal A is subject-line only, since `message.body` is permanently `undefined`. **Wire the body into the matcher view and A starts firing off anything mentioned anywhere in a thread, including quoted history. Loose A plus shared-inbox B is the combination that actually breaks, and neither half is dangerous alone.** So PROJECT_STATE 7.51.1, 7.51.7 and this section are ONE COUPLED ITEM, not three. **Whoever connects the body owns all three and must ship quoted-reply trimming in the same commit or accept a live false-match path on a compliance record.**

**CHECK, NOT ASSUMED:** `observedAddresses` has no removal path at all, so a shared inbox learned there is permanent with no way to take it back. Probably acceptable given the above. Worth confirming rather than inheriting.

## 7. Email-driven transaction assembly (the v2 core pipeline)

Same shape as Lead Intake, different classifiers. Reuses the existing pre-filter, the Haiku classification pattern, and the confidence-tiered default pattern. This section is the "hands-off" experience: documents file themselves, deals propose their own opening, items propose their own completion, and the agent's job reduces to confirm or reject.

### 7.1 Matching (multi-signal, not email-keyed. AMENDED session 65: the anchor is named, the bar is named, and a miss is a no-op.)

Email-as-primary-key breaks the first time a lawyer's assistant sends the waiver from a different address, and forwarding, cc'd assistants, and law-firm mailrooms make this the common case rather than the edge.

Every transaction gets a unique internal `transactionId`. Matching scores over multiple signals:

- participant email match (any address in any participant's `emails[]`)
- property address appearing in subject or body
- attachment filename
- thread history (has this thread already matched this transaction)

**THE ANCHOR IS THE ADDRESS, and Mo named it: what identifies a deal in the paperwork that actually moves between agents, lawyers and the brokerage is the address on the listing agreement or the deal agreement.** That address is already on the transaction envelope, stored verbatim, since session 64. So matching is not a heuristic hunting for a key; it compares a value the system already holds against what appears in the email.

**NORMALISE FOR COMPARISON, NEVER FOR STORAGE.** This is the one thing the session-64 address decision deferred and it is now decided. The stored value stays exactly as the agent typed it, forever, because identity is not a place for the system to decide it knows better. But `14 Bonacres Rd`, `14 Bonacres Road`, `14 Bonacres Rd.` and an all-caps filename are one property, and recognising that requires normalising. **A derived comparison form exists only inside the matcher and is never written back.** This is a real unit of work and it was not on the initial sizing list.

**ONE OPEN TRANSACTION IS NOT A SIGNAL.** The tempting shortcut is that an agent with a single active deal can have attachments filed to it by elimination. Mo's answer kills it: agents receive paperwork for things that are not that deal, and a mortgage pre-approval for a buyer who has not bought anything would land in the wrong folder confidently. **The count of open deals must never lower the bar.**

**A MATCH MUST BE AT LEAST NINETY PERCENT CERTAIN (Mo's number), and it must be a RULE.** A confidence figure a language model reports about its own certainty is not measurable against anything, so the bar is a stated set of conditions that constitute a match. Anything not meeting them is a miss, and per 7.2 a miss does nothing at all.

#### 7.1.1 THE RULE, STATED (NEW v11, LOCKED session 66)

Four signals:

- **A** the normalised address appears in the subject or body
- **B** an address on the message (sender or any recipient, agent's own already removed) appears in some participant's `emails[]` OR among the keys of `observedAddresses` (AMENDED v13, see below)
- **C** the normalised address appears in an attachment filename
- **D** this thread already has an AGENT-CONFIRMED filing on this transaction

**A transaction matches if and only if D, or any two of A, B, C.**

Each exclusion follows from a specific answer rather than from tuning. **A alone is not a match** because agents put the wrong address in the body (Mo). **B alone is not a match** because a lawyer acts on several of an agent's deals at once and an email address cannot say which. **Any two** means two independent observations agree. **D is sufficient alone** because a human already confirmed this thread belongs here, and it is gated on `confirmed` rather than `needs_review` so that one wrong match cannot propagate down a whole thread on the authority of the first mistake.

**THE MATCHER IS PURE AND DETERMINISTIC. There is no model call.** The spec already forces this: a stated set of conditions IS a pure function, and 7.1 rules out a self-reported confidence score. It also means matching costs nothing per attachment and the ninety percent bar is something tests can hold.

**SIGNAL B's SOURCE, AMENDED v13. The v11 text above was stale and the spec contradicted itself.** 7.1.1 as locked in session 66 read `emails[]` only. 6.1 as rewritten in session 67 said `emails[]` OR observed addresses. Those are different functions. **6.1 is right and this section was wrong**, and the reason is evidence rather than preference: `emails[]` has exactly one writer, at participant creation only (see 6.1), so on any participant a human did not hand-populate it is empty forever.

B is true when an address on the message appears in EITHER any participant's `emails[]` under `transaction.participants`, compared trimmed and lowercased on both sides, OR the KEYS of `transaction.observedAddresses`. The writer already stores those keys trimmed and lowercased, and **the reader normalises again on read rather than trusting that contract**, because `observedAddresses.js` exports no read helper and there is therefore no surface where the promise lives.

**THIS IS NOT CIRCULAR.** `observedAddresses` is written only on threads carrying an agent-confirmed filing, so nothing enters it that a human did not vouch for. Its value is CROSS-THREAD: an address confirmed on thread 1 makes B fire on thread 2. On the same thread signal D already answers, so B adds nothing there. That cross-thread accumulation is exactly what the transaction-scoped decision in 6.0 gave up and 6.1 exists to buy back.

**AS SHIPPED, B CANNOT FIRE.** Nothing writes `observedAddresses` yet, because the accumulator is not wired, and `emails[]` is empty on anything auto-discovered. **B ships dormant, and this is expected rather than a defect.** Recorded so a future session reads it as designed state.

**A AND C ARE NOT FULLY INDEPENDENT, and the phrase "two independent observations" above is looser than it reads.** A DocuSign or DigiSign completion email frequently names the attachment in the body, so A fires off text that IS the filename while C fires off the filename itself: two signals, one observation. The outcome stays correct because both are anchored to the same parsed transaction address, so this cannot manufacture a wrong match. But the justification is thinner than the wording implies and **it must not be leaned on to widen the rule.** Recorded so a future session finds the caveat rather than the slogan.

#### 7.1.1a THE ABSENCE RULE (NEW v13, BUILT session 68, `7b8117d`)

`evaluateSignals(transaction, message)` returns `{ met, signals: { A?, B?, C?, D? } }`. Each signal is the boolean `true`, the boolean `false`, or **ABSENT FROM THE OBJECT ENTIRELY**. Never `null`, never an explicit `undefined`.

**ABSENT means the comparison was never formed. FALSE means it was formed and disagreed.** This is 7.10's absence-versus-falsity distinction applied one layer up, and it is the point of the commit rather than a detail of it.

- **A** absent when `subject` and `body` are both empty or missing.
- **B** absent when the message carries no addresses.
- **C** absent when there is no filename.
- **D** is NEVER absent. An empty `filings` map is a real answer, not a missing one.

**ADDITIONALLY: when `parseAddress(transaction.address)` returns null, BOTH A AND C ARE ABSENT**, regardless of what the message carries. The store validates `address` as a non-empty string with no format check (`store.js:145-147`), so `TBD` or `see attached` are valid stored addresses that parse to null. **A transaction that can only ever match on B and D is a transaction that will effectively never file**, and absent is the only value that makes that visible instead of looking like an ordinary miss.

**WHY NOT FALSE, AND WHY NOT A STRING SENTINEL.** A caller truthy-testing an absent key (`if (signals.C)`) still gets the right answer, because absent and false are both falsy. A caller checking key presence (`'C' in signals`) gets a MORE PRECISE answer: whether a comparison happened at all, which absent-as-false can never tell it. A string sentinel such as `n/a` was rejected for the same reason false was: it is truthy, and it would silently flip every truthy-testing caller.

**WHAT IT BUYS, concretely.** "C is false" and "C is absent" mean completely different things and only one of them is a bug. C false with a filename present is the matcher working. **C absent is an attachment that never reached the rule**, which is page-split delivery surfacing at the one layer where it can still be seen.

**TWO FROZEN ENUMERATIONS, NOT ONE.** `SIGNAL_KEYS` is `['A','B','C','D']`. `COUNTING_SIGNALS` is `['A','B','C']`, because D is sufficient alone and is never counted toward the two-signal bar. Both are frozen and both are pinned by tests. **They differ, and a commit adding signal E must edit BOTH.** Session 68 shipped `COUNTING_SIGNALS` specifically because the counting set had been an inline literal one line below the enumeration meant to guard it, which is the 7.49.5 stale-count shape reproduced inside its own fix.

**THE GUARD INSIDE `textNamesAddress` IS LOAD-BEARING IN PRODUCTION, NOT DEFENSIVE.** `findAddressCandidates` asserts non-empty text and THROWS on `''`. Four of `parseGmailMessage`'s five callers return objects with no body field at all, and an HTML-only email yields `body === ''`, so the empty-text guard is what stands between an ordinary message and a thrown poll cycle. It reads like belt-and-braces and must not be tidied away.

#### 7.1.2 THE CANDIDATE SET, and the collision the anchor cannot resolve (NEW v11, LOCKED session 66)

**The six-type model deliberately creates two transactions per property carrying the SAME address.** A seller who lists and then sells has both `seller_listing` and `seller_sale` matching on the anchor, permanently, and the seller is a participant on both so signal B does not break the tie either. This is not an edge case: it is every successful listing, and it begins exactly when paperwork volume peaks. Same shape for `landlord_listing` and `landlord_lease`.

**Two rules resolve it, and the first does most of the work for free.**

1. **CANDIDATES ARE NON-TERMINAL TRANSACTIONS ONLY.** Mo: once a deal is closed and everyone is paid, an agent does not do more work on it. So terminal transactions leave the candidate set. That alone confines the listing-versus-deal collision to the accepted-offer window, and it means a collapsed deal drops out and leaves the listing standing alone, which is the correct answer and the one section 3's six-type model was designed for. Terminality is a declared array per type read through `states.isTerminal`, not something derived from edges.
2. **WHEN A LISTING AND ITS OWN DEAL BOTH MATCH, THE DEAL WINS.** Mo's field evidence: SkySlope carries the listing paperwork forward into the offer file, and the active paperwork belongs to the deal. `listingId` points deal to listing, so both candidates are in hand and resolving this is one field read.

**Everything else matching more than once is a MISS.** Two unrelated transactions matching is real ambiguity and does nothing. This also handles the unit case without a special rule: two leases at one address, neither message naming a unit, both match, neither is a listing and deal pair, so nothing files. Correct outcome, no extra machinery.

**`listingId` IS ONLY AS GOOD AS WHAT GOT SET.** It is optional, and until session 66 the only writer was a manual `--listing-id` flag nobody would remember. See 7.9.

**THE TEMPTATION TO WIDEN RULE 2, STATED SO IT STOPS BEING RE-DERIVED (NEW v13).** The rationale above is that SkySlope carries listing paperwork forward into the offer file, so the active paperwork belongs to the deal. That is a claim about where paperwork belongs. `listingId` was only ever the MECHANISM for spotting the pair, never the justification for the rule. It therefore looks safe to drop the link requirement and let the deal win whenever a non-terminal listing and its paired deal type carry the same address for the same agent. **Mo's session-68 field answer makes this look MORE attractive, not less: double-ending and selling your own listing are common, especially with leases.**

**IT IS NOT SAFE, AND THE COUNTEREXAMPLE LIVES EXACTLY WHERE THE VOLUME IS.** Leases mean condo buildings. An agent with a `landlord_listing` on unit 302 and a `landlord_lease` on unit 505 in the same tower has two transactions whose addresses compare EQUAL, because `parseAddress` produces no unit and this section already concedes that. Those are a listing and a deal of paired types at one address for one agent, **structurally indistinguishable from a listing and its own deal.** Widen the tiebreak and unit 302's listing paperwork files into unit 505's lease file. Silent, durable, on a compliance record.

The two-leases case above is refused correctly only because neither is a listing-and-deal pair. **The listing-plus-lease version of the same building sails straight through a widened tiebreak.**

**LOCKED v13: rule 2 requires an explicit `listingId` link.** The deal's `listingId` must equal the listing's `transactionId`. Paired types plus address equality is NOT sufficient and must not be made sufficient. **The `unit` field cannot rescue a widened rule either**, because absence there is genuine (agents do not always type it) so any unit comparison would have to be absence-tolerant, and 7.10's finding is precisely that tolerance is wrong wherever the absence is an artifact rather than a fact.

#### 7.1.2a RESOLUTION ORDER AND MISS REASONS (NEW v13, BUILT session 68, `9598b05`)

`matchTransaction(candidates, message)` filters terminal candidates, evaluates each survivor through `evaluateSignals`, and resolves the set that met the bar. **Terminality is filtered INSIDE the matcher, not by the loader**, because rule 1 above is part of THE RULE and keeping it here means a test can prove a closed transaction never matches without touching disk.

**Matching set size 0** is a miss. Reason `no_candidates` when there were no non-terminal candidates to evaluate at all, `no_bar_met` when at least one was evaluated and none met the bar. Different operational states, deliberately not collapsed.

**Matching set size 1** is a match, resolution `single`.

**Matching set size 2**, resolved in this order:

**(a) DEAL BEATS LISTING.** Exactly one is a deal whose `states.listingTypeForDeal(type)` is defined, the other's type equals that value, and the deal's `listingId` is present and equals the listing's `transactionId`. Match, resolution `deal_over_listing`, winner is the deal, and `supersededTransactionId` names the listing. **The link is required. See above.**

**(b) SAME BUILDING.** Both transactions carry a stored `unit` and the two values differ after trim and lowercase. Miss, reason `ambiguous_same_building`.

**Units DIFFERING is positive evidence they are different properties. Units ABSENT is not evidence, on either side**, because most agents type only a street address so absence is the common case rather than a signal. Treating absence as agreement would turn "we do not know" into "confirmed same property", which is the wrong direction to guess in on a compliance record. Same asymmetry 7.10 found, one layer up.

**This check runs BEFORE (c), deliberately.** It is what stops the unit 302 / unit 505 case from being reported as a linkable pair. It also applies regardless of type pairing, so two `landlord_lease` records in one tower hit it too.

**(c) UNLINKED LISTING.** Exactly one is a deal whose paired listing type equals the other's type, AND the two parsed addresses compare equal via `compareAddresses`. Miss, reason `ambiguous_unlinked_listing`, carrying both candidate ids.

**THE ADDRESS EQUALITY REQUIREMENT IS NOT OPTIONAL.** Two candidates can both meet the bar without sharing an address, because signal D is sufficient alone. This reason will eventually drive a suggestion the agent CONFIRMS, and a confirmed link is a durable write on a compliance record, so **the bar to SUGGEST must be higher than the bar to MATCH.** That is 7.9's inverted cost structure applied to a second surface.

**(d) Otherwise** a miss, reason `ambiguous`.

**Matching set size 3 or more** is a miss, reason `ambiguous`. No tiebreak applies. See 7.1.2b, which as of v14 removes the case that made this common: a double-end now opens ONE record rather than three.

**WHY `ambiguous_unlinked_listing` EARNS ITS OWN REASON.** It is the only ambiguity that is ACTIONABLE. A digest row can say "these two files look like the same property, link them?", the agent confirms, and the link is set. **Given that the tiebreak cannot widen and the situation is common, this is the only mechanism by which the link ever gets set for an agent who skipped the `--listing-id` flag at deal open.** It is also the mechanism that does not require knowing what is in front of the agent at offer-open, which nobody currently knows. `findListingCandidates` at deal open stays exactly as session 66 built it; this is the safety net UNDER it. **The digest surface is NOT built.** The matcher emits the reason with both ids, which costs nothing now and is unrecoverable later if it does not.

**FIELD QUESTION STILL OPEN, and Mo can answer it from his own desk:** in SkySlope, when an agent's own listing sells, does creating the offer file REQUIRE selecting the listing, or is it a separate file they could create without ever pointing at it? If SkySlope forces the pick, agents are already habituated to the act and `--listing-id` is a familiar step, making the digest chase a backstop. If SkySlope links behind the scenes off the address, or admin does it, agents have never performed this act in their lives and the chase is the PRIMARY path.

#### 7.1.2b THE DOUBLE-END (RESOLVED session 69. Was the top open TC design item. Now locked and built.)

**A double-end is ONE agent representing both sides of the same property**, not two agents on opposite sides.

**THE PROBLEM AS v13 STATED IT.** On the six-type model a double-end produced THREE non-terminal transactions at one address: `seller_listing`, `seller_sale` and `buyer_purchase`. `listingTypeForDeal('buyer_purchase')` is `undefined` and 4.4 makes `listingId` invalid on `buyer_purchase`, so the buy side could never be linked to anything. The tiebreak is defined for exactly two, so three candidates fell through to generic `ambiguous`, which meant **nothing filed on a double-ended deal, ever, from the moment the offer opened.** Mo's field answer reframed it: SkySlope opens ONE deal file on a double-end, so the system of record holds two files, the listing and the deal, where the model produced three.

**THE RESOLUTION: a double-end is ONE deal record that carries both sides' obligations.** It opens as the SELL-side type (`seller_sale`, or `landlord_lease` for a lease) and carries `representationArrangement: 'double_ended'`. No new transaction type, no change to `matchTransaction`, and **the three-way collision stops existing at the source** rather than being resolved: a double-ending agent never opens a `buyer_purchase` record at all, so the matcher never sees a third candidate. The mechanism is section 4.1.6.

**MO'S TWO FIELD ANSWERS, and the first is what shrank the work.** Asked whether a double-ended file needs one FINTRAC individual identification record and one RECO information guide covering the deal, or separate ones per client: **"one for both (separate) for both fintrac and reco. each client still gets treated as their own. a multiple rep form will also be needed."** So both clients appear on the file and each is tracked separately, which is EXACTLY what `withClientSatisfaction`'s uniform per-person iteration over `representedPersons` already does. The v13 worry that a composed transaction needs per-item person scoping, a side-aware role vocabulary, or a change to set-once roles is closed: none of it was needed.

**AND RECON SHRANK IT FURTHER. The "union" is the sell-side catalog plus exactly ONE item.** Every id in `seller_sale` also appears in `buyer_purchase`, all eighteen of them, and `buyer_purchase`'s only unique id is `buyer_representation_agreement`. On the lease side there are six shared ids, and the rest are deliberately named asymmetrically (`signed_lease_copy_delivered` against `signed_lease_copy_received`, and so on), so those append rather than merge. **The condition items are not shared with the lease catalogs at all**, which corrected a stated assumption.

**THE ONE ITEM THAT DIFFERS DOES NOT FAN OUT PER PERSON, which is the other half of why no scoping was needed.** `buyer_representation_agreement` is `scope: 'client'` with `clientScope: 'dated'`, and `withClientSatisfaction` gates on `clientScope === 'event'`. So on a composed double-end it renders as a SINGLE row asking whether a buyer representation agreement is on file, which is correct for one buyer, and it never demands satisfaction from the seller. `satisfactions.js` additionally throws if `markPersonSatisfied` is called on a `dated` item, for the same reason.

**THE ONLY GENUINELY ASYMMETRIC SHARED ID is `fintrac_receipt_of_funds_record`**, unconditional on the buy side and gated on `hasSelfRepresentedParty && brokerageReceivedFunds` on the sell side. It is `scope: 'transaction'`, so it never touches per-person satisfaction, and it is the single id the merge-precedence rule actually exercises. **A recon pass initially reported `fintrac_unrepresented_party_record` as asymmetric too; it is byte-for-byte identical on both sides.** That claim came from citing a line range covering one item and folding a second into it by association.

**WHAT COLLAPSING WAS FEARED TO COST, and what it actually cost.** v13 said collapsing "has to say where the buyer's client-scoped items live, and whether one transaction can carry two client relationships with different item sets and different per-person satisfaction." The answer to the first is that they live on the same record and were already there. The answer to the second is yes, and the machinery for it shipped in session 59. **Section 4.5's client-item transfer is untouched**, because it operates listing-to-offer and this changes neither.

**WHAT IS STILL OPEN: `entityType` cannot describe two clients.** It is one value for the whole file, so a double-end with a corporate buyer and an individual seller cannot be represented. Full statement of the gap, why the obvious interim was rejected, and why it needs per-person applicability rather than a reshaped fact, is in 4.1.6. It is a live question in section 16, not a park.

**DECISION 46 IS SUPERSEDED IN PRACTICE THOUGH NOT IN TEXT.** It says a matching set of three or more is `ambiguous` with no tiebreak, and that whether three transactions is the right model is an open section 3 question. The rule stands and the code is unchanged, but the double-end no longer PRODUCES three, so the three-candidate case is now genuinely rare rather than the common one.

#### 7.1.3 THE READ PATH (NEW v13, BUILT session 68, `src/transactions/queries.js`)

`readAllTransactions(agentId, opts)` returns every transaction belonging to an agent, as full objects, unfiltered by anything except whether the file is still there to read.

**It filters NOTHING on meaning.** No terminality check, no type check, no address comparison. Those belong to the matcher and stay there, so the rule lives in one place and can be tested without touching disk.

**It returns FULL transaction objects, not a projection.** The matcher needs `filings`, `participants`, `observedAddresses`, `type`, `state`, `address`, `unit` and `listingId`, which is nearly the whole object. **This is a real difference from `findListingCandidates`**, which returns a four-field projection because it feeds an agent-facing prompt, and it is an argument that the two functions share less than they appear to.

**ABSENT MEANS SKIP; PRESENT BUT UNREADABLE MEANS THROW.** `readTransaction` returns `null` on ENOENT rather than throwing (`store.js:216-221`), so an id listed and then read can come back null. **That is a race, not a bug:** nothing deletes a single transaction, but `moveAgentFilesToDeleted` sweeps every path prefixed with the agent id, which includes the transactions directory, so an operator soft-deleting an agent mid-poll-cycle produces exactly this window. Skipping is correct.

A file that is PRESENT and cannot be read is a store bug. `TransactionCorruptionError` on invalid JSON and `TransactionSchemaValidationError` from envelope validation, which runs on READ (`store.js:231`), both propagate deliberately. **Swallowing them would mean a real deal silently never matches anything, forever, with nothing to signal it.** Same reasoning as `isTerminal`'s throw inside the matcher.

**THE INDEX QUESTION IS CLOSED, NOT PARKED.** 7.9 warned that `findListingCandidates`' O(n) read of every transaction file was "not a shape to reuse anywhere that runs per request", and the matcher runs per attachment on every poll cycle, which is exactly that path. **Mo's field answer: agents carry roughly 2 to 20 open transactions, and 200 is very rare.** Even 200 small JSON reads is cheap. An index is not needed, and this is a decision made on evidence rather than a shape deferred. Do not reopen it without new numbers.

**THE ONCE PER MESSAGE CONTRACT.** Callers must call `readAllTransactions` ONCE per message and reuse the returned array for every attachment on that message. The candidate set cannot change between attachments on one message, and calling it per attachment multiplies the read by the attachment count for no gain. **This module cannot enforce it. It is a caller contract and the orchestrator owns it.**

**`findListingCandidates` STAYS IN `store.js`, and the move is PARKED rather than forgotten.** 7.49.3 said a second query inside the store means a query module above it is the honest fix, and this is that second query. The move was considered and declined for two reasons: a pure relocation changes its callers while the tree is frozen and unpushed, which is the wrong moment to take a tidiness risk; and **moving it before the second function existed would have presumed the shape.** Both functions now sit side by side, and whether they share a read-all-non-terminal primitive should be argued from what is actually there rather than from a prior note. One caller: `scripts/open-transaction.js:142`.

#### 7.1.4 WHAT THE MATCHING RULE DOES NOT YET HAVE (NEW v13)

**No caller.** Nothing outside `src/transactions/` requires the matcher, the read path, `filings.js` or `observedAddresses.js`. There is no live path from an incoming Gmail message to a transaction. This is per section 14's build order, where the orchestrator is the piece that closes it, and it is stated here so it is not inferred across twenty commits.

**No size probe.** The orchestrator's byte cap depends on whether Gmail's reported `size` is the base64 length or the decoded length, which is one live call and is blocked by the CASA deployment freeze.

**No page-split handling.** A single document arriving as N attachments still has pages 2 through N matching nothing. The absence rule above makes the failure VISIBLE at the signals layer for the first time, which is progress, but nothing consumes that yet.

### 7.2 Confidence tiers (AMENDED session 65: the low-confidence tier is REMOVED. Unmatched attachments do nothing.)

- **Match (the 7.1 bar met):** file to the transaction folder, rename per section 10.2, record the filing, propose the checklist item, write the event. Attachment status `needs_review`.
- **No match:** **DO NOTHING.** Do not file, do not surface, do not queue.

**THE UNSORTED FOLDER IS GONE, on Mo's call: "only file deal/listing documents, everything else should be ignored/left for the agent."** The v2 design had a low-confidence tier that filed to an unsorted folder for the agent to place. That is a second inbox, and a triage queue is exactly the work this product exists to remove. Every attachment in an agent's inbox is not a deal document: a tax receipt, a newsletter PDF, a photo from a client. **An ignored attachment leaves the agent exactly where they are today, which is a safe floor. A wrongly filed one is worse than either.**

**This is what makes matching a GATE rather than a router**, and it is why the ninety percent bar in 7.1 is affordable. When the system cannot say which transaction a document belongs to, doing nothing is a correct answer rather than a failure to handle a case.

### 7.3 Attachment status

`needs_review` -> `confirmed` | `rejected`.

**The checklist item does not flip until the agent confirms.** A match buys the filing and the naming, not the completion. This is Rule 2, and it is the difference between an assistant and a liability.

`rejected` records the rejection as training signal. Do not act on that signal for now; capture it. (AMENDED session 65: rejection no longer "returns the document to unsorted", because per 7.2 there is no unsorted folder.)

**THE AXIS FINALLY HAS A DOOR (AMENDED v13, BUILT session 68, `scripts/review-filing.js`).** `confirmFiling` and `rejectFiling` have existed in `filings.js` since session 67 (`filings.js:207` and `:242`) and until session 68 **nothing in `scripts/` could reach them**, so no human could move a filing off `needs_review`. Since signal D reads that field and only that field, **signal D could never have fired.** A recon pass found this; Claude had twice asserted from memory that the writers themselves did not exist, which was wrong in a way that would have produced a redundant commit.

**One script for both directions**, confirm by default and `--reject` as the flag, following `satisfy-person.js`'s satisfied and unsatisfied precedent: one axis, two directions, one flag choosing between them.

**Both outcomes are TERMINAL.** `filings.js` refuses any transition out of `confirmed` or `rejected`, so running the command twice against one record is an error rather than a no-op, and the error names whatever the review value already is.

**`messageId` and `attachmentId` are raw Gmail ids and this is deliberately OPERATOR-ONLY.** `satisfy-person.js` resolves a name to a participant id because a human cannot know participant ids by heart. The equivalent here would resolve a filename to a filing record. **That is NOT built, because nothing in the codebase creates filing records yet, so there is nothing on disk to resolve against.** Building a resolver against a store that is always empty is guessing at the shape. **What the agent-facing key for this operation should be is an open 7.7 question for whenever the orchestrator exists.**

**Confirming does not touch `status`.** The two axes are independent per 7.12, and that independence is now pinned by a test rather than by a comment: a mutation making `confirmFiling` also set `status: 'filed'` goes red.

### 7.7 THE FILING RECORD (NEW v10, BUILT session 65, `1d071a0`)

**A filing record is written BEFORE the bytes are fetched, and it does not depend on the Gmail label.** This is the design decision the whole pipeline hangs on and it came out of recon rather than intuition.

**Why the Gmail label cannot serve this purpose.** `leadIntake.js:456` applies `agent-ai/processing` to every candidate in a batch BEFORE the classify loop at line 471 runs, and Rule 4 rejects any message carrying that label on every subsequent cycle. So a message's one shot is fired before any downstream step has succeeded. For the lead pipeline that is correct: double-processing is the worse failure there, and a missed lead is a missed lead. **For a compliance product it inverts.** A document that arrives, gets labelled, and then fails on the byte fetch or the upload is gone permanently with nothing anywhere recording that it existed, and the agent's deal file is silently missing a document. That is precisely the failure the TC exists to prevent. Filing therefore keeps its own durable record and simply does not depend on the label.

**Shape.** A new top-level `filings` map on the transaction file, alongside `facts` and `items`, following the same read-patch-write-plus-event pattern as `facts.js` and `items.js`.

**Key: a length-prefixed join, `${messageId.length}:${messageId}:${attachmentId}`.** Gmail documents no character set for either id, so a plain colon join is not injective; length-prefixing pins where the first id ends regardless of contents. **The content hash CANNOT be the key, because the record predates the bytes.**

**Fields:** `messageId`, `attachmentId`, `filename` as the sender named it, `mimeType`, `size` as Gmail reports it, `status`, `seenAt`, `attempts`, `lastError`, `lastAttemptAt`, `contentHash`, `driveFileId`. Absent, never null, following `listingId` and `unit`. **The last five ship unpopulated from the first commit on purpose: retrofitting fields onto a persisted compliance record is worse than shipping them unused.**

**Statuses: `seen | filed | abandoned`.** Both terminals are one-directional and throw on re-entry. Re-seeing an already-seen record is an IDEMPOTENT NO-OP with no second event and no field reset, because that is the case a retry relies on.

**AMENDED v17 (session 72, `e1cea0a`). THE THROW GOVERNS TRANSITIONS, NOT RE-OBSERVATION.** As written above, and as implemented until session 72, `recordDocumentSeen` threw on a record at ANY terminal status. That is wrong, and 7.14's correction records what it would have cost. **A transition is a request to change state — `filed` back to `seen` is illegal and still throws. Re-observation is not a transition**: seeing the same attachment again on a later cycle is a restatement of a fact already recorded, and it is an idempotent no-op at EVERY status, terminal included. `recordDocumentFiled` and `abandonDocumentFiling` keep the throw; `recordDocumentSeen` does not. **The guard belongs in the record, not in the caller** — a caller-side guard is a rule the next caller has to remember, and 7.5's completion detection will be that caller.

**NEW v17: `recordFilingAttemptFailure(agentId, transactionId, messageId, attachmentId, opts)`.** Increments `attempts`, sets `lastError` and `lastAttemptAt` — the first writer `lastAttemptAt` has ever had. Throws if the filing is not at `seen`. Does NOT change status; only the drain pass decides when N is reached. **AND IT EMITS NO EVENT, which is the one thing about it that will look like a bug.** Per this section's own rule, the event log records what happened to the DEAL and the record carries what the MACHINE is doing about it; a fetch that failed and later succeeded is machinery. Every other function in `filings.js` writes AND emits, so the asymmetry is pinned by a test that goes red if an event is ever added.

**NEW v17: three fields captured at seen-time, because 10.2's filename could not be built without them.** `sender` (the raw `From` header, stored VERBATIM per `6762e9c`'s rule — parsing happens at naming time, not storage time), `receivedAt` (the MESSAGE's own date), and `subject`. All three are **required-but-tolerant**: the KEY must be present in opts, so a caller that forgets to thread it through fails loudly, but an empty string is a legitimate value meaning the header carried nothing. That separates "a developer forgot to wire it" from "Gmail had no From header," which are different problems that must not share a symptom.

**`receivedAt` EXISTS ALONGSIDE `seenAt` AND THE DIFFERENCE IS NOT COSMETIC.** `seenAt` is when this system saw the message; `receivedAt` is when the agent received it. 7.14 guarantees they diverge — a document arriving before its transaction is opened files on a later cycle, anywhere inside the seven-day window. A filename built from `seenAt` would be silently up to a week wrong and would look entirely correct. **This was the second gap in 10.2 and it was the dangerous one, because the first fails loudly and this one does not fail at all.**

**Three event kinds, and per-attempt failures do NOT get events:** `document_seen`, `document_filed`, `document_filing_abandoned`. The attempt count and last error live on the record. **The rule that decided the split: the event log records what happened to the DEAL, the record carries what the MACHINE is doing about it.** A fetch that timed out and succeeded on retry is machinery. A document arriving, landing, or never making it is deal history. `document_seen` is kept even though it looks derivable from the record's existence, because the record is transient and could reasonably be compacted once filed, while the log is permanent and is the compliance artifact; if arrival is not in the log then after any future cleanup the history shows a document filed with no record of when it arrived.

**CONCURRENCY, and this is a standing constraint rather than a note.** Every writer in this codebase reads the whole transaction, patches, and rewrites it. That is safe today ONLY because `store.readTransaction` and `store.writeTransaction` are fully synchronous (`readFileSync`, `writeFileSync`, `renameSync`), so once a writer starts its cycle Node's single thread cannot interleave another against the same file, however the caller schedules it. Verified under a 2-way and a randomised 5-way race. **Filing is the first NON-INTERACTIVE writer** (every prior caller was a CLI with a human typing), and `leadIntake.js` already reaches for `Promise.all` on per-message work, so this property is now load-bearing. **IT BREAKS THE MOMENT AN `await` LANDS BETWEEN THE READ AND THE WRITE, which is exactly what the bytes-and-hash commit introduces. HASH BEFORE ENTERING THE WRITE CYCLE, NEVER INSIDE IT. Nothing will fail loudly if this is violated.**

**DEDUPE: the hash is an idempotency key that also catches duplicates, and the honest framing matters.** Hashing the bytes and skipping a re-file within the same transaction removes the trivially identical case. It does NOT catch the realistic one: an APS forwarded by the co-op agent and by the lawyer, one re-flattened through DocuSign, hashes differently. Catching that means comparing content, which is extraction, which is Phase B and gated. **Near-duplicates therefore land as separate files, deliberately.** A duplicate in a deal folder is an annoyance the brokerage already handles; a suppressed document that turned out to be an amendment is a compliance problem. The hash's more important job is retry safety: if a crash happens between upload and record-write, the retry hashes the same bytes and can see the file already landed.

**FAILURE IS VISIBLE.** After N attempts a filing is abandoned and surfaces in the digest as "could not file this document" with a link to the email (Mo's wording). N is a tuning number, not a design decision. **A system that quietly retries a broken document for three weeks is lying by omission.**

### 7.8 THE ADDRESS COMPARISON FORM (NEW v11, BUILT session 66, `6f5500b` and `4341237`)

`src/transactions/address.js`, two pure functions, no I/O and no opts bag.

**`parseAddress(text)` returns a STRUCT, not a canonical string,** and the reason is Mo's answer about what agents actually type: usually just the number and street name, sometimes with `rd`/`road` or `st`/`street`, often without. So `14 bonacres` and `14 bonacres road` must be able to match, which a single canonical string can never do. Shape is `{ civic, street, streetType?, directional?, city? }`, with the optional three absent rather than null. Returns `null` when no civic number is found; text with no street number is not an address for this purpose.

**`compareAddresses(a, b)` is ABSENCE-TOLERANT on three fields and STRICT on two.** `civic` and `street` must be exactly equal. `streetType`, `directional` and `city` are a mismatch ONLY when present on both sides and different. Absence is uninformative because the stored side usually omits them.

**The directional asymmetry is the one that matters and Mo named why.** Lawrence Ave E and Lawrence Ave W are different roads, and Toronto has several such pairs, while plenty of addresses need no directional at all. Present-on-both-and-different is therefore a hard mismatch, while present-on-one is simply uninformative. City follows the same rule and exists to stop a Markham address colliding with a Toronto one, though it will rarely fire because the stored side seldom carries a city.

**`'st'` IS AMBIGUOUS AND POSITION DISAMBIGUATES IT.** In `14 St Clair Ave` it is Saint and part of the name; in `14 Bonacres St` it is Street and a type. The rule is positional (a token right after the civic number is a name prefix, a trailing token is a type) and is explicitly NOT table-lookup order. Both directions have their own test. `mt`/`mount` expands the same way, because agents write it both ways depending on what went on the listing agreement.

**THE CIVIC NUMBER IS CAPTURED BEFORE ANY PUNCTUATION STRIPPING, and this diverges from `digest.js:1401` deliberately.** That precedent collapses every non-alphanumeric run to a space in one pass, which would turn `14-16` into `14 16` and destroy a real civic range. Ranges and fractional civics are real addresses and are preserved verbatim.

**A MEASURED NODE FINDING, same class as the `.pipe()` one.** `Buffer.from(str, 'base64')` decodes the URL-safe alphabet identically to `'base64url'` on this runtime, confirmed empirically in both directions across multiple byte lengths. So no byte-equality test can distinguish the two encoding strings, and `'base64url'` is used for CONTRACT rather than behaviour: `'base64'` works by leniency, and leniency is what breaks on a version bump. The only instrument that can catch a regression here is one pinning the literal argument, which is why a `jest.spyOn(Buffer, 'from')` test exists and must not be deleted as a tautology.

**KNOWN LIMITATIONS, recorded rather than solved.** A leading unit (`Unit 5 - 14 Bonacres`) returns `null` because the civic regex anchors at the start. Trailing tokens after the street type swallow it (`14 Bonacres Rd Unit 302` leaves `streetType` absent). Both are acceptable for an agent-typed address field and both were accepted knowingly.

**THIS PARSES AN ADDRESS STRING, NOT PROSE, and that gap is the next unit of work.** `parseAddress` on an email body returns `null`, because the body does not start with a number. Signal A therefore needs a SCANNING ENTRY POINT that finds civic-number candidates inside free text and parses a window around each. That is not built.

### 7.8.1 ADDRESS PARSING AMENDMENTS (NEW v12, session 67, three commits)

**CORRECTION TO 7.8's OWN TEXT: `mt` IS NOT POSITIONALLY DISAMBIGUATED.** 7.8 says `mt`/`mount` expands the same way `st` does, which reads as though both are positional cases. They are not. `st` is the only genuinely dual-mapped token, appearing in both `streetTypes.street` and `namePrefixes.saint`. `mt` appears only in `namePrefixes`, so it is a plain leading expansion with nothing to disambiguate.

**A PREDICTED BUG THAT DOES NOT EXIST, and the reason is worth recording.** `14 Avenue Rd`, `14 Park Ave` and `14 Court St` were expected to parse wrong, on the theory that a street-type token in first position would be claimed by the type table. They parse correctly, because the trailing check only ever inspects the LAST remaining token and a first-position token is never reachable by it. The behaviour was correct by construction and held by nothing; nine tests now pin it, covering `avenue`, `park`, `court`, `crescent`, `grove`, `king`, `queen`, `bay` and `front`.

**`parseAddress` NEVER RETURNS AN ADDRESS WITH AN EMPTY STREET (defect, fixed).** Two paths reached it: a bare civic number, and a single token that happens to be a street-type alias (`14 Grove` claimed `grove` as the type and left nothing behind). `street` is one of the two strict fields in `compareAddresses`, so an empty street compared equal to any other empty street, behaving as a wildcard on a compliance path. **Two guards, covering different inputs and both required:** neither trailing check may consume a token when it is the ONLY token remaining, and an empty resulting street returns `null`. **This fired on a real received filename within an hour of shipping:** `1__DigiSign_Final_282.pdf` carries the civic number `282` alone, and the guard is what stops it matching 282 Aylesworth.

An accepted side effect: `14 St` now parses as a street named Saint rather than as an empty street with `streetType: 'street'`. Odd input either way, and the new answer is not worse.

**`extractCity` READS THE LAST COMMA SEGMENT AND STRIPS DISTRICT CODES (defect, fixed).** The old implementation split street from city at the first comma and then treated the ENTIRE remainder as one city string. Against real agreement addresses that produced `toronto c` from `10 Oak Street, 2101, Toronto C08, ON M5A 0Z1` (the digit strip ate `C08`'s digits and left the letter) and `all inclusive basement toronto e` from `282 Aylesworth Avenue, All Inclusive Basement, Toronto E06, ON M1N 2K2`. **Two of the three sampled properties carry a TRREB district code, so this was the common case, not an edge.** Two rules, again covering different inputs: a district code (one letter, two digits, its own token) is stripped alongside province and postal, and the blob is treated as COMMA-SEPARATED SEGMENTS with the city being the last segment surviving stripping. `parseAddress` still splits street from city at the FIRST comma; that is unchanged.

The realistic failure this fixes: a deal entered as `10 Oak Street, 2101, Toronto C08, ON M5A 0Z1` and its listing entered as `10 Oak Street, Toronto` produced `toronto c` against `toronto`, a hard mismatch on a field present on both sides, and `findListingCandidates` returned nothing.

### 7.9 CANDIDATE LISTING REPORTING AT DEAL OPEN (NEW v11, BUILT session 66, `fe0028d`)

`store.findListingCandidates(agentId, dealType, address, opts)` returns every non-terminal transaction of the paired listing type whose address compares as a match. `scripts/open-transaction.js` reports what it finds and prints the flag to link it.

**IT REPORTS, IT DOES NOT LINK, and this reverses the original plan.** Auto-linking was designed and then rejected in the same session. The reason is an inverted cost structure: `compareAddresses` is absence-tolerant because it was built for document matching, where a miss is free per 7.2. Here the output would be a `listingId` written onto a compliance record that the 7.1.2 tiebreak later routes on, and `14 Bonacres Rd` would tolerantly match a listing at `14 Bonacres Rd E`. **A wrong link is silent and durable; a wrong match is free.** Reusing the tolerant comparison where the output persists would have required a second, stricter comparison mode, and two address-matching semantics in one codebase will drift.

**The agent already knows it is their listing.** What they lack is the id, which is a random hex string. Printing it solves the real problem, and Rule 2's confirmation costs one flag.

**THE TYPE PAIRING IS NOW DATA.** `seller_sale` to `seller_listing` and `landlord_lease` to `landlord_listing` existed only as a shared word in two type-name strings. It is now a frozen map in `states.js` with `listingTypeForDeal`, and a test asserts its keys equal `store.js`'s `LISTING_ELIGIBLE_TYPES` so the two lists cannot drift.

**An O(n) SCAN, accepted knowingly.** There is no index or manifest, so this reads every transaction file for the agent. Acceptable because opening a deal is a once-per-transaction human action at a terminal, not a hot path. It is the first caller `listTransactionIds` has ever had, and the first code in the repo to read more than one transaction in a single operation. **Not a shape to reuse anywhere that runs per request.**

**A failure in the lookup MUST NOT fail the command.** The transaction is already written by then. The lookup is wrapped so a throw prints a note and still exits 0; a convenience must never turn a successful create into a nonzero exit.

**`store.js` now requires `address.js`, which is the first crack in "the store owns bytes, the resolver owns meaning."** `findListingCandidates` is a query rather than storage, so it is defensible, but a second such edge means the honest fix is a query module above the store rather than inside it.

### 7.10 THE SCANNING ENTRY POINT (NEW v12, BUILT session 67, `src/transactions/addressScan.js`)

`parseAddress` takes an address string. An email body is prose and an attachment filename is a filename, and `parseAddress` on either returns `null` because neither starts with a civic number. This module finds the candidates.

**THE WINDOW WIDTH QUESTION DISSOLVED, and that is the main finding.** The board framed this as picking a number: how much text after a civic number to hand the parser. **No number can be defended, because the failure is asymmetric in the dangerous direction.** Over-capture (`14 Bonacres Rd is firm` parsing to street `bonacres rd is firm`) breaks strict equality and produces a MISS, which 7.2 makes free. Under-capture (`14 Bonacres Rd E` windowed to two tokens) drops the directional, and `compareAddresses` is absence-tolerant on directionals, so it MATCHES a stored `14 Bonacres Rd W`. A document files into the wrong compliance record, silently.

**And nested windows cannot rescue it.** Trying five tokens, then four, then three: a prefix always tolerates, so `14 Bonacres Rd E is firm` against a stored `Rd W` hard-mismatches at four tokens and then matches tolerantly at three. **Shrinking MANUFACTURES the absence the comparator is built to forgive.** This is 7.9's lesson in a second location: the tolerant comparator is correct where absence is genuine and wrong where absence is an artifact of our own windowing.

**SO THE WINDOW IS DECIDED BY THE TEXT'S GRAMMAR, NOT BY A CONSTANT.** For each civic-shaped token: take the next token UNCONDITIONALLY as the first street-name token, then keep taking tokens until a terminator, a punctuation boundary, or the end of text. Hand the window to `parseAddress`. **The scanner never interprets what a token means** - trailing street type, trailing directional, `st`-as-Saint and city all remain `parseAddress`'s job, which is what keeps one parser and one comparison semantics in the codebase.

**POSITION ONE IS EXEMPT FROM THE TERMINATOR LIST, PROVISIONALLY.** Without the exemption, `the` is a terminator and `14 The Queensway` returns nothing. The Queensway, The West Mall, The East Mall, The Kingsway, The Donway and The Bridle Path are all real GTA addresses. `14 Main St` needs the same exemption because `main` is a unit word. This mirrors the rule `parseAddress` already applies for `14 Court St`.

**THE EXEMPTION IS CONFIRMED ONLY IF THE RUN CONTINUES PAST IT, and this rule was found by CC rather than specified.** Applied naively, the exemption also accepts `__16__copy` as `{civic: '16', street: 'copy'}` and `400_Agreement` as `{civic: '400', street: 'agreement'}`. The discriminator is that `The Queensway` and `Main St` both extend a further token past the forced one while `16 copy` and `400 agreement` do not. **So: a window whose only street token is a terminator is discarded.** The check counts tokens taken into the WINDOW, before parsing, and must NOT be reapplied to `parseAddress`'s output, where `22 Main St` legitimately reduces to street `main` once `St` is consumed as a type. A mutation exists specifically to hold that distinction.

**TOKENISATION: split on whitespace and underscores, never on hyphens.** A hyphen inside a digit run is preserved because `14-16` is a real civic range that 7.8 deliberately protects. Extension stripping was considered and rejected: `14 Bonacres Rd.` ends a sentence in prose, and a rule that removes a trailing dot-token mangles real text to serve a case the tokeniser already handles, since `.` is punctuation and `pdf` becomes its own terminating token anyway.

**THE TERMINATOR LIST is frozen and pinned by a test, three groups, flattened for lookup.** Function words: `a, an, and, as, at, but, by, for, from, in, is, it, of, on, or, please, re, see, the, this, to, was, we, will, with, you, your`. Document words: `accepted, addendum, agreement, amendment, aps, completed, conditional, confirmation, copy, doc, document, executed, final, firm, form, lease, notice, offer, release, revised, scan, schedule, signback, signed, waiver`. Unit words: `apartment, apt, basement, bsmt, floor, lower, main, penthouse, ph, suite, unit, upper`. **The list does not need to be complete to be safe:** a missing terminator over-consumes, which produces a miss, which is free. It only needs to be right about what it contains, and every entry is either observed in the corpus or drawn from the item catalog.

**"WHAT IF A BODY NAMES THREE ADDRESSES" DISSOLVED WITH THE WINDOW WIDTH.** Three civic occurrences produce three windows. Signal A fires for a transaction if ANY window compares equal to its address. Two transactions matching is already a miss under 7.1.2. No new machinery.

**KNOWN LIMITATION, accepted knowingly:** a hyphen is a hard boundary, so `14-Bonacres-Rd-APS.pdf` yields nothing. This follows from the tokenisation rule, which was derived from a corpus where hyphens appear only as phrase separators and inside civic ranges. Zero observed examples of the hyphen-as-word-separator convention. A miss is free; revisit if it shows up in real filenames.

### 7.11 SIGNAL E: READING THE DOCUMENT (NEW v12, PROMOTED FROM PARKED, NOT BUILT)

Mo asked why the system cannot read the document and assign it accordingly. It can, it is the strongest signal available, and the objection that parked it turned out to be false.

**IT DOES NOT BREAK THE NO-MODEL RULE.** Pulling a PDF's text layer and running `addressScan` over it is not a model call and not Rule 1 extraction. The matcher stays pure and deterministic and the ninety-percent bar stays a rule a test can hold. Reading a document FOR FACTS is Phase B and gated; reading it for an address is just another string.

**THE OBJECTION THAT PARKED IT WAS WRONG.** The claim was that an APS carries five or six addresses (property, buyer's home, seller's home, both brokerages, both lawyers), so the move-up buyer's purchase agreement would carry their current home address and collide with their own listing. **Counted in the actual text of three real agreements: exactly ONE genuine address each.** Address for Service is blank on all three. Brokerages appear by name and phone, never street address. Lawyer fields blank.

Everything else civic-shaped in those documents is boilerplate: `1 of`, `2 of`, `400 Revised`, `2026 Page`, `24 hours`, `12 months`, `75 Feet`, `200 Feet`, `1990 unless`, `4 Garbage Removal`, `60 days prior`, `21 ATRIA REALTY INC.` **None can produce a false match**, because a match requires exact equality on civic AND street and these yield streets like `of`, `feet`, `hours`, `months`, `page`. Several collapse to `null` outright under 7.8.1's empty-street guard, because the token after the number is a function word.

**SO LABEL-ANCHORED PARSING IS NOT REQUIRED.** "Does the stored address appear anywhere in this text" is sufficient, which deletes the form-aware parsing project this signal was thought to need and removes most of the reason it was parked.

**`pdftotext -layout` IS REQUIRED, AND IT IS A ONE-FLAG DIFFERENCE BETWEEN A WORKING SIGNAL AND A DEAD ONE.** Raw `pdftotext` on the DocuSign-executed APS emits each field value as its own text run on its own line:

```
14

Bonacres Ave

Toronto
```

The civic number is SEPARATED from the street, so a scanner treating newlines as boundaries gets the window `14`, which is now `null`, and signal E is dead. `-layout` rejoins them onto one line. Note that the `-layout` line carries no commas, so raw `parseAddress` returns street `bonacres ave toronto on m1c 1p7` and misses; the 7.10 scanner stops at `toronto` and recovers `14 Bonacres Ave` correctly. **The scanner is needed even on strings that already look like addresses.**

**CORRECTION TO SECTION 15's RECON ITEM 5.** Item 5 concluded that DocuSign-flattened OREA forms defeat linear text extraction, pointing Phase B at vision or coordinate-aware extraction. That is right for SCANS and wrong as a general statement. Measured on four real files: three carry full text layers of 5,000 to 8,000 characters per page (DocuSign DMv10, UniDoc/DigiSign, and a SkySlope/PropTx export), and one, produced by TurboScan, yields ZERO characters on its only page. **So the split is digital-versus-scanned, not DocuSign-versus-not.** Vision is the right answer for the scanned class and unnecessary for the rest.

**WHAT IT COSTS, and why it is still not built.** The fetch order inverts: matching is currently a gate that runs BEFORE attachment bytes come down, so only matched attachments are fetched. If document text is a signal, every PDF must be fetched and parsed to find out whether it is a deal document. That is API volume, memory, and time on every cycle. It also needs a PDF text dependency. **Signal E lands after the matcher works, and it does not remove 6.1:** scanned documents, non-instrument attachments, and anything where the property address is not prominent all still need signal B.

### 7.12 SIGNAL D's IMPLEMENTATION (NEW v12, BUILT session 67)

`hasConfirmedFilingOnThread(transaction, threadId)` in `filings.js`. Recon at the start of session 67 found signal D had NO implementation anywhere, and 7.3's `needs_review | confirmed | rejected` was spec-only with no field behind it. Both are now real.

**IT RETURNS A BOOLEAN, deliberately unlike `compareAddresses` and `resolveParticipantByName`, which return result objects.** The question is genuinely yes-or-no, and returning the matching record would invite callers to use this as a filing lookup, which is a different function with a different key.

**IT IS A PURE READ over an already-loaded transaction.** No `agentId`, no store touch. The caller has the transaction in hand.

**`status` IS IRRELEVANT AND MUST NOT BE READ.** A document the agent confirmed belongs to this deal still belongs to it even if the Drive upload was abandoned. Reading `status` would make an infrastructure failure look like a matching failure. A test pins the abandoned-but-confirmed case for exactly this reason, and a mutation exists because `status === 'filed'` looks like a missing safety check to anyone reading the function cold.

**`needs_review` is not enough** (nobody has looked) **and `rejected` is evidence the thread does NOT belong to this transaction**, never evidence that it does. `threadId` comparison is exact, with no normalisation: Gmail thread ids are opaque and case-sensitive.

**IT IS REACHABLE AS OF SESSION 68, AND IT WAS NOT BEFORE.** `confirmFiling` existed but no CLI verb called it, so nothing could ever set `review: 'confirmed'` and signal D was structurally dead. `scripts/review-filing.js` closes that (see 7.3). **The matcher CALLS this function rather than reimplementing the gate**, so the rule has one home: `matcher.js` requires `filings.js`, which pulls in `store.js` transitively. Requiring is not calling, no I/O runs at module load, and the alternative is one rule in two places.

**THE ABANDONED-BUT-CONFIRMED CASE IS PINNED TWICE OVER.** A filing with `review: 'confirmed'` and `status: 'abandoned'` gives D true, asserted in both the filings tests and the matcher tests, because the two axes answer different questions and a reader coming to this cold will see `status === 'filed'` as the obvious missing check.

### 7.13 `observedAddresses` (NEW v12, BUILT session 67, **ACCUMULATOR WIRED session 69**, `1270dfa`)

**THE THREE PIECES ARE CONNECTED AS OF v14.** `src/transactions/accumulator.js` holds `accumulateObservedAddresses(transaction, message, agentConfig, opts)`: it gates on `hasConfirmedFilingOnThread`, collects via `collectMessageAddresses`, and writes via `recordObservedAddresses`. It sits where `matcher.js` sits in the dependency graph, calling the stores rather than reimplementing their rules. **`agentId` and `transactionId` are derived from the transaction ENVELOPE rather than taken as arguments**, which removes the class of caller error where agent A's transaction is written under agent B's id. Three outcomes are reported distinctly, gate-not-met, gate-met-but-nothing-to-collect, and recorded, on the same reasoning that kept `no_candidates` and `no_bar_met` separate in 7.1.2a: collapsing them makes the dormant period unreadable. **It ships DORMANT and that is expected**, because nothing creates the filing records the gate reads until the orchestrator exists.

**A DEFECT FOUND AND NOT YET FIXED (parked in v14, FIXED session 72, `38f2cdb`).** Handed a non-empty array whose addresses are ALL already stored, `recordObservedAddresses` still writes: a new `updatedAt` and an `addresses_observed` event carrying `addresses: []`. Only a literally empty array short-circuits. That contradicts this section's own rule that the event log records what CHANGED. **The guard is NOT simply `addedAddresses.length === 0`**, because the name-backfill branch mutates a stored entry without being tracked by that variable, so a naive guard would no-op a real write.

**AND THERE WAS A SECOND DEFECT THIS SPEC NEVER DESCRIBED, WHICH IS THE WORSE OF THE TWO.** The name-backfill branch is a REAL MUTATION to a compliance record, and because it never touches `addedAddresses`, the event fired saying `addresses: []`. So the first defect is churn — noisy, harmless. The second is an **audit-trail gap: the event log reported that nothing changed while something did**, on a record whose entire purpose is to answer "why does the system think this address belongs to this deal." Churn is annoying. A log that omits a real mutation is the thing this product exists not to do.

**THE FIX IS THREE STATES, NOT A GUARD.** Nothing changed (no write, no event, previous returned unchanged); addresses added (write, event names them); names backfilled (write, and **the event says so** via a second payload field). The two are tracked in separate variables and never folded together, because "a new party is on this deal" and "we learned an existing party's name" are different facts and an audit trail must be able to tell them apart. The no-op condition is BOTH lists empty, never `addedAddresses` alone.

**PROCESS NOTE WORTH MORE THAN THE FIX.** The defect-2 test was written and confirmed RED against the unfixed code before anything was changed. Written after, it would have passed either way, because asserting on a payload field that does not yet exist reds trivially and proves nothing about the defect. **A passing test is evidence only if you know what would make it fail.**

A new top-level map on the transaction, alongside `facts`, `items`, `filings` and `participants`. Written by `recordObservedAddresses` in `src/transactions/observedAddresses.js`.

**Shape:** `observedAddresses: { 'jane@firm.com': { firstSeenAt, threadId, name? } }`, keyed by the lowercased trimmed address, `name` absent rather than null when unknown.

**MONOTONIC.** `firstSeenAt` and `threadId` are written once and never change: they answer "why does the system think this address belongs to this deal", and that answer must stay pinned to the first observation rather than drifting to the most recent. **One exception:** a stored entry with no `name` gains one from a later observation, because a name is information and discarding it manufactures the nameless-participant problem 6.2 exists to work around. On a genuine name conflict the FIRST name wins, the same discipline as `conditions` recording what the agreement contained rather than tracking current state.

**IT TAKES THE WHOLE ARRAY AND WRITES ONCE.** A per-address writer would mean N read-patch-write cycles against one transaction file, which is exactly the concurrency shape the filings tests guard against.

**AN EMPTY ARRAY IS A NO-OP:** no write, no event, transaction returned unchanged. A message with only the agent on it is not an observation.

**ONE EVENT PER CALL, `addresses_observed`, and its payload lists only the addresses ACTUALLY ADDED**, not the ones submitted. The event log records what CHANGED. `EVENT_KINDS` is now fifteen.

**THE FEEDER IS `collectMessageAddresses`** in `src/transactions/messageAddresses.js`: it runs the recipient parser over `from`, takes the already-parsed `to` and `cc`, drops the agent's own address (compared after trimming and lowercasing BOTH sides, because `agentConfig.gmailAddress` is stored raw with only a trim), and dedupes by address keeping the first occurrence for order while filling in a later name if the first had none.

**GMAIL RECIPIENT PARSING IS A STATE MACHINE, NOT A SPLIT.** `parseRecipientList` in `src/recipientParsing.js`, a module that requires nothing. A comma inside a quoted display name or inside angle brackets is not a separator, so `"Smith, Jane" <jane@firm.com>, bob@firm.com` must not be cut into garbage. **The failure policy is the load-bearing part:** parse what is parseable, keep an address whose NAME is malformed, and drop a fragment only when no address can be recovered at all. A silently dropped recipient is a lie by omission. A bare fragment containing `@` is additionally shape-checked against whitespace, angle brackets and quotes, because an unterminated quote leaves the parser mid-string and the whole tail would otherwise be accepted verbatim as a fabricated address.

**DISPLAY NAMES ARE PRESERVED, on Mo's call and for a spec reason.** 6.2 makes `name` optional precisely because auto-discovery often produces a bare address, and 6.4's `namelessCount` exists so the CLI cannot lie about it. If the header says `"Jane Smith" <jane@firm.com>` we know her name, and discarding it manufactures the exact problem that machinery works around.

### 7.14 THE ORCHESTRATOR IS TWO PASSES (NEW v16, ARRIVAL PASS BUILT session 71 `f26c8e7`, **DRAIN PASS BUILT session 72 `e1cea0a`. BOTH PASSES ARE NOW LIVE.**)

**THE SPLIT WAS NOT INVENTED; IT WAS READ OFF THE CODE.** Every module in `src/transactions/` is synchronous — `readFileSync`, `writeFileSync`, `renameSync`, no `async` anywhere in ten files — and everything touching the network is async. Cutting the orchestrator on that seam is what makes 7.7's concurrency constraint enforceable. 7.7 warns that the store's safety "breaks the moment an `await` lands between the read and the write, and nothing will fail loudly." Under the split, the arrival pass has no awaits at all, and the drain pass completes every await BEFORE opening a write cycle. **The hazard stops depending on discipline.**

**PASS 1, ARRIVAL. Synchronous, zero network. BUILT.** `src/transactions/intake.js`, `matchAndFileAttachments(agentConfig, message, opts)`. For one message: `readAllTransactions` ONCE (7.1's caller contract, which the module cannot enforce), then per attachment `matchTransaction`, then `recordDocumentSeen` on a match. Unmatched attachments do nothing, per 7.2.

**PASS 2, DRAIN. All the async. BUILT session 72, `e1cea0a`.** `src/drain.js`, `drainFilings(agentConfig, opts)`. Sweeps filings at status `seen`: fetch bytes, resolve the folder, upload, then enter the synchronous `recordDocumentFiled` cycle. On failure `recordFilingAttemptFailure`; at **N = 5** attempts, `abandonDocumentFiling`. **This is where `attempts` finally has a home, and it explains why the field read as unincrementable for six sessions: a single-pass orchestrator has exactly one attempt.**

**IT LIVES OUTSIDE `src/transactions/`, deliberately**, next to `driveFolders.js`, because it is async and this section's whole premise is that everything inside `src/transactions/` stays synchronous.

**N = 5 IS FIVE CYCLES, NOT FIVE ATTEMPTS, and the arithmetic is why it is not lower.** `fetchAttachmentBytes` is a GET, which gaxios already retries three times; `uploadFile` is a POST wrapped in `withGoogleRetry` for three more. So one drain cycle is already up to three fetch attempts and three upload attempts, and N=5 across five-minute cycles is roughly fifteen of each spread over twenty-five minutes. **Mo's call.**

**THE HASH CONSTRAINT IS NOW STRUCTURALLY UNVIOLATABLE, which was luck rather than design.** 7.7's loudest warning is HASH BEFORE ENTERING THE WRITE CYCLE, NEVER INSIDE IT, with the note that nothing will fail loudly if violated. `fetchAttachmentBytes` returns `{ buffer, contentHash }` — it hashes inside the fetch, on the raw bytes. There is nothing left to hash later, so the rule cannot be broken by a caller. **Do not "tidy" the hash out of the fetch.**

**THE SWEEP READS EVERY TRANSACTION AND THERE IS NO INDEX, deliberately.** An index would be a second source of truth about filing status, and drift between an index and a compliance record is the failure class this project designs against. The reads are small synchronous JSON reads. If the cost ever bites, the fix is archiving terminal transactions, not indexing.

**THE FILING LOOP IS SEQUENTIAL, NOT `Promise.all`, and this is load-bearing rather than stylistic.** Per 7.7 the store's safety holds only because reads and writes are synchronous and nothing interleaves. Every await must complete before the next synchronous write cycle opens. `Promise.all` over filings would put awaits between a read and a write on one file.

**A LOST-WRITE CLASS FOUND DURING THE BUILD, AND THE ROOT CAUSE IS AN API ASYMMETRY.** `recordDocumentFiled`, `recordFilingAttemptFailure` and `abandonDocumentFiling` all take IDS and re-read internally, which is why they are safe. `ensureTransactionFolder` takes the transaction OBJECT and persists whatever it is handed. Reusing a stale snapshot across two filings on one transaction therefore lets the folder-creation write silently clobber an earlier filing's failure write. Fixed by re-reading immediately before that call. **The instance is fixed; the trap is not.** One function in the chain has a different contract than its neighbours, and the next object-taking call added here hits it again. **PARKED: give `ensureTransactionFolder` an id-taking signature.**

**THE BYTE CAP IS CHECKED IN PASS 1, NOT PASS 2.** Gmail's reported `size` is on the filing record at arrival and is DECODED bytes with no base64 conversion, so an oversized attachment is recorded `seen` and immediately abandoned with a reason naming both numbers, without ever being fetched. Cap is 25MB, set at Gmail's own attachment ceiling so it never fires in normal operation. It is hygiene, not a memory limit (10.5). `attempts` stays 0, which is honest: nothing was attempted.

**PLACEMENT: over the raw candidate list, BEFORE `applyPreFilter`.** An executed APS from a lawyer classifies as `business_correspondence`, so any hook inside the pre-filter's branches or downstream of the classifier never sees it. Running early costs a few synchronous matcher calls on messages that turn out to be noise, and an unmatched attachment does nothing, so that is the entire price. The call site is `src/leadIntake.js`, immediately after `fetchUnreadInboxEmails` and before the Sheet read.

**PASS 1 IS RE-ENTRANT BY CONSTRUCTION, AND THAT BUYS SOMETHING THIS SPEC ASSUMED WAS LOST.** The intake query is `is:unread in:inbox -label:"agent-ai/noise" newer_than:7d` and Rule 4 rejects anything already labelled, so 7.4 correctly says deal-open detection gets ONE shot per message. **Filing does not.** The filing record — not the Gmail label — is the idempotency guard, which is exactly why 7.7 decoupled the two. **Consequence: a document that arrives BEFORE its transaction is opened still files on a later cycle**, as long as it is inside the seven-day window. Do not "fix" the re-entrancy with a label or a seen-set.

**CORRECTION, v17, AND THIS SENTENCE WAS FALSE WHEN v16 WROTE IT.** v16 stated as fact that "`recordDocumentSeen` is an idempotent no-op on re-entry." **It was not.** It was idempotent for a record at `seen` and it THREW on any terminal re-entry, because 7.7's one-directional rule was applied to re-observation as well as to transitions. That happened to be harmless only while `filed` was unreachable — and the drain pass is the commit that makes `filed` reachable.

**The consequence, had it shipped uncorrected, is the ordinary successful path.** A document files, status goes to `filed`, the next cycle re-runs Pass 1 over the same message per this section's own design, `recordDocumentSeen` throws, and `leadIntake.js`'s try/catch swallows and logs it. **Every five minutes, for every successfully filed document, forever, with nothing looking broken enough to investigate.** The spec's stated foundation and the bug would have arrived in the same deploy.

**FIXED IN `e1cea0a` BY NARROWING 7.7 RATHER THAN GUARDING THE CALLER.** A guard in `intake.js` was written first and then moved, because re-entrancy is a property of the RECORD, not of one caller's discipline — the same reasoning that put this split on the sync/async seam. See 7.7's amended terminal rule: the throw governs TRANSITIONS; re-observation is an idempotent no-op at every status.

**THE ONCE-PER-MESSAGE READ IS NOT HOISTED TO ONCE PER CYCLE, deliberately.** This pass writes to transactions, so a later message in the same cycle can legitimately need fresh data. The comment saying so is load-bearing against a future optimisation.

**THE HOST IS THE EXISTING LOOP.** `server.js`'s five-minute `setInterval` already iterates every agent per tick and calls per-agent jobs like `maybeRunContentEngine`. The orchestrator is a branch in machinery that exists, not new infrastructure.

**THE EMPTY-STORE PATH IS THE ONLY ONE RUNNING IN PRODUCTION TODAY, and it was verified before deploy.** Every agent has zero transactions and no `${agentId}.transactions/` directory, and every test creates a transaction first. `listTransactionIds` returns `[]` on a missing directory, `readAllTransactions` propagates that, and `matchTransaction([])` returns `no_candidates` rather than `no_bar_met` — so 7.1.2a's decision to keep those two reasons distinct pays off in a place nobody anticipated: the logs can tell "no deals exist yet" apart from "deals exist and nothing matched."

**THE ACCUMULATOR IS (b), PER CANDIDATE. WIRED session 72, `38f2cdb`, after 7.13's defect was fixed.** `accumulateObservedAddresses` gates on `hasConfirmedFilingOnThread` — the THREAD, not the match — so calling it only with the matched transaction would mean learning addresses from messages that already matched, which is circular. The value is the opposite case. `matchTransaction` exposes no candidate set on a match, so the accumulator iterates `readAllTransactions` directly.

### 7.15 THE MERGED TOUCHPOINT LOOP (NEW v17, BUILT session 72, `38f2cdb`)

**THE TWO TC TOUCHPOINTS ARE ONE LOOP, and merging them made the cycle CHEAPER rather than more expensive.** `src/transactions/touchpoints.js`, `processTcTouchpoints`, synchronous, positioned where 7.14's arrival pass sat: over raw `messages`, before `applyPreFilter`. Per message it reads `readAllTransactions` ONCE and that read serves both the accumulator and the matcher.

**IT IS A REAL MODULE, NOT AN `_internal` EXPORT.** Testing through `runLeadIntake` would mean mocking gmail, sheets and the classifier to reach one seam, which is a real cost — but session 66 already answered that pressure for `parseRecipientList`: extract to a leaf, never re-export. `processTcTouchpoints` depends only on `queries`, `accumulator` and `intake`, all already in `src/transactions/`, so it is a clean leaf and stays synchronous.

**ORDER IS ACCUMULATOR FIRST, THEN MATCHER, AND IT IS LOAD-BEARING.** `accumulateObservedAddresses` takes the transaction OBJECT and its gate reads `transaction.filings`. Pass 1 calls `recordDocumentSeen`, which WRITES. Running the matcher first would hand the accumulator a stale object — the same lost-write class as `ensureTransactionFolder` in 7.14. It is harmless today only because a freshly written filing is `needs_review` while the gate wants `confirmed`, which is a safety property borrowed from another module and therefore not a safety property.

**AND THE CANDIDATES ARE RE-READ BETWEEN THEM, CONDITIONALLY.** The accumulator can write, and the matcher READS what it writes: per 7.13 signal B reads either a participant's `emails[]` or `observedAddresses`. So if any accumulator call for this message returns `outcome: 'recorded'`, candidates are re-read before matching. Not otherwise. **The conditional is what keeps "one read serves both" true in the common case, and the accumulator's three distinct outcomes — a session-69 decision made for unrelated reasons — are what make the condition cheap to test for. Collapsing those outcomes later breaks this.**

**DO NOT MOVE THIS INTO `leadIntake.js`'s SECOND LOOP.** `applyPreFilter` skips replies, and deal-thread messages ARE replies, so the accumulator would be filtered out of exactly the threads it exists to learn from.

**THE COST ACCEPTED DELIBERATELY:** `readAllTransactions` now runs for EVERY unread message, not only attachment-bearing ones. Small synchronous JSON reads. Same answer as 7.14's sweep if it ever bites: archive terminal transactions, do not index.

**`matchAndFileAttachments` NOW TAKES `candidates` AS A PARAMETER**, which amends 7.14's caller contract from a comment the module could not enforce into a signature it can.

**AND `queries.readAllTransactions` NEVER THREADED `baseDir`.** Invisible until a test used real modules against a fixture directory rather than mocks. Fixed in the same commit. Recorded because it is the same lesson as the clobber test: **mocks hide plumbing bugs, and a test that mocks the seam cannot see a defect that lives there.**

### 7.4 Deal-open detection (NEW v2)

Today, transaction correspondence classifies as `business_correspondence` in Lead Intake and is left alone. v2 adds a detector stage for deal-open signals, running on mail that clears the existing pre-filters:

Signals, in descending strength:

- An attachment classified as an executed/accepted instrument: accepted APS, accepted Agreement to Lease, signed listing agreement (sale or lease).
- Acceptance language in subject or body ("accepted", "firm", "we have a deal", "congratulations" paired with a property address) combined with a sender already known to the lead pipeline.
- A lead row whose thread suddenly includes a lawyer or opposing agent.

On detection, the system does NOT open a transaction (Rule 2). It assembles a proposal and surfaces it to the agent: "Looks like 456 Elm St went firm. Open the deal file?" The proposal carries everything sections 6.1 and 7.6 could pre-assemble. Detection is per-thread idempotent (label-based, same pattern as Lead Intake's processing labels): one thread proposes one deal-open, and a rejected proposal is not re-proposed from the same thread.

The confirmation surface is v1-pragmatic: a structured email to the agent (the review-email pattern the Content Engine already uses) with a link into the operator-assisted flow, upgrading to a dashboard screen when the agent dashboard ships. The surface is disposable; the assembler is not. Nothing in the assembler may assume which surface renders it.

False-positive posture: a wrong deal-open proposal costs the agent one dismissal and costs us credibility, so the detector tunes conservative. Missing a deal-open is recoverable (the agent opens manually, which is v1 behaviour anyway); proposing garbage weekly is not. Same asymmetry logic as HOT_SMS_CONFIDENCE_THRESHOLD.

### 7.5 Completion detection (NEW v2)

When an inbound attachment classifies as a clearing instrument for an open transaction's outstanding item, the pipeline proposes the completion in the same motion as the filing:

- A waiver or notice of fulfilment naming the financing condition, matched to a transaction with `financing` outstanding, proposes: "Financing waiver received from buyer's lawyer. Mark the financing condition cleared?" with `waiver` pre-selected as the clearing instrument (agent can flip to `notice_of_fulfilment`).
- A status certificate arriving proposes the received-date sub-item.
- An executed Ontario Standard Lease proposes the section 5.5 executed item.

The proposal carries the filed document link and the classification reasoning. Rule 2: the item flips only on agent confirmation. Completion detection is the highest-frequency wow in the product: it is the difference between "a checklist I maintain" and "a checklist that maintains itself."

### 7.6 Date extraction with evidence (NEW v2, implements Rule 1 as amended)

When the deal-open detector fires with an executed instrument attached, an extraction pass (Sonnet, given the stakes; not Haiku) reads the document and proposes:

- transaction type and side
- property address
- conditions present, each with its date
- irrevocable, completion/closing, possession dates as applicable
- deposit amount and recipient

Every proposed date carries `{value, sourceExcerpt, sourceDocumentId, pageRef?, extractedAt}`. The confirmation screen renders each date NEXT TO its excerpt. Confirmation is per field. A date without an excerpt is never proposed; it renders as an empty field for manual entry. Bulk accept is banned (section 1.1).

Extraction quality is a HARD GATE before any paying agent uses this path (section 14): the calibration harness pattern from the Content Engine applies, with a fixture set of real Ontario instruments (redacted), and the measured metric is excerpt-anchored accuracy, not extraction rate. An extraction that returns the right date with the wrong excerpt is a FAILURE, because the excerpt is what the agent verifies against.

#### 7.6.1 What is extractable, and what is not (LOCKED session 64)

**THE RULE: a fact is extractable when a SINGLE INSTRUMENT STATES it. A fact that requires the ABSENCE of a document is not extractable, because absence from what the system has seen is not absence from the file.** The system sees an inbox; the brokerage sees a package. Confusing those is how the TC starts asserting things Rule 3 says it has no standing to assert.

Applied to the four deal-open facts:

- **`representedPersons`, `entityType`, `conditions`: EXTRACTABLE.** Each is a positive statement on page one of an accepted APS, which is the instrument that opens the deal anyway. Extraction proposes, the agent confirms, and manual entry is the fallback rather than the primary path.
- **`hasSelfRepresentedParty`: NOT EXTRACTABLE, permanently, by design rather than by capability.** Mo's field evidence is what decides it. The co-operating brokerage field is either a named brokerage, a double-ender, or BLANK, and blank means self-representation. But when his admins see a blank they go looking for a confirmation of co-operation or something else in the package before treating the party as unrepresented. So the evidence is a judgment across a document set, not a value on a form. **Extraction must NEVER set this fact false from an absence.** A named brokerage is positive evidence of false; a blank is `indeterminate` and the agent answers. Inferring false from a blank would silently rule out the unrepresented-party disclosure and the FINTRAC unrepresented-party record, and would do it invisibly, since a `not_applicable` row is one nobody looks at again.

**Two consequences worth carrying.** The stored fact stays a boolean, but the extraction prompt and any agent-facing copy should be phrased as the question with an answer, not the assumption with an exception: read as "was there a self-represented party," a blank feels like no; read as "who was on the other side," a blank is plainly unanswered. And **a co-op field naming the agent's OWN brokerage is positive evidence of multiple representation**, which IS extractable and currently has no catalog item, which makes the dual agency gap the strongest of the parked catalog items rather than the vaguest.

**NAMES SPECIFICALLY.** Names come off the instrument exactly as written, with no tidying: `Jennifer A. Smith` stays `Jennifer A. Smith` even if the agent calls her Jen, because the point is agreeing with what the brokerage files under. Names are proposed and never applied silently, because extracting one name from a two-buyer APS collapses per-person satisfaction to one person, which is the exact failure that mechanism exists to prevent. And **`representedPersons` is the agent's OWN clients, not every name on the document**: a buyer-side APS carries the sellers too, and an extractor that grabs every name puts the other side's clients on the file and starts asking whether the seller received the buyer's RECO Guide. The extractor must key on which side the agent is on, which it can take from the transaction type.

## 8. Chase drafting (NEW v2, the feature no competitor can copy)

Every competitor reminds the agent. None of them own the agent's outbox. GetKlosed does, with a per-agent voice profile and Shadow Mode already built. A human assistant's actual value is not tracking deadlines, it is chasing people. This section is the assistant-replacement pitch made literal.

### 8.1 Behaviour

When an outstanding checklist item is approaching its agent-confirmed date and no inbound mail from the responsible participant has matched the transaction within the lookback window, the system drafts the chase email in the agent's voice and proposes it:

"Hi Sarah, following up on the status certificate ordered on the 12th, the review window is coming up Thursday. Anything you need from our side?"

- Responsible participant is derived from the item and the role model (status certificate chases `condo_manager` or `client_lawyer` per item rules; financing chases `mortgage_broker`; instrument signatures chase `opposing_agent`).
- Drafting reuses the existing draft engine: `claude.draft`, merged banned phrases, em-dash strip, retry-then-fallback. No new drafting infrastructure.
- Delivery is Shadow-Mode-shaped regardless of the agent's lead-pipeline mode setting at launch: every chase draft goes to the agent for approval before it goes to a third party. Chasing a lawyer with a tone-deaf AI email is a professional-relationship risk that the lead pipeline's shadow/live toggle was not designed to price. A per-agent `chaseMode` flip to live-send is a v2+ decision that requires observed draft quality first.
- One chase per item per window. Chase cadence is item-typed data in the rules catalog, not code.

### 8.2 What a chase never does

- Never asserts a legal position ("you are in breach", "the condition has expired"). Chases are logistics, not law. Banned-phrase list per chase type.
- Never states a deadline the agent has not confirmed (unconfirmed dates cannot trigger chases at all, per section 1.1).
- Never chases the agent's own client through this mechanism (client comms are section 9 and have their own rules).
- Never sends without agent approval at launch.

## 9. Client milestone communications (NEW v2, staged)

The second half of the assistant's job: keeping the client informed. Two artifacts, deliberately staged because client-facing liability is a different animal from third-party logistics.

### 9.1 v1: the deal status one-pager (generated artifact, agent-forwarded)

Per open transaction, the system maintains `Summary.md` / `Timeline.md` in the Drive folder (section 10): current state, cleared and outstanding items with dates, next milestone. Regenerated on every confirmed change. The agent forwards or screenshots it to their client. Zero new send surface, zero client-facing liability beyond what the agent chooses to share, and it is already spec'd as a Drive output.

### 9.2 v2+: drafted client milestone emails (deferred, design captured)

On confirmed state transitions and item completions, draft a client update in the agent's voice: "Good news, your financing condition cleared today. Next up is the home inspection on Thursday." Same Shadow-Mode-shaped approval as chases. Deferred because: the copy discipline of Rule 3 ("still waiting on" honest, "all clear" banned) is hardest to hold in celebratory client mail, and one over-promising sentence to a client is worth more E&O exposure than a hundred lawyer chases. Revisit after chase drafting has real-world draft-quality data.

## 10. Storage: volume state, Drive documents

**System state never lives in Drive.** The transaction folder lives in the agent's Drive, and the agent can rename it, move it, share it, or trash it. State cannot live somewhere a user can delete by accident.

- **Railway volume (`STORAGE_ROOT`), alongside the existing agent file family:** transaction record, checklist state, participants, dates with evidence records, audit trail. Same `src/storagePaths.js` resolution.
- **Drive (`drive.file` scope, already granted):** documents only. Per-transaction folder: one deal, one folder, archivable, exportable, scales.
- **Drive, generated read-only artifacts:** `Timeline.md`, `Summary.md` (section 9.1). They are **outputs, never inputs**. Nothing reads them back. If the agent deletes them, we regenerate them and lose nothing.

### 10.2 Folder shape and file naming (LOCKED session 65)

**The transaction folder is named ADDRESS PLUS DATE, is created AT DEAL-OPEN with whatever is known, and is NEVER RENAMED.**

Address alone collides: the same agent may sell the same property twice in two years, which is two transactions. (A relist is not this case; per 4.2 it lands in the same transaction.) So a date disambiguates. **Which date is the interesting part.** Mo's instinct was the closing date, and it reads correctly to an agent, but at deal-open the closing date may not be confirmed yet and Rule 1 forbids acting outwardly on an unconfirmed value. Naming a folder is outward. It is also the field most likely to move, and a folder that renames itself when a date shifts is confusing.

**Resolution: create the folder at deal-open with what exists.** If a confirmed closing date is available it goes in the name; if not, the deal-open date goes in, which still solves the actual collision problem. Waiting for a confirmed closing date would block filing on a fact that may arrive late. **A folder name is a LABEL, not a record.** The amended date lives on the transaction where it belongs.

**FLAT inside the transaction folder for Phase A.** Subfoldering by document type is tidier but requires knowing the type, which is extraction, which is Phase B and gated.

**Filenames: `<date received> - from <sender> - <original name>`.** The sender's own name is often useless (`Document_2.pdf`), so renaming is right, but in Phase A the system does not know what a document IS and a rename must not claim otherwise. **THE RULE: a filename may contain only things we OBSERVED, never things we INFERRED.** Date received and sender are observed. Document type is inferred and waits for Phase B, at which point it can be inserted with the original still trailing it. Chronological sort falls out for free, and the original name is preserved so nothing is lost.

**AMENDED v17 (session 72, `e1cea0a`): THIS FILENAME WAS UNBUILDABLE AS WRITTEN, AND IT IS THE SAME FAILURE AS THE FOLDER ID ONE SECTION ABOVE.** Nothing persisted a sender. The filing record carried `messageId`, `attachmentId`, `filename`, `mimeType`, `size`, `threadId` — and no sender field, because `recordDocumentSeen` never took one. `leadIntake.js` had `msg.from` in scope and simply never threaded it through. **Session 71 found "persists its folder id" written against a field that did not exist; session 72 found this section's filename written against a field that did not exist. Both were prose describing a desired output that nobody checked had inputs. The rest of this document deserves the same suspicion.**

**And there was a SECOND gap, silent where the first was loud:** the only date on the record was `seenAt`, which is when the system saw the message, not when the agent received it. See 7.7 — 7.14 guarantees those diverge by up to seven days, and a filename built from the wrong one looks perfectly correct.

**RESOLUTION.** `sender`, `receivedAt` and `subject` are captured at seen-time (7.7). The stored sender is the raw `From` header, verbatim. **The filename-safe form is derived at NAMING time** by `parseRecipientList` from `src/recipientParsing.js` — that parser already handles exactly this shape, requires nothing, and has been solid since session 67, so no second parser was written. Display name preferred, address as fallback, `unknown sender` when the stored value is empty. `<date received>` is `receivedAt` formatted `YYYY-MM-DD`.

**SANITISE THE DERIVED FILENAME, NEVER THE STORED RECORD.** Path separators and control characters are stripped from the assembled name; the record keeps what was observed. That is this section's own label-versus-record distinction, the same one that made the folder name a label.

**A REJECTED ALTERNATIVE, recorded so it is not revisited:** fetching the sender live from Gmail at drain time. Rejected because the filename would then depend on a network read that can fail AFTER the bytes already succeeded, and could return different values on attempt 1 and attempt 5 — non-deterministic naming on a folder this section says is never renamed.

**`subject` IS CARRIED FOR THE DIGEST, not the filename.** 7.7 specifies an abandoned filing surfacing as "could not file this document" with a link to the email. The link comes from `messageId`; the only human-readable handle otherwise is `filename`, which this section already says is often useless. Subject is what lets an agent recognise WHICH email failed. It was free at seen-time and a migration later.

**THE SCHEMA WINDOW CLOSED WITH THIS COMMIT.** Session 66 recorded that the filing-record shape could change freely only while `$STORAGE_ROOT` held no `${agentId}.transactions/` directory. Verified still empty before `e1cea0a`; that commit creates the first persisted filing record. **Any further field added to `filings` from here is a retrofit onto a live compliance record**, which 7.7 says is worse than shipping fields unused.

**Per-agent parent folder.** Per 10.1, `drive.file` only sees folders the app itself created, so the app creates one app-owned parent folder per agent, persists its folder id, and nests transaction folders under it. It can never reference an agent's hand-made folder.

**AMENDED v16 (BUILT session 71, `f70e24a`). THE DATE IN THE NAME IS ALWAYS THE DEAL-OPEN DATE, and the confirmed-closing-date branch above is STRUCK.** The reasoning that removed it is the same reasoning this section already uses. TWO paths can create the folder — deal-open, and lazily on first filing if deal-open's Drive call failed — and a closing date confirmed between them would give ONE DEAL TWO NAMES, which a never-renamed folder cannot recover from. `createdAt` disambiguates the case this section actually cares about, the same property sold twice, and this section already says a folder name is a LABEL rather than a record. Deterministic beats semantically nicer here. Name is `<address> - <YYYY-MM-DD of createdAt>`, whitespace-collapsed for the folder name only; **the stored address is never modified**, per `6762e9c`'s verbatim rule.

**AND THE PREREQUISITE THIS SECTION ASSUMED WAS ALREADY THERE WAS NOT.** "Persists its folder id" was written in session 65 and nothing persisted one anywhere until session 71: no field on the agent config, none in `validateEnvelope`, none on the transaction envelope. `src/driveFolders.js` now holds `ensureAgentParentFolder` and `ensureTransactionFolder`, both idempotent. **It lives OUTSIDE `src/transactions/` deliberately**, because every module in there is synchronous and 7.14 depends on that staying true.

**`driveParentFolderId` IS CREATED LAZILY, NOT AT ONBOARDING.** Existing agents self-heal on first need, no backfill script exists or is needed, and the onboarding route — which now carries the CSRF nonce and token encryption — is not touched at all. `driveFolderId` on the transaction is absent-never-null and needs NO schema change, since `validateEnvelope` passes unknown fields through untouched.

**DEAL-OPEN CREATES THE TRANSACTION FIRST AND THE FOLDER SECOND**, because the reverse orphans a Drive folder with nothing pointing at it. **Drive failure is NON-FATAL**: the folder is created on first filing instead, and a deal never fails to open over a 500. `scripts/open-transaction.js` is now async and takes `--no-folder` so it stays runnable offline. **Folder assignment emits NO EVENT**, per 7.7: the event log records what happened to the DEAL, the record carries what the MACHINE is doing.

### 10.3 The Drive client (BUILT session 65, `a7813b9`)

`src/drive.js` exports `createFolder` and `uploadFile`, following `getMessage`'s auth-then-client-then-thunk shape at `gmail.js:328-339`.

**Auth comes from `gmail.getOAuthClient`, not a locally constructed OAuth2 client.** One token must have one cache: `handleAuthFailure` evicts from `oauthClientCache`, singular, and a second cache would silently survive that eviction. The service client is built fresh per call, matching every function in `gmail.js`, none of which caches one.

**THE UPLOAD BODY MUST BE A STREAM, and this was observed rather than reasoned.** `googleapis` calls `.pipe()` on a non-string `media.body` at `googleapis-common/build/src/apirequest.js:180`, so a raw `Buffer` throws `TypeError: part.body.pipe is not a function` BEFORE any HTTP request is made, carrying no status and no response and nothing a retry layer can act on. `Readable.from(buffer)` is the fix. **A prior recon read `apirequest.js:96` (`typeof media.body === 'string'`) and rated Buffer support MEDIUM confidence; that line only selects a default MIME type and is not the branch that handles the body.** A live probe settled it in one run. A test pins it by asserting the body is a `Readable` and is NOT a Buffer, because a test that merely checked `files.create` was called would pass with a raw Buffer.

**The stream is built INSIDE the retry thunk**, which is correct and non-obvious: a stream built outside would be consumed by the first attempt and a retry would silently upload zero bytes.

**`parents` is OMITTED from `requestBody` for a root-level folder**, not passed empty.

**No `DriveError` subclass.** Nothing branches on Drive failures yet and an error class with no consumer is speculative structure. Add one when the orchestrator needs to tell "the folder is gone" apart from "the upload failed".

### 10.4 Retry for Google calls (BUILT session 65, `eeeea50`)

**`googleapis-common` sets `options.retry = true` UNCONDITIONALLY at `apirequest.js:262`, and nothing in `src/` overrides it.** Every Google call in this codebase has been retrying through gaxios all along: three attempts, exponential backoff, no jitter. Nobody knew.

**But gaxios only retries idempotent verbs, and POST is absent from `httpMethodsToRetry` (`gaxios/build/src/retry.js:25-31`).** Drive folder creation and file upload are both `drive.files.create`, both POST, and therefore had no retry underneath them at all. `src/googleRetry.js` covers exactly that gap. **It MUST NOT be applied to GET calls, or attempts compound to nine.** A test pins POST's absence by reading the installed gaxios source, because a version bump adding it would make this module's reasoning wrong silently and a comment would not catch that.

Policy: three attempts, exponential backoff **with full jitter**, retrying only 429, 5xx and network-level errors, honouring `Retry-After` over the computed backoff, never retrying another 4xx because a 403 from a missing scope will still be a 403 in six seconds. **Jitter is load-bearing rather than decoration:** one intake cycle rate-limiting on three attachments would otherwise retry all three in the same instant and collide again.

**Error shapes, confirmed against installed gaxios 6.7.1:** both HTTP and network failures throw `GaxiosError`, so the branch point is the PRESENCE OR ABSENCE of `err.response`, not two classes. Status is `err.response.status`; headers are a plain lower-cased object, so `Retry-After` reads as `err.response.headers['retry-after']`.

**`isAuthFailure` and `handleAuthFailure` are EXPORTED FROM `gmail.js` AND REUSED, not reimplemented, and the argument is not code duplication.** `handleAuthFailure` is a STATE TRANSITION on the agent: it writes `isActive: false` to disk and evicts the OAuth cache. A state transition must have exactly one implementation, or two paths disagree about whether a paying agent is disabled. **The dependency direction is backwards and deliberately so.** The proper home is a shared token module that does not exist; building it means touching the file that runs every intake cycle, which is a separate decision.

### 10.5 Memory headroom (MEASURED session 65)

Railway reports an **8.00 GB limit against 142 MB at idle**. Gmail returns attachment bytes as base64 inside a single JSON response, so a 20MB PDF is roughly 27MB of string plus the decoded buffer plus whatever the HTTP layer holds, all resident at once and all per concurrent attachment. **Against 7.8 GB of headroom that is a SIZE CAP for hygiene, not a streaming redesign.** Gmail's own attachment ceiling is 25MB anyway.

**This number is not in the repo and never will be:** `railway.json`, `railway.toml` and a `Dockerfile` are all absent, `Procfile` is one line (`web: node src/server.js`), and `engines` says `>=18.0.0` and nothing else. It is a platform-console fact.

### 10.1 drive.file scope resolution (RECON ITEM 1 from v1, RESOLVED 2026-07-24)

A Drive folder is a file with the folder MIME type, and `drive.file` covers everything the app creates. Creating per-transaction folders, nesting them, and filing documents into them is permitted under the existing scope. **No new OAuth scope**, which matters given where the Google review sits.

The caveat that becomes a design constraint: `drive.file` only sees files the app created or the user explicitly opened via a Google file picker. **If the agent manually drags a PDF into the transaction folder, the app cannot see it.** Therefore the ingestion path is email (which the system owns) or, when the dashboard exists, an explicit upload/picker flow. Never "just drop it in the folder." Agents WILL try the folder; the product copy and the folder itself (a README the app writes into each folder is cheap) must redirect them to "email it to yourself and I'll file it."

## 11. Reminders and digest integration

"This deal is still waiting on X" is a Daily Digest section, not new infrastructure. See DAILY_DIGEST_SPEC.md.

Per open transaction: outstanding checklist items, days to each agent-confirmed date, attachments awaiting review, proposed deal-opens awaiting confirmation, proposed completions awaiting confirmation, chase drafts awaiting approval, recommended state transitions.

Copy discipline: the digest is a reminder, not a guarantee, and the wording must reflect Rule 3 without undercutting the pitch. "Still waiting on" is honest. "All clear" is not, and must never be rendered. Unconfirmed (PROPOSED) dates render with a distinct marker and never as countdown reminders.

Escalation to SMS on a near-deadline is tempting and remains **deferred**. The HOT SMS threshold exists because SMS interruptions must mean something. Adding a second SMS source before the false-positive rate on transaction reminders is known risks the channel that already works.

## 12. Pricing and packaging (LOCKED 2026-07-24)

**Flat $250 per month, unlimited transactions.** Separate priced add-on on top of the base subscription; Content Engine is the billing precedent.

Why flat beats per-file, superseding the earlier per-file recommendation:

1. Per-file pricing taxes exactly the deals agents already under-value (leases), which is the behaviour the wedge is trying to fix.
2. The assistant-replacement positioning (section 0.4) wants a salary-vs-subscription comparison, not a fee schedule. "$250 a month" sits next to "$4,000 a month" cleanly; "$199 a file" invites the agent to do per-deal math against a human TC, which is a worse fight than the one we can win.
3. Simplicity at three founding agents is worth more than revenue optimization at scale. Revisit if a team account ever pushes pathological volume.

Full stack: Starter $500 + Content Engine $300 + TC $250 = $1,050/month against $3,750 to $5,000/month for a full-time assistant. Founders get TC included free for its first N months (N decided at launch) in exchange for being the extraction-quality calibration cohort.

## 13. Where it runs

Operator CLI MVP, same posture as Lead Import section 7. No agent-facing dashboard exists yet; the deal-open confirmation surface at launch is the structured-email pattern (section 7.4).

**Reusable-function discipline is non-negotiable and identical to Lead Import 7.2.** The resolver, the matcher, the filer, the assembler, the extractor, the chase engine, and the state machine live in `src/transactions/`. Scripts are thin wrappers. When the agent dashboard arrives it becomes a second caller and nothing gets rewritten.

Suggested module layout:

- `src/transactions/resolver.js` -- pure, the core
- `src/transactions/rules/*.js` -- declarative item catalog per type, including chase cadence data
- `src/transactions/states.js` -- state machines, transition validation
- `src/transactions/match.js` -- multi-signal scoring
- `src/transactions/detect.js` -- deal-open and completion detection (NEW v2)
- `src/transactions/extract.js` -- instrument date/term extraction with evidence records (NEW v2)
- `src/transactions/assemble.js` -- proposal assembly: participants, dates, checklist preview (NEW v2)
- `src/transactions/chase.js` -- chase eligibility and drafting (NEW v2)
- `src/transactions/file.js` -- Drive writes, folder creation, naming, per-folder README
- `src/transactions/store.js` -- volume state, atomic tmp-then-rename (Content Engine `profile.js` precedent)

## 14. Suggested build order and HARD GATEs

**THE PARTICIPANT PATH, AMENDED v20 AND v22, FIFTEEN STEPS (v21 had fourteen, v19 twelve, v18 seven).** Session 75 recon found no pure builder in `addParticipant` or `confirmFiling`, so the single-save confirm needed two extractions first, and the vocabularies were closed before anything could write a participant. Session 76 shipped both extractions, found that nothing writes a set's terminal status, and split 4c in two: the composition and the verbs are separate commits, because a door should open onto a finished room.

1. **Voiding (6.5). DONE, `b2a96fd`.**
2. **Add-email (6.6). DONE, `39a2af2` and `923640c`.**
3. **3a, fixed role list (6.2). DONE, `bbd2d32`.**
4. **3b-1, `assertParticipantFields` exported (6.2). DONE, `865de2c`.**
5. **3c, fixed entity type list (6.2). DONE, `28b3f91`.**
6. **3b-2, the proposal store (6.7.1). DONE, `0fc32ec`.**
7. **4a, pure builder out of `addParticipant`. DONE, `f56b806`.** No behaviour change, existing suite unedited.
8. **4b, pure builders out of `confirmFiling` and `rejectFiling`. DONE, `5cdd34d`.** Same rule.
9. **The set status writers (6.7.4). DONE, `2fd14ab`.** Found missing during 4c's design pass: `confirmed` and `discarded` were unreachable states.
10. **4c-1, the confirm and wrong-deal compositions (6.7.2). DONE v21:** 4c-1a `e9d29e8`, 4c-1b `a49b45f` (`confirmProposalSet`), 4c-1c `399eaea` (`markWrongDeal`, new in v21: WRONGDEAL had no composition and two writes would reopen the crash window). **The first real participant can exist once 4c-2 calls these.**
11. **4c-2, the subject verbs (6.7.5). DONE v22, `73269bd`, with `5815950` and `9645d33` ahead of it. Live-verified.** The first real participants exist.
12. **Oldest-first processing on `assistant@` (PROJECT_STATE 7.57.1). NEW v22. DONE v23, `6c13343`, live-verified 2026-09-25.** Must land before 14, which puts REJECT and CONFIRM links side by side in front of an agent.
13. **Signal E extraction proposing deal parties (7.11, 6.7.3). GATED on person matching (PROJECT_STATE 7.53.2).**
14. **The digest section for pending proposals.** **v23: this is also Phase A tier-3 item 8, and it is the next TC work** (see the v23 honest read below).
15. **4.5, the listing-to-offer transfer.**

**As locked in v18, superseded above:** THE PARTICIPANT PATH, LOCKED v18, SEVEN COMMITS IN THIS ORDER. Sequencing principle: ship inert modules early, ship the thing that changes live behaviour last, and **never let an irreversible write land before the surface that corrects it exists.** That last rule is specific to this work, because the first confirmed participant is permanent.

1. **Voiding (6.5). DONE, `b2a96fd`.** The correction path for every mistake the rest of this makes.
2. **Add-email (6.6). DONE, `923640c`**, with the normalization leaf shipped first as `39a2af2` for one-concern-per-commit.
3. **The proposal store (6.7).** New file, own lifecycle, disposable records, no consumers yet. Carry the personal-versus-organizational flag now even though the matcher ignores it.
4. **The confirm and reject verbs (6.7).** `assistant@` subject verbs on existing CALLED machinery. **This is the commit where the first real participant can exist**, which is why 1 comes first.
5. **Signal E extraction proposing deal parties (7.11, 6.7).** Largest and least certain: the vision path, not a text parse.
6. **The digest section surfacing pending proposals.** Last, because until 5 exists nothing produces proposals in volume, and this is the only part a real agent sees unprompted.
7. **4.5, the listing-to-offer transfer.** Moved from first to seventh: it was never unblocked and it sits behind participant creation. See 4.5.

**OPEN, to be tested rather than assumed:** whether 4.5 is coupled to participants tightly enough that its items are unsatisfiable without them, which recon says yes; and whether items 1 and 2 above should have been one commit, since add-email refusing a voided participant is a rule that spans both. They shipped separately and the refusal is tested.

Phased so that every phase ships something an agent can use, and the liability-bearing pieces land behind gates. Detailed step decomposition happens at implementation time, session by session, per house convention.

**Phase A (the v1 spec, manual-entry TC):** store, states, resolver, rules catalog, manual deal-open via CLI, digest section, Drive filing pipeline (7.1 to 7.3). Usable product on its own: the checklist that never forgets, with self-filing documents.

**Phase B (assembly):** deal-open detection, participant auto-discovery, extraction with evidence, the confirmation surface. HARD GATE B: extraction calibration against a redacted Ontario instrument fixture set; the metric is excerpt-anchored accuracy; agent-facing use gated on passing.

**Phase C (the assistant):** completion detection, chase drafting. HARD GATE C: chase draft quality review across real deal fixtures before any chase reaches a third party, agent-approval-only at launch regardless.

**Phase D (deferred):** client milestone emails (9.2), SMS escalation (11), commission tracking, live-send chaseMode.

**Phase A progress (session 71). `src/transactions/` HAS A CALLER, AND THE PREREQUISITE UNDER IT WAS MISSING.** Four commits, all pushed to `main`: `f26c8e7` the orchestrator arrival pass (7.14), `4960fb4` an atomic agent-config writer, `c90dde8` the digest agent-discovery filter, `f70e24a` the Drive folder ids (10.2). Tests 2409 to 2445 across 116 to 122 suites, full `npx jest` green at every commit.

**TWO OF THE FOUR COMMITS HAVE NOTHING TO DO WITH THE TC, and they came out of one recon line.** Asked where a `driveParentFolderId` could be persisted, recon reported that `handleAuthFailure` writes `agents/<id>.json` with a bare `writeFileSync` — no temp file, no rename — and is the ONLY writer to that file that runs unattended, firing from the five-minute cycle on `invalid_grant`. **Since `f92a834` that file holds the AES-256-GCM ciphertext of `googleRefreshToken` and is the only place it exists, so a crash mid-write loses the token outright. `TOKEN_ENCRYPTION_KEY` cannot recover it: the key decrypts ciphertext, and the ciphertext is what got truncated.** `4960fb4` adds `patchAgent` to `agentConfig.js` — which had a read API and no write API at all, despite four duplicated inline writers elsewhere — and points `handleAuthFailure` at it.

**`c90dde8` IS THE ONE WORTH REMEMBERING, because the bug was already firing.** `digest.js` carries a third copy of agent discovery filtering on an unanchored `endsWith('.json')`, where `index.js` and `routes/dashboard.js` both use the anchored `AGENT_ID_REGEX`. That copy accepts `mo-test.contentProfile.json`, `mo-test.contentState.json` and `mo-test.state.json`, **so every digest run has been attempting to load three companion files as agents** and relying on a downstream `isActive` check to drop them. The same looseness would adopt a crash-orphaned `<agentId>.tmp.json` as a phantom agent carrying a full copy of the credential — the session-39 phantom-agent class, by a new route. **Tightening the filter is the primary fix and handles orphans of any shape, including ones already on disk; renaming the writers' temp files to `<agentId>.json.tmp` is defence in depth.** Three duplicated copies of that filter now exist and the right fix is a shared leaf module; `digest.js` cannot simply import, because `index.js` already requires `./digest`.

**A TEST-SHAPE LESSON FROM `f70e24a`, and it is the general form of a trap.** Removing the deal-open try/catch turned FIFTEEN tests red, and the first reading was that this proved the try/catch was load-bearing. It proved the opposite: twenty unrelated CLI tests were passing only because an error they never meant to trigger was being swallowed, which also meant the deal-open SUCCESS path had no coverage at all. After passing `--no-folder` in every invocation not testing folder behaviour, the same mutation turned ONE test red. **A mutation that reddens many tests is not a strong signal; it is usually a sign the tests are coupled to something they are not about.**

**Phase A progress (session 69). THE DOUBLE-END IS RESOLVED AND BUILT, AND THE ACCUMULATOR IS WIRED.** Eight commits: `dd5fd3e` `data_form` (closes 7.46.1 and tier-3 item 9), `1270dfa` the accumulator (tier-2 item 7, ahead of the orchestrator because it was reachable under the freeze), `ffe281f` a null guard in `findListingCandidates` (7.51.3), `e5958f7` the read path, which recon found had never actually been committed, `9b7dfcc` the arrangement fact and catalog union, `3843eb1` the wholesale-row invariant, `d65f730` the cause-agnostic reason string (closes 7.41.5), `8e8eb51` the multiple representation agreement (closes the catalog half of 7.43.1). Tests 2346 to 2409 across 115 to 116 suites. **All eight are on the `session-69` branch and NOT on `main`, under the freeze.**

**PHASE A REMAINING WORK, IN ORDER (AMENDED v14).**

**Tier 1, before the orchestrator. CLOSED as of session 71.** (1) The section 3 double-end question: **DONE session 69**, see 7.1.2b. (2) The candidate loader: **DONE session 68.** (3) **The `size` probe: DONE session 71, and the answer is the easy one.** Gmail's reported `size` is the DECODED byte length, not the base64 length — probed live at 37399 reported, 37399 decoded, 49868 base64, ratio 1.3334. **The byte cap compares directly against `size` with no division.** (4) The filing review verb: **DONE session 68.**

**Tier 2, the pipeline runs end to end. AMENDED v16: item 5 was ONE commit on paper and is THREE in fact, because of the A5 finding in 10.2.** (5a) **The orchestrator ARRIVAL PASS: DONE session 71**, `f26c8e7`, see 7.14 — `src/transactions/` has a live caller for the first time since session 55. (5b) **The Drive folder ids: DONE session 71**, `f70e24a`, see 10.2. (5c) **The DRAIN PASS: NOT BUILT, and it is now the smallest of the three** — `fetchAttachmentBytes` is already built and tested (see the correction in the v16 status block), the folder is resolvable, and the byte cap needs no conversion. (6) **`attempts` has no incrementer (7.49.1)**: it is set to `0` at construction, never written, and `abandonDocumentFiling` puts it in the event payload, so every abandoned filing logs `attempts: 0` forever, which is a compliance log asserting a specific false number. **Must ship WITH the DRAIN pass (5c), which is where an attempt is a meaningful unit.** (7) The accumulator wiring: module **DONE session 69** but **NOT CALLED, and now blocked behind tier-3 item 12a rather than behind the orchestrator** — see 7.14. Wiring it before 12a is fixed means writing an empty `addresses_observed` event and churning `updatedAt` on a compliance record every cycle.

**Tier 3, Phase A's remaining debt.** (8) The digest section, including the failed-filing row and 7.48.2's dead `reliability` branch. (9) The `data_form` catalog commit: **DONE session 69.** (10) Listing-to-offer client item transfer (4.5), designed session 63, unblocked since 64. (11) The unaccepted-offers item (7.47.2), specced against O. Reg. 579/05 s. 20. (12) The `opened_in_error` exit state (7.47.1), agreed in chat and never built. (12a) **The `recordObservedAddresses` zero-net-change write (NEW v14, see 7.13). PROMOTED v16: this is no longer cleanup, it is a blocker** — it gates the accumulator wiring (tier 2 item 7), and it must land before anything calls `accumulateObservedAddresses` on live messages.

**Tier 4, after Phase A ships.** (13) Page-split delivery. (14) Signal E (7.11), and note that the dependency is OPEN, not settled: `pdftotext` is not installed on the build machine, the only working spike used `pdf-parse`, and neither has been chosen or weighed against Railway. (15) The participant email promotion verb (6.1, 7.51.8). (16) `clientScope: 'dated'` (7.43.6), the two-agent designated case (7.43.1), `assistant@` TC verbs. (17) **PER-CLIENT FACTS (NEW v14)**, which needs Mo's field answer first; see section 16.

**THE HONEST READ, v23 (session 80).** Tiers 1 and 2 are done: 5c and 6 shipped session 72 (`e1cea0a`), and 12a with the accumulator wiring (`38f2cdb`). **Phase A owes four tier-3 items:** (8) the digest section, the largest at roughly two sessions; (10) 4.5, roughly one; (11) the unaccepted-offers item and (12) `opened_in_error`, a commit each. **Roughly three to five sessions to a Phase A product a founding agent can use, with Mo opening deals by CLI.** Until (8) exists, everything built is invisible to an agent: no surface shows their deals, outstanding items, filings or pending proposals. Phase B (deal-open detection, Signal E with vision for scanned documents, person matching, HARD GATE B) is six to ten or more sessions and partly impossible without real documents, and nothing in production creates a proposal set until Signal E exists (PROJECT_STATE 7.57.9). **Direction agreed at session 80 close:** finish Phase A's visible surface, put it in front of a founding agent, and let real deals turn Phase B's guesses into measurements before Signal E is built, because Mo cannot dogfood (7.50.6).

**THE HONEST READ, AMENDED v16: the remaining spine is items 5c and 6 — the drain pass and the `attempts` incrementer, which ship together — and neither is blocked by anything.** Item 3 is answered, 5a and 5b are built and pushed, and the freeze is over. **THE HONEST READ, historical v14: the remaining spine is items 3, 5 and 6, and all three are behind the freeze.** Everything else in tiers 1 and 2 is done. After the orchestrator runs, an agent's documents file themselves, which is the demo moment in section 0.3. Items 8 through 12a are what makes it a product someone pays for rather than a demo. And 7.50.6 still holds over all of it: Mo cannot dogfood this, so unit tests are the only instrument until a practising agent runs it, which means the orchestrator landing green does not mean the orchestrator works.

**Phase A progress (session 65).** Three commits took the Drive filing pipeline from a plan to three working modules: `1d071a0` the filing record with three document event kinds, `eeeea50` `src/googleRetry.js`, `a7813b9` `src/drive.js`. Tests 2010 to 2063 across 103 suites. **None of them has a caller yet, deliberately.** Remaining on the filing run, in order: **(1) attachment bytes** [CORRECTED v16: already built as `src/gmailAttachments.js`, uncalled — see the correction above] (`users.messages.attachments.get`, base64url decode, content hash, carrying the hash-before-the-write-cycle constraint from 7.7); **(2) matching** (section 7.1, the most design-dense piece left, may split in two); **(3) the orchestrator plus folder-creation-at-deal-open**. The digest row for failed filings belongs with digest work. Phase A also still owes the digest section, which now has its `indeterminate` intake decision (section 4.6).

**Phase A progress (session 64).** Ten commits took the TC from "nothing writes facts" to a working chain: `852fcd6` state validation, `6762e9c` address on the envelope with optional `unit`, `ac31973` the fact writer, `5c26081` the item writer, `1c27795` the read path, `b73c7e8` the pure/disk split, `7ff50da` the close path resolving its own checklist with two counts, `75056de` per-person satisfaction as the completion signal at close, `3a073dc` the satisfaction writer, `b4838e0` three CLI verbs. Tests 1880 to 2010 across 99 suites. **Phase A is NOT complete.** Still owed: the Drive filing pipeline (7.1 to 7.3), which is the larger half and the "self-filing documents" promise, and the digest section. **A PREREQUISITE NOBODY HAS SIZED: nothing in `src/` fetches Gmail attachment BYTES today, only `attachmentId` metadata.** [CORRECTED v16, session 71: this stopped being true at some point after it was written. `src/gmailAttachments.js` holds `fetchAttachmentBytes(agentConfig, messageId, attachmentId)` returning `{ buffer, contentHash }`, with eight tests including a `Buffer.from` spy pinning `base64url` over `base64` — necessary because Node's lenient `base64` decoder makes byte-equality alone unable to catch that regression. It has zero callers. **This is the session-69 `e5958f7` failure inverted: that time the spec claimed something was committed and it was not; this time it claimed something was absent and it was there.** Both were found by recon, and neither by memory.] That gap is recorded under Phase B below because it was found while thinking about extraction, but the Phase A filing pipeline needs the same plumbing. **Recon before planning**, or it repeats the fact-storage surprise: a blocker discovered mid-build rather than at the top of the board.

**Phase A progress (sessions 55 to 60).** Eighteen commits, all inert, no callers anywhere. The store, the state machines, the resolver, and **the entire item catalog** are done. Session 60 shipped `a57ec8d` (the eight condition items and the `hasCondition` loud-failure helper), `dce1533` (the `deal_sheet` universal item, and 5.6 closed empty), and `f8d8e29` (state as a resolver argument, `terminalOnly` filtering, and the mutual release). Tests 1746 to 1770 across 90 suites.

**TWO GIT TRAPS COST REAL TIME IN SESSION 60 and both have the same root cause.** `git add -N` stages an EMPTY blob for an untracked file, so a later `git checkout --` on that file wipes it to nothing rather than reverting. And `git checkout --` is not an undo for break-the-fix on uncommitted work at all: it restores from the index, so it destroys the change under test along with the destructive edit. Both hit the same session. **Use `git stash` before the destructive edit and `git stash pop` after, or hand-revert the specific line.** This sits next to the existing note that `git stash && npx jest` cannot see untracked files without `-u`.

**Sessions 57 to 59 in order.** `f37ecb6` shipped the resolver with a five-item proof catalog; `e2a6d38` shipped `reResolve`'s completion-preserving contract. `345ca34` made `landlord_lease` resolvable (recon found it and `seller_sale` were valid types in `states.js` with NO entry in `CATALOG`, so half the declared surface threw unknown-type); `114c5cf` shipped the lease catalog; `a9fd906` moved the representation agreement out of the universal spine; `45ecf61` made `seller_sale` resolvable, at which point ALL FOUR TYPES RESOLVED for the first time. Session 59 then closed the per-person gate and three catalog sections: `cc0a272` added `note` as a fourth `STATE_FIELDS` entry, `ed427d2` shipped per-person satisfaction, `448a251` fixed the remuneration gap in the representation labels, and `1ad09c8` plus `ea26dc2` shipped the FINTRAC set for both purchase-and-sale types.

**THE BREAK-THE-FIX LESSON, sighted three times across these sessions and now a standing rule.** A destructive edit that causes a CRASH proves only that the function can crash. Session 57 removed an import and got six red tests on a `ReferenceError`. Session 59 removed a guard and got a red test on a `TypeError` from calling `.forEach` on `undefined`. Both were re-run against the specific behaviour instead, and both produced FEWER red tests, every one of them proving something. **The destructive edit must attack the distinction under test.** The strongest example in the build so far is flipping `&&` to `||` on the two-fact Receipt of Funds predicate: exactly the two mixed input cases go red on their assertions, while indeterminate and both-true stay green correctly, because those two are decided before the predicate runs or answer the same under either operator. That is a truth table being covered rather than a happy path.



`16fbf87` (session 56) shipped `src/transactions/states.js`: the four transition tables as a
deep-frozen data structure plus `TRANSACTION_TYPES`, `getStates`, `getInitialStates`,
`isValidInitialState`, `isTerminal`, `canTransition`, and `listTransitions`. Pure: no requires
at all, no I/O, no clock. **Two kinds of failure, deliberately not blurred.** Invalid input
THROWS with the `functionName: message` prefix the store already uses (unknown type, non-string
state, missing argument). A refused transition RETURNS `{ valid: false, reason }`, matching the
`{ valid }` idiom in `content/angles.js` and `content/cache.js`, because a refusal is a normal
answer rather than an exception and the `reason` becomes agent-facing copy in the confirm
surface. Turning a thrown Error back into UI text is worse than reading a field, and silent
refusal is the same failure class section 4 already rules out for hidden checklist items.
Four distinct refusal reasons: fromState not a state of this type, toState not a state of this
type, fromState terminal, edge absent.

**The store still does NOT enum-validate `state`, and that stays true.** `states.js` exports
the vocabulary; a later transition service validates at the write path. The store owns bytes,
the resolver owns meaning, and keeping that separation is what let the store ship before this
spec locked.

**Six structural tests iterate the table rather than hardcoding expectations** (terminal states
have no outgoing edges; every state named in an edge is declared; every initial state is
declared; no initial state is terminal; every non-terminal state has an outgoing edge; the
table is frozen). Break-the-fix confirmed RED on the first of those via a `closed -> collapsed`
edge added to `tenant_lease`, then restored. **The structural tests check the table against
ITSELF, so two content tests were added on review:** deleting `signed -> live` from
`landlord_lease` would have left every structural test green, since `signed` still reaches
`possession`. The content tests pin the edges earlier reviews missed (`conditional -> live`,
`signed -> live`, `tenant_selected -> live`, `possession -> collapsed`, both suspension edges,
both `live` initial states) and pin the buy-side absence of `terminated` so a future reviewer
does not add it back as a "fix". Without them the enumeration was documentation, not something
enforced.

`980b74d` (session 56) moved the store from `src/transactionStore.js` to
`src/transactions/store.js`. Pure rename, 99% similarity, the only content change being
`./storagePaths` to `../storagePaths`. Done at zero callers because that is the cheapest this
move would ever be.

`4554b72` (session 55) shipped the store. The store validates an ENVELOPE ONLY (`schemaVersion`, `transactionId`, `agentId`, `type`, `state`, `createdAt`, `updatedAt`) and treats the deal body as opaque: the store owns bytes, the resolver owns meaning. That is what let it ship before this catalog locked. It lives at `${agentId}.transactions/` under STORAGE_ROOT, a name chosen by recon rather than preference: any directory is invisible to both `discoverAgentIds` filters (which demand a `.json` suffix), while the `${agentId}.` prefix is what makes `moveAgentFilesToDeleted` sweep the whole tree on soft-delete. A bare `_transactions/` would have been silently orphaned. There is no delete function.

**Phase B is reshaped by the session-55 recon and needs two plumbing pieces first.** Nothing in `src/` fetches Gmail attachment BYTES today (only `attachmentId` metadata via `parseGmailMessage`), and `claude.js` builds `messages: [{ role: 'user', content: user }]` in exactly one place with `user` always a plain string, so no call site can pass an image or document block. Both are small additive changes and neither is blocked, but the Haiku-versus-Sonnet question is meaningless until they land.

**Deal-open detection has a one-shot constraint (section 7.4).** An executed APS from a lawyer already classifies as `business_correspondence` and ends its cycle carrying `agent-ai/business`, which is exactly the label Rule 4 uses to block re-entry. A detector placed downstream of that branch therefore gets ONE attempt per message, in that same cycle, or the deal is invisible forever. The correct insertion is inside `applyPreFilter`, pre-classifier, where `attachmentInfo` (filename, mimeType) is already in scope, so the detector keys on attachment name plus subject and needs none of the plumbing above.

Standing gates from section 1: ~~Stripe before implementation~~ REMOVED session 55, Stripe now follows TC and the dashboard; incorporation and E&O before the feature is SOLD, which was always the gate and blocks nothing about building it; break-the-fix mandatory on the section 4.1 re-resolution contract and the section 5.5 illegal-deposit negative assertion.

### 14.1 Form handling: store and pre-fill, never generate (LOCKED session 55)

**Storage and retrieval: yes.** An agent asking for a copy of the buyer representation agreement on a given deal is retrieving a document they already own from their own Drive. That is the Phase A filing pipeline and it is one of the strongest everyday-value features in the product.

**Pre-fill: yes, as a client data card.** The structured facts already extracted (legal names spelled as they appear on the last executed instrument, addresses, entity details, contact info) presented as a block the agent copies into whatever form tool they already use. That removes most of the re-typing and carries none of the risk below.

**Generating filled OREA forms: NO, and the reason is licensing, not engineering.** OREA forms carry an explicit notice that they are developed for the use and reproduction of OREA members and licensees only, that other reproduction is prohibited without prior written consent, and that the pre-set portion must not be altered when reproducing. GetKlosed is not a member or licensee. Commercially it is also a bad fight: WEBForms is OREA's own product, free with membership, already does pre-fill, and is where agents get current versions. Since using outdated form versions can violate TRESA, anyone generating forms owns a version-currency obligation permanently. That is a standing liability with no moat.

**The carve-out worth taking: brokerage-specific templates are not OREA copyright.** Trade record sheets, commission forms, submission cover sheets. Those can be filled outright and are exactly the paperwork no competitor will ever build.

**Standing IP line: we store completed instruments the agent already possesses, and we never reproduce, generate, or fill an OREA form.**

### 7.49 Parked items from session 72

**7.49.1 `ensureTransactionFolder` TAKES THE TRANSACTION OBJECT WHERE EVERY `filings.js` WRITER TAKES IDS.** That asymmetry is the root cause of the lost-write in 7.14, and the point fix (re-read immediately before the call) closes the instance, not the trap. The next object-taking call added to `drain.js` hits it again. Give it an id-taking signature and let it re-read internally, like its neighbours. Not done in session 72 because it would touch session 71's freshly shipped code mid-CASA-revalidation.

**7.49.2 THE SEQUENTIAL-LOOP TEST PINS THE CURRENT INSTANCE, NOT THE RULE.** `drain.js`'s only lost-write site today is `ensureTransactionFolder`, so the test exercises that. Add another object-taking call later and the test stays green while a fresh lost-write appears. The instrument does not save us from 7.49.1; only fixing 7.49.1 does.

**7.49.3 THE FAILURE-PATH AUDIT LINES ARE UNTESTED.** `[auth] login failure | reason=bad_password` and `reason=bad_mfa_code` have no test, so a typo in a reason code would not be caught. The success path is tested including the no-credential-material assertion. Small, and it was left because Oct 5 outranked it.

**7.49.4 THE DIGEST ROW FOR AN ABANDONED FILING DOES NOT EXIST.** 7.7 specifies "could not file this document" with a link to the email. `abandonDocumentFiling` writes the record and the event; nothing renders it. Until that ships, **an abandoned filing is invisible to the agent**, which is precisely the lying-by-omission 7.7 names. `subject` is now on the record specifically so this row can be written.

**7.49.5 `WEBHOOK_SKIP_SIGNATURE_CHECK` IS STILL IN THE PRODUCTION ENVIRONMENT.** Value confirmed `FALSE` and the code checks `=== 'true'`, so it is inert, and the s9 design additionally host-gates the bypass to localhost/ngrok. Carried since session 70. The board item is removing the flag from the CODE, which orphans the variable.

### 7.48 Parked items from session 65

**7.48.1 `src/google.js` is four lines of comments and no code.** The comment describes a service-account model that does not match how auth actually works (per-agent OAuth2 with refresh tokens) and does not mention Drive at all. Delete it or fill it. Nobody has checked whether anything requires it.

**7.48.2 `digest.js`'s `reliability` object is hardcoded to zeros at line 824**, so the render block gated on it at line 1163 can never fire. A dead branch in a shipped surface, found while reconning where a filing-failure digest row would plug in.

**7.48.3 `withRetry` costs about 18 seconds of real wall clock** in `tests/gmail.sheetAccessError.test.js`, which lets the real 3000ms sleep run across six tests behind a 15000ms timeout. `googleRetry`'s tests use fake timers and pay nothing.

**7.48.4 There are now SIX hand-rolled retry implementations in `src/`:** `withRetry`, three separate `_sendWithRetry` copies (`digest.js`, `content/actionHandler.js`, `content/engine.js`), `claude.js`'s, `twilio.js`'s, and `googleRetry.js`. A new one was consistent with practice, which is a polite way of saying this codebase has a retry problem.

**7.48.5 `googleRetry` logs NOTHING on retry.** `drive.js` logs once on final failure because `withGoogleRetry` exposes no per-attempt hook, so a call that retried twice and then succeeded is invisible. Remember this when a rate limit appears in production and the logs are silent.

**7.48.6 The `createFolder` retry test asserts `parents: undefined` via `toEqual`**, which ignores undefined properties and therefore asserts nothing about `parents`. Harmless (the shape test above it covers the real case) but the line reads like it checks something it does not.

**7.48.7 The proper home for `isAuthFailure` and `handleAuthFailure` is a shared token module that does not exist.** `googleRetry.js` requires `gmail.js` for them, which is backwards. Deliberate deferral, recorded so a future session finds a decision rather than an accident.

**7.48.8 The `document_filing_abandoned` event payload will report `attempts: 0` until the bytes commit** populates the counter, and a test currently pins that zero. Expected, not a defect; the test needs updating when attempts become real.

### 7.47 Parked items from session 64

**7.47.1 The EXIT STATE for a wrongly opened file.** A transaction opened in error has no honest terminal state today: `collapsed` asserts a deal died and `terminated` asserts an engagement ended, and neither is true of a file that should never have existed. Design agreed in chat and not built: a new terminal state, agent-initiated only, never system, reachable from every NON-terminal state (the realistic case is a duplicate discovered in week three, not a fat finger caught in the first minute), landing in all three tables. **No outgoing edges from existing terminal states**; a closed file later found to be a duplicate is a bigger conversation. Naming matters because the string is agent-facing: `opened_in_error` says it plainly, `voided` reads more like a document status. `mutual_release` stays absent by luck rather than design, since `terminalOnly` is pinned to `collapsed` specifically, so that should get a test saying so on purpose. Never a hard delete: a corrected mistake is history the same way an uncompleted item is.

**7.47.2 The `seller_sale` unaccepted-offers item.** Mo's brokerage requires the offer paperwork for unaccepted offers, submitted at deal time. RECO's registrar confirms the underlying duty is statutory: O. Reg. 579/05 s. 20 requires a brokerage to retain unaccepted written offers for at least a year after receipt, separate from s. 19's six-year retention for documents relating to a completed trade. **Shape, fully specced and not built:** the item lands on `seller_sale` ONLY (not leases, not buy side, both on Mo's answer), `evidence: document`, `source: brokerage` rather than TRESA because s. 20 puts the duty on the brokerage and the agent's submission is how Signature discharges it. Applicability reads a competing-offers COUNT, which maps onto the three existing values without new mechanism: absent is `indeterminate`, zero is `not_applicable` with a reason, one-plus is `required`. A count rather than a boolean so the row can say how many are outstanding; zero must be a real stored answer distinct from absent. It goes on the DEAL rather than the listing because that is where it fires and because no reverse index from listing to offers exists. **The offer transparency record was considered and DROPPED** for lack of field evidence: it came from a realtor blog rather than the regulation, and Mo has never encountered it.

**7.47.3 BrokerBay is not in this spec and it owns half the agent's pre-deal life.** Offers are registered there through the front desk; the deals department never sees an unaccepted offer, which is what bounded 7.47.2. It also drives showings and the notification volume Mo wants relief from. **The reframe that makes it cheap: this is EMAIL PARSING, not an integration**, the same pattern as the Realtor.ca lead formats, on an inbox the product already reads. Two payoffs and the second is better: suppressing showing notifications in the digest is real relief, but an offer-registration email says an offer EXISTS and has not been accepted, which makes 7.4's detector SAFER rather than noisier and is a candidate pre-fill for 7.47.2's count, proposed and never asserted. Showing reminders are Mo's idea and worth having: **check BrokerBay's own calendar sync first**, since rebuilding a feature he already owns adds a second notification stream rather than removing one. If absent, the cheap version is a digest section plus a Twilio reminder; the expensive version writes to the agent's calendar and would reverse decision 16's no-new-OAuth-scope lock, which should be a decision rather than a side effect. First step is free: forward a handful of BrokerBay emails of each kind (request, confirmation, cancellation, reschedule, offer registration) and see whether the format is parseable.

**7.47.4 The rename-orphan.** Correcting a name via `correctFact` on `representedPersons` orphans any satisfaction stored under the old spelling. The record is not lost, but that person reads as outstanding again, and the resolver ignores orphan keys silently. Fixing it properly means a rename path that rewrites satisfaction keys, which is its own commit.

**7.47.5 Deal-open intake, and the number that should drive it.** Three facts collapse twelve `indeterminate` rows to zero on a `buyer_purchase`. The resolver already attaches `pendingFacts` naming exactly what each row waits on, so a surface can invert the checklist: show three questions with what each unlocks, rather than eleven rows saying "unknown." **The trap that must survive whatever gets built: skipping a question and answering "none" are DIFFERENT and must stay distinguishable.** `conditions: []` means the agreement contained none; absent means nobody has said. Same for `representedPersons`, where the spec already treats empty as a real answer.

**7.47.6 The `indeterminate` interaction with client scope.** On a corporate buyer, `fintrac_corporation_identification_record` and `fintrac_articles_of_incorporation` are both `client/event` AND conditional on `entityType`, so they emit neither `satisfiedPersons` nor `outstandingPersons` until the fact is set. Correct, tested, and worth remembering when a surface renders per-person state: an indeterminate client-scoped item shows no people at all, which is not the same as showing nobody outstanding.

## 15. Recon items to confirm before locking implementation

1. ~~drive.file folder creation~~ RESOLVED, see section 10.1. Remaining sub-item: verify programmatic folder creation and nested filing against a real agent token in a throwaway script before Phase A locks, since the resolution above is documented behaviour, not yet observed behaviour in this codebase.
2. ~~`src/storagePaths.js` transactions subtree~~ CLOSED session 55, by finding there is nothing to extend. The file is eight lines exporting one function, `getStorageRoot()`, and builds no directory shape at all; every path is assembled at its call site. Directory creation is not special-cased either: all ten `mkdirSync` sites in `src/` are lazy at first write inside their own write helper, so the store got it for free by following the pattern.
3. ~~Lead Intake insertion point~~ CLOSED session 55, with a trap found. Behaviour confirmed as expected (classifies `business_correspondence`, stays unread, ends the cycle carrying `agent-ai/business`), but that label is what Rule 4 uses to block re-entry, so a detector downstream of it gets ONE shot per message. Insertion point is `applyPreFilter`, pre-classifier. See section 14.
4. ~~Haiku vs Sonnet per instrument~~ CLOSED session 55 as the WRONG QUESTION. `claude.js` cannot pass a non-text content block from any call site, and nothing in `src/` calls Gmail's `users.messages.attachments.get`, so attachment bytes are never fetched. Model tier is downstream of both plumbing pieces. Do not cost it until they land.
5. ~~PDF handling~~ CLOSED session 54, spec-shaping: DocuSign-flattened OREA forms defeat linear text extraction, which points Phase B at vision or coordinate-aware extraction rather than a text parse. Open sub-item: probe a SCANNED PRINTED APS to confirm one approach covers both document shapes. Mo must source a sample.
6. Thread-scan mechanics for participant auto-discovery: confirm `getThreadHistory` surfaces cc addresses and signature blocks adequately, or whether a raw-header fetch is needed. STILL OPEN, lower risk, Phase B.

7. **Attachment BYTES and the Drive write path. CLOSED session 65**, by a full recon plus four live probe runs against a real mo-test token. Everything below is observed, not documented.
   - **Nothing in the repo calls `users.messages.attachments.get`.** Confirmed absent. `parseGmailMessage` (`gmail.js:264-296`) captures `{filename, mimeType, size, attachmentId}` and that metadata is NEVER PERSISTED anywhere: not in `COLUMN_MAP`, not in the transaction store, not on disk. It lives in memory for one processing cycle.
   - **`applyPreFilter` already HOLDS the attachment metadata with no second Gmail fetch.** `fetchUnreadInboxEmails` does one `format: 'full'` get, `parseGmailMessage` populates `attachmentInfo`, and that object reaches `applyPreFilter(msg, labelMap, ctx)` untouched. The function never reads it today. **Detection is therefore free; only the bytes cost a call.**
   - **A Buffer does NOT upload; a stream does.** See 10.3. This is the finding that would have cost a build session.
   - **Byte-level round trip works under `drive.file`.** A 5,242,880-byte payload of `0xAB` (deliberately not valid standalone UTF-8, so a silent string coercion would return mangled bytes) uploaded, reported `size: 5242880` from Drive's own metadata, downloaded via `alt: 'media'` with `responseType: 'arraybuffer'`, and compared byte-identical.
   - **Nested folder creation confirmed a second time**, against a live token.
   - **Memory is a non-issue.** See 10.5.
   - **No base64url decode helper exists** for the decode direction (`extractTextBody` uses plain `'base64'`, which Node tolerates for the URL-safe alphabet); the encode-side helper in `gmail.js:248-252` is not reusable.
   - **Every `fs.writeFileSync` in `src/` writes JSON**, via a consistent atomic tmp-then-rename. No non-JSON write into `STORAGE_ROOT` exists. A scratch-file convention (`os.tmpdir()`) exists only in `scripts/`.
   - **No dependency-injection seam for a service client exists anywhere in `src/`.** Testability comes from `jest.mock('googleapis')`, which five test files already do. A new module with a novel injection seam would be worse than one consistent module.
   - **The Drive probe DID run** (session 54, by eye in mo-test's Drive). The repo carries no artifact proving it, which is a good example of the repo not being the whole record. What it did NOT prove is what mattered: its body was a 47-byte string literal and its read-back requested metadata fields with no `alt: 'media'`.

**Recon status: items 1 through 5 and 7 are CLOSED (1 and 5 in session 54, 2 through 4 in session 55, 7 in session 65). Only item 6 and the scanned-APS sub-item remain, both Phase B.**

### 15.0 PARTIALLY SATISFIED, session 67: the first real corpus

Four real received attachments were read this session, which is the first time this project has looked at production artifacts rather than reasoning about them. **They corrected four things this spec asserted** (see the v12 status paragraph). The set is NOT sufficient for HARD GATE B extraction calibration, which still wants what 15.1 asks for, but it closed the filename question and the text-layer question outright.

**The filenames, which are the finding.** `14_Bonacres_-_Agreement_of_Purchase_and_Sale_-_Residential__16__copy.pdf` carries an address. `1_400_Agreement_to_Lease_-_Residential_-_PropTx-OREA__4_.pdf` (a SkySlope/PropTx export) carries a form number and a form name. `1__DigiSign_Final_282.pdf` carries a bare civic number and no street. `Doc_-_Aug_19_2026_-_10-38_PM.pdf` is a TurboScan default. **One of four.** The convention recorded earlier in this spec (`14 Bonacres APS`) is Mo's own naming, not what arrives from other parties.

**A NEW PARKED ITEM CAME OUT OF THE SAME FILE SET: PAGE-SPLIT DELIVERY.** The TurboScan file is page 1 of an 8-page Form 101 condominium APS, because the sender scanned and sent every page as a separate attachment. Only the page carrying the address can ever match; pages 2 through 8 have no address anywhere on them. Per 7.2 they do nothing, and because matching gates BEFORE the filing record is written, **no record is created, so nothing anywhere says seven pages went missing.** The deal file ends up holding page 1 of an 8-page agreement, silently. That is precisely the failure 7.7 exists to prevent, arriving through the one door 7.7 does not cover.

### 15.0a SESSION 68: nothing new was read, and three assertions were corrected anyway

15.0's four-document corpus stands unchanged and 15.1 still awaits the instrument fixture set. HARD GATE B is unmoved.

What DID get corrected this session came from recon against the CODEBASE rather than from documents, and all three reversed a stated Claude assumption that would otherwise have shipped as a design error:

- **`confirmFiling` and `rejectFiling` existed all along** (`filings.js:207`, `:242`). Claude asserted twice that nothing could set `review: 'confirmed'`, reasoning from the absence of a CLI verb rather than opening the module. The correct gap was much smaller: a missing wrapper, with five near-identical wrappers already in `scripts/` to copy.
- **`readTransaction` returns `null` on ENOENT rather than throwing** (`store.js:216-221`). This changed the read path's design and exposed a latent null-dereference in `findListingCandidates`.
- **`parseGmailMessage` returns NO BODY AT ALL.** Body is bolted on afterward by one of its five callers. Four callers return objects with no body field, and an HTML-only message yields `''` silently.

**THE STANDING RULE THIS REINFORCES: open the artifact before describing its contents.** Prediction accuracy in this project is materially better when a recon pass precedes the assertion, and every one of the three above was caught by asking for file and line rather than for a summary.

### 15.1 Awaiting Mo: the instrument fixture set

Blank plus completed-and-redacted for each form, different transactions is fine and better for extraction variety, exported the way the brokerage actually exports them. The COMPLETED exports are what close HARD GATE B; a blank cannot calibrate an extractor against the shape recon item 5 found. Full list with form numbers is in PROJECT_STATE item 7.39.4. Priority half is the condition-clearing set (waiver, notice of fulfilment, amendment to APS, mutual release), because those are what section 7.5 watches the inbox for. FINTRAC is excluded per 5.3. One item needs no file at all: the attachment FILENAMES the brokerage's exports produce, which is what the 7.4 detector keys on.

## 16. Open product questions (not blocking the spec)

- Incremental date entry: does the agent confirm all dates at deal-open, or incrementally as conditions get negotiated? Incremental is more realistic and complicates the re-resolution contract; the evidence-record model (1.1) should make incremental confirmation safe, but walk it through explicitly at Phase A design.
- Founding-cohort free-TC duration (section 12's N).
- Commission tracking: natural byproduct of a closed transaction and what agents actually think in. Deliberately out of v1; the obvious v2.
- Brokerage-tier packaging: if the compliance granularity is as differentiating as section 5.1 suggests, the buyer may eventually be the brokerage. Different sale, different cycle, would forfeit the current distribution advantage. Not now.
- **Path 1B answered from stored listing data (v2 feature, but it constrains Phase A extraction).** The agent's own listings are the highest-frequency source of Path 1B property questions, and taxes, condo fees, inclusions, possession date, and dimensions all sit in structured fields on the data form. Answering them without waking the agent directly reduces the interruption rate, which is the metric the whole product sells on. Two hard constraints: the whitelist is FIELD-level, never document-level, because the listing file also carries seller motivation, price flexibility, and instruction history, and one leaked "seller needs a fast close" to a buyer lead is a fiduciary breach; and **the SPIS is permanently outside the whitelist**, stored and filed but never read into a draft, because the AI paraphrasing a disclosed defect to a buyer lead is the worst output this product could produce. **The Phase A consequence, to decide now even though the feature ships later: the data form must be extracted into structured, whitelisted FIELDS rather than merely filed as a PDF.** Open sub-question: whether listing-sourced facts may auto-send in live mode or always require approval.
- **DUAL AGENCY (one agent, both sides): RESOLVED session 69, see 7.1.2b and 4.1.6.** A double-end is ONE deal record typed to the sell side, carrying `representationArrangement: 'double_ended'`, which unions the paired catalog. Mo's field answer that each client is treated as their own, with separate FINTRAC and RECO records, meant the existing per-person satisfaction machinery was already correct and nothing about roles or scoping had to change. The multiple representation agreement item shipped as 5.2.3. **The two-agent same-brokerage case is still NOT modelled**: it produces two separate single-sided transactions, and whether it needs the form depends on a brokerage-level designated representation arrangement that no fact records. The `'designated'` value exists and deliberately fires nothing.
- **PER-CLIENT FACTS: the live gap left by the double-end build (NEW v14).** `entityType` is a single value for the whole file and cannot say that the buyer is a corporation while the seller is an individual. Both branches are wrong on a mixed double-end, and the dangerous one is silent: leave it and the corporate buyer's FINTRAC corporation record is never asked for at all. **The field question for Mo, which decides the size of the fix:** on a double-end where the buyer is a numbered company and the seller is an individual, does the deal file carry two separate sets, corporate records for the buyer and individual records for the seller, or does the brokerage handle the corporate side elsewhere? If it needs two sets, this requires per-person APPLICABILITY, not merely a reshaped fact, because `requiredWhen(facts)` runs once per item before `withClientSatisfaction` fans out to people. Full statement in 4.1.6.
- `chaseMode` live-send criteria: what observed draft quality unlocks it, and is it per-participant-role rather than per-agent (live to condo managers before live to lawyers)?

## 17. Summary of decisions

**Locked:**

1. Rule 1 v2: the AI never COMMITS a deadline. Extraction pre-fills; every date carries a source excerpt; confirmation is per field against evidence; bulk accept banned; unconfirmed dates never drive reminders or chases.
2. Rule 2: AI proposes, agent confirms, across filing, completion, state changes, deal-open, participant casting, chases, and client comms. Shadow Mode applied to the deal file.
3. Rule 3: assistant on top of the brokerage deal file, never the system of record.
4. All four transaction types ship in v1. Leases are a wedge, not an afterthought.
5. Transactions open at acceptance (buyer/tenant) or listing agreement (seller/landlord). `Draft` and `Searching` belong to the lead pipeline and are not rebuilt here.
6. A lead links to a transaction via `transactionId`; it does not become one.
7. The checklist is a pure resolver over declarative rules. Every item carries a `source`. Excluded items render as not-applicable-with-reason, never hidden.
8. Re-resolution preserves completion state and never hard-deletes. Mandatory break-the-fix target.
9. Matching is multi-signal against an internal `transactionId`, not email-keyed.
10. Attachment status `needs_review` -> `confirmed` | `rejected`. High confidence buys filing, not completion.
11. Deal-open detection proposes, never opens; conservative tuning; per-thread idempotent via labels.
12. Participant auto-discovery pre-populates the role model from the thread; failed inference degrades to `other`, never omission.
13. Completion detection proposes item completion when clearing instruments arrive; the item flips only on confirmation.
14. Chase drafting reuses the existing draft engine, is agent-approval-only at launch, chases third parties only, and never asserts legal positions or unconfirmed deadlines.
15. Client comms staged: generated one-pager in v1, drafted milestone emails deferred.
16. State on the Railway volume. Documents in Drive, per-transaction folders, app-created only (drive.file manual-upload caveat is a design constraint). Generated Drive artifacts are outputs only. No new OAuth scope.
17. FINTRAC is granular and conditional, and does not apply to leases at all.
18. Pricing: flat $250/month, unlimited transactions. Full-stack positioning against the $3,750 to $5,000/month human assistant, pitched honestly as the desk half only.
19. Reusable `src/transactions/` functions; CLI scripts are thin wrappers; the confirmation surface is disposable, the assembler is not.
20. Build phased A through D with HARD GATE B (excerpt-anchored extraction accuracy) and HARD GATE C (chase draft quality) before agent-facing use of those paths.

22. **(v10)** Unmatched attachments do NOTHING. No unsorted folder, no triage queue. Matching is a gate, not a router, and a miss leaves the agent exactly where they are today.
23. **(v10)** Matching anchors on the envelope address, normalised for COMPARISON and never for STORAGE. One open transaction is not a signal. The bar is ninety percent as a stated rule, never a model's self-reported confidence.
24. **(v10)** The filing record is written BEFORE the bytes are fetched and does not depend on the Gmail label, because that label fires a message's one shot before any downstream step has succeeded.
25. **(v10)** Three document event kinds; per-attempt failures get no events. The log records what happened to the deal, the record carries what the machine is doing about it.
26. **(v10)** The content hash is an idempotency key that also catches duplicates. Near-duplicates land as separate files deliberately: a duplicate in a folder is an annoyance, a suppressed amendment is a compliance problem.
27. **(v10)** The transaction folder is created at deal-open with what is known and NEVER renamed. Flat in Phase A. Filenames may contain only observed facts, never inferred ones.
28. **(v10)** `indeterminate` never folds into outstanding or satisfied on any surface, and nothing renders as clear while anything is indeterminate OR unconfirmed. The unit of the surface is the question, not the row, and the question set is derived from `pendingFacts` rather than hardcoded.
29. **(v10)** `hasSelfRepresentedParty` is extractable when FALSE (a co-operation form names a brokerage) and not when TRUE (absence across a document set). The question fires only when the positive evidence is absent.
30. **(v10)** `data_form` is a listing-catalog item on both listing types, transaction-scoped and seller-signed. The SPIS is not a catalog item at all.
31. **(v10)** Google POST calls get their own retry with jitter, because gaxios already retries every other verb and retries none of the POSTs. Auth-failure handling is reused from `gmail.js` rather than duplicated, because deactivating an agent is a state transition and must have one implementation.

32. **(v11)** The matching rule is: D, or any two of A, B, C. The matcher is PURE and deterministic with no model call, because a stated set of conditions is a pure function and that is what the ninety percent bar demands.
33. **(v11)** Candidates are NON-TERMINAL transactions only. When a listing and its own deal both match, the DEAL WINS. Everything else matching more than once is a miss.
34. **(v11)** Participants are TRANSACTION-SCOPED, keyed by a generated id, stored as a map. `roles` is an ARRAY. Roles are SET-ONCE: a replaced lawyer is a new participant and both stay on the file. Role combinations are recorded, never refused.
35. **(v11)** `representedPersons` DERIVES from participants and is no longer a settable fact. The derivation returns ABSENT, never an empty array, because empty would render a deal nobody has been named on as all-clear.
36. **(v11)** `hasSelfRepresentedParty` stays an INDEPENDENT fact and does NOT derive from participants. A self-represented party who never appears in the cast still makes it true, so deriving it would make an empty cast assert something nobody was told. `isSelfRepresented` on a participant and `hasSelfRepresentedParty` on the facts are two different claims, and the second is not a rollup of the first.
37. **(v11)** Address comparison is absence-tolerant on `streetType`, `directional` and `city`, and strict on `civic` and `street`. Present-on-both-and-different is a hard mismatch; present-on-one is uninformative.
38. **(v11)** Deal open REPORTS candidate listings and never links automatically, because the tolerant comparison that is correct for matching would write a durable wrong link here. The cost structures are inverted: a wrong match is free, a wrong link is not.
39. **(v11)** Name resolution returns a RESULT OBJECT rather than throwing, so a future picker UI has structured candidate data instead of a message string to parse. It is scoped to represented participants so the error fires at the layer where the name still exists.

40. **(v13)** A signal that could not be EVALUATED is ABSENT from the returned object, never `false`. Absent means the comparison was never formed; false means it was formed and disagreed. A string sentinel was rejected because it is truthy and would silently flip every truthy-testing caller.
41. **(v13)** When the stored `address` does not parse, signals A and C are ABSENT rather than false. A transaction that can only ever match on B and D will effectively never file, and only absence makes that visible.
42. **(v13)** Signal B reads participants' `emails[]` UNION the keys of `observedAddresses`. 7.1.1's `emails[]`-only text was stale. This is not circular because observed addresses are only written on threads carrying an agent-confirmed filing, and their value is cross-thread.
43. **(v13)** The deal-beats-listing tiebreak REQUIRES an explicit `listingId` link and must never widen to "paired types plus a matching address". A `landlord_listing` on unit 302 and a `landlord_lease` on unit 505 in one building are a paired type set at one compared-equal address and are different properties.
44. **(v13)** Two candidates with DIFFERING stored `unit` values are evidence of different properties and suppress the link suggestion. Units ABSENT is not evidence, on either side. That check runs BEFORE the unlinked-listing check.
45. **(v13)** The `ambiguous_unlinked_listing` miss additionally requires the two addresses to compare equal, because signal D alone can make two unrelated transactions meet the bar. The bar to SUGGEST a link is higher than the bar to MATCH, because a confirmed link is a durable write on a compliance record.
46. **(v13)** A matching set of three or more is `ambiguous` with no tiebreak. That is the double-end case, SkySlope opens one file for it, and whether three transactions is the right model at all is an open section 3 question rather than a matching problem.
47. **(v13)** The read path SKIPS a transaction whose file is absent and THROWS on one that is present and unreadable. Absence is a race with the soft-delete sweep; unreadability is a store bug, and swallowing it means a real deal silently stops matching forever.
48. **(v13)** Reading every transaction file per message is ACCEPTED rather than indexed, on the evidence that agents carry roughly 2 to 20 open transactions and 200 is rare. The loader is called once per MESSAGE, never once per attachment. That is a caller contract the module cannot enforce.
49. **(v13)** Filing review is exposed as ONE CLI verb with `--reject` as a flag, taking raw Gmail ids, deliberately operator-only. A filename-to-record resolver is not built because nothing creates filing records yet, so there would be nothing to resolve against.
50. **(v14)** A double-end is ONE deal record typed to the SELL side, carrying a `representationArrangement` fact, never a new transaction type and never three records. The matcher is unchanged: the third candidate stops being created rather than being resolved.
51. **(v14)** A FACT MAY SHAPE THE ITEM SET, not only one item's applicability. This is a new role for a fact and had zero precedent; the only prior set-shaping logic was the state-driven `terminalOnly` filter. Subtype was considered as the home and rejected because it does not exist in code at all.
52. **(v14)** The double-end merge ANNOTATES BOTH CATALOGS INDEPENDENTLY and merges by id, taking the higher applicability with precedence `required` > `indeterminate` > `not_applicable`. Predicate composition was rejected. The obligation applies if EITHER side's rule says it does, because under-asking on a FINTRAC record is the worse error.
53. **(v14)** A merged row takes EVERY field from ONE side, wholesale, never stitched. `reason`, `pendingFacts`, `satisfiedPersons` and `outstandingPersons` are all paired with the applicability that produced them. No real catalog id can currently exercise this, so it is pinned with a synthetic fixture through a test-only export.
54. **(v14)** `setFact` and `correctFact` REFUSE `'double_ended'` on a type with no buy-side pairing, at the write boundary, mirroring `listingId`'s type permission in the store. The resolver degrades to single-side rather than throwing, because a throw at resolve time means a stored deal can never resolve again.
55. **(v14)** `reResolve`'s `no_longer_applicable` reason is CAUSE-AGNOSTIC. An item can leave the set for at least three reasons and `reResolve` holds no previous type or facts to tell them apart, so it states what it knows rather than guessing. Closes 7.41.5.
56. **(v14)** The multiple representation agreement fires on `'double_ended'` ONLY. The two-agent case depends on a brokerage-level arrangement no fact records, and decision 33 keeps brokerage branching out of the catalog. The under-ask is deliberate and pinned by an explicit test rather than left incidental.
57. **(v14)** The observed-address accumulator derives `agentId` and `transactionId` from the transaction ENVELOPE rather than taking them as arguments, so a caller cannot write agent A's transaction under agent B's id. It reports three outcomes distinctly rather than two.
40. **(v11)** A participant's `name` is OPTIONAL, so a represented participant can exist whom no name lookup can reach. Any name-based surface must report a nameless count rather than implying the person is absent.

21. State machines are fully enumerated with no wildcards. Buy-side has no `terminated` and that asymmetry is deliberate, deriving from the section 2 scope boundary. Listing suspension is modelled `live -> suspended -> live` on sell-side only, and it FREEZES THE CLOCKS rather than only relabelling. `landlord_lease` gained `signed -> live` to close a missing collapse path.
22. Items carry two lifetimes (`scope: transaction | client`, with `clientScope: event | dated`) and three evidence kinds (`evidence: document | attestation | external_system`).
23. One transaction equals one governing AGREEMENT, not one property. Amendment and suspension keep the same transaction; a genuinely new agreement opens a new one with the prior linked as history. The reason is commission and holdover attaching to a specific agreement.
24. Date extraction is live and editable everywhere except deal-driving deadlines (irrevocable, condition, closing), which keep Rule 1's per-field confirmation.
25. FINTRAC is `external_system: fintracker`. No document exists, completion detection cannot fire from an instrument, and GetKlosed never stores client identity data. Fintracker confirmation emails are detect-if-present, never require.
26. Forms are stored and pre-filled, never generated. OREA licensing, not engineering. Brokerage-specific templates are the carve-out.
27. Build order is store, then resolver, then plumbing, then detection. The confirmation surface is LAST, which is why TC does not wait on the dashboard epic.

28. **Client-scoped items are satisfied PER REPRESENTED PERSON**, with shared evidence: one form, N signatures, N satisfactions. Identity is the person, not the household. It renders as ONE ROW PER DOCUMENT with the per-person data as evidence underneath, matching brokerage practice. Absent `representedPersons` emits neither derived field, because an empty outstanding list is a claim the system was never given the facts to make.
29. **Applicability and completion are DIFFERENT AXES.** `reads` and `requiredWhen` decide what APPLIES; per-person satisfaction decides who has CLEARED it. `resolveChecklist` has never set `completed` and must not start. The resolver decides what applies, the agent decides what satisfies it.
30. **Rule 1 amended again (v5): APPLY AND NOTIFY.** A value may be applied and displayed without confirmation; it may not be acted on outwardly without one. A rubber-stamped gate is worse than no gate. The source excerpt, the visible unconfirmed marking, and the per-date evidence record all survive unchanged. Price is treated as a date. A name coming off the deal still proposes.
31. **The deposit is DATA, not a rule.** No cap, no validation, no warning copy. The system RECORDS deposit terms and never PROPOSES them. The security/damage negative assertion stands and is enforced across the whole catalog by test.
32. **`source` names the AUTHORITY behind an obligation, never the publisher of a form.** Form 400 is `brokerage`, not `OREA`. The six-value allowlist is not widened.
33. **Two brokerages accepting different instruments to close is a SATISFACTION question, not a resolution question.** Both items always fire; a substitute satisfies with a note. No per-brokerage branching enters the catalog.
34. **STATE is a positional argument to both resolver functions, never a fact.** Facts are agent-answered, state is machine-tracked. Two writers for one value is the bug being avoided.
35. **`terminalOnly` items are ABSENT from the resolved set, not not-applicable.** The one deliberate exception to never filtering. A not-applicable mutual release still renders as a row, and on a healthy deal that reads as the system floating the possibility the deal dies.
36. **Dates are not rows.** A row is an obligation you satisfy. Condition dates, closing, and requisition are transaction fields; derived windows are chase-engine arithmetic. The resolver has no clock and does not get one to ship a catalog section.
37. **Catalog section 5.6 is DELIBERATELY EMPTY.** Closing is when the brokerage VERIFIES obligations that already exist, not when new ones appear. An empty section here is a result, not an oversight.
38. **A row the agent cannot act on is not a row.** Deposit disposition was rejected on this ground: it would sit outstanding forever and teach agents to ignore the checklist. Same test emptied 5.6.
39. **There was never a completion precondition on closing.** Established by recon, not reasoning: `canTransition` and `isTerminal` had zero non-test callers and `store.js` imported neither `states.js` nor `resolver.js`. The close override is therefore a RECORDING decision, not an unblocking one.
40. **The actor vocabulary is three values and the KIND carries everything else.** `agent | system | operator`. Splitting actors by which system path did the work is how `actor` becomes a taxonomy.
41. **Rule 1 writes TWO entries.** System applies, agent confirms. One entry cannot distinguish a verified value from one no human ever looked at, which is the only question that matters six months on.
42. **Envelope general, vocabulary narrow.** One event kind ships; every future kind arrives with its own writer. Same discipline that closed catalog 5.6 empty.
43. **`makeEvent` is the only constructor.** `appendEvent` deliberately does not validate. A discipline claim recorded in the spec, not a redundant runtime guard with no caller to decide against.
44. **Outstanding at close is required-and-incomplete.** `indeterminate` rides in the snapshot and stays out of the count, because an unanswered fact is not an unmet obligation and closing is the wrong moment to demand data entry.
45. **The close record is a SNAPSHOT, not a list of ids.** The catalog is code that changes; re-resolving six months later reconstructs something the agent never saw.
46. **A clean close writes NO event.** The log records exceptions, not routine.
47. **The override surface is `closed` only.** Not `collapsed`, not `terminated`. A dead deal has outstanding items by definition and warning there is noise.
48. **The transition service refuses by RETURNING and fails by THROWING**, and a close with items outstanding is neither: it succeeds and records. That is Rule 3 finally enforced somewhere.
49. **A deal file must never land in a directory the caller did not name.** `open-transaction.js` requires `baseDir` in its CORE and never calls `getStorageRoot()`. The `process.cwd()` fallback is correct for a server and wrong for a hand-run tool, and is refused at the one call site where it is wrong rather than changed for the five callers that depend on it.
50. **State validation at open belongs to the caller, not the store.** The store deliberately does not enum-validate `state`. The CLI calls `isValidInitialState` and names the valid initial states in its error, which is what makes it more than a wrapper.

51. **The LISTING is its own transaction type.** Six types, three state tables. The overload dissolved by splitting the RECORD, not the field. Offers are siblings under a durable listing.
52. **A relist is ONE transaction.** 4.2's agreement-boundary premise was reversed on field evidence: the cancellation form dates the boundary, so the ambiguity 4.2 feared is resolved on paper.
53. **Near-identical record proliferation is noise; genuinely distinct record proliferation is history.** That single line reconciles relist-as-same-record with offers-as-siblings.
54. **Auto-close is permitted.** Section 3's "the AI never applies a transition" predates Rule 1's apply-and-notify amendment. Closing a listing whose deal closed is not outward-facing.
55. **The record type partitions the catalog.** No third `scope` value was needed; picking the listing-as-record model made it unnecessary.
56. **`seller_sale` and `landlord_lease` have NO representation instrument.** A removal, not a repoint.
57. **The file stores what it was told and what the agent did, never what the catalog concluded.** Anything derived goes stale the moment a predicate changes.
58. **Provenance lives in the log, once.** Two homes for one truth is how they disagree.
59. **First-set is not a change; absent, never null.** Writing `before: null` asserts a fact nobody supplied.
60. **Uncompleting is a real event.** A correction, not a deletion.
61. **`listingId` is optional, and the store validates only what the envelope can answer about itself.** Existence needs a read; that is the caller's job.
62. **A check only means something if you worked out what it would read under BOTH outcomes before running it.** See the discipline section below.

**Sections 3, 4.1 and 5 are LOCKED as of session 55, amended sessions 59 and 60. SECTION 3 WAS REDESIGNED and SECTION 4.2 REWRITTEN in session 62.** No section of this spec is now awaiting review. **The item catalog is COMPLETE but PARTITIONED differently than in v7.**

## 18. Verification discipline (NEW v8, from two days of checks that proved nothing. AMENDED v11.)

**(v11) BREAK-THE-FIX REQUIRES A GREEN BASELINE.** Session 66 ran a mutation against a suite that was already red on an unrelated pin, so red went 1 to 4 rather than 0 to 3. A pre-existing failure can mask a new one or be mistaken for it. Run the full suite BEFORE editing, confirm the totals line, and fix any red before mutating anything.

**(v11) A COMMIT THAT ADDS A VALUE TO AN ENUMERATION INCLUDES THE TEST PINNING THAT ENUMERATION.** Twice in session 66 a prompt forbade touching the test file that pins a frozen list while instructing the addition of a member to it. That instruction is self-contradictory: the pin exists to make the addition deliberate. `EVENT_KINDS`, `FACT_KEYS`, `FILING_STATUSES` and `TRANSACTION_TYPES` all have this shape.

**(v11) THE EM-DASH RULE COVERS CARRIED-OVER TEXT, not only new prose.** A rewritten comment block reintroduced an em-dash from the text it replaced. The grep must check ADDED lines specifically rather than whether the diff contains any, since a deleted line carrying one is a false positive.

**(v11) A MUTATION MUST BE ABLE TO REACH THE THING IT CLAIMS TO TEST.** A session-66 mutation removed a leading-position rule and was predicted to break both directions of a two-branch behaviour. It could only ever break one, because the other direction was handled by separate untouched code. Predicting the MECHANISM, not just the count, is what catches this before the run rather than after.

**(v11) HARDCODED COUNTS IN TEST DESCRIPTIONS GO STALE SILENTLY.** "lists exactly the eleven expected kinds" over a twelve-item array passes forever. The number in the name is a comment, and comments that lie are worse than none.

Six commits landed across sessions 62 and 63. In the same window, **four separate checks reported success without proving what they claimed**, and one break-the-fix cycle was vacuous until it was widened. They are recorded together because the cause is one thing.

**The four:**

1. **A probe that could not fail.** A `node -e` written to test whether `withClientSatisfaction` attaches person fields to non-required items pointed at an item that was still `scope: 'transaction'`, so the scope gate rejected it before applicability was ever consulted. Clean output guaranteed regardless of the truth. CC noticed, copied the resolver outside the repo, and got a real answer.
2. **A `sed` range that swept past its target.** `sed -n '/pattern/,/^    },/p'` re-triggers and, past the last match, prints to end of file. The "differences" it surfaced were the known receipt-of-funds asymmetry and the `module.exports` block.
3. **A totals line read against no expectation.** 1855 before a change and 1855 after looked like nothing had happened. The instruction had said to add assertions to an EXISTING test, and Jest counts `it` blocks, not `expect` calls. The flat count was exactly what success looked like.
4. **A fabricated precedent.** "The synthetic-item tests at lines 744 and 757" did not exist; those were field values inside a `previousItems` fixture. Two lines of grep context were reasoned into an idiom that was never there, and used to authorise a design choice.

**The vacuous cycle.** Break-the-fix cycle A on `26a4c37` re-added `['conditional','live']` to an edges array after `live` had left the type's states. `canTransition` checks to-state validity before consulting edges, so the edge was never read. One red, from an unrelated invariant, measuring nothing. CC widened the edit to restore `live` to `states` as well and got three.

**The rule.** Before trusting a result, work out what it would read under BOTH outcomes. If the failure case and the success case produce the same output, the check is not a check. This generalises the session-61 rule about validating an em-dash sweep against a known positive.

**Corollaries with teeth:**

- **A destructive edit against a dynamically generated suite can REMOVE or ADD a test case rather than fail one.** `scripts.openTransaction.test.js` generates one case per (type, initial state) pair. Predict the TOTAL as well as the red count, always.
- **A generated test can pass for the wrong reason.** The `open-transaction` state-validation hole (`939fa0b`) was found exactly this way: a cycle added an initial state that was not in `states`, and the generated case went green.
- **Derived tests absorb model changes; hardcoded maps break.** In `08ce3a6`, tests deriving from `getStates` and `CATALOG` cost nothing; four-entry hardcoded maps broke. When they break, narrow them to a NAMED constant, never weaken them to skip unknown types silently. A test that silently skips has stopped noticing.
- **`git checkout --`, `git stash` and `git restore` all DESTROY uncommitted break-the-fix work.** Both were tried and both took the real work with them: `checkout --` reverts to HEAD, and `stash push --keep-index` stashes everything when nothing is staged. **Hand-revert the destructive line and verify by re-reading the file.** No git command is the correct restore for an uncommitted tree.
- **`TABLE` is deep-frozen, and mutating `initial` in a sloppy-mode test file SILENTLY NO-OPS** rather than throwing. A test written that way looks like legitimate setup, does nothing, and passes for the wrong reason.
- **A BEFORE AND AN AFTER THAT ARE EQUAL, ALONGSIDE A NONZERO DELTA, IS ARITHMETIC THAT DOES NOT CLOSE.** Session 65: CC reported the suite at 2031 both before and after its own change while also claiming 21 tests added. It had never run the suite before editing and reconstructed the "before" from the "after". This is a NEW COSTUME for the recurring fabrication failure: not a fabricated total, a fabricated BASELINE. Resolve by moving the new test file aside and running twice.
- **THE EM-DASH CHECK MUST RUN AFTER `git add -N`, or it is a positive control that never fired.** New untracked files produce no diff, so the added-lines grep greps an empty string and returns clean. Session 65: reported clean, was reading nothing. The same trap in a third costume produced a RECONSTRUCTED diff, where CC wrote out what it believed a file's original content was and diffed against that. **A reconstructed diff is not evidence.**
- **A BREAK-THE-FIX THAT COMES BACK ZERO RED IS INFORMATION, AND CC REPORTING IT PLAINLY IS THE CORRECT BEHAVIOUR.** Session 65: an assertion Claude specified as closing a gap turned out to be behaviourally redundant with `makeEvent`'s existing guard, and the test's unanchored regex could not distinguish which validator fired. CC said so rather than tightening the regex to make the added line look load-bearing.
- **DO NOT ASSERT A GAP IN ONE FILE WITHOUT OPENING THE FILE DOWNSTREAM OF IT.** Session 65, twice in the same direction: `seenAt` called unvalidated without opening `events.js`, and em-dashes claimed from a TERMINAL RENDERING of a diff rather than the source bytes. Both are the same error as session 64's `STORAGE_ROOT` false alarm.
- **A LIVE PROBE BEATS A CONFIDENCE RATING ON A LIBRARY'S BEHAVIOUR.** Session 65: recon read `apirequest.js:96` and rated Buffer upload MEDIUM confidence. That line picks a default MIME type; line 180 is where the body is piped. One probe run against a real account converted the largest medium-confidence item on the board into a definite no, and cost ten minutes against a build session.
- **A CATCH BLOCK THAT ONLY PRINTS `err.response` CANNOT REPORT A CLIENT-SIDE THROW.** Session 65 burned two network runs printing `status=undefined` and `error body: undefined` because the step being changed had weaker error handling than the step being added. **Widen the catch on the step you are actually testing, and print `err.message` and `err.stack`.**
- **VERIFY THE EDIT LANDED BEFORE SPENDING A NETWORK ROUND TRIP ON IT.** The grep goes first, the run goes second. Session 65 ran an identical probe twice because the diagnostic edit had never landed.
- **If about to describe what a file contains, OPEN IT.** Three errors in one session came from asserting the contents of unopened artifacts: filenames misread as version numbers, a spec section claimed absent that was at line 985, and the fabricated test idiom above.

**Still to build in Phase A (v8 list, expanded).** Phase A per section 14 is the manual-entry TC: store, states, resolver, rules catalog, manual deal-open, digest section, Drive filing pipeline (7.1 to 7.3).

**DONE:** item catalog, store, state machines, resolver, event log, state write path, manual deal-open, the six-type model, the spine split, `listingId`.

**BLOCKING EVERYTHING ELSE:**
1. **FACT STORAGE (4.3).** Designed in session 63, not built. At least three commits.

**BLOCKED ON 1:**
2. The CLOSE CLI. Without items, `transitionTransaction` can only take the no-items branch, so the close override built across three commits in session 61 has never been exercised end to end.
3. The listing-to-offer transfer filter (4.5). Attempted session 63, correctly abandoned: nothing to transfer.

**NOT BLOCKED:**
4. `store.js` still validates `state` as any non-empty string, deferring in a comment to "the state machine is not locked in the spec yet." It has been locked since session 55 and rewritten twice since. A stale deferral guarding the file that holds every deal. Own commit, probably a quick one.
5. `clientScope: 'dated'` window evaluation, which needs the resolver clock question settled.
6. Dual agency and its multiple representation agreement item (section 16).
7. The assistant@ TC verbs, agent-facing half only.
8. The digest section.
9. The Drive filing pipeline (7.1 matching, 7.2 confidence tiers, 7.3 attachment status).

**NOT PREVIOUSLY ON ANY LIST, surfaced sessions 62 and 63:**
10. **The DATA FORM is not a catalog item and should be.** Mo named it as transferring from listing to offer. Section 3's prose already references it. Line 1078 flagged that it must be extracted into structured whitelisted fields rather than filed as a PDF. It never became an item, and it belongs on the LISTING catalog.
11. **The SPIS is referenced in section 3's prose and is not a catalog item either.** Same gap, same catalog.
12. **The argv parsing in `open-transaction.js` is untested** for both `--base-dir` and `--listing-id`. No subprocess-test convention exists in this repo for CLI flag parsing, which is why it was not added for the newer flag alone.
13. **Verify programmatic Drive folder creation and nested filing against a real agent token** in a throwaway script, per section 15 item 1, "before Phase A locks." `scripts/_throwaway/drive-file-probe.js` exists, which suggests this was started; whether it ever ran is unknown.
14. **`scripts/_throwaway/` carries a vendored minified `pdfjs` bundle**, about 3.7MB, untracked. It pollutes every recursive grep from the repo root. Delete or gitignore.

**FACT STORAGE IS STILL THE BLOCKER, BUT IT IS NOW SPECIFIED: see section 4.3.** The consequence chain is unchanged and worth restating, because it is the reason six commits of model work did not move the product any closer to a working checklist: no facts, so no items, so `transitionTransaction` can only ever take the no-items branch, so the close override cannot be exercised end to end. Sessions 62 and 63 built the model the facts will hang on. They did not touch the reason the resolver has no caller.

**The address question is folded into 4.3 and answered by precedent.** `listingId` (4.4) established that identity fields are validated envelope fields while facts are not, so the address belongs on the envelope. Not yet built.

**NEW, from session 60, and not yet parked anywhere else.** A REFERRAL is not a transaction type. Mo confirmed referrals need a deal sheet, which surfaced that `TRANSACTION_TYPES` has four values and referral is none of them. A referral has no property, no conditions, no FINTRAC, and probably no representation agreement, so running it through any existing type would resolve most of the catalog required and be wrong on nearly every row. It is a FIFTH TYPE with its own state machine, not a small addition. **Commission follow-up** is the other one: chasing the brokerage when an EFT notice has not arrived, which is the first place in the TC where the system chases for the AGENT'S money rather than the brokerage's paperwork. It hangs off the `closed` transition and the existing chase infrastructure, but it carries the Fintracker constraint (an absent email proves nothing, detect if present, never infer non-payment) and a harder approval posture, because the agent has to work with the accounting department they are being nudged on behalf of. Phase C.

**Gated on:** ~~Stripe billing shipping first~~ REMOVED session 55. Incorporation and E&O coverage before this feature is SOLD, though not before it is built.

**18.x ADDITIONS FROM SESSION 64.**

**A ZERO-RED MUTATION USUALLY MEANS THE FIXTURE NEVER VARIED THE INPUT, not that the test is hard to write.** Hardcoding the `state` argument in `resolveChecklistForTransaction` went zero red across 1951 tests, because every fixture used `conditional`. The `create()` helper already took `type` and `state`; the coverage was one argument away and nobody had passed it. **Check the fixture before concluding a behaviour is untestable.**

**RENAMING A TEST IS SOMETIMES THE FIX.** A test named "completedAt is not overwritten by at" could not distinguish the correct code from `completedAt: opts.completedAt || opts.at`, because it passed a truthy value and `||` only fires on a falsy one. Adding a duplicate assertion would have been coverage theatre; the honest fix was renaming it to what it actually proves and commenting which tests cover the other case. **CC predicted this correctly and pushed back on a Claude instruction to add coverage; the pushback was right.**

**A HALF-RUN TOTAL IS NOT A TOTAL.** An 8/8 single-file figure against a 1951-test suite reads like a pass. Always the full `STORAGE_ROOT=$(mktemp -d) npx jest` and always the totals line.

**THE PAGER SERVES STALE DIFFS.** One commit this session went in on a `git diff` that showed the PREVIOUS commit's changes. `git status --short` plus explicit paths on `git add` is what kept it correct, but that is luck rather than review. `git diff > /tmp/d.txt && open -a TextEdit /tmp/d.txt` beats paging.

**RAILWAY IS NOT THE REPO.** A recon grep run in the container reported `__tests__/: No such file or directory`, because tests are not shipped to production. **Runtime state lives in the container, code lives in the repo.**

**zsh EATS AN UNQUOTED `--include=*.js`**, and the failed command piped to `wc -l` prints a clean `0` that is indistinguishable from a true zero. Quote the glob, prefer `-l` over `-c` so the answer is a list rather than a number, and sanity-check the incantation against a pattern known to exist before trusting an empty result.

**ASK CC TO STATE WHAT IT CHECKED, NOT TO FIX SOMETHING.** Three real gaps surfaced from reports rather than repairs this session: the CLI that no longer ran, the 7.46.4 premise being factually wrong, and the state coverage being zero. A question that can be answered "no" is worth more than an instruction that can be followed badly.

**CLAUDE RAISED ONE FALSE ALARM FROM MEMORY OF A COMMENT RATHER THAN THE CODE**, flagging the new CLI scripts as diverging from `open-transaction.js` on `STORAGE_ROOT`. They did not: `open-transaction.js` has always accepted the env var explicitly, and what its comment refuses is `getStorageRoot()`'s SILENT cwd fallback. The check was worth running and the conclusion was wrong. **Read the resolution block, not the comment above it.**
