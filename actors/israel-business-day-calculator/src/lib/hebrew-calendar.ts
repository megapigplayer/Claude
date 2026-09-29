/**
 * Thin adapter over `@hebcal/core` (GPL-2.0, see LICENSES.md): the ONLY file in this Actor that
 * imports it. Provides (a) Gregorian civil date -> Hebrew date for the `resultHebrewDate` output
 * field, and (b) a lazily-cached, per-Gregorian-year lookup of the statutory Israeli holiday set and
 * "Erev chag" (half-day) dates, so a long date walk (`add`/`subtract` over many days) does not
 * re-run the calendar generator once per day.
 */
import { HDate, HebrewCalendar } from '@hebcal/core';
import type { HebrewDate } from './hebrew.js';

export function rdToHebrew(rd: number): HebrewDate {
  const hd = new HDate(rd);
  return { year: hd.getFullYear(), month: hd.getMonth(), day: hd.getDate() };
}

/**
 * The nine statutory Israeli public-holiday days (same explicit table as jewish-holidays-calendar's
 * README/tests: Rosh Hashanah x2, Yom Kippur, Sukkot I, Shemini Atzeret, Pesach I and VII, Shavuot,
 * Yom HaAtzma'ut), matched against the Israel-schedule (il=true) English description with any
 * trailing " <year>" suffix stripped. These are the days banks, offices and (per the TASE profile)
 * the exchange itself close for; Purim/Chanukah/Tu BiShvat/minor fasts etc. are ordinary business
 * days here (Chol HaMoed is a business day by default too, and is deliberately NOT in this set).
 */
const STATUTORY_IL_HOLIDAYS: ReadonlySet<string> = new Set([
  'Rosh Hashana',
  'Rosh Hashana II',
  'Yom Kippur',
  'Sukkot I',
  'Shmini Atzeret',
  'Pesach I',
  'Pesach VII',
  'Shavuot',
  "Yom HaAtzma'ut",
]);

function isStatutoryDesc(desc: string): boolean {
  return STATUTORY_IL_HOLIDAYS.has(desc.replace(/ \d{4}$/, ''));
}

export interface NamedHoliday {
  en: string;
  he: string;
}

export interface YearHolidays {
  /** Gregorian ISO date (YYYY-MM-DD) -> statutory holiday name. */
  holidays: Map<string, NamedHoliday>;
  /** Gregorian ISO date (YYYY-MM-DD) of an "Erev" (eve of a Yom Tov) day -> what it is the eve of. */
  erev: Map<string, NamedHoliday>;
}

const HE_NO_NIKUD = 'he-x-NoNikud';

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

function computeYear(year: number): YearHolidays {
  const events = HebrewCalendar.calendar({ year, isHebrewYear: false, il: true });
  const holidays = new Map<string, NamedHoliday>();
  const erev = new Map<string, NamedHoliday>();
  for (const ev of events) {
    const desc = ev.getDesc();
    const g = ev.getDate().greg();
    const iso = `${pad(g.getFullYear(), 4)}-${pad(g.getMonth() + 1)}-${pad(g.getDate())}`;
    const he = ev.render(HE_NO_NIKUD);
    if (isStatutoryDesc(desc)) holidays.set(iso, { en: desc, he });
    if (ev.hasAnyFlag('EREV')) erev.set(iso, { en: desc.replace(/^Erev /, ''), he: he.replace(/^עֶרֶב /, '') });
  }
  return { holidays, erev };
}

/** Lazy per-Gregorian-year cache (module-level: one calendar per process, reused across many lookups). */
const yearCache = new Map<number, YearHolidays>();

function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

function getYear(year: number): YearHolidays {
  let cached = yearCache.get(year);
  if (!cached) {
    cached = computeYear(year);
    yearCache.set(year, cached);
  }
  return cached;
}

/** Statutory Israeli holiday name for this ISO date, or null. */
export function statutoryHolidayOn(iso: string): NamedHoliday | null {
  return getYear(yearOf(iso)).holidays.get(iso) ?? null;
}

/** What this ISO date is "Erev" (the eve) of, or null if it is not an Erev-chag day. */
export function erevOn(iso: string): NamedHoliday | null {
  return getYear(yearOf(iso)).erev.get(iso) ?? null;
}

/** Test-only: clears the year cache (each year is recomputed from @hebcal/core, not memory). */
export function clearHolidayCache(): void {
  yearCache.clear();
}
