/**
 * Small civil-date helpers built on the LOCAL `Date` constructor (verified TZ-safe for this Actor's
 * purposes in zmanim.ts's docstring). Kept separate from a full RD-based calendar system: this Actor
 * only ever needs "parse an ISO date", "which weekday", and "add N days/weeks".
 */
export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export function isLeapGregorianYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapGregorianYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** Strict ISO 8601 calendar date `YYYY-MM-DD`; a real calendar check is applied (2026-02-30 is rejected). */
export function parseIsoCivilDate(text: string): CivilDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** 0 = Sunday ... 6 = Saturday, via the local `Date` constructor. */
export function weekdayOf(c: CivilDate): number {
  return new Date(c.year, c.month - 1, c.day).getDay();
}

export function addDays(c: CivilDate, days: number): CivilDate {
  const d = new Date(c.year, c.month - 1, c.day + days);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

export function formatIsoCivilDate(c: CivilDate): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${pad(c.year, 4)}-${pad(c.month)}-${pad(c.day)}`;
}

export interface FridayResolution {
  friday: CivilDate;
  /** True when the input date was not already a Friday and was rolled forward to the next one. */
  rolled: boolean;
}

/** The requested date if it is already a Friday, otherwise the next Friday (never backward). */
export function resolveFriday(c: CivilDate): FridayResolution {
  const weekday = weekdayOf(c); // 0=Sun ... 5=Fri ... 6=Sat
  const daysToFriday = (5 - weekday + 7) % 7;
  return { friday: daysToFriday === 0 ? c : addDays(c, daysToFriday), rolled: daysToFriday !== 0 };
}
