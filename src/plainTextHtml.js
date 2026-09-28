'use strict';

// Mail from the assistant@ Workspace account has its text/plain part
// rewrapped near 70 characters in transit, whatever the encoding; an HTML
// part is not, measured live (7.57.4).
// Not reviewEmail's markdownToHtml: reply bodies include Claude-generated
// content the agent approves, which must render literally, and markdown
// would turn "- ", "*x*", "---" and links into formatting.
// Has its own escaper: production code does not import another module's
// _internal.

function escapeHtml(value) {
  const str = value == null ? '' : String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plainTextToHtml(text) {
  return escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>');
}

module.exports = { escapeHtml, plainTextToHtml };
