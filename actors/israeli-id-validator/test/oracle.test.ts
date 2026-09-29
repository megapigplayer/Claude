/**
 * Differential tests against an independently maintained library (ibantools, exact-pinned devDependency,
 * "MIT or MPL-2.0"; used ONLY here, never shipped): CONVENTIONS 4.8 "data written from memory needs an
 * independent oracle". The Israeli IBAN rules here are tiny (23 characters, 19 digits, mod 97-10), and this
 * file proves they agree with ibantools on valid and invalid IBANs, bank/branch extraction and check digits.
 */
import { composeIBAN, electronicFormatIBAN, extractIBAN, friendlyFormatIBAN, getCountrySpecifications, isValidIBAN } from 'ibantools';
import { describe, expect, it } from 'vitest';
import { checkIsraeliIban, expectedCheckDigits, formatIban } from '../src/lib/iban.js';
import { mulberry32, randomDigits } from './helpers.js';

describe('ibantools agrees on the Israeli IBAN rules', () => {
  it('its registry entry for IL is what this Actor implements', () => {
    expect(getCountrySpecifications().IL).toMatchObject({ chars: 23, bban_regexp: '^[0-9]{19}$', IBANRegistry: true });
  });

  it('3,000 random IBANs with correct check digits (ibantools composes them) are valid in both, with the same bank and branch', () => {
    const rnd = mulberry32(2026);
    for (let i = 0; i < 3_000; i++) {
      const bban = randomDigits(rnd, 19);
      const composed = composeIBAN({ countryCode: 'IL', bban });
      expect(composed, 'ibantools composes an IBAN').toBeTruthy();
      const iban = composed as string;
      expect(isValidIBAN(iban)).toBe(true);
      const mine = checkIsraeliIban(iban, true);
      expect(mine.valid, iban).toBe(true);
      expect(mine.normalized).toBe(iban);
      expect(mine.details?.checkDigits).toBe(iban.slice(2, 4));
      expect(expectedCheckDigits(bban)).toBe(iban.slice(2, 4));
      expect(mine.details?.formatted).toBe(friendlyFormatIBAN(iban));
      const extracted = extractIBAN(iban);
      expect(mine.details?.bankCode).toBe(extracted.bankIdentifier);
      expect(mine.details?.branchCode).toBe(extracted.branchIdentifier);
      expect(mine.details?.bban).toBe(extracted.bban);
    }
  });

  it('3,000 random single-digit corruptions: valid in both or invalid in both', () => {
    const rnd = mulberry32(4242);
    let invalid = 0;
    for (let i = 0; i < 3_000; i++) {
      const good = composeIBAN({ countryCode: 'IL', bban: randomDigits(rnd, 19) }) as string;
      const pos = 2 + Math.floor(rnd() * (good.length - 2));
      const bad = good.slice(0, pos) + String((Number(good[pos]) + 1 + Math.floor(rnd() * 9)) % 10) + good.slice(pos + 1);
      const theirs = isValidIBAN(bad);
      const mine = checkIsraeliIban(bad, true);
      expect(mine.valid, bad).toBe(theirs);
      if (!theirs) {
        invalid += 1;
        expect(mine.reasonCode).toBe('BAD_CHECKSUM');
      }
    }
    expect(invalid).toBe(3_000); // mod 97-10 detects every single-digit error
  });

  it('random strings of IBAN-like shapes: identical verdicts', () => {
    const rnd = mulberry32(31337);
    for (let i = 0; i < 3_000; i++) {
      const len = 20 + Math.floor(rnd() * 6);
      const iban = `IL${randomDigits(rnd, len - 2)}`;
      expect(checkIsraeliIban(iban, true).valid, iban).toBe(isValidIBAN(iban));
    }
  });

  it('formatting and normalisation match ibantools', () => {
    const iban = 'IL620108000000099999999';
    expect(formatIban(iban)).toBe(friendlyFormatIBAN(iban));
    expect(checkIsraeliIban('il62 0108 0000 0009 9999 999', true).normalized).toBe(electronicFormatIBAN('il62 0108 0000 0009 9999 999'));
  });
});
