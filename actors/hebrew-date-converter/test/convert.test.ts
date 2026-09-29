import { describe, expect, it } from 'vitest';
import { civilToRd } from '../src/lib/civil.js';
import type { ConvertOptions, InputRecord } from '../src/lib/convert.js';
import { addToSummary, buildBatch, buildRow, emptySummary, errorRow, isChargeable, safeBuildRow } from '../src/lib/convert.js';

const BASE: ConvertOptions = {
  direction: 'auto',
  afterSunset: false,
  language: 'both',
  mode: 'convert',
  anniversaryYears: 5,
  anniversaryType: 'birthday',
  anniversaryFromRd: null,
  adarRule: 'default',
  schedule: 'israel',
  addTags: true,
};

function rec(input: string, position = 1): InputRecord {
  return { input, position, raw: input };
}

describe('buildRow: TOP60 spec anchor dates for 2026 / 5787', () => {
  it('2026-09-12 = 1 Tishrei 5787 (Rosh Hashana)', () => {
    const row = buildRow(rec('2026-09-12'), BASE);
    expect(row).toMatchObject({ status: 'ok', direction: 'g2h', gregorian: '2026-09-12', hebrewDay: 1, hebrewMonthNumber: 7, hebrewYear: 5787, isLeapYear: true });
    expect(row.holiday).toMatch(/Rosh Hashana/);
  });

  it('2026-09-21 = 10 Tishrei 5787 (Yom Kippur)', () => {
    const row = buildRow(rec('2026-09-21'), BASE);
    expect(row).toMatchObject({ status: 'ok', hebrewDay: 10, hebrewMonthNumber: 7, hebrewYear: 5787 });
    expect(row.holiday).toMatch(/Yom Kippur/);
  });

  it('2026-09-28 = 17 Tishrei 5787', () => {
    const row = buildRow(rec('2026-09-28'), BASE);
    expect(row).toMatchObject({ status: 'ok', hebrewDay: 17, hebrewMonthNumber: 7, hebrewYear: 5787, hebrewString: '17 Tishrei 5787', hebrewStringHe: 'י״ז בתשרי תשפ״ז' });
  });

  it('2026-05-22 = 6 Sivan 5786 (Shavuot)', () => {
    const row = buildRow(rec('2026-05-22'), BASE);
    expect(row).toMatchObject({ status: 'ok', hebrewDay: 6, hebrewMonthNumber: 3, hebrewYear: 5786, isLeapYear: false });
    expect(row.holiday).toMatch(/Shavuot/);
  });
});

describe('buildRow: round trip and direction/language options', () => {
  it('g2h then h2g on the resulting Hebrew string returns the same Gregorian date', () => {
    const g = buildRow(rec('2026-09-28'), BASE);
    const h2g = buildRow(rec(`${g.hebrewDay} ${g.hebrewMonth} ${g.hebrewYear}`), { ...BASE, direction: 'h2g' });
    expect(h2g.gregorian).toBe(g.gregorian);
  });

  it('afterSunset rolls the Hebrew day forward without changing the Gregorian date shown', () => {
    const day = buildRow(rec('2026-09-11'), BASE);
    const evening = buildRow(rec('2026-09-11'), { ...BASE, afterSunset: true });
    expect(evening.gregorian).toBe(day.gregorian);
    expect(evening.hebrewDayGregorian).not.toBe(day.hebrewDayGregorian);
    expect(evening.afterSunset).toBe(true);
  });

  it('language="en" fills only English fields; language="he" only Hebrew fields', () => {
    const en = buildRow(rec('2026-09-12'), { ...BASE, language: 'en' });
    expect(en.hebrewString).not.toBeNull();
    expect(en.hebrewStringHe).toBeNull();
    expect(en.holidayHe).toBeNull();

    const he = buildRow(rec('2026-09-12'), { ...BASE, language: 'he' });
    expect(he.hebrewString).toBeNull();
    expect(he.hebrewStringHe).not.toBeNull();
  });

  it('addTags=false never fills holiday/parasha', () => {
    const row = buildRow(rec('2026-09-12'), { ...BASE, addTags: false });
    expect(row.holiday).toBeNull();
    expect(row.holidaySchedule).toBeNull();
  });

  it('schedule affects Israel vs diaspora holiday tagging (second-day yom tov)', () => {
    // Shemini Atzeret / Simchat Torah: one day in Israel, two days (separate names) in the diaspora.
    const il = buildRow(rec('2026-10-04'), { ...BASE, schedule: 'israel' });
    const diaspora = buildRow(rec('2026-10-04'), { ...BASE, schedule: 'diaspora' });
    expect(il.holiday).not.toBe(diaspora.holiday);
  });
});

describe('buildRow: error entries never throw and carry a reasonCode', () => {
  it('blank, invalid date, ambiguous format', () => {
    expect(buildRow(rec(''), BASE)).toMatchObject({ status: 'error', reasonCode: 'EMPTY' });
    expect(buildRow(rec('2026-02-30'), BASE)).toMatchObject({ status: 'error', reasonCode: 'INVALID_DATE' });
    expect(buildRow(rec('12/09/2026'), BASE)).toMatchObject({ status: 'error', reasonCode: 'AMBIGUOUS_DATE_FORMAT' });
  });

  it('every field except input/position/status/reasonCode/reason is null on an error row', () => {
    const row = errorRow(rec('bad'), 'X', 'reason');
    const { input, position, status, reasonCode, reason, ...rest } = row;
    for (const [k, v] of Object.entries(rest)) expect(v, k).toBeNull();
  });
});

describe('safeBuildRow', () => {
  it('turns an unexpected throw into an INTERNAL_ERROR row instead of propagating', () => {
    const boom = () => {
      throw new Error('kaboom');
    };
    const row = safeBuildRow(rec('x'), BASE, boom as never);
    expect(row).toMatchObject({ status: 'error', reasonCode: 'INTERNAL_ERROR' });
    expect(row.reason).toContain('kaboom');
  });
});

describe('isChargeable / buildBatch', () => {
  it('only status="ok" rows are chargeable', () => {
    expect(isChargeable(buildRow(rec('2026-09-12'), BASE))).toBe(true);
    expect(isChargeable(buildRow(rec('not a date'), BASE))).toBe(false);
  });

  it('stops filling the batch as soon as the billable count reaches remainingChargeable (checked before each row)', () => {
    const records = [rec('2026-09-12', 1), rec('bad', 2), rec('2026-09-13', 3), rec('2026-09-14', 4)];
    const { rows, billable } = buildBatch(records, 0, 1, BASE, 10);
    expect(billable).toBe(1);
    expect(rows.map((r) => r.input)).toEqual(['2026-09-12']);
  });

  it('free (error) rows before the budget is used up do not count against it', () => {
    const records = [rec('bad', 1), rec('2026-09-12', 2), rec('2026-09-13', 3)];
    const { rows, billable } = buildBatch(records, 0, 1, BASE, 10);
    expect(billable).toBe(1);
    expect(rows.map((r) => r.input)).toEqual(['bad', '2026-09-12']);
  });

  it('respects batchSize even with unlimited budget', () => {
    const records = [rec('2026-09-12', 1), rec('2026-09-13', 2), rec('2026-09-14', 3)];
    const { rows } = buildBatch(records, 0, Infinity, BASE, 2);
    expect(rows).toHaveLength(2);
  });

  it('starts at the given offset', () => {
    const records = [rec('2026-09-12', 1), rec('2026-09-13', 2)];
    const { rows } = buildBatch(records, 1, Infinity, BASE, 10);
    expect(rows.map((r) => r.input)).toEqual(['2026-09-13']);
  });
});

describe('run summary', () => {
  it('counts converted/errors and groups by reasonCode and direction', () => {
    const summary = emptySummary();
    addToSummary(summary, buildRow(rec('2026-09-12'), BASE));
    addToSummary(summary, buildRow(rec('bad'), BASE));
    addToSummary(summary, buildRow(rec('2026-09-13'), BASE));
    expect(summary.total).toBe(3);
    expect(summary.converted).toBe(2);
    expect(summary.errors).toBe(1);
    expect(summary.byDirection.g2h).toBe(2);
    expect(summary.byReasonCode.OK).toBe(2);
  });
});

describe('anniversary mode', () => {
  const opts: ConvertOptions = { ...BASE, mode: 'anniversary', anniversaryYears: 3 };

  it('lists the requested number of future anniversaries with Gregorian dates after the original', () => {
    const row = buildRow(rec('2026-09-12'), opts);
    expect(row.anniversaries).toHaveLength(3);
    expect(row.anniversaryType).toBe('birthday');
    for (const a of row.anniversaries ?? []) expect(a.gregorian > '2026-09-12').toBe(true);
  });

  it('anniversaryFromRd skips earlier anniversaries but still returns anniversaryYears results, shifted forward', () => {
    const first = buildRow(rec('2026-09-12'), opts);
    const firstGregorian = first.anniversaries?.[0]?.gregorian as string;
    const [y, m, d] = firstGregorian.split('-').map(Number);
    // Pick a from-date one day after the first anniversary, so it is dropped from the window.
    const fromRd = civilToRd(y as number, m as number, d as number);
    const filtered = buildRow(rec('2026-09-12'), { ...opts, anniversaryFromRd: fromRd + 1 });
    expect(filtered.anniversaries).toHaveLength(3); // still anniversaryYears entries...
    expect(filtered.anniversaries?.[0]?.gregorian).not.toBe(firstGregorian); // ...but the dropped one is gone
    for (const a of filtered.anniversaries ?? []) {
      const [ay, am, ad] = a.gregorian.split('-').map(Number);
      expect(civilToRd(ay as number, am as number, ad as number)).toBeGreaterThanOrEqual(fromRd + 1);
    }
  });

  it('a standing rule note is set for an Adar-origin date', () => {
    const row = buildRow(rec('10 Adar I 5784'), { ...opts, direction: 'h2g' });
    expect(row.ruleNote).toMatch(/leap year/);
  });
});
