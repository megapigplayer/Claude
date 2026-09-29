/**
 * Independent-oracle and invariant tests for src/lib/hebrew-calendar.ts (the only file that talks
 * to @hebcal/core) and src/lib/hebrew.ts (pure formatting/leap-year maths).
 *
 * "Independent" oracles (share no code with @hebcal/core, our runtime library): ICU (Node's built-in
 * Intl Hebrew calendar), `jewish-date` (MIT) and `kosher-zmanim` (a port of KosherJava), all wired up
 * in test/helpers.ts. HDate.isLeapYear is also checked as a same-library sanity cross-check, not as
 * the independent oracle.
 */
import { HDate } from '@hebcal/core';
import { describe, expect, it } from 'vitest';
import { civilToRd, daysInGregorianMonth, weekdayOfRd } from '../src/lib/civil.js';
import { MONTH_CHESHVAN, MONTH_KISLEV, MONTH_TISHREI, isHebrewLeapYear } from '../src/lib/hebrew.js';
import { daysInHebrewMonth, hebrewToRd, isLongCheshvan, isShortKislev, rdToHebrew, tagsForRd } from '../src/lib/hebrew-calendar.js';
import { civilOf, icuHebrew, jewishDateHebrew, kosherZmanimHebrew, mulberry32, sameHebrew } from './helpers.js';

describe('rdToHebrew agrees with three independent oracles', () => {
  it('every day of 2020-2030 (ICU + jewish-date + kosher-zmanim)', () => {
    const start = civilToRd(2020, 1, 1);
    const end = civilToRd(2030, 12, 31);
    for (let rd = start; rd <= end; rd++) {
      const ours = rdToHebrew(rd);
      expect(ours, `rd=${rd} (${JSON.stringify(civilOf(rd))}) vs ICU`).toEqual(icuHebrew(rd));
      expect(sameHebrew(ours, jewishDateHebrew(civilOf(rd))), `rd=${rd} vs jewish-date`).toBe(true);
      expect(sameHebrew(ours, kosherZmanimHebrew(civilOf(rd))), `rd=${rd} vs kosher-zmanim`).toBe(true);
    }
  });

  it('2000 random days across 1900-2100 (ICU)', () => {
    const rnd = mulberry32(5787);
    for (let i = 0; i < 2000; i++) {
      const year = 1900 + Math.floor(rnd() * 201);
      const month = 1 + Math.floor(rnd() * 12);
      const day = 1 + Math.floor(rnd() * daysInGregorianMonth(year, month));
      const rd = civilToRd(year, month, day);
      expect(rdToHebrew(rd), `${year}-${month}-${day}`).toEqual(icuHebrew(rd));
    }
  });

  it('hebrewToRd round-trips rdToHebrew for every day of 2020-2030', () => {
    const start = civilToRd(2020, 1, 1);
    const end = civilToRd(2030, 12, 31);
    for (let rd = start; rd <= end; rd++) {
      expect(hebrewToRd(rdToHebrew(rd))).toBe(rd);
    }
  });
});

describe('isHebrewLeapYear (pure formula) agrees with HDate.isLeapYear for 1000 years', () => {
  it.each([3761, 5000, 5776, 5777, 5786, 5787, 5788, 6000, 6100, 9999])('year %i', (y) => {
    expect(isHebrewLeapYear(y)).toBe(HDate.isLeapYear(y));
  });

  it('years 4000-5000', () => {
    for (let y = 4000; y <= 5000; y++) expect(isHebrewLeapYear(y), String(y)).toBe(HDate.isLeapYear(y));
  });

  it('leap years occur exactly 7 times per 19-year Metonic cycle', () => {
    for (let cycleStart = 5000; cycleStart < 5100; cycleStart += 19) {
      let leaps = 0;
      for (let y = cycleStart; y < cycleStart + 19; y++) if (isHebrewLeapYear(y)) leaps++;
      expect(leaps, `cycle starting ${cycleStart}`).toBe(7);
    }
  });
});

describe('30 Cheshvan / 30 Kislev (isLongCheshvan / isShortKislev) agree with daysInHebrewMonth', () => {
  it('for 500 consecutive Hebrew years', () => {
    for (let y = 5700; y < 6200; y++) {
      expect(daysInHebrewMonth(MONTH_CHESHVAN, y)).toBe(isLongCheshvan(y) ? 30 : 29);
      expect(daysInHebrewMonth(MONTH_KISLEV, y)).toBe(isShortKislev(y) ? 29 : 30);
    }
  });

  it('both Cheshvan and Kislev vary in length across real years (not constant)', () => {
    const cheshvanLengths = new Set<number>();
    const kislevLengths = new Set<number>();
    for (let y = 5700; y < 5800; y++) {
      cheshvanLengths.add(daysInHebrewMonth(MONTH_CHESHVAN, y));
      kislevLengths.add(daysInHebrewMonth(MONTH_KISLEV, y));
    }
    expect([...cheshvanLengths].sort()).toEqual([29, 30]);
    expect([...kislevLengths].sort()).toEqual([29, 30]);
  });
});

describe('calendar invariants', () => {
  it('Yom Kippur is always 10 Tishrei', () => {
    for (let y = 5780; y <= 5800; y++) {
      const rd = hebrewToRd({ year: y, month: MONTH_TISHREI, day: 10 });
      const tags = tagsForRd(rd, true);
      expect(tags.holidays.map((h) => h.en).join(';'), `year ${y}`).toMatch(/Yom Kippur/);
    }
  });

  it('Rosh Hashana (1 Tishrei) never falls on Sunday, Wednesday or Friday ("lo adu rosh")', () => {
    // weekdayOfRd: 0 = Sunday ... 6 = Saturday.
    for (let y = 5700; y <= 6200; y++) {
      const rd = hebrewToRd({ year: y, month: MONTH_TISHREI, day: 1 });
      const weekday = weekdayOfRd(rd);
      expect([0, 3, 5], `year ${y} weekday ${weekday}`).not.toContain(weekday);
    }
  });

  it('a Hebrew year has 353-355 (regular) or 383-385 (leap) days', () => {
    for (let y = 5700; y <= 5800; y++) {
      const length = hebrewToRd({ year: y + 1, month: MONTH_TISHREI, day: 1 }) - hebrewToRd({ year: y, month: MONTH_TISHREI, day: 1 });
      if (isHebrewLeapYear(y)) expect([383, 384, 385], `leap year ${y}`).toContain(length);
      else expect([353, 354, 355], `regular year ${y}`).toContain(length);
    }
  });
});
