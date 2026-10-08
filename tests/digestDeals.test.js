'use strict';

// Tried and abandoned: process.env.TZ = 'America/Toronto' at the top of
// this file, before any other code. It has no effect under Jest. V8
// resolves and caches the host timezone the first time any Date/Intl
// operation runs in the process, and Jest's own startup machinery touches
// Date before a test file's top-level code ever executes -- confirmed with
// --runInBand too, so it is not a worker-fork artifact. There is no way
// from inside a Jest test file's own code to change the effective timezone
// for the REST OF THIS PROCESS. See "weekday is computed from the calendar
// date..." below for the pin that actually works: a child process gets its
// own V8 instance, so TZ set in its spawn-time env is honoured from the
// start, before that child ever touches a Date.
const { execFileSync } = require('child_process');
const path = require('path');

const { renderDealsPlain, renderDealsHtml, _internal } = require('../src/digestDeals');
const { CONDITION_NAMES } = require('../src/transactions/rules/conditions');

const T = {
  buttonBackground:    '#1a1a1a',
  buttonTextColor:     '#ffffff',
  buttonBorderRadius:  '6px',
  buttonPadding:       '12px 20px',
  buttonFontWeight:    '600',
  fontStack:           '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  bodyTextColor:       '#1a1a1a',
  mutedTextColor:      '#666666',
  sectionDividerColor: '#e0e0e0',
  fontSize:            '16px',
};

const CTX = { gmailAddress: 'agent@gmail.com', operatorEmail: 'mohanad@getklosed.ca', T };
const TXN = 'txn-20261001-aaaaaaaa';

function collected(alerts, overrides = {}) {
  return { alerts, activeCount: overrides.activeCount ?? alerts.length, unreadable: overrides.unreadable ?? [] };
}

describe('renderDealsPlain: every kind (one alert, one deal block)', () => {
  it('condition_passed, daysPast 4 (N days ago)', () => {
    const alert = {
      kind: 'condition_passed', transactionId: TXN, address: '12 Main St', type: 'buyer_purchase',
      driveFolderId: 'folder-1', condition: 'financing', itemId: 'financing_condition', date: '2026-10-02', daysPast: 4,
    };
    expect(renderDealsPlain(collected([alert]), CTX)).toBe(
      '-- Deals needing you --\n\n'
      + '12 Main St\n'
      + "Financing condition passed 4 days ago, not marked waived or fulfilled.\n"
      + "If it wasn't waived in time, the deal may have ended. Check today.\n"
      + '→ Waived or fulfilled: mailto:assistant@getklosed.ca?subject=DONE%20txn-20261001-aaaaaaaa%20financing_condition\n'
      + '→ It fell through: mailto:mohanad@getklosed.ca?subject=12%20Main%20St%20fell%20through'
      + '&body=Deal%3A%20txn-20261001-aaaaaaaa%0A%0AAnything%20Mo%20should%20know%3A%20\n'
      + '→ Emails about 12 Main St: https://mail.google.com/mail/?authuser=agent%40gmail.com#search/%2212%20main%22\n'
      + '→ Drive folder: https://drive.google.com/drive/folders/folder-1'
    );
  });

  it('condition_passed, daysPast 1 (yesterday)', () => {
    const alert = {
      kind: 'condition_passed', transactionId: TXN, address: '12 Main St', type: 'buyer_purchase',
      driveFolderId: 'folder-1', condition: 'financing', itemId: 'financing_condition', date: '2026-10-05', daysPast: 1,
    };
    const result = renderDealsPlain(collected([alert]), CTX);
    expect(result).toContain('Financing condition passed yesterday, not marked waived or fulfilled.');
    expect(result).not.toContain('1 days ago');
    expect(result).not.toContain('1 day ago');
  });

  // Not a real alerts.js value (CONDITION_PASSED_DAYS_AFTER is [1, 4]), but
  // the boundary "yesterday" must not leak past: only exactly 1 reads as
  // "yesterday", everything else reads as "N days ago".
  it('condition_passed, daysPast 2: "2 days ago", never "yesterday"', () => {
    const alert = {
      kind: 'condition_passed', transactionId: TXN, address: '12 Main St', type: 'buyer_purchase',
      driveFolderId: 'folder-1', condition: 'financing', itemId: 'financing_condition', date: '2026-10-08', daysPast: 2,
    };
    const result = renderDealsPlain(collected([alert]), CTX);
    expect(result).toContain('Financing condition passed 2 days ago, not marked waived or fulfilled.');
    expect(result).not.toContain('yesterday');
  });

  it('condition_heads_up, daysUntil 2 (real-data value), weekday across a month boundary', () => {
    const alert = {
      kind: 'condition_heads_up', transactionId: TXN, address: '12 Main St', type: 'buyer_purchase',
      driveFolderId: 'folder-1', condition: 'inspection', itemId: 'inspection_condition', date: '2026-11-01', daysUntil: 2,
    };
    expect(renderDealsPlain(collected([alert]), CTX)).toBe(
      '-- Deals needing you --\n\n'
      + '12 Main St\n'
      + 'Inspection condition is due Sunday (in 2 days).\n'
      + '→ Waived or fulfilled: mailto:assistant@getklosed.ca?subject=DONE%20txn-20261001-aaaaaaaa%20inspection_condition\n'
      + '→ Emails about 12 Main St: https://mail.google.com/mail/?authuser=agent%40gmail.com#search/%2212%20main%22\n'
      + '→ Drive folder: https://drive.google.com/drive/folders/folder-1'
    );
  });

  it('deposit_overdue, daysPast 7, no Drive folder (driveFolderId null)', () => {
    const alert = {
      kind: 'deposit_overdue', transactionId: TXN, address: '12 Main St', type: 'buyer_purchase',
      driveFolderId: null, itemId: 'brokerage_deposit_receipt_received', stuckAt: 'deposit_obtained_from_client',
      date: '2026-10-03', daysPast: 7,
    };
    expect(renderDealsPlain(collected([alert]), CTX)).toBe(
      '-- Deals needing you --\n\n'
      + '12 Main St\n'
      + 'Deposit not confirmed, 7 days after acceptance. Waiting on: Deposit Obtained from Client.\n'
      + '→ Receipt in hand: mailto:assistant@getklosed.ca?subject=RECEIPT%20txn-20261001-aaaaaaaa%20brokerage_deposit_receipt_received\n'
      + '→ Deposit Obtained from Client: mailto:assistant@getklosed.ca?subject=DONE%20txn-20261001-aaaaaaaa%20deposit_obtained_from_client\n'
      + '→ Emails about 12 Main St: https://mail.google.com/mail/?authuser=agent%40gmail.com#search/%2212%20main%22'
    );
  });

  it('additional_deposit_overdue, daysPast 1 (day agreement)', () => {
    const alert = {
      kind: 'additional_deposit_overdue', transactionId: TXN, address: '12 Main St', type: 'seller_sale',
      driveFolderId: 'folder-1', itemId: 'additional_deposit_receipt_issued', date: '2026-10-09', daysPast: 1,
    };
    expect(renderDealsPlain(collected([alert]), CTX)).toBe(
      '-- Deals needing you --\n\n'
      + '12 Main St\n'
      + 'Additional deposit is 1 day overdue.\n'
      + '→ Deposit received: mailto:assistant@getklosed.ca?subject=DONE%20txn-20261001-aaaaaaaa%20additional_deposit_receipt_issued\n'
      + '→ Emails about 12 Main St: https://mail.google.com/mail/?authuser=agent%40gmail.com#search/%2212%20main%22\n'
      + '→ Drive folder: https://drive.google.com/drive/folders/folder-1'
    );
  });

  it('filing_failed: no tap at all, only the two context links', () => {
    const alert = {
      kind: 'filing_failed', transactionId: TXN, address: '34 Oak Ave', type: 'buyer_purchase',
      driveFolderId: 'folder-C', filingKey: 'key-1', filename: 'APS.pdf', threadId: 'thread-1',
      abandonedAt: '2026-10-10T05:00:00Z', lastError: 'too large',
    };
    expect(renderDealsPlain(collected([alert]), CTX)).toBe(
      '-- Deals needing you --\n\n'
      + '34 Oak Ave\n'
      + "A document (APS.pdf) couldn't be filed to Drive.\n"
      + '→ Emails about 34 Oak Ave: https://mail.google.com/mail/?authuser=agent%40gmail.com#search/%2234%20oak%22\n'
      + '→ Drive folder: https://drive.google.com/drive/folders/folder-C'
    );
  });
});

describe('renderDealsPlain: grouping by deal', () => {
  it('two alerts on one deal render as one block, address once, context links once', () => {
    const headsUp = {
      kind: 'additional_deposit_overdue', transactionId: TXN, address: '12 Main St', type: 'seller_sale',
      driveFolderId: 'folder-1', itemId: 'additional_deposit_receipt_issued', date: '2026-10-09', daysPast: 1,
    };
    const conditionHeadsUp = {
      kind: 'condition_heads_up', transactionId: TXN, address: '12 Main St', type: 'seller_sale',
      driveFolderId: 'folder-1', condition: 'financing', itemId: 'financing_condition', date: '2026-11-01', daysUntil: 2,
    };
    const result = renderDealsPlain(collected([headsUp, conditionHeadsUp]), CTX);
    expect(result).toBe(
      '-- Deals needing you --\n\n'
      + '12 Main St\n'
      + 'Additional deposit is 1 day overdue.\n'
      + '→ Deposit received: mailto:assistant@getklosed.ca?subject=DONE%20txn-20261001-aaaaaaaa%20additional_deposit_receipt_issued\n'
      + 'Financing condition is due Sunday (in 2 days).\n'
      + '→ Waived or fulfilled: mailto:assistant@getklosed.ca?subject=DONE%20txn-20261001-aaaaaaaa%20financing_condition\n'
      + '→ Emails about 12 Main St: https://mail.google.com/mail/?authuser=agent%40gmail.com#search/%2212%20main%22\n'
      + '→ Drive folder: https://drive.google.com/drive/folders/folder-1'
    );
    // The two context links appear exactly once, not once per alert.
    expect(result.match(/Emails about/g)).toHaveLength(1);
    expect(result.match(/Drive folder/g)).toHaveLength(1);
  });

  it("a deal's block position follows its FIRST alert, even when a less dangerous deal's alert sits between its own two", () => {
    // Input order: X's first alert, then Y's only alert, then X's second
    // alert. X must still render as ONE block, positioned where its first
    // alert was (ahead of Y), not split or reordered. X's address sorts
    // AFTER Y's alphabetically ('9 X St' > '2 Y St') on purpose: position
    // and alphabetical order must disagree here, or this test cannot tell
    // "ordered by first alert" apart from "ordered by address" at all.
    const x1 = {
      kind: 'condition_passed', transactionId: 'txn-x', address: '9 X St', type: 'seller_sale',
      driveFolderId: null, condition: 'financing', itemId: 'financing_condition', date: '2026-10-05', daysPast: 1,
    };
    const y1 = {
      kind: 'condition_heads_up', transactionId: 'txn-y', address: '2 Y St', type: 'buyer_purchase',
      driveFolderId: null, condition: 'inspection', itemId: 'inspection_condition', date: '2026-11-01', daysUntil: 2,
    };
    const x2 = {
      kind: 'additional_deposit_overdue', transactionId: 'txn-x', address: '9 X St', type: 'seller_sale',
      driveFolderId: null, itemId: 'additional_deposit_receipt_issued', date: '2026-10-09', daysPast: 1,
    };

    const result = renderDealsPlain(collected([x1, y1, x2], { activeCount: 2 }), CTX);
    expect(result).toBe(
      '-- Deals needing you --\n\n'
      + '9 X St\n'
      + "Financing condition passed yesterday, not marked waived or fulfilled.\n"
      + "If it wasn't waived in time, the deal may have ended. Check today.\n"
      + '→ Waived or fulfilled: mailto:assistant@getklosed.ca?subject=DONE%20txn-x%20financing_condition\n'
      + '→ It fell through: mailto:mohanad@getklosed.ca?subject=9%20X%20St%20fell%20through'
      + '&body=Deal%3A%20txn-x%0A%0AAnything%20Mo%20should%20know%3A%20\n'
      + 'Additional deposit is 1 day overdue.\n'
      + '→ Deposit received: mailto:assistant@getklosed.ca?subject=DONE%20txn-x%20additional_deposit_receipt_issued\n'
      + '→ Emails about 9 X St: https://mail.google.com/mail/?authuser=agent%40gmail.com#search/%229%20x%22\n\n'
      + '2 Y St\n'
      + 'Inspection condition is due Sunday (in 2 days).\n'
      + '→ Waived or fulfilled: mailto:assistant@getklosed.ca?subject=DONE%20txn-y%20inspection_condition\n'
      + '→ Emails about 2 Y St: https://mail.google.com/mail/?authuser=agent%40gmail.com#search/%222%20y%22'
    );
  });
});

// A fresh child process gets its own V8 instance, so TZ set in its
// spawn-time env is honoured before that process ever touches a Date --
// unlike reassigning process.env.TZ in this (the parent) process, which
// does nothing (see the note at the top of this file). Pinning TZ to a
// non-UTC zone this way makes the assertion below deterministic regardless
// of whatever timezone the machine running `npx jest` happens to have.
function renderHeadsUpInChildProcess(tz) {
  const digestDealsPath = JSON.stringify(path.join(__dirname, '..', 'src', 'digestDeals.js'));
  const script = `
    const { renderDealsPlain } = require(${digestDealsPath});
    const alert = {
      kind: 'condition_heads_up', transactionId: 'txn-20261001-aaaaaaaa', address: '12 Main St', type: 'buyer_purchase',
      driveFolderId: null, condition: 'inspection', itemId: 'inspection_condition', date: '2026-11-01', daysUntil: 2,
    };
    const ctx = { gmailAddress: 'agent@gmail.com', operatorEmail: 'mohanad@getklosed.ca', T: ${JSON.stringify(T)} };
    process.stdout.write(renderDealsPlain({ alerts: [alert], activeCount: 1, unreadable: [] }, ctx));
  `;
  return execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
}

describe('weekday is computed from the calendar date, not the machine\'s local time', () => {
  // America/Toronto specifically, not just any non-UTC zone: a date-only
  // ISO string parses as UTC midnight, and a local time BEHIND UTC is what
  // rolls that instant back onto the previous calendar day (a local time
  // ahead of UTC only pushes forward within the same day, with no
  // rollover, so it could never expose this particular regression).
  it('reads as Sunday even when the process is pinned to America/Toronto (UTC-4/5)', () => {
    const output = renderHeadsUpInChildProcess('America/Toronto');
    expect(output).toContain('Inspection condition is due Sunday (in 2 days).');
  });
});

// Derived from rules/conditions.js's own closed list, never hand-listed:
// a condition name added there later is swept by this describe block
// automatically, with no edit needed here.
describe('condition name sweep (derived from the closed list)', () => {
  it('every override key is a member of the closed condition list', () => {
    Object.keys(_internal.CONDITION_DISPLAY_OVERRIDES).forEach((key) => {
      expect(CONDITION_NAMES).toContain(key);
    });
  });

  // The "no underscore" sweep below cannot catch this override being
  // deleted: condition.replace(/_/g, ' ') alone already turns well_septic
  // into "well septic", underscore-free either way. Only the specific
  // wording tells the two apart, so it needs its own hand-written literal,
  // not one derived from CONDITION_DISPLAY_OVERRIDES itself (deriving the
  // expected text from the same map the mutation deletes a key from would
  // leave nothing to check once the key is gone).
  it('well_septic specifically reads "well and septic", matching the catalog label\'s own wording', () => {
    const content = _internal.rowContent(
      { kind: 'condition_passed', transactionId: TXN, address: '12 Main St', condition: 'well_septic', itemId: 'dummy_item', date: '2026-10-05', daysPast: 1 },
      CTX
    );
    expect(content.textLines[0]).toContain('and septic condition passed');
  });

  test.each(CONDITION_NAMES)('condition_passed for "%s" has no underscore in its rendered text', (condition) => {
    const content = _internal.rowContent(
      { kind: 'condition_passed', transactionId: TXN, address: '12 Main St', condition, itemId: 'dummy_item', date: '2026-10-05', daysPast: 1 },
      CTX
    );
    expect(content.textLines.join(' ')).not.toMatch(/_/);
  });

  test.each(CONDITION_NAMES)('condition_heads_up for "%s" has no underscore in its rendered text', (condition) => {
    const content = _internal.rowContent(
      { kind: 'condition_heads_up', transactionId: TXN, address: '12 Main St', condition, itemId: 'dummy_item', date: '2026-11-01', daysUntil: 2 },
      CTX
    );
    expect(content.textLines.join(' ')).not.toMatch(/_/);
  });
});

describe('renderDealsPlain: unit', () => {
  it('shows ", unit <unit>" on the address line, but the Emails link omits it', () => {
    const alert = {
      kind: 'additional_deposit_overdue', transactionId: TXN, address: '19 Wax Myrtle Way', unit: '35', type: 'seller_sale',
      driveFolderId: 'folder-1', itemId: 'additional_deposit_receipt_issued', date: '2026-10-08', daysPast: 2,
    };
    expect(renderDealsPlain(collected([alert]), CTX)).toBe(
      '-- Deals needing you --\n\n'
      + '19 Wax Myrtle Way, unit 35\n'
      + 'Additional deposit is 2 days overdue.\n'
      + '→ Deposit received: mailto:assistant@getklosed.ca?subject=DONE%20txn-20261001-aaaaaaaa%20additional_deposit_receipt_issued\n'
      + '→ Emails about 19 Wax Myrtle Way: https://mail.google.com/mail/?authuser=agent%40gmail.com#search/%2219%20wax%20myrtle%22\n'
      + '→ Drive folder: https://drive.google.com/drive/folders/folder-1'
    );
  });
});

describe('renderDealsPlain: quiet line and unreadable', () => {
  it('quiet line shown when alerts is empty and activeCount > 0', () => {
    expect(renderDealsPlain(collected([], { activeCount: 3 }), CTX)).toBe(
      '-- Deals needing you --\n\nDeals: 3 active, nothing needs you today.'
    );
  });

  it('quiet line not shown when alerts is non-empty, even if activeCount is also > 0', () => {
    const alert = {
      kind: 'additional_deposit_overdue', transactionId: TXN, address: '12 Main St', type: 'seller_sale',
      driveFolderId: null, itemId: 'additional_deposit_receipt_issued', date: '2026-10-09', daysPast: 1,
    };
    const result = renderDealsPlain(collected([alert], { activeCount: 5 }), CTX);
    expect(result).not.toContain('nothing needs you today');
  });

  it('unreadable, singular', () => {
    expect(renderDealsPlain(collected([], { activeCount: 0, unreadable: [{ transactionId: 'x', error: 'e' }] }), CTX)).toBe(
      "-- Deals needing you --\n\nOne of your deal files couldn't be read this morning. Mo has been told."
    );
  });

  it('unreadable, plural', () => {
    const unreadable = [{ transactionId: 'x', error: 'e' }, { transactionId: 'y', error: 'f' }];
    expect(renderDealsPlain(collected([], { activeCount: 0, unreadable }), CTX)).toBe(
      "-- Deals needing you --\n\n2 of your deal files couldn't be read this morning. Mo has been told."
    );
  });

  it('quiet line and unreadable line are separated by a blank line, and neither names the file or the error', () => {
    const unreadable = [{ transactionId: 'x', error: 'some disk error message' }];
    const result = renderDealsPlain(collected([], { activeCount: 2, unreadable }), CTX);
    expect(result).toBe(
      '-- Deals needing you --\n\n'
      + "Deals: 2 active, nothing needs you today.\n\n"
      + "One of your deal files couldn't be read this morning. Mo has been told."
    );
    expect(result).not.toContain('x');
    expect(result).not.toContain('some disk error message');
  });

  it('alerts plus unreadable together: deal block first, blank line, then the unreadable line', () => {
    const alert = {
      kind: 'additional_deposit_overdue', transactionId: TXN, address: '12 Main St', type: 'seller_sale',
      driveFolderId: null, itemId: 'additional_deposit_receipt_issued', date: '2026-10-09', daysPast: 1,
    };
    const result = renderDealsPlain(collected([alert], { activeCount: 1, unreadable: [{ transactionId: 'x', error: 'e' }] }), CTX);
    expect(result).toBe(
      '-- Deals needing you --\n\n'
      + '12 Main St\n'
      + 'Additional deposit is 1 day overdue.\n'
      + '→ Deposit received: mailto:assistant@getklosed.ca?subject=DONE%20txn-20261001-aaaaaaaa%20additional_deposit_receipt_issued\n'
      + '→ Emails about 12 Main St: https://mail.google.com/mail/?authuser=agent%40gmail.com#search/%2212%20main%22\n\n'
      + "One of your deal files couldn't be read this morning. Mo has been told."
    );
  });

  it('the empty case returns the empty string', () => {
    expect(renderDealsPlain(collected([], { activeCount: 0, unreadable: [] }), CTX)).toBe('');
  });
});

describe('renderDealsHtml', () => {
  it('escapes an address and a filename containing <, & and a quote; the address is a bold line at the top of the block', () => {
    const alert = {
      kind: 'filing_failed', transactionId: TXN, address: '12 Main St & Co <Unit>', type: 'buyer_purchase',
      driveFolderId: null, filingKey: 'k', filename: 'APS <v2> & "final".pdf', threadId: 't', abandonedAt: 'x', lastError: 'y',
    };
    expect(renderDealsHtml(collected([alert]), CTX)).toBe(
      '<div style="margin-top:24px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #e0e0e0;'
      + 'font-weight:600;color:#1a1a1a;">Deals needing you</div>'
      + '<div style="margin-bottom:16px;">'
      + '<div style="font-weight:600;">12 Main St &amp; Co &lt;Unit&gt;</div>'
      + '<div>A document (APS &lt;v2&gt; &amp; &quot;final&quot;.pdf) couldn&#39;t be filed to Drive.</div>'
      + '<div style="margin-top:4px;color:#666666;font-size:16px;">'
      + '<a href="https://mail.google.com/mail/?authuser=agent%40gmail.com#search/%2212%20main%20st%20co%20unit%22" style="color:#666666;">'
      + 'Emails about 12 Main St &amp; Co &lt;Unit&gt;</a></div></div>'
    );
  });

  it('primary renders as the existing button style', () => {
    const alert = {
      kind: 'additional_deposit_overdue', transactionId: TXN, address: '12 Main St', type: 'seller_sale',
      driveFolderId: null, itemId: 'additional_deposit_receipt_issued', date: '2026-10-09', daysPast: 1,
    };
    const html = renderDealsHtml(collected([alert]), CTX);
    expect(html).toContain(
      '<div style="margin-top:8px;"><a href="mailto:assistant@getklosed.ca?subject=DONE%20txn-20261001-aaaaaaaa%20additional_deposit_receipt_issued" '
      + 'style="display:inline-block;padding:12px 20px;background:#1a1a1a;color:#ffffff;border-radius:6px;'
      + 'font-weight:600;text-decoration:none;font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;'
      + 'font-size:16px;">Deposit received</a></div>'
    );
  });

  it('a per-alert secondary link and the once-per-deal context links (joined by " | ") each render as their own muted line', () => {
    const alert = {
      kind: 'deposit_overdue', transactionId: TXN, address: '12 Main St', type: 'buyer_purchase',
      driveFolderId: 'folder-1', itemId: 'brokerage_deposit_receipt_received', stuckAt: 'deposit_obtained_from_client',
      date: '2026-10-03', daysPast: 7,
    };
    const html = renderDealsHtml(collected([alert]), CTX);
    expect(html).toContain(
      '<div style="margin-top:4px;color:#666666;font-size:16px;">'
      + '<a href="mailto:assistant@getklosed.ca?subject=DONE%20txn-20261001-aaaaaaaa%20deposit_obtained_from_client" style="color:#666666;">'
      + 'Deposit Obtained from Client</a></div>'
    );
    expect(html).toContain(
      '<div style="margin-top:4px;color:#666666;font-size:16px;">'
      + '<a href="https://mail.google.com/mail/?authuser=agent%40gmail.com#search/%2212%20main%22" style="color:#666666;">Emails about 12 Main St</a> | '
      + '<a href="https://drive.google.com/drive/folders/folder-1" style="color:#666666;">Drive folder</a></div>'
    );
  });

  it('the empty case returns the empty string', () => {
    expect(renderDealsHtml(collected([], { activeCount: 0, unreadable: [] }), CTX)).toBe('');
  });

  it('quiet line only', () => {
    expect(renderDealsHtml(collected([], { activeCount: 3 }), CTX)).toBe(
      '<div style="margin-top:24px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #e0e0e0;'
      + 'font-weight:600;color:#1a1a1a;">Deals needing you</div>'
      + '<div>Deals: 3 active, nothing needs you today.</div>'
    );
  });
});

// A realistic fixture crossing all five kinds, across three deals (one
// with a unit, one with no Drive folder), plus one unreadable file. Two of
// the three deals carry two alerts each, so this also exercises grouping.
// Already danger-ordered the way collectDealAlerts (commit 1) would hand
// it off: condition_passed, both deposit kinds, condition_heads_up,
// filing_failed.
function sampleCollected() {
  const depositOverdueA = {
    kind: 'deposit_overdue', transactionId: 'txn-20261001-aaaaaaaa', address: '19 Wax Myrtle Way', unit: '35',
    type: 'buyer_purchase', driveFolderId: 'folder-A', itemId: 'brokerage_deposit_receipt_received',
    stuckAt: 'deposit_obtained_from_client', date: '2026-10-03', daysPast: 7,
  };
  const headsUpA = {
    kind: 'condition_heads_up', transactionId: 'txn-20261001-aaaaaaaa', address: '19 Wax Myrtle Way', unit: '35',
    type: 'buyer_purchase', driveFolderId: 'folder-A', condition: 'inspection', itemId: 'inspection_condition',
    date: '2026-11-01', daysUntil: 2,
  };
  const conditionPassedB = {
    kind: 'condition_passed', transactionId: 'txn-20261001-bbbbbbbb', address: '12 Main St', type: 'seller_sale',
    driveFolderId: null, condition: 'status_certificate', itemId: 'status_certificate_review', date: '2026-10-06', daysPast: 4,
  };
  const additionalOverdueB = {
    kind: 'additional_deposit_overdue', transactionId: 'txn-20261001-bbbbbbbb', address: '12 Main St', type: 'seller_sale',
    driveFolderId: null, itemId: 'additional_deposit_receipt_issued', date: '2026-10-08', daysPast: 2,
  };
  const filingFailedC = {
    kind: 'filing_failed', transactionId: 'txn-20261001-cccccccc', address: '34 Oak Ave', type: 'buyer_purchase',
    driveFolderId: 'folder-C', filingKey: 'key-1', filename: 'APS.pdf', threadId: 'thread-1',
    abandonedAt: '2026-10-10T05:00:00Z', lastError: 'too large',
  };

  return {
    alerts: [conditionPassedB, depositOverdueA, additionalOverdueB, headsUpA, filingFailedC],
    activeCount: 4,
    unreadable: [{ transactionId: 'txn-20261001-dddddddd', error: 'SyntaxError: Unexpected token', stage: 'read' }],
  };
}

describe('sample fixture: every kind, three deals (two of them two-alert blocks), one unreadable file', () => {
  it('plaintext matches the hand-verified sample', () => {
    expect(renderDealsPlain(sampleCollected(), CTX)).toBe(
      '-- Deals needing you --\n\n'
      + '12 Main St\n'
      + 'Status certificate condition passed 4 days ago, not marked waived or fulfilled.\n'
      + "If it wasn't waived in time, the deal may have ended. Check today.\n"
      + '→ Waived or fulfilled: mailto:assistant@getklosed.ca?subject=DONE%20txn-20261001-bbbbbbbb%20status_certificate_review\n'
      + '→ It fell through: mailto:mohanad@getklosed.ca?subject=12%20Main%20St%20fell%20through'
      + '&body=Deal%3A%20txn-20261001-bbbbbbbb%0A%0AAnything%20Mo%20should%20know%3A%20\n'
      + 'Additional deposit is 2 days overdue.\n'
      + '→ Deposit received: mailto:assistant@getklosed.ca?subject=DONE%20txn-20261001-bbbbbbbb%20additional_deposit_receipt_issued\n'
      + '→ Emails about 12 Main St: https://mail.google.com/mail/?authuser=agent%40gmail.com#search/%2212%20main%22\n\n'
      + '19 Wax Myrtle Way, unit 35\n'
      + 'Deposit not confirmed, 7 days after acceptance. Waiting on: Deposit Obtained from Client.\n'
      + '→ Receipt in hand: mailto:assistant@getklosed.ca?subject=RECEIPT%20txn-20261001-aaaaaaaa%20brokerage_deposit_receipt_received\n'
      + '→ Deposit Obtained from Client: mailto:assistant@getklosed.ca?subject=DONE%20txn-20261001-aaaaaaaa%20deposit_obtained_from_client\n'
      + 'Inspection condition is due Sunday (in 2 days).\n'
      + '→ Waived or fulfilled: mailto:assistant@getklosed.ca?subject=DONE%20txn-20261001-aaaaaaaa%20inspection_condition\n'
      + '→ Emails about 19 Wax Myrtle Way: https://mail.google.com/mail/?authuser=agent%40gmail.com#search/%2219%20wax%20myrtle%22\n'
      + '→ Drive folder: https://drive.google.com/drive/folders/folder-A\n\n'
      + '34 Oak Ave\n'
      + "A document (APS.pdf) couldn't be filed to Drive.\n"
      + '→ Emails about 34 Oak Ave: https://mail.google.com/mail/?authuser=agent%40gmail.com#search/%2234%20oak%22\n'
      + '→ Drive folder: https://drive.google.com/drive/folders/folder-C\n\n'
      + "One of your deal files couldn't be read this morning. Mo has been told."
    );
  });

  it('html round-trips as three deal blocks (not five alert rows), one unreadable line, no file name or error leaked', () => {
    const html = renderDealsHtml(sampleCollected(), CTX);
    expect(html).toContain('Deals needing you');
    expect(html).not.toContain('txn-20261001-dddddddd');
    expect(html).not.toContain('SyntaxError');
    const blockCount = (html.match(/margin-bottom:16px;/g) || []).length;
    expect(blockCount).toBe(3);
  });
});
