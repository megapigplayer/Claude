/**
 * One calculation request -> one output row (pure; never throws). Ties together calendar-profile.ts,
 * business-days.ts and payment-terms.ts. Output field names match TOP60.md 4.5's "Output" list
 * (result, weekday, resultHebrewDate, rolled/rollReason, businessDaysCount, holidaysInRange, halfDay,
 * assumptions), each also given a `*He` Hebrew twin per this repo's convention.
 */
import { WEEKDAYS_EN, WEEKDAYS_HE, isoFromRd, parseIsoDate, weekdayOfRd } from './civil.js';
import type { CalendarProfile, DayClassification, ProfileOptions } from './calendar-profile.js';
import { classifyDay } from './calendar-profile.js';
import {
  type RollConvention,
  addBusinessDays,
  countBusinessDaysBetween,
  nextBusinessDay,
  rollToBusinessDay,
  subtractBusinessDays,
} from './business-days.js';
import { formatHebrewDateEn, formatHebrewDateHe } from './hebrew.js';
import { rdToHebrew } from './hebrew-calendar.js';
import { parsePaymentTerms, rawDueDateRd } from './payment-terms.js';

export type Operation = 'add' | 'subtract' | 'count-between' | 'next' | 'is-business-day' | 'payment-due';
export const OPERATIONS: readonly Operation[] = ['add', 'subtract', 'count-between', 'next', 'is-business-day', 'payment-due'];

export interface CalculationInput {
  operation: Operation;
  startDate: string;
  days: number;
  endDate: string | null;
  paymentTerms: string | null;
  calendarProfile: CalendarProfile;
  rollConvention: RollConvention;
  customWeekendDays: number[] | null;
  extraHolidays: string[];
  halfDaysAreBusiness: boolean;
}

export interface HolidayInRangeRow {
  date: string;
  name: string | null;
  nameHe: string | null;
  reason: 'holiday' | 'extra-holiday';
}

export interface Assumptions {
  calendarProfile: CalendarProfile;
  rollConvention: RollConvention;
  halfDaysAreBusiness: boolean;
  customWeekendDays: number[] | null;
  extraHolidaysCount: number;
}

export interface ResultRow {
  input: string;
  position: number;
  operation: Operation;
  status: 'ok' | 'error';
  reasonCode: string;
  reason: string | null;
  result: string | null;
  weekday: string | null;
  weekdayHe: string | null;
  resultHebrewDate: string | null;
  resultHebrewDateHe: string | null;
  isBusinessDay: boolean | null;
  rolled: boolean | null;
  rollReason: string | null;
  rollReasonHe: string | null;
  businessDaysCount: number | null;
  holidaysInRange: HolidayInRangeRow[] | null;
  halfDay: boolean | null;
  halfDayReason: string | null;
  halfDayReasonHe: string | null;
  assumptions: Assumptions;
}

function assumptionsOf(input: CalculationInput): Assumptions {
  return {
    calendarProfile: input.calendarProfile,
    rollConvention: input.rollConvention,
    halfDaysAreBusiness: input.halfDaysAreBusiness,
    customWeekendDays: input.calendarProfile === 'custom' ? [...(input.customWeekendDays ?? [5, 6])] : null,
    extraHolidaysCount: input.extraHolidays.length,
  };
}

function profileOptionsOf(input: CalculationInput): ProfileOptions {
  return {
    profile: input.calendarProfile,
    customWeekendDays: input.customWeekendDays,
    extraHolidays: new Set(input.extraHolidays),
    halfDaysAreBusiness: input.halfDaysAreBusiness,
  };
}

function toHolidayRow(c: DayClassification): HolidayInRangeRow {
  if (c.holiday) return { date: c.iso, name: c.holiday.en, nameHe: c.holiday.he, reason: 'holiday' };
  return { date: c.iso, name: null, nameHe: null, reason: 'extra-holiday' };
}

function blankRow(record: { input: string; position: number }, operation: Operation, status: 'ok' | 'error', reasonCode: string, reason: string | null, assumptions: Assumptions): ResultRow {
  return {
    input: record.input,
    position: record.position,
    operation,
    status,
    reasonCode,
    reason,
    result: null,
    weekday: null,
    weekdayHe: null,
    resultHebrewDate: null,
    resultHebrewDateHe: null,
    isBusinessDay: null,
    rolled: null,
    rollReason: null,
    rollReasonHe: null,
    businessDaysCount: null,
    holidaysInRange: null,
    halfDay: null,
    halfDayReason: null,
    halfDayReasonHe: null,
    assumptions,
  };
}

function errorRow(record: { input: string; position: number }, operation: Operation, reasonCode: string, reason: string, assumptions: Assumptions): ResultRow {
  return blankRow(record, operation, 'error', reasonCode, reason, assumptions);
}

function okRow(record: { input: string; position: number }, operation: Operation, assumptions: Assumptions, fields: Partial<ResultRow>): ResultRow {
  return { ...blankRow(record, operation, 'ok', 'OK', null, assumptions), ...fields };
}

function dateFields(rd: number): { result: string; weekday: string; weekdayHe: string; resultHebrewDate: string; resultHebrewDateHe: string } {
  const weekday = weekdayOfRd(rd);
  const heb = rdToHebrew(rd);
  return {
    result: isoFromRd(rd),
    weekday: WEEKDAYS_EN[weekday] as string,
    weekdayHe: WEEKDAYS_HE[weekday] as string,
    resultHebrewDate: formatHebrewDateEn(heb),
    resultHebrewDateHe: formatHebrewDateHe(heb),
  };
}

/** Build the output row for one calculation. Never throws (bounded walks in business-days.ts are caught here). */
export function buildRow(record: { input: string; position: number }, input: CalculationInput): ResultRow {
  const assumptions = assumptionsOf(input);
  const options = profileOptionsOf(input);

  const start = parseIsoDate(input.startDate);
  if (!start.ok) return errorRow(record, input.operation, 'INVALID_START_DATE', `"startDate" must be a real ISO date (YYYY-MM-DD); got "${input.startDate}".`, assumptions);

  try {
    switch (input.operation) {
      case 'add':
      case 'subtract': {
        const { resultRd, skipped } = input.operation === 'add' ? addBusinessDays(start.rd, input.days, options) : subtractBusinessDays(start.rd, input.days, options);
        return okRow(record, input.operation, assumptions, {
          ...dateFields(resultRd),
          rolled: false,
          holidaysInRange: skipped.filter((c) => c.holiday || c.isExtraHoliday).map(toHolidayRow),
        });
      }
      case 'next': {
        const { resultRd, skipped } = nextBusinessDay(start.rd, options);
        return okRow(record, input.operation, assumptions, {
          ...dateFields(resultRd),
          rolled: false,
          holidaysInRange: skipped.filter((c) => c.holiday || c.isExtraHoliday).map(toHolidayRow),
        });
      }
      case 'is-business-day': {
        const c = classifyDay(start.rd, options);
        return okRow(record, input.operation, assumptions, {
          ...dateFields(start.rd),
          isBusinessDay: c.isBusinessDay,
          rolled: false,
          holidaysInRange: c.holiday || c.isExtraHoliday ? [toHolidayRow(c)] : [],
          halfDay: c.isHalfDay,
          halfDayReason: c.halfDayReason?.en ?? null,
          halfDayReasonHe: c.halfDayReason?.he ?? null,
        });
      }
      case 'count-between': {
        if (input.endDate === null) return errorRow(record, input.operation, 'MISSING_END_DATE', '"endDate" is required for operation "count-between".', assumptions);
        const end = parseIsoDate(input.endDate);
        if (!end.ok) return errorRow(record, input.operation, 'INVALID_END_DATE', `"endDate" must be a real ISO date (YYYY-MM-DD); got "${input.endDate}".`, assumptions);
        const { count, holidaysInRange } = countBusinessDaysBetween(start.rd, end.rd, options);
        return okRow(record, input.operation, assumptions, {
          result: isoFromRd(end.rd),
          businessDaysCount: count,
          holidaysInRange: holidaysInRange.map(toHolidayRow),
        });
      }
      case 'payment-due': {
        if (input.paymentTerms === null) return errorRow(record, input.operation, 'MISSING_PAYMENT_TERMS', '"paymentTerms" is required for operation "payment-due" (e.g. "שוטף+60" or "net-eom+30").', assumptions);
        const term = parsePaymentTerms(input.paymentTerms);
        if (!term) {
          return errorRow(record, input.operation, 'UNPARSEABLE_PAYMENT_TERMS', `Could not parse "${input.paymentTerms}" as a payment term. Use "שוטף+N" or "net-eom+N", e.g. "שוטף+60".`, assumptions);
        }
        const rawRd = rawDueDateRd(start.rd, term);
        const roll = rollToBusinessDay(rawRd, input.rollConvention, options);
        const finalDay = classifyDay(roll.resultRd, options);
        return okRow(record, input.operation, assumptions, {
          ...dateFields(roll.resultRd),
          rolled: roll.rolled,
          rollReason: roll.rollReason?.en ?? null,
          rollReasonHe: roll.rollReason?.he ?? null,
          holidaysInRange: finalDay.holiday || finalDay.isExtraHoliday ? [toHolidayRow(finalDay)] : [],
          halfDay: finalDay.isHalfDay,
          halfDayReason: finalDay.halfDayReason?.en ?? null,
          halfDayReasonHe: finalDay.halfDayReason?.he ?? null,
        });
      }
    }
  } catch (e) {
    return errorRow(record, input.operation, 'INTERNAL_ERROR', `Unexpected error while computing this entry: ${e instanceof Error ? e.message : String(e)}`, assumptions);
  }
}
