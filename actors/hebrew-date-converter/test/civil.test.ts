import { greg } from '@hebcal/core';
import { describe, expect, it } from 'vitest';
import {
  RD_UNIX_EPOCH,
  civilToRd,
  daysInGregorianMonth,
  endOfGregorianMonthRd,
  formatCivil,
  isGregorianLeapYear,
  isValidCivil,
  isoFromRd,
  parseIsoDate,
  rdToCivil,
  weekdayOfRd,
} from '../src/lib/civil.js';
import { mulberry32 } from './helpers.js';

describe('Rata Die anchors', () => {
  it('R.D. 1 is 0001-01-01, a Monday', () => {
    expect(civilToRd(1, 1, 1)).toBe(1);
    expect(weekdayOfRd(1)).toBe(1);
  });

  it('R.D. of the Unix epoch and of 2000-01-01', () => {
    expect(civilToRd(1970, 1, 1)).toBe(RD_UNIX_EPOCH);
    expect(civilToRd(2000, 1, 1)).toBe(730120);
    expect(isoFromRd(730120)).toBe('2000-01-01');
  });

  it.each([
    ['1970-01-01', 4], // Thursday
    ['2000-01-01', 6], // Saturday
    ['2026-09-12', 6], // Saturday (Rosh Hashana 5787)
    ['2026-09-28', 1], // Monday
    ['1582-10-04', 1], // proleptic Gregorian: no cutover gap, so 4 Oct 1582 is a Monday (JavaScript Date agrees)
    ['1582-10-05', 2],
    ['1582-10-15', 5], // the first day of the historical Gregorian calendar was a Friday
    ['0001-01-01', 1],
  ])('weekday of %s is %i (0 = Sunday)', (iso, expected) => {
    const parsed = parseIsoDate(iso);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(weekdayOfRd(parsed.rd)).toBe(expected);
  });

  it('weekday is safe for non-positive day numbers', () => {
    for (const rd of [0, -1, -6, -7, -8]) expect(weekdayOfRd(rd)).toBeGreaterThanOrEqual(0);
    expect(weekdayOfRd(0)).toBe(0);
    expect(weekdayOfRd(-1)).toBe(6);
  });
});

describe('civil <-> R.D. round trips and independent oracles', () => {
  it('round-trips every day from 0001-01-01 to 6100-12-31 and advances one calendar day at a time', () => {
    const last = civilToRd(6100, 12, 31);
    let previous = rdToCivil(1);
    expect(previous).toEqual({ year: 1, month: 1, day: 1 });
    for (let rd = 2; rd <= last; rd++) {
      const c = rdToCivil(rd);
      let ey = previous.year;
      let em = previous.month;
      let ed = previous.day + 1;
      if (ed > daysInGregorianMonth(ey, em)) {
        ed = 1;
        em += 1;
        if (em > 12) {
          em = 1;
          ey += 1;
        }
      }
      if (c.year !== ey || c.month !== em || c.day !== ed) throw new Error(`R.D. ${rd}: got ${formatCivil(c)}, expected ${formatCivil({ year: ey, month: em, day: ed })}`);
      if (civilToRd(c.year, c.month, c.day) !== rd) throw new Error(`round trip failed at R.D. ${rd}`);
      previous = c;
    }
    expect(formatCivil(previous)).toBe('6100-12-31');
  });

  it('agrees with JavaScript Date (UTC) on every day from 1900 to 2100: R.D. and weekday', () => {
    for (let year = 1900; year <= 2100; year++) {
      for (let month = 1; month <= 12; month++) {
        for (let day = 1; day <= daysInGregorianMonth(year, month); day++) {
          const ms = Date.UTC(year, month - 1, day);
          const rd = Math.round(ms / 86_400_000) + RD_UNIX_EPOCH;
          if (civilToRd(year, month, day) !== rd) throw new Error(`R.D. mismatch for ${year}-${month}-${day}`);
          if (weekdayOfRd(rd) !== new Date(ms).getUTCDay()) throw new Error(`weekday mismatch for ${year}-${month}-${day}`);
        }
      }
    }
  });

  it("agrees with Hebcal's greg2abs for 3000 random dates (years 100-3000)", () => {
    const rnd = mulberry32(20260929);
    for (let i = 0; i < 3000; i++) {
      const year = 100 + Math.floor(rnd() * 2900);
      const month = 1 + Math.floor(rnd() * 12);
      const day = 1 + Math.floor(rnd() * daysInGregorianMonth(year, month));
      expect(civilToRd(year, month, day), `${year}-${month}-${day}`).toBe(greg.greg2abs(new Date(year, month - 1, day)));
    }
  });

  it('is proleptic Gregorian for years before 1582 (year 1000 is not a leap year, year 1600 is)', () => {
    expect(isGregorianLeapYear(1000)).toBe(false);
    expect(isGregorianLeapYear(1600)).toBe(true);
    expect(isGregorianLeapYear(1900)).toBe(false);
    expect(isGregorianLeapYear(2000)).toBe(true);
    expect(isGregorianLeapYear(2100)).toBe(false);
    expect(civilToRd(1000, 3, 1) - civilToRd(1000, 2, 28)).toBe(1);
  });
});

describe('calendar arithmetic helpers', () => {
  it('daysInGregorianMonth', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => daysInGregorianMonth(2026, m))).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
    expect(daysInGregorianMonth(2024, 2)).toBe(29);
  });

  it('isValidCivil rejects impossible dates', () => {
    expect(isValidCivil(2026, 2, 29)).toBe(false);
    expect(isValidCivil(2024, 2, 29)).toBe(true);
    expect(isValidCivil(2026, 13, 1)).toBe(false);
    expect(isValidCivil(2026, 0, 1)).toBe(false);
    expect(isValidCivil(2026, 4, 31)).toBe(false);
    expect(isValidCivil(0, 1, 1)).toBe(false);
    expect(isValidCivil(2026.5, 1, 1)).toBe(false);
  });

  it('endOfGregorianMonthRd', () => {
    expect(isoFromRd(endOfGregorianMonthRd(civilToRd(2026, 1, 15)))).toBe('2026-01-31');
    expect(isoFromRd(endOfGregorianMonthRd(civilToRd(2026, 2, 1)))).toBe('2026-02-28');
    expect(isoFromRd(endOfGregorianMonthRd(civilToRd(2028, 2, 10)))).toBe('2028-02-29');
    expect(isoFromRd(endOfGregorianMonthRd(civilToRd(2026, 12, 31)))).toBe('2026-12-31');
  });

  it('formatCivil zero-pads', () => {
    expect(formatCivil({ year: 5, month: 3, day: 9 })).toBe('0005-03-09');
  });
});

describe('parseIsoDate', () => {
  it('accepts strict YYYY-MM-DD and returns the R.D. number', () => {
    const r = parseIsoDate(' 2026-09-12 ');
    expect(r).toMatchObject({ ok: true, civil: { year: 2026, month: 9, day: 12 } });
  });

  it.each(['2026-9-12', '2026-09-1', '26-09-12', '2026/09/12', '2026-09-12T00:00', '12-09-2026', '', 'abc', '2026-09-12x'])('rejects the format of %j', (text) => {
    expect(parseIsoDate(text)).toMatchObject({ ok: false, code: 'FORMAT' });
  });

  it.each(['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '0000-01-01', '2026-01-00'])('rejects the impossible date %s without rolling it over', (text) => {
    expect(parseIsoDate(text)).toMatchObject({ ok: false, code: 'INVALID_DATE' });
  });

  it('accepts a leap day only in leap years', () => {
    expect(parseIsoDate('2028-02-29').ok).toBe(true);
    expect(parseIsoDate('1900-02-29').ok).toBe(false);
    expect(parseIsoDate('2000-02-29').ok).toBe(true);
  });
});
