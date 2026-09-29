import { describe, expect, it } from 'vitest';
import {
  buildLatestUrl,
  buildSeriesUrl,
  createBoiHttpSource,
  DEFAULT_ADAPTER_CONFIG,
  latestToObservation,
  parseLatestBody,
  parseLatestJson,
  parseLatestXml,
  parseSdmxCsv,
  parseSdmxJson,
  parseSeriesBody,
  seriesCodeFor,
  withComputedChange,
} from '../src/lib/boi-adapter.js';
import { DEFAULT_HTTP_POLICY, type HttpDeps, SourceFormatError, SourceUnavailableError } from '../src/lib/http.js';
import { fixture } from './helpers.js';

describe('URLs (VERIFY(BOI-01, BOI-04, BOI-05, BOI-06, BOI-07))', () => {
  it('names the series RER_<CUR>_ILS', () => {
    expect(seriesCodeFor('USD')).toBe('RER_USD_ILS');
    expect(seriesCodeFor('JPY')).toBe('RER_JPY_ILS');
  });

  it('builds the SDMX request with series filter, inclusive period bounds and CSV format', () => {
    const url = new URL(buildSeriesUrl(DEFAULT_ADAPTER_CONFIG, 'USD', '2025-01-01', '2025-01-31'));
    expect(url.origin + url.pathname).toBe(DEFAULT_ADAPTER_CONFIG.sdmxDataUrl);
    expect(url.searchParams.get('c[SERIES_CODE]')).toBe('RER_USD_ILS');
    expect(url.searchParams.get('startperiod')).toBe('2025-01-01');
    expect(url.searchParams.get('endperiod')).toBe('2025-01-31');
    expect(url.searchParams.get('format')).toBe('csv');
  });

  it('builds the latest-rates URL from the configurable base', () => {
    expect(buildLatestUrl(DEFAULT_ADAPTER_CONFIG)).toBe(`${DEFAULT_ADAPTER_CONFIG.publicApiBase}/GetExchangeRates`);
    expect(buildLatestUrl({ ...DEFAULT_ADAPTER_CONFIG, publicApiBase: 'https://example.test/api' })).toBe('https://example.test/api/GetExchangeRates');
  });
});

describe('parseSdmxCsv: normal day, weekend/holiday gap, missing values', () => {
  it('parses a single normal day', () => {
    const parsed = parseSdmxCsv(fixture('cases/normal-day.csv'), 'USD');
    expect(parsed.observations).toEqual([{ date: '2025-01-07', rate: 3.648, unit: 1, change: null, publishedAt: null }]);
    expect(parsed.format).toBe('sdmx-csv');
    expect(parsed.skippedMissing).toBe(0);
  });

  it('keeps the gap: no rows for the Rosh Hashana days 2024-10-03..05', () => {
    const dates = parseSdmxCsv(fixture('cases/holiday-gap.csv'), 'USD').observations.map((o) => o.date);
    expect(dates).toEqual(['2024-09-29', '2024-09-30', '2024-10-01', '2024-10-02', '2024-10-06', '2024-10-07', '2024-10-08']);
  });

  it('uses the built-in unit as the fallback: JPY per 100, LBP per 10', () => {
    const jpy = fixture('sdmx/RER_JPY_ILS.csv');
    expect(parseSdmxCsv(jpy, 'JPY').observations.every((o) => o.unit === 100)).toBe(true);
    const lbp = 'TIME_PERIOD,OBS_VALUE\n2025-01-07,0.0036\n';
    expect(parseSdmxCsv(lbp, 'LBP').observations[0]?.unit).toBe(10);
  });

  it('skips rows the source marks as missing (empty, NaN, OBS_STATUS=M) and counts them', () => {
    const parsed = parseSdmxCsv(fixture('cases/missing-values.csv'), 'USD');
    expect(parsed.observations.map((o) => [o.date, o.rate])).toEqual([['2025-01-07', 3.648]]);
    expect(parsed.skippedMissing).toBe(2);
  });

  it('returns an empty series for a header-only or empty body', () => {
    expect(parseSdmxCsv(fixture('cases/empty-header-only.csv'), 'USD').observations).toEqual([]);
    expect(parseSdmxCsv('', 'USD').observations).toEqual([]);
    expect(parseSeriesBody('   \n', 'USD').observations).toEqual([]);
  });

  it('copes with a BOM, semicolon delimiters, quoted cells and CRLF', () => {
    const parsed = parseSdmxCsv(fixture('cases/semicolon-bom-quoted.csv'), 'USD');
    expect(parsed.observations.map((o) => [o.date, o.rate])).toEqual([
      ['2025-01-06', 3.655],
      ['2025-01-07', 3.648],
    ]);
  });

  it('keeps only the requested series when the server ignored the filter and returned several', () => {
    const parsed = parseSdmxCsv(fixture('cases/multi-series.csv'), 'USD');
    expect(parsed.observations.map((o) => [o.date, o.rate])).toEqual([
      ['2025-01-06', 3.655],
      ['2025-01-07', 3.648],
    ]);
    const eur = parseSdmxCsv(fixture('cases/multi-series.csv'), 'EUR');
    expect(eur.observations.map((o) => o.rate)).toEqual([3.79, 3.752]);
  });

  it('fails clearly when the response holds only other series', () => {
    expect(() => parseSdmxCsv(fixture('cases/multi-series.csv'), 'GBP')).toThrow(/none for series RER_GBP_ILS/);
  });

  it('sorts rows and lets the last duplicate win', () => {
    const csv = 'TIME_PERIOD,OBS_VALUE\n2025-01-08,3.7\n2025-01-07,3.6\n2025-01-07,3.65\n';
    expect(parseSdmxCsv(csv, 'USD').observations.map((o) => [o.date, o.rate])).toEqual([
      ['2025-01-07', 3.65],
      ['2025-01-08', 3.7],
    ]);
  });

  it('accepts a datetime period and alternative column names', () => {
    const csv = 'DATE,VALUE\n2025-01-07T00:00:00,3.6\n';
    expect(parseSdmxCsv(csv, 'USD').observations[0]).toMatchObject({ date: '2025-01-07', rate: 3.6 });
  });
});

describe('parseSdmxCsv / parseSeriesBody: malformed responses fail loudly, never silently', () => {
  it('rejects a CSV without time/value columns and names the columns it found', () => {
    expect(() => parseSdmxCsv(fixture('cases/malformed-no-columns.csv'), 'USD')).toThrow(/no time\/value columns.*CODE, NAME/);
    expect(() => parseSdmxCsv(fixture('cases/malformed-no-columns.csv'), 'USD')).toThrow(SourceFormatError);
  });

  it('rejects unusable rates (text, zero) and non-daily periods', () => {
    expect(() => parseSdmxCsv(fixture('cases/malformed-bad-rate.csv'), 'USD')).toThrow(/unusable rate "abc"/);
    expect(() => parseSdmxCsv(fixture('cases/malformed-zero-rate.csv'), 'USD')).toThrow(/unusable rate "0"/);
    expect(() => parseSdmxCsv(fixture('cases/malformed-period.csv'), 'USD')).toThrow(/not a daily date: "2025-01"/);
  });

  it('recognises an HTML block page and includes a snippet of it', () => {
    let error: unknown;
    try {
      parseSeriesBody(fixture('cases/html-block-page.html'), 'USD');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SourceFormatError);
    expect((error as SourceFormatError).message).toMatch(/HTML page/);
    expect((error as SourceFormatError).snippet).toMatch(/Access denied/);
  });

  it('rejects truncated JSON and XML where CSV was expected', () => {
    expect(() => parseSeriesBody(fixture('cases/malformed-truncated.json'), 'USD')).toThrow(/not valid JSON/);
    expect(() => parseSeriesBody('<Error>oops</Error>', 'USD')).toThrow(/returned XML/);
  });

  it('treats a plain-text error body as a format error (no time/value columns)', () => {
    expect(() => parseSeriesBody(fixture('cases/unknown-series.txt'), 'USD')).toThrow(SourceFormatError);
  });
});

describe('parseSdmxJson (VERIFY(BOI-07) fallback representation)', () => {
  it('parses observations by time index and skips missing values', () => {
    const parsed = parseSeriesBody(fixture('cases/sdmx-json.json'), 'USD');
    expect(parsed.format).toBe('sdmx-json');
    expect(parsed.observations.map((o) => [o.date, o.rate])).toEqual([
      ['2025-01-06', 3.655],
      ['2025-01-07', 3.648],
    ]);
    expect(parsed.skippedMissing).toBe(1);
  });

  it('accepts the SDMX-JSON 2.0 layout (data.structures)', () => {
    const doc = { data: { dataSets: [{ series: { '0': { observations: { '0': [3.5] } } } }], structures: [{ dimensions: { observation: [{ id: 'TIME_PERIOD', values: [{ id: '2025-01-06' }] }] } }] } };
    expect(parseSdmxJson(JSON.stringify(doc), 'USD').observations).toEqual([{ date: '2025-01-06', rate: 3.5, unit: 1, change: null, publishedAt: null }]);
  });

  it('returns nothing for an empty series set and rejects ambiguous or malformed messages', () => {
    expect(parseSdmxJson(JSON.stringify({ dataSets: [{ series: {} }], structure: {} }), 'USD').observations).toEqual([]);
    expect(() => parseSdmxJson(JSON.stringify({ dataSets: [{ series: { a: {}, b: {} } }] }), 'USD')).toThrow(/2 series/);
    expect(() => parseSdmxJson(JSON.stringify({ nothing: true }), 'USD')).toThrow(/no dataSets/);
    expect(() => parseSdmxJson('[1,2]', 'USD')).toThrow(SourceFormatError);
  });
});

describe('withComputedChange', () => {
  const obs = (date: string, rate: number, change: number | null = null) => ({ date, rate, unit: 1, change, publishedAt: null });

  it('computes percent change vs the previous observation, rounded to 3 decimals; the first stays unknown', () => {
    const out = withComputedChange([obs('2025-01-05', 3.647), obs('2025-01-06', 3.655), obs('2025-01-07', 3.648)]);
    expect(out.map((o) => o.change)).toEqual([null, 0.219, -0.192]);
  });

  it('keeps a change supplied by the source and never returns -0', () => {
    const out = withComputedChange([obs('2025-01-05', 3.6), obs('2025-01-06', 3.6), obs('2025-01-07', 3.7, 9.9)]);
    expect(out.map((o) => o.change)).toEqual([null, 0, 9.9]);
    expect(Object.is(out[1]?.change, 0)).toBe(true);
  });
});

describe('latest rates (PublicApi): JSON and XML variants', () => {
  it('parses the JSON variant (14 currencies, JPY unit 100, ISO timestamps)', () => {
    const rates = parseLatestJson(fixture('cases/publicapi-latest.json'));
    expect(rates).toHaveLength(14);
    expect(rates.find((r) => r.currency === 'USD')).toEqual({ currency: 'USD', rate: 3.2111, unit: 1, change: 0.12, lastUpdate: '2026-09-28T12:30:04.510Z' });
    expect(rates.find((r) => r.currency === 'JPY')?.unit).toBe(100);
    expect(rates.find((r) => r.currency === 'LBP')?.unit).toBe(10);
  });

  it('parses the XML variant into the same values', () => {
    expect(parseLatestXml(fixture('cases/publicapi-latest.xml'))).toEqual(parseLatestJson(fixture('cases/publicapi-latest.json')));
  });

  it('parses the legacy XML layout and takes the update date from the document header', () => {
    const rates = parseLatestXml(fixture('cases/publicapi-legacy.xml'));
    expect(rates.map((r) => r.currency)).toEqual(['USD', 'GBP', 'JPY']);
    expect(rates[0]).toMatchObject({ rate: 3.2111, unit: 1, change: 0.12, lastUpdate: '2026-09-28T00:00:00.000Z' });
  });

  it('sniffs JSON, XML and rejects HTML, plain text and JSON without rates', () => {
    expect(parseLatestBody(fixture('cases/publicapi-latest.json'))).toHaveLength(14);
    expect(parseLatestBody(fixture('cases/publicapi-latest.xml'))).toHaveLength(14);
    expect(() => parseLatestBody(fixture('cases/html-block-page.html'))).toThrow(/HTML page/);
    expect(() => parseLatestBody('Service unavailable')).toThrow(/neither JSON nor XML/);
    expect(() => parseLatestBody(fixture('cases/publicapi-malformed.json'))).toThrow(/none has the expected fields/);
    expect(() => parseLatestBody(fixture('cases/publicapi-no-array.json'))).toThrow(/no exchangeRates array/);
    expect(() => parseLatestBody('{"exchangeRates": [')).toThrow(/not valid JSON/);
    expect(() => parseLatestXml('<x></x>')).toThrow(/no recognisable currency elements/);
  });

  it('tolerates field-name variants, string numbers and skips broken entries', () => {
    const body = JSON.stringify({ rates: [{ currencyCode: 'usd', rate: '3.5', change: '-0.1', unit: '1' }, { key: 'EUR' }, { key: 'X1', currentExchangeRate: 1 }, 5, null] });
    expect(parseLatestJson(body)).toEqual([{ currency: 'USD', rate: 3.5, unit: 1, change: -0.1, lastUpdate: null }]);
  });

  it('converts an update instant to the Israeli calendar date', () => {
    const base = { currency: 'USD', rate: 3.2, unit: 1, change: 0.1 };
    expect(latestToObservation({ ...base, lastUpdate: '2026-09-28T12:30:04.510Z' }, 1)).toEqual({ date: '2026-09-28', rate: 3.2, unit: 1, change: 0.1, publishedAt: '2026-09-28T12:30:04.510Z' });
    expect(latestToObservation({ ...base, lastUpdate: '2026-09-28T21:30:00.000Z' }, 1)?.date).toBe('2026-09-29'); // 00:30 next day in Israel (UTC+3)
    expect(latestToObservation({ ...base, lastUpdate: null }, 1)).toBeNull();
    expect(latestToObservation({ ...base, unit: null, lastUpdate: '2026-09-28T12:30:00.000Z' }, 100)?.unit).toBe(100);
  });
});

describe('createBoiHttpSource', () => {
  function source(routes: (url: string) => { status: number; body: string }, calls: string[] = []) {
    const deps: HttpDeps = {
      fetch: (url) => {
        calls.push(url);
        const r = routes(url);
        return Promise.resolve({ status: r.status, headers: { get: () => null }, text: () => Promise.resolve(r.body) });
      },
      sleep: () => Promise.resolve(),
      random: () => 0,
    };
    return createBoiHttpSource({ deps, policy: { ...DEFAULT_HTTP_POLICY, maxAttempts: 2 } });
  }

  it('fetches a window, filters to it, sorts, and computes changes', async () => {
    const calls: string[] = [];
    const s = source(() => ({ status: 200, body: fixture('sdmx/RER_USD_ILS.csv') }), calls); // returns MORE than asked: the adapter filters defensively
    const obs = await s.fetchSeries('USD', '2025-01-05', '2025-01-07');
    expect(obs.map((o) => [o.date, o.rate, o.change])).toEqual([
      ['2025-01-05', 3.647, null],
      ['2025-01-06', 3.655, 0.219],
      ['2025-01-07', 3.648, -0.192],
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('RER_USD_ILS');
  });

  it('treats HTTP 404 and 204 (SDMX "no results") as an empty series', async () => {
    expect(await source(() => ({ status: 404, body: fixture('cases/unknown-series.txt') })).fetchSeries('USD', '2025-01-05', '2025-01-07')).toEqual([]);
    expect(await source(() => ({ status: 204, body: '' })).fetchSeries('USD', '2025-01-05', '2025-01-07')).toEqual([]);
  });

  it('maps 403 to SourceUnavailableError (blocked) and other 4xx to SourceFormatError (rejected request)', async () => {
    await expect(source(() => ({ status: 403, body: 'denied' })).fetchSeries('USD', '2025-01-05', '2025-01-07')).rejects.toBeInstanceOf(SourceUnavailableError);
    await expect(source(() => ({ status: 400, body: 'bad request' })).fetchSeries('USD', '2025-01-05', '2025-01-07')).rejects.toThrow(/rejected the request with HTTP 400/);
  });

  it('retries 500s and then fails with a clear unreachable error', async () => {
    const calls: string[] = [];
    const s = source(() => ({ status: 500, body: '' }), calls);
    await expect(s.fetchSeries('USD', '2025-01-05', '2025-01-07')).rejects.toThrow(/could not be reached after 2 attempt/);
    expect(calls).toHaveLength(2);
  });

  it('surfaces a 200 HTML page as a format error', async () => {
    await expect(source(() => ({ status: 200, body: fixture('cases/html-block-page.html') })).fetchSeries('USD', '2025-01-05', '2025-01-07')).rejects.toBeInstanceOf(SourceFormatError);
  });

  it('fetches and parses the latest rates', async () => {
    const calls: string[] = [];
    const s = source(() => ({ status: 200, body: fixture('cases/publicapi-latest.xml') }), calls);
    expect(await s.fetchLatest()).toHaveLength(14);
    expect(calls[0]).toBe(buildLatestUrl(DEFAULT_ADAPTER_CONFIG));
    await expect(source(() => ({ status: 403, body: '' })).fetchLatest()).rejects.toBeInstanceOf(SourceUnavailableError);
    await expect(source(() => ({ status: 418, body: '' })).fetchLatest()).rejects.toBeInstanceOf(SourceFormatError);
  });
});
