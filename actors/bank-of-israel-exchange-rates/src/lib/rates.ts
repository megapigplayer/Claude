/**
 * Choosing WHICH published rate applies to a date (pure).
 *
 * The Bank of Israel publishes a representative rate only on banking days, so most calendar dates
 * that matter to an invoice (weekends, holidays) have no rate of their own. The three rules decide
 * what to do about that. They work purely on the dates the source actually returned - no weekday or
 * holiday calendar is built in, so they stay right when the banking week changes.
 */
import type { RateObservation } from './boi-adapter.js';
import { diffDays } from './dates.js';

export const RATE_RULES = ['last-published-on-or-before', 'previous-business-day', 'same-day'] as const;
export type RateRule = (typeof RATE_RULES)[number];
export const DEFAULT_RATE_RULE: RateRule = 'last-published-on-or-before';

/**
 * A rate older than this many days is never carried over to a date: it means the source is missing
 * data (or the date is before the series starts), not that the bank was closed for two weeks.
 * The fetch window reaches this far back before the first requested date.
 */
export const MAX_CARRY_DAYS = 14;

export type Resolution =
  | { found: true; observation: RateObservation; daysBack: number }
  | { found: false; detail: string };

/** Index of the last observation whose date is <= `date` (-1 if none). `observations` must be sorted ascending. */
export function lastIndexOnOrBefore(observations: readonly RateObservation[], date: string): number {
  let lo = 0;
  let hi = observations.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const obs = observations[mid] as RateObservation;
    if (obs.date <= date) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export function resolveRate(observations: readonly RateObservation[], date: string, rule: RateRule): Resolution {
  let index = lastIndexOnOrBefore(observations, date);
  if (rule === 'previous-business-day') {
    // strictly before `date`: step back when the match is the date itself
    if (index !== -1 && (observations[index] as RateObservation).date === date) index -= 1;
  }
  const observation = index === -1 ? undefined : observations[index];
  if (rule === 'same-day') {
    if (observation !== undefined && observation.date === date) return { found: true, observation, daysBack: 0 };
    return { found: false, detail: `no rate was published on ${date}` };
  }
  if (observation === undefined) {
    return {
      found: false,
      detail:
        rule === 'previous-business-day'
          ? `no rate was published in the ${MAX_CARRY_DAYS} days before ${date}`
          : `no rate was published on or in the ${MAX_CARRY_DAYS} days before ${date} (the date may be before the series starts)`,
    };
  }
  const daysBack = diffDays(date, observation.date);
  if (daysBack > MAX_CARRY_DAYS) {
    return {
      found: false,
      detail: `the most recent rate before ${date} was published on ${observation.date}, ${daysBack} days earlier (limit: ${MAX_CARRY_DAYS} days); refusing to carry it over`,
    };
  }
  return { found: true, observation, daysBack };
}

/**
 * Union of several fetch windows of one currency, ascending, one observation per date. Where two
 * windows overlap, the richer observation (with a publication timestamp, then with a change) wins.
 */
export function mergeObservations(...lists: ReadonlyArray<readonly RateObservation[]>): RateObservation[] {
  const richness = (o: RateObservation): number => (o.publishedAt !== null ? 2 : 0) + (o.change !== null ? 1 : 0);
  const byDate = new Map<string, RateObservation>();
  for (const list of lists) {
    for (const o of list) {
      const existing = byDate.get(o.date);
      if (existing === undefined || richness(o) > richness(existing)) byDate.set(o.date, o);
    }
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Insert `observation`, replacing any existing observation of the same date; keeps the list ascending. */
export function upsertObservation(list: readonly RateObservation[], observation: RateObservation): RateObservation[] {
  return [...list.filter((o) => o.date !== observation.date), observation].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
