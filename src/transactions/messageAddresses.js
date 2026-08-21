'use strict';

// Collects every non-agent participant address off a parsed Gmail message,
// for signal B (an address on the message belongs to this transaction) and
// related participant-discovery work. Pure: no store, no clock, no I/O.

const { parseRecipientList } = require('../recipientParsing');

// message.from is a raw header string - getSenderEmail (leadIntake.js) and
// extractEmailAddress (index.js) already read it raw for their own
// purposes, and this function must not move that. message.to/cc are
// already-parsed { address, name? } arrays, produced by parseGmailMessage.
//
// ownAddress is compared after trimming and lowercasing both sides:
// agentConfig.gmailAddress is stored raw with only .trim(), so the caller
// cannot be relied on to have normalised it.
//
// Dedupes by address, first occurrence wins for order. If the first
// occurrence has no name and a later occurrence does, the later name is
// kept - discarding it would manufacture the nameless-participant problem
// section 6.2 exists to work around.
function collectMessageAddresses(message, ownAddress) {
  const from = parseRecipientList(message?.from);
  const to = Array.isArray(message?.to) ? message.to : [];
  const cc = Array.isArray(message?.cc) ? message.cc : [];

  const own = String(ownAddress || '').trim().toLowerCase();

  const seen = new Map();
  const order = [];

  for (const entry of [...from, ...to, ...cc]) {
    const address = String(entry?.address || '').trim().toLowerCase();
    if (!address || address === own) continue;

    const existing = seen.get(address);
    if (!existing) {
      const record = { address };
      if (entry.name) record.name = entry.name;
      seen.set(address, record);
      order.push(address);
    } else if (!existing.name && entry.name) {
      existing.name = entry.name;
    }
  }

  return order.map((address) => seen.get(address));
}

module.exports = {
  collectMessageAddresses,
};
