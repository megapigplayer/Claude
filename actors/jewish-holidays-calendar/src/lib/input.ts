/**
 * Input normalisation for Jewish Holidays Calendar API (pure: no Apify imports, unit-tested).
 *
 * Unlike this repo's list-of-items Actors, there is no "work-defining list that can be present but
 * empty": `year` is a single number, so it either has a usable value (given or defaulted to 2026)
 * or an explicit InputError for a value that is out of range / not a number - there is no separate
 * "silently run the demo for a paying user" risk to guard against here.
 */
import type { CalendarLanguage, CalendarLocation, CalendarYearType, IncludeCategory } from './holidays.js';
import { INCLUDE_CATEGORIES } from './holidays.js';

export type OutputFormat = 'json' | 'csv' | 'ics';

export interface ActorInput {
  year: number;
  yearType: CalendarYearType;
  location: CalendarLocation;
  include: IncludeCategory[];
  language: CalendarLanguage;
  format: OutputFormat;
}

/** Mirror of the prefill/default values in .actor/input_schema.json (a unit test enforces this). */
export const DEFAULT_INPUT: ActorInput = {
  year: 2026,
  yearType: 'gregorian',
  location: 'israel',
  include: ['major', 'fasts'],
  language: 'both',
  format: 'json',
};

export const MIN_YEAR = 1;
export const MAX_YEAR = 9999;

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

function pickInclude(obj: Record<string, unknown>): IncludeCategory[] {
  if (!has(obj, 'include')) return [...DEFAULT_INPUT.include];
  const v = obj.include;
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : null;
  if (list === null) throw new InputError('Input field "include" must be an array of category names.');
  const result: IncludeCategory[] = [];
  for (const raw of list) {
    const t = String(raw).trim();
    if (t === '') continue;
    const hit = INCLUDE_CATEGORIES.find((c) => c.toLowerCase() === t.toLowerCase());
    if (hit === undefined) {
      throw new InputError(`Input field "include" has an unknown category "${t}"; use one of: ${INCLUDE_CATEGORIES.join(', ')}.`);
    }
    if (!result.includes(hit)) result.push(hit);
  }
  return result;
}

export function normalizeInput(raw: unknown): ActorInput {
  if (raw === null || raw === undefined) return { ...DEFAULT_INPUT, include: [...DEFAULT_INPUT.include] };
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new InputError('Input must be a JSON object.');
  const obj = raw as Record<string, unknown>;

  let year = DEFAULT_INPUT.year;
  if (has(obj, 'year')) {
    const v = obj.year;
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
    if (!Number.isInteger(n) || n < MIN_YEAR || n > MAX_YEAR) {
      throw new InputError(`Input field "year" must be a whole number between ${MIN_YEAR} and ${MAX_YEAR}.`);
    }
    year = n;
  }

  return {
    year,
    yearType: pickEnum(obj, 'yearType', ['gregorian', 'hebrew'] as const, DEFAULT_INPUT.yearType),
    location: pickEnum(obj, 'location', ['israel', 'diaspora'] as const, DEFAULT_INPUT.location),
    include: pickInclude(obj),
    language: pickEnum(obj, 'language', ['en', 'he', 'both'] as const, DEFAULT_INPUT.language),
    format: pickEnum(obj, 'format', ['json', 'csv', 'ics'] as const, DEFAULT_INPUT.format),
  };
}
