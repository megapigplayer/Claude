/**
 * THE ONLY FILE THAT KNOWS WHAT THE BANK OF ISRAEL (BOI) API LOOKS LIKE.
 *
 * ############################################################################################
 * # UNVERIFIED. This adapter was written offline (no network access to boi.org.il / boi.gov.il
 * # from the build environment) from memory of the BOI's public documentation. Every
 * # assumption is tagged VERIFY(BOI-nn) and listed in README.md > "Internal notes". The Actor
 * # must NOT be published until a live check has confirmed or corrected each item; if BOI
 * # changed something, fix THIS FILE (and the fixtures in test/fixtures/boi/) only.
 * ############################################################################################
 *
 * Two BOI data services are used:
 *
 * 1. History: the BOI statistics database, an SDMX 2.1 REST "edge server", one request per
 *    currency and date window, asked for as SDMX-CSV.
 * 2. Latest rates: the BOI "PublicApi" (all current representative rates in one response, JSON or
 *    XML). Used only when a requested window includes today, to pick up a rate the history service
 *    may not have yet, and for the publication timestamp and the source's own daily change.
 *
 * Responses are sniffed (CSV / SDMX-JSON / JSON / XML / HTML) instead of trusted, so a format switch on
 * the BOI side is either handled or reported as SourceFormatError - never guessed at silently.
 */
import { parseCsv } from './csv.js';
import { getCurrency } from './currencies.js';
import { israelDate, isValidIsoDate } from './dates.js';
import {
  DEFAULT_HTTP_POLICY,
  fetchText,
  type HttpDeps,
  type HttpPolicy,
  SourceFormatError,
  SourceUnavailableError,
} from './http.js';

/** One published representative rate. */
export interface RateObservation {
  /** The date the rate is representative for / was published (YYYY-MM-DD). */
  date: string;
  /** ILS per `unit` units of the foreign currency, exactly as published. */
  rate: number;
  unit: number;
  /** Percent change against the previous published rate, when known. */
  change: number | null;
  /** ISO instant of publication, when the source states one. */
  publishedAt: string | null;
}

/** A current rate from the PublicApi "all rates" response. */
export interface LatestRate {
  currency: string;
  rate: number;
  unit: number | null;
  change: number | null;
  /** ISO instant of the last update, when present. */
  lastUpdate: string | null;
}

export interface AdapterConfig {
  /** VERIFY(BOI-01): base URL of the PublicApi (no trailing slash). */
  publicApiBase: string;
  /** VERIFY(BOI-04): SDMX REST data URL of the exchange-rate dataflow (trailing slash). */
  sdmxDataUrl: string;
}

export const DEFAULT_ADAPTER_CONFIG: AdapterConfig = {
  // VERIFY(BOI-01): host and path of the PublicApi ("GetExchangeRates" = every current representative rate).
  publicApiBase: 'https://www.boi.org.il/PublicApi',
  // VERIFY(BOI-04): host, SDMX v2 REST path and dataflow id ("BOI.STATISTICS" agency, "EXR" exchange rates, version 1.0).
  sdmxDataUrl: 'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/',
};

/** The port the rest of the Actor uses; implemented by the live HTTP source and (in tests) by a fixture-backed fetch. */
export interface RateSource {
  /** Every observation with from <= date <= to (inclusive), ascending, one per date. May be empty. */
  fetchSeries(currency: string, from: string, to: string): Promise<RateObservation[]>;
  /** Current representative rates of all currencies (PublicApi). */
  fetchLatest(): Promise<LatestRate[]>;
}

// ---------------------------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------------------------

/** VERIFY(BOI-05): the series id of the daily representative rate of `currency` against ILS ("RER" = representative exchange rate). */
export function seriesCodeFor(currency: string): string {
  return `RER_${currency}_ILS`;
}

export function buildSeriesUrl(config: AdapterConfig, currency: string, from: string, to: string): string {
  const url = new URL(config.sdmxDataUrl);
  // VERIFY(BOI-05): series selection with the Fusion Edge "c[DIMENSION]=value" filter on SERIES_CODE.
  url.searchParams.set('c[SERIES_CODE]', seriesCodeFor(currency));
  // VERIFY(BOI-06): period parameter names ("startperiod"/"endperiod"), ISO dates, both bounds inclusive.
  url.searchParams.set('startperiod', from);
  url.searchParams.set('endperiod', to);
  // VERIFY(BOI-07): "format=csv" returns SDMX-CSV.
  url.searchParams.set('format', 'csv');
  return url.toString();
}

export function buildLatestUrl(config: AdapterConfig): string {
  // VERIFY(BOI-01): JSON is the default representation; "?asXml=true" would select XML.
  return `${config.publicApiBase}/GetExchangeRates`;
}

// ---------------------------------------------------------------------------------------------
// Parsing: history
// ---------------------------------------------------------------------------------------------

const TIME_COLUMNS = ['TIME_PERIOD', 'TIME', 'DATE', 'PERIOD'];
const VALUE_COLUMNS = ['OBS_VALUE', 'VALUE', 'OBSVALUE', 'RATE'];
const SERIES_COLUMNS = ['SERIES_CODE', 'SERIES', 'SERIES_KEY'];
const BASE_CURRENCY_COLUMNS = ['BASE_CURRENCY', 'CURRENCY'];
const STATUS_COLUMNS = ['OBS_STATUS'];
const MISSING_VALUES = new Set(['', 'NAN', 'NA', 'N/A', 'NULL', '-', '.']);

export interface ParsedSeries {
  observations: RateObservation[];
  /** Rows the source marked as missing (empty / NaN values), skipped. */
  skippedMissing: number;
  format: 'sdmx-csv' | 'sdmx-json';
}

function snippetOf(body: string): string {
  return body.slice(0, 200).replace(/\s+/g, ' ').trim();
}

function indexOfAny(header: string[], names: string[]): number {
  for (const name of names) {
    const i = header.indexOf(name);
    if (i !== -1) return i;
  }
  return -1;
}

/** Turn a daily period id into YYYY-MM-DD, or null when it is not a daily date. */
function toDailyDate(period: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(period.trim());
  const date = m?.[1];
  return date !== undefined && isValidIsoDate(date) ? date : null;
}

function finalize(observations: RateObservation[]): RateObservation[] {
  const byDate = new Map<string, RateObservation>();
  for (const o of observations) byDate.set(o.date, o); // last one wins for duplicates
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function parseSdmxCsv(body: string, currency: string): ParsedSeries {
  const rows = parseCsv(body);
  const headerRow = rows[0];
  if (headerRow === undefined) return { observations: [], skippedMissing: 0, format: 'sdmx-csv' };
  const header = headerRow.map((h) => h.trim().toUpperCase());
  const iTime = indexOfAny(header, TIME_COLUMNS);
  const iValue = indexOfAny(header, VALUE_COLUMNS);
  if (iTime === -1 || iValue === -1) {
    throw new SourceFormatError(
      `The SDMX-CSV response has no time/value columns (expected TIME_PERIOD and OBS_VALUE; found: ${header.join(', ') || 'nothing'}).`,
      snippetOf(body),
    );
  }
  const iSeries = indexOfAny(header, SERIES_COLUMNS);
  const iBase = indexOfAny(header, BASE_CURRENCY_COLUMNS);
  const iStatus = indexOfAny(header, STATUS_COLUMNS);
  const wantedSeries = seriesCodeFor(currency);
  const unit = getCurrency(currency)?.unit ?? 1; // VERIFY(BOI-08): unit fallback from the built-in table

  const observations: RateObservation[] = [];
  let skippedMissing = 0;
  let foreignRows = 0;
  let dataRows = 0;
  for (const row of rows.slice(1)) {
    if (row.every((cell) => cell.trim() === '')) continue;
    dataRows++;
    // Defence in depth: if the server ignored the series filter and returned several series, keep only ours.
    const series = iSeries === -1 ? '' : (row[iSeries] ?? '').trim();
    if (series !== '' && series.toUpperCase() !== wantedSeries) {
      foreignRows++;
      continue;
    }
    const base = iBase === -1 ? '' : (row[iBase] ?? '').trim();
    if (series === '' && base !== '' && base.toUpperCase() !== currency) {
      foreignRows++;
      continue;
    }
    const period = (row[iTime] ?? '').trim();
    const rawValue = (row[iValue] ?? '').trim();
    const status = iStatus === -1 ? '' : (row[iStatus] ?? '').trim().toUpperCase();
    if (MISSING_VALUES.has(rawValue.toUpperCase()) || status === 'M') {
      skippedMissing++;
      continue;
    }
    const date = toDailyDate(period);
    if (date === null) {
      throw new SourceFormatError(`The SDMX-CSV response has a period that is not a daily date: "${period}".`, snippetOf(body));
    }
    const rate = Number(rawValue);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new SourceFormatError(`The SDMX-CSV response has an unusable rate "${rawValue}" for ${date}.`, snippetOf(body));
    }
    observations.push({ date, rate, unit, change: null, publishedAt: null });
  }
  if (dataRows > 0 && observations.length === 0 && foreignRows === dataRows) {
    throw new SourceFormatError(`The SDMX-CSV response contains ${dataRows} row(s) but none for series ${wantedSeries}.`, snippetOf(body));
  }
  return { observations: finalize(observations), skippedMissing, format: 'sdmx-csv' };
}

interface JsonObject {
  [key: string]: unknown;
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null;
}

function parseJson(body: string, what: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new SourceFormatError(`The ${what} response is not valid JSON.`, snippetOf(body));
  }
}

/** VERIFY(BOI-07): SDMX-JSON (v1 `dataSets`/`structure`, v2 wrapped in `data`) as a fallback if the server ignores format=csv. */
export function parseSdmxJson(body: string, currency: string): ParsedSeries {
  const doc = asObject(parseJson(body, 'SDMX-JSON'));
  const root = doc === null ? null : (asObject(doc.data) ?? doc);
  const dataSets = root?.dataSets;
  const dataSet = Array.isArray(dataSets) ? asObject(dataSets[0]) : null;
  if (root === null || dataSet === null) {
    throw new SourceFormatError('The JSON response is not an SDMX-JSON data message (no dataSets).', snippetOf(body));
  }
  const structures = root.structures;
  const structure = asObject(root.structure) ?? (Array.isArray(structures) ? asObject(structures[0]) : null);
  const observationDims = asObject(structure?.dimensions)?.observation;
  const timeDim = Array.isArray(observationDims)
    ? (observationDims.map(asObject).find((d) => d?.id === 'TIME_PERIOD') ?? asObject(observationDims[0]))
    : null;
  const times = Array.isArray(timeDim?.values) ? (timeDim.values as unknown[]).map(asObject) : [];
  const seriesMap = asObject(dataSet.series);
  if (seriesMap === null) throw new SourceFormatError('The SDMX-JSON response has no series.', snippetOf(body));
  const seriesKeys = Object.keys(seriesMap);
  if (seriesKeys.length === 0) return { observations: [], skippedMissing: 0, format: 'sdmx-json' };
  if (seriesKeys.length > 1) {
    throw new SourceFormatError(`The SDMX-JSON response has ${seriesKeys.length} series; exactly one was requested.`, snippetOf(body));
  }
  const observations = asObject(asObject(seriesMap[seriesKeys[0] as string])?.observations) ?? {};
  const unit = getCurrency(currency)?.unit ?? 1; // VERIFY(BOI-08)
  const out: RateObservation[] = [];
  let skippedMissing = 0;
  for (const [index, raw] of Object.entries(observations)) {
    const time = times[Number(index)];
    const period = String(time?.id ?? time?.name ?? time?.start ?? '');
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === null || value === undefined || value === '') {
      skippedMissing++;
      continue;
    }
    const date = toDailyDate(period);
    const rate = typeof value === 'number' ? value : Number(value);
    if (date === null) throw new SourceFormatError(`The SDMX-JSON response has a period that is not a daily date: "${period}".`, snippetOf(body));
    if (!Number.isFinite(rate) || rate <= 0) throw new SourceFormatError(`The SDMX-JSON response has an unusable rate for ${date}.`, snippetOf(body));
    out.push({ date, rate, unit, change: null, publishedAt: null });
  }
  return { observations: finalize(out), skippedMissing, format: 'sdmx-json' };
}

/** Sniff the representation and parse a history response. */
export function parseSeriesBody(body: string, currency: string): ParsedSeries {
  const text = body.charCodeAt(0) === 0xfeff ? body.slice(1) : body;
  const head = text.trimStart();
  if (head === '') return { observations: [], skippedMissing: 0, format: 'sdmx-csv' };
  if (head.startsWith('{')) return parseSdmxJson(head, currency);
  if (head.startsWith('<')) {
    const kind = /^<!doctype html|^<html/i.test(head) ? 'an HTML page (a block or error page?)' : 'XML';
    throw new SourceFormatError(`Expected SDMX-CSV but the source returned ${kind}.`, snippetOf(head));
  }
  return parseSdmxCsv(text, currency);
}

/**
 * Attach `change` (percent vs the previous observation of the SAME window; null for the first one,
 * whose true predecessor is unknown) unless the source already supplied one.
 */
export function withComputedChange(observations: RateObservation[]): RateObservation[] {
  return observations.map((o, i) => {
    if (o.change !== null) return o;
    const previous = observations[i - 1];
    if (previous === undefined) return o;
    const change = Math.round((o.rate / previous.rate - 1) * 100 * 1000) / 1000;
    return { ...o, change: Object.is(change, -0) ? 0 : change };
  });
}

// ---------------------------------------------------------------------------------------------
// Parsing: latest rates (PublicApi)
// ---------------------------------------------------------------------------------------------

function toIsoInstant(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  let text = value.trim();
  // VERIFY(BOI-14): timestamps are assumed to be UTC ("...Z") when they carry no offset.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) text = `${text}T00:00:00Z`;
  else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text)) text = `${text.replace(' ', 'T')}Z`;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function latestFromRecord(record: JsonObject, fallbackUpdate: string | null): LatestRate | null {
  // VERIFY(BOI-02): field names of the JSON representation: key, currentExchangeRate, currentChange, unit, lastUpdate.
  const keyRaw = record.key ?? record.currencyCode ?? record.currencycode ?? record.code ?? record.currency;
  const rate = toNumber(record.currentExchangeRate ?? record.rate ?? record.value);
  if (typeof keyRaw !== 'string' || rate === null || rate <= 0) return null;
  const currency = keyRaw.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  const unit = toNumber(record.unit);
  return {
    currency,
    rate,
    unit: unit !== null && unit > 0 ? unit : null,
    change: toNumber(record.currentChange ?? record.change),
    lastUpdate: toIsoInstant(record.lastUpdate ?? record.lastUpdated) ?? fallbackUpdate,
  };
}

export function parseLatestJson(body: string): LatestRate[] {
  const doc = parseJson(body, 'PublicApi');
  const holder = asObject(doc);
  const list = Array.isArray(doc) ? doc : (holder?.exchangeRates ?? holder?.ExchangeRates ?? holder?.rates ?? holder?.data);
  if (!Array.isArray(list)) throw new SourceFormatError('The PublicApi JSON has no exchangeRates array.', snippetOf(body));
  const fallback = toIsoInstant(holder?.lastUpdate);
  const out: LatestRate[] = [];
  for (const item of list) {
    const record = asObject(item);
    const parsed = record === null ? null : latestFromRecord(record, fallback);
    if (parsed) out.push(parsed);
  }
  if (list.length > 0 && out.length === 0) {
    throw new SourceFormatError('The PublicApi JSON lists rates but none has the expected fields (key, currentExchangeRate).', snippetOf(body));
  }
  return out;
}

function xmlDecode(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function xmlChild(block: string, names: string[]): string | null {
  for (const name of names) {
    const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
    if (m) return xmlDecode((m[1] ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim());
  }
  return null;
}

/** VERIFY(BOI-03): XML representation: one element per currency with key/currentExchangeRate/currentChange/unit/lastUpdate children (a legacy layout with CURRENCYCODE/RATE/CHANGE/UNIT is tolerated). */
export function parseLatestXml(body: string): LatestRate[] {
  const fallback = toIsoInstant(xmlChild(body, ['LAST_UPDATE', 'lastUpdate']));
  const blocks = [...body.matchAll(/<(ExchangeRateResponseDTO|ExchangeRate|Currency|CURRENCY)\b[^>]*>([\s\S]*?)<\/\1>/g)];
  const out: LatestRate[] = [];
  for (const block of blocks) {
    const inner = block[2] ?? '';
    const record: JsonObject = {
      key: xmlChild(inner, ['key', 'CURRENCYCODE', 'currencyCode']),
      currentExchangeRate: xmlChild(inner, ['currentExchangeRate', 'RATE', 'rate']),
      currentChange: xmlChild(inner, ['currentChange', 'CHANGE', 'change']),
      unit: xmlChild(inner, ['unit', 'UNIT']),
      lastUpdate: xmlChild(inner, ['lastUpdate', 'LAST_UPDATE']),
    };
    const parsed = latestFromRecord(record, fallback);
    if (parsed) out.push(parsed);
  }
  if (out.length === 0) throw new SourceFormatError('The PublicApi XML contains no recognisable currency elements.', snippetOf(body));
  return out;
}

export function parseLatestBody(body: string): LatestRate[] {
  const head = body.trimStart();
  if (head.startsWith('{') || head.startsWith('[')) return parseLatestJson(head);
  if (/^<!doctype html|^<html/i.test(head)) {
    throw new SourceFormatError('Expected the PublicApi JSON/XML but the source returned an HTML page (a block or error page?).', snippetOf(head));
  }
  if (head.startsWith('<')) return parseLatestXml(head);
  throw new SourceFormatError('The PublicApi response is neither JSON nor XML.', snippetOf(head));
}

/** The Israeli calendar date a latest-rate update belongs to (`lastUpdate` is an instant). */
export function latestToObservation(latest: LatestRate, tableUnit: number): RateObservation | null {
  if (latest.lastUpdate === null) return null;
  return {
    date: israelDate(new Date(latest.lastUpdate)),
    rate: latest.rate,
    unit: latest.unit ?? tableUnit,
    change: latest.change,
    publishedAt: latest.lastUpdate,
  };
}

// ---------------------------------------------------------------------------------------------
// The live HTTP source
// ---------------------------------------------------------------------------------------------

const ACCEPT_SERIES = 'text/csv, application/json;q=0.8, */*;q=0.1';
const ACCEPT_LATEST = 'application/json, application/xml;q=0.8, */*;q=0.1';

export interface HttpSourceOptions {
  config?: AdapterConfig;
  policy?: HttpPolicy;
  deps: HttpDeps;
}

export function createBoiHttpSource(options: HttpSourceOptions): RateSource {
  const config = options.config ?? DEFAULT_ADAPTER_CONFIG;
  const policy = options.policy ?? DEFAULT_HTTP_POLICY;
  const { deps } = options;

  return {
    async fetchSeries(currency, from, to) {
      const url = buildSeriesUrl(config, currency, from, to);
      const res = await fetchText(url, ACCEPT_SERIES, policy, deps);
      // VERIFY(BOI-11): "no data" is assumed to be HTTP 404 (SDMX NoResultsFound), 204, or a 200 with an empty/header-only body.
      if (res.status === 404 || res.status === 204) return [];
      if (res.status === 401 || res.status === 403) {
        throw new SourceUnavailableError(
          `The Bank of Israel source refused the request (HTTP ${res.status}); it may block automated clients or this network.`, // VERIFY(BOI-12)
          res.attempts,
          res.status,
        );
      }
      if (res.status < 200 || res.status >= 300) {
        throw new SourceFormatError(`The Bank of Israel source rejected the request with HTTP ${res.status} (the API parameters may have changed).`, snippetOf(res.body));
      }
      const parsed = parseSeriesBody(res.body, currency);
      const inRange = parsed.observations.filter((o) => o.date >= from && o.date <= to);
      return withComputedChange(inRange);
    },

    async fetchLatest() {
      const res = await fetchText(buildLatestUrl(config), ACCEPT_LATEST, policy, deps);
      if (res.status === 401 || res.status === 403) {
        throw new SourceUnavailableError(`The Bank of Israel PublicApi refused the request (HTTP ${res.status}).`, res.attempts, res.status);
      }
      if (res.status < 200 || res.status >= 300) {
        throw new SourceFormatError(`The Bank of Israel PublicApi answered HTTP ${res.status}.`, snippetOf(res.body));
      }
      return parseLatestBody(res.body);
    },
  };
}
