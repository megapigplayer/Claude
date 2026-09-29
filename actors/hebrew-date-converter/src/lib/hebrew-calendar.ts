/**
 * Thin adapter over `@hebcal/core` (GPL-2.0, see LICENSES.md): the ONLY place in this Actor that
 * talks to the calendar library. Everything else works on plain `{year, month, day}` objects and
 * Rata Die day numbers, which keeps the rest of the code (parsing, formatting, anniversary rules)
 * pure and lets the tests compare this adapter against independent implementations.
 *
 * No `Date` object is ever created here: conversions go through R.D. numbers, so results do not
 * depend on the host time zone.
 */
import { HDate, HebrewCalendar, Locale } from '@hebcal/core';
import type { Event } from '@hebcal/core';
import type { HebrewDate } from './hebrew.js';

export function rdToHebrew(rd: number): HebrewDate {
  const hd = new HDate(rd);
  return { year: hd.getFullYear(), month: hd.getMonth(), day: hd.getDate() };
}

export function hebrewToRd(d: HebrewDate): number {
  return HDate.hebrew2abs(d.year, d.month, d.day);
}

export function daysInHebrewMonth(month: number, year: number): number {
  return HDate.daysInMonth(month, year);
}

export function daysInHebrewYear(year: number): number {
  return HDate.daysInYear(year);
}

/** Cheshvan has 30 days ("complete" / male'ah years). */
export function isLongCheshvan(year: number): boolean {
  return HDate.longCheshvan(year);
}

/** Kislev has only 29 days ("deficient" / chaserah years). */
export function isShortKislev(year: number): boolean {
  return HDate.shortKislev(year);
}

export interface NamedTag {
  en: string;
  he: string;
}

export interface DayTags {
  holidays: NamedTag[];
  parasha: NamedTag | null;
}

const HE_NO_NIKUD = 'he-x-NoNikud';

/** Sort key: Yom Tov and other major days first, then fasts, minor days, modern days, Rosh Chodesh, special Shabbatot. */
function holidayRank(ev: Event): number {
  if (ev.hasAnyFlag('CHAG', 'CHOL_HAMOED')) return 0;
  if (ev.hasAnyFlag('MAJOR_FAST', 'MINOR_FAST')) return 1;
  if (ev.hasAnyFlag('MINOR_HOLIDAY')) return 2;
  if (ev.hasAnyFlag('MODERN_HOLIDAY')) return 3;
  if (ev.hasAnyFlag('ROSH_CHODESH')) return 4;
  return 5;
}

/**
 * Holidays observed on the daytime of `rd`, and the weekly Torah portion when `rd` is a Shabbat that
 * has one (Shabbatot that are also Yom Tov read the festival portion: `parasha` is null then).
 */
export function tagsForRd(rd: number, il: boolean): DayTags {
  const hd = new HDate(rd);
  const events = (HebrewCalendar.getHolidaysOnDate(hd, il) ?? []).slice();
  events.sort((a, b) => holidayRank(a) - holidayRank(b) || a.getDesc().localeCompare(b.getDesc()));
  const holidays: NamedTag[] = events.map((ev) => ({ en: ev.getDesc(), he: ev.render(HE_NO_NIKUD) }));

  let parasha: NamedTag | null = null;
  if (hd.getDay() === 6) {
    const reading = HebrewCalendar.getSedra(hd.getFullYear(), il).lookup(hd);
    if (!reading.chag && reading.parsha.length > 0) {
      parasha = {
        en: reading.parsha.join('-'),
        he: reading.parsha.map((p) => Locale.gettext(p, HE_NO_NIKUD)).join('-'),
      };
    }
  }
  return { holidays, parasha };
}

