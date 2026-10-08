'use strict';

const {
  driveFolderUrl,
  gmailSearchQuery,
  gmailSearchUrl,
  fellThroughMailtoHref,
} = require('../src/transactions/dealLinks');

describe('driveFolderUrl', () => {
  it('a normal id', () => {
    expect(driveFolderUrl('folder-txn-1')).toBe('https://drive.google.com/drive/folders/folder-txn-1');
  });

  it('null, undefined and empty all return null', () => {
    expect(driveFolderUrl(null)).toBeNull();
    expect(driveFolderUrl(undefined)).toBeNull();
    expect(driveFolderUrl('')).toBeNull();
  });
});

describe('gmailSearchQuery', () => {
  it('a full address with a unit and a city: civic and street only, unit and city dropped', () => {
    expect(gmailSearchQuery('19 Wax Myrtle Way, Unit 35, Toronto, ON M3B 3K6')).toBe('"19 wax myrtle"');
  });

  it('a "unit-civic" hyphen (unit 35 at number 19): only the part after the last hyphen is kept', () => {
    expect(gmailSearchQuery('35-19 Wax Myrtle Way')).toBe('"19 wax myrtle"');
  });

  it('a building range survives on its own, since Gmail search treats the hyphen as a separator', () => {
    expect(gmailSearchQuery('19-21 Main St')).toBe('"21 main"');
  });

  it('a plain address: suffix dropped', () => {
    expect(gmailSearchQuery('12 Main St')).toBe('"12 main"');
  });

  // Known parser limitation, parked, not desired behaviour: the "#" unit
  // marker confuses parseAddress's own trailing-suffix detection (the "#"
  // normalizes to a space, so "street" is no longer the last token and
  // never gets recognized as a streetType), so "street" leaks into the
  // street field instead of being dropped. This asserts today's actual
  // output, not the ideal one; see address.js's own normalizedRemainder
  // comment for why.
  it('a "#" unit marker confuses the parser\'s own suffix detection: the parser\'s street field is used as-is, not re-split by this function', () => {
    expect(gmailSearchQuery('12 Main Street #4')).toBe('"12 main street 4"');
  });

  // No test for "the part after the last hyphen is empty": CIVIC_RE
  // (/^(\d+(?:-\d+)*)\s*/, address.js) only ever admits a hyphen into civic
  // when digits immediately follow it, so parseAddress can never return a
  // civic with a trailing hyphen. Checked by running it: '35- Main St' and
  // '35-Main St' both give civic '35' (no hyphen at all -- the dangling
  // hyphen is dropped before civic is even captured), and '35-' / '35- '
  // both return null (parse failure, the full-address fallback branch
  // above already covers that). There is no input through this parser that
  // reaches gmailSearchQuery's empty-after-hyphen fallback, so that branch
  // is exercised by code reading alone, not by a test here.
  it('a rural address parseAddress cannot read at all: falls back to the full address, quoted', () => {
    expect(gmailSearchQuery('Lot 5 Concession Rd 3')).toBe('"Lot 5 Concession Rd 3"');
  });
});

describe('gmailSearchUrl', () => {
  it('an address with #, & and a comma, hitting the fallback: the whole query is percent-encoded', () => {
    expect(gmailSearchUrl('Rural Route #2, Lot 7 & 8', 'agent@gmail.com')).toBe(
      'https://mail.google.com/mail/?authuser=agent%40gmail.com#search/%22Rural%20Route%20%232%2C%20Lot%207%20%26%208%22'
    );
  });

  it('a gmailAddress with a +tag', () => {
    expect(gmailSearchUrl('Rural Route #2, Lot 7 & 8', 'agent+test@gmail.com')).toBe(
      'https://mail.google.com/mail/?authuser=agent%2Btest%40gmail.com#search/%22Rural%20Route%20%232%2C%20Lot%207%20%26%208%22'
    );
  });

  it('a bad gmailAddress throws', () => {
    expect(() => gmailSearchUrl('12 Main St', '')).toThrow('gmailSearchUrl: gmailAddress must be a non-empty string');
    expect(() => gmailSearchUrl('12 Main St', null)).toThrow('gmailSearchUrl: gmailAddress must be a non-empty string');
    expect(() => gmailSearchUrl('12 Main St', undefined)).toThrow('gmailSearchUrl: gmailAddress must be a non-empty string');
    expect(() => gmailSearchUrl('12 Main St', '   ')).toThrow('gmailSearchUrl: gmailAddress must be a non-empty string');
  });
});

describe('fellThroughMailtoHref', () => {
  const TXN_ID = 'txn-20261001-aaaaaaaa';
  const OPERATOR_EMAIL = 'mohanad@getklosed.ca';

  it('exact href', () => {
    const href = fellThroughMailtoHref({ address: '12 Main St', transactionId: TXN_ID, operatorEmail: OPERATOR_EMAIL });
    expect(href).toBe(
      'mailto:mohanad@getklosed.ca?subject=12%20Main%20St%20fell%20through'
      + '&body=Deal%3A%20txn-20261001-aaaaaaaa%0A%0AAnything%20Mo%20should%20know%3A%20'
    );
  });

  it('an address containing & and #', () => {
    const href = fellThroughMailtoHref({ address: '12 Main St #4 & Unit 5', transactionId: TXN_ID, operatorEmail: OPERATOR_EMAIL });
    expect(href).toBe(
      'mailto:mohanad@getklosed.ca?subject=12%20Main%20St%20%234%20%26%20Unit%205%20fell%20through'
      + '&body=Deal%3A%20txn-20261001-aaaaaaaa%0A%0AAnything%20Mo%20should%20know%3A%20'
    );
  });

  it('missing address throws', () => {
    expect(() => fellThroughMailtoHref({ transactionId: TXN_ID, operatorEmail: OPERATOR_EMAIL }))
      .toThrow('fellThroughMailtoHref: address must be a non-empty string');
  });

  it('missing transactionId throws', () => {
    expect(() => fellThroughMailtoHref({ address: '12 Main St', operatorEmail: OPERATOR_EMAIL }))
      .toThrow('fellThroughMailtoHref: transactionId must be a non-empty string');
  });

  it('missing operatorEmail throws', () => {
    expect(() => fellThroughMailtoHref({ address: '12 Main St', transactionId: TXN_ID }))
      .toThrow('fellThroughMailtoHref: operatorEmail must be a non-empty string');
  });

  it('decode round trip: decodeURIComponent of the subject and body gives back the exact intended text', () => {
    const address = '12 Main St #4 & Unit 5';
    const href = fellThroughMailtoHref({ address, transactionId: TXN_ID, operatorEmail: OPERATOR_EMAIL });

    const subjectMatch = href.match(/\?subject=([^&]*)&body=(.*)$/);
    const subject = decodeURIComponent(subjectMatch[1]);
    const body = decodeURIComponent(subjectMatch[2]);

    expect(subject).toBe(`${address} fell through`);
    expect(body).toBe(`Deal: ${TXN_ID}\n\nAnything Mo should know: `);
  });
});
