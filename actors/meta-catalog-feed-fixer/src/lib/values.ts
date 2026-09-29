/**
 * Small value parsers (pure): enum normalisation, placeholder detection, integer fields, sale date ranges.
 */
import { compactKey } from './text.js';
import { type EnumSpec, PLACEHOLDER_VALUES } from './spec.js';

// ---------------------------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------------------------

export interface CompiledEnum {
  values: readonly string[];
  extra: ReadonlyMap<string, string>;
  exact: ReadonlyMap<string, string>;
  heuristic: ReadonlyMap<string, string>;
}

/** Builds the compact-key lookup tables of an EnumSpec. Throws when one phrase maps to two values (a data error). */
export function compileEnum(spec: EnumSpec, name: string): CompiledEnum {
  const exact = new Map<string, string>();
  const heuristic = new Map<string, string>();
  const add = (map: Map<string, string>, phrase: string, canonical: string, kind: string): void => {
    const key = compactKey(phrase);
    if (key === '') throw new Error(`${name}: empty key for phrase "${phrase}"`);
    const previous = exact.get(key) ?? heuristic.get(key);
    if (previous !== undefined && previous !== canonical) {
      throw new Error(`${name}: "${phrase}" (${kind}) maps to "${canonical}" but is already mapped to "${previous}"`);
    }
    map.set(key, canonical);
  };
  for (const value of spec.values) add(exact, value, value, 'value');
  for (const [canonical, phrases] of Object.entries(spec.synonyms)) for (const p of phrases) add(exact, p, canonical, 'synonym');
  for (const [canonical, phrases] of Object.entries(spec.heuristic)) for (const p of phrases) add(heuristic, p, canonical, 'heuristic');
  const extra = new Map<string, string>();
  for (const v of spec.acceptedExtra ?? []) extra.set(v.toLowerCase(), v);
  return { values: spec.values, extra, exact, heuristic };
}

export type EnumOutcome =
  | { status: 'canonical'; value: string }
  | { status: 'case-only'; value: string }
  | { status: 'mapped'; value: string }
  | { status: 'heuristic'; value: string }
  | { status: 'accepted-extra'; value: string }
  | { status: 'unknown' };

const SCHEMA_ORG = /^https?:\/\/(?:www\.)?schema\.org\//i;

export function normalizeEnum(compiled: CompiledEnum, raw: string): EnumOutcome {
  const value = raw.trim();
  if (compiled.values.includes(value)) return { status: 'canonical', value };
  const extra = compiled.extra.get(value.toLowerCase().replace(/[\s-]+/g, '_'));
  if (extra !== undefined) return extra === value ? { status: 'canonical', value } : { status: 'accepted-extra', value: extra };
  const key = compactKey(value.replace(SCHEMA_ORG, ''));
  if (key === '') return { status: 'unknown' };
  const hit = compiled.exact.get(key);
  if (hit !== undefined) {
    // Only capitalisation / separators differ from a documented value: "In Stock", "in_stock".
    const caseOnly = compactKey(hit) === key && value.toLowerCase().replace(/[\s_-]+/g, ' ') === hit;
    return caseOnly ? { status: 'case-only', value: hit } : { status: 'mapped', value: hit };
  }
  const soft = compiled.heuristic.get(key);
  if (soft !== undefined) return { status: 'heuristic', value: soft };
  return { status: 'unknown' };
}

// ---------------------------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------------------------

const PLACEHOLDER_KEYS = new Set(PLACEHOLDER_VALUES.map((v) => compactKey(v)));

/** "N/A", "none", "-", "???": text that means "no value". */
export function isPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  const key = compactKey(trimmed);
  if (key === '') return true; // only punctuation
  return PLACEHOLDER_KEYS.has(key);
}

// ---------------------------------------------------------------------------------------------
// Integer fields
// ---------------------------------------------------------------------------------------------

export type IntegerResult = { ok: true; value: string; note: string | null } | { ok: false; message: string };

/** quantity_to_sell_on_facebook / inventory: non-negative integer. Repairs "12.0", "1,200" and "1 200". */
export function normalizeInteger(raw: string): IntegerResult {
  const s = raw.trim();
  if (/^\d+$/.test(s)) {
    const value = s.length > 1 ? s.replace(/^0+(?=\d)/, '') : s;
    return { ok: true, value, note: value === s ? null : 'leading zeros removed' };
  }
  const float = /^(\d+)[.,]0+$/.exec(s);
  if (float) return { ok: true, value: (float[1] as string).replace(/^0+(?=\d)/, '') || '0', note: '".0" suffix removed' };
  if (/^\d{1,3}(?:[,. ]\d{3})+$/.test(s)) return { ok: true, value: s.replace(/[,. ]/g, ''), note: 'thousands separators removed' };
  if (/^-\d+/.test(s)) return { ok: false, message: `"${raw}" is negative; a quantity must be 0 or more` };
  return { ok: false, message: `"${raw}" is not a whole number` };
}

// ---------------------------------------------------------------------------------------------
// sale_price_effective_date
// ---------------------------------------------------------------------------------------------

export type DateRangeResult = { ok: true } | { ok: false; message: string };

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

function toUtcMs(part: string): number | null {
  const m = DATE_TIME.exec(part);
  if (!m) return null;
  const [year, month, day, hour, minute] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  let offsetMinutes = 0;
  const zone = m[7] as string;
  if (zone !== 'Z') {
    const digits = zone.slice(1).replace(':', '');
    const zh = Number(digits.slice(0, 2));
    const zm = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
    if (zh > 14 || zm > 59) return null;
    offsetMinutes = (zone.startsWith('-') ? -1 : 1) * (zh * 60 + zm);
  }
  return Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000;
}

/** "2026-10-01T00:00+0200/2026-10-31T23:59+0200": two ISO 8601 date-times with a time zone, start before end. */
export function checkDateRange(value: string): DateRangeResult {
  const parts = value.split('/');
  if (parts.length !== 2) return { ok: false, message: `"${value}" must be two date-times separated by "/" (start/end)` };
  const start = toUtcMs((parts[0] as string).trim());
  const end = toUtcMs((parts[1] as string).trim());
  if (start === null || end === null) {
    return { ok: false, message: `"${value}" must look like 2026-10-01T00:00+0200/2026-10-31T23:59+0200 (date, time and time zone; a time zone cannot be guessed)` };
  }
  if (start >= end) return { ok: false, message: `"${value}": the start must be before the end` };
  return { ok: true };
}
