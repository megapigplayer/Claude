/**
 * Run the plan's source requests (async, but only through the injected RateSource, so it is testable
 * without a network) and assemble one ascending observation list per currency.
 *
 * A currency whose data could not be obtained completely is reported as a failure, never returned
 * partially: a carried-over rate computed from a half-loaded series would be silently wrong.
 */
import { latestToObservation, type LatestRate, type RateObservation, type RateSource } from './boi-adapter.js';
import { getCurrency } from './currencies.js';
import { addDays } from './dates.js';
import { SourceFormatError, SourceUnavailableError } from './http.js';
import type { FetchWindow } from './plan.js';
import { mergeObservations, upsertObservation } from './rates.js';

export interface SourceFailure {
  code: 'SOURCE_UNAVAILABLE' | 'SOURCE_FORMAT_ERROR' | 'INTERNAL_ERROR';
  message: string;
}

export interface LoadResult {
  seriesByCurrency: Map<string, RateObservation[]>;
  failures: Map<string, SourceFailure>;
  /** Source requests made (history windows + the optional latest-rates call). */
  requests: number;
  warnings: string[];
}

export interface LoadOptions {
  /** Today in Israel (YYYY-MM-DD). */
  today: string;
  concurrency?: number;
  /** A window that ends this recently and comes back EMPTY is treated as a broken source, not as "no data". */
  recentDays?: number;
}

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_RECENT_DAYS = 45;

function classify(err: unknown): SourceFailure {
  if (err instanceof SourceUnavailableError) return { code: 'SOURCE_UNAVAILABLE', message: err.message };
  if (err instanceof SourceFormatError) {
    return { code: 'SOURCE_FORMAT_ERROR', message: err.snippet ? `${err.message} Response started with: ${err.snippet}` : err.message };
  }
  return { code: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : String(err) };
}

async function mapPool<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function loadSeries(windows: readonly FetchWindow[], source: RateSource, options: LoadOptions): Promise<LoadResult> {
  const warnings: string[] = [];
  const failures = new Map<string, SourceFailure>();
  const lists = new Map<string, RateObservation[][]>();
  let requests = 0;
  const recentFrom = addDays(options.today, -(options.recentDays ?? DEFAULT_RECENT_DAYS));

  await mapPool(windows, options.concurrency ?? DEFAULT_CONCURRENCY, async (w) => {
    if (failures.has(w.currency)) return; // one failed window already spoils this currency
    requests++;
    try {
      const obs = await source.fetchSeries(w.currency, w.from, w.to);
      if (obs.length === 0 && w.to >= recentFrom) {
        failures.set(w.currency, {
          code: 'SOURCE_FORMAT_ERROR',
          message: `The Bank of Israel source returned no ${w.currency} rates for ${w.from}..${w.to}, although rates for recent dates must exist. The API location or format has probably changed.`,
        });
        return;
      }
      const bucket = lists.get(w.currency) ?? [];
      bucket.push(obs);
      lists.set(w.currency, bucket);
    } catch (err) {
      failures.set(w.currency, classify(err));
    }
  });

  const seriesByCurrency = new Map<string, RateObservation[]>();
  for (const [currency, buckets] of lists) if (!failures.has(currency)) seriesByCurrency.set(currency, mergeObservations(...buckets));

  // Freshest rates: only when a window reaches today. A failure here is not fatal (history still answers).
  const needsLatest = windows.filter((w) => w.to >= options.today && seriesByCurrency.has(w.currency));
  if (needsLatest.length > 0) {
    let latest: LatestRate[] = [];
    requests++;
    try {
      latest = await source.fetchLatest();
    } catch (err) {
      warnings.push(`Latest-rates request failed (${classify(err).message}); today's rate may be missing or one publication behind.`);
    }
    for (const w of needsLatest) {
      const rate = latest.find((l) => l.currency === w.currency);
      const tableUnit = getCurrency(w.currency)?.unit ?? 1;
      if (rate === undefined) continue;
      if (rate.unit !== null && rate.unit !== tableUnit) {
        warnings.push(`Unit mismatch for ${w.currency}: the source says ${rate.unit}, the built-in table says ${tableUnit}. Check VERIFY(BOI-08).`);
      }
      const obs = latestToObservation(rate, tableUnit);
      // The latest response is the fresher one: it replaces a history observation of the same date.
      if (obs !== null && obs.date >= w.from && obs.date <= w.to) {
        seriesByCurrency.set(w.currency, upsertObservation(seriesByCurrency.get(w.currency) ?? [], obs));
      }
    }
  }
  return { seriesByCurrency, failures, requests, warnings };
}
