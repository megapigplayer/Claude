/**
 * End-to-end: raw input -> plan -> the REAL adapter (URL builder + parsers) fed by fixture bodies ->
 * rows. Everything except the network is real. The numbers come from the SYNTHETIC fixtures in
 * test/fixtures/boi (see generate-fixtures.mjs); they are not Bank of Israel rates.
 */
import { describe, expect, it } from 'vitest';
import { createFixtureFetch } from '../src/fixture-fetch.js';
import { createBoiHttpSource, DEFAULT_ADAPTER_CONFIG, type RateSource } from '../src/lib/boi-adapter.js';
import { normalizeInput } from '../src/lib/input.js';
import type { ResultRow } from '../src/lib/process.js';
import { prepareRun, rowsOf } from '../src/lib/run.js';

const fixtureSource = (): RateSource => createBoiHttpSource({ deps: { fetch: createFixtureFetch(), sleep: () => Promise.resolve(), random: () => 0 } });

async function run(rawInput: unknown, now = '2026-09-29T10:00:00Z') {
  const prepared = await prepareRun(normalizeInput(rawInput), new Date(now), fixtureSource(), 'fixtures');
  return { rows: [...rowsOf(prepared)], prepared };
}

const cell = (rows: ResultRow[], date: string, currency: string): ResultRow | undefined => rows.find((r) => r.rowType === 'rate' && r.date === date && r.currency === currency);

describe('the daily-test default input (fixture mode)', () => {
  it('produces exactly one USD row for 2026-09-23 with the fixture rate and a computed change', async () => {
    const { rows, prepared } = await run({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      rowType: 'rate', ok: true, reasonCode: 'OK', reason: 'Rate published on 2026-09-23.', date: '2026-09-23', currency: 'USD', rate: 3.2316, unit: 1, change: 0.31,
      publishedAt: null, provisional: false, rateDate: '2026-09-23', daysBack: 0, ruleApplied: 'last-published-on-or-before', dataSource: 'fixtures',
    });
    expect(prepared.loaded.requests).toBe(1); // one source request, and no latest-rates call (the date is in the past)
  });
});

describe('3 currencies x 5 dates (2025-01-05 Sun .. 2025-01-09 Thu)', () => {
  it('returns 15 published rates with the right units', async () => {
    const { rows } = await run({ currencies: ['USD', 'EUR', 'JPY'], dateFrom: '2025-01-05', dateTo: '2025-01-09' });
    expect(rows).toHaveLength(15);
    expect(rows.every((r) => r.ok && r.reasonCode === 'OK' && r.rowType === 'rate' && r.daysBack === 0)).toBe(true);
    expect(cell(rows, '2025-01-07', 'USD')).toMatchObject({ rate: 3.648, unit: 1, change: -0.192 });
    expect(cell(rows, '2025-01-07', 'EUR')).toMatchObject({ rate: 3.752, unit: 1 });
    expect(cell(rows, '2025-01-07', 'JPY')).toMatchObject({ rate: 2.3118, unit: 100 });
    expect(rows.slice(0, 3).map((r) => r.currency)).toEqual(['USD', 'EUR', 'JPY']);
  });
});

describe('the three rules across a Friday/Saturday gap (2025-01-09 Thu .. 2025-01-13 Mon)', () => {
  const range = { currencies: ['USD'], dateFrom: '2025-01-09', dateTo: '2025-01-13' };
  const view = (rows: ResultRow[]) => rows.map((r) => (r.rowType === 'rate' ? [r.date, r.rateDate, r.daysBack] : []));

  it('last-published-on-or-before: every calendar date gets a row; Fri and Sat carry Thursday forward', async () => {
    const { rows } = await run({ ...range, rateRule: 'last-published-on-or-before' });
    expect(view(rows)).toEqual([
      ['2025-01-09', '2025-01-09', 0],
      ['2025-01-10', '2025-01-09', 1],
      ['2025-01-11', '2025-01-09', 2],
      ['2025-01-12', '2025-01-12', 0],
      ['2025-01-13', '2025-01-13', 0],
    ]);
    expect(cell(rows, '2025-01-11', 'USD')).toMatchObject({ rate: 3.652, ok: true });
  });

  it('previous-business-day: strictly the publication before each date', async () => {
    const { rows } = await run({ ...range, rateRule: 'previous-business-day' });
    expect(view(rows)).toEqual([
      ['2025-01-09', '2025-01-08', 1],
      ['2025-01-10', '2025-01-09', 1],
      ['2025-01-11', '2025-01-09', 2],
      ['2025-01-12', '2025-01-09', 3],
      ['2025-01-13', '2025-01-12', 1],
    ]);
  });

  it('same-day: only publication days produce rows; the skipped dates are counted', async () => {
    const { rows, prepared } = await run({ ...range, rateRule: 'same-day' });
    expect(view(rows)).toEqual([['2025-01-09', '2025-01-09', 0], ['2025-01-12', '2025-01-12', 0], ['2025-01-13', '2025-01-13', 0]]);
    expect(prepared.context.stats.skippedNoPublication).toBe(2);
  });
});

describe('invoice-date conversions', () => {
  it('uses the last rate published on or before the invoice date and rounds to agorot', async () => {
    const { rows } = await run({
      conversions: [
        { amount: 1200, currency: 'USD', date: '2025-01-07', reference: 'INV-1' }, // publication day
        { amount: 1200, currency: 'USD', date: '2025-01-11', reference: 'INV-2' }, // Saturday: Thursday's rate
        { amount: 100000, currency: 'JPY', date: '2025-01-07', reference: 'INV-3' }, // per-100 unit
        { amount: '2,500.50', currency: '€', date: '2025-01-13', reference: 'INV-4' },
      ],
    });
    expect(rows.map((r) => (r.rowType === 'conversion' ? [r.reference, r.rateUsed, r.rateDate, r.ilsAmount] : []))).toEqual([
      ['INV-1', 3.648, '2025-01-07', 4377.6],
      ['INV-2', 3.652, '2025-01-09', 4382.4],
      ['INV-3', 2.3118, '2025-01-07', 2311.8],
      ['INV-4', 3.751, '2025-01-13', 9379.38], // 2500.50 x 3.751 = 9379.3755
    ]);
    expect(rows.every((r) => r.ok)).toBe(true);
  });

  it('answers bad conversions with free notice rows and keeps going', async () => {
    const { rows } = await run({
      conversions: [
        { amount: 10, currency: 'XYZ', date: '2025-01-07' },
        { amount: 'ten', currency: 'USD', date: '2025-01-07' },
        { amount: 10, currency: 'USD', date: '07/01/2025' },
        { amount: 10, currency: 'USD', date: '2999-01-01' },
        { amount: 10, currency: 'USD', date: '1990-01-01' },
        { amount: 10, currency: 'USD', date: '2025-01-07' },
      ],
    });
    expect(rows.map((r) => r.reasonCode)).toEqual(['UNKNOWN_CURRENCY', 'INVALID_AMOUNT', 'INVALID_DATE', 'DATE_IN_FUTURE', 'NO_RATE_PUBLISHED', 'OK']);
    expect(rows.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe('unknown currency and missing data', () => {
  it('a currency outside the 14 gets one notice row in a range', async () => {
    const { rows } = await run({ currencies: ['USD', 'CNH'], dateFrom: '2025-01-05', dateTo: '2025-01-05' });
    expect(rows.map((r) => [r.currency, r.reasonCode])).toEqual([['CNH', 'UNKNOWN_CURRENCY'], ['USD', 'OK']]);
  });

  it('a supported currency the source has no data for (HTTP 404) yields NO_RATE_PUBLISHED for old dates', async () => {
    const { rows, prepared } = await run({ currencies: ['CHF'], dateFrom: '2025-01-05', dateTo: '2025-01-06' });
    expect(prepared.loaded.failures.size).toBe(0);
    expect(rows.map((r) => r.reasonCode)).toEqual(['NO_RATE_PUBLISHED', 'NO_RATE_PUBLISHED']);
  });

  it('the same for RECENT dates is reported as a broken source, never as empty data', async () => {
    const { rows, prepared } = await run({ currencies: ['CHF'], dateFrom: '2026-09-23', dateTo: '2026-09-23' });
    expect(prepared.loaded.failures.get('CHF')?.code).toBe('SOURCE_FORMAT_ERROR');
    expect(rows[0]).toMatchObject({ ok: false, reasonCode: 'SOURCE_FORMAT_ERROR' });
  });
});

describe('today: latest rates from the PublicApi fixture', () => {
  const rawToday = { currencies: ['USD'], dateFrom: 'today', dateTo: 'today' };

  it('after the update has settled: the published rate with timestamp and BOI-supplied change, not provisional', async () => {
    const { rows, prepared } = await run(rawToday, '2026-09-28T13:00:00Z'); // 16:00 in Israel, 30 minutes after the fixture publication
    expect(prepared.loaded.requests).toBe(2); // history + latest
    expect(rows[0]).toMatchObject({ date: '2026-09-28', rateDate: '2026-09-28', rate: 3.2111, change: 0.12, publishedAt: '2026-09-28T12:30:04.510Z', provisional: false });
  });

  it('within 15 minutes of publication: provisional', async () => {
    const { rows } = await run(rawToday, '2026-09-28T12:40:00Z');
    expect(rows[0]).toMatchObject({ rate: 3.2111, provisional: true });
    expect(rows[0]?.reason).toMatch(/Provisional/);
  });

  it('on a day with no publication yet, the previous rate is used and honestly dated', async () => {
    const { rows } = await run(rawToday, '2026-09-29T05:00:00Z'); // Tuesday morning, nothing published for the 29th
    expect(rows[0]).toMatchObject({ date: '2026-09-29', rateDate: '2026-09-28', daysBack: 1 });
  });
});

describe('the adapter really goes through the documented URLs', () => {
  it('asks for RER_<CUR>_ILS with a lookback window and CSV format', async () => {
    const urls: string[] = [];
    const inner = createFixtureFetch();
    const source = createBoiHttpSource({
      config: DEFAULT_ADAPTER_CONFIG,
      deps: { fetch: (url, init) => (urls.push(url), inner(url, init)), sleep: () => Promise.resolve(), random: () => 0 },
    });
    await prepareRun(normalizeInput({}), new Date('2026-09-29T10:00:00Z'), source, 'fixtures');
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0] as string);
    expect(url.searchParams.get('c[SERIES_CODE]')).toBe('RER_USD_ILS');
    expect(url.searchParams.get('startperiod')).toBe('2026-09-09');
    expect(url.searchParams.get('endperiod')).toBe('2026-09-23');
    expect(url.searchParams.get('format')).toBe('csv');
  });
});
