import { describe, expect, it } from 'vitest';
import { BANKS, lookupBank } from '../src/lib/banks.js';
import { checkIsraeliIban, expectedCheckDigits, formatIban, IL_IBAN_LENGTH } from '../src/lib/iban.js';
import { EN_DASH, NBSP } from './helpers.js';

const REGISTRY_EXAMPLE = 'IL620108000000099999999';

describe('registry example IL62 0108 0000 0009 9999 999', () => {
  it('is valid and decomposes into bank / branch / account', () => {
    const r = checkIsraeliIban(REGISTRY_EXAMPLE, true);
    expect(r).toMatchObject({ valid: true, reasonCode: 'OK', normalized: REGISTRY_EXAMPLE });
    expect(r.details).toEqual({
      formatted: 'IL62 0108 0000 0009 9999 999',
      checkDigits: '62',
      bban: '0108000000099999999',
      bankCode: '010',
      bankNumber: '10',
      bankName: 'Bank Leumi',
      bankNameHe: 'בנק לאומי לישראל',
      branchCode: '800',
      accountNumber: '0000099999999',
    });
    expect(r.warnings).toEqual([]);
  });

  it('the length constant is the registry length', () => {
    expect(IL_IBAN_LENGTH).toBe(23);
    expect(REGISTRY_EXAMPLE).toHaveLength(23);
  });

  it.each([
    ['print format', 'IL62 0108 0000 0009 9999 999'],
    ['lower case', 'il62 0108 0000 0009 9999 999'],
    ['no spaces, lower case', 'il620108000000099999999'],
    ['dashes', 'IL62-0108-0000-0009-9999-999'],
    ['en dashes', `IL62${EN_DASH}0108${EN_DASH}0000${EN_DASH}0009${EN_DASH}9999${EN_DASH}999`],
    ['no-break spaces', `IL62${NBSP}0108${NBSP}0000${NBSP}0009${NBSP}9999${NBSP}999`],
    ['surrounding spaces', '   IL620108000000099999999   '],
    ['tabs', 'IL62\t0108\t0000\t0009\t9999\t999'],
  ])('normalizes: %s', (_name, input) => {
    // callers trim; checkIsraeliIban itself removes all inner whitespace and dashes
    expect(checkIsraeliIban(input.trim(), true)).toMatchObject({ valid: true, normalized: REGISTRY_EXAMPLE });
  });
});

describe('invalid IBANs', () => {
  it('a changed last digit fails the mod 97-10 check and the reason names the expected check digits', () => {
    const r = checkIsraeliIban('IL620108000000099999998', true);
    expect(r).toMatchObject({ valid: false, reasonCode: 'BAD_CHECKSUM', normalized: null });
    expect(r.details).toEqual({ expectedCheckDigits: expectedCheckDigits('0108000000099999998') });
    expect(r.reason).toContain('remainder');
    expect(r.reason).toMatch(/expected 1/);
  });

  it('wrong check digits with the right account part', () => {
    const r = checkIsraeliIban('IL630108000000099999999', true);
    expect(r).toMatchObject({ valid: false, reasonCode: 'BAD_CHECKSUM' });
    expect(r.details).toEqual({ expectedCheckDigits: '62' });
    expect(r.reason).toContain('"62"');
  });

  it.each([
    ['too short', 'IL62010800000009999999', 'WRONG_LENGTH'],
    ['too long', 'IL6201080000000999999999', 'WRONG_LENGTH'],
    ['only the prefix', 'IL62', 'WRONG_LENGTH'],
    ['a letter in the account part', 'IL62010800000009999999X', 'BAD_FORMAT'],
    ['a letter, right length, invalid character class', 'IL6201080000000999999A9', 'BAD_FORMAT'],
    ['a dot', 'IL62.0108000000099999999', 'INVALID_CHARACTERS'],
    ['an underscore', 'IL62_0108000000099999999', 'INVALID_CHARACTERS'],
    ['a slash', 'IL62/0108000000099999999', 'INVALID_CHARACTERS'],
    ['an accented letter', 'IL62010800000009999999É', 'INVALID_CHARACTERS'],
    ['no country code', '620108000000099999999', 'BAD_FORMAT'],
    ['digits in the country code', '1L620108000000099999999', 'BAD_FORMAT'],
    ['check digits are letters', 'ILAB0108000000099999999', 'BAD_FORMAT'],
    ['empty', '', 'EMPTY'],
    ['only separators', ' - - ', 'EMPTY'],
  ])('%s', (_name, input, code) => {
    const r = checkIsraeliIban(input, true);
    expect(r.valid).toBe(false);
    expect(r.reasonCode).toBe(code);
    expect(r.normalized).toBeNull();
    // never present unvalidated details as trustworthy: no bank, no account, only the checksum diagnostic
    expect(r.details === null || Object.keys(r.details).join() === 'expectedCheckDigits').toBe(true);
  });

  it('other countries are NOT_ISRAELI, whatever their validity', () => {
    for (const iban of ['GB82WEST12345698765432', 'DE89370400440532013000', 'DE89370400440532013001', 'FR14ZZZZ']) {
      const r = checkIsraeliIban(iban, true);
      expect(r).toMatchObject({ valid: false, reasonCode: 'NOT_ISRAELI' });
      expect(r.reason).toContain(iban.slice(0, 2));
    }
  });

  it('the invalid-character message names the character', () => {
    expect(checkIsraeliIban('IL62.0108', true).reason).toContain('"."');
  });
});

describe('strict mode (normalize = false)', () => {
  it('accepts exactly the electronic format', () => {
    expect(checkIsraeliIban(REGISTRY_EXAMPLE, false)).toMatchObject({ valid: true });
  });
  it.each(['il620108000000099999999', 'IL62 0108 0000 0009 9999 999', 'IL62-0108000000099999999', 'IL62010800000009999999 '])('rejects %j', (s) => {
    expect(checkIsraeliIban(s, false)).toMatchObject({ valid: false, reasonCode: 'INVALID_CHARACTERS' });
  });
});

describe('helpers', () => {
  it('formatIban groups in fours', () => {
    expect(formatIban(REGISTRY_EXAMPLE)).toBe('IL62 0108 0000 0009 9999 999');
    expect(formatIban('ABCD')).toBe('ABCD');
    expect(formatIban('ABCDE')).toBe('ABCD E');
  });

  it('expectedCheckDigits gives 62 for the registry BBAN and always 02..98', () => {
    expect(expectedCheckDigits('0108000000099999999')).toBe('62');
    for (const bban of ['0000000000000000000', '9999999999999999999', '1234567890123456789']) {
      const cd = expectedCheckDigits(bban);
      expect(cd).toMatch(/^\d\d$/);
      expect(Number(cd)).toBeGreaterThanOrEqual(2);
      expect(Number(cd)).toBeLessThanOrEqual(98);
      expect(checkIsraeliIban(`IL${cd}${bban}`, true).valid).toBe(true);
    }
  });
});

describe('bank table', () => {
  it('maps the 3-digit IBAN code to the bank number and name', () => {
    expect(lookupBank('010')).toEqual({ bankCode: '010', bankNumber: '10', bankName: 'Bank Leumi', bankNameHe: 'בנק לאומי לישראל' });
    expect(lookupBank('012')).toMatchObject({ bankNumber: '12', bankName: 'Bank Hapoalim' });
    expect(lookupBank('020')).toMatchObject({ bankNumber: '20', bankName: 'Mizrahi-Tefahot Bank' });
    expect(lookupBank('011')).toMatchObject({ bankName: 'Israel Discount Bank' });
  });

  it('unknown codes give null names, never a guess', () => {
    expect(lookupBank('077')).toEqual({ bankCode: '077', bankNumber: '77', bankName: null, bankNameHe: null });
    expect(lookupBank('110')).toEqual({ bankCode: '110', bankNumber: '110', bankName: null, bankNameHe: null });
  });

  it('every table key is a two-digit bank number and every row is fully labelled', () => {
    for (const [code, info] of Object.entries(BANKS)) {
      expect(code).toMatch(/^\d\d$/);
      expect(info.en.length).toBeGreaterThan(3);
      expect(info.he.length).toBeGreaterThan(1);
      expect(['secondary', 'memory']).toContain(info.status);
    }
  });

  it('is small and honest: rows written from memory are flagged so they can be re-verified', () => {
    const memory = Object.entries(BANKS).filter(([, b]) => b.status === 'memory').map(([code]) => code);
    expect(memory.sort()).toEqual(['22', '23', '26', '54', '99']);
  });

  it('an IBAN of an unknown bank is still valid, with null bank names', () => {
    const bban = '0770010000000012345';
    const iban = `IL${expectedCheckDigits(bban)}${bban}`;
    const r = checkIsraeliIban(iban, true);
    expect(r.valid).toBe(true);
    expect(r.details).toMatchObject({ bankCode: '077', bankName: null, bankNameHe: null, branchCode: '001' });
  });
});
