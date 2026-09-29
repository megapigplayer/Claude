import { describe, expect, it } from 'vitest';
import { hasValidChecksum } from '../src/lib/checksum.js';
import { checkNineDigitNumber, COMPANY_PREFIX_HINTS } from '../src/lib/number.js';
import { luhnValid, mulberry32, randomValidId, withCheckDigit } from './helpers.js';

const id = (text: string, over: Partial<{ kind: 'id' | 'company'; rejectDummy: boolean; normalize: boolean }> = {}) =>
  checkNineDigitNumber(text, { kind: 'id', rejectDummy: true, normalize: true, ...over });

describe('valid IDs', () => {
  it('golden: 123456782 is valid, with the expected check digit in the details', () => {
    const r = id('123456782');
    expect(r).toMatchObject({
      valid: true,
      reasonCode: 'OK',
      normalized: '123456782',
      details: { checkDigit: 2, expectedCheckDigit: 2, paddedFrom: null, companyPrefix: null, companyPrefixHint: null },
    });
    expect(r.warnings).toEqual(['WELL_KNOWN_TEST_NUMBER']);
  });

  it.each(['034567891', '314159260', '271828188', '987654324', '135791358', '246802466', '000000018', '000000125', '000123455'])('%s is valid', (s) => {
    expect(luhnValid(s), 'fixture sanity').toBe(true);
    expect(id(s)).toMatchObject({ valid: true, normalized: s });
  });

  it('accepts spaces, dashes, dots and en dashes between digits', () => {
    for (const s of ['034 567 891', '034-567-891', '034.567.891', '0345 67891', ' 034567891 ']) {
      expect(id(s), s).toMatchObject({ valid: true, normalized: '034567891' });
    }
  });
});

describe('leading zeros dropped by a spreadsheet', () => {
  it('an 8-digit ID is zero-padded, then checked', () => {
    // 034567891 lost its leading zero: 34567891
    const r = id('34567891');
    expect(r).toMatchObject({ valid: true, normalized: '034567891', warnings: ['LEADING_ZEROS_RESTORED'] });
    expect(r.details).toMatchObject({ paddedFrom: 8 });
  });

  it.each([
    ['7 digits', '1000009', '001000009'],
    ['6 digits', '123455', '000123455'],
    ['5 digits', '12345', null],
  ])('%s: padded to 9', (_name, input, expected) => {
    const r = id(input);
    if (expected === null) {
      // 5 digits: also a sequential placeholder, and 000012345 has a different check digit
      expect(r.valid).toBe(false);
    } else {
      expect(r).toMatchObject({ valid: true, normalized: expected });
      expect(r.warnings).toContain('LEADING_ZEROS_RESTORED');
    }
  });

  it('an 8-digit number with a wrong check digit reports the check digit of the padded number', () => {
    const r = id('34567890');
    expect(r).toMatchObject({ valid: false, reasonCode: 'BAD_CHECKSUM' });
    expect(r.details).toMatchObject({ checkDigit: 0, expectedCheckDigit: 1, paddedFrom: 8 });
    expect(r.reason).toMatch(/requires? 1|require 1/);
  });

  it('strict mode (normalize = false) does not pad', () => {
    expect(id('34567891', { normalize: false })).toMatchObject({ valid: false, reasonCode: 'WRONG_LENGTH' });
    expect(id('034567891', { normalize: false })).toMatchObject({ valid: true });
  });
});

describe('invalid IDs', () => {
  it('golden: 123456789 fails the checksum and says which digit is expected', () => {
    const r = id('123456789');
    expect(r).toMatchObject({ valid: false, reasonCode: 'BAD_CHECKSUM', normalized: null });
    expect(r.details).toMatchObject({ checkDigit: 9, expectedCheckDigit: 2 });
    expect(r.reason).toContain('ninth digit is 9');
    expect(r.warnings).toContain('DUMMY_PATTERN'); // it is also a sequential placeholder
  });

  it.each([
    ['too short (4 digits)', '1234', 'WRONG_LENGTH'],
    ['too long (10 digits)', '1234567820', 'WRONG_LENGTH'],
    ['letters', '12345678a', 'INVALID_CHARACTERS'],
    ['a plus sign', '+123456782', 'INVALID_CHARACTERS'],
    ['a slash', '1234/56782', 'INVALID_CHARACTERS'],
    ['empty after removing separators', ' - . - ', 'EMPTY'],
  ])('%s', (_name, input, code) => {
    const r = id(input);
    expect(r).toMatchObject({ valid: false, reasonCode: code, normalized: null });
    if (code !== 'BAD_CHECKSUM') expect(r.details).toBeNull();
  });

  it('names the offending character', () => {
    expect(id('12345x782').reason).toContain('"x"');
  });

  it('every single-digit typo of a valid ID is BAD_CHECKSUM', () => {
    const rnd = mulberry32(99);
    for (let i = 0; i < 50; i++) {
      const good = randomValidId(rnd);
      const pos = Math.floor(rnd() * 9);
      const d = (Number(good[pos]) + 1 + Math.floor(rnd() * 9)) % 10;
      const bad = good.slice(0, pos) + d + good.slice(pos + 1);
      expect(id(bad, { rejectDummy: false })).toMatchObject({ valid: false, reasonCode: 'BAD_CHECKSUM' });
    }
  });
});

describe('placeholder numbers (rejectDummy)', () => {
  it('all-zero passes the checksum, so it is rejected as DUMMY by default', () => {
    expect(hasValidChecksum('000000000')).toBe(true);
    const r = id('000000000');
    expect(r).toMatchObject({ valid: false, reasonCode: 'DUMMY', normalized: null });
    expect(r.warnings).toEqual(['DUMMY_PATTERN']);
    expect(r.details).toMatchObject({ checkDigit: 0, expectedCheckDigit: 0 });
  });

  it.each(['111111118', '222222226', '333333334', '999999998', '00000000', '0000000', '000000'])('%s is rejected as DUMMY', (s) => {
    // some of these are shorter than 9 digits: padded, the checksum passes for all-zero only, so check both outcomes
    const r = id(s);
    expect(r.valid).toBe(false);
    expect(['DUMMY', 'BAD_CHECKSUM']).toContain(r.reasonCode);
    expect(r.warnings).toContain('DUMMY_PATTERN');
  });

  it('with rejectDummy = false the placeholder is accepted, with a warning', () => {
    const r = id('000000000', { rejectDummy: false });
    expect(r).toMatchObject({ valid: true, reasonCode: 'OK', normalized: '000000000', warnings: ['DUMMY_PATTERN'] });
    expect(id('111111118', { rejectDummy: false })).toMatchObject({ valid: true });
  });

  it('a number that only looks a bit like a pattern is not a placeholder', () => {
    for (const s of ['000000018', '000000125', '510000003']) expect(id(s)).toMatchObject({ valid: true });
  });
});

describe('company numbers (ח.פ. / ע.מ.)', () => {
  const company = (s: string) => id(s, { kind: 'company' });

  it.each([
    ['510000003', '51', 'private company (חברה פרטית)'],
    ['520000001', '52', 'public company (חברה ציבורית)'],
    ['550000004', '55', 'partnership (שותפות)'],
    ['560000002', '56', 'foreign company (חברה זרה)'],
    ['570000000', '57', 'cooperative society (אגודה שיתופית)'],
    ['580000008', '58', 'non-profit association or public-benefit entity (עמותה / חל"צ)'],
  ])('%s: prefix %s -> hint', (num, prefix, hint) => {
    const r = company(num);
    expect(r.valid).toBe(true);
    expect(r.details).toMatchObject({ companyPrefix: prefix, companyPrefixHint: hint });
    expect(r.warnings).toEqual([]);
    expect(COMPANY_PREFIX_HINTS[prefix]).toBe(hint);
  });

  it('prefixes without a known meaning give a prefix but no hint', () => {
    for (const num of ['530000009', '540000007', '590000006']) {
      expect(company(num).details).toMatchObject({ companyPrefix: num.slice(0, 2), companyPrefixHint: null });
    }
  });

  it('a valid number that does not start with 5 is accepted with NOT_CORPORATE_PREFIX (sole-proprietor ע.מ. = personal ID)', () => {
    const r = company('034567891');
    expect(r).toMatchObject({ valid: true });
    expect(r.warnings).toEqual(['NOT_CORPORATE_PREFIX']);
    expect(r.details).toMatchObject({ companyPrefix: null });
  });

  it('as a personal ID the same digits carry the company prefix as an informational detail only', () => {
    expect(id('510000003')).toMatchObject({ valid: true, details: { companyPrefix: '51' }, warnings: [] });
  });

  it('bad checksum is reported the same way', () => {
    expect(company('510000004')).toMatchObject({ valid: false, reasonCode: 'BAD_CHECKSUM' });
    expect(company('510000004').details).toMatchObject({ expectedCheckDigit: 3 });
  });
});

describe('the reason texts', () => {
  it('mention the kind of number', () => {
    expect(id('1').reason).toContain('ID number');
    expect(id('1', { kind: 'company' }).reason).toContain('company');
  });
  it('a restored leading zero is stated in the success text', () => {
    expect(id('34567891').reason).toContain('1 leading zero restored');
    expect(id('4567891').reason).toBeDefined();
  });
});

describe('never throws', () => {
  it('for any input, including padding of odd generated values', () => {
    const rnd = mulberry32(5);
    for (let i = 0; i < 2_000; i++) {
      const s = withCheckDigit(String(Math.floor(rnd() * 1e8)).padStart(8, '0')).slice(Math.floor(rnd() * 5));
      expect(() => id(s)).not.toThrow();
    }
  });
});
