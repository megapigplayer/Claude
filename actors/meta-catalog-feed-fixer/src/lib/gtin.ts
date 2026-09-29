/**
 * GTIN (EAN / UPC / GTIN-14) validation and conservative repair (pure).
 *
 * Valid lengths are 8, 12, 13 and 14 digits with a GS1 check digit (mod 10, weights 3/1 from the right).
 * The only repairs are lossless: removing separators and spreadsheet artefacts (".0" suffix, leading
 * apostrophe) and restoring leading zeros that a spreadsheet dropped, and only when the resulting
 * number has a valid check digit. A wrong check digit is NEVER "fixed" by recomputing it: that would
 * turn a typo into a different, valid-looking product code.
 */

/** GS1 check digit for a payload (the digits without the check digit). */
export function gtinCheckDigit(payload: string): number {
  let sum = 0;
  for (let i = payload.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += (payload.charCodeAt(i) - 48) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

const VALID_LENGTHS = new Set([8, 12, 13, 14]);

/** true when `digits` is 8/12/13/14 digits long and its check digit is correct. */
export function isValidGtin(digits: string): boolean {
  if (!/^\d+$/.test(digits) || !VALID_LENGTHS.has(digits.length)) return false;
  return gtinCheckDigit(digits.slice(0, -1)) === digits.charCodeAt(digits.length - 1) - 48;
}

export type GtinFailCode = 'EMPTY' | 'NON_DIGIT' | 'SCIENTIFIC' | 'BAD_LENGTH' | 'BAD_CHECK_DIGIT';

export type GtinResult =
  | { status: 'valid'; value: string }
  | { status: 'repaired'; value: string; note: string }
  | { status: 'invalid'; code: GtinFailCode; message: string; expectedCheckDigit?: number };

/** Excel-style scientific notation, e.g. 4.00638E+12: the digits beyond the mantissa are lost for good. */
const SCIENTIFIC_RE = /^\d(?:[.,]\d+)?[eE][+-]?\d{1,3}$/;

export interface GtinOptions {
  /** Pad a valid GTIN with leading zeros up to this length (13 or 14). 0 = keep the length. */
  padTo?: 0 | 13 | 14;
}

function padLeft(digits: string, length: number): string {
  return digits.length >= length ? digits : '0'.repeat(length - digits.length) + digits;
}

/** Checks (and, where lossless, repairs) one GTIN cell. `raw` must be non-empty after trimming. */
export function checkGtin(raw: string, options: GtinOptions = {}): GtinResult {
  let s = raw.trim().replace(/^['`‘’]+/, '');
  if (s === '') return { status: 'invalid', code: 'EMPTY', message: 'GTIN is empty' };
  if (SCIENTIFIC_RE.test(s)) {
    return {
      status: 'invalid',
      code: 'SCIENTIFIC',
      message: `"${raw}" is in scientific notation (a spreadsheet number format): the trailing digits are lost. Re-export the column as text`,
    };
  }
  const notes: string[] = [];
  if (s !== trimmed) notes.push('leading apostrophe (spreadsheet text marker) removed');
  const floatMatch = /^(\d+)[.,]0+$/.exec(s);
  if (floatMatch) {
    s = floatMatch[1] as string;
    notes.push('".0" suffix removed');
  }
  const stripped = s.replace(/[\s-]+/g, '');
  if (stripped !== s) notes.push('spaces/hyphens removed');
  s = stripped;
  if (!/^\d+$/.test(s)) {
    return { status: 'invalid', code: 'NON_DIGIT', message: `GTIN "${raw}" contains characters other than digits` };
  }

  let digits = s;
  // Too long: only leading zeros can be dropped (a GTIN-14 with a zero indicator is a GTIN-13 in disguise).
  if (digits.length > 14) {
    const noZeros = digits.replace(/^0+/, '');
    if (noZeros.length <= 14 && noZeros.length > 0) {
      digits = padLeft(noZeros, noZeros.length <= 8 ? 8 : noZeros.length <= 12 ? 12 : noZeros.length);
      notes.push('extra leading zeros removed');
    } else {
      return { status: 'invalid', code: 'BAD_LENGTH', message: `GTIN "${raw}" has ${s.length} digits; a GTIN has 8, 12, 13 or 14` };
    }
  } else if (!VALID_LENGTHS.has(digits.length)) {
    // Spreadsheets drop leading zeros: restore them to the next valid length, but only if the check digit then fits.
    const target = digits.length < 8 ? 8 : 12; // 9-11 digits -> 12
    const candidate = padLeft(digits, target);
    if (!isValidGtin(candidate)) {
      return {
        status: 'invalid',
        code: 'BAD_LENGTH',
        message: `GTIN "${raw}" has ${digits.length} digits; a GTIN has 8, 12, 13 or 14 (zero-padding to ${target} digits does not give a valid check digit either)`,
      };
    }
    notes.push(`leading zeros restored (${digits.length} -> ${target} digits)`);
    digits = candidate;
  }

  if (!isValidGtin(digits)) {
    const expected = gtinCheckDigit(digits.slice(0, -1));
    return {
      status: 'invalid',
      code: 'BAD_CHECK_DIGIT',
      message: `GTIN ${digits} has an invalid check digit (the last digit should be ${expected} if the other digits are right; not changed automatically)`,
      expectedCheckDigit: expected,
    };
  }

  const padTo = options.padTo ?? 0;
  if (padTo > 0 && digits.length < padTo) {
    notes.push(`padded with leading zeros to ${padTo} digits`);
    digits = padLeft(digits, padTo);
  }
  return notes.length === 0 ? { status: 'valid', value: digits } : { status: 'repaired', value: digits, note: notes.join('; ') };
}
