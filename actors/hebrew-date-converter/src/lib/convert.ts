/**
 * One input entry -> one output row (pure; never throws), plus run-summary bookkeeping.
 * Output field names are camelCase (CONVENTIONS.md "Output field naming"); every row has the same keys.
 */
import { WEEKDAYS_EN, WEEKDAYS_HE, isoFromRd, weekdayOfRd } from './civil.js';
import {
  type AdarRule,
  type AnniversaryType,
  anniversaryInYear,
  ruleSentence,
  standingRuleNote,
  MAX_HEBREW_YEAR,
} from './anniversary.js';
import {
  type HebrewDate,
  formatHebrewDateEn,
  formatHebrewDateHe,
  hebrewMonthNameEn,
  hebrewMonthNameHe,
  hebrewMonthOfYear,
  isHebrewLeapYear,
} from './hebrew.js';
import { hebrewToRd, rdToHebrew, tagsForRd } from './hebrew-calendar.js';
import { type Direction, MAX_RD, MIN_RD, type ParsedItem, parseDateItem } from './parse.js';

export type Language = 'en' | 'he' | 'both';
export type Mode = 'convert' | 'anniversary';
export type Schedule = 'israel' | 'diaspora';

export interface ConvertOptions {
  direction: Direction;
  afterSunset: boolean;
  language: Language;
  mode: Mode;
  anniversaryYears: number;
  anniversaryType: AnniversaryType;
  /** R.D. number; only anniversaries on or after it are listed. null = start with the first anniversary. */
  anniversaryFromRd: number | null;
  adarRule: AdarRule;
  schedule: Schedule;
  addTags: boolean;
}

export interface InputRecord {
  /** The caller's entry exactly as provided (objects are JSON-stringified) for joining results back. */
  input: string;
  /** 1-based position among the non-blank entries. */
  position: number;
  raw: unknown;
}

export interface AnniversaryEntry {
  number: number;
  hebrewYear: number;
  hebrewDate: string | null;
  hebrewDateHe: string | null;
  gregorian: string;
  weekday: string | null;
  weekdayHe: string | null;
  ruleCode: string;
  rule: string | null;
}

export interface ConvertedRow {
  input: string;
  position: number;
  status: 'ok' | 'error';
  reasonCode: string;
  reason: string | null;
  direction: 'g2h' | 'h2g' | null;
  gregorian: string | null;
  weekday: string | null;
  weekdayHe: string | null;
  afterSunset: boolean | null;
  hebrewDayGregorian: string | null;
  beginsAtSunsetOn: string | null;
  hebrewDay: number | null;
  hebrewMonth: string | null;
  hebrewMonthHe: string | null;
  hebrewMonthNumber: number | null;
  hebrewMonthOfYear: number | null;
  hebrewYear: number | null;
  hebrewString: string | null;
  hebrewStringHe: string | null;
  isLeapYear: boolean | null;
  holidaySchedule: Schedule | null;
  holiday: string | null;
  holidayHe: string | null;
  parasha: string | null;
  parashaHe: string | null;
  anniversaryType: AnniversaryType | null;
  anniversaries: AnniversaryEntry[] | null;
  ruleNote: string | null;
}

const wantEn = (l: Language): boolean => l === 'en' || l === 'both';
const wantHe = (l: Language): boolean => l === 'he' || l === 'both';

export function errorRow(record: InputRecord, reasonCode: string, reason: string): ConvertedRow {
  return {
    input: record.input,
    position: record.position,
    status: 'error',
    reasonCode,
    reason,
    direction: null,
    gregorian: null,
    weekday: null,
    weekdayHe: null,
    afterSunset: null,
    hebrewDayGregorian: null,
    beginsAtSunsetOn: null,
    hebrewDay: null,
    hebrewMonth: null,
    hebrewMonthHe: null,
    hebrewMonthNumber: null,
    hebrewMonthOfYear: null,
    hebrewYear: null,
    hebrewString: null,
    hebrewStringHe: null,
    isLeapYear: null,
    holidaySchedule: null,
    holiday: null,
    holidayHe: null,
    parasha: null,
    parashaHe: null,
    anniversaryType: null,
    anniversaries: null,
    ruleNote: null,
  };
}

/** Same field order for every row; `null` for anything not applicable. */
export function buildRow(record: InputRecord, options: ConvertOptions): ConvertedRow {
  const parsed: ParsedItem = parseDateItem(record.raw, options.direction);
  if (parsed.kind === 'blank') return errorRow(record, 'EMPTY', 'Blank entry.');
  if (parsed.kind === 'error') return errorRow(record, parsed.code, parsed.reason);

  // Which Gregorian day is being displayed, and which Hebrew day belongs to it?
  let gregorianRd: number;
  let hebrewRd: number;
  let afterSunset: boolean | null;
  let direction: 'g2h' | 'h2g';
  if (parsed.kind === 'gregorian') {
    direction = 'g2h';
    afterSunset = parsed.afterSunset ?? options.afterSunset;
    gregorianRd = parsed.rd;
    hebrewRd = parsed.rd + (afterSunset ? 1 : 0);
    if (hebrewRd > MAX_RD || hebrewRd < MIN_RD) {
      return errorRow(record, 'YEAR_OUT_OF_RANGE', 'The Hebrew date after sunset falls outside the supported range (up to Gregorian 6000-12-31).');
    }
  } else {
    direction = 'h2g';
    afterSunset = null;
    gregorianRd = parsed.rd;
    hebrewRd = parsed.rd;
  }

  const heb: HebrewDate = rdToHebrew(hebrewRd);
  const en = wantEn(options.language);
  const he = wantHe(options.language);
  const weekday = weekdayOfRd(gregorianRd);

  let holiday: string | null = null;
  let holidayHe: string | null = null;
  let parasha: string | null = null;
  let parashaHe: string | null = null;
  if (options.addTags) {
    const tags = tagsForRd(hebrewRd, options.schedule === 'israel');
    if (tags.holidays.length > 0) {
      if (en) holiday = tags.holidays.map((h) => h.en).join('; ');
      if (he) holidayHe = tags.holidays.map((h) => h.he).join('; ');
    }
    if (tags.parasha) {
      if (en) parasha = tags.parasha.en;
      if (he) parashaHe = tags.parasha.he;
    }
  }

  let anniversaries: AnniversaryEntry[] | null = null;
  let ruleNote: string | null = null;
  if (options.mode === 'anniversary') {
    ruleNote = standingRuleNote(heb, options.anniversaryType, options.adarRule);
    const list = listAnniversaries(heb, options);
    anniversaries = list.entries;
    if (list.truncated) {
      const cut = 'The list stops early because the next anniversary would fall beyond the supported range.';
      ruleNote = ruleNote === null ? cut : `${ruleNote} ${cut}`;
    }
  }

  return {
    input: record.input,
    position: record.position,
    status: 'ok',
    reasonCode: 'OK',
    reason: null,
    direction,
    gregorian: isoFromRd(gregorianRd),
    weekday: en ? (WEEKDAYS_EN[weekday] ?? null) : null,
    weekdayHe: he ? (WEEKDAYS_HE[weekday] ?? null) : null,
    afterSunset,
    hebrewDayGregorian: isoFromRd(hebrewRd),
    beginsAtSunsetOn: isoFromRd(hebrewRd - 1),
    hebrewDay: heb.day,
    hebrewMonth: en ? hebrewMonthNameEn(heb.month, heb.year) : null,
    hebrewMonthHe: he ? hebrewMonthNameHe(heb.month, heb.year) : null,
    hebrewMonthNumber: heb.month,
    hebrewMonthOfYear: hebrewMonthOfYear(heb.month, heb.year),
    hebrewYear: heb.year,
    hebrewString: en ? formatHebrewDateEn(heb) : null,
    hebrewStringHe: he ? formatHebrewDateHe(heb) : null,
    isLeapYear: isHebrewLeapYear(heb.year),
    holidaySchedule: options.addTags ? options.schedule : null,
    holiday,
    holidayHe,
    parasha,
    parashaHe,
    anniversaryType: options.mode === 'anniversary' ? options.anniversaryType : null,
    anniversaries,
    ruleNote,
  };
}

function listAnniversaries(orig: HebrewDate, options: ConvertOptions): { entries: AnniversaryEntry[]; truncated: boolean } {
  const entries: AnniversaryEntry[] = [];
  const en = wantEn(options.language);
  const he = wantHe(options.language);
  let truncated = false;
  for (let hyear = orig.year + 1; entries.length < options.anniversaryYears; hyear++) {
    if (hyear > MAX_HEBREW_YEAR) {
      truncated = true;
      break;
    }
    const result = anniversaryInYear(orig, hyear, options.anniversaryType, options.adarRule);
    if (result === null) continue;
    const rd = hebrewToRd(result.date);
    if (rd > MAX_RD) {
      truncated = true;
      break;
    }
    if (options.anniversaryFromRd !== null && rd < options.anniversaryFromRd) continue;
    const weekday = weekdayOfRd(rd);
    entries.push({
      number: hyear - orig.year,
      hebrewYear: hyear,
      hebrewDate: en ? formatHebrewDateEn(result.date) : null,
      hebrewDateHe: he ? formatHebrewDateHe(result.date) : null,
      gregorian: isoFromRd(rd),
      weekday: en ? (WEEKDAYS_EN[weekday] ?? null) : null,
      weekdayHe: he ? (WEEKDAYS_HE[weekday] ?? null) : null,
      ruleCode: result.ruleCode,
      rule: ruleSentence(result.ruleCode, options.anniversaryType, orig),
    });
  }
  return { entries, truncated };
}

/** Never throws: an unexpected exception becomes one INTERNAL_ERROR row (not charged). */
export function safeBuildRow(record: InputRecord, options: ConvertOptions, build: typeof buildRow = buildRow): ConvertedRow {
  try {
    return build(record, options);
  } catch (e) {
    return errorRow(record, 'INTERNAL_ERROR', `Unexpected error while converting this entry: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Only successfully converted dates are billed (blank, unparseable and internal-error rows are free). */
export function isChargeable(row: ConvertedRow): boolean {
  return row.status === 'ok';
}

export interface Batch {
  rows: ConvertedRow[];
  /** Rows in `rows` that will be charged (one `date-converted` event each). */
  billable: number;
}

/**
 * Convert records[start...] until the batch is full or the number of BILLABLE rows reaches
 * `remainingChargeable` (Infinity outside pay-per-event runs). Error rows are free, so they never
 * consume budget; the batch keeps input order.
 */
export function buildBatch(records: readonly InputRecord[], start: number, remainingChargeable: number, options: ConvertOptions, batchSize: number): Batch {
  const rows: ConvertedRow[] = [];
  let billable = 0;
  while (rows.length < batchSize && start + rows.length < records.length && billable < remainingChargeable) {
    const record = records[start + rows.length];
    if (record === undefined) break;
    const row = safeBuildRow(record, options);
    rows.push(row);
    if (isChargeable(row)) billable += 1;
  }
  return { rows, billable };
}

export interface RunSummary {
  total: number;
  converted: number;
  errors: number;
  byReasonCode: Record<string, number>;
  byDirection: Record<string, number>;
  skippedBlank: number;
  truncatedByMaxItems: number;
  stoppedForBudget: boolean;
}

export function emptySummary(): RunSummary {
  return { total: 0, converted: 0, errors: 0, byReasonCode: {}, byDirection: {}, skippedBlank: 0, truncatedByMaxItems: 0, stoppedForBudget: false };
}

export function addToSummary(summary: RunSummary, row: ConvertedRow): void {
  summary.total += 1;
  if (row.status === 'ok') summary.converted += 1;
  else summary.errors += 1;
  summary.byReasonCode[row.reasonCode] = (summary.byReasonCode[row.reasonCode] ?? 0) + 1;
  if (row.direction) summary.byDirection[row.direction] = (summary.byDirection[row.direction] ?? 0) + 1;
}

