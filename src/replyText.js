'use strict';

// Strips a reply's quoted history: lines starting with '>' (the quote
// marker Gmail, iOS Mail and Apple Mail prefix every quoted line with),
// and everything from the first 'on ... wrote:' line onward (the line
// those same clients insert directly above the quote, even when some of
// the quoted lines themselves aren't '>'-prefixed). Extracted unchanged
// from digest.js's Shadow Mode catch detection (computeJaccardOverlap's
// own normalize step), so both callers see identical behaviour.
//
// Does not handle Outlook's default reply format, which inserts a
// 'From: ... Sent: ... To: ... Subject: ...' header block with neither a
// '>' prefix nor a 'wrote:' line. Parked, see docs/STATE.md.
//
// Does not handle bottom-posting (new text typed below the quote): the
// 'wrote:' cut takes everything after it, including text that isn't
// actually quoted.
function stripQuotedReply(text) {
  const lines = String(text).split('\n').filter((line) => !line.trimStart().startsWith('>'));
  let stripped = lines.join('\n');
  const onWroteMatch = stripped.match(/on .{1,80} wrote:/i);
  if (onWroteMatch) stripped = stripped.slice(0, onWroteMatch.index);
  return stripped;
}

module.exports = { stripQuotedReply };
