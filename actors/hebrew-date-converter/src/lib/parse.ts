/**
 * Parsing of caller-supplied dates (pure). Accepted, and nothing else:
 *
 *  - Gregorian ISO dates `YYYY-MM-DD` (also `YYYY/MM/DD`, `YYYY.MM.DD`; a time of exactly midnight is
 *    tolerated because spreadsheets append it, any other time of day is rejected because the Actor
 *    does not interpret clock times - use `afterSunset`), and English dates with a month NAME
 *    ("12 September 2026", "September 12, 2026", "12 Sep 2026"),
 *  - Hebrew dates in English ("17 Tishrei 5787", "17th of Tishrei, 5787", "Tishrei 17, 5787",
 *    "1 Adar II 5784") and in Hebrew letters ("י״ז בתשרי תשפ״ז", "ט״ו באדר ב׳ תשפ״ד"),
 *  - objects: `{"date": "2026-09-12", "afterSunset": true}`, `{"day": 17, "month": "Tishrei", "year": 5787}`
 *    (month = name, or a number with Nisan = 1 ... Adar II = 13), optional `"calendar": "gregorian" | "hebrew"`.
 *
 * Deliberately NOT accepted: 12/09/2026 and other numeric day/month/year orders (day-first versus
 * month-first cannot be told apart), and a bare "Adar" in a leap year (Adar I or Adar II?).
 * Bad input yields a result object with a machine-readable `code`; nothing here throws.
 */
import { civilToRd, isValidCivil } from './civil.js';
import { type HebrewDate, MONTH_ADAR_I, MONTH_ADAR_II, hebrewMonthNameEn, isHebrewLeapYear } from './hebrew.js';
import { daysInHebrewMonth, hebrewToRd } from './hebrew-calendar.js';

export type Direction = 'auto' | 'g2h' | 'h2g';

/** Supported range: Gregorian 0001-01-01 ... 6000-12-31 (Hebrew 3761 ... 9761). */
export const MIN_RD = 1;
export const MAX_RD = civilToRd(6000, 12, 31);
export const MIN_HEBREW_YEAR = 3761;
export const MAX_HEBREW_YEAR_INPUT = 9999;

export type ParsedItem =
  | { kind: 'blank' }
  | { kind: 'gregorian'; rd: number; afterSunset: boolean | null }
  | { kind: 'hebrew'; date: HebrewDate; rd: number }
  | { kind: 'error'; code: ParseErrorCode; reason: string };

export type ParseErrorCode =
  | 'UNSUPPORTED_ITEM'
  | 'UNRECOGNIZED_FORMAT'
  | 'AMBIGUOUS_DATE_FORMAT'
  | 'INVALID_DATE'
  | 'TIME_NOT_SUPPORTED'
  | 'UNKNOWN_MONTH'
  | 'AMBIGUOUS_ADAR'
  | 'INVALID_MONTH_FOR_YEAR'
  | 'INVALID_DAY_FOR_MONTH'
  | 'BAD_HEBREW_NUMERAL'
  | 'YEAR_OUT_OF_RANGE'
  | 'WRONG_DIRECTION';

const err = (code: ParseErrorCode, reason: string): ParsedItem => ({ kind: 'error', code, reason });

// ---------------------------------------------------------------------------------------------
// Text cleaning
// ---------------------------------------------------------------------------------------------

/** Bidi marks/embeddings/isolates, zero-width characters, BOM (spreadsheets and RTL text add these). */
const INVISIBLES = /[؜​-‏‪-‮⁠-⁩﻿]/g;
/** Hebrew points and cantillation marks (niqqud, teamim). */
const NIQQUD = /[֑-ׇֽֿׁׂׅׄ]/g;
const ODD_SPACES = /[   -   　]/g;

export function cleanText(text: string): string {
  return text.replace(INVISIBLES, '').replace(ODD_SPACES, ' ').replace(/־/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------------------------
// Month names
// ---------------------------------------------------------------------------------------------

/**
 * `{ adar: true }` is a bare "Adar" that needs the year to be resolved. `explicitAdarI` marks a
 * spelled-out "Adar I", which must be rejected in a regular year (instead of silently becoming Adar).
 */
export type MonthLookup = { month: number; explicitAdarI?: true } | { adar: true } | null;

const EN_MONTHS: Record<string, number> = {
  nisan: 1, nissan: 1, nisaan: 1,
  iyar: 2, iyyar: 2, iyyor: 2, ayar: 2,
  sivan: 3, siwan: 3,
  tamuz: 4, tammuz: 4, tamoz: 4,
  av: 5, ab: 5, menachemav: 5, menachemab: 5,
  elul: 6,
  tishrei: 7, tishri: 7, tishre: 7, tishrey: 7, tishrai: 7, tisrei: 7,
  cheshvan: 8, heshvan: 8, marcheshvan: 8, marheshvan: 8, cheshvon: 8, heshvon: 8, cheshwan: 8,
  kislev: 9, kislew: 9, chislev: 9, kislov: 9,
  tevet: 10, teves: 10, tebet: 10, teveth: 10, tebeth: 10,
  shvat: 11, shevat: 11, shebat: 11, shevet: 11,
  adari: MONTH_ADAR_I, adar1: MONTH_ADAR_I, adarrishon: MONTH_ADAR_I, adaraleph: MONTH_ADAR_I, adar1st: MONTH_ADAR_I,
  adarii: MONTH_ADAR_II, adar2: MONTH_ADAR_II, adarsheni: MONTH_ADAR_II, adarbet: MONTH_ADAR_II, adar2nd: MONTH_ADAR_II,
};

const HE_MONTHS: Record<string, number> = {
  ניסן: 1, אייר: 2, איר: 2, סיון: 3, סיוון: 3, תמוז: 4, אב: 5, 'מנחם אב': 5, אלול: 6,
  תשרי: 7, חשון: 8, חשוון: 8, מרחשון: 8, מרחשוון: 8, כסלו: 9, כסליו: 9, טבת: 10, שבט: 11,
  'אדר א': MONTH_ADAR_I, 'אדר ראשון': MONTH_ADAR_I,
  'אדר ב': MONTH_ADAR_II, 'אדר שני': MONTH_ADAR_II,
};

const GREGORIAN_MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};

function withResult(month: number): MonthLookup {
  return month === MONTH_ADAR_I ? { month, explicitAdarI: true } : { month };
}

/** Month name (English transliteration or Hebrew, with or without a leading ב) -> month number. */
export function lookupMonthName(text: string): MonthLookup {
  const raw = cleanText(text).replace(NIQQUD, '');
  if (raw === '') return null;
  if (/[א-ת]/.test(raw)) {
    const he = raw.replace(/[׳״'"’‘“”`]/g, '').replace(/\s+/g, ' ');
    for (const candidate of [he, he.startsWith('ב') ? he.slice(1) : null]) {
      if (candidate === null) continue;
      if (candidate === 'אדר') return { adar: true };
      const hit = HE_MONTHS[candidate];
      if (hit !== undefined) return withResult(hit);
    }
    return null;
  }
  const key = raw
    .toLowerCase()
    .replace(/[’'`´.]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (key === 'adar') return { adar: true };
  const hit = EN_MONTHS[key.replace(/ /g, '')];
  return hit === undefined ? null : withResult(hit);
}

// ---------------------------------------------------------------------------------------------
// Gematria (Hebrew numerals) parsing
// ---------------------------------------------------------------------------------------------

const LETTER_VALUE: Record<string, number> = {
  א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9,
  י: 10, כ: 20, ך: 20, ל: 30, מ: 40, ם: 40, נ: 50, ן: 50, ס: 60, ע: 70, פ: 80, ף: 80, צ: 90, ץ: 90,
  ק: 100, ר: 200, ש: 300, ת: 400,
};

const PUNCT = /[׳״'"’‘“”`]/g;

/** Value of a run of Hebrew numeral letters (1..999), or null when it is not a well-formed numeral. */
function numeralValue(letters: string): number | null {
  if (letters === '' || !/^[א-ת]+$/.test(letters)) return null;
  let total = 0;
  let previous = Number.POSITIVE_INFINITY;
  for (const ch of letters) {
    const v = LETTER_VALUE[ch];
    if (v === undefined) return null;
    // Letters must not increase; only ת (400) may repeat (תת = 800).
    if (v > previous || (v === previous && v !== 400)) return null;
    previous = v;
    total += v;
  }
  return total >= 1 && total <= 999 ? total : null;
}

/**
 * Hebrew numeral token -> number. Accepts geresh/gershayim/quote variants or none, and a leading
 * thousands letter with geresh ("ה׳תשפ״ז" = 5787). Returns null when malformed.
 */
export function parseGematriya(token: string): number | null {
  const t = cleanText(token).replace(NIQQUD, '');
  const withThousands = /^([א-ט])[׳'’](.+)$/.exec(t);
  if (withThousands) {
    const thousandsValue = LETTER_VALUE[withThousands[1] as string];
    const rest = numeralValue((withThousands[2] as string).replace(PUNCT, ''));
    if (thousandsValue === undefined || rest === null) return null;
    return thousandsValue * 1000 + rest;
  }
  return numeralValue(t.replace(PUNCT, ''));
}

// ---------------------------------------------------------------------------------------------
// Hebrew date validation (shared by the string and object parsers)
// ---------------------------------------------------------------------------------------------

/** `monthLookup` may be a bare "Adar" that needs the year to be resolved. */
function buildHebrewDate(day: number, monthLookup: NonNullable<MonthLookup>, year: number): ParsedItem {
  if (!Number.isInteger(year) || year < MIN_HEBREW_YEAR || year > MAX_HEBREW_YEAR_INPUT) {
    return err('YEAR_OUT_OF_RANGE', `Hebrew year ${year} is outside the supported range ${MIN_HEBREW_YEAR}-${MAX_HEBREW_YEAR_INPUT} (Gregorian year 1 onwards).`);
  }
  const leap = isHebrewLeapYear(year);
  let month: number;
  if ('adar' in monthLookup) {
    if (leap) {
      return err('AMBIGUOUS_ADAR', `"Adar" is ambiguous in ${year}, a leap year with two Adars: write "Adar I" or "Adar II".`);
    }
    month = MONTH_ADAR_I;
  } else {
    month = monthLookup.month;
    if (month === MONTH_ADAR_II && !leap) {
      return err('INVALID_MONTH_FOR_YEAR', `Adar II only exists in leap years; ${year} is not a leap year (use "Adar").`);
    }
    if (monthLookup.explicitAdarI && !leap) {
      return err('INVALID_MONTH_FOR_YEAR', `Adar I only exists in leap years; ${year} is not a leap year (use "Adar").`);
    }
  }
  if (!Number.isInteger(day) || day < 1 || day > 30) {
    return err('INVALID_DAY_FOR_MONTH', `Day ${day} is not valid: Hebrew months have 29 or 30 days.`);
  }
  const length = daysInHebrewMonth(month, year);
  if (day > length) {
    const name = hebrewMonthNameEn(month, year);
    return err('INVALID_DAY_FOR_MONTH', `${name} ${year} has only ${length} days, so day ${day} does not exist (30 ${name} occurs only in some years).`);
  }
  const rd = hebrewToRd({ year, month, day });
  if (rd < MIN_RD || rd > MAX_RD) {
    return err('YEAR_OUT_OF_RANGE', `${day} ${hebrewMonthNameEn(month, year)} ${year} is outside the supported range (Gregorian 0001-01-01 to 6000-12-31).`);
  }
  return { kind: 'hebrew', date: { year, month, day }, rd };
}

function buildGregorian(year: number, month: number, day: number, original: string): ParsedItem {
  if (!isValidCivil(year, month, day)) return err('INVALID_DATE', `"${original}" is not a real calendar date.`);
  const rd = civilToRd(year, month, day);
  if (rd > MAX_RD) return err('YEAR_OUT_OF_RANGE', `"${original}" is beyond the supported range (up to 6000-12-31).`);
  return { kind: 'gregorian', rd, afterSunset: null };
}

// ---------------------------------------------------------------------------------------------
// String parsing
// ---------------------------------------------------------------------------------------------

const ISO_LIKE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;
const NUMERIC_AMBIGUOUS = /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/;
const EN_DAY_MONTH_YEAR = /^(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+(.+?)[,\s]+(\d{4})$/i;
const EN_MONTH_DAY_YEAR = /^(.+?)\s+(\d{1,2})(?:st|nd|rd|th)?[,\s]+(\d{4})$/i;

/** Parse a Hebrew-letter date such as "י״ז בתשרי תשפ״ז" or "ט״ו באדר ב׳ תשפ״ד". */
function parseHebrewLetters(text: string): ParsedItem {
  const tokens = cleanText(text).replace(NIQQUD, '').split(' ').filter((t) => t !== '');
  if (tokens.length < 3) {
    return err('UNRECOGNIZED_FORMAT', `Could not read "${text}" as a Hebrew date; expected day, month and year, e.g. "י״ז בתשרי תשפ״ז".`);
  }
  const dayToken = tokens[0] as string;
  const yearToken = tokens[tokens.length - 1] as string;
  let monthTokens = tokens.slice(1, -1);
  if (monthTokens[0] === 'ב' && monthTokens.length > 1) monthTokens = monthTokens.slice(1); // "ב תשרי"

  const day = /^\d{1,2}$/.test(dayToken) ? Number(dayToken) : parseGematriya(dayToken);
  if (day === null) return err('BAD_HEBREW_NUMERAL', `"${dayToken}" is not a valid Hebrew numeral for the day of the month.`);

  let year: number | null;
  if (/^\d{4}$/.test(yearToken)) year = Number(yearToken);
  else {
    const n = parseGematriya(yearToken);
    year = n === null ? null : n < 1000 ? n + 5000 : n;
  }
  if (year === null) return err('BAD_HEBREW_NUMERAL', `"${yearToken}" is not a valid Hebrew numeral for the year.`);

  const monthText = monthTokens.join(' ');
  const month = lookupMonthName(monthText);
  if (month === null) return err('UNKNOWN_MONTH', `"${monthText}" is not a Hebrew month name.`);
  return buildHebrewDate(day, month, year);
}

/** Parse one string. `direction` restricts what may be accepted. */
export function parseDateString(input: string, direction: Direction): ParsedItem {
  const text = cleanText(input);
  if (text === '') return { kind: 'blank' };

  const iso = ISO_LIKE.exec(text);
  if (iso) {
    if (direction === 'h2g') return err('WRONG_DIRECTION', `direction is "h2g" but "${text}" is a Gregorian date; use "g2h" or "auto".`);
    if (iso[4] !== undefined) {
      const zero = Number(iso[4]) === 0 && Number(iso[5]) === 0 && Number(iso[6] ?? 0) === 0;
      if (!zero) {
        return err('TIME_NOT_SUPPORTED', `"${text}" has a time of day. The Actor converts whole dates and does not interpret clock times: pass "${iso[1]}-${iso[2]}-${iso[3]}" and set afterSunset=true for events after sunset.`);
      }
    }
    return buildGregorian(Number(iso[1]), Number(iso[2]), Number(iso[3]), text);
  }
  if (NUMERIC_AMBIGUOUS.test(text)) {
    return err('AMBIGUOUS_DATE_FORMAT', `"${text}" could be day/month/year or month/day/year. Use ISO format YYYY-MM-DD (for example 2026-09-12).`);
  }
  if (direction === 'g2h') {
    return err('UNRECOGNIZED_FORMAT', `direction is "g2h" but "${text}" is not a Gregorian date; use ISO format YYYY-MM-DD.`);
  }

  if (/[א-ת]/.test(text)) return parseHebrewLetters(text);

  const dmy = EN_DAY_MONTH_YEAR.exec(text);
  const mdy = dmy ? null : EN_MONTH_DAY_YEAR.exec(text);
  const m = dmy ?? mdy;
  if (m) {
    const day = Number(dmy ? dmy[1] : mdy?.[2]);
    const monthText = (dmy ? dmy[2] : mdy?.[1]) as string;
    const year = Number(dmy ? dmy[3] : mdy?.[3]);
    const gregorianMonth = GREGORIAN_MONTHS[monthText.trim().toLowerCase().replace(/\.$/, '')];
    if (gregorianMonth !== undefined) {
      if (direction === 'h2g') return err('WRONG_DIRECTION', `direction is "h2g" but "${text}" is a Gregorian date; use "g2h" or "auto".`);
      return buildGregorian(year, gregorianMonth, day, text);
    }
    const month = lookupMonthName(monthText);
    if (month === null) return err('UNKNOWN_MONTH', `"${monthText}" is not a Hebrew month name (examples: Tishrei, Cheshvan, Kislev, Adar II, Nisan).`);
    return buildHebrewDate(day, month, year);
  }
  return err(
    'UNRECOGNIZED_FORMAT',
    `Could not read "${text}". Use an ISO date (2026-09-12), an English Hebrew date ("17 Tishrei 5787") or Hebrew letters ("י״ז בתשרי תשפ״ז").`,
  );
}

// ---------------------------------------------------------------------------------------------
// Objects and top-level entry point
// ---------------------------------------------------------------------------------------------

function asBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (t === 'true' || t === 'yes' || t === '1') return true;
    if (t === 'false' || t === 'no' || t === '0') return false;
  }
  return null;
}

function asInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  return undefined;
}

function parseObject(obj: Record<string, unknown>, direction: Direction): ParsedItem {
  const afterSunset = asBool(obj.afterSunset);
  const dateText = pick(obj, 'date', 'gregorian', 'iso');
  if (typeof dateText === 'string') {
    const parsed = parseDateString(dateText, direction === 'h2g' ? 'h2g' : 'g2h');
    return parsed.kind === 'gregorian' ? { ...parsed, afterSunset } : parsed;
  }

  const dayV = pick(obj, 'day', 'hebrewDay');
  const monthV = pick(obj, 'month', 'hebrewMonth');
  const yearV = pick(obj, 'year', 'hebrewYear');
  if (dayV === undefined || monthV === undefined || yearV === undefined) {
    return err('UNRECOGNIZED_FORMAT', 'Object needs either "date" (ISO string) or "day", "month" and "year" (Hebrew date; month = name or number 1-13 with Nisan = 1).');
  }
  const day = asInt(dayV);
  const year = asInt(yearV);
  if (day === null || year === null) return err('UNRECOGNIZED_FORMAT', '"day" and "year" must be whole numbers.');

  const calendar = typeof obj.calendar === 'string' ? obj.calendar.trim().toLowerCase() : '';
  const monthNumber = asInt(monthV);
  const explicitHebrew = calendar === 'hebrew' || calendar === 'h';
  const explicitGregorian = calendar === 'gregorian' || calendar === 'g' || calendar === 'iso';
  const isHebrew = explicitHebrew || (!explicitGregorian && (monthNumber === null || year >= MIN_HEBREW_YEAR));

  if (!isHebrew) {
    if (direction === 'h2g') return err('WRONG_DIRECTION', 'direction is "h2g" but the object is a Gregorian date.');
    if (monthNumber === null) return err('UNRECOGNIZED_FORMAT', 'Gregorian objects need a numeric month 1-12.');
    const parsed = buildGregorian(year, monthNumber, day, `${year}-${monthNumber}-${day}`);
    return parsed.kind === 'gregorian' ? { ...parsed, afterSunset } : parsed;
  }

  if (direction === 'g2h') return err('WRONG_DIRECTION', 'direction is "g2h" but the object is a Hebrew date.');
  let month: MonthLookup;
  if (monthNumber !== null) {
    if (monthNumber < 1 || monthNumber > 13) {
      return err('UNKNOWN_MONTH', `Month number ${monthNumber} is not valid: use 1-13 with Nisan = 1 ... Tishrei = 7 ... Adar II = 13.`);
    }
    // Numeric 12 means "the Adar of a regular year" / "Adar I of a leap year": never ambiguous.
    month = { month: monthNumber };
  } else {
    month = lookupMonthName(String(monthV));
    if (month === null) return err('UNKNOWN_MONTH', `"${String(monthV)}" is not a Hebrew month name.`);
  }
  return buildHebrewDate(day, month, year);
}

/** Parse one entry of the `dates` input list. Never throws. */
export function parseDateItem(item: unknown, direction: Direction): ParsedItem {
  try {
    if (item === null || item === undefined) return { kind: 'blank' };
    if (typeof item === 'string') return parseDateString(item, direction);
    if (typeof item === 'object' && !Array.isArray(item)) return parseObject(item as Record<string, unknown>, direction);
    return err('UNSUPPORTED_ITEM', `Unsupported entry of type ${Array.isArray(item) ? 'array' : typeof item}: use a date string or an object.`);
  } catch (e) {
    return err('UNRECOGNIZED_FORMAT', `Could not read this entry: ${e instanceof Error ? e.message : String(e)}`);
  }
}
