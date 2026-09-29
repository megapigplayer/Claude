/** Shared test helpers: seeded PRNG, an independent checksum oracle and invisible-character constants. */

/** Small seeded PRNG so every "random" test is reproducible. */
export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Independent oracle: the Israeli ID algorithm IS the Luhn algorithm applied to the 9-digit number
 * (weights 1,2,1,2,... from the left equal Luhn's "double every second digit from the right" on 9 digits).
 * Implemented right-to-left with subtract-9 instead of digit sums, i.e. a different code path from src/.
 */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Completes 8 digits with the check digit found by brute force with the oracle. */
export function withCheckDigit(first8: string): string {
  for (let c = 0; c < 10; c++) if (luhnValid(first8 + c)) return first8 + c;
  throw new Error('unreachable: exactly one check digit works');
}

export function randomDigits(rnd: () => number, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += String(Math.floor(rnd() * 10));
  return s;
}

/** A random valid 9-digit number that is not a placeholder pattern. */
export function randomValidId(rnd: () => number): string {
  for (;;) {
    const id = withCheckDigit(randomDigits(rnd, 8));
    if (new Set(id).size > 3) return id;
  }
}

const cp = (code: number): string => String.fromCodePoint(code);
export const LRM = cp(0x200e);
export const RLM = cp(0x200f);
export const ALM = cp(0x061c);
export const LRE = cp(0x202a);
export const RLE = cp(0x202b);
export const PDF = cp(0x202c);
export const LRO = cp(0x202d);
export const RLO = cp(0x202e);
export const LRI = cp(0x2066);
export const RLI = cp(0x2067);
export const PDI = cp(0x2069);
export const ZWSP = cp(0x200b);
export const ZWNJ = cp(0x200c);
export const ZWJ = cp(0x200d);
export const WORD_JOINER = cp(0x2060);
export const BOM = cp(0xfeff);
export const SOFT_HYPHEN = cp(0x00ad);
export const NBSP = cp(0x00a0);
export const NARROW_NBSP = cp(0x202f);
export const IDEOGRAPHIC_SPACE = cp(0x3000);
export const EN_DASH = cp(0x2013);
export const NB_HYPHEN = cp(0x2011);
export const MINUS_SIGN = cp(0x2212);

/** Arabic-Indic (U+0660..) / Persian (U+06F0..) / full-width digits for an ASCII digit string. */
export const toArabicIndic = (s: string): string => [...s].map((c) => (/\d/.test(c) ? cp(0x0660 + Number(c)) : c)).join('');
export const toPersian = (s: string): string => [...s].map((c) => (/\d/.test(c) ? cp(0x06f0 + Number(c)) : c)).join('');
export const toFullWidth = (s: string): string => [...s].map((c) => (/\d/.test(c) ? cp(0xff10 + Number(c)) : c)).join('');

/** Random string over a deliberately nasty alphabet (Latin, Hebrew, digits of several scripts, bidi controls, symbols, astral). */
export function randomNastyString(rnd: () => number, maxLen = 40): string {
  const pieces = [
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ' ', '-', '.', '+', '(', ')', '/', ':', 'IL', 'il', 'ID', 'ת.ז.', 'ח.פ.', 'א', 'ב', 'ש', 'ל', 'ום',
    'ext', 'x', '#', 'abc', 'Z', '_', '\t', '\n', 'IBAN', 'tel', 'מיקוד',
    LRM, RLM, ZWSP, BOM, NBSP, SOFT_HYPHEN, EN_DASH, MINUS_SIGN, cp(0x0663), cp(0x06f5), cp(0xff15), cp(0x1f600), cp(0x0301), '😀', cp(0),
  ];
  const len = Math.floor(rnd() * maxLen);
  let s = '';
  for (let i = 0; i < len; i++) s += pieces[Math.floor(rnd() * pieces.length)] ?? '';
  return s;
}
