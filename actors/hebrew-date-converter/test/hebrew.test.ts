import { describe, expect, it } from 'vitest';
import {
  MONTH_ADAR_I,
  MONTH_ADAR_II,
  MONTH_TISHREI,
  formatHebrewDateEn,
  formatHebrewDateHe,
  gematriya,
  hebrewMonthNameEn,
  hebrewMonthNameHe,
  hebrewMonthOfYear,
  hebrewYearGematriya,
  isHebrewLeapYear,
} from '../src/lib/hebrew.js';

describe('gematriya', () => {
  it('15 and 16 are written ט״ו / ט״ז, never יה / יו (a divine name)', () => {
    expect(gematriya(15)).toBe('ט״ו');
    expect(gematriya(16)).toBe('ט״ז');
  });

  it('single letters get a geresh', () => {
    expect(gematriya(1)).toBe('א׳');
    expect(gematriya(10)).toBe('י׳');
    expect(gematriya(20)).toBe('כ׳');
  });

  it('multi-letter numbers get a gershayim before the last letter', () => {
    expect(gematriya(17)).toBe('י״ז');
    expect(gematriya(11)).toBe('י״א');
    expect(gematriya(30)).not.toContain('״'); // single letter (ל) -> geresh only
    expect(gematriya(30)).toBe('ל׳');
  });

  it('hundreds and the 400-per-letter ת rule (787 -> תשפ״ז)', () => {
    expect(gematriya(400)).toBe('ת׳');
    expect(gematriya(787)).toBe('תשפ״ז');
    expect(gematriya(800)).toBe('ת״ת'); // two ת (400+400)
    expect(gematriya(999)).toBe('תתקצ״ט');
  });

  it('rejects out-of-range and non-integer input', () => {
    expect(() => gematriya(0)).toThrow(RangeError);
    expect(() => gematriya(1000)).toThrow(RangeError);
    expect(() => gematriya(1.5)).toThrow(RangeError);
    expect(() => gematriya(-1)).toThrow(RangeError);
  });
});

describe('hebrewYearGematriya', () => {
  it('drops the thousands for 5000-5999 (matches Hebcal convention)', () => {
    expect(hebrewYearGematriya(5786)).toBe('תשפ״ו');
    expect(hebrewYearGematriya(5787)).toBe('תשפ״ז');
  });

  it('keeps the thousands with a geresh outside 5000-5999', () => {
    expect(hebrewYearGematriya(4760)).toBe('ד׳תש״ס');
    expect(hebrewYearGematriya(6001)).toBe('ו׳א׳');
  });

  it('year exactly on a thousands boundary (rest = 0) still gets the thousands marker', () => {
    expect(hebrewYearGematriya(4000)).toBe('ד׳');
  });

  it('small years (thousands = 0) format like a plain number', () => {
    expect(hebrewYearGematriya(1)).toBe('א׳');
    expect(hebrewYearGematriya(999)).toBe('תתקצ״ט');
  });

  it('rejects out-of-range years', () => {
    expect(() => hebrewYearGematriya(0)).toThrow(RangeError);
    expect(() => hebrewYearGematriya(10000)).toThrow(RangeError);
  });
});

describe('isHebrewLeapYear', () => {
  it('known leap and non-leap years', () => {
    expect(isHebrewLeapYear(5787)).toBe(true);
    expect(isHebrewLeapYear(5786)).toBe(false);
    expect(isHebrewLeapYear(5784)).toBe(true); // leap: had Adar I/II
    expect(isHebrewLeapYear(5785)).toBe(false);
  });

  it('positions 3, 6, 8, 11, 14, 17, 19 of the 19-year cycle are leap (year 1 = position 1)', () => {
    const leapPositions = new Set([3, 6, 8, 11, 14, 17, 19]);
    for (let pos = 1; pos <= 19; pos++) {
      // Hebrew year 1 is cycle position 1 (isHebrewLeapYear is defined for year >= 1 mathematically).
      expect(isHebrewLeapYear(pos), `position ${pos}`).toBe(leapPositions.has(pos));
    }
  });
});

describe('hebrewMonthNameEn / hebrewMonthNameHe (Adar I/II)', () => {
  it('month 12 is "Adar" in a regular year and "Adar I" in a leap year', () => {
    expect(hebrewMonthNameEn(MONTH_ADAR_I, 5786)).toBe('Adar');
    expect(hebrewMonthNameEn(MONTH_ADAR_I, 5787)).toBe('Adar I');
    expect(hebrewMonthNameHe(MONTH_ADAR_I, 5786)).toBe('אדר');
    expect(hebrewMonthNameHe(MONTH_ADAR_I, 5787)).toBe(`אדר א׳`);
  });

  it('month 13 (Adar II) only makes sense in a leap year but always renders as "Adar II"', () => {
    expect(hebrewMonthNameEn(MONTH_ADAR_II, 5787)).toBe('Adar II');
    expect(hebrewMonthNameHe(MONTH_ADAR_II, 5787)).toBe(`אדר ב׳`);
  });

  it('regular months', () => {
    expect(hebrewMonthNameEn(MONTH_TISHREI, 5787)).toBe('Tishrei');
    expect(hebrewMonthNameHe(MONTH_TISHREI, 5787)).toBe('תשרי');
  });
});

describe('hebrewMonthOfYear (position counted from Tishrei)', () => {
  it('Tishrei is always 1', () => {
    expect(hebrewMonthOfYear(MONTH_TISHREI, 5787)).toBe(1);
  });

  it('Elul is the last month: 12 in a regular year, 13 in a leap year', () => {
    expect(hebrewMonthOfYear(6, 5786)).toBe(12); // Elul, regular year
    expect(hebrewMonthOfYear(6, 5787)).toBe(13); // Elul, leap year
  });

  it('every month of a regular year maps to a unique position 1..12', () => {
    const positions = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6].map((m) => hebrewMonthOfYear(m, 5786));
    expect(new Set(positions).size).toBe(12);
    expect(Math.min(...positions)).toBe(1);
    expect(Math.max(...positions)).toBe(12);
  });

  it('every month of a leap year maps to a unique position 1..13', () => {
    const positions = [7, 8, 9, 10, 11, 12, 13, 1, 2, 3, 4, 5, 6].map((m) => hebrewMonthOfYear(m, 5787));
    expect(new Set(positions).size).toBe(13);
    expect(Math.min(...positions)).toBe(1);
    expect(Math.max(...positions)).toBe(13);
  });
});

describe('formatHebrewDateEn / formatHebrewDateHe', () => {
  it('formats the TOP60 spec anchor date', () => {
    const d = { year: 5787, month: MONTH_TISHREI, day: 17 };
    expect(formatHebrewDateEn(d)).toBe('17 Tishrei 5787');
    expect(formatHebrewDateHe(d)).toBe('י״ז בתשרי תשפ״ז');
  });

  it('day 15 and 16 never spell the divine name inside a full date string', () => {
    expect(formatHebrewDateHe({ year: 5787, month: MONTH_TISHREI, day: 15 })).toContain('ט״ו');
    expect(formatHebrewDateHe({ year: 5787, month: MONTH_TISHREI, day: 16 })).toContain('ט״ז');
  });
});
