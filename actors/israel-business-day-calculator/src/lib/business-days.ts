/**
 * Business-day arithmetic on R.D. (Rata Die) day numbers: pure integer stepping over
 * `calendar-profile.ts`'s day classification, so every rule (weekend shape, statutory holidays,
 * half-days) lives in exactly one place.
 */
import { rdToCivil } from './civil.js';
import { type DayClassification, type ProfileOptions, classifyDay } from './calendar-profile.js';
import type { NamedHoliday } from './hebrew-calendar.js';

/** Safety bound (~10 years of calendar days) against a pathological profile/extraHolidays combination that would otherwise loop indefinitely. */
export const MAX_WALK_STEPS = 3660;

export class BusinessDayLimitError extends Error {}

export interface WalkResult {
  resultRd: number;
  /** Every non-business day skipped along the way, in the order visited. */
  skipped: DayClassification[];
}

function walk(startRd: number, count: number, direction: 1 | -1, options: ProfileOptions): WalkResult {
  const skipped: DayClassification[] = [];
  let rd = startRd;
  let found = 0;
  let steps = 0;
  while (found < count) {
    rd += direction;
    steps++;
    if (steps > MAX_WALK_STEPS) {
      throw new BusinessDayLimitError(`No business day found within ${MAX_WALK_STEPS} days; check your calendarProfile / extraHolidays.`);
    }
    const c = classifyDay(rd, options);
    if (c.isBusinessDay) found++;
    else skipped.push(c);
  }
  return { resultRd: rd, skipped };
}

/** The Nth business day strictly AFTER startRd (startRd itself is never counted, even if it is a business day). */
export function addBusinessDays(startRd: number, count: number, options: ProfileOptions): WalkResult {
  if (count < 0) return subtractBusinessDays(startRd, -count, options);
  if (count === 0) return { resultRd: startRd, skipped: [] };
  return walk(startRd, count, 1, options);
}

/** The Nth business day strictly BEFORE startRd. */
export function subtractBusinessDays(startRd: number, count: number, options: ProfileOptions): WalkResult {
  if (count < 0) return addBusinessDays(startRd, -count, options);
  if (count === 0) return { resultRd: startRd, skipped: [] };
  return walk(startRd, count, -1, options);
}

/** The next business day strictly after startRd (equivalent to addBusinessDays(startRd, 1, ...)). */
export function nextBusinessDay(startRd: number, options: ProfileOptions): WalkResult {
  return addBusinessDays(startRd, 1, options);
}

export interface CountResult {
  /** Positive when toRd > fromRd, negative when toRd < fromRd, 0 when equal. Symmetric with add/subtract: countBusinessDaysBetween(A, addBusinessDays(A, N)) === N. */
  count: number;
  holidaysInRange: DayClassification[];
}

/** Business days in (fromRd, toRd] (or, descending, [toRd, fromRd)) - see addBusinessDays for why the start day itself is excluded. */
export function countBusinessDaysBetween(fromRd: number, toRd: number, options: ProfileOptions): CountResult {
  if (fromRd === toRd) return { count: 0, holidaysInRange: [] };
  const ascending = toRd > fromRd;
  const lo = ascending ? fromRd + 1 : toRd;
  const hi = ascending ? toRd : fromRd - 1;
  let count = 0;
  const holidaysInRange: DayClassification[] = [];
  for (let rd = lo; rd <= hi; rd++) {
    const c = classifyDay(rd, options);
    if (c.isBusinessDay) count++;
    if (c.holiday || c.isExtraHoliday) holidaysInRange.push(c);
  }
  return { count: ascending ? count : -count, holidaysInRange };
}

export type RollConvention = 'following' | 'modified-following' | 'preceding';

export interface RollResult {
  resultRd: number;
  rolled: boolean;
  /** Bilingual reason the ORIGINAL date needed rolling (its holiday name, or a generic weekend/extra-holiday note); null when no rolling was needed. */
  rollReason: NamedHoliday | null;
}

const WEEKEND_REASON: NamedHoliday = { en: 'Weekend', he: 'סוף שבוע' };
const EXTRA_HOLIDAY_REASON: NamedHoliday = { en: 'Extra holiday (caller-supplied)', he: 'חג נוסף (שסופק על ידי המשתמש)' };

function blockingReason(c: DayClassification): NamedHoliday {
  if (c.holiday) return c.holiday;
  if (c.isExtraHoliday) return EXTRA_HOLIDAY_REASON;
  return WEEKEND_REASON;
}

/** Roll `rd` onto a business day per `convention`, if it is not already one. Never throws for a bounded search (see MAX_WALK_STEPS). */
export function rollToBusinessDay(rd: number, convention: RollConvention, options: ProfileOptions): RollResult {
  const original = classifyDay(rd, options);
  if (original.isBusinessDay) return { resultRd: rd, rolled: false, rollReason: null };
  const reason = blockingReason(original);

  const forward = (from: number): number => {
    let r = from;
    let steps = 0;
    while (!classifyDay(r, options).isBusinessDay) {
      r += 1;
      if (++steps > MAX_WALK_STEPS) throw new BusinessDayLimitError(`No business day found within ${MAX_WALK_STEPS} days.`);
    }
    return r;
  };
  const backward = (from: number): number => {
    let r = from;
    let steps = 0;
    while (!classifyDay(r, options).isBusinessDay) {
      r -= 1;
      if (++steps > MAX_WALK_STEPS) throw new BusinessDayLimitError(`No business day found within ${MAX_WALK_STEPS} days.`);
    }
    return r;
  };

  if (convention === 'preceding') return { resultRd: backward(rd), rolled: true, rollReason: reason };

  const forwardResult = forward(rd);
  if (convention === 'modified-following') {
    const orig = rdToCivil(rd);
    const rolled = rdToCivil(forwardResult);
    if (rolled.year !== orig.year || rolled.month !== orig.month) {
      return { resultRd: backward(rd), rolled: true, rollReason: reason };
    }
  }
  return { resultRd: forwardResult, rolled: true, rollReason: reason };
}
