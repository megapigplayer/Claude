import { describe, expect, it } from 'vitest';
import { civilToRd } from '../src/lib/civil.js';
import { type ProfileOptions, classifyDay } from '../src/lib/calendar-profile.js';
import { TASE_MON_FRI_SWITCH } from '../src/lib/tase-profile.js';

function opts(partial: Partial<ProfileOptions> = {}): ProfileOptions {
  return { profile: 'il-workweek-sun-thu', customWeekendDays: null, extraHolidays: new Set(), halfDaysAreBusiness: true, ...partial };
}
const rdOf = (y: number, m: number, d: number): number => civilToRd(y, m, d);

describe('weekend shape by profile', () => {
  it('il-workweek-sun-thu: Friday and Saturday are weekend, Sunday-Thursday are not', () => {
    // 2026-09-13 is a Sunday.
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const results = [13, 14, 15, 16, 17, 18, 19].map((d) => classifyDay(rdOf(2026, 9, d), opts()).isWeekend);
    expect(results).toEqual([false, false, false, false, false, true, true]);
    void days;
  });

  it('iso-mon-fri: Saturday and Sunday are weekend', () => {
    const results = [13, 14, 15, 16, 17, 18, 19].map((d) => classifyDay(rdOf(2026, 9, d), opts({ profile: 'iso-mon-fri' })).isWeekend);
    expect(results).toEqual([true, false, false, false, false, false, true]);
  });

  it('custom: uses customWeekendDays, defaulting to Fri/Sat when not given', () => {
    const c1 = classifyDay(rdOf(2026, 9, 16), opts({ profile: 'custom', customWeekendDays: [3] })); // Wednesday
    expect(c1.isWeekend).toBe(true);
    const c2 = classifyDay(rdOf(2026, 9, 18), opts({ profile: 'custom', customWeekendDays: null })); // Friday, default
    expect(c2.isWeekend).toBe(true);
  });

  it('il-tase-mon-fri switches weekend shape exactly at the (VERIFY-marked) switch date', () => {
    const beforeRd = civilToRd(2026, 1, 2); // Friday, before the switch
    const onRd = civilToRd(2026, 1, 5); // Monday, the switch date itself
    expect(classifyDay(beforeRd, opts({ profile: 'il-tase-mon-fri' })).isWeekend).toBe(true); // pre-switch: Fri is weekend
    expect(classifyDay(onRd, opts({ profile: 'il-tase-mon-fri' })).isWeekend).toBe(false); // post-switch: Monday trades
    expect(TASE_MON_FRI_SWITCH.value).toBe('2026-01-05');
    expect(TASE_MON_FRI_SWITCH.verifiedOn).toBeNull(); // explicitly unverified
  });
});

describe('statutory Israeli holidays block business days; Purim/Chanukah/minor fasts and Chol HaMoed do not', () => {
  it('Yom Kippur (2026-09-21) blocks', () => {
    expect(classifyDay(rdOf(2026, 9, 21), opts()).holiday?.en).toBe('Yom Kippur');
    expect(classifyDay(rdOf(2026, 9, 21), opts()).isBusinessDay).toBe(false);
  });

  it("Yom HaAtzma'ut (2026-04-22, a modern/civil holiday, not a religious Yom Tov) still blocks", () => {
    const c = classifyDay(rdOf(2026, 4, 22), opts());
    expect(c.holiday?.en).toBe("Yom HaAtzma'ut");
    expect(c.isBusinessDay).toBe(false);
  });

  it('Purim (2026-03-03) is an ordinary business day', () => {
    const c = classifyDay(rdOf(2026, 3, 3), opts());
    expect(c.holiday).toBeNull();
    expect(c.isBusinessDay).toBe(true);
  });

  it('Chol HaMoed Sukkot (2026-09-28) is a business day by default (TOP60.md 4.5 edge case)', () => {
    const c = classifyDay(rdOf(2026, 9, 28), opts());
    expect(c.holiday).toBeNull();
    expect(c.isBusinessDay).toBe(true);
  });

  it('iso-mon-fri ignores Israeli holidays entirely: Yom Kippur is an ordinary Monday business day', () => {
    // 2026-09-21 is a Monday.
    const c = classifyDay(rdOf(2026, 9, 21), opts({ profile: 'iso-mon-fri' }));
    expect(c.holiday).toBeNull();
    expect(c.isBusinessDay).toBe(true);
  });
});

describe('half-days: Erev-chag and (TASE only) Friday early close', () => {
  it('Erev Yom Kippur (2026-09-20) is a half day, still a business day by default', () => {
    const c = classifyDay(rdOf(2026, 9, 20), opts());
    expect(c.isHalfDay).toBe(true);
    expect(c.halfDayReason?.en).toMatch(/Erev Yom Kippur/);
    expect(c.isBusinessDay).toBe(true);
  });

  it('halfDaysAreBusiness=false makes an Erev-chag day non-business', () => {
    const c = classifyDay(rdOf(2026, 9, 20), opts({ halfDaysAreBusiness: false }));
    expect(c.isBusinessDay).toBe(false);
  });

  it('TASE Friday (post-switch) is a half day only on that profile', () => {
    const fridayRd = civilToRd(2026, 1, 9); // a Friday after the 2026-01-05 switch
    const tase = classifyDay(fridayRd, opts({ profile: 'il-tase-mon-fri' }));
    expect(tase.isHalfDay).toBe(true);
    expect(tase.halfDayReason?.en).toMatch(/TASE Friday/);
    const sunThu = classifyDay(fridayRd, opts({ profile: 'il-workweek-sun-thu' }));
    expect(sunThu.isWeekend).toBe(true); // Friday is a full weekend day on this profile, not a half day
  });

  it('pre-switch Friday on the TASE profile is a full weekend day, not a half day', () => {
    const fridayRd = civilToRd(2026, 1, 2);
    const c = classifyDay(fridayRd, opts({ profile: 'il-tase-mon-fri' }));
    expect(c.isWeekend).toBe(true);
    expect(c.isHalfDay).toBe(false);
  });
});

describe('extraHolidays', () => {
  it('blocks a business day in every profile, in addition to the built-in set', () => {
    const rd = rdOf(2026, 3, 17); // an ordinary Tuesday
    expect(classifyDay(rd, opts()).isBusinessDay).toBe(true);
    const withExtra = classifyDay(rd, opts({ extraHolidays: new Set(['2026-03-17']) }));
    expect(withExtra.isBusinessDay).toBe(false);
    expect(withExtra.isExtraHoliday).toBe(true);
  });
});
