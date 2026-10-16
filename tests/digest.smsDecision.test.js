'use strict';

const { smsDecision } = require('../src/digest');

// Baseline: every input false/clear, so each test only flips the one
// field it means to test. Mirrors a normal, fully-caught-up, quiet morning.
function makeInputs(overrides) {
  return {
    smsEnabled: true,
    notConfigured: false,
    dealsAlertsPresent: false,
    dryRun: false,
    operatorPhone: null,
    hasUrgentLead: false,
    leadsUnavailable: false,
    dealsCouldNotLoad: false,
    dealsUnreadable: false,
    ...overrides,
  };
}

// -- one test per reason ------------------------------------------------------

test('smsEnabled false -> disabled', () => {
  const result = smsDecision(makeInputs({ smsEnabled: false }));
  expect(result).toEqual({ send: false, reason: 'disabled' });
});

test('not_configured with nothing else to report -> not_configured', () => {
  const result = smsDecision(makeInputs({ notConfigured: true }));
  expect(result).toEqual({ send: false, reason: 'not_configured' });
});

test('dry run with no operatorPhone -> dry_run_no_phone', () => {
  const result = smsDecision(makeInputs({ dryRun: true, operatorPhone: null }));
  expect(result).toEqual({ send: false, reason: 'dry_run_no_phone' });
});

test('an urgent lead -> needs_agent', () => {
  const result = smsDecision(makeInputs({ hasUrgentLead: true }));
  expect(result).toEqual({ send: true, reason: 'needs_agent' });
});

test('leads unavailable, nothing else -> couldnt_check', () => {
  const result = smsDecision(makeInputs({ leadsUnavailable: true }));
  expect(result).toEqual({ send: true, reason: 'couldnt_check' });
});

test('every input clear -> quiet', () => {
  const result = smsDecision(makeInputs({}));
  expect(result).toEqual({ send: false, reason: 'quiet' });
});

// -- needs_agent: either signal alone is enough --------------------------------

test('urgent lead alone (no deal alert) -> sends', () => {
  const result = smsDecision(makeInputs({ hasUrgentLead: true, dealsAlertsPresent: false }));
  expect(result).toEqual({ send: true, reason: 'needs_agent' });
});

test('deal alert alone (no urgent lead) -> sends', () => {
  const result = smsDecision(makeInputs({ hasUrgentLead: false, dealsAlertsPresent: true }));
  expect(result).toEqual({ send: true, reason: 'needs_agent' });
});

// -- couldnt_check: each input alone is enough ----------------------------------

test('leadsUnavailable alone -> sends', () => {
  const result = smsDecision(makeInputs({ leadsUnavailable: true }));
  expect(result).toEqual({ send: true, reason: 'couldnt_check' });
});

test('dealsCouldNotLoad alone -> sends', () => {
  const result = smsDecision(makeInputs({ dealsCouldNotLoad: true }));
  expect(result).toEqual({ send: true, reason: 'couldnt_check' });
});

test('dealsUnreadable alone -> sends', () => {
  const result = smsDecision(makeInputs({ dealsUnreadable: true }));
  expect(result).toEqual({ send: true, reason: 'couldnt_check' });
});

// -- needs_agent wins over couldnt_check when both apply ------------------------

test('urgent lead and leadsUnavailable both true -> needs_agent, not couldnt_check', () => {
  const result = smsDecision(makeInputs({ hasUrgentLead: true, leadsUnavailable: true }));
  expect(result).toEqual({ send: true, reason: 'needs_agent' });
});

test('deal alert and dealsCouldNotLoad both true -> needs_agent, not couldnt_check', () => {
  const result = smsDecision(makeInputs({ dealsAlertsPresent: true, dealsCouldNotLoad: true }));
  expect(result).toEqual({ send: true, reason: 'needs_agent' });
});

// -- the suppressSmsForNotConfigured bug fix -------------------------------------
// Today's suppressSmsForNotConfigured only checks dealsAlertsPresent, so a
// not_configured agent whose deals failed to load or came back unreadable
// goes silent on SMS. These two pin the fix: not_configured alone is not
// enough to skip once there is a couldnt_check condition to report.

test('not_configured with deals that could not load -> couldnt_check, not not_configured', () => {
  const result = smsDecision(makeInputs({ notConfigured: true, dealsCouldNotLoad: true }));
  expect(result).toEqual({ send: true, reason: 'couldnt_check' });
});

test('not_configured with an unreadable deal file -> couldnt_check, not not_configured', () => {
  const result = smsDecision(makeInputs({ notConfigured: true, dealsUnreadable: true }));
  expect(result).toEqual({ send: true, reason: 'couldnt_check' });
});

test('not_configured with a deal alert present -> needs_agent, not not_configured', () => {
  const result = smsDecision(makeInputs({ notConfigured: true, dealsAlertsPresent: true }));
  expect(result).toEqual({ send: true, reason: 'needs_agent' });
});

// -- dry run precondition is checked after not_configured, before content -------

test('dry run with no operatorPhone, even with an urgent lead -> dry_run_no_phone wins', () => {
  const result = smsDecision(makeInputs({ dryRun: true, operatorPhone: null, hasUrgentLead: true }));
  expect(result).toEqual({ send: false, reason: 'dry_run_no_phone' });
});

test('dry run with an operatorPhone set -> falls through to content, quiet here', () => {
  const result = smsDecision(makeInputs({ dryRun: true, operatorPhone: '+15555550100' }));
  expect(result).toEqual({ send: false, reason: 'quiet' });
});
