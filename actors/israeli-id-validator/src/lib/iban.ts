/**
 * Israeli IBAN check (ISO 13616 structure for IL + ISO 7064 mod 97-10 checksum). Pure, never throws.
 *
 * Structure (SWIFT IBAN registry): IL + 2 check digits + 3-digit bank + 3-digit branch + 13-digit account
 * = 23 characters, digits only after the country code. Example (registry): IL62 0108 0000 0009 9999 999.
 * Independent oracle: test/oracle.test.ts compares this implementation with `ibantools` (dev dependency).
 *
 * National account-number check digits are NOT verified (Israel's registry entry defines none).
 */
import { lookupBank } from './banks.js';
import { mod97 } from './checksum.js';
import { DASH_CLASS, firstDisallowed } from './text.js';
import type { ReasonCode, TypeCheck } from './types.js';

export const IL_IBAN_LENGTH = 23;
const IBAN_SEPARATORS = new RegExp(`[\\s${DASH_CLASS}]+`, 'gu');

function fail(reasonCode: Exclude<ReasonCode, 'OK'>, reason: string, details: TypeCheck['details'] = null): TypeCheck {
  return { valid: false, reasonCode, reason, normalized: null, details, warnings: [] };
}

/** Check digits (two characters, 02..98) that make `IL` + digits + `bban` a valid IBAN. */
export function expectedCheckDigits(bban: string): string {
  return String(98 - mod97(`${bban}IL00`)).padStart(2, '0');
}

/** Groups of four separated by single spaces (the printed IBAN format). */
export function formatIban(iban: string): string {
  return iban.replace(/(.{4})(?=.)/g, '$1 ');
}

/**
 * `normalize` removes spaces and dashes and upper-cases; strict mode (`false`) requires the electronic
 * format exactly (upper-case letters and digits, no separators).
 */
export function checkIsraeliIban(text: string, normalize: boolean): TypeCheck {
  const iban = normalize ? text.replace(IBAN_SEPARATORS, '').toUpperCase() : text;
  if (iban === '') return fail('EMPTY', 'Nothing left to check after removing spaces and dashes.');

  const badChar = firstDisallowed(iban, /[A-Z0-9]/);
  if (badChar !== null) {
    return fail(
      'INVALID_CHARACTERS',
      normalize
        ? `Contains the invalid character ${badChar}; an IBAN has only letters A-Z and digits 0-9 (spaces and dashes are ignored).`
        : `Contains the invalid character ${badChar}; strict mode (normalize = false) requires upper-case letters A-Z and digits 0-9 with no separators.`,
    );
  }

  if (!/^[A-Z]{2}\d{2}/.test(iban)) {
    return fail('BAD_FORMAT', 'An IBAN starts with a 2-letter country code followed by 2 check digits (an Israeli one: "IL62").');
  }

  const country = iban.slice(0, 2);
  if (country !== 'IL') {
    return fail('NOT_ISRAELI', `The country code is ${country}, not IL: this Actor validates Israeli IBANs only (use the "IBAN Validator & Normalizer" Actor for other countries).`);
  }

  if (iban.length !== IL_IBAN_LENGTH) {
    return fail('WRONG_LENGTH', `An Israeli IBAN has ${IL_IBAN_LENGTH} characters (IL + 2 check digits + 3-digit bank + 3-digit branch + 13-digit account), but this one has ${iban.length}.`);
  }

  const bban = iban.slice(4);
  if (!/^\d{19}$/.test(bban)) {
    return fail('BAD_FORMAT', 'After "IL" and the 2 check digits an Israeli IBAN has only digits (bank 3 + branch 3 + account 13).');
  }

  const remainder = mod97(`${bban}IL${iban.slice(2, 4)}`);
  if (remainder !== 1) {
    const expected = expectedCheckDigits(bban);
    return fail(
      'BAD_CHECKSUM',
      `The check digits do not match the rest of the IBAN (mod 97-10 remainder ${remainder}, expected 1); with this account part they would be "${expected}", so a digit is probably mistyped.`,
      { expectedCheckDigits: expected },
    );
  }

  const bank = lookupBank(bban.slice(0, 3));
  return {
    valid: true,
    reasonCode: 'OK',
    reason: 'Valid Israeli IBAN: length, digit layout and mod 97-10 check digits are correct.',
    normalized: iban,
    details: {
      formatted: formatIban(iban),
      checkDigits: iban.slice(2, 4),
      bban,
      bankCode: bank.bankCode,
      bankNumber: bank.bankNumber,
      bankName: bank.bankName,
      bankNameHe: bank.bankNameHe,
      branchCode: bban.slice(3, 6),
      accountNumber: bban.slice(6),
    },
    warnings: [],
  };
}
