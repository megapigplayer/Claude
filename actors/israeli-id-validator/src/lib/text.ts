/**
 * Cleaning of identifiers typed by people or exported from spreadsheets (pure, never throws).
 *
 * Handles: bidi controls (LRM/RLM, embeddings, isolates, ALM), zero-width characters and soft hyphens (all
 * Unicode category Cf), no-break and exotic spaces and full-width forms (via NFKC), and Arabic-Indic /
 * Persian digits (which NFKC does NOT convert).
 *
 * Source hygiene: this file deliberately contains no invisible characters and no backslash-u escapes;
 * property escapes and code-point arithmetic are used instead (a unit test scans src/ for hidden characters).
 */
import type { WarningCode } from './types.js';

/** Characters that are invisible in every renderer but break naive digit checks (Unicode category Cf). */
const INVISIBLE = /\p{Cf}/gu;

/** Arabic-Indic digits start at this code point (U+0660), Extended Arabic-Indic / Persian at U+06F0. */
const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;
const NON_ASCII_DIGIT = new RegExp(
  `[${String.fromCodePoint(ARABIC_INDIC_ZERO)}-${String.fromCodePoint(ARABIC_INDIC_ZERO + 9)}` +
    `${String.fromCodePoint(EXTENDED_ARABIC_INDIC_ZERO)}-${String.fromCodePoint(EXTENDED_ARABIC_INDIC_ZERO + 9)}` +
    `${String.fromCodePoint(0xff10)}-${String.fromCodePoint(0xff19)}]`,
  'u',
);

/** Dash-like characters (Unicode category Pd: hyphen-minus, hyphen, non-breaking hyphen, en/em dashes ...) plus the minus sign. */
const MINUS_SIGN = String.fromCodePoint(0x2212);
export const DASH_CLASS = `\\p{Pd}${MINUS_SIGN}`;
/** Separators removed from numeric identifiers: whitespace, dots and dashes. */
export const NUMERIC_SEPARATORS = new RegExp(`[\\s.${DASH_CLASS}]+`, 'gu');

export interface CleanedInput {
  text: string;
  warnings: WarningCode[];
}

export function isBlank(raw: string): boolean {
  return raw.replace(INVISIBLE, '').trim() === '';
}

/** Maps Arabic-Indic and Persian digits to ASCII digits (NFKC handles the full-width ones). */
function mapDigits(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) out += String(code - ARABIC_INDIC_ZERO);
    else if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) out += String(code - EXTENDED_ARABIC_INDIC_ZERO);
    else out += ch;
  }
  return out;
}

/**
 * `normalize = true`: strip invisible characters, map Arabic-Indic digits to ASCII, NFKC-normalise and trim.
 * `normalize = false` (strict): only trim the outer whitespace; everything else is left for the checkers
 * to reject.
 */
export function cleanInput(raw: string, normalize: boolean): CleanedInput {
  const warnings: WarningCode[] = [];
  const original = String(raw ?? '');
  if (!normalize) return { text: original.trim(), warnings };

  let text = original.replace(INVISIBLE, '');
  if (text.length !== original.length) warnings.push('INVISIBLE_CHARACTERS_REMOVED');

  if (NON_ASCII_DIGIT.test(text)) {
    text = mapDigits(text);
    warnings.push('NON_ASCII_DIGITS_CONVERTED');
  }
  return { text: text.normalize('NFKC').trim(), warnings };
}

/** First character of `text` that is not matched by `allowed`, as a printable string (for messages). */
export function firstDisallowed(text: string, allowed: RegExp): string | null {
  for (const ch of text) if (!allowed.test(ch)) return JSON.stringify(ch);
  return null;
}
