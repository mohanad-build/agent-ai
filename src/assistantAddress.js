'use strict';

// The one place the assistant@ address lives. Both the lead-side CALLED tap
// (digest.js) and the TC taps (transactions/tapLinks.js, content/actionHandler.js)
// point at the same inbox, so the address belongs to neither folder alone.

const ASSISTANT_EMAIL = 'assistant@getklosed.ca';

module.exports = { ASSISTANT_EMAIL };
