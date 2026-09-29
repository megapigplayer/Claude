/**
 * Timezone-free civil-date arithmetic (proleptic Gregorian calendar) on Rata Die day numbers.
 *
 * R.D. 1 = 0001-01-01, a Monday - the same day numbering `@hebcal/hdate` calls "abs".
 * Nothing here touches `Date`, so results never depend on the host time zone, on DST, or on
 * JavaScript's "years 0-99 mean 1900-1999" constructor quirk. The Actor family copies this
 * file verbatim (each Actor folder must stay self-contained); keep the copies identical.
 *
 * The Gregorian calendar is applied proleptically to every year (no Julian calendar before
 * 1582), exactly like ISO 8601, JavaScript `Date`, and Hebcal.
 */

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/** R.D. number of 1970-01-01. */
export const RD_UNIX_EPOCH = 719163;

export const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const WEEKDAYS_HE = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'] as const;
export const WEEKDAY_SHORT_EN = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function isGregorianLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInGregorianMonth(year: number, month: number): number {
  if (month === 2) return isGregorianLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** True when year/month/day is a real proleptic-Gregorian date (year >= 1). */
export function isValidCivil(year: number, month: number, day: number): boolean {
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInGregorianMonth(year, month)
  );
}

/** Howard Hinnant's `days_from_civil`, shifted so that 0001-01-01 = R.D. 1. */
export function civilToRd(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468 + RD_UNIX_EPOCH;
}

/** Inverse of {@link civilToRd}. */
export function rdToCivil(rd: number): CivilDate {
  const z = rd - RD_UNIX_EPOCH + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return { year, month, day };
}

/** Day of week of an R.D. number: 0 = Sunday ... 6 = Saturday. */
export function weekdayOfRd(rd: number): number {
  return ((rd % 7) + 7) % 7;
}

export function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

export function formatCivil(c: CivilDate): string {
  return `${pad(c.year, 4)}-${pad(c.month, 2)}-${pad(c.day, 2)}`;
}

export function isoFromRd(rd: number): string {
  return formatCivil(rdToCivil(rd));
}

export type IsoParseResult = { ok: true; rd: number; civil: CivilDate } | { ok: false; code: 'FORMAT' | 'INVALID_DATE'; detail: string };

/**
 * Strict ISO 8601 calendar date `YYYY-MM-DD` (4-digit year, 2-digit month and day).
 * A real calendar check is applied: 2026-02-30 is INVALID_DATE, not silently rolled over.
 */
export function parseIsoDate(text: string): IsoParseResult {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return { ok: false, code: 'FORMAT', detail: 'expected YYYY-MM-DD' };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!isValidCivil(year, month, day)) {
    return { ok: false, code: 'INVALID_DATE', detail: `${text.trim()} is not a real calendar date` };
  }
  return { ok: true, rd: civilToRd(year, month, day), civil: { year, month, day } };
}

/** Add whole days to an R.D. number (plain integer arithmetic, kept for readability at call sites). */
export function addDays(rd: number, days: number): number {
  return rd + days;
}

/** Calendar-month arithmetic helper: R.D. of the last day of the Gregorian month containing `rd`. */
export function endOfGregorianMonthRd(rd: number): number {
  const c = rdToCivil(rd);
  return civilToRd(c.year, c.month, daysInGregorianMonth(c.year, c.month));
}
