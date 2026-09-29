/**
 * Calendar-date helpers (pure). Dates are plain `YYYY-MM-DD` strings; all arithmetic is done on
 * UTC epoch days so daylight-saving changes can never shift a date. Israel wall-clock helpers
 * ("what day is it in Israel right now?") use Intl with the Asia/Jerusalem zone.
 */

export const ISRAEL_TIME_ZONE = 'Asia/Jerusalem';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Earliest / latest year we accept: keeps epoch-day maths exact and catches typos such as 20250-01-01. */
const MIN_YEAR = 1900;
const MAX_YEAR = 2999;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** True for a real calendar date written exactly as YYYY-MM-DD (no time part). */
export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

/** Days since 1970-01-01 for a valid ISO date. */
export function toEpochDay(iso: string): number {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new RangeError(`Not an ISO date: ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY;
}

export function fromEpochDay(day: number): string {
  const d = new Date(day * MS_PER_DAY);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

export function addDays(iso: string, days: number): string {
  return fromEpochDay(toEpochDay(iso) + days);
}

/** `a - b` in whole days (positive when a is later). */
export function diffDays(a: string, b: string): number {
  return toEpochDay(a) - toEpochDay(b);
}

/** Every date from `from` to `to`, both inclusive (empty when from > to). */
export function* eachDate(from: string, to: string): Generator<string> {
  const end = toEpochDay(to);
  for (let day = toEpochDay(from); day <= end; day++) yield fromEpochDay(day);
}

const israelParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: ISRAEL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function israelFields(instant: Date): { date: string; minutes: number } {
  const parts: Record<string, string> = {};
  for (const p of israelParts.formatToParts(instant)) parts[p.type] = p.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** The calendar date it currently is in Israel (Asia/Jerusalem), e.g. "2026-09-29". */
export function israelDate(instant: Date): string {
  return israelFields(instant).date;
}

/** Minutes since local midnight in Israel (0-1439). */
export function israelMinutesOfDay(instant: Date): number {
  return israelFields(instant).minutes;
}

export type DateParse = { ok: true; iso: string } | { ok: false; reason: string };

/**
 * Parse a caller-supplied date. Accepted: `YYYY-MM-DD` (a trailing time such as
 * `2025-01-07T00:00:00Z` is ignored: the calendar date as written is used, no time-zone shift)
 * and the word `today` (the current date in Israel). Slash/dot formats are rejected on purpose:
 * 01/02/2025 is 1 February in Israel but 2 January in the US, and a silently wrong date means a
 * wrong exchange rate.
 */
export function parseDateInput(raw: unknown, now: Date): DateParse {
  if (typeof raw !== 'string') return { ok: false, reason: 'the date must be text in the form YYYY-MM-DD (or "today")' };
  const text = raw.trim();
  if (text === '') return { ok: false, reason: 'the date is empty' };
  if (text.toLowerCase() === 'today') return { ok: true, iso: israelDate(now) };
  const datePart = /^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(text)?.[1];
  if (datePart === undefined) {
    return {
      ok: false,
      reason: `"${text}" is not in the form YYYY-MM-DD (for example 2025-01-07). Formats such as 07/01/2025 are ambiguous (day-first or month-first) and are not accepted.`,
    };
  }
  if (!isValidIsoDate(datePart)) return { ok: false, reason: `"${datePart}" is not a real calendar date` };
  return { ok: true, iso: datePart };
}
