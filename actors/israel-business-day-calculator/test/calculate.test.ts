import { describe, expect, it } from 'vitest';
import type { CalculationInput } from '../src/lib/calculate.js';
import { buildRow } from '../src/lib/calculate.js';

const BASE: CalculationInput = {
  operation: 'add',
  startDate: '2026-09-10',
  days: 3,
  endDate: null,
  paymentTerms: null,
  calendarProfile: 'il-workweek-sun-thu',
  rollConvention: 'following',
  customWeekendDays: null,
  extraHolidays: [],
  halfDaysAreBusiness: true,
};
const rec = { input: 'x', position: 1 };

describe('TOP60.md 4.5 anchors, end to end', () => {
  it('Thu 2026-10-08 + 1 = Sun 2026-10-11 (Sun-Thu)', () => {
    const row = buildRow(rec, { ...BASE, startDate: '2026-10-08', days: 1 });
    expect(row).toMatchObject({ status: 'ok', result: '2026-10-11', weekday: 'Sunday' });
  });

  it('Thu 2026-10-08 + 1 = Fri 2026-10-09 (Mon-Fri/TASE)', () => {
    const row = buildRow(rec, { ...BASE, startDate: '2026-10-08', days: 1, calendarProfile: 'il-tase-mon-fri' });
    expect(row).toMatchObject({ status: 'ok', result: '2026-10-09', weekday: 'Friday' });
  });

  it('Fri 2026-09-11 next business day = Mon 2026-09-14', () => {
    const row = buildRow(rec, { ...BASE, operation: 'next', startDate: '2026-09-11' });
    expect(row).toMatchObject({ status: 'ok', result: '2026-09-14', weekday: 'Monday' });
  });

  it('שוטף+30 for 2026-01-15 = Mon 2026-03-02', () => {
    const row = buildRow(rec, { ...BASE, operation: 'payment-due', startDate: '2026-01-15', paymentTerms: 'שוטף+30' });
    expect(row).toMatchObject({ status: 'ok', result: '2026-03-02', weekday: 'Monday' });
  });

  it('שוטף+60 for 2026-01-15 = Wed 2026-04-01, flagged as an Erev Pesach half-day (not rolled)', () => {
    const row = buildRow(rec, { ...BASE, operation: 'payment-due', startDate: '2026-01-15', paymentTerms: 'שוטף+60' });
    expect(row).toMatchObject({ status: 'ok', result: '2026-04-01', weekday: 'Wednesday', rolled: false, halfDay: true });
    expect(row.halfDayReason).toMatch(/Erev Pesach/);
  });
});

describe('is-business-day', () => {
  it('a Friday under Sun-Thu is not a business day', () => {
    const row = buildRow(rec, { ...BASE, operation: 'is-business-day', startDate: '2026-09-11' });
    expect(row.isBusinessDay).toBe(false);
  });

  it('the same Friday IS a (half) business day under the TASE profile, post-switch', () => {
    const row = buildRow(rec, { ...BASE, operation: 'is-business-day', startDate: '2026-10-09', calendarProfile: 'il-tase-mon-fri' });
    expect(row.isBusinessDay).toBe(true);
    expect(row.halfDay).toBe(true);
  });
});

describe('count-between', () => {
  it('is symmetric with add (via the full row, not just business-days.ts)', () => {
    const start = '2026-09-10';
    const added = buildRow(rec, { ...BASE, operation: 'add', startDate: start, days: 5 });
    const counted = buildRow(rec, { ...BASE, operation: 'count-between', startDate: start, endDate: added.result as string });
    expect(counted.businessDaysCount).toBe(5);
  });

  it('requires endDate', () => {
    const row = buildRow(rec, { ...BASE, operation: 'count-between', endDate: null });
    expect(row).toMatchObject({ status: 'error', reasonCode: 'MISSING_END_DATE' });
  });
});

describe('negative and zero counts (TOP60.md 4.5 edge case)', () => {
  it('days=0 returns the start date itself', () => {
    const row = buildRow(rec, { ...BASE, days: 0 });
    expect(row.result).toBe(BASE.startDate);
  });

  it('a negative days on "add" moves backward (same as subtract with the positive count)', () => {
    const forward = buildRow(rec, { ...BASE, operation: 'add', startDate: '2026-09-20', days: -5 });
    const backward = buildRow(rec, { ...BASE, operation: 'subtract', startDate: '2026-09-20', days: 5 });
    expect(forward.result).toBe(backward.result);
  });
});

describe('error rows never throw and carry a reasonCode', () => {
  it('invalid startDate', () => {
    const row = buildRow(rec, { ...BASE, startDate: '2026-02-30' });
    expect(row).toMatchObject({ status: 'error', reasonCode: 'INVALID_START_DATE' });
  });

  it('payment-due without paymentTerms', () => {
    const row = buildRow(rec, { ...BASE, operation: 'payment-due', paymentTerms: null });
    expect(row).toMatchObject({ status: 'error', reasonCode: 'MISSING_PAYMENT_TERMS' });
  });

  it('payment-due with an unparseable paymentTerms', () => {
    const row = buildRow(rec, { ...BASE, operation: 'payment-due', paymentTerms: 'net-45' });
    expect(row).toMatchObject({ status: 'error', reasonCode: 'UNPARSEABLE_PAYMENT_TERMS' });
  });

  it('every field except input/position/operation/status/reasonCode/reason/assumptions is null on an error row', () => {
    const row = buildRow(rec, { ...BASE, startDate: 'not-a-date' });
    const { input, position, operation, status, reasonCode, reason, assumptions, ...rest } = row;
    void input;
    void position;
    void operation;
    void status;
    void reasonCode;
    void reason;
    void assumptions;
    for (const [k, v] of Object.entries(rest)) expect(v, k).toBeNull();
  });
});

describe('assumptions echo the profile', () => {
  it('reflects the merged calendarProfile/rollConvention/halfDaysAreBusiness/extraHolidays', () => {
    const row = buildRow(rec, { ...BASE, calendarProfile: 'il-tase-mon-fri', rollConvention: 'preceding', halfDaysAreBusiness: false, extraHolidays: ['2026-05-01'] });
    expect(row.assumptions).toMatchObject({ calendarProfile: 'il-tase-mon-fri', rollConvention: 'preceding', halfDaysAreBusiness: false, extraHolidaysCount: 1 });
  });

  it('customWeekendDays is only echoed for the "custom" profile', () => {
    const row = buildRow(rec, { ...BASE, calendarProfile: 'custom', customWeekendDays: [4, 5] });
    expect(row.assumptions.customWeekendDays).toEqual([4, 5]);
    const other = buildRow(rec, { ...BASE, calendarProfile: 'il-workweek-sun-thu', customWeekendDays: [4, 5] });
    expect(other.assumptions.customWeekendDays).toBeNull();
  });
});

describe('holidaysInRange', () => {
  it('add() lists the holidays skipped along the way', () => {
    const row = buildRow(rec, { ...BASE, startDate: '2026-09-01', days: 15 });
    expect(row.holidaysInRange?.some((h) => h.name?.startsWith('Rosh Hashana'))).toBe(true);
  });

  it('is-business-day on a holiday reports that one holiday', () => {
    const row = buildRow(rec, { ...BASE, operation: 'is-business-day', startDate: '2026-09-21' }); // Yom Kippur
    expect(row.holidaysInRange).toEqual([{ date: '2026-09-21', name: 'Yom Kippur', nameHe: expect.any(String), reason: 'holiday' }]);
  });
});
