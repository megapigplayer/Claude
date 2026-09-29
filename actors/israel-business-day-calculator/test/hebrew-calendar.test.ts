import { HDate } from '@hebcal/core';
import { describe, expect, it } from 'vitest';
import { civilToRd } from '../src/lib/civil.js';
import { clearHolidayCache, erevOn, rdToHebrew, statutoryHolidayOn } from '../src/lib/hebrew-calendar.js';

describe('statutoryHolidayOn: exactly the nine statutory days per year', () => {
  it.each([2025, 2026, 2027])('%i', (year) => {
    clearHolidayCache();
    let count = 0;
    for (let month = 1; month <= 12; month++) {
      const daysInMonth = new Date(year, month, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (statutoryHolidayOn(iso)) count++;
      }
    }
    expect(count).toBe(9);
  });
});

describe('erevOn', () => {
  it('Erev Yom Kippur 2026-09-20 is the eve of Yom Kippur', () => {
    expect(erevOn('2026-09-20')?.en).toBe('Yom Kippur');
  });

  it('an ordinary day is not an Erev day', () => {
    expect(erevOn('2026-03-10')).toBeNull();
  });
});

describe('rdToHebrew agrees with HDate directly (thin-adapter sanity check)', () => {
  it('a handful of dates', () => {
    for (const [y, m, d] of [[2026, 9, 12], [2026, 9, 21], [2026, 4, 2], [2026, 5, 22]] as const) {
      const rd = civilToRd(y, m, d);
      const hd = new HDate(rd);
      expect(rdToHebrew(rd)).toEqual({ year: hd.getFullYear(), month: hd.getMonth(), day: hd.getDate() });
    }
  });
});
