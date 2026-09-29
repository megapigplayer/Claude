/**
 * Thin adapter over `@hebcal/core` (GPL-2.0, see LICENSES.md): the ONLY file in this Actor that
 * imports it. Everything downstream (holidays.ts) works on plain `{year, month, day}` Hebrew dates
 * (src/lib/hebrew.ts) and ISO Gregorian strings, so the row-building logic stays pure and testable.
 *
 * Dates are formatted from `HDate`/`Date` using LOCAL component getters (getFullYear/getMonth/
 * getDate), exactly as the `@hebcal/hdate` `HDate.greg()` doc comment recommends - never
 * `toISOString()`, which converts to UTC first and can shift the date by one day off UTC.
 */
import { HDate, HebrewCalendar } from '@hebcal/core';
import type { CalOptions, Event } from '@hebcal/core';
import type { HebrewDate } from './hebrew.js';

export type { Event } from '@hebcal/core';

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** ISO Gregorian date (YYYY-MM-DD) of an event, read with local getters (see file docstring). */
export function eventIsoDate(ev: Event): string {
  const g = ev.getDate().greg();
  return `${pad(g.getFullYear(), 4)}-${pad(g.getMonth() + 1, 2)}-${pad(g.getDate(), 2)}`;
}

/** Hebrew {year, month, day} of an event, in this Actor family's month numbering (Nisan = 1 ... Adar II = 13). */
export function eventHebrewDate(ev: Event): HebrewDate {
  const hd = ev.getDate();
  return { year: hd.getFullYear(), month: hd.getMonth(), day: hd.getDate() };
}

/** Hebrew {year, month, day} of a given proleptic-Gregorian calendar date. */
export function hebrewDateOfGregorian(year: number, month: number, day: number): HebrewDate {
  const hd = new HDate(new Date(year, month - 1, day));
  return { year: hd.getFullYear(), month: hd.getMonth(), day: hd.getDate() };
}

/** Number of days in a Hebrew year (353-355 regular, 383-385 leap). */
export function daysInHebrewYear(year: number): number {
  return HDate.daysInYear(year);
}

/**
 * Every event `@hebcal/core` knows about for one calendar year (Gregorian or Hebrew), with every
 * optional category switched ON. Callers filter the result by category (holidays.ts); this keeps
 * one code path instead of trying to map this Actor's `include` list onto Hebcal's own on/off
 * switches (which bundle categories differently - see holidays.ts for the mapping).
 */
export function yearEvents(year: number, isHebrewYear: boolean, il: boolean): Event[] {
  const opts: CalOptions = {
    year,
    isHebrewYear,
    il,
    omer: true,
    sedrot: true,
    noMinorFast: false,
    noModern: false,
    noRoshChodesh: false,
    noSpecialShabbat: false,
    noHolidays: false,
  };
  return HebrewCalendar.calendar(opts);
}
