'use strict';

const { findAddressCandidates } = require('../src/transactions/addressScan');

const { TERMINATORS } = require('../src/transactions/addressScan')._internal;

describe('findAddressCandidates', () => {
  describe('real filenames', () => {
    it('finds exactly one candidate in a filename with an unrelated trailing number', () => {
      expect(
        findAddressCandidates(
          '14_Bonacres_-_Agreement_of_Purchase_and_Sale_-_Residential__16__copy.pdf'
        )
      ).toEqual([{ civic: '14', street: 'bonacres' }]);
    });

    it('produces no candidate with civic 282 (a bare civic number parses to null)', () => {
      const candidates = findAddressCandidates('1__DigiSign_Final_282.pdf');
      expect(candidates.filter((c) => c.civic === '282')).toEqual([]);
    });

    it('produces no candidate whose street is bonacres for an unrelated date/time filename', () => {
      const candidates = findAddressCandidates('Doc_-_Aug_19_2026_-_10-38_PM.pdf');
      expect(candidates.filter((c) => c.street === 'bonacres')).toEqual([]);
    });

    it('produces no candidate with civic 400 and street agreement (agreement terminates the window at position 2)', () => {
      const candidates = findAddressCandidates(
        '1_400_Agreement_to_Lease_-_Residential_-_PropTx-OREA__4_.pdf'
      );
      expect(candidates.filter((c) => c.civic === '400' && c.street === 'agreement')).toEqual([]);
    });
  });

  describe('prose', () => {
    it('finds one candidate in a sentence with document words on either side', () => {
      expect(findAddressCandidates('the offer on 14 Bonacres Rd is firm')).toEqual([
        { civic: '14', street: 'bonacres', streetType: 'road' },
      ]);
    });

    it('stops the window at "for", right after the directional', () => {
      expect(findAddressCandidates('please see 14 Lawrence Ave E for the signback')).toEqual([
        { civic: '14', street: 'lawrence', streetType: 'avenue', directional: 'e' },
      ]);
    });

    it('stops the window at a trailing unit word', () => {
      expect(findAddressCandidates('14 Bonacres Rd Unit 302')).toEqual([
        { civic: '14', street: 'bonacres', streetType: 'road' },
      ]);
    });

    it('takes a leading terminator word unconditionally as the first street token, for two addresses in one sentence', () => {
      expect(findAddressCandidates('showings at 14 The Queensway and 22 Main St')).toEqual([
        { civic: '14', street: 'the queensway' },
        { civic: '22', street: 'main', streetType: 'street' },
      ]);
    });

    it('preserves a hyphenated civic range as one token', () => {
      expect(findAddressCandidates('offer on 14-16 Bonacres Rd')).toEqual([
        { civic: '14-16', street: 'bonacres', streetType: 'road' },
      ]);
    });

    it('returns an empty array when no civic-shaped token exists', () => {
      expect(findAddressCandidates('nothing here')).toEqual([]);
    });

    it('discards a window that is just a civic number next to a lone stopword', () => {
      expect(findAddressCandidates('16 copy')).toEqual([]);
    });

    it('throws for an empty string, following address.js\'s assertion convention', () => {
      expect(() => findAddressCandidates('')).toThrow(
        'findAddressCandidates: text must be a non-empty string'
      );
    });
  });
});

describe('_internal.TERMINATORS', () => {
  it('is frozen at every level, including the nested word arrays', () => {
    expect(Object.isFrozen(TERMINATORS)).toBe(true);
    expect(Object.isFrozen(TERMINATORS.functionWords)).toBe(true);
    expect(Object.isFrozen(TERMINATORS.documentWords)).toBe(true);
    expect(Object.isFrozen(TERMINATORS.unitWords)).toBe(true);
  });

  it('cannot be extended by push on a nested word array', () => {
    expect(() => TERMINATORS.functionWords.push('nope')).toThrow();
    expect(TERMINATORS.functionWords).toContain('the');
  });

  it('has the exact function word membership given in the spec', () => {
    expect(TERMINATORS.functionWords).toEqual([
      'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in',
      'is', 'it', 'of', 'on', 'or', 'please', 're', 'see', 'the', 'this',
      'to', 'was', 'we', 'will', 'with', 'you', 'your',
    ]);
  });

  it('has the exact document word membership given in the spec', () => {
    expect(TERMINATORS.documentWords).toEqual([
      'accepted', 'addendum', 'agreement', 'amendment', 'aps', 'completed',
      'conditional', 'confirmation', 'copy', 'doc', 'document', 'executed',
      'final', 'firm', 'form', 'lease', 'notice', 'offer', 'release',
      'revised', 'scan', 'schedule', 'signback', 'signed', 'waiver',
    ]);
  });

  it('has the exact unit word membership given in the spec', () => {
    expect(TERMINATORS.unitWords).toEqual([
      'apartment', 'apt', 'basement', 'bsmt', 'floor', 'lower', 'main',
      'penthouse', 'ph', 'suite', 'unit', 'upper',
    ]);
  });
});
