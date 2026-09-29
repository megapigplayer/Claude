/**
 * Turn the validated input into a plan (pure): the ordered list of result entries to produce and
 * the minimal set of source requests ("fetch windows") needed to answer them.
 *
 * Entry order (= dataset order): unknown-currency notices, then the range rows date by date
 * (all requested currencies for a date, in the order the caller listed them), then the
 * conversions in input order. `maxItems` cuts the list from the end.
 */
import { parseAmount } from './convert.js';
import { normalizeCurrency } from './currencies.js';
import { addDays, diffDays, eachDate, israelDate, parseDateInput } from './dates.js';
import { type ActorInput, InputError } from './input.js';
import { MAX_CARRY_DAYS, type RateRule } from './rates.js';

/** Longest date range accepted per run (about ten years of calendar days). */
export const MAX_RANGE_DAYS = 3660;
/** Longest span one source request may cover. */
export const MAX_WINDOW_DAYS = 3660;
/** Upper bound on source requests per run (keeps a pathological conversion list polite). */
export const MAX_WINDOWS = 120;
/** Needed-date intervals closer than this many days are fetched in one request (tried in order until MAX_WINDOWS holds). */
const MERGE_GAP_STEPS = [60, 400, Number.POSITIVE_INFINITY];

export type ProblemCode = 'UNKNOWN_CURRENCY' | 'INVALID_AMOUNT' | 'INVALID_DATE' | 'DATE_IN_FUTURE' | 'INVALID_CONVERSION';

export interface Problem {
  reasonCode: ProblemCode;
  reason: string;
}

export interface RateEntry {
  kind: 'rate';
  /** Resolved ISO code, or the caller's text when `problem` is set. */
  currency: string;
  /** null only for an unknown-currency notice, which applies to the whole range. */
  date: string | null;
  problem: Problem | null;
}

export interface ConversionEntry {
  kind: 'conversion';
  /** 1-based position in the caller's `conversions` list. */
  position: number;
  reference: string | null;
  amount: number | null;
  currency: string;
  /** Resolved ISO date; the caller's own text when it could not be parsed; null when missing. */
  date: string | null;
  problem: Problem | null;
}

export type Entry = RateEntry | ConversionEntry;

export interface FetchWindow {
  currency: string;
  from: string;
  to: string;
}

export interface Plan {
  today: string;
  rateRule: RateRule;
  entries: Entry[];
  /** Entries requested before `maxItems` cut the list. */
  totalRequested: number;
  truncatedByMaxItems: number;
  rangeFrom: string | null;
  rangeTo: string | null;
  /** The range end was moved back to today (Israel time) because it was in the future. */
  clampedRangeEnd: boolean;
  /** Distinct supported currency codes that need data. */
  currencies: string[];
  windows: FetchWindow[];
  warnings: string[];
}

function resolveDate(field: string, value: string | null, now: Date): string {
  const parsed = parseDateInput(value ?? 'today', now);
  if (!parsed.ok) throw new InputError(`Input field "${field}": ${parsed.reason}.`);
  return parsed.iso;
}

function referenceOf(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function buildConversionEntry(raw: unknown, position: number, now: Date, today: string): ConversionEntry {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      kind: 'conversion',
      position,
      reference: null,
      amount: null,
      currency: '',
      date: null,
      problem: { reasonCode: 'INVALID_CONVERSION', reason: 'each conversion must be an object with "amount", "currency" and "date"' },
    };
  }
  const obj = raw as Record<string, unknown>;
  const problems: Problem[] = [];

  const amount = parseAmount(obj.amount);
  if (!amount.ok) problems.push({ reasonCode: 'INVALID_AMOUNT', reason: `amount: ${amount.reason}` });

  const currencyText = typeof obj.currency === 'string' ? obj.currency.trim() : '';
  const currency = normalizeCurrency(obj.currency);
  if (!currency.ok) problems.push({ reasonCode: 'UNKNOWN_CURRENCY', reason: `currency: ${currency.reason}` });

  let date: string | null = typeof obj.date === 'string' && obj.date.trim() !== '' ? obj.date.trim() : null;
  const parsedDate = parseDateInput(obj.date, now);
  if (!parsedDate.ok) problems.push({ reasonCode: 'INVALID_DATE', reason: `date: ${parsedDate.reason}` });
  else {
    date = parsedDate.iso;
    if (parsedDate.iso > today) {
      problems.push({ reasonCode: 'DATE_IN_FUTURE', reason: `date: ${parsedDate.iso} is in the future (today in Israel is ${today}), so no rate can exist yet` });
    }
  }

  const first = problems[0];
  return {
    kind: 'conversion',
    position,
    reference: referenceOf(obj.reference),
    amount: amount.ok ? amount.value : null,
    currency: currency.ok ? currency.code : currencyText,
    date,
    problem: first === undefined ? null : { reasonCode: first.reasonCode, reason: problems.map((p) => p.reason).join('; ') },
  };
}

interface Interval {
  from: string;
  to: string;
}

function mergeIntervals(intervals: Interval[], gap: number): Interval[] {
  const sorted = [...intervals].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : 1));
  const merged: Interval[] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && diffDays(iv.from, last.to) <= gap) {
      if (iv.to > last.to) last.to = iv.to;
    } else merged.push({ ...iv });
  }
  return merged;
}

/** Split an interval into requests of at most MAX_WINDOW_DAYS; consecutive pieces overlap by MAX_CARRY_DAYS so rates can carry across the seam. */
function chunkInterval(iv: Interval): Interval[] {
  const out: Interval[] = [];
  let from = iv.from;
  for (;;) {
    const limit = addDays(from, MAX_WINDOW_DAYS - 1);
    if (limit >= iv.to) {
      out.push({ from, to: iv.to });
      return out;
    }
    out.push({ from, to: limit });
    from = addDays(limit, -MAX_CARRY_DAYS + 1);
  }
}

export function buildWindows(entries: readonly Entry[]): FetchWindow[] {
  const spans = new Map<string, Interval>(); // range rows: one contiguous span per currency
  const points = new Map<string, Set<string>>(); // conversions: single dates
  const order: string[] = [];
  const touch = (currency: string): void => {
    if (!order.includes(currency)) order.push(currency);
  };
  for (const e of entries) {
    if (e.problem !== null || e.date === null) continue;
    touch(e.currency);
    if (e.kind === 'rate') {
      const span = spans.get(e.currency);
      if (span === undefined) spans.set(e.currency, { from: e.date, to: e.date });
      else {
        if (e.date < span.from) span.from = e.date;
        if (e.date > span.to) span.to = e.date;
      }
    } else {
      const set = points.get(e.currency) ?? new Set<string>();
      set.add(e.date);
      points.set(e.currency, set);
    }
  }
  const needed = (currency: string): Interval[] => {
    const list: Interval[] = [];
    const span = spans.get(currency);
    if (span !== undefined) list.push({ from: addDays(span.from, -MAX_CARRY_DAYS), to: span.to });
    for (const d of points.get(currency) ?? []) list.push({ from: addDays(d, -MAX_CARRY_DAYS), to: d });
    return list;
  };
  let windows: FetchWindow[] = [];
  for (const gap of MERGE_GAP_STEPS) {
    windows = [];
    for (const currency of order) {
      for (const iv of mergeIntervals(needed(currency), gap)) {
        for (const piece of chunkInterval(iv)) windows.push({ currency, from: piece.from, to: piece.to });
      }
    }
    if (windows.length <= MAX_WINDOWS) break;
  }
  return windows;
}

export function buildPlan(input: ActorInput, now: Date): Plan {
  const today = israelDate(now);
  const warnings: string[] = [];
  const entries: Entry[] = [];
  const cap = input.maxItems;

  const codes: string[] = [];
  const notices: RateEntry[] = [];
  let rangeFrom: string | null = null;
  let rangeTo: string | null = null;
  let clampedRangeEnd = false;
  let rangeDays = 0;

  if (input.currencies.length > 0) {
    const seenCodes = new Set<string>();
    const seenBad = new Set<string>();
    for (const raw of input.currencies) {
      const parsed = normalizeCurrency(raw);
      if (parsed.ok) {
        if (!seenCodes.has(parsed.code)) {
          seenCodes.add(parsed.code);
          codes.push(parsed.code);
        }
      } else if (!seenBad.has(raw.trim().toUpperCase())) {
        seenBad.add(raw.trim().toUpperCase());
        notices.push({ kind: 'rate', currency: raw.trim(), date: null, problem: { reasonCode: 'UNKNOWN_CURRENCY', reason: parsed.reason } });
      }
    }
    if (codes.length === 0 && input.conversions.length === 0) {
      throw new InputError(`None of the requested currencies is supported. ${notices[0]?.problem?.reason ?? ''}`.trim());
    }
    if (codes.length > 0) {
      const from = resolveDate('dateFrom', input.dateFrom, now);
      let to = resolveDate('dateTo', input.dateTo, now);
      if (from > to) throw new InputError(`"dateFrom" (${from}) is after "dateTo" (${to}).`);
      if (from > today) throw new InputError(`"dateFrom" (${from}) is in the future; today in Israel is ${today}, and no rate exists for later dates.`);
      if (to > today) {
        warnings.push(`"dateTo" (${to}) is in the future; the range ends today (${today}, Israel time).`);
        to = today;
        clampedRangeEnd = true;
      }
      rangeDays = diffDays(to, from) + 1;
      if (rangeDays > MAX_RANGE_DAYS) {
        throw new InputError(`The date range spans ${rangeDays} days; the maximum is ${MAX_RANGE_DAYS} (about ten years) per run. Split it into several runs.`);
      }
      rangeFrom = from;
      rangeTo = to;
    }
  }

  const conversionCount = input.conversions.length;
  const totalRequested = notices.length + rangeDays * codes.length + conversionCount;

  for (const notice of notices) if (entries.length < cap) entries.push(notice);
  if (rangeFrom !== null && rangeTo !== null) {
    outer: for (const date of eachDate(rangeFrom, rangeTo)) {
      for (const code of codes) {
        if (entries.length >= cap) break outer;
        entries.push({ kind: 'rate', currency: code, date, problem: null });
      }
    }
  }
  for (let i = 0; i < conversionCount && entries.length < cap; i++) {
    entries.push(buildConversionEntry(input.conversions[i], i + 1, now, today));
  }

  const truncatedByMaxItems = totalRequested - entries.length;
  if (truncatedByMaxItems > 0) warnings.push(`${totalRequested} rows were requested; only the first ${entries.length} are produced (maxItems).`);

  const windows = buildWindows(entries);
  const needed = new Set<string>(windows.map((w) => w.currency));
  return {
    today,
    rateRule: input.rateRule,
    entries,
    totalRequested,
    truncatedByMaxItems,
    rangeFrom,
    rangeTo,
    clampedRangeEnd,
    currencies: [...needed],
    windows,
    warnings,
  };
}
