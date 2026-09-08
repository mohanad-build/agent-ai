'use strict';

// The canonical agent-config filename filter, and the id listing built on
// it. Previously reimplemented independently in src/index.js,
// src/routes/dashboard.js, src/digest.js and inlined again in
// src/agentConfig.js's findAgentByPhone -- four copies drifting apart
// instead of one. Every caller imports THIS module; none of index.js,
// dashboard.js or digest.js re-exports it as a second path to the same
// thing, the same precedent session 66 set for parseRecipientList.
//
// Requires as little as possible: fs and storagePaths, nothing that could
// ever create a require cycle with a caller. index.js requires digest.js
// (see digest.js's own header), so anything both of them need has to live
// somewhere neither of them is on the other end of -- this file requires
// neither.

const fs = require('fs');
const { getStorageRoot } = require('./storagePaths');

// <agentId>.json, agentId restricted to lowercase alphanumerics and
// hyphens. Anchored on BOTH ends, and that is a real incident, not style:
// an unanchored `f.endsWith('.json')` accepts agents/<id>.contentProfile.json,
// <id>.contentState.json and <id>.state.json -- real companion files sitting
// in the storage root today, saved only by a downstream isActive check --
// and would equally adopt a crash-orphaned <id>.json.tmp or legacy
// <id>.tmp.json as a phantom agent holding a live copy of an encrypted
// googleRefreshToken. That is session 39's phantom-agent bug arriving by a
// new route.
const AGENT_ID_REGEX = /^[a-z0-9-]+\.json$/;

// Files in the storage root that match the regex but are not real agents.
const AGENT_FILE_BLOCKLIST = new Set(['example.json', '.gitkeep']);

// Regex AND blocklist, as one predicate: every real caller needs both
// checks together. agentConfig.js's findAgentByPhone used to apply only the
// regex, which is exactly the kind of partial application that made four
// copies of "the same" filter behave differently.
function isAgentConfigFilename(filename) {
  return AGENT_ID_REGEX.test(filename) && !AGENT_FILE_BLOCKLIST.has(filename);
}

// process.env.AGENT_ID is a scoping override -- run against one agent only,
// useful for debugging without touching every other agent's data on the
// same machine. Honoured HERE, unconditionally, rather than left to each
// caller to remember: a scoping flag that only some code paths honour is
// not a flag, it is a trap. It used to be silently ignored by
// tokenMigration.js specifically, which walks every agent's credentials --
// exactly the path where "the one agent I'm debugging" instead of "every
// agent on this machine" matters most.
function discoverAgentIds(opts = {}) {
  if (process.env.AGENT_ID) {
    return [process.env.AGENT_ID];
  }
  const baseDir = (opts && opts.baseDir) || getStorageRoot();
  if (!fs.existsSync(baseDir)) return [];
  return fs
    .readdirSync(baseDir)
    .filter(isAgentConfigFilename)
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

module.exports = {
  AGENT_ID_REGEX,
  AGENT_FILE_BLOCKLIST,
  isAgentConfigFilename,
  discoverAgentIds,
};
