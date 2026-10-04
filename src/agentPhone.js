// src/agentPhone.js
//
// Validates and normalizes a North American phone number entered on a form
// (onboarding, dashboard edit) into E.164 ("+1" plus 10 digits). Never throws:
// a form path needs a reason to show the user, not an exception to catch.
//
// Not the same job as leadImport's normalizePhone, which handles lead phone
// numbers (which may be international) and does no validation.

'use strict';

const CHAR_PATTERN = /^\+?[0-9 ().-]*$/;

// One plain sentence is all the agent needs to fix the form; the reason
// code is for the server log only.
const PHONE_REFUSAL_MESSAGE =
  "That number doesn't look right. Enter your 10-digit mobile number, like 416-555-0123.";

function normalizeAgentPhone(raw) {
  if (raw === null || raw === undefined) {
    return { ok: false, reason: 'empty' };
  }
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'invalid_input' };
  }

  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'empty' };
  }
  if (!CHAR_PATTERN.test(trimmed)) {
    return { ok: false, reason: 'invalid_characters' };
  }

  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  let tenDigits;
  if (hasPlus) {
    if (digits.length !== 11 || digits[0] !== '1') {
      return { ok: false, reason: 'wrong_length' };
    }
    tenDigits = digits.slice(1);
  } else if (digits.length === 10) {
    tenDigits = digits;
  } else if (digits.length === 11 && digits[0] === '1') {
    tenDigits = digits.slice(1);
  } else {
    return { ok: false, reason: 'wrong_length' };
  }

  if (tenDigits[0] < '2' || tenDigits[0] > '9') {
    return { ok: false, reason: 'invalid_area_code' };
  }
  if (tenDigits[3] < '2' || tenDigits[3] > '9') {
    return { ok: false, reason: 'invalid_exchange' };
  }

  return { ok: true, phone: '+1' + tenDigits };
}

// Display formatting only, the reverse direction of normalizeAgentPhone's
// output shape. Anything not already "+1" plus 10 digits (a hand-edited
// agent file, a future non-NANP number) is returned unchanged rather than
// mangled.
function formatAgentPhone(phone) {
  const match = /^\+1(\d{10})$/.exec(phone);
  if (!match) return phone;
  const digits = match[1];
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

module.exports = { normalizeAgentPhone, PHONE_REFUSAL_MESSAGE, formatAgentPhone };
