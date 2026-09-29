/**
 * One location's results for one Shabbat week: candle lighting, havdalah, parasha, holiday info and
 * the Friday zmanim block. The only file (besides zmanim.ts) that imports `@hebcal/core`'s calendar
 * generation; everything here is otherwise a plain, pure function of its arguments.
 */
import { CandleLightingEvent, HavdalahEvent, HebrewCalendar, HolidayEvent, Locale, ParshaEvent, Zmanim } from '@hebcal/core';
import type { CalOptions, Location } from '@hebcal/core';
import { type CivilDate, addDays, formatIsoCivilDate } from './dates.js';
import { type ZmanimBlock, computeZmanim } from './zmanim.js';

export type { CivilDate } from './dates.js';

export interface WeekOptions {
  /** Override the location/holiday-aware default candle-lighting offset (minutes before sunset). `null` = library default (18 diaspora / 20 Israel / 30 Haifa & Zikhron Ya'akov / 40 Jerusalem). */
  candleLightingMinutes: number | null;
  /** Fixed minutes after sunset for havdalah. `null` = degree-based (see `havdalahDeg`). */
  havdalahMinutes: number | null;
  /** Degrees of solar depression for havdalah when `havdalahMinutes` is null (default 8.5 = 3 small stars). */
  havdalahDeg: number;
  /** `include: "shabbat"` - friday/candleLighting/havdalah/parasha. */
  includeShabbat: boolean;
  /** `include: "zmanim"` - the detailed zmanim block (otherwise null, and it is not computed). */
  includeZmanim: boolean;
  /** `include: "holidays"` - holiday/holidayHe. */
  includeHolidays: boolean;
  /**
   * Whether sunrise/sunset-based zmanim (and, in turn, candle-lighting/havdalah) account for the
   * location's elevation. `@hebcal/core`'s own `CalOptions.useElevation` defaults to `false`, and
   * that is what produces the conventionally published offsets (e.g. exactly 40 minutes before
   * sunset in Jerusalem, despite its 786m elevation - elevation there is not an open sea-level
   * horizon, so most published tables do not apply it). main.ts passes `false` by default; this
   * MUST be passed identically to both the `Zmanim` class (zmanim.ts) and `HebrewCalendar.calendar`
   * below, or candle-lighting/havdalah would be computed against a different sunset than the one
   * shown in `zmanim.shkia`, silently breaking "candle lighting = shkia - offset".
   */
  useElevation: boolean;
}

export const DEFAULT_HAVDALAH_DEG = 8.5;

export interface WeekResult {
  friday: string;
  candleLighting: string | null;
  havdalah: string | null;
  parasha: string | null;
  parashaHe: string | null;
  holiday: string | null;
  holidayHe: string | null;
  zmanim: ZmanimBlock | null;
  warnings: string[];
}

const HE_NO_NIKUD = 'he-x-NoNikud';

function toDate(c: CivilDate): Date {
  return new Date(c.year, c.month - 1, c.day);
}

/** Build one location-week result. `friday` should be a Friday (callers roll forward if not; see input.ts). Never throws for a valid Location/options. */
export function buildWeek(location: Location, friday: CivilDate, options: WeekOptions): WeekResult {
  const fridayDate = toDate(friday);
  const warnings: string[] = [];

  let zmanim: ZmanimBlock | null = null;
  if (options.includeZmanim || options.includeShabbat) {
    // Also computed (but not returned) when only "shabbat" is requested: it tells us whether the
    // sun rises/sets at all here today, which candle-lighting/havdalah depend on too.
    const { block, hasSunset } = computeZmanim(location, fridayDate, options.useElevation);
    if (!hasSunset) {
      warnings.push('No sunrise/sunset at this location/date (polar day or night): zmanim, candle-lighting and havdalah could not be computed.');
    }
    if (options.includeZmanim) zmanim = block;
  }

  let candleLighting: string | null = null;
  let havdalah: string | null = null;
  let parasha: string | null = null;
  let parashaHe: string | null = null;
  let holiday: string | null = null;
  let holidayHe: string | null = null;

  if (options.includeShabbat || options.includeHolidays) {
    // A 4-day window (Fri..Mon) safely covers a Shabbat chained to an adjacent Yom Tov (e.g. Rosh
    // Hashana, or Shabbat immediately before/after a multi-day festival), where havdalah can fall a
    // day or two later than a plain Motzaei Shabbat.
    const calOpts: CalOptions = {
      start: fridayDate,
      end: toDate(addDays(friday, 4)),
      location,
      il: location.getIsrael(),
      candlelighting: options.includeShabbat,
      sedrot: options.includeShabbat,
      noHolidays: !options.includeHolidays,
      // Must match the Zmanim class's own useElevation above: otherwise candle-lighting/havdalah
      // (computed here) and the displayed shkia (computed in zmanim.ts) would disagree by the
      // elevation adjustment, breaking the "candle lighting = shkia - offset" invariant.
      useElevation: options.useElevation,
      ...(options.candleLightingMinutes !== null ? { candleLightingMins: options.candleLightingMinutes } : {}),
      ...(options.havdalahMinutes !== null ? { havdalahMins: options.havdalahMinutes } : { havdalahDeg: options.havdalahDeg }),
    };
    const events = HebrewCalendar.calendar(calOpts);

    const tzid = location.getTzid();
    const fmtEvent = (ev: { eventTime?: Date } | undefined): string | null => (ev?.eventTime ? Zmanim.formatISOWithTimeZone(tzid, ev.eventTime) : null);

    if (options.includeShabbat) {
      const candle = events.find((ev): ev is CandleLightingEvent => ev instanceof CandleLightingEvent);
      const hav = events.find((ev): ev is HavdalahEvent => ev instanceof HavdalahEvent);
      const parsha = events.find((ev): ev is ParshaEvent => ev instanceof ParshaEvent);
      candleLighting = fmtEvent(candle);
      havdalah = fmtEvent(hav);
      parasha = parsha ? parsha.parsha.join('-') : null;
      parashaHe = parsha ? parsha.parsha.map((p) => Locale.gettext(p, HE_NO_NIKUD)).join('-') : null;
      if (!candle) warnings.push('No candle-lighting time could be found in this window (unexpected; please report).');
    }
    if (options.includeHolidays) {
      const holidays = events.filter((ev): ev is HolidayEvent => ev instanceof HolidayEvent);
      holiday = holidays.length > 0 ? holidays.map((h) => h.getDesc()).join('; ') : null;
      holidayHe = holidays.length > 0 ? holidays.map((h) => h.render(HE_NO_NIKUD)).join('; ') : null;
    }
  }

  return { friday: formatIsoCivilDate(friday), candleLighting, havdalah, parasha, parashaHe, holiday, holidayHe, zmanim, warnings };
}
