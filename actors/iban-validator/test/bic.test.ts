import { describe, expect, it } from 'vitest';
import { checkBic } from '../src/lib/bic.js';

describe('checkBic', () => {
  it.each(['DEUTDEFF', 'DEUTDEFF500', 'ABNANL2A', 'BUKBGB22', 'NEDSZAJJ', 'CHASUS33XXX', 'COBADEFFXXX', 'AAAABBCC'])('%s is well-formed', (bic) => {
    expect(checkBic(bic)).toEqual({ bic, valid: true, reason: null });
  });

  it('normalises case and whitespace', () => {
    expect(checkBic(' deut de ff 500 ')).toEqual({ bic: 'DEUTDEFF500', valid: true, reason: null });
  });

  it('reports "not provided" as null, not as invalid', () => {
    for (const v of [undefined, null, '', '   ', '​']) expect(checkBic(v)).toEqual({ bic: null, valid: null, reason: null });
  });

  it.each(['DEUTDE', 'DEUTDEF', 'DEUTDEFF5', 'DEUTDEFF50', 'DEUTDEFF5000'])('%s has the wrong length', (bic) => {
    const r = checkBic(bic);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('8 or 11');
  });

  it.each([
    ['D3UTDEFF', /1-4/],
    ['DEUT1EFF', /5-6/],
    ['DEUTDE!F', /7-8/],
    ['DEUTDEFF5*0', /9-11/],
    ['12345678', /1-4/],
    ['DEUTDEFF-00', /9-11/],
  ])('%s is malformed (%s)', (bic, pattern) => {
    const r = checkBic(bic);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(pattern);
  });

  it('accepts digits in the location and branch parts', () => {
    expect(checkBic('ABCDDE12').valid).toBe(true);
    expect(checkBic('ABCDDE12123').valid).toBe(true);
  });

  it('never throws on odd input', () => {
    for (const v of ['😀', '\u0000', 'ＤＥＵＴＤＥＦＦ', 12345 as unknown as string]) expect(() => checkBic(v)).not.toThrow();
    expect(checkBic('ＤＥＵＴＤＥＦＦ').valid).toBe(true); // NFKC: full-width -> ASCII
  });
});
