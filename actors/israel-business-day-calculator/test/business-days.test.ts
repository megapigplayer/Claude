import { describe, expect, it } from 'vitest';
import { civilToRd, isoFromRd } from '../src/lib/civil.js';
import type { ProfileOptions } from '../src/lib/calendar-profile.js';
import {
  BusinessDayLimitError,
  addBusinessDays,
  countBusinessDaysBetween,
  nextBusinessDay,
  rollToBusinessDay,
  subtractBusinessDays,
} from '../src/lib/business-days.js';

function opts(partial: Partial<ProfileOptions> = {}): ProfileOptions {
  return { profile: 'il-workweek-sun-thu', customWeekendDays: null, extraHolidays: new Set(), halfDaysAreBusiness: true, ...partial };
}
const rd = (y: number, m: number, d: number): number => civilToRd(y, m, d);
const iso = isoFromRd;

describe('TOP60.md 4.5 anchor dates', () => {
  it('Thu 2026-10-08 + 1 = Sun 2026-10-11 (Sun-Thu profile)', () => {
    expect(iso(addBusinessDays(rd(2026, 10, 8), 1, opts()).resultRd)).toBe('2026-10-11');
  });

  it('Thu 2026-10-08 + 1 = Fri 2026-10-09 (Mon-Fri/TASE profile, post-switch)', () => {
    expect(iso(addBusinessDays(rd(2026, 10, 8), 1, opts({ profile: 'il-tase-mon-fri' })).resultRd)).toBe('2026-10-09');
  });

  it('Fri 2026-09-11 next business day = Mon 2026-09-14', () => {
    expect(iso(nextBusinessDay(rd(2026, 9, 11), opts()).resultRd)).toBe('2026-09-14');
  });
});

describe('addBusinessDays / subtractBusinessDays', () => {
  it('never counts the start day itself, even when it is a business day', () => {
    // Sunday 2026-09-13 is itself a business day; +0 stays put, +1 must move.
    expect(iso(addBusinessDays(rd(2026, 9, 13), 0, opts()).resultRd)).toBe('2026-09-13');
    expect(iso(addBusinessDays(rd(2026, 9, 13), 1, opts()).resultRd)).toBe('2026-09-14');
  });

  it('a negative "add" is the same as "subtract" with the positive count, and vice versa', () => {
    const start = rd(2026, 9, 16);
    expect(addBusinessDays(start, -5, opts())).toEqual(subtractBusinessDays(start, 5, opts()));
    expect(subtractBusinessDays(start, -5, opts())).toEqual(addBusinessDays(start, 5, opts()));
  });

  it('subtract walks backward over a weekend', () => {
    // Sunday 2026-09-13 minus 1 business day = the previous Thursday (2026-09-10), skipping Fri/Sat.
    expect(iso(subtractBusinessDays(rd(2026, 9, 13), 1, opts()).resultRd)).toBe('2026-09-10');
  });

  it('a multi-day holiday chain (Rosh Hashana, which spans a weekend) is skipped in one add() call', () => {
    // 2026-09-10 (Thu) + 3 business days must cross Fri/Sat weekend AND Rosh Hashana (Sat/Sun) + its
    // adjoining Sunday, landing on Wed 2026-09-16 (see calculate.test.ts for the full row check).
    const { resultRd, skipped } = addBusinessDays(rd(2026, 9, 10), 3, opts());
    expect(iso(resultRd)).toBe('2026-09-16');
    expect(skipped.some((c) => c.holiday?.en.startsWith('Rosh Hashana'))).toBe(true);
  });

  it('throws BusinessDayLimitError instead of looping forever on an impossible profile', () => {
    // Every day is a weekend under a custom profile with all 7 weekdays blocked.
    const impossible = opts({ profile: 'custom', customWeekendDays: [0, 1, 2, 3, 4, 5, 6] });
    expect(() => addBusinessDays(rd(2026, 1, 1), 1, impossible)).toThrow(BusinessDayLimitError);
  });
});

describe('countBusinessDaysBetween: symmetric with add/subtract', () => {
  it('countBetween(A, add(A, N)) === N, for several N and profiles', () => {
    for (const profile of ['il-workweek-sun-thu', 'il-tase-mon-fri', 'iso-mon-fri'] as const) {
      for (const n of [1, 3, 10, 40]) {
        const start = rd(2026, 9, 10);
        const forward = addBusinessDays(start, n, opts({ profile }));
        const count = countBusinessDaysBetween(start, forward.resultRd, opts({ profile }));
        expect(count.count, `profile=${profile} n=${n}`).toBe(n);
      }
    }
  });

  it('countBetween(A, subtract(A, N)) === -N', () => {
    const start = rd(2026, 9, 20);
    const back = subtractBusinessDays(start, 7, opts());
    expect(countBusinessDaysBetween(start, back.resultRd, opts()).count).toBe(-7);
  });

  it('countBetween(A, A) === 0', () => {
    expect(countBusinessDaysBetween(rd(2026, 5, 5), rd(2026, 5, 5), opts()).count).toBe(0);
  });

  it('lists the holidays actually in range', () => {
    const { holidaysInRange } = countBusinessDaysBetween(rd(2026, 9, 1), rd(2026, 9, 30), opts());
    expect(holidaysInRange.map((c) => c.holiday?.en)).toContain('Rosh Hashana 5787');
    expect(holidaysInRange.map((c) => c.holiday?.en)).toContain('Yom Kippur');
  });
});

describe('rollToBusinessDay', () => {
  it('leaves an already-business day untouched (rolled=false)', () => {
    const r = rollToBusinessDay(rd(2026, 9, 14), 'following', opts()); // a Monday
    expect(r).toEqual({ resultRd: rd(2026, 9, 14), rolled: false, rollReason: null });
  });

  it('"following" rolls a Saturday forward to Sunday', () => {
    const r = rollToBusinessDay(rd(2026, 9, 19), 'following', opts()); // a Saturday
    expect(iso(r.resultRd)).toBe('2026-09-20');
    expect(r.rolled).toBe(true);
    expect(r.rollReason?.en).toBe('Weekend');
  });

  it('"preceding" rolls a Saturday backward to Thursday', () => {
    const r = rollToBusinessDay(rd(2026, 9, 19), 'preceding', opts());
    expect(iso(r.resultRd)).toBe('2026-09-17');
  });

  it('a holiday day rolls with the holiday name as the reason', () => {
    const r = rollToBusinessDay(rd(2026, 9, 21), 'following', opts()); // Yom Kippur
    expect(r.rollReason?.en).toBe('Yom Kippur');
  });

  it('"modified-following" at a month end rolls BACKWARD instead of crossing into the next month', () => {
    // 2026-01-31 is a Saturday (the last day of January); forward would land in February.
    const r = rollToBusinessDay(rd(2026, 1, 31), 'modified-following', opts());
    expect(r.resultRd).toBeLessThan(rd(2026, 1, 31));
    expect(iso(r.resultRd).startsWith('2026-01')).toBe(true);
    // Plain "following" (for contrast) does cross into February.
    const following = rollToBusinessDay(rd(2026, 1, 31), 'following', opts());
    expect(iso(following.resultRd).startsWith('2026-02')).toBe(true);
  });

  it('"modified-following" mid-month behaves exactly like "following" (no month crossed)', () => {
    const a = rollToBusinessDay(rd(2026, 9, 19), 'modified-following', opts());
    const b = rollToBusinessDay(rd(2026, 9, 19), 'following', opts());
    expect(a).toEqual(b);
  });
});
