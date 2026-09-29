import { describe, expect, it } from 'vitest';
import type { LatestRate, RateObservation, RateSource } from '../src/lib/boi-adapter.js';
import { SourceFormatError, SourceUnavailableError } from '../src/lib/http.js';
import { loadSeries } from '../src/lib/load.js';
import type { FetchWindow } from '../src/lib/plan.js';

const obs = (date: string, rate = 3.5, extra: Partial<RateObservation> = {}): RateObservation => ({ date, rate, unit: 1, change: null, publishedAt: null, ...extra });
const TODAY = '2026-09-29';

function fakeSource(handlers: {
  series?: (currency: string, from: string, to: string) => Promise<RateObservation[]> | RateObservation[];
  latest?: () => Promise<LatestRate[]> | LatestRate[];
}) {
  const seriesCalls: string[] = [];
  let latestCalls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const source: RateSource = {
    async fetchSeries(currency, from, to) {
      seriesCalls.push(`${currency}:${from}..${to}`);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return handlers.series ? handlers.series(currency, from, to) : [obs('2025-01-07')];
    },
    async fetchLatest() {
      latestCalls++;
      return handlers.latest ? handlers.latest() : [];
    },
  };
  return { source, seriesCalls, latestCalls: () => latestCalls, maxInFlight: () => maxInFlight };
}

const win = (currency: string, from: string, to: string): FetchWindow => ({ currency, from, to });

describe('loadSeries', () => {
  it('loads every window and merges the windows of one currency into one ascending series', async () => {
    const f = fakeSource({ series: (_c, from) => (from < '2025-01-10' ? [obs('2025-01-05'), obs('2025-01-08')] : [obs('2025-01-08'), obs('2025-01-12')]) });
    const r = await loadSeries([win('USD', '2025-01-01', '2025-01-09'), win('USD', '2025-01-10', '2025-01-15')], f.source, { today: TODAY });
    expect(r.seriesByCurrency.get('USD')?.map((o) => o.date)).toEqual(['2025-01-05', '2025-01-08', '2025-01-12']);
    expect(r.failures.size).toBe(0);
    expect(r.requests).toBe(2);
    expect(f.latestCalls()).toBe(0); // no window reaches today: the latest-rates call is not made
  });

  it('classifies failures per currency and leaves the other currencies intact', async () => {
    const f = fakeSource({
      series: (c) => {
        if (c === 'USD') throw new SourceUnavailableError('down', 3, 500);
        if (c === 'EUR') throw new SourceFormatError('bad csv', '<html>');
        if (c === 'GBP') throw new Error('boom');
        return [obs('2025-01-07')];
      },
    });
    const r = await loadSeries(['USD', 'EUR', 'GBP', 'JPY'].map((c) => win(c, '2025-01-01', '2025-01-09')), f.source, { today: TODAY });
    expect(r.failures.get('USD')).toEqual({ code: 'SOURCE_UNAVAILABLE', message: 'down' });
    expect(r.failures.get('EUR')).toEqual({ code: 'SOURCE_FORMAT_ERROR', message: 'bad csv Response started with: <html>' });
    expect(r.failures.get('GBP')).toEqual({ code: 'INTERNAL_ERROR', message: 'boom' });
    expect([...r.seriesByCurrency.keys()]).toEqual(['JPY']);
  });

  it('never returns a partial series: one failed window fails the whole currency', async () => {
    const f = fakeSource({ series: (_c, from) => (from === '2025-03-01' ? Promise.reject(new SourceUnavailableError('down', 3, 503)) : [obs('2025-01-07')]) });
    const r = await loadSeries([win('USD', '2025-01-01', '2025-01-09'), win('USD', '2025-03-01', '2025-03-09')], f.source, { today: TODAY });
    expect(r.seriesByCurrency.has('USD')).toBe(false);
    expect(r.failures.get('USD')?.code).toBe('SOURCE_UNAVAILABLE');
  });

  it('treats an EMPTY answer for a recent window as a broken source, but an empty old window as "no data"', async () => {
    const f = fakeSource({ series: () => [] });
    const recent = await loadSeries([win('USD', '2026-09-10', '2026-09-23')], f.source, { today: TODAY });
    expect(recent.failures.get('USD')).toMatchObject({ code: 'SOURCE_FORMAT_ERROR' });
    expect(recent.failures.get('USD')?.message).toMatch(/no USD rates for 2026-09-10\.\.2026-09-23.*probably changed/);
    const old = await loadSeries([win('USD', '2025-01-01', '2025-01-09')], f.source, { today: TODAY });
    expect(old.failures.size).toBe(0);
    expect(old.seriesByCurrency.get('USD')).toEqual([]);
  });

  it('respects the concurrency limit', async () => {
    const f = fakeSource({});
    await loadSeries(Array.from({ length: 8 }, (_, i) => win(`C${i}`, '2025-01-01', '2025-01-09')), f.source, { today: TODAY, concurrency: 2 });
    expect(f.maxInFlight()).toBeLessThanOrEqual(2);
    expect(f.maxInFlight()).toBeGreaterThan(0);
  });
});

describe('loadSeries: today and the latest-rates call', () => {
  const latest = (over: Partial<LatestRate> = {}): LatestRate => ({ currency: 'USD', rate: 3.2111, unit: 1, change: 0.12, lastUpdate: '2026-09-28T12:30:04.510Z', ...over });
  const history = [obs('2026-09-25', 3.2), obs('2026-09-28', 3.21)];

  it('calls the latest-rates service once when any window reaches today, and lets it replace the same-date history value', async () => {
    const f = fakeSource({ series: () => history, latest: () => [latest()] });
    const r = await loadSeries([win('USD', '2026-09-15', TODAY), win('EUR', '2026-09-15', TODAY)], f.source, { today: TODAY });
    expect(f.latestCalls()).toBe(1);
    expect(r.requests).toBe(3);
    const usd = r.seriesByCurrency.get('USD') ?? [];
    expect(usd.map((o) => o.date)).toEqual(['2026-09-25', '2026-09-28']);
    expect(usd[1]).toMatchObject({ rate: 3.2111, change: 0.12, publishedAt: '2026-09-28T12:30:04.510Z' });
  });

  it('adds the latest rate when history does not have that date yet', async () => {
    const f = fakeSource({ series: () => [obs('2026-09-25', 3.2)], latest: () => [latest({ lastUpdate: '2026-09-29T12:30:00.000Z' })] });
    const r = await loadSeries([win('USD', '2026-09-15', TODAY)], f.source, { today: TODAY });
    expect(r.seriesByCurrency.get('USD')?.map((o) => o.date)).toEqual(['2026-09-25', '2026-09-29']);
  });

  it('ignores a latest rate that falls outside the window', async () => {
    const f = fakeSource({ series: () => history, latest: () => [latest({ lastUpdate: '2026-10-05T12:30:00.000Z' })] });
    const r = await loadSeries([win('USD', '2026-09-15', TODAY)], f.source, { today: TODAY });
    expect(r.seriesByCurrency.get('USD')).toEqual(history);
  });

  it('a failing latest-rates call is only a warning: history still answers', async () => {
    const f = fakeSource({ series: () => history, latest: () => Promise.reject(new SourceUnavailableError('latest down', 3, 503)) });
    const r = await loadSeries([win('USD', '2026-09-15', TODAY)], f.source, { today: TODAY });
    expect(r.failures.size).toBe(0);
    expect(r.seriesByCurrency.get('USD')).toEqual(history);
    expect(r.warnings.join(' ')).toMatch(/Latest-rates request failed \(latest down\)/);
  });

  it('warns when the source unit differs from the built-in table (VERIFY(BOI-08))', async () => {
    const f = fakeSource({ series: () => [obs('2026-09-25', 2.1)], latest: () => [latest({ currency: 'JPY', rate: 2.18, unit: 10 })] });
    const r = await loadSeries([win('JPY', '2026-09-15', TODAY)], f.source, { today: TODAY });
    expect(r.warnings.join(' ')).toMatch(/Unit mismatch for JPY: the source says 10, the built-in table says 100/);
  });

  it('does not ask for the latest rates for a currency whose history failed', async () => {
    const f = fakeSource({ series: () => Promise.reject(new SourceUnavailableError('down', 3, 500)), latest: () => [latest()] });
    const r = await loadSeries([win('USD', '2026-09-15', TODAY)], f.source, { today: TODAY });
    expect(f.latestCalls()).toBe(0);
    expect(r.failures.has('USD')).toBe(true);
  });
});
