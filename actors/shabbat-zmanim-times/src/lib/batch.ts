/**
 * Orchestration: resolve every `locations` entry once, then build one row per (location, week).
 * Pure (no Apify imports); main.ts pushes the rows this produces and charges one `location-week`
 * event per row with `status: "ok"` (a location we could not identify delivered no computed result,
 * so - like hebrew-date-converter's unparseable dates, and unlike iban-validator's "invalid but
 * determined" verdicts - it is not charged; CONVENTIONS.md 4.3 "Failed items", documented per-Actor).
 */
import { type CivilDate, addDays, formatIsoCivilDate, parseIsoCivilDate, resolveFriday } from './dates.js';
import { type LocationInfo, resolveLocation } from './locations.js';
import type { ZmanimBlock } from './zmanim.js';
import { buildWeek } from './week.js';
import type { WeekOptions } from './week.js';

export interface RowRecord {
  /** The caller's entry exactly as provided (objects are JSON-stringified) for joining results back. */
  input: string;
  /** 1-based position among the non-blank `locations` entries. */
  position: number;
  raw: unknown;
}

export interface ResultRow {
  input: string;
  position: number;
  week: number;
  status: 'ok' | 'error';
  reasonCode: string;
  reason: string | null;
  location: LocationInfo | null;
  friday: string | null;
  fridayRolledForward: boolean | null;
  candleLighting: string | null;
  havdalah: string | null;
  parasha: string | null;
  parashaHe: string | null;
  holiday: string | null;
  holidayHe: string | null;
  zmanim: ZmanimBlock | null;
  warnings: string[] | null;
}

function errorRow(record: RowRecord, week: number, reasonCode: string, reason: string): ResultRow {
  return {
    input: record.input,
    position: record.position,
    week,
    status: 'error',
    reasonCode,
    reason,
    location: null,
    friday: null,
    fridayRolledForward: null,
    candleLighting: null,
    havdalah: null,
    parasha: null,
    parashaHe: null,
    holiday: null,
    holidayHe: null,
    zmanim: null,
    warnings: null,
  };
}

/** Every row for one location entry across `weeks` consecutive Fridays starting at `startDate`. */
export function buildRowsForLocation(record: RowRecord, startDate: CivilDate, weeks: number, options: WeekOptions): ResultRow[] {
  const resolved = resolveLocation(record.raw);
  if (!resolved.ok) {
    const rows: ResultRow[] = [];
    for (let week = 1; week <= weeks; week++) rows.push(errorRow(record, week, resolved.code, resolved.reason));
    return rows;
  }

  const { friday: firstFriday, rolled } = resolveFriday(startDate);
  const rows: ResultRow[] = [];
  for (let week = 1; week <= weeks; week++) {
    const friday = week === 1 ? firstFriday : addDays(firstFriday, (week - 1) * 7);
    const result = buildWeek(resolved.location, friday, options);
    rows.push({
      input: record.input,
      position: record.position,
      week,
      status: 'ok',
      reasonCode: 'OK',
      reason: null,
      location: resolved.info,
      friday: result.friday,
      fridayRolledForward: week === 1 ? rolled : false,
      candleLighting: result.candleLighting,
      havdalah: result.havdalah,
      parasha: result.parasha,
      parashaHe: result.parashaHe,
      holiday: result.holiday,
      holidayHe: result.holidayHe,
      zmanim: result.zmanim,
      warnings: result.warnings.length > 0 ? result.warnings : null,
    });
  }
  return rows;
}

/** Never throws: an unexpected exception becomes one INTERNAL_ERROR row per requested week (free, not charged). */
export function safeBuildRowsForLocation(
  record: RowRecord,
  startDate: CivilDate,
  weeks: number,
  options: WeekOptions,
  build: typeof buildRowsForLocation = buildRowsForLocation,
): ResultRow[] {
  try {
    return build(record, startDate, weeks, options);
  } catch (e) {
    const rows: ResultRow[] = [];
    for (let week = 1; week <= weeks; week++) {
      rows.push(errorRow(record, week, 'INTERNAL_ERROR', `Unexpected error while computing this location: ${e instanceof Error ? e.message : String(e)}`));
    }
    return rows;
  }
}

export const isChargeable = (row: ResultRow): boolean => row.status === 'ok';

export { formatIsoCivilDate, parseIsoCivilDate };
