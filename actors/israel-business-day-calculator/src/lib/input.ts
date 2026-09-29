/**
 * Input normalisation for the Israeli Business-Day and Payment-Terms Calculator (pure).
 *
 * `calculations` is the work-defining field: a list of overrides merged onto the top-level
 * defaults (which mirror TOP60.md 4.5's stated defaults exactly, so the bare top-level fields work
 * as a single-calculation call too). Absent -> one demo calculation using the top-level defaults;
 * present but empty -> InputError.
 */
import type { CalendarProfile } from './calendar-profile.js';
import { CALENDAR_PROFILES } from './calendar-profile.js';
import type { RollConvention } from './business-days.js';
import type { Operation } from './calculate.js';
import { OPERATIONS } from './calculate.js';

export interface ActorInput {
  calculations: unknown[];
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

const ROLL_CONVENTIONS: readonly RollConvention[] = ['following', 'modified-following', 'preceding'];

/**
 * Two entries (not one) so the daily/smoke test can also exercise a caller's maximum-charge cap
 * (which needs at least one entry to still be pending when the budget runs out). The first entry
 * ({}) uses every top-level default; the second demos a different operation on the same startDate.
 */
const DEFAULT_CALCULATIONS: unknown[] = [{}, { operation: 'next' }];

/** Mirror of the prefill/default values in .actor/input_schema.json (a unit test enforces this). */
export const DEFAULT_INPUT: ActorInput = {
  calculations: DEFAULT_CALCULATIONS,
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

export const MAX_DAYS = 100_000;
export const MAX_CALCULATIONS = 10_000;

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

function has(obj: Record<string, unknown>, key: string): boolean {
  return obj[key] !== undefined && obj[key] !== null;
}

function pickEnum<T extends string>(obj: Record<string, unknown>, key: string, allowed: readonly T[], fallback: T): T {
  if (!has(obj, key)) return fallback;
  const v = obj[key];
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    const hit = allowed.find((a) => a.toLowerCase() === t);
    if (hit !== undefined) return hit;
  }
  throw new InputError(`Input field "${key}" must be one of: ${allowed.map((a) => `"${a}"`).join(', ')}.`);
}

function pickString(obj: Record<string, unknown>, key: string, fallback: string): string {
  if (!has(obj, key)) return fallback;
  if (typeof obj[key] !== 'string') throw new InputError(`Input field "${key}" must be a string.`);
  return (obj[key] as string).trim();
}

function pickOptionalString(obj: Record<string, unknown>, key: string, fallback: string | null): string | null {
  if (!has(obj, key)) return fallback;
  if (typeof obj[key] !== 'string' || (obj[key] as string).trim() === '') throw new InputError(`Input field "${key}" must be a non-empty string.`);
  return (obj[key] as string).trim();
}

function pickInt(obj: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  if (!has(obj, key)) return fallback;
  const v = obj[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) throw new InputError(`Input field "${key}" must be a number.`);
  const whole = Math.trunc(n);
  if (whole < min || whole > max) throw new InputError(`Input field "${key}" must be between ${min} and ${max}.`);
  return whole;
}

function pickBool(obj: Record<string, unknown>, key: string, fallback: boolean): boolean {
  if (!has(obj, key)) return fallback;
  const v = obj[key];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (t === 'true') return true;
    if (t === 'false') return false;
  }
  throw new InputError(`Input field "${key}" must be true or false.`);
}

function pickWeekendDays(obj: Record<string, unknown>, fallback: number[] | null): number[] | null {
  if (!has(obj, 'customWeekendDays')) return fallback;
  const v = obj.customWeekendDays;
  if (!Array.isArray(v)) throw new InputError('Input field "customWeekendDays" must be an array of weekday numbers (0=Sunday .. 6=Saturday).');
  const days = v.map((x) => (typeof x === 'number' ? x : Number(x)));
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new InputError('Input field "customWeekendDays" must contain only whole numbers 0-6 (0=Sunday .. 6=Saturday).');
  }
  return [...new Set(days)].sort((a, b) => a - b);
}

function pickExtraHolidays(obj: Record<string, unknown>, fallback: string[]): string[] {
  if (!has(obj, 'extraHolidays')) return fallback;
  const v = obj.extraHolidays;
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\r?\n/) : null;
  if (list === null) throw new InputError('Input field "extraHolidays" must be an array of ISO dates (YYYY-MM-DD).');
  const dates: string[] = [];
  for (const raw of list) {
    const t = String(raw).trim();
    if (t === '') continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new InputError(`Input field "extraHolidays" has an invalid ISO date "${t}"; use YYYY-MM-DD.`);
    dates.push(t);
  }
  return dates;
}

/** Parse the shared options (everything except `calculations` itself), falling back to `fallback` for anything absent from `obj`. */
function parseOptions(obj: Record<string, unknown>, fallback: Omit<ActorInput, 'calculations'>): Omit<ActorInput, 'calculations'> {
  return {
    operation: pickEnum(obj, 'operation', OPERATIONS, fallback.operation),
    startDate: pickString(obj, 'startDate', fallback.startDate),
    days: pickInt(obj, 'days', fallback.days, -MAX_DAYS, MAX_DAYS),
    endDate: pickOptionalString(obj, 'endDate', fallback.endDate),
    paymentTerms: pickOptionalString(obj, 'paymentTerms', fallback.paymentTerms),
    calendarProfile: pickEnum(obj, 'calendarProfile', CALENDAR_PROFILES, fallback.calendarProfile),
    rollConvention: pickEnum(obj, 'rollConvention', ROLL_CONVENTIONS, fallback.rollConvention),
    customWeekendDays: pickWeekendDays(obj, fallback.customWeekendDays),
    extraHolidays: pickExtraHolidays(obj, fallback.extraHolidays),
    halfDaysAreBusiness: pickBool(obj, 'halfDaysAreBusiness', fallback.halfDaysAreBusiness),
  };
}

export function normalizeInput(raw: unknown): ActorInput {
  // No input at all, or {} (the daily health check / a bare `apify run` may send either): the
  // full two-entry demo, not just one, so the daily test also exercises a caller's charge cap.
  if (raw === null || raw === undefined || (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0)) {
    return { ...DEFAULT_INPUT, calculations: [...DEFAULT_CALCULATIONS] };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new InputError('Input must be a JSON object.');
  const obj = raw as Record<string, unknown>;

  const topLevel = parseOptions(obj, DEFAULT_INPUT);

  // Top-level fields only, no "calculations" key: exactly one calculation from them (API/single-call use).
  if (!has(obj, 'calculations')) return { ...topLevel, calculations: [{}] };
  if (!Array.isArray(obj.calculations)) throw new InputError('Input field "calculations" must be an array of calculation objects.');
  const nonBlank = obj.calculations.filter((c) => !(c === null || c === undefined));
  if (nonBlank.length === 0) throw new InputError('No calculations found: "calculations" is empty. Add at least one (an empty object {} uses the top-level defaults).');
  if (nonBlank.length > MAX_CALCULATIONS) throw new InputError(`"calculations" has ${nonBlank.length} entries; the maximum is ${MAX_CALCULATIONS}.`);
  return { ...topLevel, calculations: nonBlank };
}

/** Merge one `calculations[]` entry onto the run's top-level options (the entry's own fields win). Throws InputError for a malformed entry. */
export function mergeCalculation(entry: unknown, topLevel: Omit<ActorInput, 'calculations'>): Omit<ActorInput, 'calculations'> {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new InputError('Each "calculations" entry must be an object (it may be empty, {}, to use the top-level defaults).');
  }
  return parseOptions(entry as Record<string, unknown>, topLevel);
}
