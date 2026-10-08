'use strict';

const {
  TC_CLAIM_RE,
  parseTcCommand,
  catalogItemLabel,
  buildDoneSubject,
  buildReceiptSubject,
  buildUndoSubject,
  buildDoneMailtoHref,
  buildReceiptMailtoHref,
  buildUndoMailtoHref,
} = require('../src/transactions/tapLinks');
const { CATALOG } = require('../src/transactions/rules');
const { ASSISTANT_EMAIL } = require('../src/assistantAddress');

const TXN_ID = 'txn-20261001-aaaaaaaa';

function subjectFromHref(href) {
  const match = href.match(/\?subject=([^&]*)/);
  return decodeURIComponent(match[1]);
}

describe('builder exact literals', () => {
  it('buildDoneSubject', () => {
    expect(buildDoneSubject(TXN_ID, 'financing_condition')).toBe(`DONE ${TXN_ID} financing_condition`);
  });

  it('buildReceiptSubject', () => {
    expect(buildReceiptSubject(TXN_ID, 'brokerage_deposit_receipt_received')).toBe(`RECEIPT ${TXN_ID} brokerage_deposit_receipt_received`);
  });

  it('buildUndoSubject with one id', () => {
    expect(buildUndoSubject(TXN_ID, ['financing_condition'])).toBe(`UNDO ${TXN_ID} financing_condition`);
  });

  it('buildUndoSubject with several ids', () => {
    expect(buildUndoSubject(TXN_ID, ['a', 'b', 'c'])).toBe(`UNDO ${TXN_ID} a b c`);
  });

  it('buildDoneMailtoHref', () => {
    expect(buildDoneMailtoHref(TXN_ID, 'financing_condition'))
      .toBe(`mailto:${ASSISTANT_EMAIL}?subject=${encodeURIComponent(`DONE ${TXN_ID} financing_condition`)}`);
  });

  it('buildReceiptMailtoHref', () => {
    expect(buildReceiptMailtoHref(TXN_ID, 'brokerage_deposit_receipt_received'))
      .toBe(`mailto:${ASSISTANT_EMAIL}?subject=${encodeURIComponent(`RECEIPT ${TXN_ID} brokerage_deposit_receipt_received`)}`);
  });

  it('buildUndoMailtoHref', () => {
    expect(buildUndoMailtoHref(TXN_ID, ['a', 'b']))
      .toBe(`mailto:${ASSISTANT_EMAIL}?subject=${encodeURIComponent(`UNDO ${TXN_ID} a b`)}`);
  });
});

describe('round trip: parse(build(x)) === x', () => {
  it('DONE', () => {
    const subject = buildDoneSubject(TXN_ID, 'financing_condition');
    expect(parseTcCommand(subject)).toEqual({ verb: 'DONE', transactionId: TXN_ID, itemId: 'financing_condition' });
  });

  it('RECEIPT', () => {
    const subject = buildReceiptSubject(TXN_ID, 'brokerage_deposit_receipt_received');
    expect(parseTcCommand(subject)).toEqual({ verb: 'RECEIPT', transactionId: TXN_ID, receiptItemId: 'brokerage_deposit_receipt_received' });
  });

  it('UNDO with one id', () => {
    const subject = buildUndoSubject(TXN_ID, ['financing_condition']);
    expect(parseTcCommand(subject)).toEqual({ verb: 'UNDO', transactionId: TXN_ID, itemIds: ['financing_condition'] });
  });

  it('UNDO with two ids', () => {
    const subject = buildUndoSubject(TXN_ID, ['deposit_slip_received', 'deposit_forwarded_to_accounting']);
    expect(parseTcCommand(subject)).toEqual({
      verb: 'UNDO', transactionId: TXN_ID, itemIds: ['deposit_slip_received', 'deposit_forwarded_to_accounting'],
    });
  });

  it('UNDO with three ids', () => {
    const ids = ['deposit_slip_received', 'deposit_forwarded_to_accounting', 'brokerage_deposit_receipt_received'];
    const subject = buildUndoSubject(TXN_ID, ids);
    expect(parseTcCommand(subject)).toEqual({ verb: 'UNDO', transactionId: TXN_ID, itemIds: ids });
  });

  it('UNDO with a repeated id: the parser never dedups', () => {
    const ids = ['financing_condition', 'financing_condition'];
    const subject = buildUndoSubject(TXN_ID, ids);
    expect(parseTcCommand(subject)).toEqual({ verb: 'UNDO', transactionId: TXN_ID, itemIds: ids });
  });
});

describe('TC_CLAIM_RE', () => {
  it('matches each verb, case-insensitively', () => {
    expect(TC_CLAIM_RE.test('DONE txn-20261001-aaaaaaaa item')).toBe(true);
    expect(TC_CLAIM_RE.test('done txn-20261001-aaaaaaaa item')).toBe(true);
    expect(TC_CLAIM_RE.test('Receipt txn-20261001-aaaaaaaa item')).toBe(true);
    expect(TC_CLAIM_RE.test('undo txn-20261001-aaaaaaaa item')).toBe(true);
  });

  it('matches with leading whitespace', () => {
    expect(TC_CLAIM_RE.test('   DONE txn-20261001-aaaaaaaa item')).toBe(true);
  });

  it('does not match without txn- directly after the verb', () => {
    expect(TC_CLAIM_RE.test('Done with the showing')).toBe(false);
  });

  it('does not strip Re:/Fwd: -- a forwarded or replied subject is not claimed', () => {
    expect(TC_CLAIM_RE.test('Re: DONE txn-20261001-aaaaaaaa item')).toBe(false);
    expect(TC_CLAIM_RE.test('Fwd: DONE txn-20261001-aaaaaaaa item')).toBe(false);
  });

  it('does not match an unknown verb', () => {
    expect(TC_CLAIM_RE.test('DELETE txn-20261001-aaaaaaaa item')).toBe(false);
  });
});

describe('catalogItemLabel', () => {
  it('known id returns its label', () => {
    expect(catalogItemLabel('buyer_purchase', 'financing_condition')).toBe(
      'Financing condition cleared by waiver, notice of fulfilment, or amendment'
    );
  });

  it('unknown id returns the id itself, unchanged', () => {
    expect(catalogItemLabel('buyer_purchase', 'not_a_real_item')).toBe('not_a_real_item');
  });
});

// Amendment 2: every item id, in every type, round-trips through the
// subject builders and the parser, and through the mailto hrefs. Derived
// from the catalog, never hand-listed, so a future catalog item the parser
// cannot read back fails this test instead of failing silently on a real
// tap.
describe('catalog-wide round trip (amendment 2)', () => {
  const pairs = Object.entries(CATALOG).flatMap(([type, items]) => items.map((item) => [type, item.id]));

  test.each(pairs)('DONE: %s / %s round-trips through parseTcCommand', (type, itemId) => {
    const subject = buildDoneSubject(TXN_ID, itemId);
    expect(parseTcCommand(subject)).toEqual({ verb: 'DONE', transactionId: TXN_ID, itemId });
  });

  test.each(pairs)('RECEIPT: %s / %s round-trips through parseTcCommand', (type, itemId) => {
    const subject = buildReceiptSubject(TXN_ID, itemId);
    expect(parseTcCommand(subject)).toEqual({ verb: 'RECEIPT', transactionId: TXN_ID, receiptItemId: itemId });
  });

  test.each(pairs)('UNDO: %s / %s round-trips through parseTcCommand', (type, itemId) => {
    const subject = buildUndoSubject(TXN_ID, [itemId]);
    expect(parseTcCommand(subject)).toEqual({ verb: 'UNDO', transactionId: TXN_ID, itemIds: [itemId] });
  });

  test.each(pairs)('DONE: %s / %s round-trips through the mailto href', (type, itemId) => {
    const href = buildDoneMailtoHref(TXN_ID, itemId);
    const subject = subjectFromHref(href);
    expect(parseTcCommand(subject)).toEqual({ verb: 'DONE', transactionId: TXN_ID, itemId });
  });

  test.each(pairs)('RECEIPT: %s / %s round-trips through the mailto href', (type, itemId) => {
    const href = buildReceiptMailtoHref(TXN_ID, itemId);
    const subject = subjectFromHref(href);
    expect(parseTcCommand(subject)).toEqual({ verb: 'RECEIPT', transactionId: TXN_ID, receiptItemId: itemId });
  });

  test.each(pairs)('UNDO: %s / %s round-trips through the mailto href', (type, itemId) => {
    const href = buildUndoMailtoHref(TXN_ID, [itemId]);
    const subject = subjectFromHref(href);
    expect(parseTcCommand(subject)).toEqual({ verb: 'UNDO', transactionId: TXN_ID, itemIds: [itemId] });
  });
});
