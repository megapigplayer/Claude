/**
 * One plan entry -> one output row (pure; never throws), plus run-summary bookkeeping.
 * Output field names are camelCase (CONVENTIONS.md "Output field naming"). There are two row shapes,
 * told apart by `rowType`: "rate" (one published rate for a date and currency) and "conversion"
 * (an amount converted to ILS). Rows that could not be answered carry ok=false, a machine-readable
 * reasonCode and a human-readable reason; they are free.
 */
import type { RateObservation } from './boi-adapter.js';
import { MAX_ABS_AMOUNT, toIls } from './convert.js';
import { israelMinutesOfDay } from './dates.js';
import type { DataSourceChoice } from './input.js';
import type { SourceFailure } from './load.js';
import type { ConversionEntry, Entry, Plan, ProblemCode, RateEntry } from './plan.js';
import { type RateRule, resolveRate } from './rates.js';

export const REASON_CODES = [
  'OK',
  'UNKNOWN_CURRENCY',
  'INVALID_AMOUNT',
  'INVALID_DATE',
  'DATE_IN_FUTURE',
  'INVALID_CONVERSION',
  'NO_RATE_PUBLISHED',
  'SOURCE_UNAVAILABLE',
  'SOURCE_FORMAT_ERROR',
  'INTERNAL_ERROR',
] as const;

export type ReasonCode = (typeof REASON_CODES)[number] & ('OK' | ProblemCode | 'NO_RATE_PUBLISHED' | SourceFailure['code']);

export interface RateRow {
  rowType: 'rate';
  ok: boolean;
  reasonCode: ReasonCode;
  reason: string;
  /** The calendar date asked for. */
  date: string | null;
  currency: string;
  /** ILS per `unit` units of the currency, as published. */
  rate: number | null;
  unit: number | null;
  /** Percent change against the previous published rate; null when unknown. */
  change: number | null;
  publishedAt: string | null;
  /** True while the rate may still be revised (about 15 minutes after publication). */
  provisional: boolean | null;
  /** The publication date of the rate used (equals `date` on publication days). */
  rateDate: string | null;
  /** Days between `date` and `rateDate`. */
  daysBack: number | null;
  ruleApplied: RateRule;
  dataSource: DataSourceChoice;
}

export interface ConversionRow {
  rowType: 'conversion';
  ok: boolean;
  reasonCode: ReasonCode;
  reason: string;
  /** 1-based position in the caller's `conversions` list. */
  position: number;
  /** The caller's own reference (invoice number ...), echoed. */
  reference: string | null;
  amount: number | null;
  currency: string;
  date: string | null;
  /** The published rate that was applied: ILS per `unit` units. */
  rateUsed: number | null;
  unit: number | null;
  rateDate: string | null;
  daysBack: number | null;
  ruleApplied: RateRule;
  /** amount x rateUsed / unit, rounded half-up to 2 decimals. */
  ilsAmount: number | null;
  publishedAt: string | null;
  provisional: boolean | null;
  dataSource: DataSourceChoice;
}

export type ResultRow = RateRow | ConversionRow;

export interface RowStats {
  /** Range dates skipped under the "same-day" rule because nothing was published on them. */
  skippedNoPublication: number;
}

export interface RowContext {
  rule: RateRule;
  now: Date;
  today: string;
  dataSource: DataSourceChoice;
  series: ReadonlyMap<string, readonly RateObservation[]>;
  failures: ReadonlyMap<string, SourceFailure>;
  stats: RowStats;
}

/** VERIFY(BOI-10): published rates are revised about 15 minutes after publication (about 15:45 Israel time when published at 15:30). */
export const REVISION_WINDOW_MS = 15 * 60_000;
export const FINAL_MINUTES_OF_DAY = 15 * 60 + 45;

export function isProvisional(observation: RateObservation, now: Date, today: string): boolean {
  if (observation.publishedAt !== null) return now.getTime() - Date.parse(observation.publishedAt) < REVISION_WINDOW_MS;
  return observation.date === today && israelMinutesOfDay(now) < FINAL_MINUTES_OF_DAY;
}

function days(n: number): string {
  return `${n} day${n === 1 ? '' : 's'}`;
}

function describeResolution(rule: RateRule, date: string, rateDate: string, daysBack: number, provisional: boolean): string {
  let text: string;
  if (daysBack === 0) text = `Rate published on ${rateDate}.`;
  else if (rule === 'previous-business-day') text = `Used the rate of the last publication before ${date}: ${rateDate} (${days(daysBack)} earlier).`;
  else text = `No rate was published on ${date}; used the last one published before it, on ${rateDate} (${days(daysBack)} earlier).`;
  return provisional ? `${text} Provisional: today's rate may still be revised.` : text;
}

function rateProblemRow(entry: RateEntry, reasonCode: ReasonCode, reason: string, ctx: RowContext): RateRow {
  return {
    rowType: 'rate',
    ok: false,
    reasonCode,
    reason,
    date: entry.date,
    currency: entry.currency,
    rate: null,
    unit: null,
    change: null,
    publishedAt: null,
    provisional: null,
    rateDate: null,
    daysBack: null,
    ruleApplied: ctx.rule,
    dataSource: ctx.dataSource,
  };
}

function conversionProblemRow(entry: ConversionEntry, reasonCode: ReasonCode, reason: string, ctx: RowContext): ConversionRow {
  return {
    rowType: 'conversion',
    ok: false,
    reasonCode,
    reason,
    position: entry.position,
    reference: entry.reference,
    amount: entry.amount,
    currency: entry.currency,
    date: entry.date,
    rateUsed: null,
    unit: null,
    rateDate: null,
    daysBack: null,
    ruleApplied: ctx.rule,
    ilsAmount: null,
    publishedAt: null,
    provisional: null,
    dataSource: ctx.dataSource,
  };
}

function buildRateRow(entry: RateEntry, ctx: RowContext): RateRow | null {
  if (entry.problem !== null) return rateProblemRow(entry, entry.problem.reasonCode, entry.problem.reason, ctx);
  const date = entry.date as string; // entries without a problem always carry a date
  const failure = ctx.failures.get(entry.currency);
  if (failure !== undefined) return rateProblemRow(entry, failure.code, failure.message, ctx);
  const resolution = resolveRate(ctx.series.get(entry.currency) ?? [], date, ctx.rule);
  if (!resolution.found) {
    if (ctx.rule === 'same-day') {
      ctx.stats.skippedNoPublication++;
      return null;
    }
    return rateProblemRow(entry, 'NO_RATE_PUBLISHED', `${entry.currency}: ${resolution.detail}.`, ctx);
  }
  const o = resolution.observation;
  const provisional = isProvisional(o, ctx.now, ctx.today);
  return {
    rowType: 'rate',
    ok: true,
    reasonCode: 'OK',
    reason: describeResolution(ctx.rule, date, o.date, resolution.daysBack, provisional),
    date,
    currency: entry.currency,
    rate: o.rate,
    unit: o.unit,
    change: o.change,
    publishedAt: o.publishedAt,
    provisional,
    rateDate: o.date,
    daysBack: resolution.daysBack,
    ruleApplied: ctx.rule,
    dataSource: ctx.dataSource,
  };
}

function buildConversionRow(entry: ConversionEntry, ctx: RowContext): ConversionRow {
  if (entry.problem !== null) return conversionProblemRow(entry, entry.problem.reasonCode, entry.problem.reason, ctx);
  const date = entry.date as string;
  const amount = entry.amount as number;
  // buildConversionEntry already validated the amount; this keeps hand-built entries from producing NaN/absurd results.
  if (typeof amount !== 'number' || !Number.isFinite(amount) || Math.abs(amount) > MAX_ABS_AMOUNT) {
    return conversionProblemRow(entry, 'INVALID_AMOUNT', 'amount: the amount must be a finite number', ctx);
  }
  const failure = ctx.failures.get(entry.currency);
  if (failure !== undefined) return conversionProblemRow(entry, failure.code, failure.message, ctx);
  const resolution = resolveRate(ctx.series.get(entry.currency) ?? [], date, ctx.rule);
  if (!resolution.found) return conversionProblemRow(entry, 'NO_RATE_PUBLISHED', `${entry.currency}: ${resolution.detail}.`, ctx);
  const o = resolution.observation;
  const provisional = isProvisional(o, ctx.now, ctx.today);
  return {
    rowType: 'conversion',
    ok: true,
    reasonCode: 'OK',
    reason: describeResolution(ctx.rule, date, o.date, resolution.daysBack, provisional),
    position: entry.position,
    reference: entry.reference,
    amount,
    currency: entry.currency,
    date,
    rateUsed: o.rate,
    unit: o.unit,
    rateDate: o.date,
    daysBack: resolution.daysBack,
    ruleApplied: ctx.rule,
    ilsAmount: toIls(amount, o.rate, o.unit),
    publishedAt: o.publishedAt,
    provisional,
    dataSource: ctx.dataSource,
  };
}

/** null = this entry produces no row (a range date without a publication under the "same-day" rule). */
export function buildRow(entry: Entry, ctx: RowContext): ResultRow | null {
  return entry.kind === 'rate' ? buildRateRow(entry, ctx) : buildConversionRow(entry, ctx);
}

/** Never throws: an unexpected exception becomes one INTERNAL_ERROR row so the rest of the run continues. */
export function safeBuildRow(entry: Entry, ctx: RowContext): ResultRow | null {
  try {
    return buildRow(entry, ctx);
  } catch (err) {
    const message = `Unexpected error while answering this entry: ${err instanceof Error ? err.message : String(err)}`;
    return entry.kind === 'rate'
      ? rateProblemRow(entry, 'INTERNAL_ERROR', message, ctx)
      : conversionProblemRow(entry, 'INTERNAL_ERROR', message, ctx);
  }
}

export function* buildRows(entries: readonly Entry[], ctx: RowContext): Generator<ResultRow> {
  for (const entry of entries) {
    const row = safeBuildRow(entry, ctx);
    if (row !== null) yield row;
  }
}

export interface RunSummary {
  dataSource: DataSourceChoice;
  rateRule: RateRule;
  today: string;
  requestedRows: number;
  rows: number;
  rateRows: number;
  conversionRows: number;
  okRows: number;
  problemRows: number;
  byReasonCode: Record<string, number>;
  skippedNoPublication: number;
  truncatedByMaxItems: number;
  stoppedForBudget: boolean;
  clampedRangeEnd: boolean;
  sourceRequests: number;
  sourceFailures: Array<{ currency: string; code: string; message: string }>;
  warnings: string[];
}

export function emptySummary(plan: Plan, dataSource: DataSourceChoice): RunSummary {
  return {
    dataSource,
    rateRule: plan.rateRule,
    today: plan.today,
    requestedRows: plan.totalRequested,
    rows: 0,
    rateRows: 0,
    conversionRows: 0,
    okRows: 0,
    problemRows: 0,
    byReasonCode: {},
    skippedNoPublication: 0,
    truncatedByMaxItems: plan.truncatedByMaxItems,
    stoppedForBudget: false,
    clampedRangeEnd: plan.clampedRangeEnd,
    sourceRequests: 0,
    sourceFailures: [],
    warnings: [...plan.warnings],
  };
}

export function addToSummary(summary: RunSummary, row: ResultRow): void {
  summary.rows += 1;
  if (row.rowType === 'rate') summary.rateRows += 1;
  else summary.conversionRows += 1;
  if (row.ok) summary.okRows += 1;
  else summary.problemRows += 1;
  summary.byReasonCode[row.reasonCode] = (summary.byReasonCode[row.reasonCode] ?? 0) + 1;
}
