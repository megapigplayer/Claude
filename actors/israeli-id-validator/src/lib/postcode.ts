/**
 * Israeli postcode (מיקוד): 7 digits since Israel Post's 2013 reform (the old 5-digit codes are not valid any
 * more). FORMAT check only: there is no checksum, and the code is not looked up in Israel Post's directory.
 */
import { isRepeatedDigits, isSequentialDigits } from './checksum.js';
import { firstDisallowed, NUMERIC_SEPARATORS } from './text.js';
import type { ReasonCode, TypeCheck, WarningCode } from './types.js';

export const POSTCODE_DIGITS = 7;

function fail(reasonCode: Exclude<ReasonCode, 'OK'>, reason: string, warnings: WarningCode[] = []): TypeCheck {
  return { valid: false, reasonCode, reason, normalized: null, details: null, warnings };
}

export function checkPostcode(text: string, rejectDummy: boolean, normalize: boolean): TypeCheck {
  const digits = normalize ? text.replace(NUMERIC_SEPARATORS, '') : text;
  if (digits === '') return fail('EMPTY', 'Nothing left to check after removing spaces, dots and dashes.');

  const badChar = firstDisallowed(digits, /[0-9]/);
  if (badChar !== null) {
    return fail('INVALID_CHARACTERS', `Contains the invalid character ${badChar}; an Israeli postcode has only digits${normalize ? ' (spaces, dots and dashes are ignored)' : ''}.`);
  }

  if (digits.length !== POSTCODE_DIGITS) {
    const legacy = digits.length === 5 ? ' (the legacy 5-digit postcodes are no longer valid)' : '';
    return fail('WRONG_LENGTH', `An Israeli postcode has ${POSTCODE_DIGITS} digits, but this one has ${digits.length}${legacy}.`);
  }

  if (isRepeatedDigits(digits) || isSequentialDigits(digits)) {
    if (rejectDummy) {
      return fail(
        'DUMMY',
        'The format is right, but the digits are a placeholder (all the same, or a run of consecutive digits). Set rejectDummy to false to accept it.',
        ['DUMMY_PATTERN'],
      );
    }
    return { valid: true, reasonCode: 'OK', reason: 'Well-formed 7-digit postcode (looks like a placeholder).', normalized: digits, details: null, warnings: ['DUMMY_PATTERN'] };
  }

  return { valid: true, reasonCode: 'OK', reason: 'Well-formed 7-digit postcode (format check only; not looked up in the Israel Post directory).', normalized: digits, details: null, warnings: [] };
}
