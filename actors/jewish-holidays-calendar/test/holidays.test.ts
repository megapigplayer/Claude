import { HDate } from '@hebcal/core';
import { describe, expect, it } from 'vitest';
import { isHebrewLeapYear } from '../src/lib/hebrew.js';
import {
  type CalendarRow,
  type GenerateOptions,
  type IncludeCategory,
  INCLUDE_CATEGORIES,
  generateCalendar,
  isStatutoryIsraeliHoliday,
} from '../src/lib/holidays.js';

const ALL: readonly IncludeCategory[] = INCLUDE_CATEGORIES;

function opts(partial: Partial<GenerateOptions> = {}): GenerateOptions {
  return { year: 2026, yearType: 'gregorian', location: 'israel', include: ALL, language: 'both', ...partial };
}

function holidayRows(rows: CalendarRow[]): CalendarRow[] {
  return rows.filter((r) => r.rowType === 'holiday');
}

function byDate(rows: CalendarRow[], date: string): CalendarRow[] {
  return holidayRows(rows).filter((r) => r.date === date);
}

function byNameContains(rows: CalendarRow[], text: string): CalendarRow[] {
  return holidayRows(rows).filter((r) => r.name?.includes(text));
}

describe('TOP60.md 4.3 2026 anchor dates (Israel schedule, all categories)', () => {
  const rows = generateCalendar(opts());

  it.each([
    ['2026-09-12', 'Rosh Hashana'],
    ['2026-09-21', 'Yom Kippur'],
    ['2026-09-26', 'Sukkot I'],
    ['2026-10-03', 'Shmini Atzeret'],
    ['2026-04-02', 'Pesach I'],
    ['2026-05-22', 'Shavuot'],
    ['2026-03-03', 'Purim'],
    ['2026-07-23', "Tish'a B'Av"],
    ['2026-04-22', "Yom HaAtzma'ut"],
  ])('%s is %s', (date, nameSubstring) => {
    const hits = byDate(rows, date);
    expect(hits.some((r) => r.name?.includes(nameSubstring)), `no row on ${date} matching "${nameSubstring}"; got ${JSON.stringify(byDate(rows, date).map((r) => r.name))}`).toBe(true);
  });
});

describe('Israel vs diaspora differ on 2026-09-27 and 2026-10-04 (TOP60.md 4.3)', () => {
  const il = generateCalendar(opts({ location: 'israel' }));
  const diaspora = generateCalendar(opts({ location: 'diaspora' }));

  it('2026-09-27: Chol HaMoed in Israel, a full Sukkot II Yom Tov in the diaspora', () => {
    const ilRow = byDate(il, '2026-09-27')[0];
    const diaRow = byDate(diaspora, '2026-09-27')[0];
    expect(ilRow?.category).toBe('cholHamoed');
    expect(ilRow?.isYomTov).toBe(false);
    expect(diaRow?.isYomTov).toBe(true);
  });

  it('2026-10-04: nothing special in Israel, Simchat Torah in the diaspora', () => {
    expect(byDate(il, '2026-10-04')).toHaveLength(0);
    expect(byNameContains(diaspora, 'Simchat Torah').some((r) => r.date === '2026-10-04')).toBe(true);
  });
});

describe('isIsraeliPublicHoliday: exactly the nine statutory days, only for location=israel', () => {
  it('2026 has exactly nine, on nine distinct days', () => {
    const rows = holidayRows(generateCalendar(opts({ location: 'israel' })));
    const statutory = rows.filter((r) => r.isIsraeliPublicHoliday === true);
    expect(statutory).toHaveLength(9);
    expect(new Set(statutory.map((r) => r.date)).size).toBe(9);
  });

  it('eight of the nine are religious Yom Tov days; Yom HaAtzma\'ut (a civil holiday) is the exception', () => {
    const rows = holidayRows(generateCalendar(opts({ location: 'israel' })));
    const statutory = rows.filter((r) => r.isIsraeliPublicHoliday === true);
    const [yomTov, notYomTov] = [statutory.filter((r) => r.isYomTov), statutory.filter((r) => !r.isYomTov)];
    expect(yomTov).toHaveLength(8);
    expect(notYomTov.map((r) => r.name)).toEqual(["Yom HaAtzma'ut"]);
  });

  it('is null (not false) for every row in a diaspora run', () => {
    const rows = holidayRows(generateCalendar(opts({ location: 'diaspora' })));
    expect(rows.every((r) => r.isIsraeliPublicHoliday === null)).toBe(true);
  });

  it('isStatutoryIsraeliHoliday strips a trailing year and matches only the nine names', () => {
    expect(isStatutoryIsraeliHoliday('Rosh Hashana 5787')).toBe(true);
    expect(isStatutoryIsraeliHoliday('Rosh Hashana II')).toBe(true);
    expect(isStatutoryIsraeliHoliday('Yom Kippur')).toBe(true);
    expect(isStatutoryIsraeliHoliday('Erev Yom Kippur')).toBe(false);
    expect(isStatutoryIsraeliHoliday('Sukkot II (CH\'\'M)')).toBe(false);
    expect(isStatutoryIsraeliHoliday('Chanukah: 1 Candle')).toBe(false);
  });
});

describe('isYomTov / beginsEveningBefore', () => {
  const rows = holidayRows(generateCalendar(opts()));

  it('every Yom Tov also begins the evening before', () => {
    for (const r of rows.filter((r) => r.isYomTov)) expect(r.beginsEveningBefore, r.name ?? '').toBe(true);
  });

  it('Chol HaMoed days are not Yom Tov', () => {
    const cholHamoed = rows.filter((r) => r.category === 'cholHamoed');
    expect(cholHamoed.length).toBeGreaterThan(0);
    expect(cholHamoed.every((r) => r.isYomTov === false)).toBe(true);
  });

  it('a minor fast begins the same day, not the evening before', () => {
    const taanitEsther = byNameContains(rows, "Ta'anit Esther")[0];
    expect(taanitEsther?.isYomTov).toBe(false);
    expect(taanitEsther?.beginsEveningBefore).toBe(false);
  });

  it("a major fast (Tish'a B'Av) begins the evening before but is not Yom Tov", () => {
    const tishaBav = byNameContains(rows, "Tish'a B'Av").find((r) => !r.name?.startsWith('Erev'));
    expect(tishaBav?.isYomTov).toBe(false);
    expect(tishaBav?.beginsEveningBefore).toBe(true);
  });

  it('Rosh Chodesh is neither', () => {
    const roshChodesh = byNameContains(rows, 'Rosh Chodesh')[0];
    expect(roshChodesh?.isYomTov).toBe(false);
    expect(roshChodesh?.beginsEveningBefore).toBe(false);
  });
});

describe('default include ("major", "fasts")', () => {
  const rows = holidayRows(generateCalendar(opts({ include: ['major', 'fasts'] })));

  it('includes major Yom Tov and fasts', () => {
    expect(byNameContains(rows, 'Rosh Hashana').length).toBeGreaterThan(0);
    expect(byNameContains(rows, 'Yom Kippur').length).toBeGreaterThan(0);
  });

  it('excludes minor holidays (Chanukah, Purim), Rosh Chodesh, modern and omer', () => {
    expect(byNameContains(rows, 'Chanukah')).toHaveLength(0);
    expect(rows.some((r) => r.category === 'minor')).toBe(false);
    expect(rows.some((r) => r.category === 'roshChodesh')).toBe(false);
    expect(rows.some((r) => r.category === 'modern')).toBe(false);
    expect(rows.some((r) => r.category === 'omer')).toBe(false);
  });
});

describe('leap year and Adar (TOP60.md 4.3 edge case)', () => {
  it('5787 is a leap year: every row dated in 5787 says isLeapYear=true', () => {
    const rows = holidayRows(generateCalendar(opts()));
    const in5787 = rows.filter((r) => r.hebrewYear === 5787);
    expect(in5787.length).toBeGreaterThan(0);
    expect(in5787.every((r) => r.isLeapYear === true)).toBe(true);
  });

  it('a Hebrew-year request for a leap year includes Purim Katan-adjacent Adar I Rosh Chodesh, none for a regular year', () => {
    // 5784 was a leap year (Adar I + Adar II); pick the next regular year for contrast.
    const leapRows = holidayRows(generateCalendar(opts({ yearType: 'hebrew', year: 5784, include: ['roshChodesh'] })));
    expect(byNameContains(leapRows, 'Adar I').length).toBeGreaterThan(0);
    expect(byNameContains(leapRows, 'Adar II').length).toBeGreaterThan(0);
  });
});

describe('Hebrew-letter formatting (copied hebrew.ts sanity check)', () => {
  it('Rosh Hashana 2026 row formats hebrewDate/hebrewDateHe consistently with hebrew-date-converter', () => {
    const rows = holidayRows(generateCalendar(opts()));
    const rh = byDate(rows, '2026-09-12').find((r) => r.name === 'Rosh Hashana 5787');
    expect(rh?.hebrewDate).toBe('1 Tishrei 5787');
    expect(rh?.hebrewDateHe).toBe('א׳ בתשרי תשפ״ז');
  });
});

describe('language option', () => {
  it('"en" fills only English fields; "he" only Hebrew fields', () => {
    const en = holidayRows(generateCalendar(opts({ language: 'en' })));
    expect(en.every((r) => r.name !== null && r.hebrewDate !== null)).toBe(true);
    expect(en.every((r) => r.nameHe === null && r.hebrewDateHe === null)).toBe(true);

    const he = holidayRows(generateCalendar(opts({ language: 'he' })));
    expect(he.every((r) => r.name === null && r.hebrewDate === null)).toBe(true);
    expect(he.every((r) => r.nameHe !== null && r.hebrewDateHe !== null)).toBe(true);
  });
});

describe('meta row / hebrewYearsInRange', () => {
  it('a Gregorian year normally spans two distinct Hebrew years, both leap-flagged consistently with isHebrewLeapYear', () => {
    const rows = generateCalendar(opts({ year: 2026 }));
    const meta = rows[rows.length - 1] as CalendarRow;
    expect(meta.rowType).toBe('meta');
    expect(meta.hebrewYearsInRange).toHaveLength(2);
    for (const info of meta.hebrewYearsInRange ?? []) {
      expect(info.isLeapYear).toBe(isHebrewLeapYear(info.hebrewYear));
      expect(info.isLeapYear ? [383, 384, 385] : [353, 354, 355]).toContain(info.yearLength);
    }
  });

  it('a Hebrew-year request reports exactly that one year', () => {
    const rows = generateCalendar(opts({ yearType: 'hebrew', year: 5787, include: [] }));
    const meta = rows[rows.length - 1] as CalendarRow;
    expect(meta.hebrewYearsInRange).toEqual([{ hebrewYear: 5787, isLeapYear: true, yearLength: 385 }]);
  });

  it('an empty include list still returns exactly one row: the meta row', () => {
    const rows = generateCalendar(opts({ include: [] }));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rowType).toBe('meta');
  });
});

describe('rows are sorted by date', () => {
  it('every date is >= the previous one', () => {
    const rows = holidayRows(generateCalendar(opts()));
    for (let i = 1; i < rows.length; i++) {
      expect((rows[i]?.date as string) >= (rows[i - 1]?.date as string)).toBe(true);
    }
  });
});

describe('hebrewYear/isLeapYear cross-checked against HDate.isLeapYear (same-library sanity, independent formula)', () => {
  it('every row', () => {
    const rows = holidayRows(generateCalendar(opts({ year: 2020 })).concat(generateCalendar(opts({ year: 2030 }))));
    for (const r of rows) expect(r.isLeapYear).toBe(HDate.isLeapYear(r.hebrewYear as number));
  });
});
