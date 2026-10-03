# CONTENT_ENGINE_PROVISIONING_SPEC.md - agent-ai

**Status:** LOCKED DESIGN, not built. Design locked in chat (2026-07-21). Implementation not started.

**For:** future Claude chats inside this Project. This is the authoritative design for moving Content Engine provisioning off the terminal CLI and onto the operator dashboard. It supersedes the "run `node scripts/enable-content-engine.js`" hint that session 36 wired into the agent edit page (commit `95b0085`). If this doc and PROJECT_STATE ever conflict, the more recently dated one wins; otherwise this doc is authoritative for dashboard provisioning specifically. The Content Engine itself (data layer, angles, renderers, review email) is unchanged and remains specified in CONTENT_ENGINE_SPEC.md.

---

## 0. The problem in one sentence

Provisioning an agent onto the Content Engine today is a terminal step (`enable-content-engine.js <agentId>`), and the operator wants to do it from the dashboard instead, with the per-agent config editable in the same place.

## 1. This is an ergonomics change, not a posture change

The reason provisioning lived on the CLI (session 36) was to keep Content Engine a deliberately-provisioned paid add-on with no self-serve enable path, so an agent who has not paid the $300/month cannot flip it on through a free-tier form. That rationale is preserved here, because the dashboard is the OPERATOR dashboard: one `DASHBOARD_PASSWORD` gates it, there is no per-agent login, and only the operator reaches it. Moving the mechanism from terminal to browser does not create a self-serve path. The operator still performs the provision deliberately after a billing conversation. The gate is the operator's judgment, exactly as it is today, and the CLI's free-enable-prevention property survives untouched as long as this section stays operator-scoped (section 8).

## 2. Reuse the existing profile.js functions

The real write logic already exists in `src/content/profile.js` (`buildDefaultContentProfile`, `writeContentProfile`, `updateContentProfile`, `setContentEngineEnabled`, `isContentEngineEnabled`) and voice extraction lives in `src/content/voiceExtract.js`. The dashboard becomes a second caller of those functions, exactly as the CLI is the first caller. No write logic is duplicated. This is the session 43 lead-import discipline (the import and bulk-enable routes called `normalizeLeads` / `landLeads` / `enableLeads` with zero changes to the underlying modules) applied again. The dashboard route reshapes input and renders output; the modules stay the single source of truth for what a valid profile is.

## 3. One card, two render states

A single "Content Engine" card on the agent edit page (a sibling to the existing Danger Zone card from session 41). It renders one of two ways depending on whether `readContentProfile(agentId)` returns null. The operator does not choose between them; the card knows which to draw.

### 3.1 No profile (provision view)

`readContentProfile` returns null. Render a short explainer and a single "Provision Content Engine" button. There are no initial questions in this view, because every configurable field lives in the config view and there is no reason to ask twice. The provision action writes a profile via `buildDefaultContentProfile` with these defaults:

- `contentEngineEnabled: true`
- `contentEngineMode: 'live'` (see section 5)
- `primaryFocus: 'both'`
- `contentVolume: 'max'`
- tier-3 default voice descriptor (`SYSTEM_DEFAULT_DESCRIPTOR`, no Claude call)

Because provisioning writes the tier-3 default and makes no Claude call, it is instant. After the write, redirect back to the edit page, where the card now renders the config view.

### 3.2 Profile exists (config view)

Render the editable config. The enable/disable toggle sits at the top, then the fields, then the voice subsection. The full field list is section 4. A single Save persists the cheap fields (section 7); the voice subsection has its own action (section 6) and is never touched by Save.

## 4. Fields exposed, and fields deliberately not

Exposed in the config view:

- **Enabled** (toggle): reconciled via `setContentEngineEnabled`.
- **primaryFocus**: `buyers | sellers | both`.
- **contentVolume**: `max | balanced | minimum`.
- **forbiddenTerms**: free-text list (comma or newline separated), normalized by profile.js (trimmed, lowercased).
- **forbiddenTopics**: free-text list, normalized by profile.js (trimmed only, proper nouns preserved).
- **Voice** (section 6).

Deliberately NOT exposed, to keep the surface tight:

- **contentEngineMode / shadow mode**: removed entirely from the UI (section 5).
- **deliveryDay / deliveryTime / timezone**: defaulted to monday / 07:00 / America/Toronto. Not editable in this build. Easy to add later, no reason to widen now.
- **cadence**: locked to weekly, not surfaced.

## 5. Shadow mode is dropped

Shadow mode never controlled posting. The engine has never posted anything anywhere; content always goes to the agent, who decides whether to publish. All `contentEngineMode: 'shadow' | 'live'` ever did was decide whether the operator got CC'd on the agent's review email for a few QA cycles before it went agent-only (CONTENT_ENGINE_SPEC section 9.5). The operator does not want that oversight lever, so it is dropped: the field is never surfaced, and provisioning always writes `'live'`.

Scope of removal, minimal by choice: never render the field and always provision `'live'`. `reviewEmail.js` still branches on the field, but with every profile written as `'live'` the shadow branch simply never triggers. Leave the dormant branch and its tests in place for this build. Ripping shadow mode out of the engine and its tests is a separate cleanup, parked, not folded in here (a UI change should not drag engine and test churn behind it).

## 6. Voice subsection

Voice extraction is a Sonnet call (`voiceExtract`), not a free field write, so it cannot ride on the main Save. Bundling a paid async call into every config tweak is wrong. Instead the voice subsection has its own dedicated action:

- The current `voiceDescriptor` renders read-only above the input (so the operator sees what is active).
- A textarea accepts either voice samples (past content the agent feels sounds like them) or a two-to-three sentence self-description.
- An "Extract / refresh voice" button, and only that button, runs `voiceExtract` and writes the resulting descriptor (`descriptor.rawSummary`, the string form, per the session 24 contract fix `7ecf38c`).

One Sonnet call blocking one button for roughly ten to twenty seconds is acceptable. The tier system remains the fallback: no samples and no self-description means the profile stays on the tier-3 default descriptor, which is fine. This matches the existing "refreshable on demand" design; the button is just the on-demand refresh surfaced in the browser.

## 7. Save semantics and validation

The main Save handles only the cheap fields. Order the writes so a partial failure is safe and idempotent on retry:

1. Persist the cheap config fields (primaryFocus, contentVolume, forbiddenTerms, forbiddenTopics) via `updateContentProfile`.
2. Reconcile the enabled flag via `setContentEngineEnabled`, skip-no-op when the desired value equals the current value (the session 36 pattern).

`profile.js` already validates on write and throws `SchemaValidationError` with a populated `.errors[]`. The POST handler catches it and surfaces the field errors on the branded error page (or inline), rather than 500ing. This is the same validation the CLI relies on; the dashboard does not re-implement any of it.

## 8. Keep the CLI, and keep this operator-scoped

The `enable-content-engine.js` / `disable-content-engine.js` scripts stay. They remain a valid operator path, are useful for testing, and write the same file through the same functions. The dashboard is an additional caller, not a replacement.

When the agent-facing dashboard epic eventually ships (PROJECT_STATE 7.27.3), this provisioning card MUST stay operator-scoped and MUST NOT be exposed to agents. Exposing provision/enable to an agent recreates the exact free-enable failure mode the CLI gate was built to prevent (section 1). The agent-facing dashboard is a multi-tenant epic with its own identity and scoping boundary; Content Engine provisioning is an operator action that sits on the operator side of that boundary.

## 9. Blog-post auto-send is a separate future feature

The idea of the AI emailing the finished weekly blog post to the agent's list on the agent's behalf is a genuinely different feature, because it IS sending on the agent's behalf and therefore needs its own consent and review posture. It is out of scope here and parked, not touched by this build.

## 10. Testing

Follow the dashboard's exported-internals precedent (session 39): export the provision handler core and the config-save core so they can be tested hermetically, and mock `voiceExtract` at the contract boundary so no test makes a real Claude call. Break-the-fix on every new test file, with a positive confirmation the destructive edit actually applied before running. At minimum: provision-from-null writes the expected default profile; save reconciles the enabled flag and the cheap fields; an invalid field surfaces the validation error rather than a 500; the voice button calls `voiceExtract` and persists the string descriptor.

## 11. Suggested build order

Two commits, split by concern:

1. Provision + toggle + cheap config fields. Replace the session 36 "Not provisioned, run the CLI" hint with the provision view, and render the config view with the enabled toggle, primaryFocus, contentVolume, forbiddenTerms, forbiddenTopics. Wire Save to `updateContentProfile` + `setContentEngineEnabled`. Provisioning writes `'live'` and the tier-3 default.
2. Voice subsection. Read-only current descriptor, the samples/self-description textarea, and the dedicated Extract / refresh button running `voiceExtract`.

## 12. Recon items to confirm before locking implementation

1. The exact `src/content/profile.js` export surface and signatures (`buildDefaultContentProfile`, `writeContentProfile`, `updateContentProfile`, `setContentEngineEnabled`), and whether `buildDefaultContentProfile` takes an `opts` object for the field values or positional args.
2. The `voiceExtract` entry point: its exported function name, what it takes (raw samples vs. a self-description string vs. both), whether it writes the profile itself or returns a descriptor for the caller to persist, and its tier selection logic.
3. Where the current Content Engine toggle renders in `src/routes/dashboard.js` (the GET edit handler region that today branches on `readContentProfile` null vs. non-null) so the new card slots into the existing edit page cleanly.
4. Confirm `SYSTEM_DEFAULT_DESCRIPTOR` is what `buildDefaultContentProfile` already writes for a no-samples profile, so provisioning does not need to set it explicitly.
5. Whether the edit-page POST already round-trips through the branded `renderErrorPage` on validation failure, or whether that path needs adding for the new fields.

## 13. Open questions (not blocking the build)

- Should the config view show any read-only status derived from `contentState.json` (last batch sent, last angle menu), or is that a later addition. Leaning later; this build is provisioning and config only.
- Whether delivery fields (day / time / timezone) ever want to be operator-editable, or stay defaulted forever. No demand yet.

## 14. Summary of locked decisions

1. Provisioning moves to the operator dashboard; this is an ergonomics change, not a posture change. The operator remains the gate and the CLI's free-enable-prevention property is preserved because the surface stays operator-only.
2. One Content Engine card, two render states: no-profile shows a single Provision button; profile-exists shows the config view.
3. Provisioning writes defaults (primaryFocus `both`, contentVolume `max`, enabled `true`, mode `live`, tier-3 default voice) with no Claude call, so it is instant.
4. Config view exposes: enabled toggle, primaryFocus, contentVolume, forbiddenTerms, forbiddenTopics, and the voice subsection.
5. Shadow mode is dropped from the UI and always provisioned `live`; the dormant engine branch is left in place and its rip-out is parked.
6. Delivery fields and cadence are not exposed; delivery is defaulted, cadence is locked weekly.
7. Voice extraction runs on its own dedicated button (one Sonnet call), never on the main Save; tier-3 default is the fallback.
8. All writes reuse `profile.js` and `voiceExtract`; no write or validation logic is duplicated.
9. The CLI scripts stay as a second path writing the same file.
10. When the agent-facing dashboard ships, this card stays operator-scoped and is never exposed to agents.
11. Blog-post auto-send is a distinct future feature, parked.
12. Build in two commits (cheap fields first, voice subsection second); exported internals plus mocked `voiceExtract` for tests, break-the-fix on new files.
