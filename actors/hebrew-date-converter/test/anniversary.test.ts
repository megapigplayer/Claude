/**
 * anniversary.ts implements documented, non-trivial calendrical rules (Reingold & Dershowitz).
 * Rather than hand-picking Hebrew years from memory (error-prone), these tests search a real
 * range of years with `isHebrewLeapYear` / `isLongCheshvan` / `isShortKislev` (independently
 * oracled in oracle.test.ts) for a year with the needed property, then check the documented rule.
 */
import { describe, expect, it } from 'vitest';
import {
  anniversaryInYear,
  ruleSentence,
  standingRuleNote,
} from '../src/lib/anniversary.js';
import {
  MONTH_ADAR_I,
  MONTH_ADAR_II,
  MONTH_CHESHVAN,
  MONTH_KISLEV,
  MONTH_NISAN,
  MONTH_SHVAT,
  MONTH_TEVET,
  MONTH_TISHREI,
  isHebrewLeapYear,
} from '../src/lib/hebrew.js';
import { hebrewToRd, isLongCheshvan, isShortKislev, rdToHebrew } from '../src/lib/hebrew-calendar.js';

function findYear(from: number, to: number, want: (y: number) => boolean): number {
  for (let y = from; y <= to; y++) if (want(y)) return y;
  throw new Error(`no year in [${from},${to}] satisfies the predicate`);
}

// A "leap -> non-leap" and "non-leap -> leap" pair close together, used throughout.
const REGULAR_YEAR = findYear(5780, 5820, (y) => !isHebrewLeapYear(y));
const NEXT_LEAP_YEAR = findYear(REGULAR_YEAR + 1, REGULAR_YEAR + 19, isHebrewLeapYear);
const LEAP_YEAR = findYear(5780, 5820, isHebrewLeapYear);
const NEXT_REGULAR_YEAR = findYear(LEAP_YEAR + 1, LEAP_YEAR + 19, (y) => !isHebrewLeapYear(y));

describe('anniversaryInYear: plain dates (no special rule)', () => {
  it('returns the same month/day every target year, leap or not', () => {
    const orig = { year: REGULAR_YEAR, month: MONTH_TISHREI, day: 10 };
    for (const type of ['birthday', 'yahrzeit'] as const) {
      const r = anniversaryInYear(orig, NEXT_LEAP_YEAR, type);
      expect(r).toEqual({ date: { year: NEXT_LEAP_YEAR, month: MONTH_TISHREI, day: 10 }, ruleCode: 'SAME_DATE' });
    }
  });

  it('returns null for a target year that is not after the original year', () => {
    const orig = { year: 5787, month: MONTH_TISHREI, day: 1 };
    expect(anniversaryInYear(orig, 5787, 'birthday')).toBeNull();
    expect(anniversaryInYear(orig, 5786, 'birthday')).toBeNull();
  });
});

describe('the single Adar of a regular year, observed in a leap year', () => {
  const orig = { year: REGULAR_YEAR, month: MONTH_ADAR_I, day: 5 };

  it('default rule: birthday -> Adar II, yahrzeit -> Adar I', () => {
    const b = anniversaryInYear(orig, NEXT_LEAP_YEAR, 'birthday', 'default');
    expect(b).toEqual({ date: { year: NEXT_LEAP_YEAR, month: MONTH_ADAR_II, day: 5 }, ruleCode: 'ADAR_TO_ADAR_II' });
    const y = anniversaryInYear(orig, NEXT_LEAP_YEAR, 'yahrzeit', 'default');
    expect(y).toEqual({ date: { year: NEXT_LEAP_YEAR, month: MONTH_ADAR_I, day: 5 }, ruleCode: 'ADAR_TO_ADAR_I' });
  });

  it('adarRule overrides the default for both types', () => {
    expect(anniversaryInYear(orig, NEXT_LEAP_YEAR, 'birthday', 'adar-i')).toMatchObject({ date: { month: MONTH_ADAR_I }, ruleCode: 'ADAR_TO_ADAR_I' });
    expect(anniversaryInYear(orig, NEXT_LEAP_YEAR, 'yahrzeit', 'adar-ii')).toMatchObject({ date: { month: MONTH_ADAR_II }, ruleCode: 'ADAR_TO_ADAR_II' });
  });

  it('in another regular year (no leap in between), the date does not move', () => {
    const nextRegular = findYear(orig.year + 1, orig.year + 19, (y) => !isHebrewLeapYear(y));
    expect(anniversaryInYear(orig, nextRegular, 'birthday')).toEqual({ date: { year: nextRegular, month: MONTH_ADAR_I, day: 5 }, ruleCode: 'SAME_DATE' });
  });
});

describe('Adar II of a leap year, observed in a non-leap year', () => {
  const orig = { year: LEAP_YEAR, month: MONTH_ADAR_II, day: 5 };

  it('always becomes Adar (month 12) for both types', () => {
    for (const type of ['birthday', 'yahrzeit'] as const) {
      const r = anniversaryInYear(orig, NEXT_REGULAR_YEAR, type);
      expect(r).toEqual({ date: { year: NEXT_REGULAR_YEAR, month: MONTH_ADAR_I, day: 5 }, ruleCode: 'ADAR_II_TO_ADAR' });
    }
  });

  it('stays Adar II in another leap year', () => {
    const nextLeap = findYear(orig.year + 1, orig.year + 19, isHebrewLeapYear);
    expect(anniversaryInYear(orig, nextLeap, 'birthday')).toEqual({ date: { year: nextLeap, month: MONTH_ADAR_II, day: 5 }, ruleCode: 'SAME_DATE' });
  });
});

describe('Adar I of a leap year, observed in a non-leap year', () => {
  it('a non-30th day stays month 12 ("Adar" in the target year), day unchanged', () => {
    const orig = { year: LEAP_YEAR, month: MONTH_ADAR_I, day: 5 };
    for (const type of ['birthday', 'yahrzeit'] as const) {
      expect(anniversaryInYear(orig, NEXT_REGULAR_YEAR, type)).toEqual({ date: { year: NEXT_REGULAR_YEAR, month: MONTH_ADAR_I, day: 5 }, ruleCode: 'ADAR_I_TO_ADAR' });
    }
  });

  it('30 Adar I (which does not exist in a non-leap year): birthday -> 1 Nisan, yahrzeit -> 30 Sh\'vat', () => {
    const orig = { year: LEAP_YEAR, month: MONTH_ADAR_I, day: 30 };
    expect(anniversaryInYear(orig, NEXT_REGULAR_YEAR, 'birthday')).toEqual({ date: { year: NEXT_REGULAR_YEAR, month: MONTH_NISAN, day: 1 }, ruleCode: 'ADAR_I_30_TO_NISAN_1' });
    expect(anniversaryInYear(orig, NEXT_REGULAR_YEAR, 'yahrzeit')).toEqual({ date: { year: NEXT_REGULAR_YEAR, month: MONTH_SHVAT, day: 30 }, ruleCode: 'ADAR_I_30_TO_SHVAT_30' });
  });

  it('stays 30 Adar I in another leap year', () => {
    const orig = { year: LEAP_YEAR, month: MONTH_ADAR_I, day: 30 };
    const nextLeap = findYear(orig.year + 1, orig.year + 19, isHebrewLeapYear);
    expect(anniversaryInYear(orig, nextLeap, 'birthday')).toEqual({ date: { year: nextLeap, month: MONTH_ADAR_I, day: 30 }, ruleCode: 'SAME_DATE' });
  });
});

describe('30 Cheshvan (birthday): moves to 1 Kislev only in a short-Cheshvan target year', () => {
  it('short target year -> 1 Kislev; long target year -> stays 30 Cheshvan', () => {
    const orig = { year: REGULAR_YEAR, month: MONTH_CHESHVAN, day: 30 };
    const shortYear = findYear(orig.year + 1, orig.year + 40, (y) => !isLongCheshvan(y));
    const longYear = findYear(orig.year + 1, orig.year + 40, isLongCheshvan);
    expect(anniversaryInYear(orig, shortYear, 'birthday')).toEqual({ date: { year: shortYear, month: MONTH_KISLEV, day: 1 }, ruleCode: 'CHESHVAN_30_TO_KISLEV_1' });
    expect(anniversaryInYear(orig, longYear, 'birthday')).toEqual({ date: { year: longYear, month: MONTH_CHESHVAN, day: 30 }, ruleCode: 'SAME_DATE' });
  });
});

describe('30 Kislev (birthday): moves to 1 Tevet only in a short-Kislev target year', () => {
  it('short target year -> 1 Tevet; long target year -> stays 30 Kislev', () => {
    const orig = { year: REGULAR_YEAR, month: MONTH_KISLEV, day: 30 };
    const shortYear = findYear(orig.year + 1, orig.year + 40, isShortKislev);
    const longYear = findYear(orig.year + 1, orig.year + 40, (y) => !isShortKislev(y));
    expect(anniversaryInYear(orig, shortYear, 'birthday')).toEqual({ date: { year: shortYear, month: MONTH_TEVET, day: 1 }, ruleCode: 'KISLEV_30_TO_TEVET_1' });
    expect(anniversaryInYear(orig, longYear, 'birthday')).toEqual({ date: { year: longYear, month: MONTH_KISLEV, day: 30 }, ruleCode: 'SAME_DATE' });
  });
});

describe('yahrzeit on 30 Cheshvan/Kislev: the FIRST anniversary year fixes the rule for every later year', () => {
  it('30 Cheshvan, short first anniversary -> "day before 1 Kislev" forever, even in a later long year', () => {
    const origYear = findYear(5780, 5850, (y) => !isLongCheshvan(y + 1));
    const orig = { year: origYear, month: MONTH_CHESHVAN, day: 30 };
    const firstAnniversary = origYear + 1;
    const r1 = anniversaryInYear(orig, firstAnniversary, 'yahrzeit');
    expect(r1?.ruleCode).toBe('DAY_BEFORE_KISLEV_1');
    expect(hebrewToRd(r1!.date)).toBe(hebrewToRd({ year: firstAnniversary, month: MONTH_KISLEV, day: 1 }) - 1);

    // A LATER year where Cheshvan happens to be long: the rule still applies (fixed at the first anniversary).
    const laterLongYear = findYear(firstAnniversary + 1, firstAnniversary + 40, isLongCheshvan);
    const r2 = anniversaryInYear(orig, laterLongYear, 'yahrzeit');
    expect(r2?.ruleCode).toBe('DAY_BEFORE_KISLEV_1');
    expect(hebrewToRd(r2!.date)).toBe(hebrewToRd({ year: laterLongYear, month: MONTH_KISLEV, day: 1 }) - 1);
  });

  it('30 Cheshvan, long first anniversary -> ordinary 30 Cheshvan / short-year rule applies each year', () => {
    const origYear = findYear(5780, 5850, (y) => isLongCheshvan(y + 1));
    const orig = { year: origYear, month: MONTH_CHESHVAN, day: 30 };
    const firstAnniversary = origYear + 1;
    expect(anniversaryInYear(orig, firstAnniversary, 'yahrzeit')).toEqual({ date: { year: firstAnniversary, month: MONTH_CHESHVAN, day: 30 }, ruleCode: 'SAME_DATE' });
  });

  it('30 Kislev, short first anniversary -> "day before 1 Tevet" forever', () => {
    const origYear = findYear(5780, 5850, (y) => isShortKislev(y + 1));
    const orig = { year: origYear, month: MONTH_KISLEV, day: 30 };
    const firstAnniversary = origYear + 1;
    const r = anniversaryInYear(orig, firstAnniversary, 'yahrzeit');
    expect(r?.ruleCode).toBe('DAY_BEFORE_TEVET_1');
    expect(hebrewToRd(r!.date)).toBe(hebrewToRd({ year: firstAnniversary, month: MONTH_TEVET, day: 1 }) - 1);
  });
});

describe('every returned anniversary date is a real, existing Hebrew date', () => {
  it('round-trips through hebrewToRd/rdToHebrew unchanged for 200 birthdays and yahrzeits from varied origins', () => {
    // 30 Adar I and Adar II only exist as real dates in a LEAP origin year; 30 Cheshvan/Kislev and
    // 1 Tishrei exist regardless, so a regular year is used for those (either would do).
    const origins = [
      { year: REGULAR_YEAR, month: MONTH_TISHREI, day: 1 },
      { year: LEAP_YEAR, month: MONTH_ADAR_I, day: 5 },
      { year: LEAP_YEAR, month: MONTH_ADAR_I, day: 30 },
      { year: LEAP_YEAR, month: MONTH_ADAR_II, day: 5 },
      { year: REGULAR_YEAR, month: MONTH_CHESHVAN, day: 30 },
      { year: REGULAR_YEAR, month: MONTH_KISLEV, day: 30 },
    ];
    for (const orig of origins) {
      for (let hyear = orig.year + 1; hyear <= orig.year + 40; hyear++) {
        for (const type of ['birthday', 'yahrzeit'] as const) {
          const r = anniversaryInYear(orig, hyear, type);
          if (r === null) continue;
          expect(rdToHebrew(hebrewToRd(r.date)), `${type} of ${JSON.stringify(orig)} in ${hyear}`).toEqual(r.date);
        }
      }
    }
  });
});

describe('ruleSentence / standingRuleNote', () => {
  it('SAME_DATE has no sentence', () => {
    expect(ruleSentence('SAME_DATE', 'birthday', { year: 1, month: 1, day: 1 })).toBeNull();
  });

  it('every non-trivial rule code has a human-readable sentence mentioning "birthday" or "yahrzeit"', () => {
    const codes = [
      'ADAR_TO_ADAR_I', 'ADAR_TO_ADAR_II', 'ADAR_I_TO_ADAR', 'ADAR_II_TO_ADAR',
      'ADAR_I_30_TO_NISAN_1', 'ADAR_I_30_TO_SHVAT_30', 'CHESHVAN_30_TO_KISLEV_1', 'KISLEV_30_TO_TEVET_1',
    ] as const;
    for (const code of codes) {
      for (const type of ['birthday', 'yahrzeit'] as const) {
        const s = ruleSentence(code, type, { year: 5786, month: MONTH_CHESHVAN, day: 30 });
        expect(s, code).toBeTruthy();
        expect(s?.toLowerCase()).toContain(type);
      }
    }
  });

  it('standingRuleNote is null for a plain date and non-null for Adar/30-Cheshvan/30-Kislev originals', () => {
    expect(standingRuleNote({ year: 5786, month: MONTH_TISHREI, day: 10 }, 'birthday', 'default')).toBeNull();
    expect(standingRuleNote({ year: REGULAR_YEAR, month: MONTH_ADAR_I, day: 5 }, 'birthday', 'default')).toMatch(/leap year/);
    expect(standingRuleNote({ year: LEAP_YEAR, month: MONTH_ADAR_I, day: 30 }, 'yahrzeit', 'default')).toMatch(/non-leap year/);
    expect(standingRuleNote({ year: LEAP_YEAR, month: MONTH_ADAR_II, day: 5 }, 'birthday', 'default')).toMatch(/Adar II/);
    expect(standingRuleNote({ year: 5786, month: MONTH_CHESHVAN, day: 30 }, 'birthday', 'default')).toMatch(/Cheshvan/);
    expect(standingRuleNote({ year: 5786, month: MONTH_KISLEV, day: 30 }, 'yahrzeit', 'default')).toMatch(/Kislev/);
  });
});
