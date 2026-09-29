/**
 * Israeli personal ID (ת.ז.) and company / authorised-dealer number (ח.פ. / ע.מ.) checks. Pure, never throws.
 *
 * Both use the same 9-digit check-digit algorithm (see checksum.ts), so a valid number cannot say by itself
 * whether it belongs to a person or a company. What differs:
 *  - IDs may have lost leading zeros in a spreadsheet: 5-8 digits are zero-padded to 9 (only when `normalize`).
 *  - Company numbers of corporations start with 5 (prefix hints below, informational only).
 */
import { checkDigitFor, hasValidChecksum, looksLikePlaceholder, WELL_KNOWN_TEST_NUMBERS } from './checksum.js';
import { firstDisallowed, NUMERIC_SEPARATORS } from './text.js';
import type { ReasonCode, TypeCheck, WarningCode } from './types.js';

export const MIN_ID_DIGITS = 5;
export const ID_DIGITS = 9;

/**
 * VERIFY: what the first two digits of a 9-digit corporate number mean. Source: independent Israeli
 * web pages as summarised by web search on 2026-09-29 (the registrar's own pages could not be fetched).
 * Two searches agreed on 51 = private company, 52 = public company, 55 = partnership and 58 = non-profit
 * association; a third gave 56 = foreign company and 57 = cooperative society (not cross-checked, and the
 * sources disagree on some of these). 53, 54 and 59 are unknown. Informational only: the checksum never
 * depends on it and a number is never rejected because of its prefix.
 */
export const COMPANY_PREFIX_HINTS: Readonly<Record<string, string>> = {
  '51': 'private company (חברה פרטית)',
  '52': 'public company (חברה ציבורית)',
  '55': 'partnership (שותפות)',
  '56': 'foreign company (חברה זרה)',
  '57': 'cooperative society (אגודה שיתופית)',
  '58': 'non-profit association or public-benefit entity (עמותה / חל"צ)',
};

export type NumberKind = 'id' | 'company';

export interface NumberOptions {
  kind: NumberKind;
  rejectDummy: boolean;
  normalize: boolean;
}

function fail(
  reasonCode: Exclude<ReasonCode, 'OK'>,
  reason: string,
  details: TypeCheck['details'] = null,
  warnings: WarningCode[] = [],
): TypeCheck {
  return { valid: false, reasonCode, reason, normalized: null, details, warnings };
}

export function checkNineDigitNumber(text: string, options: NumberOptions): TypeCheck {
  const { kind, rejectDummy, normalize } = options;
  const label = kind === 'company' ? 'company / authorised-dealer number' : 'ID number';
  const digits = normalize ? text.replace(NUMERIC_SEPARATORS, '') : text;
  if (digits === '') return fail('EMPTY', 'Nothing left to check after removing spaces, dots and dashes.');

  const badChar = firstDisallowed(digits, /[0-9]/);
  if (badChar !== null) {
    return fail(
      'INVALID_CHARACTERS',
      normalize
        ? `Contains the invalid character ${badChar}; an Israeli ${label} has only digits (spaces, dots and dashes are ignored).`
        : `Contains the invalid character ${badChar}; strict mode (normalize = false) requires digits only.`,
    );
  }

  const n = digits.length;
  if (normalize ? n < MIN_ID_DIGITS || n > ID_DIGITS : n !== ID_DIGITS) {
    return fail(
      'WRONG_LENGTH',
      normalize
        ? `An Israeli ${label} has ${ID_DIGITS} digits (spreadsheets often drop leading zeros, so ${MIN_ID_DIGITS}-${ID_DIGITS - 1} digits are zero-padded), but this one has ${n}.`
        : `An Israeli ${label} has exactly ${ID_DIGITS} digits in strict mode (normalize = false), but this one has ${n}.`,
    );
  }

  const padded = digits.padStart(ID_DIGITS, '0');
  const restored = n < ID_DIGITS;
  const warnings: WarningCode[] = restored ? ['LEADING_ZEROS_RESTORED'] : [];
  const expected = checkDigitFor(padded.slice(0, 8));
  const actual = padded.charCodeAt(8) - 48;
  const prefix = padded.startsWith('5') && !restored ? padded.slice(0, 2) : null;
  const details = {
    checkDigit: actual,
    expectedCheckDigit: expected,
    paddedFrom: restored ? n : null,
    companyPrefix: prefix,
    companyPrefixHint: prefix ? (COMPANY_PREFIX_HINTS[prefix] ?? null) : null,
  };
  const placeholder = looksLikePlaceholder(digits);

  if (!hasValidChecksum(padded)) {
    if (placeholder) warnings.push('DUMMY_PATTERN');
    return fail(
      'BAD_CHECKSUM',
      `The check digit does not match: the ninth digit is ${actual} but the first eight digits require ${expected}; a digit is probably mistyped.` +
        (placeholder ? ' The digits also look like a placeholder (repeated or sequential).' : ''),
      details,
      warnings,
    );
  }

  if (placeholder) {
    if (rejectDummy) {
      warnings.push('DUMMY_PATTERN');
      return fail(
        'DUMMY',
        'The checksum passes, but the digits are a placeholder (all the same, or a run of consecutive digits), not a real number. Set rejectDummy to false to accept it.',
        details,
        warnings,
      );
    }
    warnings.push('DUMMY_PATTERN');
  }
  if (WELL_KNOWN_TEST_NUMBERS.has(padded)) warnings.push('WELL_KNOWN_TEST_NUMBER');
  if (kind === 'company' && !padded.startsWith('5')) warnings.push('NOT_CORPORATE_PREFIX');

  return {
    valid: true,
    reasonCode: 'OK',
    reason: `Valid ${label}: the check digit is correct${restored ? ` (${ID_DIGITS - n} leading zero${ID_DIGITS - n === 1 ? '' : 's'} restored)` : ''}.`,
    normalized: padded,
    details,
    warnings,
  };
}
