'use strict';

// AGENT_ID is a scoping override honoured by src/agentDiscovery.js's
// discoverAgentIds -- and, transitively, by every one of its four callers
// (index.js, dashboard.js, tokenMigration.js, and anything requiring them).
// .env sets AGENT_ID=mo-test for local dev convenience, so any test that
// exercises agent discovery without expecting that value leaks a real
// developer's local override into its result.
//
// A single per-file `delete process.env.AGENT_ID` in beforeEach is not
// enough on its own: dotenv.config() is called at the top of five files
// (server.js, webhook.js, index.js, dashboard.js, onboard.js) and does not
// override an already-set variable, only fills in an unset one. A plain
// setupFiles clear runs BEFORE the test file's own top-level requires, so a
// test file that requires any of those five re-populates AGENT_ID from
// .env moments later, undoing the clear before a single test runs
// (confirmed empirically, not assumed). setupFilesAfterEnv is what makes
// this work: it registers this beforeEach globally, and Jest runs all
// beforeEach hooks -- global ones first, then the test file's own -- only
// after the whole test file (including its top-level requires) has already
// loaded, so this always runs after any dotenv reload, not before it.
//
// This leak was survivable back when exactly one module (index.js) honoured
// AGENT_ID. Four do now, and any of their tests -- present or future -- can
// hit it without knowing this variable exists. A global beforeEach is not a
// rule a future test author has to remember; a per-file delete is.
beforeEach(() => {
  delete process.env.AGENT_ID;
});
