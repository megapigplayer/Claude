/**
 * Halachic times (zmanim) for one location and Gregorian civil date, via `@hebcal/core`'s `Zmanim`
 * class (NOAA-based solar calculations, re-exported from `@hebcal/noaa`; no separate dependency
 * needed - see LICENSES.md). This is the only file that talks to the `Zmanim` class.
 */
import { Zmanim } from '@hebcal/core';
import type { Location } from '@hebcal/core';

export interface ZmanimBlock {
  /** Dawn (astronomical twilight, 16.1 degrees before sunrise). */
  alotHaShachar: string | null;
  /** Sunrise (netz hachama). */
  neitzHaChama: string | null;
  /** Latest Shema, Gra/Vilna Gaon opinion (end of the 3rd halachic hour from sunrise to sunset). */
  sofZmanShmaGra: string | null;
  /** Latest Shema, Magen Avraham opinion (from dawn to nightfall; earlier than the GRA time). */
  sofZmanShmaMga: string | null;
  /** Midday (halachic noon). */
  chatzot: string | null;
  /** Earliest mincha (half a halachic hour after chatzot). */
  minchaGedola: string | null;
  /** Preferable earliest mincha (2.5 halachic hours before sunset). */
  minchaKetana: string | null;
  /** Plag hamincha (1.25 halachic hours before sunset). */
  plagHaMincha: string | null;
  /** Sunset (shkia). */
  shkia: string | null;
  /** Nightfall (3 medium stars visible; degree-based, independent of any havdalah option). */
  tzeit: string | null;
}

/** Format a zman as ISO 8601 WITH the location's real UTC offset (not UTC): the point of a zmanim API is the local wall-clock time to act on, and this is still an unambiguous ISO 8601 timestamp. `null` for an unset/invalid time (e.g. no sunset that day at that location). */
function fmt(tzid: string, d: Date | null | undefined): string | null {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return Zmanim.formatISOWithTimeZone(tzid, d);
}

export interface ZmanimResult {
  block: ZmanimBlock;
  /** False when there is no sunrise/sunset that day at that location (polar day/night): every field above is null. */
  hasSunset: boolean;
}

/**
 * `civilDate` must be constructed with the LOCAL `Date` constructor (`new Date(y, m - 1, d)`), matching
 * `@hebcal/core`'s own documented usage - verified empirically to give identical results regardless of
 * the host process's system timezone, because the library reads the same local calendar-date getters
 * this constructor is defined by (never `Date.UTC`/`toISOString`, which could disagree with it).
 */
export function computeZmanim(location: Location, civilDate: Date, useElevation: boolean): ZmanimResult {
  const z = new Zmanim(location, civilDate, useElevation);
  const tzid = location.getTzid();
  const shkia = z.shkiah();
  const hasSunset = shkia instanceof Date && !Number.isNaN(shkia.getTime());
  const block: ZmanimBlock = {
    alotHaShachar: fmt(tzid, z.alotHaShachar()),
    neitzHaChama: fmt(tzid, z.neitzHaChama()),
    sofZmanShmaGra: fmt(tzid, z.sofZmanShma()),
    sofZmanShmaMga: fmt(tzid, z.sofZmanShmaMGA()),
    chatzot: fmt(tzid, z.chatzot()),
    minchaGedola: fmt(tzid, z.minchaGedola()),
    minchaKetana: fmt(tzid, z.minchaKetana()),
    plagHaMincha: fmt(tzid, z.plagHaMincha()),
    shkia: fmt(tzid, shkia),
    tzeit: fmt(tzid, z.tzeit()),
  };
  return { block, hasSunset };
}
