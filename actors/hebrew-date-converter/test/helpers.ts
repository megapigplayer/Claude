/**
 * Independent oracles and helpers for the tests.
 *
 * Three implementations that share no code with `@hebcal/core` (our runtime library) are used to
 * check Gregorian -> Hebrew conversion:
 *   1. ICU (Node's built-in `Intl` Hebrew calendar, C++ implementation from the ICU project),
 *   2. `jewish-date` (MIT, pure TypeScript),
 *   3. `kosher-zmanim` (LGPL-3.0, a port of KosherJava; dev-only).
 */
import KosherZmanim from 'kosher-zmanim';
import { toJewishDate } from 'jewish-date';
import { type CivilDate, RD_UNIX_EPOCH, rdToCivil } from '../src/lib/civil.js';
import type { HebrewDate } from '../src/lib/hebrew.js';

/** Small seeded PRNG so every "random" test is reproducible. */
export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Oracle 1: ICU --------------------------------------------------------------------------

const ICU_MONTHS: Record<string, number> = {
  Nisan: 1, Iyar: 2, Sivan: 3, Tamuz: 4, Av: 5, Elul: 6,
  Tishri: 7, Tishrei: 7, Heshvan: 8, Cheshvan: 8, Kislev: 9, Tevet: 10, Shevat: 11,
  Adar: 12, 'Adar I': 12, 'Adar II': 13,
};

const icuFormat = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function icuHebrew(rd: number): HebrewDate {
  const parts = icuFormat.formatToParts(new Date((rd - RD_UNIX_EPOCH) * 86_400_000));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const month = ICU_MONTHS[get('month')];
  if (month === undefined) throw new Error(`unknown ICU month name "${get('month')}"`);
  return { year: Number(get('year')), month, day: Number(get('day')) };
}

// ---- Oracle 2: jewish-date -------------------------------------------------------------------

const JD_MONTHS: Record<string, number> = {
  Nisan: 1, Iyyar: 2, Sivan: 3, Tammuz: 4, Av: 5, Elul: 6,
  Tishri: 7, Cheshvan: 8, Kislev: 9, Tevet: 10, Shevat: 11,
  Adar: 12, AdarI: 12, AdarII: 13,
};

export function jewishDateHebrew(c: CivilDate): HebrewDate {
  const j = toJewishDate(new Date(c.year, c.month - 1, c.day));
  const month = JD_MONTHS[j.monthName];
  if (month === undefined) throw new Error(`unknown jewish-date month name "${j.monthName}"`);
  return { year: j.year, month, day: j.day };
}

// ---- Oracle 3: kosher-zmanim (KosherJava) ----------------------------------------------------

const { JewishDate, Luxon } = KosherZmanim as unknown as {
  JewishDate: new (d: unknown) => { getJewishYear(): number; getJewishMonth(): number; getJewishDayOfMonth(): number };
  Luxon: { DateTime: { fromObject(o: object, opts: object): unknown } };
};

export function kosherZmanimHebrew(c: CivilDate): HebrewDate {
  const jd = new JewishDate(Luxon.DateTime.fromObject({ year: c.year, month: c.month, day: c.day }, { zone: 'UTC' }));
  return { year: jd.getJewishYear(), month: jd.getJewishMonth(), day: jd.getJewishDayOfMonth() };
}

export const sameHebrew = (a: HebrewDate, b: HebrewDate): boolean => a.year === b.year && a.month === b.month && a.day === b.day;

export function civilOf(rd: number): CivilDate {
  return rdToCivil(rd);
}
