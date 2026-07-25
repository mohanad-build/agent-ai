'use strict';

const { sanitiseNote } = require('./webhook');

const CALL_NOTE_LABEL = 'Notes from the call:';

// Extracts the agent's call note from an inbound CALLED-by-email body.
// Drops everything from the first signature/quoted-reply marker onward,
// then strips a leading CALL_NOTE_LABEL and runs the remainder through
// webhook's sanitiseNote for flattening/truncation.
function stripCallNote(rawBody) {
  if (!rawBody) return '';

  const lines = String(rawBody).split(/\r\n|\r|\n/);
  let cutIndex = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim().toLowerCase();
    if (
      /^--\s*$/.test(lines[i]) ||
      trimmed.startsWith('sent from my ') ||
      trimmed.startsWith('sent via ') ||
      trimmed.startsWith('get outlook')
    ) {
      cutIndex = i;
      break;
    }
  }

  const kept = lines.slice(0, cutIndex).join('\n');
  const withoutLabel = kept.replace(/^\s*notes from the call:\s*/i, '');

  return sanitiseNote(withoutLabel);
}

module.exports = { CALL_NOTE_LABEL, stripCallNote };
