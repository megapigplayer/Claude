/**
 * IBAN validation and normalisation (ISO 13616 structure, ISO 7064 MOD 97-10 checksum).
 * Pure functions: no I/O, no Apify imports, never throws for any string input.
 */
import { CHAR_CLASS_LABEL, CHAR_CLASS_PATTERN, COUNTRIES, getBbanParts } from './countries.js';

export type IbanReasonCode =
  | 'OK'
  | 'EMPTY'
  | 'INVALID_CHARACTERS'
  | 'BAD_PREFIX'
  | 'UNKNOWN_COUNTRY'
  | 'WRONG_LENGTH'
  | 'BAD_BBAN_FORMAT'
  | 'BAD_CHECKSUM';

export interface IbanCheck {
  valid: boolean;
  reasonCode: IbanReasonCode;
  /** Human-readable explanation (always set). */
  reason: string;
  /** Normalised "electronic format": upper case, no separators. Null when the input was empty. */
  iban: string | null;
  /** Print format in groups of four. Only set for valid IBANs. */
  ibanFormatted: string | null;
  /** Country code once the input has a structurally valid prefix (2 letters + 2 digits), even if the country is unknown. */
  countryCode: string | null;
  countryName: string | null;
  /* The following are only extracted from VALID IBANs (null otherwise). */
  checkDigits: string | null;
  bban: string | null;
  bankCode: string | null;
  branchCode: string | null;
  accountNumber: string | null;
}

/**
 * Normalise user input to the IBAN "electronic format": Unicode NFKC (turns non-breaking and
 * full-width spaces/digits into ASCII), drop a leading "IBAN" label, remove whitespace,
 * zero-width characters and hyphens/dashes, upper-case. Other punctuation is NOT removed so
 * that it is reported as INVALID_CHARACTERS.
 */
export function normalizeIban(raw: string): string {
  let s = String(raw ?? '').normalize('NFKC');
  s = s.replace(/^\s*iban\b[\s:.-]*/i, ''); // "IBAN: DE89 ..." / "IBAN DE89 ..."
  s = s.replace(/[\s​-‍⁠﻿­\-‐-―−]+/g, '');
  return s.toUpperCase();
}

/** Group in blocks of four separated by single spaces (the printed IBAN format). */
export function formatIban(iban: string): string {
  return iban.replace(/(.{4})(?=.)/g, '$1 ');
}

/**
 * MOD 97-10 remainder of an alphanumeric string (letters count as A=10 ... Z=35). Works
 * digit by digit so it never needs big integers. A valid IBAN, rearranged as
 * BBAN + country + check digits, has remainder 1.
 */
export function mod97(alphanumeric: string): number {
  let remainder = 0;
  for (let i = 0; i < alphanumeric.length; i++) {
    const c = alphanumeric.charCodeAt(i);
    if (c >= 48 && c <= 57) remainder = (remainder * 10 + (c - 48)) % 97;
    else if (c >= 65 && c <= 90) remainder = (remainder * 100 + (c - 55)) % 97;
    else throw new Error(`mod97: unexpected character code ${c}`);
  }
  return remainder;
}

/** Check digits (two chars, 02..98) that make `countryCode` + `bban` a valid IBAN. */
export function computeCheckDigits(countryCode: string, bban: string): string {
  return String(98 - mod97(`${bban}${countryCode}00`)).padStart(2, '0');
}

const EMPTY_DETAILS = {
  ibanFormatted: null,
  checkDigits: null,
  bban: null,
  bankCode: null,
  branchCode: null,
  accountNumber: null,
} as const;

function fail(
  reasonCode: Exclude<IbanReasonCode, 'OK'>,
  reason: string,
  iban: string | null,
  countryCode: string | null,
  countryName: string | null,
): IbanCheck {
  return { valid: false, reasonCode, reason, iban, countryCode, countryName, ...EMPTY_DETAILS };
}

export function checkIban(raw: string): IbanCheck {
  const iban = normalizeIban(raw);
  if (iban === '') return fail('EMPTY', 'Input is empty after removing spaces and separators.', null, null, null);

  const badChar = /[^A-Z0-9]/u.exec(iban); // `u`: report a whole code point, not half a surrogate pair
  if (badChar) {
    return fail(
      'INVALID_CHARACTERS',
      `Contains the invalid character ${JSON.stringify(badChar[0])}; only letters A-Z and digits 0-9 are allowed (spaces and hyphens are ignored).`,
      iban,
      null,
      null,
    );
  }

  // The country is only reported once the prefix is structurally an IBAN prefix, so that
  // arbitrary text like "NOTANIBAN" is not mislabelled as Norway.
  if (!/^[A-Z]{2}[0-9]{2}/.test(iban)) {
    return fail(
      'BAD_PREFIX',
      'An IBAN starts with a 2-letter country code followed by 2 check digits (for example "DE89").',
      iban,
      null,
      null,
    );
  }

  const countryCode = iban.slice(0, 2);
  const country = COUNTRIES[countryCode];
  if (!country) {
    return fail('UNKNOWN_COUNTRY', `"${countryCode}" is not an IBAN country code known to this Actor.`, iban, countryCode, null);
  }

  if (iban.length !== country.length) {
    return fail(
      'WRONG_LENGTH',
      `An IBAN from ${country.name} (${countryCode}) has ${country.length} characters, but this one has ${iban.length}.`,
      iban,
      countryCode,
      country.name,
    );
  }

  const bban = iban.slice(4);
  const parts = getBbanParts(countryCode);
  if (parts) {
    let offset = 0;
    for (const part of parts) {
      const pattern = CHAR_CLASS_PATTERN[part.charClass];
      for (let i = 0; i < part.length; i++) {
        const ch = bban.charAt(offset + i);
        if (!pattern.test(ch)) {
          return fail(
            'BAD_BBAN_FORMAT',
            `Character ${offset + i + 5} (${JSON.stringify(ch)}) must be ${CHAR_CLASS_LABEL[part.charClass]} in a ${country.name} IBAN.`,
            iban,
            countryCode,
            country.name,
          );
        }
      }
      offset += part.length;
    }
  }

  const checkDigits = iban.slice(2, 4);
  if (checkDigits === '00' || checkDigits === '01' || checkDigits === '99') {
    return fail('BAD_CHECKSUM', `Check digits ${checkDigits} are never valid (they must be between 02 and 98).`, iban, countryCode, country.name);
  }
  const remainder = mod97(`${bban}${countryCode}${checkDigits}`);
  if (remainder !== 1) {
    return fail(
      'BAD_CHECKSUM',
      `The check digits do not match the rest of the IBAN (ISO 7064 MOD 97-10 remainder is ${remainder}, expected 1); a digit is probably mistyped.`,
      iban,
      countryCode,
      country.name,
    );
  }

  const extracted = extractBankDetails(bban, parts);
  return {
    valid: true,
    reasonCode: 'OK',
    reason: 'Valid IBAN: length, national format and check digits are correct.',
    iban,
    ibanFormatted: formatIban(iban),
    countryCode,
    countryName: country.name,
    checkDigits,
    bban,
    ...extracted,
  };
}

function extractBankDetails(
  bban: string,
  parts: ReturnType<typeof getBbanParts>,
): { bankCode: string | null; branchCode: string | null; accountNumber: string | null } {
  if (!parts) return { bankCode: null, branchCode: null, accountNumber: null };
  const collected: Record<'bank' | 'branch' | 'account', string> = { bank: '', branch: '', account: '' };
  let offset = 0;
  for (const part of parts) {
    if (part.role === 'bank' || part.role === 'branch' || part.role === 'account') {
      collected[part.role] += bban.slice(offset, offset + part.length);
    }
    offset += part.length;
  }
  return {
    bankCode: collected.bank || null,
    branchCode: collected.branch || null,
    accountNumber: collected.account || null,
  };
}
