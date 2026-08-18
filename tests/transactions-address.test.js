'use strict';

const { parseAddress } = require('../src/transactions/address');

const { TABLE } = require('../src/transactions/address')._internal;

describe('parseAddress', () => {
  it('parses a bare number and street name with no type; streetType is absent, not undefined', () => {
    const result = parseAddress('14 Bonacres');
    expect(result.civic).toBe('14');
    expect(result.street).toBe('bonacres');
    expect('streetType' in result).toBe(false);
  });

  it('collapses Rd, Rd. and Road onto one canonical street type', () => {
    expect(parseAddress('14 Bonacres Rd').streetType).toBe('road');
    expect(parseAddress('14 Bonacres Rd.').streetType).toBe('road');
    expect(parseAddress('14 Bonacres Road').streetType).toBe('road');
  });

  it('collapses Ave, Ave. and Avenue onto one canonical street type', () => {
    expect(parseAddress('14 Bonacres Ave').streetType).toBe('avenue');
    expect(parseAddress('14 Bonacres Ave.').streetType).toBe('avenue');
    expect(parseAddress('14 Bonacres Avenue').streetType).toBe('avenue');
  });

  it('collapses Dr and Drive onto one canonical street type', () => {
    expect(parseAddress('14 Bonacres Dr').streetType).toBe('drive');
    expect(parseAddress('14 Bonacres Drive').streetType).toBe('drive');
  });

  it('collapses Blvd and Boulevard onto one canonical street type', () => {
    expect(parseAddress('14 Bonacres Blvd').streetType).toBe('boulevard');
    expect(parseAddress('14 Bonacres Boulevard').streetType).toBe('boulevard');
  });

  it('reads a leading St as the Saint name prefix, not the Street type', () => {
    const result = parseAddress('14 St Clair Ave');
    expect(result.street).toContain('saint clair');
    expect(result.streetType).toBe('avenue');
  });

  it('reads a trailing St as the Street type, not the Saint prefix', () => {
    const result = parseAddress('14 Bonacres St');
    expect(result.streetType).toBe('street');
    expect(result.street).not.toContain('saint');
  });

  it('produces identical output for Mt and Mount', () => {
    const withMt = parseAddress('14 Mt Pleasant');
    const withMount = parseAddress('14 Mount Pleasant');
    expect(withMt).toEqual(withMount);
    expect(withMt.street).toBe('mount pleasant');
  });

  it('produces identical output for Ave E and Avenue East, differing from the W form', () => {
    const abbreviated = parseAddress('14 Lawrence Ave E');
    const spelled = parseAddress('14 Lawrence Avenue East');
    const west = parseAddress('14 Lawrence Ave W');

    expect(abbreviated).toEqual(spelled);
    expect(abbreviated.directional).toBe('e');
    expect(west.directional).toBe('w');
    expect(abbreviated).not.toEqual(west);
  });

  it('preserves a hyphenated civic range exactly, not split or numeric', () => {
    const result = parseAddress('14-16 Bonacres Rd');
    expect(result.civic).toBe('14-16');
  });

  it('reads a comma-separated trailing component as the city', () => {
    const result = parseAddress('14 Bonacres Rd, Markham');
    expect(result.city).toBe('markham');
  });

  it('discards a trailing province and postal code instead of returning them as city', () => {
    const result = parseAddress('14 Bonacres Rd, ON L3R 1A1');
    expect('city' in result).toBe(false);
  });

  it('returns null when the text has no civic number', () => {
    expect(parseAddress('Bonacres Road')).toBeNull();
  });

  it('throws for an empty string', () => {
    expect(() => parseAddress('')).toThrow('parseAddress: address must be a non-empty string');
  });

  it('throws for a non-string argument', () => {
    expect(() => parseAddress(42)).toThrow('parseAddress: address must be a non-empty string');
  });
});

describe('_internal.TABLE', () => {
  it('is frozen at every level, including the nested alias arrays', () => {
    expect(Object.isFrozen(TABLE)).toBe(true);
    expect(Object.isFrozen(TABLE.streetTypes)).toBe(true);
    expect(Object.isFrozen(TABLE.streetTypes.road)).toBe(true);
    expect(Object.isFrozen(TABLE.directionals)).toBe(true);
    expect(Object.isFrozen(TABLE.directionals.ne)).toBe(true);
    expect(Object.isFrozen(TABLE.namePrefixes)).toBe(true);
    expect(Object.isFrozen(TABLE.namePrefixes.saint)).toBe(true);
  });

  it('cannot be extended by push on a nested alias array', () => {
    expect(() => TABLE.streetTypes.road.push('rte')).toThrow();
    expect(TABLE.streetTypes.road).toEqual(['road', 'rd']);
  });
});
