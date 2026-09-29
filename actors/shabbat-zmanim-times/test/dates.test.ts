import { describe, expect, it } from 'vitest';
import { addDays, formatIsoCivilDate, isLeapGregorianYear, parseIsoCivilDate, resolveFriday, weekdayOf } from '../src/lib/dates.js';

describe('parseIsoCivilDate', () => {
  it('accepts a strict YYYY-MM-DD', () => {
    expect(parseIsoCivilDate('2026-10-09')).toEqual({ year: 2026, month: 10, day: 9 });
    expect(parseIsoCivilDate(' 2026-01-01 ')).toEqual({ year: 2026, month: 1, day: 1 });
  });

  it('rejects a bad format', () => {
    for (const s of ['2026-9-9', '26-10-09', '2026/10/09', '', 'abc']) expect(parseIsoCivilDate(s)).toBeNull();
  });

  it('rejects an impossible calendar date without rolling it over', () => {
    expect(parseIsoCivilDate('2026-02-30')).toBeNull();
    expect(parseIsoCivilDate('2026-13-01')).toBeNull();
  });

  it('accepts a leap day only in a leap year', () => {
    expect(parseIsoCivilDate('2028-02-29')).not.toBeNull();
    expect(parseIsoCivilDate('2026-02-29')).toBeNull();
  });
});

describe('isLeapGregorianYear', () => {
  it('standard rule (div 4, not div 100 unless div 400)', () => {
    expect(isLeapGregorianYear(2024)).toBe(true);
    expect(isLeapGregorianYear(2026)).toBe(false);
    expect(isLeapGregorianYear(1900)).toBe(false);
    expect(isLeapGregorianYear(2000)).toBe(true);
  });
});

describe('weekdayOf', () => {
  it('2026-10-09 is a Friday (TOP60.md 4.4 default startDate)', () => {
    expect(weekdayOf({ year: 2026, month: 10, day: 9 })).toBe(5);
  });

  it('agrees with JavaScript Date for a range of dates', () => {
    for (let day = 1; day <= 28; day++) {
      expect(weekdayOf({ year: 2026, month: 3, day })).toBe(new Date(2026, 2, day).getDay());
    }
  });
});

describe('addDays / formatIsoCivilDate', () => {
  it('adds across a month boundary', () => {
    expect(addDays({ year: 2026, month: 1, day: 30 }, 5)).toEqual({ year: 2026, month: 2, day: 4 });
  });

  it('adds across a year boundary', () => {
    expect(addDays({ year: 2026, month: 12, day: 30 }, 5)).toEqual({ year: 2027, month: 1, day: 4 });
  });

  it('formats with zero-padding', () => {
    expect(formatIsoCivilDate({ year: 2026, month: 1, day: 9 })).toBe('2026-01-09');
  });
});

describe('resolveFriday', () => {
  it('a Friday resolves to itself, not rolled', () => {
    expect(resolveFriday({ year: 2026, month: 10, day: 9 })).toEqual({ friday: { year: 2026, month: 10, day: 9 }, rolled: false });
  });

  it('every other weekday rolls forward to the SAME week\'s Friday or the next one, never backward', () => {
    // 2026-10-09 is Friday; 2026-10-04 (Sunday) through 2026-10-08 (Thursday) should roll to 2026-10-09.
    for (let day = 4; day <= 8; day++) {
      expect(resolveFriday({ year: 2026, month: 10, day })).toEqual({ friday: { year: 2026, month: 10, day: 9 }, rolled: true });
    }
    // Saturday 2026-10-10 rolls to the NEXT Friday, 2026-10-16 (never backward to 10-09).
    expect(resolveFriday({ year: 2026, month: 10, day: 10 })).toEqual({ friday: { year: 2026, month: 10, day: 16 }, rolled: true });
  });

  it('the resolved date is always a Friday', () => {
    for (let day = 1; day <= 28; day++) {
      const { friday } = resolveFriday({ year: 2026, month: 6, day });
      expect(weekdayOf(friday)).toBe(5);
    }
  });
});
