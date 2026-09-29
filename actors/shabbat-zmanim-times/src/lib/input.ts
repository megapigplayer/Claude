/**
 * Input normalisation for Shabbat Candle-Lighting and Zmanim Times (pure: no Apify imports).
 *
 * `locations` is this Actor's work-defining field: absent/null -> the built-in demo (three cities);
 * present but containing no usable entry -> InputError (never silently run the demo for a caller
 * whose own list was empty). Every OTHER option is validated here too, with a readable message.
 */
import { DEFAULT_HAVDALAH_DEG } from './week.js';

export type IncludeOption = 'shabbat' | 'zmanim' | 'holidays';
export const INCLUDE_OPTIONS: readonly IncludeOption[] = ['shabbat', 'zmanim', 'holidays'];

export interface ActorInput {
  locations: unknown[];
  startDate: string;
  weeks: number;
  include: IncludeOption[];
  candleLightingMinutes: number | null;
  havdalahMinutes: number | null;
  havdalahDeg: number;
}

export const MIN_WEEKS = 1;
export const MAX_WEEKS = 52;

/** Mirror of the prefill/default values in .actor/input_schema.json (a unit test enforces this). */
export const DEFAULT_INPUT: ActorInput = {
  locations: ['Jerusalem', 'Tel Aviv', 'New York'],
  startDate: '2026-10-09',
  weeks: 1,
  include: ['shabbat'],
  candleLightingMinutes: null,
  havdalahMinutes: null,
  havdalahDeg: DEFAULT_HAVDALAH_DEG,
};

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

function has(obj: Record<string, unknown>, key: string): boolean {
  return obj[key] !== undefined && obj[key] !== null;
}

function pickNumber(obj: Record<string, unknown>, key: string, fallback: number, opts: { min?: number; max?: number } = {}): number {
  if (!has(obj, key)) return fallback;
  const v = obj[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) throw new InputError(`Input field "${key}" must be a number.`);
  if (opts.min !== undefined && n < opts.min) throw new InputError(`Input field "${key}" must be >= ${opts.min}.`);
  if (opts.max !== undefined && n > opts.max) throw new InputError(`Input field "${key}" must be <= ${opts.max}.`);
  return n;
}

function pickOptionalInt(obj: Record<string, unknown>, key: string): number | null {
  if (!has(obj, key)) return null;
  return Math.round(pickNumber(obj, key, 0));
}

function pickInclude(obj: Record<string, unknown>): IncludeOption[] {
  if (!has(obj, 'include')) return [...DEFAULT_INPUT.include];
  const v = obj.include;
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : null;
  if (list === null) throw new InputError('Input field "include" must be an array of category names.');
  const result: IncludeOption[] = [];
  for (const raw of list) {
    const t = String(raw).trim();
    if (t === '') continue;
    const hit = INCLUDE_OPTIONS.find((o) => o.toLowerCase() === t.toLowerCase());
    if (hit === undefined) throw new InputError(`Input field "include" has an unknown value "${t}"; use one of: ${INCLUDE_OPTIONS.join(', ')}.`);
    if (!result.includes(hit)) result.push(hit);
  }
  return result;
}

function demoInput(): ActorInput {
  return { ...DEFAULT_INPUT, locations: [...DEFAULT_INPUT.locations], include: [...DEFAULT_INPUT.include] };
}

export function normalizeInput(raw: unknown): ActorInput {
  if (raw === null || raw === undefined) return demoInput();
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new InputError('Input must be a JSON object.');
  const obj = raw as Record<string, unknown>;

  const startDate = has(obj, 'startDate') ? String(obj.startDate).trim() : DEFAULT_INPUT.startDate;
  const weeks = Math.round(pickNumber(obj, 'weeks', DEFAULT_INPUT.weeks, { min: MIN_WEEKS, max: MAX_WEEKS }));
  const include = pickInclude(obj);
  const candleLightingMinutes = pickOptionalInt(obj, 'candleLightingMinutes');
  const havdalahMinutes = pickOptionalInt(obj, 'havdalahMinutes');
  const havdalahDeg = pickNumber(obj, 'havdalahDeg', DEFAULT_INPUT.havdalahDeg, { min: 0, max: 20 });

  if (!has(obj, 'locations')) return { ...demoInput(), startDate, weeks, include, candleLightingMinutes, havdalahMinutes, havdalahDeg };

  let locations: unknown[];
  if (Array.isArray(obj.locations)) locations = obj.locations;
  else if (typeof obj.locations === 'string') locations = obj.locations.split(/\r?\n/);
  else throw new InputError('Input field "locations" must be an array of city names and/or {latitude, longitude, tzid} objects.');

  const nonBlank = locations.filter((l) => !(l === null || l === undefined || (typeof l === 'string' && l.trim() === '')));
  if (nonBlank.length === 0) {
    throw new InputError('No locations found: "locations" contains only blank entries. Add at least one, for example "Jerusalem".');
  }

  return { locations, startDate, weeks, include, candleLightingMinutes, havdalahMinutes, havdalahDeg };
}
