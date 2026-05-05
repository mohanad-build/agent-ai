// src/pendingQuestions.js
//
// Pure functions for parsing and serializing the pending-question queue stored
// in column M of the lead Sheet. No I/O, no side effects.

const ENTRY_SEPARATOR = ' || ';
const ENTRY_REGEX = /^\[Q(\d+)\]\s+(.+)$/;

// Parses the raw column M cell value into an array of { token, question }.
// Returns an empty array for empty/null/undefined input or if no entries match.
// Non-matching parts are silently skipped.
function parsePendingQuestions(cellValue) {
  if (!cellValue || typeof cellValue !== 'string' || cellValue.trim() === '') {
    return [];
  }
  const parts = cellValue.split(ENTRY_SEPARATOR);
  const entries = [];
  for (const part of parts) {
    const match = part.match(ENTRY_REGEX);
    if (match) {
      entries.push({ token: 'Q' + match[1], question: match[2] });
    }
  }
  return entries;
}

// Serializes an array of { token, question } objects back to a column M string.
// Returns "" for an empty array.
function serializePendingQuestions(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return '';
  }
  return entries.map((e) => `[${e.token}] ${e.question}`).join(ENTRY_SEPARATOR);
}

// Returns the first entry whose token matches (case-insensitive), or null.
function findEntryByToken(entries, token) {
  if (!Array.isArray(entries) || !token) return null;
  const normalized = token.toUpperCase();
  return entries.find((e) => e.token.toUpperCase() === normalized) || null;
}

// Returns a new array with the matching entry removed (case-insensitive).
// Does not mutate the input. Returns a copy if no match found.
function removeEntryByToken(entries, token) {
  if (!Array.isArray(entries)) return [];
  if (!token) return entries.slice();
  const normalized = token.toUpperCase();
  return entries.filter((e) => e.token.toUpperCase() !== normalized);
}

module.exports = {
  parsePendingQuestions,
  serializePendingQuestions,
  findEntryByToken,
  removeEntryByToken,
};
