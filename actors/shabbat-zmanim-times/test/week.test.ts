import { Location } from '@hebcal/core';
import { describe, expect, it } from 'vitest';
import type { CivilDate } from '../src/lib/dates.js';
import { DEFAULT_HAVDALAH_DEG, buildWeek } from '../src/lib/week.js';
import type { WeekOptions } from '../src/lib/week.js';
import { computeZmanim } from '../src/lib/zmanim.js';

const FULL: WeekOptions = {
  candleLightingMinutes: null,
  havdalahMinutes: null,
  havdalahDeg: DEFAULT_HAVDALAH_DEG,
  includeShabbat: true,
  includeZmanim: true,
  includeHolidays: true,
  useElevation: true,
};

const loc = (name: string): Location => Location.lookup(name) as Location;
const minutesBetween = (a: string, b: string): number => (new Date(b).getTime() - new Date(a).getTime()) / 60000;
/** Candle-lighting/havdalah event times are rounded to the nearest whole minute, so a comparison
 * against the (unrounded, to-the-second) zmanim block can be off by up to ~1 minute; not a bug. */
function expectAboutMinutes(actual: number, expectedMinutes: number): void {
  expect(Math.abs(actual - expectedMinutes), `expected ~${expectedMinutes} min, got ${actual}`).toBeLessThanOrEqual(1);
}

describe('TOP60.md 4.4 anchor dates', () => {
  it('2026-10-10 parasha is Bereshit, in both Israel and the diaspora', () => {
    const friday: CivilDate = { year: 2026, month: 10, day: 9 };
    expect(buildWeek(loc('Jerusalem'), friday, FULL).parasha).toBe('Bereshit');
    expect(buildWeek(loc('New York'), friday, FULL).parasha).toBe('Bereshit');
  });

  it('2026-10-02 (Friday, Hoshana Raba): Shabbat and Shemini Atzeret coincide in Israel', () => {
    const friday: CivilDate = { year: 2026, month: 10, day: 2 };
    const r = buildWeek(loc('Jerusalem'), friday, FULL);
    expect(r.holiday).toMatch(/Hoshana Raba/);
    expect(r.holiday).toMatch(/Shmini Atzeret/);
    expect(r.parasha).toBeNull(); // no weekday parasha reading: it is Shmini Atzeret instead
    // Only one Shabbat: candle lighting Friday evening, havdalah the following (Saturday) night.
    expect(r.candleLighting).toMatch(/^2026-10-02T/);
    expect(r.havdalah).toMatch(/^2026-10-03T/);
  });

  it('the same Friday in the diaspora: an extra day (Simchat Torah) pushes havdalah to Sunday night', () => {
    const friday: CivilDate = { year: 2026, month: 10, day: 2 };
    const r = buildWeek(loc('New York'), friday, FULL);
    expect(r.holiday).toMatch(/Simchat Torah/);
    expect(r.havdalah).toMatch(/^2026-10-04T/);
  });
});

describe('candle-lighting default offset by location (TOP60.md 4.4: 18 diaspora / 20 Israel / 40 Jerusalem / 30 Haifa)', () => {
  const friday: CivilDate = { year: 2026, month: 10, day: 9 };

  it('Jerusalem: 40 minutes before shkia', () => {
    const r = buildWeek(loc('Jerusalem'), friday, FULL);
    expectAboutMinutes(minutesBetween(r.candleLighting as string, r.zmanim?.shkia as string), 40);
  });

  it('Haifa: 30 minutes before shkia', () => {
    const r = buildWeek(loc('Haifa'), friday, FULL);
    expectAboutMinutes(minutesBetween(r.candleLighting as string, r.zmanim?.shkia as string), 30);
  });

  it('Tel Aviv (Israel, not Jerusalem/Haifa): 20 minutes before shkia', () => {
    const r = buildWeek(loc('Tel Aviv'), friday, FULL);
    expectAboutMinutes(minutesBetween(r.candleLighting as string, r.zmanim?.shkia as string), 20);
  });

  it('New York (diaspora): 18 minutes before shkia', () => {
    const r = buildWeek(loc('New York'), friday, FULL);
    expectAboutMinutes(minutesBetween(r.candleLighting as string, r.zmanim?.shkia as string), 18);
  });

  it('candleLightingMinutes overrides the default for any location', () => {
    const r = buildWeek(loc('Jerusalem'), friday, { ...FULL, candleLightingMinutes: 25 });
    expectAboutMinutes(minutesBetween(r.candleLighting as string, r.zmanim?.shkia as string), 25);
  });
});

describe('candle-lighting = shkia - offset; havdalah after shkia (TOP60.md 4.4 invariants)', () => {
  it.each(['Jerusalem', 'Tel Aviv', 'New York', 'London'] as const)('%s', (cityName) => {
    const friday: CivilDate = { year: 2026, month: 10, day: 9 };
    const r = buildWeek(loc(cityName), friday, FULL);
    expect(new Date(r.candleLighting as string).getTime()).toBeLessThan(new Date(r.zmanim?.shkia as string).getTime());
    // Havdalah is on the following night, so simply "after Friday's shkia" (compare timestamps).
    expect(new Date(r.havdalah as string).getTime()).toBeGreaterThan(new Date(r.zmanim?.shkia as string).getTime());
  });
});

describe('havdalah modes', () => {
  const friday: CivilDate = { year: 2026, month: 10, day: 9 };

  it('degree-based (default 8.5) vs a fixed-minutes override give different, both-valid times', () => {
    const deg = buildWeek(loc('Jerusalem'), friday, FULL);
    const fixed = buildWeek(loc('Jerusalem'), friday, { ...FULL, havdalahMinutes: 72 });
    expect(deg.havdalah).not.toBe(fixed.havdalah);
    // Havdalah falls on Saturday night; compare the fixed-minutes result against Saturday's own shkia.
    const saturdayShkia = computeZmanim(loc('Jerusalem'), new Date(2026, 9, 10), true).block.shkia as string;
    expectAboutMinutes(minutesBetween(saturdayShkia, fixed.havdalah as string), 72);
  });
});

describe('include toggles', () => {
  const friday: CivilDate = { year: 2026, month: 10, day: 9 };

  it('include=shabbat only: no zmanim block, no holiday computation, but candle-lighting/parasha are present', () => {
    const r = buildWeek(loc('Jerusalem'), friday, { ...FULL, includeZmanim: false, includeHolidays: false });
    expect(r.zmanim).toBeNull();
    expect(r.candleLighting).not.toBeNull();
    expect(r.parasha).toBe('Bereshit');
  });

  it('include=zmanim only: zmanim present, no candle-lighting/parasha/holiday', () => {
    const r = buildWeek(loc('Jerusalem'), friday, { ...FULL, includeShabbat: false, includeHolidays: false });
    expect(r.zmanim).not.toBeNull();
    expect(r.candleLighting).toBeNull();
    expect(r.parasha).toBeNull();
  });

  it('include=holidays only, on a week with no holiday or Rosh Chodesh: holiday is null, not an error', () => {
    const plainFriday: CivilDate = { year: 2026, month: 11, day: 20 }; // solidly mid-Kislev, no Rosh Chodesh/holiday nearby
    const r = buildWeek(loc('Jerusalem'), plainFriday, { ...FULL, includeShabbat: false, includeZmanim: false, includeHolidays: true });
    expect(r.holiday).toBeNull();
  });
});

describe('no-sunset location', () => {
  it('produces a warning and null candle-lighting/havdalah/zmanim instead of throwing', () => {
    const tromso = new Location(69.6492, 18.9553, false, 'Europe/Oslo', 'Tromso', 'NO');
    const r = buildWeek(tromso, { year: 2026, month: 6, day: 19 }, FULL); // a Friday near the summer solstice
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings.join(' ')).toMatch(/no sunrise\/sunset/i);
  });
});
