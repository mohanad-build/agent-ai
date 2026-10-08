'use strict';

// Pure link and mailto builders for the daily brief's "Deals needing you"
// section (docs/designs/done-verb.md's commit-3 recon). No disk, no clock,
// no sending.

const { parseAddress } = require('./address');

// A deal opened before Drive folders existed has no driveFolderId at all;
// the renderer must omit the link rather than crash the brief on it.
function driveFolderUrl(driveFolderId) {
  if (driveFolderId === null || driveFolderId === undefined || driveFolderId === '') {
    return null;
  }
  return 'https://drive.google.com/drive/folders/' + encodeURIComponent(driveFolderId);
}

// In Ontario "35-19" is unit 35 at number 19; the unit prefix before the
// last hyphen is dropped so the search matches "35-19", "35- 19" and
// "Unit 35, 19" alike. A civic with no hyphen (most of them) is unchanged.
// A building range like "19-21" still matches on its own: Gmail search
// treats the hyphen as a separator, so "21 main" is found inside
// "19-21 Main". CIVIC_RE (/^(\d+(?:-\d+)*)\s*/, address.js) only ever
// admits a hyphen when digits follow it, so the "part after the last
// hyphen is empty" branch below is unreachable through parseAddress today
// -- kept because the caller contract asks for it, not because real data
// can trigger it.
function civicForSearch(civic) {
  const lastHyphenIndex = civic.lastIndexOf('-');
  if (lastHyphenIndex === -1) {
    return civic;
  }
  return civic.slice(lastHyphenIndex + 1).trim();
}

// Street number and street name only, from parseAddress's own civic/street
// fields -- never hand-rolled splitting of the address string. Subjects in
// the wild write the civic number every which way ("35-19 Wax Myrtle Way",
// "12 Main Street #4"); number plus name catches those where a full-address
// search would miss. Falls back to the full address, quoted, when
// parseAddress cannot produce both a civic number and a street name (no
// match at all, e.g. a rural "Lot 5 Concession Rd 3"), or when the civic
// has nothing left after dropping its unit prefix.
function gmailSearchQuery(address) {
  const parsed = parseAddress(address);
  if (!parsed || !parsed.civic || !parsed.street) {
    return `"${address}"`;
  }
  const civic = civicForSearch(parsed.civic);
  if (civic === '') {
    return `"${address}"`;
  }
  return `"${civic} ${parsed.street}"`;
}

// The URL shape lives here, in this one function: whether authuser opens
// the right account on an iPhone with several Gmail accounts signed in is
// unverified, and a live check may change this line.
function gmailSearchUrl(address, gmailAddress) {
  if (typeof gmailAddress !== 'string' || gmailAddress.trim() === '') {
    throw new Error('gmailSearchUrl: gmailAddress must be a non-empty string');
  }
  return 'https://mail.google.com/mail/?authuser=' + encodeURIComponent(gmailAddress)
    + '#search/' + encodeURIComponent(gmailSearchQuery(address));
}

// Straight to Mo, not through assistant@: a collapsed deal cannot be
// undone, so nothing on our side changes deal state from this link.
function fellThroughMailtoHref({ address, transactionId, operatorEmail }) {
  if (typeof address !== 'string' || address.trim() === '') {
    throw new Error('fellThroughMailtoHref: address must be a non-empty string');
  }
  if (typeof transactionId !== 'string' || transactionId.trim() === '') {
    throw new Error('fellThroughMailtoHref: transactionId must be a non-empty string');
  }
  if (typeof operatorEmail !== 'string' || operatorEmail.trim() === '') {
    throw new Error('fellThroughMailtoHref: operatorEmail must be a non-empty string');
  }

  const subject = `${address} fell through`;
  const body = `Deal: ${transactionId}\n\nAnything Mo should know: `;

  return `mailto:${operatorEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

module.exports = {
  driveFolderUrl,
  gmailSearchQuery,
  gmailSearchUrl,
  fellThroughMailtoHref,
};
