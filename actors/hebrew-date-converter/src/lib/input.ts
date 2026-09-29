/**
 * Input normalisation for the Hebrew Date Converter (pure: no Apify imports, unit-tested).
 *
 * - No INPUT at all, `{}`, or a run that only carries schema defaults (e.g. `maxItems`)
 *   -> the built-in demo input (DEFAULT_INPUT, identical to the prefill/default values in
 *   .actor/input_schema.json; a unit test enforces it). The platform's daily health run must never fail.
 * - `dates` present but containing no usable entry -> InputError (never run the demo for a caller
 *   whose own list was empty).
 * - Every option is validated here with a readable message; bad OPTIONS fail the run, bad DATES
 *   only produce error rows.
 */
import type { AdarRule, AnniversaryType } from './anniversary.js';
import type { ConvertOptions, InputRecord, Language, Mode, Schedule } from './convert.js';
import { type Direction, cleanText, parseDateString } from './parse.js';

export interface ActorInput {
  dates: unknown[];
  direction: Direction;
  afterSunset: boolean;
  language: Language;
  mode: Mode;
  anniversaryYears: number;
  anniversaryType: AnniversaryType;
  /** ISO date; anniversaries before it are skipped. null = start at the first anniversary. */
  anniversaryFrom: string | null;
  adarRule: AdarRule;
  schedule: Schedule;
  addTags: boolean;
  maxItems: number;
}

export const MAX_ITEMS_LIMIT = 100_000;
export const MAX_ANNIVERSARY_YEARS = 100;

/** Mirror of the prefill/default values in .actor/input_schema.json (a unit test enforces it). */
export const DEFAULT_INPUT: ActorInput = {
  dates: ['2026-09-12', '2026-09-28'],
  direction: 'auto',
  afterSunset: false,
  language: 'both',
  mode: 'convert',
  anniversaryYears: 5,
  anniversaryType: 'birthday',
  anniversaryFrom: null,
  adarRule: 'default',
  schedule: 'israel',
  addTags: true,
  maxItems: 10_000,
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

function pickInt(obj: Record<string, unknown>, key: string, fallback: number, min: number, max: number, clamp: boolean): number {
  if (!has(obj, key)) return fallback;
  const v = obj[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  if (!Number.isFinite(n) || n < min) throw new InputError(`Input field "${key}" must be a number >= ${min}.`);
  const whole = Math.floor(n);
  if (whole > max) {
    if (clamp) return max;
    throw new InputError(`Input field "${key}" must be at most ${max}.`);
  }
  return whole;
}

export function normalizeInput(raw: unknown): ActorInput {
  if (raw === null || raw === undefined) return demoInput();
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new InputError('Input must be a JSON object.');
  const obj = raw as Record<string, unknown>;

  const options = {
    direction: pickEnum(obj, 'direction', ['auto', 'g2h', 'h2g'] as const, DEFAULT_INPUT.direction),
    afterSunset: pickBool(obj, 'afterSunset', DEFAULT_INPUT.afterSunset),
    language: pickEnum(obj, 'language', ['en', 'he', 'both'] as const, DEFAULT_INPUT.language),
    mode: pickEnum(obj, 'mode', ['convert', 'anniversary'] as const, DEFAULT_INPUT.mode),
    anniversaryYears: pickInt(obj, 'anniversaryYears', DEFAULT_INPUT.anniversaryYears, 1, MAX_ANNIVERSARY_YEARS, false),
    anniversaryType: pickEnum(obj, 'anniversaryType', ['birthday', 'yahrzeit'] as const, DEFAULT_INPUT.anniversaryType),
    adarRule: pickEnum(obj, 'adarRule', ['default', 'adar-i', 'adar-ii'] as const, DEFAULT_INPUT.adarRule),
    schedule: pickEnum(obj, 'schedule', ['israel', 'diaspora'] as const, DEFAULT_INPUT.schedule),
    addTags: pickBool(obj, 'addTags', DEFAULT_INPUT.addTags),
    maxItems: pickInt(obj, 'maxItems', DEFAULT_INPUT.maxItems, 1, MAX_ITEMS_LIMIT, true),
  };

  let anniversaryFrom: string | null = null;
  if (has(obj, 'anniversaryFrom') && !(typeof obj.anniversaryFrom === 'string' && obj.anniversaryFrom.trim() === '')) {
    const text = obj.anniversaryFrom;
    if (typeof text !== 'string' || parseDateString(text, 'g2h').kind !== 'gregorian') {
      throw new InputError('Input field "anniversaryFrom" must be an ISO date string (YYYY-MM-DD).');
    }
    anniversaryFrom = text.trim();
  }

  if (!has(obj, 'dates')) return { ...demoInput(), ...options, anniversaryFrom };

  let dates: unknown[];
  if (Array.isArray(obj.dates)) dates = obj.dates;
  else if (typeof obj.dates === 'string') dates = obj.dates.split(/\r?\n/);
  else throw new InputError('Input field "dates" must be an array of date strings (or objects).');

  const input: ActorInput = { dates, ...options, anniversaryFrom };
  if (collectRecords(input).records.length === 0) {
    throw new InputError('No dates found: "dates" contains only blank entries. Add at least one date, for example "2026-09-12".');
  }
  return input;
}

function demoInput(): ActorInput {
  return { ...DEFAULT_INPUT, dates: [...DEFAULT_INPUT.dates] };
}

export interface CollectedRecords {
  records: InputRecord[];
  skippedBlank: number;
}

function isBlank(entry: unknown): boolean {
  if (entry === null || entry === undefined) return true;
  return typeof entry === 'string' && cleanText(entry) === '';
}

function echo(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object') {
    try {
      return JSON.stringify(entry);
    } catch {
      return '[object]';
    }
  }
  return String(entry);
}

/** Non-blank entries in input order; blank entries are counted, never converted and never billed. */
export function collectRecords(input: Pick<ActorInput, 'dates'>): CollectedRecords {
  const records: InputRecord[] = [];
  let skippedBlank = 0;
  for (const entry of input.dates) {
    if (isBlank(entry)) {
      skippedBlank += 1;
      continue;
    }
    records.push({ input: echo(entry), position: records.length + 1, raw: entry });
  }
  return { records, skippedBlank };
}

/** Engine options derived from the validated input. */
export function toConvertOptions(input: ActorInput): ConvertOptions {
  let anniversaryFromRd: number | null = null;
  if (input.anniversaryFrom !== null) {
    const parsed = parseDateString(input.anniversaryFrom, 'g2h');
    if (parsed.kind === 'gregorian') anniversaryFromRd = parsed.rd;
  }
  return {
    direction: input.direction,
    afterSunset: input.afterSunset,
    language: input.language,
    mode: input.mode,
    anniversaryYears: input.anniversaryYears,
    anniversaryType: input.anniversaryType,
    anniversaryFromRd,
    adarRule: input.adarRule,
    schedule: input.schedule,
    addTags: input.addTags,
  };
}
