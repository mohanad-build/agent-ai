'use strict';

// The one place Mo's own contact address lives. Both the lead-side CONFIRM
// reply (content/actionHandler.js) and the daily brief's fell-through link
// fallback (digest.js, when an agent's operator record cannot be read)
// point at the same address, so it belongs to neither folder alone.

const OPERATOR_CONTACT_EMAIL = 'mohanad@getklosed.ca';

module.exports = { OPERATOR_CONTACT_EMAIL };
