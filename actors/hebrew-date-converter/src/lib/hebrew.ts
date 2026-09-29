/**
 * Hebrew-calendar vocabulary and formatting (pure, no dependencies).
 *
 * Month numbers follow the Hebcal / Torah convention used throughout this Actor family:
 * Nisan = 1 ... Elul = 6, Tishrei = 7 ... Sh'vat = 11, Adar = 12 (Adar I in a leap year),
 * Adar II = 13. The Hebrew year starts in Tishrei (month 7).
 *
 * The gematria (Hebrew numeral) formatter is our own: 15 and 16 are written ט״ו / ט״ז (never
 * יה / יו, which spell a divine name), one letter gets a geresh (׳), several letters get a
 * gershayim (״) before the last one, and the thousands are dropped for years 5000-5999
 * (5787 -> תשפ״ז). This file is copied verbatim into the sibling Actors; keep the copies identical.
 */

export interface HebrewDate {
  year: number;
  /** Nisan = 1 ... Tishrei = 7 ... Adar / Adar I = 12, Adar II = 13. */
  month: number;
  day: number;
}

export const MONTH_NISAN = 1;
export const MONTH_TISHREI = 7;
export const MONTH_CHESHVAN = 8;
export const MONTH_KISLEV = 9;
export const MONTH_TEVET = 10;
export const MONTH_SHVAT = 11;
export const MONTH_ADAR_I = 12;
export const MONTH_ADAR_II = 13;

/** Hebrew leap year (13 months): years 3, 6, 8, 11, 14, 17, 19 of the 19-year cycle. */
export function isHebrewLeapYear(year: number): boolean {
  return (7 * year + 1) % 19 < 7;
}

export function monthsInHebrewYear(year: number): 12 | 13 {
  return isHebrewLeapYear(year) ? 13 : 12;
}

const MONTH_EN: Record<number, string> = {
  1: 'Nisan',
  2: 'Iyyar',
  3: 'Sivan',
  4: 'Tamuz',
  5: 'Av',
  6: 'Elul',
  7: 'Tishrei',
  8: 'Cheshvan',
  9: 'Kislev',
  10: 'Tevet',
  11: "Sh'vat",
};

const MONTH_HE: Record<number, string> = {
  1: 'ניסן',
  2: 'אייר',
  3: 'סיון',
  4: 'תמוז',
  5: 'אב',
  6: 'אלול',
  7: 'תשרי',
  8: 'חשון',
  9: 'כסלו',
  10: 'טבת',
  11: 'שבט',
};

/** English (transliterated) month name; month 12 is "Adar I" in a leap year and "Adar" otherwise. */
export function hebrewMonthNameEn(month: number, year: number): string {
  if (month === MONTH_ADAR_I) return isHebrewLeapYear(year) ? 'Adar I' : 'Adar';
  if (month === MONTH_ADAR_II) return 'Adar II';
  return MONTH_EN[month] ?? `Month ${month}`;
}

export const GERESH = '׳'; // ׳
export const GERSHAYIM = '״'; // ״

export function hebrewMonthNameHe(month: number, year: number): string {
  if (month === MONTH_ADAR_I) return isHebrewLeapYear(year) ? `אדר א${GERESH}` : 'אדר';
  if (month === MONTH_ADAR_II) return `אדר ב${GERESH}`;
  return MONTH_HE[month] ?? `${month}`;
}

/** Position of the month within the Hebrew year, counted from Tishrei (Tishrei = 1 ... Elul = 12 or 13). */
export function hebrewMonthOfYear(month: number, year: number): number {
  if (month >= MONTH_TISHREI) return month - 6;
  return month + (isHebrewLeapYear(year) ? 7 : 6);
}

const UNITS = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת'];

/** Letters only (no punctuation) for 1..999. */
function numeralLetters(n: number): string {
  let out = '';
  let rest = n;
  while (rest >= 400) {
    out += 'ת';
    rest -= 400;
  }
  if (rest >= 100) {
    out += HUNDREDS[Math.floor(rest / 100)] ?? '';
    rest %= 100;
  }
  if (rest === 15) return `${out}טו`;
  if (rest === 16) return `${out}טז`;
  if (rest >= 10) {
    out += TENS[Math.floor(rest / 10)] ?? '';
    rest %= 10;
  }
  if (rest > 0) out += UNITS[rest] ?? '';
  return out;
}

/** Hebrew numeral with punctuation for 1..999: 17 -> י״ז, 30 -> ל׳, 787 -> תשפ״ז. */
export function gematriya(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 999) throw new RangeError(`gematriya supports 1..999, got ${n}`);
  const letters = numeralLetters(n);
  if (letters.length === 1) return `${letters}${GERESH}`;
  return `${letters.slice(0, -1)}${GERSHAYIM}${letters.slice(-1)}`;
}

/**
 * Hebrew year in letters. 5000-5999 drop the thousands (5787 -> תשפ״ז); every other year keeps them
 * with a geresh (4760 -> ד׳תש״ס, 6001 -> ו׳א׳), matching Hebcal's `gematriya()`.
 */
export function hebrewYearGematriya(year: number): string {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new RangeError(`Hebrew year out of range: ${year}`);
  const thousands = Math.floor(year / 1000);
  const rest = year % 1000;
  if (thousands === 0 || (thousands === 5 && rest > 0)) return gematriya(rest);
  const head = `${UNITS[thousands] ?? ''}${GERESH}`;
  return rest === 0 ? head : `${head}${gematriya(rest)}`;
}

/** "17 Tishrei 5787" */
export function formatHebrewDateEn(d: HebrewDate): string {
  return `${d.day} ${hebrewMonthNameEn(d.month, d.year)} ${d.year}`;
}

/** "י״ז בתשרי תשפ״ז" (day, "in" + month, year). */
export function formatHebrewDateHe(d: HebrewDate): string {
  return `${gematriya(d.day)} ב${hebrewMonthNameHe(d.month, d.year)} ${hebrewYearGematriya(d.year)}`;
}
