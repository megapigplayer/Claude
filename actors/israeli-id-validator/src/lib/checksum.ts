/**
 * The Israeli check-digit algorithm shared by ת.ז. (personal ID) and ח.פ./ע.מ. (company / authorised-dealer
 * numbers): zero-pad to 9 digits, multiply the digits alternately by 1 and 2, add up the DIGITS of every
 * product, and the number is valid when the total is divisible by 10 (equivalently: the ninth digit equals
 * the value that makes it so).
 *
 * A valid checksum only says "this could be a real number": one random 9-digit string in ten passes.
 * It never proves that a person or company exists.
 */

/** Check digit (0-9) that completes the first eight digits. `first8` must be exactly 8 ASCII digits. */
export function checkDigitFor(first8: string): number {
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const digit = first8.charCodeAt(i) - 48;
    const product = digit * (i % 2 === 0 ? 1 : 2);
    sum += product > 9 ? Math.floor(product / 10) + (product % 10) : product;
  }
  return (10 - (sum % 10)) % 10;
}

/** True when `nineDigits` (exactly 9 ASCII digits) has a correct check digit. */
export function hasValidChecksum(nineDigits: string): boolean {
  return /^\d{9}$/.test(nineDigits) && checkDigitFor(nineDigits.slice(0, 8)) === nineDigits.charCodeAt(8) - 48;
}

/** True when all characters are the same digit ("0000000", "2222222"). Needs at least 2 digits. */
export function isRepeatedDigits(digits: string): boolean {
  return digits.length >= 2 && /^(\d)\1+$/.test(digits);
}

/**
 * True for a run of consecutive digits going up or down by one (wrapping 9 -> 0): "123456789", "987654321",
 * "0123456", "890123". Needs at least 5 digits so short legitimate numbers are not caught.
 */
export function isSequentialDigits(digits: string): boolean {
  if (digits.length < 5 || !/^\d+$/.test(digits)) return false;
  let up = true;
  let down = true;
  for (let i = 1; i < digits.length; i++) {
    const step = (digits.charCodeAt(i) - digits.charCodeAt(i - 1) + 10) % 10;
    if (step !== 1) up = false;
    if (step !== 9) down = false;
  }
  return up || down;
}

/** "111111118": everything except the check digit is one repeated digit (needs 5+ digits). */
export function isRepeatedWithCheckDigit(digits: string): boolean {
  return digits.length >= 5 && isRepeatedDigits(digits.slice(0, -1));
}

/** Placeholder-looking number (only relevant when the checksum passes anyway, e.g. all zeros). */
export function looksLikePlaceholder(digits: string): boolean {
  return isRepeatedDigits(digits) || isSequentialDigits(digits) || isRepeatedWithCheckDigit(digits);
}

/**
 * Numbers everybody uses in documentation and tutorials. They pass the checksum, so they stay valid, but
 * a result carries the WELL_KNOWN_TEST_NUMBER warning: a CRM full of them is probably fake data.
 */
export const WELL_KNOWN_TEST_NUMBERS: ReadonlySet<string> = new Set(['123456782']);

/** mod-97 remainder of an alphanumeric string (A=10 ... Z=35), digit by digit (no big integers). */
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
